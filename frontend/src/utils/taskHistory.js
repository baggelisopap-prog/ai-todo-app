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

// The ranges the «Πότε» menu offers, nearest first.
//
// «Αυτή την εβδομάδα» was built, shown to the owner, and REMOVED on sight —
// «7 ημέρες να δείχνει, καλύτερα είναι». Recorded rather than quietly undone,
// because the rule it leaves behind is the useful part: the menu carries ONE
// week-sized option, never both. They read as the same thing and are not — on
// a Friday "the last seven days" reaches back to the previous Saturday, while
// "this week" starts on Monday and is three days — and two controls 30px apart
// meaning almost-but-not-quite the same thing is the confusion this whole
// change exists to remove. He picked which one; the rule is what matters.
export const RANGE_TODAY = 'today';
export const RANGE_YESTERDAY = 'yesterday';
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

/** Local midnight at the start of `date`'s day. */
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * The window a range admits: `{ since, until }` in milliseconds, either end
 * null for "no edge on this side". `until` is EXCLUSIVE.
 *
 * This replaced a `rangeStart` that returned one number, and the reason is
 * «Χθες»: every other range means "since X" and runs to now, but yesterday also
 * has to mean "before today" — without the upper edge it would simply be
 * «Σήμερα» with more rows in it. One range needing two edges makes two edges
 * the shape of the function, rather than a special case bolted onto the caller.
 *
 * Counted in whole LOCAL days, never in hours: "24 hours ago" would cut this
 * morning's own entries out of a range the reader calls "today", and "7 μέρες"
 * means seven whole days INCLUDING today rather than 168 hours back.
 */
export function rangeBounds(range, now = new Date()) {
  const today = startOfDay(now);

  if (range === RANGE_TODAY) return { since: today.getTime(), until: null };

  if (range === RANGE_YESTERDAY) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { since: yesterday.getTime(), until: today.getTime() };
  }

  if (range === RANGE_WEEK || range === RANGE_MONTH) {
    const days = range === RANGE_WEEK ? 7 : 30;
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    return { since: start.getTime(), until: null };
  }

  if (range === RANGE_YEAR) {
    return { since: new Date(now.getFullYear(), 0, 1).getTime(), until: null };
  }

  return { since: null, until: null };
}

/**
 * The history entries matching a kind and a date range, newest first.
 *
 * An entry with no date at all cannot honestly answer "was this yesterday", so
 * it is excluded from every bounded range rather than being assumed recent —
 * the same principle as not backfilling the timestamps.
 */
export function selectHistory(tasks, { kind = 'all', range = RANGE_ALL, now = new Date() } = {}) {
  const { since, until } = rangeBounds(range, now);
  const bounded = since !== null || until !== null;
  const rows = [];

  for (const task of tasks || []) {
    const entry = historyEntry(task);
    if (!entry) continue;
    if (kind !== 'all' && entry.kind !== kind) continue;

    const at = millis(entry.at);
    // An undated entry is excluded from every bounded range — it cannot
    // honestly answer "was this yesterday" — but is kept under «Όλο το αρχείο».
    if (bounded && at === null) continue;
    if (since !== null && at < since) continue;
    if (until !== null && at >= until) continue;

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

// Which channel a completion came through, for the rows where no person was
// recorded. `ui` deliberately reads as "the app" and NOT as "you": see
// completionCredit below for why that word had to change.
const COMPLETION_CHANNEL_KEYS = {
  ui: 'browse.source_app',
  agent: 'browse.source_agent',
  hostaway_reply: 'browse.source_hostaway_reply',
};

/**
 * Who — or what — gets the credit for a completion, as a translation key plus
 * whatever the caller needs to resolve a name. Returns null when the row can
 * say nothing honest.
 *
 * THIS LABEL TOLD A LIE FOR ONE DAY AND WAS WRITTEN FOUR WEEKS BEFORE THAT.
 * It read `completed_source` — the CHANNEL a completion came through — and
 * printed «από εσένα» for `ui`, which was exactly true while the app had one
 * user, because "through the app's own screen" and "by you" were the same
 * fact. It never actually appeared on screen in all that time, because
 * TaskRecord did not carry the column and response_model stripped it. Fixing
 * that transport on 2026-09-18 made it visible, in a workspace with two people
 * in it, on a task the owner's colleague had closed. He read «από εσένα» and
 * said so.
 *
 * `completed_by` answers the real question as of 2026-09-17, so the person
 * wins wherever there is one — including over `agent`, because telling the
 * agent to close a task is still a person closing it.
 *
 * WHERE THERE IS NO PERSON, THE CHANNEL IS NAMED AND NOBODY IS GUESSED. That
 * covers every task completed before 2026-09-18 — including a week of shared
 * completions between 09-11 and 09-18 that genuinely might have been somebody
 * else's — plus the two paths where no human presses anything. «από την
 * εφαρμογή» still distinguishes a manual close from the agent's and from a
 * guest reply, which is all `completed_source` ever honestly knew.
 */
export function completionCredit(task, myId) {
  if (!task) return null;

  if (task.completed_by) {
    return task.completed_by === myId
      ? { key: 'browse.source_you' }
      : { key: 'browse.source_person', userId: task.completed_by };
  }

  const key = COMPLETION_CHANNEL_KEYS[task.completed_source];
  return key ? { key } : null;
}
