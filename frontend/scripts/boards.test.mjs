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
  atColumn,
  nearestColumn,
  chipPlacement,
  sideScale,
  arrivalOffset,
  moveOptionHint,
  BOARDS_TAB,
  tabAfterModeSwitch,
  showModeSwitch,
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

// The phone board's swipe (2026-10-13, the owner's «κάθε swipe μία κατηγορία»):
// the columns follow the finger and come to rest on exactly one. `progress` is
// how many column widths the board has moved — 1.4 is part way into the second.
check('mid-swipe is between two columns', atColumn(1.4), false);
check('a board on a column is resting on it', atColumn(2), true);
check('a hair off a column still counts as resting on it', atColumn(1.01), true);
check('let go past half way, the next column is the nearest', nearestColumn(1.6, 4), 2);
check('let go before half way, it is the column it left', nearestColumn(1.3, 4), 1);
check('never before the first column', nearestColumn(-0.3, 4), 0);
check('never past the last column', nearestColumn(3.4, 4), 3);

// The strip above the columns (2026-10-13, the owner's «Βελάκια»): the column
// you are on in the middle at full size; the one before on the left and the one
// after on the right, whole but smaller, with a red ← and a green →. `d` is how
// many columns a chip is from where the board is (−1 the one before, 0.5 half
// way to becoming the next). Widths in px; a 390px strip, a 100px chip.
const W = 390;
const place = (d, side = 0.8) => {
  const at = chipPlacement(d, { stripWidth: W, chipWidth: 100, side });
  return { x: Math.round(at.x * 10) / 10, scale: Math.round(at.scale * 100) / 100, opacity: at.opacity, next: at.next, prev: at.prev };
};
check('the column you are on: in the middle, full size, no arrow', place(0), { x: 195, scale: 1, opacity: 1, next: 0, prev: 0 });
check('the next one: whole at the right edge, smaller, green → lit', place(1), { x: 336, scale: 0.8, opacity: 1, next: 1, prev: 0 });
check('the one before: whole at the left edge, smaller, red ← lit', place(-1), { x: 54, scale: 0.8, opacity: 1, next: 0, prev: 1 });
check('half way through a swipe: between the middle and the edge, part grown, no arrow yet',
  place(0.5), { x: 263, scale: 0.9, opacity: 1, next: 0, prev: 0 });
check('two columns away: not drawn', place(2).opacity, 0);
check('on its way in from beyond the next: half drawn', place(1.5).opacity, 0.5);
check('three quarters of the way to the side, its arrow is half lit', place(0.75).next, 0.5);

// The sides shrink on a narrow phone, only as much as the widest pair needs
// to fit whole with its arrow — never below 0.65 of full size.
check('a wide phone keeps the sides at 0.8', sideScale(412, [80, 110, 90, 120]), 0.8);
// widest pair: «150» on the right of «90» — room 180 − 45 − 14 − 3 = 118 for 150 + a 24px arrow
check('a narrow phone shrinks them to fit the widest pair', Math.round(sideScale(360, [80, 110, 90, 150]) * 1000) / 1000, 0.678);
check('never smaller than 0.65', sideScale(250, [80, 110, 90, 120]), 0.65);
check('one column alone has no sides to fit', sideScale(360, [300]), 0.8);

// Scrolled down a long column, the next one opens at its top: it is drawn as
// far down as you had scrolled, so it arrives level with your eye.
check('not scrolled past the columns\' top: nothing to make up', arrivalOffset(100, 240), 0);
check('scrolled 700px into a column: the next is drawn 700px down', arrivalOffset(940, 240), 700);

// The «Μετακίνηση» sheet says what each button will do before it is pressed.
check('the column the card is in says so', moveOptionHint(columns[3], 'a', 4), { key: 'here' });
check('«Έγινε» warns that it completes the task', moveOptionHint(columns[0], 'a', 4), { key: 'completes' });
check('«Ακυρώθηκε» warns that it will ask why', moveOptionHint(columns[2], 'a', 4), { key: 'asks_why' });
check('an open column says how many cards it holds', moveOptionHint(columns[1], 'a', 2), { key: 'cards', count: 2 });

// Board mode (2026-10-12, the owner's «switch to board mode»): one switch in
// the top bar takes the whole app to the boards and back.
check('«Πίνακες» from a task screen goes to board mode',
  tabAfterModeSwitch('calendar', 'today'), BOARDS_TAB);
check('«Εργασίες» goes back to the screen you left for the boards',
  tabAfterModeSwitch(BOARDS_TAB, 'calendar'), 'calendar');
check('«Εργασίες» with nothing remembered lands where the app starts',
  tabAfterModeSwitch(BOARDS_TAB, null), 'inbox');
check('«Εργασίες» never "returns" to board mode itself',
  tabAfterModeSwitch(BOARDS_TAB, BOARDS_TAB), 'inbox');

// The switch is shown only to someone who has a board — his rule that whoever
// does not use boards sees nothing new — but inside board mode it is always
// there, because it is the way out.
check('no board, no switch', showModeSwitch({ inBoards: false, boardCount: 0, isLoaded: true }), false);
check('a board, a switch', showModeSwitch({ inBoards: false, boardCount: 1, isLoaded: true }), true);
check('not before the boards have loaded', showModeSwitch({ inBoards: false, boardCount: 0, isLoaded: false }), false);
check('inside board mode, always — even with the last board just deleted',
  showModeSwitch({ inBoards: true, boardCount: 0, isLoaded: true }), true);

// After «Δημιουργία», the board to open is the new one — even when the list
// the screen held was out of date (a board made on another phone meanwhile).
const seen = [{ record_id: 'B1', name: 'Α' }];
const answer = [{ record_id: 'B1', name: 'Α' }, { record_id: 'B7', name: 'Από αλλού' }, { record_id: 'B9', name: 'Σεζόν' }];
check('the created board is the unseen one with the typed name', pickCreatedBoard(seen, answer, ' Σεζόν ')?.record_id, 'B9');
check('with no name match, the last unseen board', pickCreatedBoard(seen, answer, 'κάτι άλλο')?.record_id, 'B9');
check('nothing new is nothing to open', pickCreatedBoard(answer, answer, 'Σεζόν'), null);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
