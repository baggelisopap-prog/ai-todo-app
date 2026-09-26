import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalBehavior } from '../hooks/useModalBehavior';
import { useBoards } from '../hooks/useBoards';
import { useConfirm } from '../hooks/useConfirm';
import { orderedColumns } from '../utils/boards';
import ConfirmDialog from './ConfirmDialog';

/**
 * «Στήλες» — shaping a board's columns (2026-09-26).
 *
 * The owner's rule, which is the whole layout of this sheet: the open columns
 * are his to rename, add, reorder and delete; «Έγινε» and «Ακυρώθηκε» can be
 * RENAMED and nothing else, because they change the task itself. So the two
 * endings sit at the bottom, say what they do in one line each, and have no
 * arrows and no delete.
 *
 * Arrows rather than dragging, deliberately: this is a sheet opened a few times
 * in a board's life, and two arrow buttons are exact on a phone where a drag
 * inside a scrolling sheet is not.
 *
 * A rename is saved when the box loses focus or on Enter — no Save button per
 * row, which on five columns would be five buttons for one idea.
 */
function BoardColumnsSheet({ board, onClose }) {
  useModalBehavior(onClose);
  const { t } = useTranslation();
  const { addColumn, renameColumn, moveColumn, deleteColumn } = useBoards();
  const confirm = useConfirm();
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const columns = orderedColumns(board.columns);
  const openCount = columns.filter((c) => c.kind === 'open').length;

  async function guarded(fn) {
    setBusy(true);
    try { await fn(); } catch { /* the provider has shown the error */ } finally { setBusy(false); }
  }

  function commitRename(column, value) {
    const name = value.trim();
    if (!name || name === column.name) return;
    guarded(() => renameColumn(board.record_id, column.record_id, name));
  }

  async function handleDelete(column) {
    const ok = await confirm.ask({
      title: t('boards.column_delete_title', { name: column.name }),
      body: t('boards.column_delete_body'),
      confirmLabel: t('actions.delete'),
    });
    if (ok) guarded(() => deleteColumn(board.record_id, column.record_id));
  }

  function handleAdd(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    guarded(async () => {
      await addColumn(board.record_id, name);
      setNewName('');
    });
  }

  // The confirm sits OUTSIDE the backdrop: a portal keeps React's bubbling, so
  // inside it a tap beside the question would also close this sheet.
  return (
    <>
    <div
      className="fixed inset-0 z-50 bg-black/40 animate-fade-in flex items-end md:items-center justify-center md:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('boards.columns_title')}
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-md bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('boards.columns_title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="tap-44 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {t('actions.close')}
          </button>
        </div>

        <ul className="overflow-y-auto px-4 pb-2 space-y-2">
          {columns.map((column, index) => {
            const isOpen = column.kind === 'open';
            return (
              <li key={column.record_id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2">
                <div className="flex items-center gap-1.5">
                  <input
                    // key on the name, so a rename that failed or a refetch
                    // re-seeds the box instead of keeping a stale draft.
                    key={column.name}
                    defaultValue={column.name}
                    maxLength={40}
                    disabled={busy}
                    aria-label={t('boards.column_name')}
                    onBlur={(e) => commitRename(column, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    className="flex-1 min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-[var(--text-primary)] hover:border-[var(--border-subtle)] focus:border-[var(--brand-primary)] focus:outline-none"
                  />
                  {isOpen && (
                    <>
                      <button
                        type="button"
                        onClick={() => guarded(() => moveColumn(board.record_id, column.record_id, -1))}
                        disabled={busy || index === 0}
                        aria-label={t('boards.column_left')}
                        className="tap-44 w-7 h-7 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => guarded(() => moveColumn(board.record_id, column.record_id, 1))}
                        disabled={busy || index === openCount - 1}
                        aria-label={t('boards.column_right')}
                        className="tap-44 w-7 h-7 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(column)}
                        disabled={busy || openCount <= 1}
                        aria-label={t('boards.column_delete_title', { name: column.name })}
                        className="tap-44 w-7 h-7 rounded text-[var(--danger-text)] hover:bg-[var(--danger-bg)] disabled:opacity-30"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
                {!isOpen && (
                  <p className="px-2 pt-0.5 text-xs text-[var(--text-muted)]">
                    {column.kind === 'done' ? t('boards.column_done_hint') : t('boards.column_dropped_hint')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <form onSubmit={handleAdd} className="flex gap-2 px-4 pt-2 pb-4 border-t border-[var(--border-subtle)]">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={40}
            placeholder={t('boards.column_new_placeholder')}
            aria-label={t('boards.column_new_placeholder')}
            className="flex-1 min-w-0 rounded-md border border-[var(--border-medium)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand-primary)]"
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="tap-44 px-3 py-2 rounded-md text-sm font-medium text-white bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] disabled:opacity-50"
          >
            {t('boards.column_add')}
          </button>
        </form>
      </div>
    </div>
    <ConfirmDialog request={confirm.request} onAnswer={confirm.onAnswer} />
    </>
  );
}

export default BoardColumnsSheet;
