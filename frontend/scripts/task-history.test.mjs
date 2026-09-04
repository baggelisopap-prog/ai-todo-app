#!/usr/bin/env node
/**
 * src/utils/taskHistory.js — the real module, no browser needed.
 *
 * Two things here are easy to get wrong in a way no one notices from the
 * screen: the ordering when timestamps carry DIFFERENT offsets (Athens local
 * for deleted_at/completed_at, UTC for created_at), and what happens to an
 * entry that has no honest date at all. Both are exercised below.
 */
import {
  historyEntry,
  isHistoryTask,
  selectHistory,
  groupHistoryByDay,
  countByKind,
  rangeStart,
  KIND_COMPLETED,
  KIND_DELETED,
  KIND_MISSED,
  KIND_REJECTED,
  RANGE_WEEK,
  RANGE_ALL,
} from '../src/utils/taskHistory.js';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

const NOW = new Date('2026-09-04T12:00:00+03:00');
const task = (record_id, extra = {}) => ({ record_id, task_name: record_id, ...extra });

// --- Which state a row is in ----------------------------------------------

check('a live task is not history', historyEntry(task('a')), null);
check(
  'an approved, incomplete task is not history',
  isHistoryTask(task('a', { approval_status: true, is_completed: false })),
  false
);
check(
  'completed reports completed_at',
  historyEntry(task('a', { is_completed: true, completed_at: '2026-09-04T10:00:00+03:00' })),
  { kind: KIND_COMPLETED, at: '2026-09-04T10:00:00+03:00', exact: true }
);
check(
  'deleted reports deleted_at',
  historyEntry(task('a', { deleted_at: '2026-09-04T09:00:00+03:00' })),
  { kind: KIND_DELETED, at: '2026-09-04T09:00:00+03:00', exact: true }
);
check(
  'a cancelled occurrence reads as deleted too',
  historyEntry(task('a', { cancelled_at: '2026-09-03T09:00:00+03:00' })),
  { kind: KIND_DELETED, at: '2026-09-03T09:00:00+03:00', exact: true }
);
check(
  'a missed occurrence is its own kind',
  historyEntry(task('a', { missed_at: '2026-09-02T06:00:00+03:00' })),
  { kind: KIND_MISSED, at: '2026-09-02T06:00:00+03:00', exact: true }
);

// --- Deletion wins over completion ----------------------------------------
// Completing a task and then deleting it must report where it ENDED UP, or the
// History tab claims a task is still on file that the user removed.
check(
  'completed THEN deleted reports deleted',
  historyEntry(task('a', {
    is_completed: true,
    completed_at: '2026-09-01T10:00:00+03:00',
    deleted_at: '2026-09-04T09:00:00+03:00',
  })).kind,
  KIND_DELETED
);

// --- The two states with no timestamp of their own ------------------------
// Neither may print a date as if it were the moment the thing happened.
check(
  'a rejected suggestion falls back to creation, marked inexact',
  historyEntry(task('a', { is_rejected: true, created_at: '2026-09-01T05:00:00+00:00' })),
  { kind: KIND_REJECTED, at: '2026-09-01T05:00:00+00:00', exact: false }
);
check(
  'a pre-2026-08-13 completion falls back to creation, marked inexact',
  historyEntry(task('a', { is_completed: true, created_at: '2026-01-05T05:00:00+00:00' })).exact,
  false
);
check(
  'created_time is accepted as a fallback when created_at is absent',
  historyEntry(task('a', { is_rejected: true, created_time: '2026-01-05T05:00:00+00:00' })).at,
  '2026-01-05T05:00:00+00:00'
);
check(
  'a rejected task with no dates at all is still history, just undated',
  historyEntry(task('a', { is_rejected: true })),
  { kind: KIND_REJECTED, at: null, exact: false }
);

// --- Ordering across MIXED offsets ----------------------------------------
// 07:00 UTC is 10:00 Athens, so it is LATER than 09:00+03:00. Comparing the
// strings would put "2026-09-04T07:00:00+00:00" first and be wrong.
const mixed = selectHistory(
  [
    task('athens-9am', { deleted_at: '2026-09-04T09:00:00+03:00' }),
    task('utc-7am', { is_rejected: true, created_at: '2026-09-04T07:00:00+00:00' }),
  ],
  { now: NOW }
);
check('mixed offsets sort by real instant', mixed.map((r) => r.task.record_id), ['utc-7am', 'athens-9am']);

// --- Filtering by kind ----------------------------------------------------
const library = [
  task('done', { is_completed: true, completed_at: '2026-09-04T10:00:00+03:00' }),
  task('gone', { deleted_at: '2026-09-03T09:00:00+03:00' }),
  task('skipped', { missed_at: '2026-09-02T06:00:00+03:00' }),
  task('refused', { is_rejected: true, created_at: '2026-09-01T05:00:00+00:00' }),
  task('live', { approval_status: true }),
];

check('all returns every non-live row', selectHistory(library, { now: NOW }).length, 4);
check(
  'a kind keeps only its own',
  selectHistory(library, { kind: KIND_DELETED, now: NOW }).map((r) => r.task.record_id),
  ['gone']
);
check(
  'newest first',
  selectHistory(library, { now: NOW }).map((r) => r.task.record_id),
  ['done', 'gone', 'skipped', 'refused']
);

// --- Filtering by range ---------------------------------------------------
// "7 days" counts whole local days INCLUDING today, so this morning's entries
// are in a range the user reads as "this week".
check(
  'the week range starts 6 days before today, at midnight',
  new Date(rangeStart(RANGE_WEEK, NOW)).getDate(),
  29
);
const old = [
  task('recent', { deleted_at: '2026-09-02T09:00:00+03:00' }),
  task('ancient', { deleted_at: '2026-06-01T09:00:00+03:00' }),
];
check(
  'the week range excludes the old one',
  selectHistory(old, { range: RANGE_WEEK, now: NOW }).map((r) => r.task.record_id),
  ['recent']
);
check('all keeps both', selectHistory(old, { range: RANGE_ALL, now: NOW }).length, 2);

// An undated row cannot honestly answer "in the last 7 days".
const undated = [task('nodate', { is_rejected: true })];
check('an undated row is excluded from a range', selectHistory(undated, { range: RANGE_WEEK, now: NOW }).length, 0);
check('an undated row appears under all', selectHistory(undated, { range: RANGE_ALL, now: NOW }).length, 1);

// --- Undated rows sort last, never above a dated one ----------------------
const mixedDates = selectHistory(
  [task('nodate', { is_rejected: true }), task('dated', { deleted_at: '2026-01-01T09:00:00+03:00' })],
  { range: RANGE_ALL, now: NOW }
);
check('undated sinks below even an ancient dated row', mixedDates.map((r) => r.task.record_id), ['dated', 'nodate']);

// --- Grouping -------------------------------------------------------------
const groups = groupHistoryByDay(selectHistory(library, { now: NOW }));
check('one group per day', groups.length, 4);
check('the first group is the newest day', groups[0].day, '2026-09-04');
check(
  'two entries on the same day share one group',
  groupHistoryByDay(
    selectHistory(
      [
        task('a', { deleted_at: '2026-09-04T09:00:00+03:00' }),
        task('b', { deleted_at: '2026-09-04T11:00:00+03:00' }),
      ],
      { now: NOW }
    )
  ).length,
  1
);
check('an undated group is keyed null', groupHistoryByDay(selectHistory(undated, { now: NOW }))[0].day, null);

// --- Counts ---------------------------------------------------------------
const counts = countByKind(library, { now: NOW });
check('counts total the history, not the library', counts.all, 4);
check('counts per kind', [counts.completed, counts.deleted, counts.missed, counts.rejected], [1, 1, 1, 1]);

// --- Missing input must not throw -----------------------------------------
check('undefined list is survivable', selectHistory(undefined, { now: NOW }).length, 0);
check('a null task is survivable', historyEntry(null), null);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
