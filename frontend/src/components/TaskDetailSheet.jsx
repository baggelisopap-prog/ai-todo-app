import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { agentEditTask } from '../api';
import { formatDate } from '../utils/formatDate';
import { priorityColor } from '../utils/priorityColor';
import { categoryColor, categoryLabel, dueTone, DUE_TONE_CLASSES, priorityLabel } from '../utils/taskDisplay';
import { useModalBehavior } from '../hooks/useModalBehavior';
import { useTaskActions } from '../hooks/useTaskActions';
import CustomSelect from './CustomSelect';
import Switch from './Switch';
import TaskMenu from './TaskMenu';
import { SparkleIcon, SpinnerIcon } from './icons';
import { CheckIcon, CheckedBox, EmptyBox } from './TaskIcons';

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
 * something the dropdown, the ○ button and the switch already do in one tap for
 * zero tokens. Rescheduling is where typing genuinely beats the form, because
 * "next week" costs a date picker and a bit of mental arithmetic.
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

const INPUT_CLASSES =
  'w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[color:var(--ring-soft)] transition-colors';

/**
 * A task, opened.
 *
 * The change this makes is that it READS before it edits. Tapping a task used
 * to drop you straight into a form — name input, two selects, date and time
 * pickers, a checklist editor and a Save button — which is an intimidating
 * answer to "what is this task?", and meant an accidental tap on a row (the
 * whole row is tappable) put you in an editing context. Now the tap opens this,
 * and editing is a button you choose to press.
 *
 * It is a bottom sheet rather than the old expand-in-place, because expanding
 * rewrote the list under the user's thumb and produced a card several hundred
 * pixels tall inside a scrolling list. A sheet also has room for real labels,
 * which is what lets the reminder and calendar-sync switches finally say what
 * they do — and say why they cannot act, instead of looking disabled and
 * responding anyway.
 */
function TaskDetailSheet({ task, variant = 'default', onClose, onUpdate, onTaskDeleted, onShowToast }) {
  useModalBehavior(onClose);
  const { t } = useTranslation();
  const actions = useTaskActions(task, { onUpdate, onTaskDeleted, onShowToast });
  const { isPending, isCompleted, isRejected, approvesOnEdit } = actions;

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFromTask(task));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [optimisticChecklist, setOptimisticChecklist] = useState(null);
  const [pendingToggleIdx, setPendingToggleIdx] = useState(null);
  const [toggleError, setToggleError] = useState(null);

  const [agentInput, setAgentInput] = useState('');
  const [isAgentBusy, setIsAgentBusy] = useState(false);
  const [agentNote, setAgentNote] = useState(null);
  const [agentError, setAgentError] = useState(null);
  const [agentResult, setAgentResult] = useState(null);

  const displayChecklist = optimisticChecklist ?? task.checklist;
  const showDescription = task.description && task.description !== task.task_name;
  const tone = dueTone(task);

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

  function startEditing() {
    setDraft(draftFromTask(task));
    setSaveError(null);
    setIsEditing(true);
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError(null);
    try {
      await onUpdate(task.record_id, {
        task_name: draft.task_name,
        description: draft.description,
        category: draft.category,
        priority: draft.priority,
        due_date: draft.due_date || null,
        due_time: draft.due_time || null,
        checklist: draft.checklist,
        // The button says so (actions.save_approve) — a silent approval would
        // be a side effect nobody asked for.
        ...(approvesOnEdit ? { approval_status: true } : {}),
      });
      if (approvesOnEdit) onShowToast('toast.approved', 'success');
      setIsEditing(false);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setIsSaving(false);
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
    // task, mirroring the completion circle. Unchecking never auto-uncompletes,
    // since a user may have intentionally completed a task with items left.
    const shouldAutoComplete = newChecklist.every((it) => it.done) && !task.is_completed;

    try {
      await onUpdate(task.record_id, {
        checklist: newChecklist,
        ...(shouldAutoComplete ? { is_completed: true, ...(isPending ? { approval_status: true } : {}) } : {}),
      });
      setOptimisticChecklist(null);
      if (shouldAutoComplete) onShowToast('toast.completed', 'success');
    } catch (err) {
      setOptimisticChecklist(null);
      setToggleError(err.message);
    } finally {
      setPendingToggleIdx(null);
    }
  }

  async function handleDelete() {
    const deleted = await actions.remove();
    if (deleted) onClose();
  }

  /**
   * Natural-language edit of THIS task. The backend returns a validated PLAN
   * and writes nothing — the change is applied here through the same onUpdate
   * the manual form uses, so there is one write path, not two (see
   * main.py's /tasks/{id}/agent-edit and task_agent.py).
   */
  async function handleAgentEdit(presetInstruction) {
    const instruction = (typeof presetInstruction === 'string' ? presetInstruction : agentInput).trim();
    if (!instruction || isAgentBusy) return;

    setIsAgentBusy(true);
    setAgentNote(null);
    setAgentError(null);
    setAgentResult(null);
    try {
      const plan = await agentEditTask(task.record_id, instruction);

      if (plan.action === 'delete') {
        // The one action here that is NOT undoable. Routed through the same
        // confirm-and-report path as the menu's Delete rather than a second
        // delete path to keep in step. The typed text is deliberately not
        // cleared: the confirmation can be declined.
        await handleDelete();
        return;
      }

      if (plan.action === 'unclear' || plan.action === 'none') {
        // Keeps what the user typed: they are one word away from an
        // instruction that works, and clearing it would make them retype.
        setAgentNote(plan.message);
        return;
      }

      // An agent edit approves a pending task exactly as Save does. Note WHERE
      // this is added: here, in the UI, not in the plan the backend returned.
      // task_agent deliberately cannot touch approval_status and that stays
      // true — the model never proposes an approval. What approves the task is
      // the USER choosing to edit it from its own card.
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
          // held, not from this sheet's rendered state, so an undo restores
          // the real previous values even if the view was stale.
          onClick: () => {
            onUpdate(task.record_id, before)
              .then((reverted) => {
                setDraft(draftFromTask(reverted));
                setAgentResult(null); // describes an edit that no longer exists
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

  const updateDraft = (field, value) => setDraft((d) => ({ ...d, [field]: value }));
  const updateChecklistItem = (index, value) =>
    setDraft((d) => ({ ...d, checklist: d.checklist.map((item, i) => (i === index ? value : item)) }));
  const addChecklistItem = () =>
    setDraft((d) => ({ ...d, checklist: [...d.checklist, { text: '', done: false }] }));
  const removeChecklistItem = (index) =>
    setDraft((d) => ({ ...d, checklist: d.checklist.filter((_, i) => i !== index) }));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 animate-fade-in flex items-end md:items-center justify-center md:p-4"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-lg bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={task.task_name}
      >
        {/* Header stays put while the body scrolls, so the circle and the menu
            are reachable without scrolling back up on a long task. */}
        <div className="flex items-start gap-3 p-4 border-b border-[var(--border-subtle)] flex-shrink-0">
          <button
            type="button"
            onClick={() => actions.toggleComplete(variant)}
            className={`tap-44 w-5 h-5 mt-1 rounded-full flex-shrink-0 flex items-center justify-center transition-all
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

          <h2 className={`flex-1 min-w-0 text-base font-semibold break-words ${isCompleted ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
            {task.task_name}
          </h2>

          <TaskMenu
            isPending={isPending}
            isCompleted={isCompleted}
            isRejected={isRejected}
            pendingAction={actions.pendingAction}
            onApprove={actions.approve}
            onUncomplete={actions.uncomplete}
            onReject={actions.reject}
            onUnreject={actions.unreject}
            onEdit={isEditing ? null : startEditing}
            onDelete={handleDelete}
            t={t}
          />

          <button
            type="button"
            onClick={onClose}
            className="tap-44 text-[var(--text-muted)] hover:text-[var(--text-primary)] flex-shrink-0"
            aria-label={t('actions.close')}
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {!isEditing ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-bold leading-none text-[var(--text-inverse)]"
                  style={{ backgroundColor: priorityColor(task.priority) }}
                >
                  {priorityLabel(task.priority)}
                </span>
                {task.category && (
                  <span style={{ color: categoryColor(task.category) }}>
                    {categoryLabel(task.category, t)}
                  </span>
                )}
                {task.due_date && (
                  <span className={DUE_TONE_CLASSES[tone]}>
                    {formatDate(task.due_date, task.due_time)}
                  </span>
                )}
                {isPending && (
                  <span className="text-[var(--priority-p2)] font-medium">{t('task.pending')}</span>
                )}
              </div>

              {showDescription && (
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
                  {task.description}
                </p>
              )}

              {displayChecklist && displayChecklist.length > 0 && (
                <div>
                  <p className="text-xs text-[var(--text-secondary)] font-medium uppercase tracking-wide mb-2">
                    {t('task.checklist_label')}
                  </p>
                  <ul className="space-y-0.5">
                    {displayChecklist.map((item, index) => (
                      <li key={index}>
                        <button
                          type="button"
                          onClick={() => handleToggleChecklistItem(index)}
                          disabled={pendingToggleIdx !== null}
                          className="flex items-center gap-2 w-full text-left py-1.5 px-2 rounded text-sm hover:bg-[var(--bg-hover)] transition-colors disabled:cursor-wait"
                        >
                          {item.done ? <CheckedBox /> : <EmptyBox />}
                          <span className={item.done ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}>
                            {item.text}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {toggleError && (
                    <p className="mt-1 text-xs text-[var(--danger)]">
                      {t('errors.failed_update')}: {toggleError}
                    </p>
                  )}
                </div>
              )}

              {/* The two settings that used to be dimmed-but-clickable icons in
                  the row. Here they are labelled, genuinely disabled when they
                  cannot act, and say what is missing instead of waiting to be
                  tapped before explaining. */}
              <div className="space-y-3 pt-1">
                <Switch
                  label={t('task.notification_label')}
                  checked={Boolean(task.notify_enabled && task.due_time)}
                  onChange={() => actions.setNotify(!task.notify_enabled)}
                  disabledReason={task.due_time ? null : t('task.no_time_for_reminder')}
                />
                <Switch
                  label={t('calendar.sync_task_label')}
                  checked={Boolean(task.calendar_sync_enabled && task.due_date)}
                  onChange={() => actions.setCalendarSync(!task.calendar_sync_enabled)}
                  disabledReason={task.due_date ? null : t('calendar.no_date_for_sync')}
                />
              </div>
            </>
          ) : (
            <>
              <Field label={t('task.name_placeholder')}>
                <input
                  type="text"
                  value={draft.task_name}
                  onChange={(e) => updateDraft('task_name', e.target.value)}
                  placeholder={t('task.name_placeholder')}
                  className={INPUT_CLASSES}
                />
              </Field>

              <Field label={t('task.description_label')}>
                <textarea
                  value={draft.description}
                  onChange={(e) => updateDraft('description', e.target.value)}
                  rows={3}
                  className={`${INPUT_CLASSES} resize-none`}
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
                    className={INPUT_CLASSES}
                  />
                </Field>
                <Field label={t('task.due_time_label')}>
                  <input
                    type="time"
                    value={draft.due_time}
                    onChange={(e) => updateDraft('due_time', e.target.value)}
                    className={INPUT_CLASSES}
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
                        className={`${INPUT_CLASSES} flex-1 py-1.5 text-xs`}
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
            </>
          )}

          {/* Inline task agent, in BOTH modes. It suits a reading context as
              well as an editing one — it is a sentence, not a form — and
              "move it to next week" is exactly what someone who just opened a
              task to look at it wants to say. */}
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-3 space-y-2">
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
                disabled={isAgentBusy || isSaving || actions.isDeleting}
                placeholder={t('task.agent_placeholder')}
                className={`${INPUT_CLASSES} flex-1 disabled:opacity-60`}
              />
              <button
                type="button"
                onClick={() => handleAgentEdit()}
                disabled={isAgentBusy || isSaving || actions.isDeleting || !agentInput.trim()}
                className="w-10 h-10 flex items-center justify-center rounded-md text-sm font-medium bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] disabled:bg-[var(--bg-card)] disabled:text-[var(--text-muted)] disabled:cursor-not-allowed transition-colors shrink-0"
                aria-label={t('task.agent_send')}
              >
                {isAgentBusy ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : '↵'}
              </button>
            </div>

            {!agentInput && !agentResult && !agentNote && !isAgentBusy && (
              <div className="flex flex-wrap gap-1.5">
                {agentSuggestionKeys(task).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleAgentEdit(t(key))}
                    disabled={isSaving || actions.isDeleting}
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
                outlives the sheet; this holds the detail, which the toast has
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
            <p className="text-xs text-[var(--danger)]">{t('errors.failed_save')}: {saveError}</p>
          )}
          {actions.deleteError && (
            <p className="text-xs text-[var(--danger)]">{t('errors.failed_delete')}: {actions.deleteError}</p>
          )}
          {actions.actionError && (
            <p className="text-xs text-[var(--danger)]">{t('errors.failed_update')}: {actions.actionError}</p>
          )}
        </div>

        <div className="flex items-center gap-2 p-4 border-t border-[var(--border-subtle)] flex-shrink-0">
          {!isEditing ? (
            <button
              type="button"
              onClick={startEditing}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] transition-colors"
            >
              {t('actions.edit')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || actions.isDeleting || !draft.task_name.trim()}
                className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-muted)] disabled:cursor-not-allowed transition-colors"
              >
                {isSaving
                  ? t('actions.saving')
                  : approvesOnEdit ? t('actions.save_approve') : t('actions.save')}
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                disabled={isSaving}
                className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-transparent text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed transition-colors"
              >
                {t('actions.cancel')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default TaskDetailSheet;
