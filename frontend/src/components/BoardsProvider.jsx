import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getBoards,
  createBoard,
  renameBoard,
  deleteBoard,
  addBoardColumn,
  updateBoardColumn,
  deleteBoardColumn,
  sendTaskToBoard,
  removeTaskFromBoard,
  moveBoardCard,
  createBoardCard,
} from '../api';
import { BoardsContext } from '../hooks/useBoards';
import { boardOfTask } from '../utils/boards';
import OptionSheet from './OptionSheet';

const REMOVE = '__remove__';

/**
 * The user's boards, held once for the whole app, and the one «Στείλε σε
 * πίνακα…» sheet (2026-09-26).
 *
 * WHY ONE COPY. Two readers need the same list: the Boards screen, and every
 * task's ⋯ menu — which may only show «Στείλε σε πίνακα…» when the user has a
 * board at all (the owner's rule: whoever does not use boards sees nothing
 * new), and which marks the board a task is already on. One fetch at app open,
 * then every write replaces the list with the server's answer — each board
 * endpoint returns the whole list for exactly this reason.
 *
 * WHY THE SHEET LIVES HERE, like RecurrenceModal in RecurrenceProvider: a sheet
 * opened from inside a task row would be clipped by the row's overflow-hidden.
 *
 * `onTaskChanged(task)` folds a task the server hands back into App's list: a
 * card dropped on «Έγινε» COMPLETES the task, and «Νέα κάρτα» creates one, and
 * Today must know at once.
 */
function BoardsProvider({ children, onShowToast, onTaskChanged }) {
  const { t } = useTranslation();
  const [boards, setBoards] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [pickerTask, setPickerTask] = useState(null);

  // Refs, for the reason RecurrenceProvider gives: fresh identities from App on
  // every render must not make `reload` — the mount effect's dependency — new.
  const toastRef = useRef(onShowToast);
  const taskChangedRef = useRef(onTaskChanged);
  useEffect(() => { toastRef.current = onShowToast; }, [onShowToast]);
  useEffect(() => { taskChangedRef.current = onTaskChanged; }, [onTaskChanged]);

  const reload = useCallback(() => {
    return getBoards()
      .then((data) => setBoards(data.boards || []))
      .catch((err) => console.error('Failed to load boards:', err))
      .finally(() => setIsLoaded(true));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  /**
   * Every write the same way: call, take the server's list, and on failure say
   * so and re-throw — so a caller holding a draft (a column name being typed)
   * can keep it instead of losing it to an error it never saw.
   */
  const run = useCallback(async (call) => {
    try {
      const data = await call();
      if (data?.boards) setBoards(data.boards);
      if (data?.task) taskChangedRef.current?.(data.task);
      return data;
    } catch (err) {
      toastRef.current?.({ message: err.message, variant: 'error' });
      throw err;
    }
  }, []);

  const actions = useMemo(() => ({
    create: (name) => run(() => createBoard(name, [
      t('boards.default_todo'), t('boards.default_doing'), t('boards.default_done'), t('boards.default_dropped'),
    ])),
    rename: (boardId, name) => run(() => renameBoard(boardId, name)),
    remove: (boardId) => run(() => deleteBoard(boardId)),
    addColumn: (boardId, name) => run(() => addBoardColumn(boardId, name)),
    renameColumn: (boardId, columnId, name) => run(() => updateBoardColumn(boardId, columnId, { name })),
    moveColumn: (boardId, columnId, direction) => run(() => updateBoardColumn(boardId, columnId, { direction })),
    deleteColumn: (boardId, columnId) => run(() => deleteBoardColumn(boardId, columnId)),
    send: (boardId, taskId) => run(() => sendTaskToBoard(boardId, taskId)),
    removeCard: (boardId, taskId) => run(() => removeTaskFromBoard(boardId, taskId)),
    moveCard: (boardId, taskId, columnId, reason) => run(() => moveBoardCard(boardId, taskId, columnId, reason)),
    createCard: (boardId, columnId, taskName, workspaceId) =>
      run(() => createBoardCard(boardId, columnId, taskName, workspaceId)),
  }), [run, t]);

  const boardOf = useCallback((taskId) => boardOfTask(boards, taskId), [boards]);

  const value = useMemo(() => ({
    boards,
    isLoaded,
    reload,
    boardOf,
    // Only a task that can go on a board opens the sheet — the menu hides the
    // item otherwise, and this is the second lock on the same door.
    openPicker: (task) => { if (task?.record_id) setPickerTask(task); },
    ...actions,
  }), [boards, isLoaded, reload, boardOf, actions]);

  const current = pickerTask ? boardOf(pickerTask.record_id) : null;

  async function handlePick(value) {
    const task = pickerTask;
    setPickerTask(null);
    try {
      if (value === REMOVE) {
        await actions.removeCard(current.board.record_id, task.record_id);
        toastRef.current?.({ message: t('boards.removed_toast', { board: current.board.name }), variant: 'success' });
      } else if (!current || current.board.record_id !== value) {
        await actions.send(value, task.record_id);
        const name = boards.find((b) => b.record_id === value)?.name || '';
        toastRef.current?.({ message: t('boards.sent_toast', { board: name }), variant: 'success' });
      }
    } catch {
      // run() has already said what went wrong.
    }
  }

  return (
    <BoardsContext.Provider value={value}>
      {children}
      {pickerTask && (
        <OptionSheet
          title={t('boards.send_title')}
          value={current?.board.record_id}
          options={[
            ...boards.map((board) => ({ value: board.record_id, label: board.name })),
            ...(current ? [{ value: REMOVE, label: t('boards.remove_from', { board: current.board.name }) }] : []),
          ]}
          onPick={handlePick}
          onClose={() => setPickerTask(null)}
        />
      )}
    </BoardsContext.Provider>
  );
}

export default BoardsProvider;
