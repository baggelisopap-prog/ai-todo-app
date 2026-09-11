/**
 * Narrowing a shared list to one person's work.
 *
 * THE WHOLE POINT OF THIS FILE IS THAT "MINE" HAS EXACTLY ONE DEFINITION.
 *
 * The backend already has one, in repository.get_owned_or_assigned_tasks — the
 * read that feeds every reminder, the daily summary and the agent's day view:
 *
 *     assigned_to.eq.ME  OR  and(user_id.eq.ME, assigned_to.is.null)
 *
 * "Assigned to me, OR created by me and taken by nobody." The second arm is
 * load-bearing in both directions: a task I created and then handed over is
 * THEIRS, and a task in a shared room that nobody has taken is its creator's
 * and nobody else's.
 *
 * If this screen defined it as merely "assigned to me", the agent would answer
 * «21» to «τι έχω σήμερα» while the list beside it showed 18, and the
 * difference would be invisible — no error, nothing missing, just two numbers
 * that disagree. That reads as a bug in both, and nobody could tell which.
 *
 * Runs in the browser on the list already fetched. Filtering by asking the
 * server again would be a round trip per tap of a segmented control.
 */
export const ASSIGNMENT_ALL = 'all';
export const ASSIGNMENT_MINE = 'mine';
export const ASSIGNMENT_UNASSIGNED = 'unassigned';

export function filterTasksByAssignment(tasks, mode, myId) {
  const list = tasks || [];
  // Without an id there is no "mine" to compute. It arrives with the members
  // of the first shared workspace, so this is the state before that lands —
  // and showing the WHOLE list for a moment is the right failure: it shows too
  // much briefly rather than hiding work that is yours.
  if (mode === ASSIGNMENT_ALL || !mode) return list;
  if (mode === ASSIGNMENT_MINE && !myId) return list;

  if (mode === ASSIGNMENT_UNASSIGNED) {
    // Anybody's untaken work, including my own. This is the pile, and the
    // question it answers — "what has nobody picked up" — is the one a team
    // actually asks, so it must not be secretly narrowed to my own creations.
    return list.filter((task) => !task.assigned_to);
  }

  return list.filter(
    (task) => task.assigned_to === myId || (!task.assigned_to && task.created_by === myId)
  );
}
