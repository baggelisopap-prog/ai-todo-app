#!/usr/bin/env node
/**
 * A called-off task — «Ακυρώθηκε» (2026-09-26) — through the real modules.
 *
 * Two promises, one per module, and each is invisible in review when broken:
 *   - it leaves every live list (taskDisplay.isVisibleTask), or a task the
 *     owner decided not to do sits on Today with nothing saying so;
 *   - it arrives in History as its own kind, with its own count
 *     (taskHistory), or it has simply vanished from the app — the rule
 *     taskHistory.js states at its top.
 */
import { isVisibleTask } from '../src/utils/taskDisplay.js';
import { historyEntry, countByKind, KIND_DROPPED, KIND_COMPLETED } from '../src/utils/taskHistory.js';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

const live = { task_name: 'Βάψιμο κάγκελων', approval_status: true, created_at: '2026-09-20T08:00:00+00:00' };
const dropped = { ...live, dropped_at: '2026-09-26T10:00:00+03:00', drop_reason: 'βρέχει' };

check('an ordinary task is visible', isVisibleTask(live), true);
check('a called-off task leaves the live lists', isVisibleTask(dropped), false);
check('undoing it brings it back', isVisibleTask({ ...dropped, dropped_at: null }), true);

check(
  'History files it as called off, at the moment it was',
  historyEntry(dropped),
  { kind: KIND_DROPPED, at: '2026-09-26T10:00:00+03:00', exact: true }
);
check('a live task is not in History', historyEntry(live), null);

// Every task that leaves visibility must land in History — the complement rule.
check(
  'invisible and in History are the same set, for this state too',
  !isVisibleTask(dropped) === (historyEntry(dropped) !== null),
  true
);

const counts = countByKind([live, dropped, { ...live, is_completed: true, completed_at: '2026-09-26T09:00:00+03:00' }]);
check('the «Τι» menu counts it under its own kind', counts[KIND_DROPPED], 1);
check('and not under completed', counts[KIND_COMPLETED], 1);
check('the total includes it', counts.all, 2);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
