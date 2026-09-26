import { createContext, useContext } from 'react';

/**
 * The context holding this user's boards (2026-09-26). The provider that fills
 * it lives in components/BoardsProvider.jsx — split across two files for the
 * react-refresh reason useRecurrence.js gives.
 *
 * Reachable from anywhere for the reason useRecurrence is: the ⋯ menu that
 * offers «Στείλε σε πίνακα…» sits four components deep in every list, and it
 * must know whether the user HAS a board before it may show the item at all.
 *
 * Returns { boards, isLoaded, boardOf, openPicker, reload, ...actions } — see
 * the provider for each.
 */
export const BoardsContext = createContext(null);

export function useBoards() {
  const context = useContext(BoardsContext);
  if (!context) {
    throw new Error('useBoards must be used inside <BoardsProvider>');
  }
  return context;
}
