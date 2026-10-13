// Pure functions over a board and the tasks already in memory — no request, no
// React — so scripts/boards.test.mjs can hold them to the owner's rules under
// plain Node. The .js on imports matters for the same reason it does in
// taskHistory.js.

/**
 * How long a card stays in «Έγινε» / «Ακυρώθηκε» before it folds into
 * «Παλαιότερες (N)». The owner's number, 2026-09-26: «β, 14 μέρες». Folded, not
 * hidden — one tap opens them, and History has them too.
 */
export const RECENT_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Open columns in the user's order, then «Έγινε», then «Ακυρώθηκε». The two
 * endings are ALWAYS last: they are the end of a card's road, and the owner's
 * rule was that they can be renamed but not removed. Mirrors
 * boards.ordered_columns on the server.
 */
export function orderedColumns(columns) {
  const open = (columns || []).filter((c) => c.kind === 'open').sort((a, b) => a.position - b.position);
  const done = (columns || []).filter((c) => c.kind === 'done');
  const dropped = (columns || []).filter((c) => c.kind === 'dropped');
  return [...open, ...done, ...dropped];
}

/**
 * Where a card IS — the task decides first, the card second.
 *
 * THE BOARD NEVER KEEPS ITS OWN OPINION ABOUT WHETHER A TASK IS DONE. A task
 * ticked in Today is in «Έγινε» here without anybody touching the board; one
 * called off from the ⋯ menu is in «Ακυρώθηκε». card.column_id only remembers
 * which OPEN column the card sits in — which is also where it returns when the
 * task is reopened. A column that no longer exists falls back to the first
 * open one. Mirrors boards.column_for on the server.
 */
export function columnFor(task, card, columns) {
  const ordered = orderedColumns(columns);
  if (task?.dropped_at) return ordered.find((c) => c.kind === 'dropped') || null;
  if (task?.is_completed) return ordered.find((c) => c.kind === 'done') || null;
  const open = ordered.filter((c) => c.kind === 'open');
  return open.find((c) => c.record_id === card?.column_id) || open[0] || null;
}

/**
 * When a finished card finished — the moment that decides whether it is still
 * «recent». A task completed before completed_at existed (2026-08-13) has no
 * such moment and counts as old, rather than being dated by its creation and
 * wrongly shown as fresh.
 */
function endedAt(task) {
  const stamp = task.dropped_at || task.completed_at;
  if (!stamp) return null;
  const ms = Date.parse(stamp);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Is this task something a board can show at all? A card whose task was
 * DELETED (or is otherwise a record rather than work) is not drawn — the row
 * survives in the database, so the board simply stops showing it. Completed
 * and called-off tasks ARE shown: they are what «Έγινε» and «Ακυρώθηκε» are for.
 */
export function isBoardable(task) {
  return Boolean(task) && !task.deleted_at && !task.cancelled_at && !task.missed_at && !task.is_rejected;
}

/**
 * The board, laid out: one entry per column in display order, each with the
 * cards to draw and, for the two endings, the older ones folded away.
 *
 * `tasksById` is the app's in-memory task list keyed by record_id. A card whose
 * task is not in it — a room the user has left, a deleted task — is skipped:
 * the board never invents a card it cannot back with a task.
 */
export function layoutBoard(board, tasksById, now = new Date()) {
  const columns = orderedColumns(board?.columns);
  const cutoff = now.getTime() - RECENT_DAYS * DAY_MS;
  const lanes = columns.map((column) => ({ column, cards: [], older: [] }));
  const byId = Object.fromEntries(lanes.map((lane) => [lane.column.record_id, lane]));

  const cards = [...(board?.cards || [])].sort((a, b) => a.position - b.position);
  for (const card of cards) {
    const task = tasksById[card.task_id];
    if (!isBoardable(task)) continue;
    const column = columnFor(task, card, columns);
    const lane = column && byId[column.record_id];
    if (!lane) continue;
    if (column.kind !== 'open') {
      const ended = endedAt(task);
      if (ended === null || ended < cutoff) {
        lane.older.push({ card, task });
        continue;
      }
    }
    lane.cards.push({ card, task });
  }

  // Newest finish at the top of the endings, so what just happened is what
  // you see first; the open lanes keep arrival order (card.position).
  for (const lane of lanes) {
    if (lane.column.kind === 'open') continue;
    const byEnd = (a, b) => (endedAt(b.task) || 0) - (endedAt(a.task) || 0);
    lane.cards.sort(byEnd);
    lane.older.sort(byEnd);
  }
  return lanes;
}

/**
 * «Επόμενο βήμα» — where the button on a card sends it: the next column along,
 * ending at «Έγινε». Null for a card already finished or called off. Never
 * «Ακυρώθηκε»: calling work off is a decision, not the next step of it
 * (proposal 2, chosen 2026-09-29).
 */
export function nextStepColumn(columns, columnId) {
  const ordered = orderedColumns(columns).filter((c) => c.kind !== 'dropped');
  const index = ordered.findIndex((c) => c.record_id === columnId);
  if (index < 0 || ordered[index].kind !== 'open') return null;
  return ordered[index + 1] || null;
}

/**
 * What a board's tile at the top of «Όλα» says: how many cards wait in the
 * first column, how many are under way in the other open ones, how many are
 * done (the folded ones too — it is a tally, not a view), and when a card last
 * arrived somewhere or finished. Called-off cards are not counted: the tile
 * reports progress, and a cancellation is not any.
 *
 * lastMovedAt reads what the board already has — card.position is the moment a
 * card arrived in its column, and a finished task carries when it finished —
 * so the tile needs no request of its own.
 */
export function boardSummary(board, tasksById, now = new Date()) {
  const lanes = layoutBoard(board, tasksById, now);
  const summary = { waiting: 0, doing: 0, done: 0, lastMovedAt: null };
  let firstOpen = true;
  for (const lane of lanes) {
    const count = lane.cards.length + lane.older.length;
    if (lane.column.kind === 'open') {
      if (firstOpen) summary.waiting += count;
      else summary.doing += count;
      firstOpen = false;
    } else if (lane.column.kind === 'done') {
      summary.done += count;
    }
    for (const { card, task } of [...lane.cards, ...lane.older]) {
      const moments = [card.position, endedAt(task)].filter((m) => typeof m === 'number' && m > 0);
      for (const moment of moments) {
        if (summary.lastMovedAt === null || moment > summary.lastMovedAt) summary.lastMovedAt = moment;
      }
    }
  }
  return summary;
}

/**
 * Calendar days between a moment and now, in the phone's own time: 23:00 last
 * night is 1 («χθες»), not 0, even though fewer than 24 hours have passed.
 */
export function daysAgo(ms, now = new Date()) {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return null;
  const then = new Date(ms);
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

/*
 * The phone board's swipe (2026-10-13). The columns sit side by side and follow
 * the finger; the browser's own scroll-snap brings them to rest on exactly one,
 * however hard the flick. These are the sums around it, in «progress»: how many
 * column widths the board has moved, so 1.4 is part way into the second column.
 * Before this, nothing moved under the finger and the column changed on release
 * after a 60px sideways drag — the owner asked for «πιο ομαλή η μετάβαση».
 */

// How close to a column counts as resting on it: a fraction of a pixel on a
// phone, never an offset anyone could see.
const AT_COLUMN = 0.02;

export function atColumn(progress) {
  return Math.abs(progress - Math.round(progress)) <= AT_COLUMN;
}

/** The column nearest the board, never outside the board. */
export function nearestColumn(progress, count) {
  return Math.max(0, Math.min(count - 1, Math.round(progress)));
}

/**
 * Where the chip strip sits for one chip: whole, and in the middle where the
 * ends of the strip allow. The strip does not scroll on its own — the owner's
 * «όχι μπάρα που μπορεί να κάτσει όπου νά 'ναι» — so this is the only place
 * it is ever put.
 */
export function chipRestingScroll({ chipLeft, chipWidth, stripWidth, maxScroll }) {
  return Math.max(0, Math.min(maxScroll, chipLeft + chipWidth / 2 - stripWidth / 2));
}

/** Mid-swipe the strip is part way between the two chips' places, so it moves with the finger. */
export function stripScrollAt(progress, places) {
  const last = places.length - 1;
  const p = Math.max(0, Math.min(last, progress));
  const a = Math.floor(p);
  const b = Math.min(a + 1, last);
  return places[a] + (places[b] - places[a]) * (p - a);
}

/**
 * How far down to draw the other columns while a swipe begins, so the one you
 * arrive at opens at its top, level with your eye, rather than wherever the
 * page happened to be scrolled. `columnsTop` is the page scroll at which the
 * columns start right under the stuck chips.
 */
export function arrivalOffset(scrollY, columnsTop) {
  return Math.max(0, Math.round(scrollY - columnsTop));
}

/**
 * The small line under each button of the «Μετακίνηση» sheet, as a key and its
 * number: what pressing it will DO, said before it is pressed — the endings
 * change the task itself, everywhere.
 */
export function moveOptionHint(column, currentColumnId, count) {
  if (column.record_id === currentColumnId) return { key: 'here' };
  if (column.kind === 'done') return { key: 'completes' };
  if (column.kind === 'dropped') return { key: 'asks_why' };
  return { key: 'cards', count };
}

/**
 * BOARD MODE (2026-10-12, the owner's «switch to board mode», chosen from
 * mockups over a fifth bottom tab). The boards are not one of the four tabs:
 * a switch in the top bar takes the whole app to them, where the bottom tabs
 * and the AskBar give their room to the board, and the same switch brings it
 * back. Until then the boards were tiles at the top of «Όλα» («χύμα», he
 * called it), and an open board was a page inside that tab.
 *
 * BOARDS_TAB is the value App's activeTab holds while in board mode — a screen
 * with no button in the bottom bar, which is the whole point.
 */
export const BOARDS_TAB = 'boards';

/**
 * Where the switch goes. Into board mode from any task screen; out of it, back
 * to the screen that was left for it — so a look at a board from the Calendar
 * returns to the Calendar — or to the Inbox, where the app starts, when there
 * is nothing to go back to.
 */
export function tabAfterModeSwitch(activeTab, returnTab) {
  if (activeTab !== BOARDS_TAB) return BOARDS_TAB;
  return returnTab && returnTab !== BOARDS_TAB ? returnTab : 'inbox';
}

/**
 * Whether the switch is drawn. Only for someone who has a board: his rule from
 * the first boards brainstorm is that whoever does not use boards sees nothing
 * new (the first board is made from the small «+ Πίνακας» in «Όλα»). Inside
 * board mode it is ALWAYS drawn, because it is the way out — deleting your
 * last board must not leave you in a mode with no door.
 */
export function showModeSwitch({ inBoards, boardCount, isLoaded }) {
  if (inBoards) return true;
  return Boolean(isLoaded) && boardCount > 0;
}

/**
 * Which board «Δημιουργία» just made, from the list the server answered with:
 * one the screen had not seen, with the name that was typed — else the last
 * unseen one (a new board goes to the end). Not simply "the first unseen one":
 * a board made on another phone meanwhile is unseen too, and opening that
 * instead of yours reads as the app ignoring what you typed.
 */
export function pickCreatedBoard(seenBoards, answeredBoards, typedName) {
  const seen = new Set((seenBoards || []).map((b) => b.record_id));
  const fresh = (answeredBoards || []).filter((b) => !seen.has(b.record_id));
  const name = (typedName || '').trim();
  return fresh.find((b) => b.name === name) || fresh[fresh.length - 1] || null;
}

/**
 * The board and card this task sits on, or null. There is at most one per
 * person — the owner's «μία εργασία σε έναν πίνακα τη φορά».
 */
export function boardOfTask(boards, taskId) {
  for (const board of boards || []) {
    const card = (board.cards || []).find((c) => c.task_id === taskId);
    if (card) return { board, card };
  }
  return null;
}
