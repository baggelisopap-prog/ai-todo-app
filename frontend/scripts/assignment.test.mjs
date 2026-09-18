#!/usr/bin/env node
/**
 * src/utils/assignment.js — what "Δικά μου" means on screen.
 *
 * It has to mean exactly what repository.get_owned_or_assigned_tasks means by
 * it, because that read is what the agent answers «τι έχω σήμερα» from. Two
 * definitions of the same word is a screen that says 18 next to an agent that
 * says 21, with nothing on either side looking broken.
 *
 * The clause that is easy to lose is the second one: a task I CREATED that
 * nobody has taken is mine. Drop it and every task I made in a shared room
 * silently leaves my own list the moment I look at it through this filter.
 */
import {
  filterTasksByAssignment,
  effectiveAssignee,
  ASSIGNMENT_ALL,
  ASSIGNMENT_MINE,
  ASSIGNMENT_UNASSIGNED,
} from '../src/utils/assignment.js';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

const ME = 'user-me';
const HER = 'user-her';

const tasks = [
  { task_name: 'handed to me',        assigned_to: ME,   created_by: HER },
  { task_name: 'mine, nobody took it', assigned_to: null, created_by: ME },
  { task_name: 'hers, nobody took it', assigned_to: null, created_by: HER },
  { task_name: 'I made it, she has it', assigned_to: HER, created_by: ME },
];
const names = (list) => list.map((t) => t.task_name);

// --- Όλα -------------------------------------------------------------------
check('all leaves the list alone', names(filterTasksByAssignment(tasks, ASSIGNMENT_ALL, ME)), names(tasks));
check('no mode at all leaves it alone', names(filterTasksByAssignment(tasks, null, ME)), names(tasks));

// --- Δικά μου: BOTH arms ---------------------------------------------------
check(
  'mine = assigned to me PLUS my own untaken work',
  names(filterTasksByAssignment(tasks, ASSIGNMENT_MINE, ME)),
  ['handed to me', 'mine, nobody took it']
);
check(
  'work I created and handed over is NOT mine any more',
  names(filterTasksByAssignment(tasks, ASSIGNMENT_MINE, ME)).includes('I made it, she has it'),
  false
);
check(
  "somebody else's untaken work is not mine",
  names(filterTasksByAssignment(tasks, ASSIGNMENT_MINE, ME)).includes('hers, nobody took it'),
  false
);
check(
  'the same list read as HER',
  names(filterTasksByAssignment(tasks, ASSIGNMENT_MINE, HER)),
  ['hers, nobody took it', 'I made it, she has it']
);

// --- Αδιάθετα --------------------------------------------------------------
check(
  'unassigned is the whole pile, mine included',
  names(filterTasksByAssignment(tasks, ASSIGNMENT_UNASSIGNED, ME)),
  ['mine, nobody took it', 'hers, nobody took it']
);

// --- Before the id arrives -------------------------------------------------
check(
  'no id yet shows everything rather than hiding your own work',
  names(filterTasksByAssignment(tasks, ASSIGNMENT_MINE, null)),
  names(tasks)
);
check('an empty list survives', filterTasksByAssignment([], ASSIGNMENT_MINE, ME), []);
check('a missing list survives', filterTasksByAssignment(undefined, ASSIGNMENT_MINE, ME), []);

// --- Who the screen names as responsible ----------------------------------
// The owner's rule, in his words: "whoever makes a task is the one it is
// assigned to, unless they send it to somebody else". That was already true of
// every part of the system that acts — filterTasksByAssignment above, and
// repository.get_owned_or_assigned_tasks behind it, both count a task you made
// and nobody took as yours. The only place it was NOT true was the picture: an
// unassigned task drew no face at all, so a room full of everybody's untaken
// work looked ownerless.
//
// A display rule and nothing more. It deliberately does NOT write assigned_to,
// which would need the creator to be a member of the task's workspace and is
// refused outright for a task in no workspace at all.
check('an assigned task names its assignee', effectiveAssignee(tasks[0]), ME);
check('an untaken task names whoever made it', effectiveAssignee(tasks[1]), ME);
check(
  'a handover names the person it went to, not the person it came from',
  effectiveAssignee({ assigned_to: HER, created_by: ME }),
  HER
);
check('a task with neither names nobody', effectiveAssignee({}), null);
check('a missing task names nobody', effectiveAssignee(undefined), null);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
