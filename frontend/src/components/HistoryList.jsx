import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { restoreTask } from '../api';
import { uiLocale, toLocalISODate, formatDate } from '../utils/formatDate';
import {
  groupHistoryByDay,
  KIND_COMPLETED,
  KIND_DELETED,
  KIND_MISSED,
  KIND_REJECTED,
} from '../utils/taskHistory';

/**
 * The History tab's list: what left the live lists, grouped by the day it
 * happened.
 *
 * Deliberately NOT TaskList with a flag. A live row exists to be acted on — it
 * carries a checkbox, a swipe tray, a due date that means "do this by then".
 * None of that is true here: these rows are a record, the only action is
 * Restore, and the date that matters is when the thing HAPPENED rather than
 * when it was due. Reusing TaskList would have meant threading a "read-only"
 * flag through every one of those behaviours, which is how a component ends up
 * doing two jobs badly.
 */

const KIND_STYLES = {
  [KIND_COMPLETED]: { glyph: '✓', color: 'var(--priority-p3)' },
  [KIND_DELETED]: { glyph: '✕', color: 'var(--text-muted)' },
  [KIND_MISSED]: { glyph: '!', color: 'var(--priority-p1)' },
  [KIND_REJECTED]: { glyph: '✕', color: 'var(--text-muted)' },
};

const SOURCE_KEYS = {
  ui: 'browse.source_ui',
  agent: 'browse.source_agent',
  hostaway_reply: 'browse.source_hostaway_reply',
};

function timeOfDay(at) {
  if (at === null) return '';
  return new Date(at).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * "Σήμερα" / "Χθες" / "1 Σεπ 2026", or the undated heading.
 *
 * Today and yesterday get names because those are the two the eye looks for
 * first; everything older is a date, since "πριν 4 μέρες" makes you do the
 * arithmetic the heading was supposed to save you.
 */
function dayHeading(day, t, now) {
  if (day === null) return t('browse.day_undated');
  const today = toLocalISODate(now);
  if (day === today) return t('browse.day_today');
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === toLocalISODate(yesterday)) return t('browse.day_yesterday');

  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const options = { day: 'numeric', month: 'short', weekday: 'short' };
  if (y !== now.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString(uiLocale(), options);
}

/**
 * One line saying what happened, in the row's own words.
 *
 * `exact === false` means the timestamp is the task's CREATION time standing
 * in for an event nobody recorded — a rejection (never timestamped) or a
 * completion from before completed_at existed. Those rows say so instead of
 * printing an hour that would look like fact.
 */
function eventLine({ kind, at, exact, task }, t) {
  if (kind === KIND_REJECTED) return t('browse.event_rejected');

  if (kind === KIND_MISSED) {
    const when = task.occurrence_date || task.due_date;
    return t('browse.event_missed', { date: when ? formatDate(when) : '' });
  }

  if (!exact) {
    const label = kind === KIND_COMPLETED ? t('browse.event_completed', { time: '' }) : t('browse.event_deleted', { time: '' });
    return `${label.trim()} · ${t('browse.event_undated')}`;
  }

  if (kind === KIND_COMPLETED) {
    const line = t('browse.event_completed', { time: timeOfDay(at) });
    // completed_source is why this column exists: a task once closed itself six
    // seconds after being created and nothing could say what had done it.
    const sourceKey = SOURCE_KEYS[task.completed_source];
    return sourceKey ? `${line} · ${t(sourceKey)}` : line;
  }

  return t('browse.event_deleted', { time: timeOfDay(at) });
}

/**
 * The way back, per state — and every state that HAD one before this screen
 * existed must still have one.
 *
 * That is not a nicety: Browse used to show completed and rejected tasks as
 * ordinary cards behind two toggles, where the circle un-completed them and
 * the ⋯ menu un-rejected them. Moving them into History took those toggles
 * away, and the first version of this screen offered Restore on deleted rows
 * only — so a task ticked off by accident had no way back. The owner hit it
 * within minutes of the deploy.
 *
 * A missed occurrence has no entry here on purpose, and it is the one case
 * where nothing was taken away: those rows were never visible in Browse at
 * all, "un-missing" is not a thing the backend can do, and the day it was for
 * has passed regardless.
 */
const ACTIONS = {
  [KIND_DELETED]: {
    labelKey: 'browse.restore',
    busyKey: 'browse.restoring',
    failKey: 'toast.restore_failed',
  },
  [KIND_COMPLETED]: {
    labelKey: 'browse.reopen',
    busyKey: 'browse.reopening',
    updates: { is_completed: false },
    toastKey: 'toast.uncompleted',
    failKey: 'toast.action_failed',
  },
  [KIND_REJECTED]: {
    labelKey: 'browse.unreject',
    busyKey: 'browse.reopening',
    updates: { is_rejected: false },
    toastKey: 'toast.unrejected',
    // Not 'restore_failed': re-opening a task is not a restore, and a failure
    // message naming the wrong action sends the reader looking in the wrong
    // place for what went wrong.
    failKey: 'toast.action_failed',
  },
};

function HistoryRow({ row, onAct, isBusy }) {
  const { t } = useTranslation();
  const { kind, task } = row;
  const style = KIND_STYLES[kind];
  const created = task.created_at || task.created_time;
  const action = ACTIONS[kind];

  return (
    <li className="flex items-start gap-3 py-2.5 px-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
      <span
        aria-hidden="true"
        className="mt-0.5 w-5 h-5 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-semibold bg-[var(--bg-hover)]"
        style={{ color: style.color }}
      >
        {style.glyph}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm text-[var(--text-primary)] truncate">{task.task_name}</p>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">{eventLine(row, t)}</p>
        {/* "When did this go in" — the third thing the History tab was asked
            for, and the one that had no field on the frontend until
            created_at was surfaced. */}
        {created && (
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {t('browse.created_on', { date: formatDate(created.slice(0, 10)) })}
          </p>
        )}
      </div>

      {action && (
        <button
          type="button"
          onClick={() => onAct(row)}
          disabled={isBusy}
          className="flex-shrink-0 px-2.5 py-1 rounded-md text-xs border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors"
        >
          {t(isBusy ? action.busyKey : action.labelKey)}
        </button>
      )}
    </li>
  );
}

function HistoryList({ rows, onTaskUpdate, onTaskRestored, onShowToast }) {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState(null);
  const now = new Date();

  /**
   * One handler for all three ways back. A deleted row needs its own endpoint
   * (restore clears a column the ordinary PATCH deliberately cannot reach);
   * un-completing and un-rejecting are plain field updates that go through the
   * same onTaskUpdate every other screen uses, so re-opening a task from here
   * behaves exactly like un-ticking its circle in Today.
   *
   * In every case the row simply stops being history and leaves this list on
   * its own — App folds the new task into state, and it reappears under Ενεργά.
   */
  async function handleAct(row) {
    const { kind, task } = row;
    const action = ACTIONS[kind];
    if (!action) return;

    setBusyId(task.record_id);
    try {
      if (kind === KIND_DELETED) {
        const { calendar } = await restoreTask(task.record_id);
        onTaskRestored?.(task.record_id);
        // 'link_cleared' is not a detail to swallow: the task is back but its
        // Google Calendar event is not, and the only place the user would
        // otherwise discover that is their own calendar, later.
        onShowToast?.(
          calendar === 'link_cleared' ? 'toast.restored_calendar_cleared' : 'toast.restored',
          'success'
        );
      } else {
        await onTaskUpdate(task.record_id, action.updates);
        onShowToast?.(action.toastKey, 'success');
      }
    } catch {
      onShowToast?.(action.failKey, 'error');
    } finally {
      setBusyId(null);
    }
  }

  const groups = groupHistoryByDay(rows);

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.day ?? 'undated'}>
          <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2 px-1">
            {dayHeading(group.day, t, now)}
          </h3>
          <ul className="space-y-2">
            {group.rows.map((row) => (
              <HistoryRow
                key={row.task.record_id}
                row={row}
                onAct={handleAct}
                isBusy={busyId === row.task.record_id}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default HistoryList;
