#!/usr/bin/env node
/**
 * src/utils/taskDraft.js — what the task sheet's form sends when it saves.
 *
 * One function for both saves the sheet can make: an edit of an existing task
 * and, since 2026-09-30, a brand-new card on a board (the owner: «Νέα κάρτα»
 * opens the whole task form, not a title box). Two copies of this would drift,
 * and the first thing to drift would be the '' → null rule below.
 */
import { fieldsFromDraft } from '../src/utils/taskDraft.js';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

const empty = {
  task_name: '  Λογιστής ',
  description: '',
  category: 'Unknown',
  priority: 'P3',
  due_date: '',
  due_time: '',
  start_date: '',
  checklist: [],
  workspace_id: '',
  category_id: '',
  assigned_to: '',
};

const sent = fieldsFromDraft(empty);
check('the name goes without the spaces around it', sent.task_name, 'Λογιστής');
check('an empty date, time and start are null, not ""', [sent.due_date, sent.due_time, sent.start_date], [null, null, null]);
check('an empty room, category and assignee are null — "" is not a uuid',
  [sent.workspace_id, sent.category_id, sent.assigned_to], [null, null, null]);
check('priority and checklist go as they are', [sent.priority, sent.checklist], ['P3', []]);

const full = fieldsFromDraft({
  ...empty,
  due_date: '2026-10-02',
  due_time: '10:00',
  start_date: '2026-10-01',
  workspace_id: 'ws-1',
  category_id: 'cat-1',
  checklist: [{ text: 'ΦΠΑ', done: false }],
});
check('filled fields go as typed',
  [full.due_date, full.due_time, full.start_date, full.workspace_id, full.category_id],
  ['2026-10-02', '10:00', '2026-10-01', 'ws-1', 'cat-1']);

check('a new card leaves the assignee out — it is set after it exists',
  'assigned_to' in fieldsFromDraft(empty, { forCreate: true }), false);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
