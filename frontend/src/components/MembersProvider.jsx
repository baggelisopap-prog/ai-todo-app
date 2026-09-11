import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getWorkspaceMembers } from '../api';
import { MembersContext } from '../hooks/useMembers';
import { useWorkspaces } from '../hooks/useWorkspaces';

/**
 * One copy of "who is in each shared workspace", fetched once per room.
 *
 * WHY THIS EXISTS AT ALL: `tasks.assigned_to` is an id. Everything the screen
 * wants to say about a person — the initials on a row, the name in the
 * handover picker, the actor in the activity log — needs id → name, and
 * without somewhere shared to keep it, each of those asks the server for
 * itself. A list of three hundred rows cannot ask per row.
 *
 * IT FETCHES NOTHING ON A SOLO ACCOUNT. `member_count` rides along with the
 * workspaces themselves (one grouped query on the server, added 2026-09-11), so
 * the decision "is anybody else in here" is already made before this component
 * would otherwise have to ask. An account with no sharing issues zero requests
 * and never will.
 *
 * Nested INSIDE WorkspaceProvider, because that is where member_count comes
 * from. Sharing one provider instead would have meant the workspace list
 * refetching whenever a member changed, and a members refetch whenever a
 * category was renamed.
 */
export function MembersProvider({ children }) {
  const { workspaces } = useWorkspaces();
  const [byWorkspace, setByWorkspace] = useState({});

  // Rooms with somebody else in them. A one-member workspace is every solo
  // account, and its one member is you — a request whose answer we already
  // have.
  const sharedIds = useMemo(
    () => workspaces.filter((w) => (w.member_count ?? 1) > 1).map((w) => w.record_id),
    [workspaces]
  );
  // The effect's dependency, as a primitive. `sharedIds` is a fresh array on
  // every workspaces change — including a rename, which changes nothing here —
  // and depending on it directly would refetch every room each time.
  const sharedKey = sharedIds.join(',');

  // What has already been asked for, so a second render does not ask again and
  // a failed fetch does not retry forever. A ref rather than state: nothing on
  // screen depends on it, and putting it in state would re-render the whole
  // tree on each fetch starting.
  const requested = useRef(new Set());

  // Bumped by reload(). The effect keys off sharedKey, which does NOT change
  // when somebody joins an already-shared room — so without a second
  // dependency that changes on purpose, reload() would clear `requested` and
  // nothing would ever run again to refill it.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ids = sharedKey ? sharedKey.split(',') : [];
    let cancelled = false;
    ids.forEach((workspaceId) => {
      if (requested.current.has(workspaceId)) return;
      requested.current.add(workspaceId);
      getWorkspaceMembers(workspaceId)
        .then((data) => {
          if (cancelled) return;
          setByWorkspace((prev) => ({ ...prev, [workspaceId]: data.members || [] }));
        })
        // Silent, and deliberately so. Nobody asked for this list: it is the
        // raw material for an avatar. A toast about a failed members request,
        // on a screen the user opened to read their tasks, is noise about
        // something they cannot act on — the row simply draws no circle.
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [sharedKey, nonce]);

  const membersFor = useCallback(
    (workspaceId) => byWorkspace[workspaceId] || [],
    [byWorkspace]
  );

  const personFor = useCallback(
    (workspaceId, userId) => {
      if (!workspaceId || !userId) return null;
      return (byWorkspace[workspaceId] || []).find((m) => m.user_id === userId) || null;
    },
    [byWorkspace]
  );

  // From the server's own `is_me`, not from the session. Any fetched room
  // answers it and they all agree, so the first one found is enough.
  const myId = useMemo(() => {
    for (const members of Object.values(byWorkspace)) {
      const me = members.find((m) => m.is_me);
      if (me) return me.user_id;
    }
    return null;
  }, [byWorkspace]);

  const isShared = useCallback(
    (workspaceId) => sharedIds.includes(workspaceId),
    [sharedIds]
  );

  // Is ANY room shared. What the "Δικά μου / Όλα" control asks, because it also
  // has to appear on "Όλα" — where the list genuinely mixes workspaces and
  // there is no single active one to ask about.
  const hasAnyShared = sharedIds.length > 0;

  // After a join, a removal or a new workspace: forget what was asked so the
  // effect asks again. Clearing the rows too would blank every avatar for as
  // long as the round trip takes, so the old answer stays on screen until the
  // new one replaces it.
  const reload = useCallback(() => {
    requested.current = new Set();
    setNonce((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({ myId, membersFor, personFor, isShared, hasAnyShared, reload }),
    [myId, membersFor, personFor, isShared, hasAnyShared, reload]
  );

  return <MembersContext.Provider value={value}>{children}</MembersContext.Provider>;
}

export default MembersProvider;
