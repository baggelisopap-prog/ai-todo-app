#!/usr/bin/env node
/**
 * src/utils/taskDisplay.js — isVisibleTask, the real module.
 *
 * This one function decides what Today, the Calendar, Upcoming and the Inbox
 * are allowed to show. It had no test until 2026-09-04, which was survivable
 * while the rule was one clause long; it now has four, and the newest one
 * (deleted_at) is the only thing standing between a task the user deleted and
 * every screen in the app.
 *
 * The reason it deserves its own file rather than a line in an existing one:
 * a regression here is invisible in code review — the clause simply is not
 * there — and shows up as "why is this deleted task on my Today screen".
 */
import { isVisibleTask } from '../src/utils/taskDisplay.js';

let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

const live = { task_name: 'Πλήρωσε ΔΕΗ' };

// --- The baseline ----------------------------------------------------------
check('an ordinary task is visible', isVisibleTask(live), true);

// --- The four ways out of visibility --------------------------------------
check(
  'a rejected AI suggestion is hidden',
  isVisibleTask({ ...live, is_rejected: true }),
  false
);
check(
  'a missed occurrence is hidden',
  isVisibleTask({ ...live, missed_at: '2026-09-02T06:00:00+03:00' }),
  false
);
check(
  'a cancelled occurrence is hidden',
  isVisibleTask({ ...live, cancelled_at: '2026-09-03T09:00:00+03:00' }),
  false
);
check(
  'a soft-deleted task is hidden',
  isVisibleTask({ ...live, deleted_at: '2026-09-04T09:00:00+03:00' }),
  false
);

// --- NULL is not "deleted" -------------------------------------------------
// Every task predating the migration carries null here, and there are 301 of
// them. If null ever read as deleted, the app would empty itself.
check('deleted_at null is still visible', isVisibleTask({ ...live, deleted_at: null }), true);
check(
  'every column null at once is still visible',
  isVisibleTask({ ...live, is_rejected: false, missed_at: null, cancelled_at: null, deleted_at: null }),
  true
);

// --- A restored task comes all the way back --------------------------------
// Restore clears both stamps in one write; this is what the user sees after
// pressing the button.
check(
  'clearing both stamps makes it visible again',
  isVisibleTask({ ...live, deleted_at: null, cancelled_at: null }),
  true
);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
