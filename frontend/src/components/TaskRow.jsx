import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, roundToNearestHalfHour } from '../utils/formatDate';
import { priorityColor } from '../utils/priorityColor';
import {
  describeRecurrence,
  describeRecurrencePattern,
  dueTone,
  DUE_TONE_CLASSES,
  priorityLabel,
  checklistProgress,
} from '../utils/taskDisplay';
import { useTaskActions } from '../hooks/useTaskActions';
import { useSwipeRow } from '../hooks/useSwipeRow';
import { useRecurrence } from '../hooks/useRecurrence';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { describePlacement } from '../utils/workspaces';
import TaskMenu from './TaskMenu';
import QuickReschedule from './QuickReschedule';
import {
  CheckIcon,
  CalendarIcon,
  CalendarFilledIcon,
  BellFilledIcon,
  BellOutlineIcon,
  ChecklistIcon,
  TrashIcon,
} from './TaskIcons';

// Two 70px buttons. Named because the row's parked offset has to match the
// tray's real width exactly, or the last button is clipped.
const TRAY_WIDTH_PX = 140;

/**
 * One task, as it appears in a list.
 *
 * What changed from the card this replaces, and why:
 *
 * - **The reminder bell and calendar sync stay, and stay tappable.** The bug in
 *   them was never that they were controls; it was that a task with no
 *   due_time drew the bell at 40% opacity — the universal signal for
 *   "disabled" — and then answered a tap anyway. The control looked like one
 *   thing and behaved like another.
 *
 *   An earlier pass over-corrected: it made them indicators and hid them
 *   whenever they were off, which cost the one-tap toggle from the list and
 *   made a row's controls appear and disappear from task to task. Now they are
 *   always drawn and always tappable, with the dimming gone — off looks off,
 *   and a tap that cannot toggle says why. Note that `disabled` was not an
 *   option for the cannot-toggle case: disabled elements receive no click
 *   events, so they could not have explained themselves at all. The detail
 *   sheet states the same reasons permanently, where there is room for them.
 *
 * - **Priority is text as well as colour** (see taskDisplay.priorityLabel).
 *
 * - **The date is coloured only when it is overdue or today** (see dueTone).
 *
 * - **The checklist is a counter, not a list.** A ten-item checklist rendered
 *   in full made a single row taller than the screen. The items are in the
 *   sheet, where they are still tappable.
 *
 * - **Tapping opens a reading view, not a form.** That is the sheet's job; this
 *   component only reports the tap.
 */
function TaskRow({ task, variant = 'default', showCreated = false, isSelected, isNew = false, onOpen, onUpdate, onTaskDeleted, onShowToast }) {
  const { t } = useTranslation();
  const actions = useTaskActions(task, { onUpdate, onTaskDeleted, onShowToast });
  const { isPending, isCompleted, isRejected } = actions;

  const [isTrayOpen, setIsTrayOpen] = useState(false);
  const [isReschedulingOpen, setIsReschedulingOpen] = useState(false);

  // Swipe right completes, because completing is the thing you do most and it
  // is trivially reversible — the same circle undoes it and the toast says so.
  // Swipe left does NOT act; it reveals a tray. Reschedule and Delete both
  // deserve a deliberate second tap, and a gesture that deletes on release is
  // one pocket-brush away from destroying something.
  const swipe = useSwipeRow({
    enabled: !isTrayOpen,
    onSwipeRight: () => actions.toggleComplete(variant),
    onSwipeLeft: () => setIsTrayOpen(true),
  });

  async function handleReschedule(date) {
    setIsReschedulingOpen(false);
    setIsTrayOpen(false);
    try {
      await onUpdate(task.record_id, { due_date: date });
      // Reuses the key the calendar's drag-to-reschedule already shows, rather
      // than adding a second phrasing of the same event.
      onShowToast('calendar.rescheduled', 'success');
    } catch {
      onShowToast('errors.failed_update', 'error');
    }
  }

  async function handleDelete() {
    setIsTrayOpen(false);
    await actions.remove();
  }

  const showDescription = task.description && task.description !== task.task_name;
  const progress = checklistProgress(task.checklist);
  const tone = dueTone(task);

  // The row carries only recurrence_rule_id — the sentence describing what
  // repeats lives in a rule this component has never seen, which is why it
  // comes from the shared context rather than from props.
  //
  // A null rule means "not loaded yet, or the fetch failed", and the badge
  // still renders: it falls back to the bare word, because a marker that
  // pops into a row a second after the row itself is more unsettling than a
  // marker that says slightly less. The full sentence, time included, is on
  // the title and the accessible name either way.
  const { workspaces, categories } = useWorkspaces();
  const recurrence = useRecurrence();
  const rule = recurrence.ruleFor(task);
  const recurrenceBadge = rule
    ? t('recurrence.badge_with_pattern', { pattern: describeRecurrencePattern(rule, t) })
    : t('recurrence.badge');
  const recurrenceTitle = rule
    ? t('recurrence.badge_aria', { summary: describeRecurrence(rule, t) })
    : t('recurrence.badge');

  // Both are ALWAYS drawn and always tappable. An earlier pass hid them
  // whenever they were off, which removed the one-tap toggle from the list and
  // made a row's controls appear and disappear depending on the task.
  //
  // What is NOT coming back is the dimming. The original bug was that a task
  // with no due_time drew the bell at 40% opacity — the universal signal for
  // "disabled" — and then answered a tap anyway. Here nothing is dimmed and
  // nothing is inert: off looks off, and a tap that cannot toggle explains why
  // instead of doing nothing. A `disabled` button could not do that at all,
  // since disabled elements receive no click events.
  const notifyOn = Boolean(task.notify_enabled && task.due_time);
  const calendarOn = Boolean(task.calendar_sync_enabled && task.due_date);

  function handleToggleNotify(e) {
    e.stopPropagation();
    if (!task.due_time) {
      onShowToast('task.no_time_for_reminder', 'neutral');
      return;
    }
    actions.setNotify(!task.notify_enabled);
  }

  function handleToggleCalendar(e) {
    e.stopPropagation();
    // Calendar sync only needs a DATE — a task with no time still syncs as an
    // all-day event, which is why this checks a different field to the bell.
    if (!task.due_date) {
      onShowToast('calendar.no_date_for_sync', 'neutral');
      return;
    }
    actions.setCalendarSync(!task.calendar_sync_enabled);
  }

  const rowClasses = [
    'bg-[var(--bg-card)] border border-[var(--border-subtle)]',
    'rounded-lg p-4 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)]',
    'transition-shadow cursor-pointer',
    isSelected ? 'ring-2 ring-[var(--border-focus)]/20' : '',
    isRejected ? 'opacity-60' : isCompleted ? 'opacity-70' : '',
  ].filter(Boolean).join(' ');

  function handleClick(e) {
    // The menu and the completion circle live inside the row but are not "open
    // the task". data-no-toggle marks every such island in one place, rather
    // than the old approach of listing tag names, which broke the moment a
    // control was wrapped in a span.
    if (e.target.closest('[data-no-toggle]')) return;
    onOpen(task.record_id);
  }

  // How far the row is displaced: following the finger mid-swipe, or parked
  // open over the tray.
  const offset = isTrayOpen ? -TRAY_WIDTH_PX : swipe.dx;

  return (
    // The mark goes on the wrapper, not on the card inside it: this element's
    // overflow-hidden clips its CHILDREN, so a halo drawn on the card would be
    // cut off at exactly the edge it needs to cross. Its own box-shadow is not
    // clipped by it.
    <div className={`relative overflow-hidden rounded-lg ${isNew ? 'animate-task-flash' : ''}`}>
      {/* Behind the row. The right-hand pair is the tray a left swipe reveals;
          the left-hand strip is only feedback that a right swipe is in
          progress, since that one acts on release rather than parking open. */}
      {offset > 0 && (
        <div className="absolute inset-y-0 left-0 flex items-center px-4 bg-[var(--success-bg)]" style={{ width: offset }}>
          <CheckIcon className="w-4 h-4 text-[var(--success-strong)]" />
        </div>
      )}

      {/* z-20 ONLY while the tray is open, and both halves of that matter.

          It is needed at all because the "tap anywhere else to close" overlay
          below is `fixed inset-0 z-10` — it covers the WHOLE viewport, these
          two buttons included. Without a higher z-index, a tap on Delete or
          Reschedule landed on the overlay, which does one thing: closes the
          tray. The row slid back and nothing happened.

          It must NOT be permanent: this element is always in the DOM and sits
          BEHIND the card by document order. A standing z-20 lifts it in front,
          so the two buttons showed on top of every task all the time. While the
          tray IS open the card has slid 140px left, so the buttons occupy space
          the card has vacated and cover nothing. */}
      <div
        className={`absolute inset-y-0 right-0 flex items-stretch ${isTrayOpen ? 'z-20' : ''}`}
        aria-hidden={!isTrayOpen}
      >
        <button
          type="button"
          tabIndex={isTrayOpen ? 0 : -1}
          onClick={() => setIsReschedulingOpen(true)}
          className="w-[70px] flex flex-col items-center justify-center gap-1 bg-[var(--priority-p2-bg)] text-[var(--priority-p2-text)] text-[11px] font-medium"
        >
          <CalendarIcon className="w-4 h-4" />
          {t('actions.reschedule_short')}
        </button>
        <button
          type="button"
          tabIndex={isTrayOpen ? 0 : -1}
          onClick={handleDelete}
          className="w-[70px] flex flex-col items-center justify-center gap-1 bg-[var(--danger-bg)] text-[var(--danger-text)] text-[11px] font-medium"
        >
          <TrashIcon className="w-4 h-4" />
          {t('actions.delete')}
        </button>
      </div>

      <article
        onClick={handleClick}
        {...swipe.handlers}
        // touch-pan-y is what keeps vertical scrolling with the browser while
        // handing horizontal movement to useSwipeRow. Without it the browser
        // claims the whole gesture and the swipe never fires.
        className={`relative touch-pan-y ${rowClasses}`}
        style={{
          transform: `translateX(${offset}px)`,
          transition: swipe.isSwiping ? 'none' : 'transform 150ms ease-out',
        }}
      >
      <div className="flex items-start gap-3">
        <button
          type="button"
          data-no-toggle
          onClick={(e) => { e.stopPropagation(); actions.toggleComplete(variant); }}
          className={`tap-44 w-5 h-5 mt-0.5 rounded-full flex-shrink-0 flex items-center justify-center transition-all
            ${isCompleted
              ? 'bg-[var(--success)] border-2 border-[var(--success)]'
              : 'border-2 border-[var(--border-medium)] hover:border-[var(--text-secondary)]'}`}
          aria-label={
            variant === 'inbox'
              ? t('actions.approve')
              : (isCompleted ? t('task.mark_incomplete') : t('task.mark_complete'))
          }
        >
          {isCompleted && <CheckIcon className="w-3 h-3 text-white" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-bold leading-none tracking-wide flex-shrink-0 text-[var(--text-inverse)]"
              style={{ backgroundColor: priorityColor(task.priority) }}
              aria-label={t('task.priority_aria', { priority: task.priority })}
            >
              {priorityLabel(task.priority)}
            </span>
            <h3 className={`text-base font-medium break-words ${isCompleted ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
              {task.task_name}
            </h3>
          </div>

          {showDescription && (
            <p className="text-sm text-[var(--text-secondary)] mt-1 truncate">
              {task.description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs">
            {task.due_date && (
              <span className={`flex items-center gap-1 ${DUE_TONE_CLASSES[tone]}`}>
                <CalendarIcon className="w-3 h-3" />
                {formatDate(task.due_date, task.due_time)}
              </span>
            )}

            {/* Only while the list is ordered by creation date, and this is a
                fix rather than an extra: the row shows the DUE date, so a list
                sorted by CREATION date looked shuffled and there was no way to
                tell a working sort from a broken one. Now the value being
                sorted is on screen. Muted, and absent the rest of the time —
                every row carrying a second date permanently would cost more
                than it explains. */}
            {showCreated && (task.created_at || task.created_time) && (
              <span className="text-[var(--text-muted)]">
                {t('browse.created_on', {
                  date: formatDate((task.created_at || task.created_time).slice(0, 10)),
                })}
              </span>
            )}

            {task.recurrence_rule_id && (
              <button
                type="button"
                data-no-toggle
                onClick={(e) => { e.stopPropagation(); recurrence.openEditor(task); }}
                title={recurrenceTitle}
                aria-label={recurrenceTitle}
                className="tap-40 flex items-center gap-1 px-1.5 py-0.5 -my-0.5 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <span aria-hidden="true">↻</span>
                {recurrenceBadge}
              </button>
            )}

            {/* The old four-word category chip stood here and was removed on
                2026-09-02. It printed "Personal" — the AI's word for the dying
                `category` column — in the same meta line where the placement
                chip below prints "Personal" the WORKSPACE. The owner dictated a
                task while standing in one workspace, saw that chip, and
                reasonably concluded it had been filed in another; it had in
                fact been filed nowhere. The word is still in the database and
                still written by the extractor. It is simply no longer shown. */}

            {/* Only for a task that is actually filed. describePlacement still
                returns the "Unfiled" word for an unknown workspace — that is
                its own guard against printing undefined — but showing that
                chip on every row of an app where nobody has made a workspace
                yet is noise on every line. */}
            {task.workspace_id && (
              <span className="flex items-center gap-1 text-[var(--text-muted)] min-w-0">
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor:
                      workspaces.find((w) => w.record_id === task.workspace_id)?.color
                      || 'var(--text-muted)',
                  }}
                />
                <span className="truncate">
                  {describePlacement(task, workspaces, categories, t)}
                </span>
              </span>
            )}

            {progress && (
              <span className="flex items-center gap-1 text-[var(--text-secondary)] tabular-nums">
                <ChecklistIcon className="w-3 h-3" />
                {progress.done}/{progress.total}
              </span>
            )}

            {task.category === 'Hostaway' && task.hostaway_created_at && (
              <span className="text-[var(--text-muted)]">
                {t('task.received_at', { time: roundToNearestHalfHour(task.hostaway_created_at) })}
              </span>
            )}

            {isPending && (
              <span className="text-[var(--priority-p2)] font-medium">{t('task.pending')}</span>
            )}

            <button
              type="button"
              data-no-toggle
              onClick={handleToggleNotify}
              aria-pressed={notifyOn}
              // Carries the reason, so hovering on a desktop and a screen
              // reader anywhere both get it without having to tap and find out.
              title={task.due_time ? undefined : t('task.no_time_for_reminder')}
              aria-label={task.due_time ? t('task.notification_label') : t('task.no_time_for_reminder')}
              className={`tap-40 p-1 -m-1 rounded transition-colors ${
                notifyOn
                  ? 'text-[var(--brand-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {notifyOn ? <BellFilledIcon className="w-4 h-4" /> : <BellOutlineIcon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              data-no-toggle
              onClick={handleToggleCalendar}
              aria-pressed={calendarOn}
              title={task.due_date ? undefined : t('calendar.no_date_for_sync')}
              aria-label={task.due_date ? t('calendar.sync_task_label') : t('calendar.no_date_for_sync')}
              className={`tap-40 p-1 -m-1 rounded transition-colors ${
                calendarOn
                  ? 'text-[var(--brand-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {calendarOn ? <CalendarFilledIcon className="w-4 h-4" /> : <CalendarIcon className="w-4 h-4" />}
            </button>
          </div>

          {(actions.actionError || actions.deleteError) && (
            <div className="mt-2 text-xs text-[var(--danger)]">
              {actions.actionError
                ? `${t('errors.failed_update')}: ${actions.actionError}`
                : `${t('errors.failed_delete')}: ${actions.deleteError}`}
            </div>
          )}
        </div>

        <TaskMenu
          isPending={isPending}
          isCompleted={isCompleted}
          isRejected={isRejected}
          pendingAction={actions.pendingAction}
          onApprove={actions.approve}
          onUncomplete={actions.uncomplete}
          onReject={actions.reject}
          onUnreject={actions.unreject}
          onEdit={() => onOpen(task.record_id)}
          onReschedule={() => setIsReschedulingOpen(true)}
          onRecurrence={() => recurrence.openEditor(task)}
          isRecurring={Boolean(task.recurrence_rule_id)}
          onDelete={handleDelete}
          t={t}
        />
      </div>
      </article>

      {/* Tapping anywhere else closes the tray. Without this it can only be
          shut by swiping it back, which nobody discovers. */}
      {isTrayOpen && (
        <button
          type="button"
          className="fixed inset-0 z-10 cursor-default"
          aria-label={t('actions.close')}
          onClick={() => setIsTrayOpen(false)}
        />
      )}

      {isReschedulingOpen && (
        <QuickReschedule
          onPick={handleReschedule}
          onClose={() => setIsReschedulingOpen(false)}
        />
      )}
    </div>
  );
}

export default TaskRow;
