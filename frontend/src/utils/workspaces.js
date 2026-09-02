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
 * Where a newly created item goes: after the highest position, not after the
 * count. Deleting the middle of a list leaves gaps, so a count-based answer
 * would collide with an existing row and make the order arbitrary.
 */
export function nextPosition(items) {
  const list = items || [];
  if (list.length === 0) return 0;
  return Math.max(...list.map((item) => item.position ?? 0)) + 1;
}
