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
