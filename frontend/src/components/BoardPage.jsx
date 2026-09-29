import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBoards } from '../hooks/useBoards';
import { pickCreatedBoard } from '../utils/boards';
import { useConfirm } from '../hooks/useConfirm';
import KebabMenu from './KebabMenu';
import OptionSheet from './OptionSheet';
import NameDialog from './NameDialog';
import ConfirmDialog from './ConfirmDialog';
import BoardDetail from './BoardDetail';
import BoardColumnsSheet from './BoardColumnsSheet';
import BoardActivityPanel from './BoardActivityPanel';

const NEW_BOARD = '__new__';

/**
 * A board as its own page (2026-09-29 — proposal 1 of the redesign, the
 * owner's «βάλτο τώρα όπως το 1»).
 *
 * WHY A PAGE. The board used to sit under three bars that belong to other
 * screens — the room picker, «Όλα»'s tabs, a row of board chips — and none of
 * them did anything in there. Trello, Jira and Todoist all open a board as a
 * destination: you go in, work, come back. So this page brings its own bar
 * (‹ back, the board's name with ▾ to jump to another board, ⋯ for the board
 * itself) and App draws neither its AppBar nor the AskBar while it is open:
 *
 *   - no room picker, because a board shows every card on it whatever room the
 *     switcher says (a hand-picked set; hiding half of it would look like
 *     cards had gone missing) — so a coloured «Business» bar over it was a
 *     filter that did not filter;
 *   - no «Ρώτα με ό,τι θες…», because the assistant does not see boards at
 *     all, by the owner's decision. A board assistant is parked for later.
 *
 * The bottom navigation stays. Leaving for Today and coming back lands here
 * again; pressing «Όλα» while here goes back to the list (App remembers which
 * board is open).
 *
 * Lazy-loaded from App: it brings drag-and-drop (@dnd-kit) with it for the
 * computer's columns, and most opens of the app never reach a board.
 */
function BoardPage({ boardId, tasks, onBack, onOpenBoard, onTaskUpdate, onTaskDeleted, onShowToast, onTaskAcknowledged }) {
  const { t } = useTranslation();
  const { boards, isLoaded, create, rename, remove } = useBoards();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState(null); // 'switch' | 'new' | 'rename' | 'columns' | 'history'

  const board = boards.find((b) => b.record_id === boardId) || null;

  // A board deleted elsewhere (another device), or remembered from a session
  // it no longer exists in: back to the list rather than an empty page.
  useEffect(() => {
    if (isLoaded && !board) onBack();
  }, [isLoaded, board, onBack]);

  async function handleCreate(name) {
    const data = await create(name);
    const created = pickCreatedBoard(boards, data?.boards, name);
    if (created) onOpenBoard(created.record_id);
  }

  async function handleDelete() {
    const ok = await confirm.ask({
      title: t('boards.delete_title', { name: board.name }),
      body: t('boards.delete_body'),
      confirmLabel: t('actions.delete'),
    });
    if (!ok) return;
    try {
      await remove(board.record_id);
      onBack();
    } catch {
      // Said by the provider.
    }
  }

  if (!isLoaded) {
    return <p className="p-4 text-sm italic text-[var(--text-muted)]">{t('app.loading')}</p>;
  }
  if (!board) return null;

  return (
    <div>
      {/* The page's own bar, in AppBar's shape and height (h-14 + a 2px rule
          = 58px — the phone's column chips stick directly under it). */}
      <header className="sticky top-0 z-30 bg-[var(--bg-card)] border-b-2 border-[var(--border-subtle)]">
        <div className="flex items-center gap-1 h-14 pl-2 pr-3 lg:px-4">
          <button
            type="button"
            onClick={onBack}
            aria-label={t('boards.back')}
            className="tap-44 w-9 h-9 flex items-center justify-center rounded-lg text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setDialog('switch')}
            aria-label={t('boards.switch_title')}
            className="flex-1 min-w-0 flex items-center gap-1 px-1 py-1 rounded-lg text-left hover:bg-[var(--bg-hover)]"
          >
            <span className="truncate text-[17px] font-semibold text-[var(--text-primary)]">{board.name}</span>
            <svg className="w-4 h-4 flex-shrink-0 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <KebabMenu
            ariaLabel={t('boards.board_menu')}
            items={[
              { key: 'rename', label: t('boards.rename'), onClick: () => setDialog('rename') },
              { key: 'columns', label: t('boards.columns_title'), onClick: () => setDialog('columns') },
              { key: 'history', label: t('boards.history'), onClick: () => setDialog('history') },
              { key: 'delete', label: t('boards.delete'), onClick: handleDelete, danger: true, separator: true },
            ]}
          />
        </div>
      </header>

      <div className="px-4 pb-4 lg:p-6">
        <BoardDetail
          key={board.record_id}
          board={board}
          tasks={tasks}
          onTaskUpdate={onTaskUpdate}
          onTaskDeleted={onTaskDeleted}
          onShowToast={onShowToast}
          onTaskAcknowledged={onTaskAcknowledged}
        />
      </div>

      {dialog === 'switch' && (
        <OptionSheet
          title={t('boards.switch_title')}
          value={board.record_id}
          options={[
            ...boards.map((b) => ({ value: b.record_id, label: b.name })),
            { value: NEW_BOARD, label: `+ ${t('boards.new')}` },
          ]}
          onPick={(value) => {
            if (value === NEW_BOARD) {
              setDialog('new');
              return;
            }
            setDialog(null);
            if (value !== board.record_id) onOpenBoard(value);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'new' && (
        <NameDialog
          title={t('boards.new')}
          saveLabel={t('boards.create')}
          onSave={handleCreate}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'rename' && (
        <NameDialog
          title={t('boards.rename')}
          initial={board.name}
          onSave={(name) => rename(board.record_id, name)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'columns' && <BoardColumnsSheet board={board} onClose={() => setDialog(null)} />}
      {dialog === 'history' && <BoardActivityPanel board={board} onClose={() => setDialog(null)} />}
      <ConfirmDialog request={confirm.request} onAnswer={confirm.onAnswer} />
    </div>
  );
}

export default BoardPage;
