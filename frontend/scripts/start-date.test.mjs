#!/usr/bin/env node
/**
 * src/utils/taskDisplay.js — effectiveStart and isRunning (2026-09-26).
 *
 * The owner's rule: a task with a start date shows on Today, in «Τρέχουν», from
 * that day until its deadline. The same cases the agent's running_tasks is held
 * to in tests/test_task_start_date.py, so the screen and the agent agree about
 * what is running.
 */
import { effectiveStart, isRunning } from '../src/utils/taskDisplay.js';

let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

const TODAY = '2026-09-30';

check('no start, no range', effectiveStart({ due_date: '2026-10-02' }), null);
check('a start before the deadline is the start', effectiveStart({ start_date: '2026-09-28', due_date: '2026-10-02' }), '2026-09-28');
check('a start with no deadline is still a start', effectiveStart({ start_date: '2026-09-28' }), '2026-09-28');
check('a start stranded after its deadline is ignored',
  effectiveStart({ start_date: '2026-10-09', due_date: '2026-10-02' }), null);

check('started, due later: running', isRunning({ start_date: '2026-09-28', due_date: '2026-10-02' }, TODAY), true);
check('starts today: running', isRunning({ start_date: TODAY, due_date: '2026-10-02' }, TODAY), true);
check('starts tomorrow: not yet', isRunning({ start_date: '2026-10-01', due_date: '2026-10-02' }, TODAY), false);
check('due today: in Today, not here', isRunning({ start_date: '2026-09-28', due_date: TODAY }, TODAY), false);
check('overdue: in overdue, not here', isRunning({ start_date: '2026-09-20', due_date: '2026-09-25' }, TODAY), false);
check('started, no deadline: running until done', isRunning({ start_date: '2026-09-28' }, TODAY), true);
check('no start: never running', isRunning({ due_date: '2026-10-02' }, TODAY), false);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
