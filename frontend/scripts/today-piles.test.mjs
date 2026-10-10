#!/usr/bin/env node
/**
 * src/utils/todayPiles.js — Today's groups, and «Περιμένουν απάντηση» (2026-10-10).
 *
 * The owner's rule, after a guest message rang his phone every two hours for a
 * task he could not find: what rings you, you see on Today. The server says
 * WHICH tasks ring (GET /tasks → awaiting_reply_ids, the escalation loop's own
 * list — tests/test_awaiting_reply.py); this file only decides where they sit.
 * One task, one place: a ringing task leaves whichever other group it was in,
 * because two rows for one task would open two sheets.
 */
import { splitByDay, countAll } from '../src/utils/todayPiles.js';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};
const ids = (list) => list.map((t) => t.record_id);

const TODAY = '2026-10-10';
const ME = 'me';
const task = (record_id, fields = {}) => ({ record_id, approval_status: true, ...fields });

// The owner's task as it stood: approved, due on the check-out day.
const invoice = task('invoice', { due_date: '2026-10-18' });

check('a ringing task dated next week is on Today',
  ids(splitByDay([invoice], TODAY, ME, ['invoice']).awaiting), ['invoice']);
check('without the server saying so it is not — the bug as reported',
  countAll(splitByDay([invoice], TODAY, ME, [])), 0);
check('no list from the server is the same as an empty one',
  countAll(splitByDay([invoice], TODAY, ME)), 0);

const dueToday = task('due-today', { due_date: TODAY });
const piles = splitByDay([dueToday], TODAY, ME, ['due-today']);
check('ringing AND due today: in the ringing group…', ids(piles.awaiting), ['due-today']);
check('…and not a second time under Σήμερα', ids(piles.today), []);

const overdue = task('late', { due_date: '2026-10-01' });
check('ringing AND overdue: only once', ids(splitByDay([overdue], TODAY, ME, ['late']).overdue), []);

const running = task('long', { start_date: '2026-10-08', due_date: '2026-10-12' });
check('ringing AND running: only once', ids(splitByDay([running], TODAY, ME, ['long']).running), []);

check('a quiet task due today stays under Σήμερα',
  ids(splitByDay([dueToday, invoice], TODAY, ME, ['invoice']).today), ['due-today']);

// Unapproved guest messages ring too, but they live in the Inbox — with their
// approve button — and on Today's «σε αναμονή έγκρισης» when due today.
const unapproved = task('new-guest', { approval_status: false, due_date: TODAY });
const p2 = splitByDay([unapproved], TODAY, ME, ['new-guest']);
check('an unapproved one is not in the ringing group', ids(p2.awaiting), []);
check('it stays where its approve button is', ids(p2.pending), ['new-guest']);

// The server never lists a finished or deleted task; this is the belt to that
// braces, so a list one minute stale cannot keep a closed task on screen.
const done = task('done', { is_completed: true, due_date: '2026-10-18' });
const deleted = task('gone', { deleted_at: '2026-10-10T12:00:00Z', due_date: '2026-10-18' });
check('a closed one leaves at once, even if the list is a minute old',
  ids(splitByDay([done, deleted], TODAY, ME, ['done', 'gone']).awaiting), []);

check('countAll counts the ringing group', countAll(splitByDay([invoice], TODAY, ME, ['invoice'])), 1);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
