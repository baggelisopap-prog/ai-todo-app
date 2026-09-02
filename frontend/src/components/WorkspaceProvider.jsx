import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getWorkspaces } from '../api';
import { WorkspaceContext } from '../hooks/useWorkspaces';
import { useAppSettings } from '../hooks/useAppSettings';
import { categoriesForWorkspace, UNFILED } from '../utils/workspaces';

/**
 * One copy of this user's workspaces and categories, fetched once.
 *
 * Modelled on RecurrenceProvider, for the same reason: several components at
 * different depths need the same list, and threading it through App → view →
 * TaskList → TaskCard → TaskRow means editing every component in between.
 *
 * The active selection is persisted through app_settings rather than
 * localStorage, so switching to Business on the phone is still Business on the
 * laptop. It is applied optimistically — the chip must not wait for a round
 * trip before it looks pressed.
 */
export function WorkspaceProvider({ children, onShowToast }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [categories, setCategories] = useState([]);

  const { settings, updateSettings } = useAppSettings();

  // THREE states, not two, and they are genuinely different facts:
  //   undefined — the user has not touched the switcher this session, so the
  //               stored choice wins.
  //   null      — they deliberately chose "Όλα".
  //   an id     — that workspace.
  // Collapsing the first two would let a stored "Business" override an explicit
  // tap on "Όλα" the moment any other setting changed.
  const [chosenId, setChosenId] = useState(undefined);

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

  // DERIVED, not copied into state by an effect. Copying it would mean a
  // setState inside useEffect — the cascading-render pattern this project's
  // lint rule already flags twelve times elsewhere — plus a ref to remember
  // whether the copy had happened yet. Deriving needs neither.
  const activeId = chosenId !== undefined ? chosenId : (settings?.active_workspace_id ?? null);

  const setActiveId = useCallback((id) => {
    setChosenId(id); // optimistic: the chip presses immediately
    // updateSettings merges into the whole settings object before sending, so
    // this cannot blank the other fields. It is a no-op while settings are
    // still loading, which costs the memory of a very early tap and nothing else.
    updateSettings({ active_workspace_id: id })?.catch?.(() => {
      // A failed write costs the memory of the choice, not the choice itself.
      // Reverting the chip the user just pressed would be the worse outcome.
    });
  }, [updateSettings]);

  const categoriesFor = useCallback(
    (workspaceId) => categoriesForWorkspace(categories, workspaceId),
    [categories]
  );

  // If the active workspace no longer exists — deleted here or on another
  // device — fall back to "Όλα" rather than filtering against an id nothing
  // matches, which would render every screen empty with no way to tell why.
  // UNFILED is accepted alongside the real ids: it is a legitimate position,
  // not a stale one, and without it here the chip would deselect itself on
  // every render.
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
    [workspaces, categories, resolvedActiveId, setActiveId, reload, categoriesFor]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export default WorkspaceProvider;
