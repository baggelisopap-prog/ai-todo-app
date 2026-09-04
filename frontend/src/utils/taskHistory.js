// The .js matters here for the same reason it does in taskDisplay.js: this
// module is imported by scripts/*.test.mjs under plain Node, which does not
// resolve extensionless relative imports the way Vite does.
import { toLocalISODate } from './formatDate.js';

/**
 * What Browse's History tab shows, as pure functions over tasks already in
 * memory — no request, no React.
 *
 * The rule this file implements is the exact complement of
 * `taskDisplay.isVisibleTask`: a task is in History precisely when it is NOT
 * visible in the live lists. Written as its own module rather than as a second
 * copy of that rule, because the two must never drift — a state that stops
 * being live and does not appear here has simply vanished from the app.
 */

export const KIND_COMPLETED = 'completed';
export const KIND_DELETED = 'deleted';
export const KIND_MISSED = 'missed';
export const KIND_REJECTED = 'rejected';

export const RANGE_WEEK = '7';
export const RANGE_MONTH = '30';
export const RANGE_YEAR = 'year';
export const RANGE_ALL = 'all';

function createdStamp(task) {
  // created_at is the database's own `default now()`. created_time is the
  // Airtable-era column that nothing writes; kept as a fallback only so a row
  // that somehow carries it is not treated as undated.
  return task.created_at || task.created_time || null;
}

/**
 * Milliseconds for an ISO timestamp, or null.
 *
 * Date.parse rather than comparing the strings, which looks tempting because
 * they are ISO and sort lexically — but only when they share an offset. They
 * do not: `deleted_at` and `completed_at` are written as Athens local time
 * ("…+03:00") while Postgres hands `created_at` back in UTC ("…+00:00"), so a
 * string comparison puts a 09:00 Athens event before a 07:00 UTC one that
 * actually happened at the same instant.
 */
function millis(at) {
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isNaN(t) ? null : t;
}

/**
 * Where this task sits in History, or null if it is still live work.
 *
 * `exact: false` means `at` is the task's CREATION time standing in for an
 * event that was never timestamped — the row is placed on the timeline by the
 * only date it has, and the UI must not print it as if it were the moment the
 * thing happened. Two states are like that:
 *   - a rejected AI suggestion, which has no rejection timestamp at all
 *   - a task completed before 2026-08-13, when completed_at was added
 * Both keep NULL rather than a backfilled guess, which is the same choice the
 * migrations made and the reason this flag exists instead of a fabricated date.
 */
export function historyEntry(task) {
  if (!task) return null;

  // Order is the row's LAST state, not a preference. A task can be completed
  // and then deleted; History reports where it ended up, so deletion wins.
  if (task.deleted_at) return { kind: KIND_DELETED, at: task.deleted_at, exact: true };
  // cancelled_at is the same act on a recurrence occurrence — see
  // docs/DECISIONS.md for why it stayed a separate column and why it reads the
  // same to the person who pressed Delete.
  if (task.cancelled_at) return { kind: KIND_DELETED, at: task.cancelled_at, exact: true };
  if (task.missed_at) return { kind: KIND_MISSED, at: task.missed_at, exact: true };
  if (task.is_rejected) return { kind: KIND_REJECTED, at: createdStamp(task), exact: false };
  if (task.is_completed) {
    return task.completed_at
      ? { kind: KIND_COMPLETED, at: task.completed_at, exact: true }
      : { kind: KIND_COMPLETED, at: createdStamp(task), exact: false };
  }
  return null;
}

export function isHistoryTask(task) {
  return historyEntry(task) !== null;
}

/**
 * The oldest instant a range admits, or null for "everything".
 *
 * Counted in whole local days including today, so "7 μέρες" on a Friday means
 * Saturday-through-Friday rather than "168 hours ago", which would cut this
 * morning's own entries out of a range the user reads as "this week".
 */
export function rangeStart(range, now = new Date()) {
  if (range === RANGE_ALL) return null;
  if (range === RANGE_YEAR) return new Date(now.getFullYear(), 0, 1).getTime();

  const days = range === RANGE_WEEK ? 7 : 30;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start.getTime();
}

/**
 * The history entries matching a kind and a date range, newest first.
 *
 * An entry with no date at all cannot honestly answer "in the last 7 days",
 * so it is excluded from every range except "Όλα" rather than being assumed
 * recent — the same principle as not backfilling the timestamps.
 */
export function selectHistory(tasks, { kind = 'all', range = RANGE_ALL, now = new Date() } = {}) {
  const since = rangeStart(range, now);
  const rows = [];

  for (const task of tasks || []) {
    const entry = historyEntry(task);
    if (!entry) continue;
    if (kind !== 'all' && entry.kind !== kind) continue;

    const at = millis(entry.at);
    if (since !== null && (at === null || at < since)) continue;

    rows.push({ ...entry, task, at, day: at === null ? null : toLocalISODate(new Date(at)) });
  }

  // Undated entries last, so a row we cannot place never sits above one we can.
  rows.sort((a, b) => {
    if (a.at === null && b.at === null) return 0;
    if (a.at === null) return 1;
    if (b.at === null) return -1;
    return b.at - a.at;
  });

  return rows;
}

/**
 * Rows already ordered by selectHistory, cut into day groups.
 *
 * Grouping by day is the point of the screen: history is read with the
 * question "what happened THEN", so the date is the heading rather than a
 * detail repeated on every line.
 */
export function groupHistoryByDay(rows) {
  const groups = [];
  let current = null;

  for (const row of rows) {
    if (!current || current.day !== row.day) {
      current = { day: row.day, rows: [] };
      groups.push(current);
    }
    current.rows.push(row);
  }

  return groups;
}

/**
 * How many history entries exist per kind, over the CURRENT range but ignoring
 * the current kind — so the "Τι" menu can show counts that do not collapse to
 * the one thing already selected.
 */
export function countByKind(tasks, { range = RANGE_ALL, now = new Date() } = {}) {
  const counts = { all: 0, [KIND_COMPLETED]: 0, [KIND_DELETED]: 0, [KIND_MISSED]: 0, [KIND_REJECTED]: 0 };
  for (const row of selectHistory(tasks, { kind: 'all', range, now })) {
    counts.all += 1;
    counts[row.kind] += 1;
  }
  return counts;
}
