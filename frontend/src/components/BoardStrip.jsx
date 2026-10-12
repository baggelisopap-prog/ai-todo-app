import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBoards } from '../hooks/useBoards';
import { boardSummary, daysAgo, pickCreatedBoard } from '../utils/boards';
import NameDialog from './NameDialog';

/**
 * The boards, one tile each. A tile says how the board is doing without
 * opening it: a bar split into waiting / under way / done, the same three as
 * numbers, and when anything on it last moved. Everything is read from what
 * the app already holds — no request per tile.
 *
 * TWO PLACES, one component (`slot`):
 *   'list' — board mode's own screen (2026-10-12, see BOARDS_TAB in
 *            utils/boards.js): every board at full width, then «+ Νέος
 *            πίνακας». A tap opens the board as its own page. Until then these
 *            tiles were a sideways-scrolling strip at the top of «Όλα»
 *            (2026-09-29), which the owner called «χύμα» — tasks and boards
 *            on one screen, the boards pushing the list down;
 *   'tabs' — a small «+ Πίνακας» beside «Όλα»'s tabs, drawn only for someone
 *            who has no board. That is the door to the first board — the
 *            board-mode switch only appears once there is one — and it is no
 *            louder than that: the owner's rule is that whoever does not use
 *            boards sees nothing new.
 */
function BoardStrip({ slot = 'list', tasks, onOpenBoard }) {
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

  const now = new Date();

  return (
    <section aria-label={t('boards.strip_title')}>
      {/* With no board left — the last one deleted while in board mode — the
          screen says so rather than showing a lone button. */}
      {boards.length === 0 && (
        <p className="px-0.5 pb-3 text-sm text-[var(--text-secondary)]">{t('boards.list_empty')}</p>
      )}

      <div className="flex flex-col gap-2.5">
        {boards.map((board) => {
          const s = boardSummary(board, tasksById, now);
          const ago = daysAgo(s.lastMovedAt, now);
          const total = s.waiting + s.doing + s.done;
          return (
            <button
              key={board.record_id}
              type="button"
              onClick={() => onOpenBoard(board.record_id)}
              className="relative w-full flex flex-col gap-2 pl-4 pr-11 py-3.5 rounded-xl text-left bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-[var(--shadow-card)] hover:bg-[var(--bg-hover)]"
            >
              {/* › says the tile opens something, which a strip of tiles
                  scrolling sideways did not need to say. */}
              <svg className="absolute right-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 18l6-6-6-6" />
              </svg>
              <span className="text-[16.5px] font-semibold leading-snug text-[var(--text-primary)] line-clamp-2">{board.name}</span>
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

      <button
        type="button"
        onClick={() => setIsCreating(true)}
        className="block w-full mt-3 p-3.5 rounded-xl border-[1.5px] border-dashed border-[var(--border-medium)] text-[14.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      >
        + {t('boards.new')}
      </button>
      {dialog}
    </section>
  );
}

export default BoardStrip;
