/**
 * Every decision the workspace UI makes, as pure functions.
 *
 * They live here rather than inside the components for one practical reason:
 * this project has no React test runner, and `frontend/scripts/*.test.mjs` can
 * import a plain module but cannot render a component. Logic left in a
 * component is logic nothing can check.
 */

/**
 * The value both filters use for "has none".
 *
 * A sentinel rather than null, because null already means "no filter at all"
 * in these controls — and "show me everything" and "show me the ones nobody
 * filed" are opposite requests. Prefixed so it can never collide with a uuid.
 */
export const UNFILED = '__unfiled__';

/**
 * The task list narrowed to one workspace.
 *
 * `activeId` null means "Όλα", and that deliberately INCLUDES unfiled tasks —
 * a task with no workspace is still the user's work and must never disappear
 * because they have not made a choice. UNFILED asks for the opposite: only
 * the ones with no workspace, which is where anything the AI could not place
 * goes to be found.
 */
export function filterTasksByWorkspace(tasks, activeId) {
  const list = tasks || [];
  if (!activeId) return list;
  if (activeId === UNFILED) return list.filter((task) => !task.workspace_id);
  return list.filter((task) => task.workspace_id === activeId);
}

/** The task list narrowed to one category, or to the ones with none. */
export function filterTasksByCategory(tasks, categoryId) {
  const list = tasks || [];
  if (!categoryId) return list;
  if (categoryId === UNFILED) return list.filter((task) => !task.category_id);
  return list.filter((task) => task.category_id === categoryId);
}

/**
 * How much live work sits in each workspace, plus the two synthetic rows.
 *
 * For the room picker in the app bar: "Business 212" answers the question that
 * makes someone choose a room in the first place. Counted over whatever list
 * the caller hands in — App scopes it to live, uncompleted tasks — rather than
 * over everything, because a picker promising 212 things to do and delivering
 * a pile of finished ones would be worse than no number.
 *
 * Keyed the same way the picker's values are: 'all' for «Όλα», UNFILED for the
 * unfiled pile, and the workspace id for a real room.
 */
export function countByWorkspace(tasks, workspaces) {
  const list = tasks || [];
  const counts = {
    all: list.length,
    [UNFILED]: list.filter((task) => !task.workspace_id).length,
  };
  for (const workspace of workspaces || []) {
    counts[workspace.record_id] = list.filter(
      (task) => task.workspace_id === workspace.record_id
    ).length;
  }
  return counts;
}

/** One workspace's categories, in the order the user arranged them. */
export function categoriesForWorkspace(categories, workspaceId) {
  if (!workspaceId) return [];
  return (categories || [])
    .filter((category) => category.workspace_id === workspaceId)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * The one-line placement shown on a task row: "Business · γραφείο".
 *
 * Both lookups fall back rather than printing undefined. A task can outlive
 * the workspace or category it pointed at — the database sets those columns to
 * NULL on delete, but a row already in the browser's memory still holds the old
 * id until the next fetch, and that window is exactly when this renders.
 */
export function describePlacement(task, workspaces, categories, t) {
  const workspace = (workspaces || []).find((w) => w.record_id === task?.workspace_id);
  if (!workspace) return t('workspace.unfiled');

  const category = (categories || []).find((c) => c.record_id === task?.category_id);
  return category ? `${workspace.name} · ${category.name}` : workspace.name;
}

/**
 * The same two facts as describePlacement, but NOT joined into a sentence.
 *
 * A task row draws them differently now: the workspace is a tinted pill in its
 * own colour, and the category is plain text beside it that may be truncated
 * when the line is full. One string cannot express that — the row needs to know
 * where the workspace ends, and it needs the colour, which the sentence throws
 * away.
 *
 * describePlacement stays as it is and keeps its callers: a sentence is still
 * the right shape everywhere the placement is READ rather than scanned.
 *
 * Returns `{ workspace, categoryName }`; `workspace` is the row object (so the
 * caller gets its colour) or null when the task is unfiled.
 */
export function placementParts(task, workspaces, categories) {
  const workspace = (workspaces || []).find((w) => w.record_id === task?.workspace_id) || null;
  if (!workspace) return { workspace: null, categoryName: null };
  const category = (categories || []).find((c) => c.record_id === task?.category_id);
  return { workspace, categoryName: category ? category.name : null };
}

/**
 * The categories a RECURRENCE may go under in this workspace: all of them but
 * the one an integration owns. A hand-made daily task inside Hostaway would be
 * escalated as a guest message every two hours, and the server refuses it
 * (main.py, _check_rule_placement) — so the form never offers it.
 */
export function ruleCategoriesForWorkspace(categories, workspaceId) {
  return categoriesForWorkspace(categories, workspaceId).filter((category) => !category.system_key);
}

/**
 * Where a recurrence form opens pointing (2026-09-26). Until then it offered
 * the four old category words, which file nothing, and every occurrence of
 * the owner's «Χάπι end» landed unfiled although he had picked «Προσωπικά».
 *
 *   editing a rule        -> where the rule already goes
 *   «make THIS repeat»    -> where that task already lives
 *   a rule from scratch   -> the workspace on screen, else the default one
 *
 * Anything that no longer resolves — an archived room, a deleted category, the
 * integration's category — falls back to less rather than to a stale id the
 * select cannot show. Returns { workspaceId, categoryId }, '' meaning unfiled.
 */
export function initialRulePlacement({ rule, task, activeId, defaultWorkspaceId, workspaces, categories }) {
  const known = (id) => Boolean(id) && (workspaces || []).some((w) => w.record_id === id);
  const source = rule || task;
  let workspaceId = '';
  if (source) {
    workspaceId = known(source.workspace_id) ? source.workspace_id : '';
  } else if (activeId !== UNFILED && known(activeId)) {
    workspaceId = activeId;
  } else if (known(defaultWorkspaceId)) {
    workspaceId = defaultWorkspaceId;
  }
  const categoryId = workspaceId && source
    && ruleCategoriesForWorkspace(categories, workspaceId).some((c) => c.record_id === source.category_id)
    ? source.category_id
    : '';
  return { workspaceId, categoryId };
}

/**
 * Where a newly created item goes: after the highest position, not after the
 * count. Deleting the middle of a list leaves gaps, so a count-based answer
 * would collide with an existing row and make the order arbitrary.
 */
export function nextPosition(items) {
  const list = items || [];
  if (list.length === 0) return 0;
  return Math.max(...list.map((item) => item.position ?? 0)) + 1;
}
