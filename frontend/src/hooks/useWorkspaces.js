import { createContext, useContext } from 'react';

/**
 * This user's workspaces and categories, and which one they are looking at.
 * The provider that fills it lives in components/WorkspaceProvider.jsx.
 *
 * Split across two files for the same reason useRecurrence.js and
 * useAppSettings.js are: a module exporting a component may export nothing
 * else, or react-refresh complains.
 */
export const WorkspaceContext = createContext(null);

/**
 * Returns { workspaces, categories, activeId, setActiveId, reload, categoriesFor }.
 *
 * - `activeId` — null means "Όλα", which is the default and INCLUDES unfiled
 *   tasks. Persisted through app_settings.active_workspace_id, so the phone
 *   and the laptop agree on where you were.
 * - `categoriesFor(workspaceId)` — that workspace's categories, in order.
 * - `reload()` — refetch the shared copy after any write.
 *
 * Reachable from anywhere on purpose: a task row is four components deep
 * (App → view → TaskList → TaskCard → TaskRow) and the calendar reaches
 * TaskCard by a different path, so threading this down would mean editing both
 * chains and every component in between. The same problem, and the same
 * answer, as RecurrenceProvider.
 */
export function useWorkspaces() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspaces must be used inside <WorkspaceProvider>');
  }
  return context;
}
