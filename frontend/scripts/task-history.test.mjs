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
  completionCredit,
  isHistoryTask,
  selectHistory,
  groupHistoryByDay,
  countByKind,
  rangeBounds,
  KIND_COMPLETED,
  KIND_DELETED,
  KIND_MISSED,
  KIND_REJECTED,
  RANGE_TODAY,
  RANGE_YESTERDAY,
  RANGE_WEEK,
  RANGE_MONTH,
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
// NOW is Friday 4 September 2026, so "7 μέρες" reaches back to Saturday 29
// AUGUST — across a month boundary, which is where an off-by-one shows up.

// Σήμερα — one open-ended edge, at this morning's midnight.
check('today starts at midnight this morning',
  new Date(rangeBounds(RANGE_TODAY, NOW).since).getDate(), 4);
check('today has no upper edge', rangeBounds(RANGE_TODAY, NOW).until, null);

// Χθες — THE ONLY RANGE WITH TWO EDGES, and the reason rangeStart became
// rangeBounds. Every other range means "since X"; this one also means "before
// today", or it would just be "today" with more rows.
const yesterdayBounds = rangeBounds(RANGE_YESTERDAY, NOW);
check('yesterday starts at midnight yesterday',
  new Date(yesterdayBounds.since).getDate(), 3);
check('yesterday ends at midnight this morning',
  new Date(yesterdayBounds.until).getDate(), 4);

const acrossDays = [
  task('today_row', { deleted_at: '2026-09-04T09:00:00+03:00' }),
  task('yesterday_row', { deleted_at: '2026-09-03T23:30:00+03:00' }),
  task('two_days_ago', { deleted_at: '2026-09-02T09:00:00+03:00' }),
];
check('today shows only today',
  selectHistory(acrossDays, { range: RANGE_TODAY, now: NOW }).map((r) => r.task.record_id),
  ['today_row']);
check('yesterday excludes today AND the day before',
  selectHistory(acrossDays, { range: RANGE_YESTERDAY, now: NOW }).map((r) => r.task.record_id),
  ['yesterday_row']);

// 7 μέρες — seven WHOLE days including today, so the window opens at midnight
// six days back rather than 168 hours ago. Counting in hours would push this
// morning's own entries out of a range the reader calls "the last week".
//
// «Αυτή την εβδομάδα» (from Monday) was built instead of this, shown to the
// owner, and removed on sight: «7 ημέρες να δείχνει, καλύτερα είναι». The rule
// that survives is in taskHistory.js — ONE week-sized option, never both.
check('the week range opens six days back, at midnight',
  new Date(rangeBounds(RANGE_WEEK, NOW).since).getDate(), 29);
check('the week range has no upper edge', rangeBounds(RANGE_WEEK, NOW).until, null);

const straddling = [
  task('six_days_ago', { deleted_at: '2026-08-29T08:00:00+03:00' }),
  task('seven_days_ago', { deleted_at: '2026-08-28T20:00:00+03:00' }),
];
check('the week keeps the sixth day back and drops the seventh',
  selectHistory(straddling, { range: RANGE_WEEK, now: NOW }).map((r) => r.task.record_id),
  ['six_days_ago']);

// Something recorded a minute ago is in "the last 7 days" — the case an
// hours-based window silently drops on the morning after a late-night entry.
check('the week includes this morning',
  selectHistory([task('this_morning', { deleted_at: '2026-09-04T07:30:00+03:00' })],
    { range: RANGE_WEEK, now: NOW }).length,
  1);

const old = [
  task('recent', { deleted_at: '2026-09-02T09:00:00+03:00' }),
  task('ancient', { deleted_at: '2026-06-01T09:00:00+03:00' }),
];
check(
  'the 30-day range excludes the old one',
  selectHistory(old, { range: RANGE_MONTH, now: NOW }).map((r) => r.task.record_id),
  ['recent']
);
check('all keeps both', selectHistory(old, { range: RANGE_ALL, now: NOW }).length, 2);
check('all has neither edge', rangeBounds(RANGE_ALL, NOW), { since: null, until: null });

// An undated row cannot honestly answer "was this yesterday".
const undated = [task('nodate', { is_rejected: true })];
check('an undated row is excluded from a range', selectHistory(undated, { range: RANGE_MONTH, now: NOW }).length, 0);
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

// --- Who gets the credit for a completion ---------------------------------
// The label under a finished task said «από εσένα» for four weeks of wall time
// and never once appeared, because completed_source never reached the browser.
// Fixing that transport on 2026-09-18 made it visible — and in a shared room it
// was a LIE: it names the CHANNEL a completion came through (ui / agent /
// hostaway_reply), written when the app had exactly one user, so "through the
// screen" and "by you" were the same fact. The owner read it about a task a
// colleague had closed and said so.
//
// completed_by answers the real question now, so: name the person where we know
// them, name the CHANNEL where we do not, and never guess.
const ME = 'user-me';
const HER = 'user-her';

check(
  'a task I closed myself is credited to me',
  completionCredit({ completed_by: ME, completed_source: 'ui' }, ME),
  { key: 'browse.source_you' }
);
check(
  'a task she closed is credited to HER, not to the screen it came through',
  completionCredit({ completed_by: HER, completed_source: 'ui' }, ME),
  { key: 'browse.source_person', userId: HER }
);
check(
  'the person wins over the channel even when the agent did the writing',
  completionCredit({ completed_by: HER, completed_source: 'agent' }, ME),
  { key: 'browse.source_person', userId: HER }
);

// No person recorded: every task finished before 2026-09-18, plus the two paths
// where no human presses anything.
check(
  'an old manual completion names the app, never a person',
  completionCredit({ completed_source: 'ui' }, ME),
  { key: 'browse.source_app' }
);
check(
  'a guest reply closing a Hostaway task says so',
  completionCredit({ completed_source: 'hostaway_reply' }, ME),
  { key: 'browse.source_hostaway_reply' }
);
check(
  'an old agent completion still names the agent',
  completionCredit({ completed_source: 'agent' }, ME),
  { key: 'browse.source_agent' }
);
check(
  'a completion with neither column says nothing at all',
  completionCredit({}, ME),
  null
);
check('a null task is survivable here too', completionCredit(null, ME), null);
check(
  'before my own id arrives, my own completion is named rather than miscredited',
  completionCredit({ completed_by: ME, completed_source: 'ui' }, null),
  { key: 'browse.source_person', userId: ME }
);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
