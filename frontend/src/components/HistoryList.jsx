import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { restoreTask } from '../api';
import { uiLocale, toLocalISODate, formatDate, formatStamp } from '../utils/formatDate';
import { useMembers } from '../hooks/useMembers';
import {
  completionCredit,
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

// SOURCE_KEYS lived here and mapped completed_source straight to a label, one
// of which read «από εσένα». That was true while the app had one user and
// became a lie the day two people shared a workspace — see
// taskHistory.completionCredit, which now answers this and is testable under
// plain Node, unlike anything in this file.


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
function eventLine({ kind, at, exact, task }, t, nameFor) {
  if (kind === KIND_REJECTED) return t('browse.event_rejected');

  if (kind === KIND_MISSED) {
    const when = task.occurrence_date || task.due_date;
    return t('browse.event_missed', { date: when ? formatDate(when) : '' });
  }

  if (!exact) {
    const label = kind === KIND_COMPLETED ? t('browse.event_completed', { when: '' }) : t('browse.event_deleted', { when: '' });
    return `${label.trim()} · ${t('browse.event_undated')}`;
  }

  if (kind === KIND_COMPLETED) {
    const line = t('browse.event_completed', { when: formatStamp(at) });
    // WHO closed it where that is known, WHAT channel where it is not, and
    // nothing at all where neither column can say — the rule and the reason
    // are in taskHistory.completionCredit. `completed_source` is still why the
    // column exists at all: a task once closed itself six seconds after being
    // created and nothing anywhere could say what had done it.
    const credit = completionCredit(task, nameFor?.myId);
    if (!credit) return line;
    if (!credit.userId) return `${line} · ${t(credit.key)}`;
    // Somebody who has since left the room resolves to no name. That gets its
    // own sentence rather than the generic "Πρώην μέλος" dropped into a slot
    // built for a first name — «από τον/την Πρώην μέλος» is not Greek.
    const name = nameFor.of(task.workspace_id, credit.userId);
    return `${line} · ${name ? t(credit.key, { name }) : t('browse.source_former_member')}`;
  }

  return t('browse.event_deleted', { when: formatStamp(at) });
}

/**
 * The row's whole life on ONE line: «Μπήκε 3 Σεπ → Διαγράφηκε 14 Σεπ 14:32».
 *
 * These were two stacked lines, and the owner's word for the result was
 * «χάος» — one date sat in a heading somewhere above, the other in small text
 * underneath, and nothing put them next to each other. Reading them as a span
 * is the question people actually bring to this screen: how long did this
 * thing live before it ended.
 *
 * A row with no creation stamp keeps the event alone rather than printing an
 * arrow that starts nowhere.
 */
function lifeLine(row, t, nameFor) {
  const event = eventLine(row, t, nameFor);
  const created = row.task.created_at || row.task.created_time;
  if (!created) return event;
  return `${t('browse.created_on', { date: formatDate(created.slice(0, 10)) })} → ${event}`;
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
  // id → name, for the one label on this row that needs it. Bundled into a
  // single object rather than passed as two arguments because lifeLine hands it
  // straight down to eventLine, and both halves travel together: who I am
  // decides «από εσένα» versus a name, and the lookup turns the id into
  // something readable. personFor answers null on a solo account, which is
  // correct — there is nobody else there to have closed anything.
  const { myId, personFor } = useMembers();
  const nameFor = {
    myId,
    // null, not a placeholder: the caller has a whole sentence for the case
    // where the person is gone, and a placeholder here would fill a slot that
    // expects a first name.
    of: (workspaceId, userId) => personFor(workspaceId, userId)?.display_name || null,
  };
  const { kind, task } = row;
  const style = KIND_STYLES[kind];
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
        {/* Both dates, in one line — see lifeLine. "When did this go in" was
            the third thing the History tab was asked for, and it had no field
            on the frontend until created_at was surfaced. */}
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">{lifeLine(row, t, nameFor)}</p>
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
