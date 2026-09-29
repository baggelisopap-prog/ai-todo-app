import { useTranslation } from 'react-i18next';
import { useModalBehavior } from '../hooks/useModalBehavior';
import { moveOptionHint } from '../utils/boards';

/**
 * «Μετακίνηση» — where a card goes, one big button per column (2026-09-29,
 * proposal 2 of the redesign the owner chose).
 *
 * WHY A SHEET AND NOT A DRAG on a phone: a card dragged across a strip that
 * itself scrolls sideways was the least exact gesture on a small screen, and on
 * an iPhone press-and-hold on text grabs the text instead. So a phone shows one
 * column at a time, and press-and-hold opens this. The buttons are thumb-sized
 * and each says, before it is pressed, what it will DO — «Έγινε» completes the
 * task everywhere and «Ακυρώθηκε» asks «Γιατί;», which is the owner's rule for
 * those two columns.
 *
 * The computer keeps dragging; its card ⋯ → «Μετακίνηση σε…» opens this too.
 */
function BoardMoveSheet({ taskName, lanes, currentColumnId, onPick, onOpenTask, onRemove, onClose }) {
  const { t } = useTranslation();
  useModalBehavior(onClose);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 animate-fade-in flex items-end md:items-center justify-center md:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('boards.move_title')}
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-sm bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] px-4 pt-2 pb-safe max-h-[86vh] overflow-y-auto"
      >
        <div aria-hidden="true" className="mx-auto mt-1 mb-2 w-9 h-1 rounded-full bg-[var(--border-medium)] md:hidden" />
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {t('boards.move_title')}
        </p>
        <p className="mt-0.5 mb-3 text-[15px] font-semibold text-[var(--text-primary)] break-words line-clamp-2">
          {taskName}
        </p>

        <div className="grid grid-cols-2 gap-2">
          {lanes.map(({ column, count }) => {
            const isCurrent = column.record_id === currentColumnId;
            const hint = moveOptionHint(column, currentColumnId, count);
            return (
              <button
                key={column.record_id}
                type="button"
                onClick={() => onPick(column.record_id)}
                aria-current={isCurrent ? 'true' : undefined}
                className={`min-h-[68px] flex flex-col gap-0.5 p-3 rounded-[10px] text-left transition-colors ${
                  isCurrent
                    ? 'border-2 border-[var(--text-primary)] bg-[var(--bg-hover)]'
                    : 'border border-[var(--border-medium)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <span className={`flex items-center gap-1.5 text-[15px] font-semibold ${
                  column.kind === 'done' ? 'text-[var(--success-text)]' : 'text-[var(--text-primary)]'
                }`}>
                  {column.kind === 'done' && <span aria-hidden="true">✓</span>}
                  {column.kind === 'dropped' && <span aria-hidden="true" className="text-[var(--text-muted)]">⊘</span>}
                  <span className="truncate">{column.name}</span>
                </span>
                <span className="text-xs leading-snug text-[var(--text-secondary)]">
                  {t(`boards.move_hint_${hint.key === 'cards' && hint.count === 1 ? 'cards_one' : hint.key}`, { count: hint.count })}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 mb-2 flex flex-col border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={onOpenTask}
            className="px-1 py-3 text-left text-[15px] text-[var(--text-primary)] border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
          >
            {t('boards.open_task')}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="px-1 py-3 text-left text-[15px] text-[var(--danger)] hover:bg-[var(--bg-hover)]"
          >
            {t('boards.remove_card')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BoardMoveSheet;
