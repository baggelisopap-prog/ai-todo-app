import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBoards } from '../hooks/useBoards';
import { boardSummary, daysAgo, pickCreatedBoard } from '../utils/boards';
import NameDialog from './NameDialog';

/**
 * The boards at the top of «Όλα», one tile each (2026-09-29 — proposal 1 of the
 * redesign). They used to be «Όλα»'s third tab; now they are the first thing
 * the screen shows, and a tap opens the board as its own page.
 *
 * A tile says how the board is doing without opening it: a bar split into
 * waiting / under way / done, the same three as numbers, and when anything on
 * it last moved. Everything is read from what the app already holds — no
 * request per tile.
 *
 * TWO PLACES, one component (`slot`):
 *   'top'  — the strip of tiles, drawn only for someone who HAS a board;
 *   'tabs' — a small «+ Πίνακας» beside «Όλα»'s tabs, drawn only for someone
 *            who has none. That is the door to the first board, and it is no
 *            louder than the «Πίνακες» tab it replaces — the owner's rule is
 *            that whoever does not use boards sees nothing new.
 */
function BoardStrip({ slot = 'top', tasks, onOpenBoard }) {
  const { t } = useTranslation();
  const { boards, isLoaded, create } = useBoards();
  const [isCreating, setIsCreating] = useState(false);

  const tasksById = useMemo(() => {
    const map = {};
    for (const task of tasks || []) map[task.record_id] = task;
    return map;
  }, [tasks]);

  async function handleCreate(name) {
    const data = await create(name);
    const created = pickCreatedBoard(boards, data?.boards, name);
    if (created) onOpenBoard(created.record_id);
  }

  const dialog = isCreating && (
    <NameDialog
      title={t('boards.new')}
      saveLabel={t('boards.create')}
      onSave={handleCreate}
      onClose={() => setIsCreating(false)}
    />
  );

  if (!isLoaded) return null;

  if (slot === 'tabs') {
    if (boards.length > 0) return null;
    return (
      <>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="ml-auto self-center px-2 py-1 rounded-md text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          + {t('boards.tabs_new')}
        </button>
        {dialog}
      </>
    );
  }

  if (boards.length === 0) return null;
  const now = new Date();

  return (
    <section aria-label={t('boards.strip_title')} className="mb-4">
      <div className="flex items-baseline justify-between px-0.5 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {t('boards.strip_title')}
        </h2>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="tap-44 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          + {t('boards.new_short')}
        </button>
      </div>

      <div className="flex gap-2.5 overflow-x-auto -mx-4 px-4 pt-0.5 pb-1 md:mx-0 md:px-0">
        {boards.map((board) => {
          const s = boardSummary(board, tasksById, now);
          const ago = daysAgo(s.lastMovedAt, now);
          const total = s.waiting + s.doing + s.done;
          return (
            <button
              key={board.record_id}
              type="button"
              onClick={() => onOpenBoard(board.record_id)}
              className="flex-shrink-0 w-[214px] flex flex-col gap-2 p-3 rounded-xl text-left bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-[var(--shadow-card)] hover:bg-[var(--bg-hover)]"
            >
              <span className="text-[15px] font-semibold leading-snug text-[var(--text-primary)] line-clamp-2">{board.name}</span>
              {/* Grey waiting, blue under way, green done — the first column,
                  the other open ones, «Έγινε». */}
              <span aria-hidden="true" className="flex h-1.5 gap-0.5 rounded-sm overflow-hidden bg-[var(--bg-hover)]">
                {total > 0 && (
                  <>
                    {s.waiting > 0 && <i className="block h-full bg-[var(--border-medium)]" style={{ flex: s.waiting }} />}
                    {s.doing > 0 && <i className="block h-full bg-[var(--priority-p3)]" style={{ flex: s.doing }} />}
                    {s.done > 0 && <i className="block h-full bg-[var(--success)]" style={{ flex: s.done }} />}
                  </>
                )}
              </span>
              <span className="text-xs leading-snug text-[var(--text-secondary)]">
                {t(s.waiting === 1 ? 'boards.tile_waiting_one' : 'boards.tile_waiting', { count: s.waiting })}
                {' · '}
                {t('boards.tile_doing', { count: s.doing })}
                <span className="block text-[11.5px] text-[var(--text-muted)]">
                  {t(s.done === 1 ? 'boards.tile_done_one' : 'boards.tile_done', { count: s.done })}
                  {ago !== null && ` · ${
                    ago === 0 ? t('boards.tile_moved_today') : ago === 1 ? t('boards.tile_moved_yesterday') : t('boards.tile_moved_days', { count: ago })
                  }`}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {dialog}
    </section>
  );
}

export default BoardStrip;
