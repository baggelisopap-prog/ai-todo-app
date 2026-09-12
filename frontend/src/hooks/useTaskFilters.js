import { createContext, useContext } from 'react';

/**
 * The category / priority / whose filters, shared by every task screen.
 * The provider that fills it lives in components/TaskFilterProvider.jsx.
 *
 * Split across two files for the same reason useWorkspaces.js and
 * useMembers.js are: a module exporting a component may export nothing else
 * without tripping react-refresh.
 */
export const TaskFilterContext = createContext(null);

/**
 * Returns { filters, setFilter, clearOne, clearAll, activeCount, chips,
 *           categoryOptions, showCategory, showAssignment, apply }.
 *
 * - `filters` — what is IN FORCE here, already resolved against the active
 *   workspace. Not the same thing as what is stored: a category belongs to one
 *   workspace and "Δικά μου" needs somebody else in the room, so a stored
 *   value that cannot apply simply does not, rather than filtering invisibly.
 *   See utils/taskFilters.js, which owns that rule.
 * - `apply(tasks)` — the list narrowed by all three. Every screen calls this
 *   instead of spelling the chain out itself, which is how Today and Browse
 *   came to disagree about what a task with no priority is.
 * - `chips` — the active filters as removable labels. This is the only visible
 *   record that anything is being hidden, so it is built from the same words
 *   the controls use.
 *
 * Throws outside a provider, like useWorkspaces and unlike useMembers: the
 * four screens are the only callers and they are always inside it, so a silent
 * empty shape here would mean a screen quietly ignoring the user's filters.
 */
export function useTaskFilters() {
  const context = useContext(TaskFilterContext);
  if (!context) {
    throw new Error('useTaskFilters must be used inside <TaskFilterProvider>');
  }
  return context;
}
