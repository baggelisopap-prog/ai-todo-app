import { createContext, useContext } from 'react';

/**
 * Who is in each shared workspace, fetched once and read from everywhere.
 * The provider that fills it lives in components/MembersProvider.jsx.
 *
 * Split across two files for the same reason useWorkspaces.js and
 * useRecurrence.js are: a module exporting a component may export nothing else
 * without tripping react-refresh.
 */
export const MembersContext = createContext(null);

/**
 * Returns { myId, membersFor, personFor, isShared, hasAnyShared, reload }.
 *
 * The problem it solves: `tasks.assigned_to` holds an ID, not a name. A task
 * row that wants to show WHO HAS THIS would otherwise have to ask the server
 * per row, and a list is three hundred rows long.
 *
 * - `isShared(workspaceId)` — is there anybody else in that room at all.
 *   Answered from `member_count`, which arrives with the workspaces themselves,
 *   so it costs nothing and is known before any members request is made. Every
 *   piece of UI about other people is hidden when this is false: on a solo
 *   account your own initials on all 340 tasks are noise, not information.
 * - `personFor(workspaceId, userId)` — that member's row, or null while the
 *   fetch is in flight or if they have since left.
 * - `myId` — this user's own id, taken from the `is_me` flag the server sets
 *   rather than from the session. The server already knows who asked; reading
 *   the session here would be a second source of truth for "who am I".
 *
 * Used outside a provider it returns a SAFE EMPTY SHAPE instead of throwing,
 * unlike useWorkspaces. TaskRow is rendered by tests and by the calendar
 * popup through paths that do not wrap it, and a crash there would be a blank
 * screen in exchange for an avatar.
 */
const EMPTY = {
  myId: null,
  membersFor: () => [],
  personFor: () => null,
  isShared: () => false,
  hasAnyShared: false,
  reload: () => {},
};

export function useMembers() {
  return useContext(MembersContext) || EMPTY;
}
