import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, roundToNearestHalfHour, formatStamp } from '../utils/formatDate';
import { priorityColor } from '../utils/priorityColor';
import {
  dueTone,
  DUE_TONE_CLASSES,
  priorityLabel,
  checklistProgress,
  awaitsMyAcknowledgement,
} from '../utils/taskDisplay';
import { effectiveAssignee } from '../utils/assignment';
import { useTaskActions } from '../hooks/useTaskActions';
import { useSwipeRow } from '../hooks/useSwipeRow';
import { useRecurrence } from '../hooks/useRecurrence';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useMembers } from '../hooks/useMembers';
import { placementParts } from '../utils/workspaces';
import Avatar from './Avatar';
import TaskMenu from './TaskMenu';
import QuickReschedule from './QuickReschedule';
import {
  CheckIcon,
  CalendarIcon,
  CalendarFilledIcon,
  BellFilledIcon,
  BellOutlineIcon,
  TrashIcon,
} from './TaskIcons';

// The priority is the COLOUR of the completion circle's ring, and nothing else.
//
// Three passes to get here, and the last one is the owner's and final. It was a
// lettered badge; he asked for the circle alone («το p1 p2 p3 να ειναι μονο στο
// χρωμα απο το κυκλακι»), then for the circles to stay open («οι κυκλοι να
// ειναι ανοιχτη οχι γεματοι»), then for them to stop varying: «τα κυκλάκια να
// είναι το ίδιο μεγεθος, στα κοκκινα ειναι ποιο χοντρα». They were the same
// 18px across, but a 4px ring leaves a smaller hole and reads as a heavier
// object — he was describing what he saw, and he was right about it.
//
// WHAT THAT COSTS, WRITTEN DOWN RATHER THAN ARGUED AGAIN. This file once said
// "Priority is text as well as colour", and the reason was real: roughly one man
// in twelve cannot separate red from amber, so P1 and P2 are now the same circle
// for them. Two intermediate answers were offered and declined — a letter on P1
// only, and the ring thickness above. The screen-reader path is still covered,
// because the circle's aria-label names the priority out loud. The colour-blind
// case is not, and that is a known, accepted trade-off rather than an oversight.
const RING_WIDTH = '2px';

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
function TaskRow({ task, variant = 'default', showCreated = false, isSelected, isNew = false, onOpen, onUpdate, onTaskDeleted, onShowToast, onAcknowledged }) {
  const { t } = useTranslation();
  const actions = useTaskActions(task, { onUpdate, onTaskDeleted, onShowToast, onAcknowledged });
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

  // Who holds this task, resolved from an id to a person.
  //
  // `isShared` is answered from member_count, which arrives with the workspaces
  // themselves — so a solo account settles this without a single request and
  // the branch below costs nothing on 340 rows.
  //
  // The FIRST WORD of the name, not all of it. This meta line already carries a
  // date, a workspace and up to four other chips on a 400px screen, and
  // "Μαρία Παπαδοπούλου" would push the row to wrap. The full name is on the
  // avatar's title and accessible name, where a hover or a screen reader finds
  // it — the same bargain the recurrence badge already makes.
  const { isShared, personFor, myId } = useMembers();
  const isSharedRoom = isShared(task.workspace_id);
  // effectiveAssignee, not task.assigned_to: whoever made a task is responsible
  // for it until they hand it on — the owner's rule, and the one the reminder
  // loop and the agent have always used. The face was the last place still
  // showing an untaken task as belonging to nobody. See utils/assignment.js.
  const responsibleId = effectiveAssignee(task);
  const assignee = isSharedRoom ? personFor(task.workspace_id, responsibleId) : null;

  // A task somebody else closed, still waiting for this person's OK. The row
  // stays struck through until they give it, which is the whole point: before
  // 2026-09-17 a colleague finishing your work simply removed it from your day
  // with nothing to see and nobody named.
  const handover = awaitsMyAcknowledgement(task, myId);
  const closedBy = handover ? personFor(task.workspace_id, task.completed_by) : null;
  // The NAME beside the face is gone with the old meta line — Avatar already
  // carries it as its title and aria-label, so a screen reader and a hover both
  // still get it, and the row gets back the width it cost.

  // Still needed for the ⋯ menu's "Repeat" entry, which is now the only way in
  // from a row — the badge that used to be a button is plain text in `middle`.
  const recurrence = useRecurrence();

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

  // No p-4: the padding belongs to the block inside, which is the only child.
  //
  // CORRECTED: this briefly said the padding belonged to "the two columns
  // inside, because the right-hand rail needs its dividing line to run the full
  // height of the row". There is no rail any more — see the controls row below.
  const rowClasses = [
    'bg-[var(--bg-card)] border border-[var(--border-subtle)]',
    'rounded-lg',
    'shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)]',
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

  const { workspace, categoryName } = placementParts(task, workspaces, categories);

  // The middle of the meta line: everything that is true of this task and is
  // NOT its room or its date. It is one joined string on purpose — it is the
  // only part allowed to truncate, and three separate elements could each be
  // half-cut instead of the sentence ending cleanly in an ellipsis.
  //
  // «Λήφθηκε» stayed after the owner asked for it back («το ληφθηκε αστο στα
  // hostaway το θελω μου αρέσει τελικα»); it is the one fact a Hostaway task
  // carries that its due date does not.
  //
  // The ↻ is text here rather than the button it used to be. Nothing was lost:
  // the ⋯ menu opens the same rule editor, and a button inside a line that can
  // be cut in half is a target that sometimes is not there.
  const middle = [
    categoryName,
    showCreated && (task.created_at || task.created_time)
      ? t('browse.created_on', { date: formatDate((task.created_at || task.created_time).slice(0, 10)) })
      : null,
    progress ? `${progress.done}/${progress.total}` : null,
    task.recurrence_rule_id ? '↻' : null,
    task.category === 'Hostaway' && task.hostaway_created_at
      ? t('task.received_at', { time: roundToNearestHalfHour(task.hostaway_created_at) })
      : null,
    isPending ? t('task.pending') : null,
  ].filter(Boolean).join(' · ');

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
      {/* The circle, the title, the line of facts, and the controls under them. */}
      <div className="flex items-start gap-2 py-[9px] px-2.5">
        <button
          type="button"
          data-no-toggle
          onClick={(e) => { e.stopPropagation(); actions.toggleComplete(variant); }}
          style={
            isCompleted
              ? undefined
              : { borderWidth: RING_WIDTH, borderColor: priorityColor(task.priority) }
          }
          className={`tap-44 w-[18px] h-[18px] mt-[3px] rounded-full flex-shrink-0 flex items-center justify-center border-solid transition-all
            ${isCompleted
              ? 'bg-[var(--success)] border-2 border-[var(--success)]'
              : 'hover:opacity-70'}`}
          aria-label={
            variant === 'inbox'
              ? t('actions.approve')
              : `${isCompleted ? t('task.mark_incomplete') : t('task.mark_complete')} — ${t('task.priority_aria', { priority: priorityLabel(task.priority) })}`
          }
        >
          {isCompleted && <CheckIcon className="w-3 h-3 text-white" />}
        </button>

        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className={`flex-1 min-w-0 truncate text-[14px] leading-[1.32] font-medium ${isCompleted ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
              {task.task_name}
            </h3>

            {/* Beside the title rather than down in the line below, which is
                where it used to be: that line can no longer wrap, so a face in
                it was one more thing competing for the width the date needs.
                Drawn only in a room with somebody else in it — on a solo
                account your own initials on every row are decoration. */}
            {isSharedRoom && responsibleId && (
              <Avatar
                member={assignee}
                userId={responsibleId}
                size="xs"
                unknownLabel={t('members.former_member')}
              />
            )}
          </div>

          {/* ONE LINE, AND THE ORDER IS THE GUARANTEE.
              The workspace pill and the date are flex-none — they never shrink,
              so "which room" and "when" are on screen whatever else is. Only the
              middle takes flex-1 and truncates, and only when it genuinely does
              not fit. The owner asked for this after seeing an earlier draft cut
              the date off: «κατω θελω σιγουρα να βλεπω ημερομηνια ωρα και χωρο
              κατηγορια». Something must give when four things share ~271px on a
              phone; the category is the one that, cut, still leaves its first
              letters AND the room's colour beside it. */}
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden text-[11px] leading-[1.3]">
            {/* ALWAYS a pill, including «Αταξινόμητα».
                It used to be bare text in that one case, so a list mixing filed
                and unfiled tasks showed two different shapes for the same fact
                and the eye had to work out they were the same kind of thing.
                An unfiled task simply sets no --ws-color, and the token's own
                neutral default takes over — which is the same thing RoomTitle
                does for a workspace with no colour of its own. */}
            <span
              className="ws-pill flex-none inline-flex items-center gap-1 max-w-[45%] rounded-full pl-1.5 pr-2 py-px font-semibold"
              style={workspace?.color ? { '--ws-color': workspace.color } : undefined}
            >
              <span className="ws-dot w-1.5 h-1.5 rounded-full flex-shrink-0" aria-hidden="true" />
              <span className="truncate">{workspace ? workspace.name : t('workspace.unfiled')}</span>
            </span>

            {/* ALWAYS RENDERED, even when there is nothing to put in it.
                An empty middle used to be skipped, and then nothing pushed the
                date away from the pill — so a task with no category showed its
                date halfway along the line while the one under it showed it at
                the far right. Reading down a list, the dates wandered. The
                owner: «να ειναι παντα στην ιδια σειρα, γτ τωρα η ημερομηνια και
                η ωρα σε καπια δεν ειναι στο ιδιο σημειο». This span takes the
                slack in every row, so every date ends at the same edge and they
                read as a column.

                There was a « · » between this and the date for one commit. Once
                the slack sits between them they can be half a screen apart, and
                a separator with nothing on one side of it is just a mark stuck
                to the date — visible in the owner's screenshot as an orphan dot.
                The gap separates them; nothing else has to. */}
            <span className="flex-1 min-w-0 truncate text-[var(--text-secondary)]">{middle}</span>

            <span className={`flex-none ${task.due_date ? DUE_TONE_CLASSES[tone] : 'text-[var(--text-muted)]'}`}>
              {task.due_date ? formatDate(task.due_date, task.due_time) : t('task.no_date')}
            </span>

            {/* THE CONTROLS SHARE THE FACTS LINE — third arrangement, and his.
                They were mixed in among wrapping chips, then a stacked column
                on the right, then their own line underneath. The column was too
                tall; the line underneath left a hole at the bottom left of every
                card, which is what his screenshot showed: the date hard right on
                one line, the controls hard right on the next, and nothing
                between them.

                On one line there is no hole and the card loses a row entirely.
                The date stops flying to the screen edge too — it now sits beside
                the controls, a sensible distance from what it belongs to.

                THE DATES STILL LINE UP, which was the whole point of the
                previous fix: this group is flex-none and always exactly the same
                width, so every date ends at the same x.

                What this gives up is the clean separation the column bought.
                The difference from the FIRST arrangement, which he rejected, is
                that these three are one group at the end after a gap, rather
                than interleaved with the facts. */}
            <span
              data-no-toggle
              onClick={(e) => e.stopPropagation()}
              className="flex-none flex items-center gap-2 ml-1 -mr-0.5"
            >
              <button
                type="button"
                data-no-toggle
                onClick={handleToggleNotify}
                aria-pressed={notifyOn}
                // Carries the reason, so hovering on a desktop and a screen
                // reader anywhere both get it without having to tap and find out.
                title={task.due_time ? undefined : t('task.no_time_for_reminder')}
                aria-label={task.due_time ? t('task.notification_label') : t('task.no_time_for_reminder')}
                className={`tap-40 p-0.5 rounded transition-colors ${
                  notifyOn ? 'text-[var(--brand-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
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
                className={`tap-40 p-0.5 rounded transition-colors ${
                  calendarOn ? 'text-[var(--brand-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {calendarOn ? <CalendarFilledIcon className="w-4 h-4" /> : <CalendarIcon className="w-4 h-4" />}
              </button>

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
            </span>
          </div>

          {/* THE HANDOVER STRIP. Drawn only for the person who is owed the
              news — the creator or the assignee, never the colleague who did
              the closing, for whom the task left every list the moment they
              ticked it.

              It sits INSIDE the row rather than being a dialog on top of the
              app, which was the alternative and was rejected with the owner:
              a popup that is dismissed in a hurry is gone, and what it was
              telling you is gone with it. Here the task is simply still there,
              struck through, until it is acknowledged — so missing it costs
              nothing and reading it later still works.

              data-no-toggle and stopPropagation so pressing OK does not also
              open the task sheet, the same guard the controls line uses. */}
          {handover && (
            <div
              data-no-toggle
              onClick={(e) => e.stopPropagation()}
              className="mt-1 flex items-center gap-2 rounded-md bg-[var(--bg-hover)] pl-2 pr-1 py-1"
            >
              <span className="flex-1 min-w-0 truncate text-[11px] leading-[1.3] text-[var(--text-secondary)]">
                {t('handover.closed_by', {
                  name: closedBy?.display_name || t('members.former_member'),
                  when: formatStamp(task.completed_at),
                })}
              </span>
              <button
                type="button"
                data-no-toggle
                onClick={actions.acknowledge}
                disabled={actions.isAcknowledging}
                className="tap-40 flex-none px-2.5 py-0.5 rounded text-[11px] font-semibold text-white bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] disabled:opacity-60"
              >
                {t('handover.ok')}
              </button>
            </div>
          )}

          {(actions.actionError || actions.deleteError) && (
            <p className="mt-1 text-[11px] text-[var(--danger)]">
              {actions.actionError
                ? `${t('errors.failed_update')}: ${actions.actionError}`
                : `${t('errors.failed_delete')}: ${actions.deleteError}`}
            </p>
          )}

        </div>
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
