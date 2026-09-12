import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getWorkspaces } from '../api';
import { WorkspaceContext } from '../hooks/useWorkspaces';
import { categoriesForWorkspace, UNFILED } from '../utils/workspaces';

/**
 * One copy of this user's workspaces and categories, fetched once.
 *
 * Modelled on RecurrenceProvider, for the same reason: several components at
 * different depths need the same list, and threading it through App → view →
 * TaskList → TaskCard → TaskRow means editing every component in between.
 *
 * THE ACTIVE WORKSPACE IS NO LONGER REMEMBERED, and that is a decision the
 * owner made on 2026-09-12, reversing his own earlier one. It used to be
 * persisted through `app_settings.active_workspace_id`, so switching to
 * Business on the phone was still Business on the laptop — the workspace was
 * "where you live". His words: «να ειναι by default παντα στο ολα και να
 * κανεις επιλογη αν και μονο θελεις να δεις μονο ενα χωρο αλλα μετα να μην
 * μενει ετσι — μονο φιλτρο ουσιαστικα ο χωρος».
 *
 * So it is a filter now, and it obeys the same rule as the other three: it
 * lives while the app is open and every launch starts on «Όλα». One rule for
 * all four, which is the end of "which of these controls remembers?" — the
 * question that started this whole piece of work.
 *
 * `app_settings.active_workspace_id` is left in the database, written by
 * nobody and read by nobody, exactly like `tasks.category`. Dropping a column
 * cannot be undone and it costs nothing where it sits.
 * `default_workspace_id` is a DIFFERENT setting and stays live: it is where a
 * task goes when you add one from «Όλα», which is now almost every add.
 */
export function WorkspaceProvider({ children, onShowToast }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [categories, setCategories] = useState([]);

  // null is «Όλα», and it is where every launch begins.
  const [activeId, setActiveId] = useState(null);

  // Held in a ref rather than read from the closure: onShowToast arrives as a
  // fresh function identity on every render of App, and `reload` is the mount
  // effect's only dependency — depending on it directly would refetch on every
  // keystroke that re-renders the tree above. Same reason, same shape, as
  // RecurrenceProvider.
  const onShowToastRef = useRef(onShowToast);
  useEffect(() => { onShowToastRef.current = onShowToast; }, [onShowToast]);

  // A .then() chain rather than an async function, so the setState calls sit in
  // their own callbacks and react-hooks/set-state-in-effect stays quiet when
  // the mount effect below calls this.
  const reload = useCallback(() => {
    return getWorkspaces()
      .then((data) => {
        setWorkspaces(data.workspaces || []);
        setCategories(data.categories || []);
      })
      .catch((err) => onShowToastRef.current?.(err.message, 'error'));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const categoriesFor = useCallback(
    (workspaceId) => categoriesForWorkspace(categories, workspaceId),
    [categories]
  );

  // If the active workspace stops existing — archived on another device while
  // you are looking at it — fall back to «Όλα» rather than filtering against an
  // id nothing matches, which would render every screen empty with no way to
  // tell why. UNFILED is accepted alongside the real ids: it is a legitimate
  // position, not a stale one, and without it here the picker would deselect
  // itself on every render.
  const resolvedActiveId = useMemo(
    () => (activeId === UNFILED || workspaces.some((w) => w.record_id === activeId)
      ? activeId : null),
    [workspaces, activeId]
  );

  const value = useMemo(
    () => ({
      workspaces,
      categories,
      activeId: resolvedActiveId,
      setActiveId,
      reload,
      categoriesFor,
    }),
    [workspaces, categories, resolvedActiveId, reload, categoriesFor]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export default WorkspaceProvider;
