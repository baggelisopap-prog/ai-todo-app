import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBoardActivity } from '../api';
import { useModalBehavior } from '../hooks/useModalBehavior';
import { toLocalISODate, uiLocale } from '../utils/formatDate';

/**
 * «Ιστορικό» of one board: who did what, and when (2026-09-26).
 *
 * The owner asked for it while deciding who may see a board: «θέλω να μπαίνει
 * και ποιος κάνει τι σε ενέργειες και πότε για να έχει τρακ». So it records
 * from the first day — including what happened to a card from OUTSIDE the
 * board: a colleague ticking the task in their own list, the agent closing it,
 * a Hostaway reply closing it. The person is named, or the machine is.
 *
 * Opened on demand and fetched only then, so a board costs nothing extra to
 * open: the same rule ActivityPanel follows for a workspace.
 *
 * Sentences, grouped by day — the shape ActivityPanel settled on, for its
 * reason: the question asked of a log is "what happened around then".
 */
function BoardActivityPanel({ board, onClose }) {
  useModalBehavior(onClose);
  const { t } = useTranslation();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getBoardActivity(board.record_id)
      .then((data) => { if (!cancelled) setRows(data.activity || []); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [board.record_id]);

  function actorOf(row) {
    if (row.actor_kind === 'hostaway') return t('boards.actor_hostaway');
    const name = row.actor_name || t('activity.somebody');
    return row.actor_kind === 'agent' ? t('boards.actor_via_agent', { name }) : name;
  }

  function sentence(row) {
    const actor = actorOf(row);
    const task = row.task_name || t('activity.a_task');
    const d = row.details || {};
    switch (row.action) {
      case 'board_created': return t('boards.log.board_created', { actor });
      case 'board_renamed': return t('boards.log.board_renamed', { actor, from: d.from, to: d.to });
      case 'column_added': return t('boards.log.column_added', { actor, name: d.name });
      case 'column_renamed': return t('boards.log.column_renamed', { actor, from: d.from, to: d.to });
      case 'column_moved': return t('boards.log.column_moved', { actor, name: d.name });
      case 'column_removed': return t('boards.log.column_removed', { actor, name: d.name });
      case 'card_added': return t('boards.log.card_added', { actor, task });
      case 'card_created': return t('boards.log.card_created', { actor, task, column: d.column });
      case 'card_removed': return t('boards.log.card_removed', { actor, task });
      case 'card_moved_out': return t('boards.log.card_moved_out', { actor, task, board: d.to_board });
      case 'card_moved': return t('boards.log.card_moved', { actor, task, from: d.from, to: d.to });
      case 'task_completed': return t('boards.log.task_completed', { actor, task });
      case 'task_reopened': return t('boards.log.task_reopened', { actor, task });
      case 'task_dropped':
        return d.reason
          ? t('boards.log.task_dropped_reason', { actor, task, reason: d.reason })
          : t('boards.log.task_dropped', { actor, task });
      case 'task_undropped': return t('boards.log.task_undropped', { actor, task });
      // The vocabulary grows; an unknown verb prints rather than vanishing —
      // ActivityPanel's rule, for its reason.
      default: return `${actor} · ${row.action}`;
    }
  }

  const now = new Date();
  const today = toLocalISODate(now);
  const before = new Date(now);
  before.setDate(before.getDate() - 1);
  const yesterday = toLocalISODate(before);
  const groups = [];
  for (const row of rows || []) {
    const day = toLocalISODate(new Date(row.created_at));
    if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, rows: [] });
    groups[groups.length - 1].rows.push(row);
  }

  function heading(day) {
    if (day === today) return t('activity.today');
    if (day === yesterday) return t('activity.yesterday');
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short', weekday: 'short' });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 animate-fade-in flex items-end md:items-center justify-center md:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('boards.history_title', { board: board.name })}
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-md bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)] truncate">
            {t('boards.history_title', { board: board.name })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="tap-44 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {t('actions.close')}
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-4 space-y-4">
          {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}
          {!error && rows === null && <p className="text-sm italic text-[var(--text-muted)]">{t('app.loading')}</p>}
          {rows !== null && rows.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">{t('activity.empty')}</p>
          )}
          {groups.map((group) => (
            <section key={group.day}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
                {heading(group.day)}
              </h3>
              <ul className="space-y-1.5">
                {group.rows.map((row) => (
                  <li key={row.id} className="flex gap-2 text-sm text-[var(--text-primary)]">
                    <span className="tabular-nums text-xs text-[var(--text-muted)] pt-0.5 flex-shrink-0">
                      {new Date(row.created_at).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="min-w-0 break-words">{sentence(row)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export default BoardActivityPanel;
