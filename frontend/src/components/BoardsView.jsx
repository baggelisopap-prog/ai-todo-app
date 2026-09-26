import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBoards } from '../hooks/useBoards';
import EmptyState from './EmptyState';
import NameDialog from './NameDialog';
import BoardDetail from './BoardDetail';

const SELECTED_KEY = 'boards.selected';

function readSelected() {
  try { return sessionStorage.getItem(SELECTED_KEY); } catch { return null; }
}

function writeSelected(id) {
  try {
    if (id) sessionStorage.setItem(SELECTED_KEY, id);
    else sessionStorage.removeItem(SELECTED_KEY);
  } catch {
    // Private mode: the board simply is not remembered between tab switches.
  }
}

/**
 * «Πίνακες» — the third tab of «Όλα» (2026-09-26).
 *
 * WHY HERE AND NOT A FIFTH BUTTON AT THE BOTTOM: the bottom bar is kept at four
 * on purpose (navTabs.js, and scripts/ui-check.mjs enforces it) — at five the
 * Greek labels clip. «Όλα» is the library; boards are a way of arranging it.
 *
 * THE BOARD SHOWS EVERY CARD ON IT, whatever room the switcher is set to. A
 * board is a hand-picked set; hiding half of it because the switcher happens to
 * say «Business» would look like cards had gone missing. So this tab is given
 * the whole task list, not the room-scoped one the other tabs get.
 *
 * Which board is open is remembered for the browser tab's session, so going to
 * Today and back does not drop you on the first board every time — but a new
 * launch starts clean, like everything else in the app.
 */
function BoardsView({ tasks, onTaskUpdate, onTaskDeleted, onShowToast, onTaskAcknowledged }) {
  const { t } = useTranslation();
  const { boards, isLoaded, create } = useBoards();
  const [selectedId, setSelectedId] = useState(readSelected);
  const [isCreating, setIsCreating] = useState(false);

  function select(id) {
    setSelectedId(id);
    writeSelected(id);
  }

  async function handleCreate(name) {
    const before = new Set(boards.map((b) => b.record_id));
    const data = await create(name);
    const created = (data?.boards || []).find((b) => !before.has(b.record_id));
    if (created) select(created.record_id);
  }

  if (!isLoaded) {
    return <p className="text-sm italic text-[var(--text-muted)] px-1">{t('app.loading')}</p>;
  }

  const board = boards.find((b) => b.record_id === selectedId) || boards[0] || null;

  return (
    <div>
      {boards.length === 0 ? (
        // EmptyState keeps its `action` for the filter case alone (its own
        // rule), so the one button a first board needs sits under it instead.
        <div className="text-center">
          <EmptyState message={t('boards.empty')} hint={t('boards.empty_hint')} />
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="tap-44 -mt-6 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)]"
          >
            + {t('boards.new')}
          </button>
        </div>
      ) : (
        <>
          {/* The boards as chips, the open one filled — the same shape the
              room picker uses, so it reads as "where am I" at a glance. */}
          <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 md:mx-0 md:px-0" role="tablist">
            {boards.map((b) => {
              const isActive = b.record_id === board?.record_id;
              return (
                <button
                  key={b.record_id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => select(b.record_id)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    isActive
                      ? 'bg-[var(--brand-primary)] border-[var(--brand-primary)] text-white font-medium'
                      : 'bg-[var(--bg-card)] border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {b.name}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-sm border border-dashed border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              + {t('boards.new')}
            </button>
          </div>

          {board && (
            <BoardDetail
              key={board.record_id}
              board={board}
              tasks={tasks}
              onTaskUpdate={onTaskUpdate}
              onTaskDeleted={onTaskDeleted}
              onShowToast={onShowToast}
              onTaskAcknowledged={onTaskAcknowledged}
              onBoardDeleted={() => select(null)}
            />
          )}
        </>
      )}

      {isCreating && (
        <NameDialog
          title={t('boards.new')}
          saveLabel={t('boards.create')}
          onSave={handleCreate}
          onClose={() => setIsCreating(false)}
        />
      )}
    </div>
  );
}

export default BoardsView;
