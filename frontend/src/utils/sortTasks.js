/**
 * How a list of tasks is ordered.
 *
 * Extracted from TaskList.jsx on 2026-09-04, because this logic had been
 * quietly wrong for months and nothing could have caught it: it ordered by
 * `created_time`, the Airtable-era column that is popped from both write paths
 * and has no database default, so it has never been written. Every "newest
 * first" list was sorting a column of nulls. Living inside a .jsx file, it
 * could not be reached by the plain-node checks in scripts/, so there was no
 * test that would have failed.
 *
 * The .js extension matters for the same reason it does in taskDisplay.js:
 * scripts/*.test.mjs import this under plain Node, which does not resolve
 * extensionless relative imports the way Vite does.
 */

/**
 * The old sort names, kept working.
 *
 * "newest" and "due_date" named a direction but not WHICH date, and the row
 * shows the due date while "newest" ordered by the creation date — so a
 * correctly sorted list looked shuffled, and a working sort was
 * indistinguishable from a broken one. The owner hit exactly that and
 * diagnosed it himself before being told. The canonical names below name both
 * halves; these aliases stay because InboxView, TodayView and UpcomingList
 * pass the old strings as fixed values.
 */
const SORT_ALIASES = {
  newest: 'created_desc',
  oldest: 'created_asc',
  due_date: 'due_asc',
};

export function resolveSort(sortBy) {
  return SORT_ALIASES[sortBy] || sortBy || 'created_desc';
}

/**
 * Whether this ordering is by creation date — i.e. whether the row should also
 * print "Μπήκε …", so the value being sorted is on screen. A sort you cannot
 * verify is a sort you cannot trust, which is how the null-column bug survived
 * as long as it did.
 */
export function sortsByCreation(sortBy) {
  return resolveSort(sortBy).startsWith('created');
}

/**
 * When a task was created. `created_at` is the database's own `default now()`
 * and is present on every row; `created_time` is kept only as a fallback so a
 * row that somehow carries one is still ordered by it rather than sinking.
 */
export function createdAt(task) {
  return task.created_at || task.created_time || null;
}

/**
 * Date.parse, not localeCompare: the two creation columns are not written in
 * the same offset — Postgres returns `created_at` in UTC while the app's own
 * timestamps are Athens-local — and ISO strings only sort correctly when their
 * offsets match.
 */
function compareCreatedTime(a, b, direction) {
  const at = createdAt(a);
  const bt = createdAt(b);
  if (!at && !bt) return 0;
  // A task whose creation date is unknown sinks whichever way the list runs:
  // "oldest first" must not be led by rows that are merely undated.
  if (!at) return 1;
  if (!bt) return -1;
  const result = Date.parse(at) - Date.parse(bt);
  return direction === 'desc' ? -result : result;
}

/**
 * Tasks with no due date go last in BOTH directions. Putting them first under
 * "latest due first" would open the list with everything that has no date at
 * all, which is not what "latest" means to anyone.
 */
function compareDueDate(a, b, direction) {
  if (!a.due_date && !b.due_date) return compareCreatedTime(a, b, 'desc');
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  // Plain string compare is safe here and only here: due_date is a bare
  // YYYY-MM-DD with no offset, unlike the timestamps above.
  const result = a.due_date.localeCompare(b.due_date);
  return direction === 'desc' ? -result : result;
}

function priorityRank(priority) {
  const ranks = { P1: 1, P2: 2, P3: 3 };
  return ranks[priority] || 99;
}

export function sortTasks(tasks, sortBy) {
  const copy = [...(tasks || [])];
  switch (resolveSort(sortBy)) {
    case 'created_asc':
      return copy.sort((a, b) => compareCreatedTime(a, b, 'asc'));
    case 'priority':
      return copy.sort((a, b) => {
        const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
        if (priorityDiff !== 0) return priorityDiff;
        return compareCreatedTime(a, b, 'desc');
      });
    case 'due_asc':
      return copy.sort((a, b) => compareDueDate(a, b, 'asc'));
    case 'due_desc':
      return copy.sort((a, b) => compareDueDate(a, b, 'desc'));
    case 'created_desc':
    default:
      return copy.sort((a, b) => compareCreatedTime(a, b, 'desc'));
  }
}

export default sortTasks;
