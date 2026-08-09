import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, roundToNearestHalfHour } from '../utils/formatDate';
import { priorityColor } from '../utils/priorityColor';
import {
  categoryColor,
  categoryLabel,
  dueTone,
  DUE_TONE_CLASSES,
  priorityLabel,
  checklistProgress,
} from '../utils/taskDisplay';
import { useTaskActions } from '../hooks/useTaskActions';
import { useSwipeRow } from '../hooks/useSwipeRow';
import TaskMenu from './TaskMenu';
import QuickReschedule from './QuickReschedule';
import {
  CheckIcon,
  CalendarIcon,
  CalendarFilledIcon,
  BellFilledIcon,
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
 * - **The metadata row no longer contains controls.** It held two buttons — the
 *   reminder bell and calendar sync — mixed in with the date and category. They
 *   were rendered at 40% opacity when the task lacked the field they needed
 *   (no due_time, no due_date) and were STILL clickable, answering with a toast
 *   about why they could not work. Forty percent opacity means disabled
 *   everywhere; the control looked like one thing and behaved like another.
 *   Here they are indicators, drawn only when actually on, and both are real
 *   switches in the detail sheet where there is room to label them.
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
function TaskRow({ task, variant = 'default', isSelected, onOpen, onUpdate, onTaskDeleted, onShowToast }) {
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

  // Drawn only when the reminder or the sync is actually ON. An indicator for
  // an inactive thing is the same noise the old dimmed buttons were.
  const notifyOn = task.notify_enabled && task.due_time;
  const calendarOn = task.calendar_sync_enabled && task.due_date;

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
    <div className="relative overflow-hidden rounded-lg">
      {/* Behind the row. The right-hand pair is the tray a left swipe reveals;
          the left-hand strip is only feedback that a right swipe is in
          progress, since that one acts on release rather than parking open. */}
      {offset > 0 && (
        <div className="absolute inset-y-0 left-0 flex items-center px-4 bg-[var(--success-bg)]" style={{ width: offset }}>
          <CheckIcon className="w-4 h-4 text-[var(--success-strong)]" />
        </div>
      )}

      <div className="absolute inset-y-0 right-0 flex items-stretch" aria-hidden={!isTrayOpen}>
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

            {task.category && task.category !== 'Unknown' && (
              <span className="flex items-center gap-1" style={{ color: categoryColor(task.category) }}>
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: categoryColor(task.category) }}
                />
                {categoryLabel(task.category, t)}
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

            {/* Indicators, not buttons — see the note at the top of this file.
                Non-interactive, so no tap target and no lie about being one. */}
            {notifyOn && (
              <BellFilledIcon
                className="w-3.5 h-3.5 text-[var(--brand-primary)]"
                role="img"
                aria-label={t('task.notification_on')}
              />
            )}
            {calendarOn && (
              <CalendarFilledIcon
                className="w-3.5 h-3.5 text-[var(--brand-primary)]"
                role="img"
                aria-label={t('calendar.sync_task_tooltip')}
              />
            )}
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
