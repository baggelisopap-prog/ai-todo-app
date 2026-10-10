import { isVisibleTask, isClosedForMe, isRunning } from './taskDisplay.js';

/**
 * The piles Today shows, from one list of tasks.
 *
 * Moved out of TodayView.jsx on 2026-10-10 so scripts/today-piles.test.mjs can
 * reach it under plain Node; it is run TWICE there — once over the filtered
 * list for what to draw, and once over the unfiltered one to answer "how much
 * is the filter hiding". Without the second number an empty day says "Τίποτα
 * για σήμερα 🎉" while the work sits behind a forgotten P1.
 *
 * `awaitingReplyIds` — «Περιμένουν απάντηση» (2026-10-10). The guest messages
 * that keep ringing this person's phone until the guest is answered, as the
 * SERVER lists them: GET /tasks → awaiting_reply_ids is the escalation loop's
 * own list, so this screen never decides for itself what rings. The owner was
 * reminded every two hours about an invoice request he had moved to the
 * check-out day, and it was on no screen he looked at. They go here whatever
 * their date, and leave every other pile — one task, one row, because two rows
 * would open two sheets. Approved ones only: an unapproved guest message rings
 * too, but it lives in the Inbox with its approve button, and under «σε αναμονή
 * έγκρισης» here when it is due today.
 */
export function splitByDay(list, today, myId, awaitingReplyIds = []) {
  // isClosedForMe rather than !is_completed: a task a colleague closed stays on
  // this screen, struck through, until its creator or its assignee presses OK.
  // Every other completion — mine, and every one made before 2026-09-17 —
  // answers exactly as !is_completed did.
  const open = list.filter(
    (task) => task.approval_status && !isClosedForMe(task, myId) && isVisibleTask(task)
  );
  const ringing = new Set(awaitingReplyIds);
  // The server's list can be a minute old, so a task closed since must still
  // leave at once — which `open` above already sees to.
  const quiet = open.filter((task) => !ringing.has(task.record_id));
  return {
    awaiting: open.filter((task) => ringing.has(task.record_id)),
    today: quiet.filter((task) => task.due_date === today),
    overdue: quiet.filter((task) => task.due_date && task.due_date < today),
    // Started, due later (2026-09-26): the reason a start date exists at all.
    running: quiet.filter((task) => isRunning(task, today)),
    pending: list.filter(
      (task) => task.due_date === today && !task.approval_status && isVisibleTask(task)
    ),
  };
}

export const countAll = (piles) =>
  piles.awaiting.length + piles.today.length + piles.overdue.length +
  piles.pending.length + piles.running.length;
