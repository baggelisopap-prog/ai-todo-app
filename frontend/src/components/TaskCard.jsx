import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteTask, agentEditTask } from '../api';
import { formatDate, roundToNearestHalfHour } from '../utils/formatDate';
import { priorityColor } from '../utils/priorityColor';
import CustomSelect from './CustomSelect';
import { SparkleIcon, SpinnerIcon } from './icons';

// The card used to print the raw enum — "Business" — while the filter pills in
// Browse showed "Επαγγελματικά" for the same thing. Same concept, two names, in
// the same language. Reuses the keys those pills already use rather than
// inventing a second set.
const CATEGORY_LABEL_KEYS = {
  Business: 'browse.filter_business',
  Personal: 'browse.filter_personal',
  Unknown: 'browse.filter_unknown',
  Hostaway: 'browse.filter_hostaway',
};

function categoryColor(category) {
  switch (category) {
    case 'Business':
      return 'var(--category-business)';
    case 'Personal':
      return 'var(--category-personal)';
    case 'Hostaway':
      return 'var(--category-hostaway)';
    default:
      return 'var(--category-unknown)';
  }
}

const ACTION_TOAST_KEYS = {
  approve: 'toast.approved',
  uncomplete: 'toast.uncompleted',
  reject: 'toast.rejected',
  unreject: 'toast.unrejected',
};

// Field → existing translation key, for rendering what the agent changed.
// Reuses the labels already on the edit form so the diff names each field the
// same way the field above it does.
const AGENT_FIELD_LABELS = {
  task_name: 'task.name_placeholder',
  description: 'task.description_label',
  category: 'task.category_label',
  priority: 'task.priority_label',
  due_date: 'task.due_date_label',
  due_time: 'task.due_time_label',
  checklist: 'task.checklist_label',
  approval_status: 'task.agent_field_approved',
  is_completed: 'task.agent_field_completed',
  notify_enabled: 'task.agent_field_notify',
  calendar_sync_enabled: 'task.agent_field_calendar',
};

function formatAgentValue(field, value, t) {
  if (value === null || value === undefined || value === '') return t('task.agent_value_empty');
  if (field === 'checklist') return t('task.agent_value_items', { count: value.length });
  if (typeof value === 'boolean') return t(value ? 'task.agent_value_yes' : 'task.agent_value_no');
  if (field === 'due_date') return formatDate(value);
  return String(value);
}

/**
 * The chips offered under the agent's input while it is empty. Two rules
 * shaped this list.
 *
 * They are derived from THIS task's state, not fixed: offering "set it for
 * the morning" on a task that already has a time, or a relative nudge on one
 * with no date to nudge, teaches the wrong thing about what the box accepts.
 *
 * And they are ALL date/time. Chips for priority, completion or the reminder
 * were written and then removed: each would spend a model call and a write on
 * something the dropdown, the ○ button and the bell already do in one tap for
 * zero tokens — the same objection DECISIONS.md raises against an "add a
 * task" chip in the chat agent. Rescheduling is where typing genuinely beats
 * the form, because "next week" costs a date picker and a bit of mental
 * arithmetic, so that is what the chips advertise.
 *
 * Each chip's label IS the instruction sent, so there is no second string to
 * keep in step with it.
 */
function agentSuggestionKeys(task) {
  const keys = [];
  if (task.due_date) {
    keys.push('task.agent_sug_day_later', 'task.agent_sug_next_week');
  } else {
    keys.push('task.agent_sug_tomorrow', 'task.agent_sug_next_week');
  }
  keys.push(task.due_time ? 'task.agent_sug_hour_earlier' : 'task.agent_sug_morning');
  return keys;
}

/**
 * The expanded card's edit form state, built from a task. Extracted because
 * it is now needed in two places: when the card opens, and again after the
 * inline agent edits the task — the open draft still holds the PRE-edit
 * values at that point, and leaving it would mean the next Save writes them
 * straight back over what the agent just changed.
 */
function draftFromTask(task) {
  return {
    task_name: task.task_name,
    description: task.description || '',
    category: task.category,
    priority: task.priority,
    due_date: task.due_date || '',
    due_time: task.due_time || '',
    checklist: [...(task.checklist || [])],
  };
}

function TaskCard({ task, variant = 'default', isExpanded, onToggleExpand, onUpdate, onTaskDeleted, onShowToast }) {
  const { t } = useTranslation();

  const [pendingAction, setPendingAction] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [draft, setDraft] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [optimisticChecklist, setOptimisticChecklist] = useState(null);
  const [pendingToggleIdx, setPendingToggleIdx] = useState(null);
  const [toggleError, setToggleError] = useState(null);

  const [optimisticCompleted, setOptimisticCompleted] = useState(null);

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Natural-language editing of THIS task (see task_agent.py). agentNote holds
  // the agent's own reply when it did NOT change anything — it asked a
  // question, or found nothing to do — which belongs next to the input the
  // user is about to correct, not in a toast that disappears.
  const [agentInput, setAgentInput] = useState('');
  const [isAgentBusy, setIsAgentBusy] = useState(false);
  const [agentNote, setAgentNote] = useState(null);
  const [agentError, setAgentError] = useState(null);
  // What the last edit actually changed, rendered as a before → after list
  // under the input. The toast carries the UNDO (it survives the card being
  // collapsed); this carries the DETAIL, which the toast has no room for and
  // which disappears with it after 7 seconds while the card stays open.
  const [agentResult, setAgentResult] = useState(null);

  const cardRef = useRef(null);
  const menuRef = useRef(null);

  const isPending = !task.approval_status;
  const isCompleted = optimisticCompleted ?? task.is_completed;
  const isRejected = task.is_rejected;
  // Editing a task that is waiting for approval — by Save or by the inline
  // agent — approves it: opening it, changing something and confirming IS the
  // review, and making the user then hunt for the ○ asks them to say yes
  // twice. Same rule the ○ already applies when completing a pending task.
  // Rejected tasks are excluded: rejecting only sets is_rejected and leaves
  // approval_status false, so without this a rejected task would come back
  // approved-but-still-rejected merely for being edited.
  const approvesOnEdit = isPending && !isRejected;
  const displayChecklist = optimisticChecklist ?? task.checklist;
  const showDescription = task.description && task.description !== task.task_name;

  const categoryOptions = [
    { value: 'Business', label: t('browse.filter_business') },
    { value: 'Personal', label: t('browse.filter_personal') },
    { value: 'Unknown', label: t('browse.filter_unknown') },
    { value: 'Hostaway', label: t('browse.filter_hostaway') },
  ];

  const priorityOptions = [
    { value: 'P1', label: 'P1' },
    { value: 'P2', label: 'P2' },
    { value: 'P3', label: 'P3' },
  ];

  useEffect(() => {
    if (isExpanded) {
      setDraft(draftFromTask(task));
      setSaveError(null);
    } else {
      setDraft(null);
      setSaveError(null);
    }
    setAgentInput('');
    setAgentNote(null);
    setAgentError(null);
    setAgentResult(null);
  }, [isExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isExpanded) return;
    function handleClickOutside(e) {
      if (cardRef.current && !cardRef.current.contains(e.target)) {
        if (isSaving) return;
        onToggleExpand(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExpanded, isSaving, onToggleExpand]);

  useEffect(() => {
    if (!isMenuOpen) return;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  function handleCardClick(e) {
    const tag = e.target.tagName;
    if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(tag)) {
      return;
    }
    if (e.target.closest('[data-no-toggle]')) {
      return;
    }
    onToggleExpand(task.record_id);
  }

  function handleCancel(e) {
    if (e) e.stopPropagation();
    onToggleExpand(null);
  }

  async function handleSave(e) {
    e.stopPropagation();
    setIsSaving(true);
    setSaveError(null);

    const updates = {
      task_name: draft.task_name,
      description: draft.description,
      category: draft.category,
      priority: draft.priority,
      due_date: draft.due_date || null,
      due_time: draft.due_time || null,
      checklist: draft.checklist,
      // See approvesOnEdit. The button says so (actions.save_approve) — a
      // silent approval would be a side effect nobody asked for.
      ...(approvesOnEdit ? { approval_status: true } : {}),
    };

    try {
      await onUpdate(task.record_id, updates);
      if (approvesOnEdit) onShowToast('toast.approved', 'success');
      onToggleExpand(null);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleNotify(e) {
    e.stopPropagation();
    if (!task.due_time) {
      onShowToast('task.no_time_for_reminder', 'neutral');
      return;
    }
    try {
      await onUpdate(task.record_id, { notify_enabled: !task.notify_enabled });
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function handleToggleCalendarSync(e) {
    e.stopPropagation();
    // Unlike the reminder bell (which needs a due_time), calendar sync only
    // needs a due_date — a task with no due_time still syncs as an all-day event.
    if (!task.due_date) {
      onShowToast('calendar.no_date_for_sync', 'neutral');
      return;
    }
    try {
      await onUpdate(task.record_id, { calendar_sync_enabled: !task.calendar_sync_enabled });
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function handleAction(actionName, updates) {
    setIsMenuOpen(false);
    setPendingAction(actionName);
    setActionError(null);
    try {
      await onUpdate(task.record_id, updates);
      onShowToast(ACTION_TOAST_KEYS[actionName], 'success');
    } catch (err) {
      setActionError(err.message);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCircleClick(e) {
    e.stopPropagation();
    if (variant === 'inbox') {
      setActionError(null);
      try {
        await onUpdate(task.record_id, { approval_status: true });
        onShowToast('toast.approved', 'success');
      } catch (err) {
        setActionError(err.message);
      }
      return;
    }
    const newValue = !task.is_completed;
    setOptimisticCompleted(newValue);
    setActionError(null);
    try {
      await onUpdate(task.record_id, {
        is_completed: newValue,
        ...(newValue && isPending ? { approval_status: true } : {}),
      });
      setOptimisticCompleted(null);
      onShowToast(newValue ? 'toast.completed' : 'toast.uncompleted', 'success');
    } catch (err) {
      setOptimisticCompleted(null);
      setActionError(err.message);
    }
  }

  async function handleToggleChecklistItem(idx) {
    const newChecklist = task.checklist.map((it, i) =>
      i === idx ? { ...it, done: !it.done } : it
    );
    setOptimisticChecklist(newChecklist);
    setPendingToggleIdx(idx);
    setToggleError(null);

    // One-direction only: checking the last remaining item auto-completes the
    // task, mirroring the main completion circle. Unchecking an item never
    // auto-uncompletes it, since a user may have intentionally completed a
    // task with some items left unchecked.
    const shouldAutoComplete = newChecklist.every((it) => it.done) && !task.is_completed;

    try {
      await onUpdate(task.record_id, {
        checklist: newChecklist,
        ...(shouldAutoComplete ? { is_completed: true, ...(isPending ? { approval_status: true } : {}) } : {}),
      });
      setOptimisticChecklist(null);
      if (shouldAutoComplete) {
        onShowToast('toast.completed', 'success');
      }
    } catch (err) {
      setOptimisticChecklist(null);
      setToggleError(err.message);
    } finally {
      setPendingToggleIdx(null);
    }
  }

  async function handleDelete() {
    setIsMenuOpen(false);
    const confirmed = window.confirm(t('confirm.delete_task'));
    if (!confirmed) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      const { calendar } = await deleteTask(task.record_id);
      onTaskDeleted(task.record_id);
      if (calendar === 'kept_google_origin') {
        // Not a failure — this task came FROM Google Calendar, so the event
        // there is not ours to delete. Said plainly, and given longer to read
        // than a one-word toast, because the user WILL still see it in Google.
        onShowToast({
          message: t('toast.deleted_calendar_kept'),
          variant: 'neutral',
          duration: 7000,
        });
      } else if (calendar === 'delete_failed') {
        onShowToast({
          message: t('toast.deleted_calendar_failed'),
          variant: 'error',
          duration: 7000,
        });
      } else {
        onShowToast('toast.deleted', 'success');
      }
    } catch (err) {
      setDeleteError(err.message);
      setIsDeleting(false);
    }
  }

  function handleEdit() {
    setIsMenuOpen(false);
    onToggleExpand(task.record_id);
  }

  /**
   * Natural-language edit of THIS task. The backend returns a validated PLAN
   * and writes nothing — the change is applied here through the same onUpdate
   * the manual form uses, so there is one write path, not two (see
   * main.py's /tasks/{id}/agent-edit and task_agent.py).
   */
  async function handleAgentEdit(presetInstruction) {
    // Called both from the input (no argument) and from a suggestion chip,
    // which passes its own label — the chip's text IS the instruction, so
    // there is no separate string to keep in step with the label.
    const instruction = (typeof presetInstruction === 'string' ? presetInstruction : agentInput).trim();
    if (!instruction || isAgentBusy) return;

    setIsAgentBusy(true);
    setAgentNote(null);
    setAgentError(null);
    setAgentResult(null);
    try {
      const plan = await agentEditTask(task.record_id, instruction);

      if (plan.action === 'delete') {
        // The one action here that is NOT undoable — the row is gone for
        // good. Routed through the existing handleDelete so it gets the same
        // confirmation dialog and the same calendar-outcome toast as deleting
        // from the ⋮ menu, rather than a second delete path to keep in step.
        // The typed text is deliberately NOT cleared: the confirmation can be
        // declined, and clearing it would leave the user with nothing after
        // they said no.
        await handleDelete();
        return;
      }

      if (plan.action === 'unclear' || plan.action === 'none') {
        // Deliberately keeps what the user typed: they are one word away from
        // an instruction that works, and clearing it would make them retype.
        setAgentNote(plan.message);
        return;
      }

      // An agent edit approves a pending task exactly as Save does — see
      // approvesOnEdit. Note WHERE this is added: here, in the UI, not in the
      // plan the backend returned. task_agent deliberately cannot touch
      // approval_status (see its TASK_AGENT_WRITABLE_FIELDS) and that stays
      // true — the model never proposes an approval. What approves the task is
      // the USER choosing to edit it from its own card, so the decision is the
      // client's to add, not the model's to make.
      const approving = approvesOnEdit;
      const fields = approving ? { ...plan.fields, approval_status: true } : plan.fields;
      // Undo must put back everything this action changed, the approval
      // included — otherwise "undo" would quietly leave the task approved and
      // out of the Inbox after restoring its old values.
      const before = approving ? { ...plan.before, approval_status: false } : plan.before;

      const updated = await onUpdate(task.record_id, fields);
      setAgentInput('');
      setDraft(draftFromTask(updated));
      setAgentResult({
        message: plan.message,
        changes: Object.keys(fields).map((field) => ({
          field,
          before: formatAgentValue(field, before[field], t),
          after: formatAgentValue(field, fields[field], t),
        })),
      });

      const dropped = plan.invalid || [];
      const notes = [
        approving ? t('task.agent_approved_too') : null,
        dropped.length ? t('task.agent_skipped', { fields: dropped.join(', ') }) : null,
      ].filter(Boolean);
      onShowToast({
        message: notes.length ? `${plan.message} (${notes.join(' · ')})` : plan.message,
        variant: 'success',
        duration: 7000,
        action: {
          label: t('task.agent_undo'),
          // `before` is built server-side from what the database actually
          // held, not from this card's rendered state, so an undo restores
          // the real previous values even if the card was stale.
          onClick: () => {
            onUpdate(task.record_id, before)
              .then((reverted) => {
                setDraft(draftFromTask(reverted));
                // The change list describes an edit that no longer exists.
                setAgentResult(null);
              })
              .catch(() => {});
          },
        },
      });
    } catch (err) {
      setAgentError(err.message);
    } finally {
      setIsAgentBusy(false);
    }
  }

  function updateDraft(field, value) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  function updateChecklistItem(index, value) {
    setDraft((d) => ({
      ...d,
      checklist: d.checklist.map((item, i) => (i === index ? value : item)),
    }));
  }

  function addChecklistItem() {
    setDraft((d) => ({ ...d, checklist: [...d.checklist, { text: '', done: false }] }));
  }

  function removeChecklistItem(index) {
    setDraft((d) => ({
      ...d,
      checklist: d.checklist.filter((_, i) => i !== index),
    }));
  }

  const cardClasses = [
    'bg-[var(--bg-card)] border border-[var(--border-subtle)]',
    'rounded-lg p-4 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)]',
    'transition-shadow cursor-pointer',
    isExpanded ? 'ring-2 ring-[var(--border-focus)]/20' : '',
    isRejected ? 'opacity-60' : isCompleted ? 'opacity-70' : '',
  ].filter(Boolean).join(' ');

  const titleClasses = [
    'text-base font-medium text-[var(--text-primary)] break-words',
    isCompleted ? 'line-through text-[var(--text-muted)]' : '',
  ].filter(Boolean).join(' ');

  return (
    <article ref={cardRef} onClick={handleCardClick} className={cardClasses}>
      {/* === COLLAPSED VIEW === */}
      {!isExpanded && (
        <>
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={handleCircleClick}
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
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: priorityColor(task.priority) }}
                  aria-label={t('task.priority_aria', { priority: task.priority })}
                />
                <h3 className={titleClasses}>{task.task_name}</h3>
              </div>

              {showDescription && (
                <p className="text-sm text-[var(--text-secondary)] mt-1 ml-6 truncate">
                  {task.description}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 mt-2 ml-6 text-xs text-[var(--text-secondary)]">
                {task.due_date && (
                  <span className="flex items-center gap-1">
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
                    {CATEGORY_LABEL_KEYS[task.category] ? t(CATEGORY_LABEL_KEYS[task.category]) : task.category}
                  </span>
                )}
                {task.category === 'Hostaway' && task.hostaway_created_at && (
                  <span className="text-xs text-[var(--text-muted)]">
                    {t('task.received_at', { time: roundToNearestHalfHour(task.hostaway_created_at) })}
                  </span>
                )}
                {isPending && (
                  <span className="text-[var(--priority-p2)] font-medium">{t('task.pending')}</span>
                )}
                <button
                  type="button"
                  onClick={handleToggleNotify}
                  className={`tap-40 p-1 -m-1 rounded transition-colors ${
                    !task.due_time
                      ? 'text-[var(--text-muted)] opacity-40'
                      : task.notify_enabled
                        ? 'text-[var(--brand-primary)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                  aria-label={
                    !task.due_time
                      ? t('task.no_time_for_reminder')
                      : task.notify_enabled
                        ? t('task.notification_on')
                        : t('task.notification_off')
                  }
                >
                  {task.notify_enabled && task.due_time ? (
                    <BellFilledIcon className="w-4 h-4" />
                  ) : (
                    <BellOutlineIcon className="w-4 h-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleToggleCalendarSync}
                  className={`tap-40 p-1 -m-1 rounded transition-colors ${
                    !task.due_date
                      ? 'text-[var(--text-muted)] opacity-40'
                      : task.calendar_sync_enabled
                        ? 'text-[var(--brand-primary)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                  aria-label={!task.due_date ? t('calendar.no_date_for_sync') : t('calendar.sync_task_tooltip')}
                >
                  {task.calendar_sync_enabled && task.due_date ? (
                    <CalendarFilledIcon className="w-4 h-4" />
                  ) : (
                    <CalendarIcon className="w-4 h-4" />
                  )}
                </button>
              </div>

              {displayChecklist && displayChecklist.length > 0 && (
                <ul className="mt-3 space-y-0.5 ml-6">
                  {displayChecklist.map((item, index) => (
                    <li key={index} className="text-xs">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleChecklistItem(index);
                        }}
                        disabled={pendingToggleIdx !== null}
                        className="flex items-center gap-2 w-full text-left py-0.5 px-2 hover:bg-[var(--bg-hover)] rounded transition-colors disabled:cursor-wait"
                      >
                        {item.done ? <CheckedBox /> : <EmptyBox />}
                        <span className={item.done ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}>
                          {item.text}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {toggleError && (
                <div className="mt-1 ml-6 text-xs text-[var(--danger)]">
                  {t('errors.failed_update')}: {toggleError}
                </div>
              )}

              {actionError && (
                <div className="mt-2 ml-6 text-xs text-[var(--danger)]">
                  {t('errors.failed_update')}: {actionError}
                </div>
              )}

              {deleteError && (
                <div className="mt-2 ml-6 text-xs text-[var(--danger)]">
                  {t('errors.failed_delete')}: {deleteError}
                </div>
              )}
            </div>

            <TaskMenu
              menuRef={menuRef}
              isOpen={isMenuOpen}
              onToggle={() => setIsMenuOpen((v) => !v)}
              isPending={isPending}
              isCompleted={isCompleted}
              isRejected={isRejected}
              pendingAction={pendingAction}
              onApprove={() => handleAction('approve', { approval_status: true })}
              onUncomplete={() => handleAction('uncomplete', { is_completed: false })}
              onReject={() => handleAction('reject', { is_rejected: true })}
              onUnreject={() => handleAction('unreject', { is_rejected: false })}
              onEdit={handleEdit}
              onDelete={handleDelete}
              t={t}
            />
          </div>
        </>
      )}

      {/* === EXPANDED VIEW === */}
      {isExpanded && draft && (
        <div
          data-no-toggle
          className="space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={handleCircleClick}
              className={`w-5 h-5 mt-2 rounded-full flex-shrink-0 flex items-center justify-center transition-all
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
            <input
              type="text"
              value={draft.task_name}
              onChange={(e) => updateDraft('task_name', e.target.value)}
              placeholder={t('task.name_placeholder')}
              className={`w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[color:var(--ring-soft)] transition-colors ${isCompleted ? 'line-through' : ''}`}
            />
            <TaskMenu
              menuRef={menuRef}
              isOpen={isMenuOpen}
              onToggle={() => setIsMenuOpen((v) => !v)}
              isPending={isPending}
              isCompleted={isCompleted}
              isRejected={isRejected}
              pendingAction={pendingAction}
              onApprove={() => handleAction('approve', { approval_status: true })}
              onUncomplete={() => handleAction('uncomplete', { is_completed: false })}
              onReject={() => handleAction('reject', { is_rejected: true })}
              onUnreject={() => handleAction('unreject', { is_rejected: false })}
              onDelete={handleDelete}
              t={t}
            />
          </div>

          <Field label={t('task.description_label')}>
            <textarea
              value={draft.description}
              onChange={(e) => updateDraft('description', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[color:var(--ring-soft)] resize-none transition-colors"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('task.category_label')}>
              <CustomSelect
                value={draft.category}
                options={categoryOptions}
                onChange={(value) => updateDraft('category', value)}
                ariaLabel={t('task.category_label')}
              />
            </Field>
            <Field label={t('task.priority_label')}>
              <CustomSelect
                value={draft.priority}
                options={priorityOptions}
                onChange={(value) => updateDraft('priority', value)}
                ariaLabel={t('task.priority_label')}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('task.due_date_label')}>
              <input
                type="date"
                value={draft.due_date}
                onChange={(e) => updateDraft('due_date', e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[color:var(--ring-soft)] transition-colors"
              />
            </Field>
            <Field label={t('task.due_time_label')}>
              <input
                type="time"
                value={draft.due_time}
                onChange={(e) => updateDraft('due_time', e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[color:var(--ring-soft)] transition-colors"
              />
            </Field>
          </div>

          <Field label={t('task.checklist_label')}>
            <div className="space-y-2">
              {draft.checklist.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item.text}
                    onChange={(e) => updateChecklistItem(index, { ...item, text: e.target.value })}
                    placeholder={t('task.checklist_item_placeholder', { n: index + 1 })}
                    className="flex-1 px-3 py-1.5 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[color:var(--ring-soft)] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => removeChecklistItem(index)}
                    className="px-2 py-1.5 rounded-md text-xs text-[var(--text-secondary)] hover:text-[var(--danger)] hover:bg-[var(--bg-hover)] transition-colors"
                    title={t('task.remove_item')}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addChecklistItem}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                {t('task.add_checklist_item')}
              </button>
            </div>
          </Field>

          {/* Inline task agent. Sits with the fields it edits rather than in
              the chat modal: the task is already open and identified, so the
              agent here never has to work out WHICH task is meant — that is
              the whole reason it is a separate, much smaller agent (see
              task_agent.py). Enter submits; the card's own click handler
              already ignores INPUT/BUTTON, so typing here can't collapse it. */}
          <div
            data-no-toggle
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-3 space-y-2"
          >
            {/* Named and marked. Without this row the field was an unlabelled
                text box between two form sections, and nothing said it was a
                feature at all, let alone what it accepted. */}
            <div className="flex items-center gap-1.5 text-[var(--brand-primary)]">
              <SparkleIcon className="w-3.5 h-3.5" />
              <span className="text-[11px] font-semibold uppercase tracking-wide">
                {t('task.agent_title')}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={agentInput}
                onChange={(e) => setAgentInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAgentEdit();
                  }
                }}
                disabled={isAgentBusy || isSaving || isDeleting}
                placeholder={t('task.agent_placeholder')}
                className="flex-1 px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[color:var(--ring-soft)] disabled:opacity-60 transition-colors"
              />
              <button
                type="button"
                onClick={() => handleAgentEdit()}
                disabled={isAgentBusy || isSaving || isDeleting || !agentInput.trim()}
                className="w-10 h-10 flex items-center justify-center rounded-md text-sm font-medium bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] disabled:bg-[var(--bg-card)] disabled:text-[var(--text-muted)] disabled:cursor-not-allowed transition-colors shrink-0"
                aria-label={t('task.agent_send')}
              >
                {isAgentBusy ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : '↵'}
              </button>
            </div>

            {/* Only while there is nothing typed and nothing to report: these
                exist to show what the box accepts, and once it has been used
                that job is done. Each chip is built from THIS task's state —
                see agentSuggestionKeys. */}
            {!agentInput && !agentResult && !agentNote && !isAgentBusy && (
              <div className="flex flex-wrap gap-1.5">
                {agentSuggestionKeys(task).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleAgentEdit(t(key))}
                    disabled={isSaving || isDeleting}
                    className="px-2.5 py-1 rounded-full text-xs bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors"
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            )}

            {isAgentBusy && (
              <p className="text-xs text-[var(--text-muted)] italic">{t('task.agent_thinking')}</p>
            )}

            {/* What actually changed. The toast holds the UNDO because it
                outlives the card; this holds the detail, which the toast has
                no room for and which vanishes with it after 7 seconds. */}
            {agentResult && (
              <div className="rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)] px-3 py-2 space-y-1">
                <p className="text-xs text-[var(--text-primary)]">{agentResult.message}</p>
                {agentResult.changes.map((c) => (
                  <div key={c.field} className="flex items-baseline gap-2 text-[11px]">
                    <span className="text-[var(--text-muted)] shrink-0">
                      {t(AGENT_FIELD_LABELS[c.field] || c.field)}
                    </span>
                    <span className="text-[var(--text-muted)] line-through">{c.before}</span>
                    <span className="text-[var(--text-muted)]">→</span>
                    <span className="text-[var(--text-primary)] font-medium">{c.after}</span>
                  </div>
                ))}
              </div>
            )}

            {/* The agent asked something back, or found nothing to do. Shown
                as its own line next to the input the user is about to fix. */}
            {agentNote && (
              <p className="text-xs text-[var(--text-secondary)] flex items-start gap-1.5">
                <SparkleIcon className="w-3 h-3 mt-0.5 shrink-0 text-[var(--brand-primary)]" />
                <span>{agentNote}</span>
              </p>
            )}
            {agentError && (
              <p className="text-xs text-[var(--danger)]">
                {t('errors.failed_update')}: {agentError}
              </p>
            )}
          </div>

          {saveError && (
            <div className="text-xs text-[var(--danger)]">
              {t('errors.failed_save')}: {saveError}
            </div>
          )}
          {deleteError && (
            <div className="text-xs text-[var(--danger)]">
              {t('errors.failed_delete')}: {deleteError}
            </div>
          )}
          {actionError && (
            <div className="text-xs text-[var(--danger)]">
              {t('errors.failed_update')}: {actionError}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isDeleting || !draft.task_name.trim()}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-muted)] disabled:cursor-not-allowed transition-colors"
            >
              {isSaving
                ? t('actions.saving')
                : approvesOnEdit ? t('actions.save_approve') : t('actions.save')}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving || isDeleting}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-transparent text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed transition-colors"
            >
              {t('actions.cancel')}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function TaskMenu({
  menuRef,
  isOpen,
  onToggle,
  isPending,
  isCompleted,
  isRejected,
  pendingAction,
  onApprove,
  onUncomplete,
  onReject,
  onUnreject,
  onEdit,
  onDelete,
  t,
}) {
  return (
    <div className="relative flex-shrink-0" data-no-toggle ref={menuRef}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={t('menu.open_menu')}
        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        <DotsIcon />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-[var(--shadow-menu)] py-1 overflow-hidden">
          {isPending && (
            <MenuItem
              label={pendingAction === 'approve' ? t('actions.approving') : t('actions.approve')}
              disabled={pendingAction !== null}
              onClick={onApprove}
            />
          )}
          {isCompleted && (
            <MenuItem
              label={pendingAction === 'uncomplete' ? t('actions.uncompleting') : t('actions.uncomplete')}
              disabled={pendingAction !== null}
              onClick={onUncomplete}
            />
          )}
          {!isRejected && (
            <MenuItem
              label={pendingAction === 'reject' ? t('actions.rejecting') : t('actions.reject')}
              disabled={pendingAction !== null}
              onClick={onReject}
            />
          )}
          {isRejected && (
            <MenuItem
              label={pendingAction === 'unreject' ? t('actions.unrejecting') : t('actions.unreject')}
              disabled={pendingAction !== null}
              onClick={onUnreject}
            />
          )}
          {onEdit && (
            <MenuItem label={t('actions.edit')} onClick={onEdit} />
          )}
          <hr className="my-1 border-[var(--border-subtle)]" />
          <MenuItem label={t('actions.delete')} onClick={onDelete} danger />
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, disabled, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`block w-full text-left px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[var(--bg-hover)] ${
        danger ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]'
      }`}
    >
      {label}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--text-secondary)] font-medium uppercase tracking-wide block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function EmptyBox() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 text-[var(--border-medium)]">
      <rect x="1" y="1" width="12" height="12" rx="2" />
    </svg>
  );
}

function CheckedBox() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
      <rect x="1" y="1" width="12" height="12" rx="2" fill="var(--success)" />
      <path d="M3.5 7L5.5 9.5L10.5 4.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon({ className }) {
  return (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M3 7L5.5 9.5L11 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon({ className }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function CalendarFilledIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M8 2a1 1 0 0 1 1 1v1h6V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1zM4.75 9.5v10.25c0 .414.336.75.75.75h13a.75.75 0 0 0 .75-.75V9.5H4.75z" clipRule="evenodd" />
    </svg>
  );
}

function BellOutlineIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function BellFilledIcon({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M10 2a6 6 0 00-6 6c0 1.887-.454 3.665-1.257 5.234a.75.75 0 00.515 1.076 32.91 32.91 0 003.256.508 3.5 3.5 0 006.972 0 32.903 32.903 0 003.256-.508.75.75 0 00.515-1.076A11.448 11.448 0 0116 8a6 6 0 00-6-6zM8.05 14.943a33.54 33.54 0 003.9 0 2 2 0 01-3.9 0z" clipRule="evenodd" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  );
}

export default TaskCard;
