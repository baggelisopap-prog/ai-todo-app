#!/usr/bin/env node
/**
 * src/utils/sortTasks.js — the real module.
 *
 * This file exists because the sort was silently broken for months. It ordered
 * by `created_time`, a column nothing writes, so every "newest first" list was
 * sorting nulls and came out in whatever order the API returned. Nothing
 * failed, nothing looked wrong in review, and it was only caught when the
 * owner stared at a list and worked out that the date on the row was not the
 * date being sorted.
 *
 * So the first test below is the one that matters: sorting must actually
 * CHANGE the order. A comparator that returns 0 for everything passes any test
 * that only checks "did it come back with the same items".
 */
import { sortTasks, sortsByCreation, resolveSort, createdAt } from '../src/utils/sortTasks.js';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

const ids = (list) => list.map((t) => t.record_id);
const task = (record_id, extra = {}) => ({ record_id, ...extra });

// Deliberately handed to sortTasks in an order that is neither the answer nor
// its reverse, so a comparator that does nothing cannot accidentally pass.
const library = [
  task('mid', { created_at: '2026-09-02T05:00:00+00:00', due_date: '2026-09-20', priority: 'P2' }),
  task('newest', { created_at: '2026-09-04T05:00:00+00:00', due_date: '2026-09-10', priority: 'P3' }),
  task('oldest', { created_at: '2026-08-26T05:00:00+00:00', due_date: '2026-09-30', priority: 'P1' }),
];

// --- The regression that started all of this -------------------------------
check('newest first', ids(sortTasks(library, 'created_desc')), ['newest', 'mid', 'oldest']);
check('oldest first', ids(sortTasks(library, 'created_asc')), ['oldest', 'mid', 'newest']);
check(
  'the two directions are actually different',
  JSON.stringify(ids(sortTasks(library, 'created_desc'))) !== JSON.stringify(ids(sortTasks(library, 'created_asc'))),
  true
);

// created_time is the dead column. A task carrying ONLY it must still be
// ordered by it -- but nothing in the app writes it, which is the whole bug.
check(
  'created_at wins when both are present',
  createdAt({ created_at: '2026-09-04T00:00:00+00:00', created_time: '2020-01-01T00:00:00+00:00' }),
  '2026-09-04T00:00:00+00:00'
);
check(
  'created_time is still honoured when it is all there is',
  ids(sortTasks([task('old', { created_time: '2026-01-01T00:00:00+00:00' }), task('new', { created_time: '2026-09-01T00:00:00+00:00' })], 'created_desc')),
  ['new', 'old']
);

// --- Mixed offsets ---------------------------------------------------------
// 07:00 UTC is 10:00 in Athens, so it is LATER than 09:00+03:00. Comparing the
// strings would order these the other way round and look plausible doing it.
check(
  'offsets are compared as instants, not as text',
  ids(sortTasks([
    task('athens-9am', { created_at: '2026-09-04T09:00:00+03:00' }),
    task('utc-7am', { created_at: '2026-09-04T07:00:00+00:00' }),
  ], 'created_desc')),
  ['utc-7am', 'athens-9am']
);

// --- Undated tasks sink, in BOTH directions --------------------------------
const withUndated = [task('undated'), task('dated', { created_at: '2026-01-01T00:00:00+00:00' })];
check('undated sinks under newest-first', ids(sortTasks(withUndated, 'created_desc')), ['dated', 'undated']);
check('undated sinks under oldest-first too', ids(sortTasks(withUndated, 'created_asc')), ['dated', 'undated']);

// --- Due date, both ways ---------------------------------------------------
check('earliest due first', ids(sortTasks(library, 'due_asc')), ['newest', 'mid', 'oldest']);
check('latest due first', ids(sortTasks(library, 'due_desc')), ['oldest', 'mid', 'newest']);

// No due date goes last BOTH ways. First under "latest first" would open the
// list with everything that has no date at all.
const someUndue = [task('nodue', { created_at: '2026-09-01T00:00:00+00:00' }), task('due', { due_date: '2026-09-10' })];
check('no due date is last, earliest-first', ids(sortTasks(someUndue, 'due_asc')), ['due', 'nodue']);
check('no due date is last, latest-first', ids(sortTasks(someUndue, 'due_desc')), ['due', 'nodue']);

// --- Priority, with creation as the tiebreak -------------------------------
check('priority orders P1 -> P3', ids(sortTasks(library, 'priority')), ['oldest', 'mid', 'newest']);
check(
  'equal priorities fall back to newest first',
  ids(sortTasks([
    task('older', { priority: 'P1', created_at: '2026-09-01T00:00:00+00:00' }),
    task('newer', { priority: 'P1', created_at: '2026-09-03T00:00:00+00:00' }),
  ], 'priority')),
  ['newer', 'older']
);

// --- The old names still work ----------------------------------------------
// InboxView, TodayView and UpcomingList pass these as fixed strings.
check('newest -> created_desc', resolveSort('newest'), 'created_desc');
check('oldest -> created_asc', resolveSort('oldest'), 'created_asc');
check('due_date -> due_asc', resolveSort('due_date'), 'due_asc');
check('an unknown value falls back rather than throwing', resolveSort(undefined), 'created_desc');
check('the legacy name sorts identically', ids(sortTasks(library, 'newest')), ids(sortTasks(library, 'created_desc')));

// --- Which sorts show "Μπήκε …" on the row ---------------------------------
check('created_desc shows it', sortsByCreation('created_desc'), true);
check('the legacy newest shows it too', sortsByCreation('newest'), true);
check('due_asc does not', sortsByCreation('due_asc'), false);
check('priority does not', sortsByCreation('priority'), false);

// --- The input list is never mutated ---------------------------------------
const original = [task('b', { created_at: '2026-01-01T00:00:00+00:00' }), task('a', { created_at: '2026-09-01T00:00:00+00:00' })];
sortTasks(original, 'created_desc');
check('sorting does not reorder the caller\'s array', ids(original), ['b', 'a']);
check('an empty list is survivable', ids(sortTasks([], 'created_desc')), []);
check('a missing list is survivable', ids(sortTasks(undefined, 'created_desc')), []);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
