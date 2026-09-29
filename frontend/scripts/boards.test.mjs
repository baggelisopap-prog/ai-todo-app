#!/usr/bin/env node
/**
 * src/utils/boards.js — where a card is, and which cards a column shows.
 *
 * Each check is one of the owner's rules from 2026-09-26:
 *   - the card IS the task: ticked anywhere means «Έγινε» here;
 *   - «Έγινε» and «Ακυρώθηκε» are always the last two columns;
 *   - finished cards stay visible 14 days, then fold into «Παλαιότερες»;
 *   - a deleted task is not drawn; a card with no task behind it is not drawn.
 * The same cases the server's boards.column_for is held to in test_boards.py.
 */
import {
  orderedColumns,
  columnFor,
  layoutBoard,
  boardOfTask,
  RECENT_DAYS,
  nextStepColumn,
  boardSummary,
  daysAgo,
  swipeColumnIndex,
  moveOptionHint,
  boardAfterTabPress,
  pickCreatedBoard,
} from '../src/utils/boards.js';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

const columns = [
  { record_id: 'done', name: 'Έγινε', kind: 'done', position: 0 },
  { record_id: 'b', name: 'Σε εξέλιξη', kind: 'open', position: 5 },
  { record_id: 'x', name: 'Ακυρώθηκε', kind: 'dropped', position: 1 },
  { record_id: 'a', name: 'Να γίνει', kind: 'open', position: 2 },
];

check('open columns first in their order, then the two endings',
  orderedColumns(columns).map((c) => c.record_id), ['a', 'b', 'done', 'x']);

const card = { task_id: 't1', column_id: 'b', position: 1 };
check('an open task sits in its recorded column', columnFor({}, card, columns).record_id, 'b');
check('a completed task is in «Έγινε» whatever the card says',
  columnFor({ is_completed: true }, card, columns).record_id, 'done');
check('a called-off task is in «Ακυρώθηκε» whatever the card says',
  columnFor({ dropped_at: '2026-09-26T10:00:00+03:00' }, card, columns).record_id, 'x');
check('a card whose column was deleted is in the first open column',
  columnFor({}, { ...card, column_id: 'gone' }, columns).record_id, 'a');
check('a card with no column is in the first open column',
  columnFor({}, { ...card, column_id: null }, columns).record_id, 'a');

const now = new Date('2026-09-26T12:00:00+03:00');
const recent = '2026-09-25T10:00:00+03:00';
const old = new Date(now.getTime() - (RECENT_DAYS + 1) * 86400000).toISOString();
const tasks = {
  open1: { record_id: 'open1', task_name: 'Α' },
  doneRecent: { record_id: 'doneRecent', is_completed: true, completed_at: recent },
  doneOld: { record_id: 'doneOld', is_completed: true, completed_at: old },
  doneUndated: { record_id: 'doneUndated', is_completed: true, completed_at: null },
  dropped: { record_id: 'dropped', dropped_at: recent },
  deleted: { record_id: 'deleted', deleted_at: recent },
};
const board = {
  columns,
  cards: [
    { task_id: 'open1', column_id: 'b', position: 1 },
    { task_id: 'doneRecent', column_id: 'a', position: 2 },
    { task_id: 'doneOld', column_id: 'a', position: 3 },
    { task_id: 'doneUndated', column_id: 'a', position: 4 },
    { task_id: 'dropped', column_id: 'a', position: 5 },
    { task_id: 'deleted', column_id: 'a', position: 6 },
    { task_id: 'nobody-can-see-this', column_id: 'a', position: 7 },
  ],
};
const lanes = layoutBoard(board, tasks, now);
const shown = Object.fromEntries(lanes.map((l) => [l.column.record_id, l.cards.map((c) => c.task.record_id)]));
const folded = Object.fromEntries(lanes.map((l) => [l.column.record_id, l.older.map((c) => c.task.record_id)]));

check('the lanes come in display order', lanes.map((l) => l.column.record_id), ['a', 'b', 'done', 'x']);
check('an open card is drawn in its column', shown.b, ['open1']);
check('a card finished this week is drawn in «Έγινε»', shown.done, ['doneRecent']);
check('older and undated finishes fold into «Παλαιότερες»', folded.done, ['doneOld', 'doneUndated']);
check('a called-off card is drawn in «Ακυρώθηκε»', shown.x, ['dropped']);
check('a deleted task and a task nobody can see are not drawn', shown.a, []);

const boards = [{ record_id: 'B1', cards: [] }, { record_id: 'B2', cards: [{ task_id: 't9' }] }];
check('a task finds the one board it is on', boardOfTask(boards, 't9')?.board.record_id, 'B2');
check('a task on no board finds none', boardOfTask(boards, 'nope'), null);

// --- The redesign, 2026-09-29: the board as its own page (proposal 1), one
// column at a time on a phone (proposal 2). ---------------------------------

// «Επόμενο βήμα» on a card: the next column along, ending at «Έγινε». Never
// «Ακυρώθηκε» — calling work off is a decision, not the next step of it.
check('the next step from the first column is the second', nextStepColumn(columns, 'a')?.record_id, 'b');
check('the next step from the last open column is «Έγινε»', nextStepColumn(columns, 'b')?.record_id, 'done');
check('a finished card has no next step', nextStepColumn(columns, 'done'), null);
check('a called-off card has no next step', nextStepColumn(columns, 'x'), null);

// The tile a board gets at the top of «Όλα».
const waitingSince = Date.parse('2026-09-26T09:00:00+03:00');
const summary = boardSummary(
  { ...board, cards: [...board.cards, { task_id: 'wait1', column_id: 'a', position: waitingSince }] },
  { ...tasks, wait1: { record_id: 'wait1' } },
  now,
);
check('the tile counts the first column as waiting', summary.waiting, 1);
check('the tile counts the other open columns as in progress', summary.doing, 1);
check('the tile counts every finished card, folded ones too', summary.done, 3);
check('the tile\'s last movement is the latest arrival or finish', summary.lastMovedAt, waitingSince);
check('an empty board has no last movement', boardSummary({ columns, cards: [] }, {}, now).lastMovedAt, null);

// «κίνηση χθες»: calendar days, not 24-hour blocks — 23:00 yesterday is «χθες».
const morning = new Date(2026, 8, 29, 8, 0);
check('earlier today is 0 days ago', daysAgo(new Date(2026, 8, 29, 7, 0).getTime(), morning), 0);
check('late last night is 1 day ago', daysAgo(new Date(2026, 8, 28, 23, 0).getTime(), morning), 1);
check('four calendar days back is 4', daysAgo(new Date(2026, 8, 25, 12, 0).getTime(), morning), 4);
check('no moment is no answer', daysAgo(null, morning), null);

// A sideways swipe on a phone changes the column; anything else is a scroll.
check('a swipe to the left shows the next column', swipeColumnIndex(0, -80, 10, 4), 1);
check('a swipe to the right shows the previous column', swipeColumnIndex(2, 80, 10, 4), 1);
check('there is nothing before the first column', swipeColumnIndex(0, 80, 10, 4), 0);
check('there is nothing after the last column', swipeColumnIndex(3, -80, 10, 4), 3);
check('a short drag is not a swipe', swipeColumnIndex(1, -40, 0, 4), 1);
check('a mostly vertical drag is a scroll, not a swipe', swipeColumnIndex(1, -80, 70, 4), 1);

// The «Μετακίνηση» sheet says what each button will do before it is pressed.
check('the column the card is in says so', moveOptionHint(columns[3], 'a', 4), { key: 'here' });
check('«Έγινε» warns that it completes the task', moveOptionHint(columns[0], 'a', 4), { key: 'completes' });
check('«Ακυρώθηκε» warns that it will ask why', moveOptionHint(columns[2], 'a', 4), { key: 'asks_why' });
check('an open column says how many cards it holds', moveOptionHint(columns[1], 'a', 2), { key: 'cards', count: 2 });

// Pressing «Όλα» while a board is open goes back to the list; any other tab
// leaves the board where it is, so «Όλα» brings you back to it.
check('«Όλα» on a board goes back to the list',
  boardAfterTabPress({ activeTab: 'browse', pressed: 'browse', openBoardId: 'B1' }), null);
check('leaving for Today keeps the board open',
  boardAfterTabPress({ activeTab: 'browse', pressed: 'today', openBoardId: 'B1' }), 'B1');
check('coming back to «Όλα» returns to the board',
  boardAfterTabPress({ activeTab: 'today', pressed: 'browse', openBoardId: 'B1' }), 'B1');

// After «Δημιουργία», the board to open is the new one — even when the list
// the screen held was out of date (a board made on another phone meanwhile).
const seen = [{ record_id: 'B1', name: 'Α' }];
const answer = [{ record_id: 'B1', name: 'Α' }, { record_id: 'B7', name: 'Από αλλού' }, { record_id: 'B9', name: 'Σεζόν' }];
check('the created board is the unseen one with the typed name', pickCreatedBoard(seen, answer, ' Σεζόν ')?.record_id, 'B9');
check('with no name match, the last unseen board', pickCreatedBoard(seen, answer, 'κάτι άλλο')?.record_id, 'B9');
check('nothing new is nothing to open', pickCreatedBoard(answer, answer, 'Σεζόν'), null);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
