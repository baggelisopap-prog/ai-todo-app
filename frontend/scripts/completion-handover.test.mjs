#!/usr/bin/env node
/**
 * src/utils/taskDisplay.js — awaitsMyAcknowledgement and isClosedForMe.
 *
 * WHY THESE EXIST. Until 2026-09-17 a completion was one fact for everybody:
 * six screens asked `!task.is_completed` and the task left every list at once.
 * In a shared room that means a colleague can finish your work and it simply
 * vanishes from your day with nothing to see and nobody named. The owner hit
 * exactly that from the other side — he closed a task a colleague had made,
 * and nothing anywhere recorded it.
 *
 * So a completion by somebody else now stays on the other party's list, struck
 * through and naming who closed it, until they press OK. These two functions
 * are that rule, and they are separated on purpose: the ROW asks "do I draw the
 * strip" and the LIST asks "do I hide this", and those are different questions
 * about the same task.
 *
 * The clause most likely to be lost is `completed_by` being empty. Every task
 * finished before this shipped carries null there, as does every completion the
 * Hostaway poller makes on its own. Null must read as "hand this back to
 * nobody" — if it ever read as a handover, several hundred finished tasks would
 * come back onto a list at once.
 */
import { awaitsMyAcknowledgement, isClosedForMe } from '../src/utils/taskDisplay.js';

let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

const ME = 'user-me';
const HER = 'user-her';
const THIRD = 'user-third';

// Closed by her, created by me, nobody has acknowledged it.
const handedBack = {
  task_name: 'Έλεγχος θέρμανσης Β4',
  is_completed: true,
  completed_by: HER,
  created_by: ME,
  assigned_to: null,
  completion_seen_by: [],
};

// --- The strip on the row -------------------------------------------------
check(
  'a task she closed that I created is waiting for my OK',
  awaitsMyAcknowledgement(handedBack, ME),
  true
);
check(
  'a task she closed that was assigned to me is waiting for my OK',
  awaitsMyAcknowledgement({ ...handedBack, created_by: THIRD, assigned_to: ME }, ME),
  true
);
check(
  'a task I closed myself is not waiting for anything',
  awaitsMyAcknowledgement({ ...handedBack, completed_by: ME }, ME),
  false
);
check(
  'a task that is still open is not waiting for anything',
  awaitsMyAcknowledgement({ ...handedBack, is_completed: false }, ME),
  false
);
check(
  'I already pressed OK, so it is no longer waiting',
  awaitsMyAcknowledgement({ ...handedBack, completion_seen_by: [ME] }, ME),
  false
);
check(
  'somebody else pressing OK does not clear it for me',
  awaitsMyAcknowledgement({ ...handedBack, completion_seen_by: [THIRD] }, ME),
  true
);

// --- Who is owed the news, and who is not ---------------------------------
check(
  'a bystander in the room is owed nothing',
  awaitsMyAcknowledgement({ ...handedBack, created_by: THIRD, assigned_to: THIRD }, ME),
  false
);
check(
  'I made it, she took it, and a third person closed it — I am still owed the news',
  awaitsMyAcknowledgement(
    { ...handedBack, completed_by: THIRD, created_by: ME, assigned_to: HER },
    ME
  ),
  true
);
check(
  'she took it and a third person closed it — she is owed the news too',
  awaitsMyAcknowledgement(
    { ...handedBack, completed_by: THIRD, created_by: ME, assigned_to: HER },
    HER
  ),
  true
);

// --- The clauses that protect every task already in the database ----------
check(
  'a completion with nobody named hands back to nobody',
  awaitsMyAcknowledgement({ ...handedBack, completed_by: null }, ME),
  false
);
check(
  'a completion with no column at all hands back to nobody',
  awaitsMyAcknowledgement(
    { task_name: 'Παλιό task', is_completed: true, created_by: ME },
    ME
  ),
  false
);
check(
  'before my own id arrives, nothing is waiting for me',
  awaitsMyAcknowledgement(handedBack, null),
  false
);
check(
  'a null seen-list is read as nobody rather than crashing',
  awaitsMyAcknowledgement({ ...handedBack, completion_seen_by: null }, ME),
  true
);

// --- What the lists ask ---------------------------------------------------
check('an open task is not closed for me', isClosedForMe(handedBack && { ...handedBack, is_completed: false }, ME), false);
check('a task I closed myself is closed for me', isClosedForMe({ ...handedBack, completed_by: ME }, ME), true);
check(
  'a task she closed that I am owed stays on my list',
  isClosedForMe(handedBack, ME),
  false
);
check(
  'once I press OK it leaves my list',
  isClosedForMe({ ...handedBack, completion_seen_by: [ME] }, ME),
  true
);
check(
  'it left her list the moment she closed it',
  isClosedForMe(handedBack, HER),
  true
);
check(
  'every task completed before today behaves exactly as it did',
  isClosedForMe({ task_name: 'Παλιό task', is_completed: true, created_by: ME }, ME),
  true
);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
