import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { agentEditTask, getWorkspaceMembers } from '../api';
import { formatDate } from '../utils/formatDate';
import { priorityColor } from '../utils/priorityColor';
import { describeRecurrence, dueTone, DUE_TONE_CLASSES, priorityLabel } from '../utils/taskDisplay';
import { useModalBehavior } from '../hooks/useModalBehavior';
import { useTaskActions } from '../hooks/useTaskActions';
import { useRecurrence } from '../hooks/useRecurrence';
import CustomSelect from './CustomSelect';
import { useWorkspaces } from '../hooks/useWorkspaces';
import DictateButton from './DictateButton';
import Switch from './Switch';
import TaskMenu from './TaskMenu';
import { SparkleIcon, SpinnerIcon, SendIcon } from './icons';
import {
  CheckIcon, CheckedBox, EmptyBox,
  CalendarIcon, ChecklistIcon, ClockIcon, FlagIcon, FolderIcon, PersonIcon, TextLinesIcon,
} from './TaskIcons';

// Confirmed against a real inbox URL, not documentation: a conversation's id
// from the Hostaway API is exactly the id in this path.
const HOSTAWAY_INBOX_URL = 'https://dashboard.hostaway.com/messages/inbox';

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
    // '' rather than null, because CustomSelect's options are strings and an
    // empty value is how "Unfiled" is expressed in a <select>. handleSave
    // turns it back into a real null on the way out.
    workspace_id: task.workspace_id || '',
    category_id: task.category_id || '',
    // Same '' convention as the two above: '' is how "nobody has taken it" is
    // expressed in a <select>, and handleSave turns it back into a real null.
    assigned_to: task.assigned_to || '',
  };
}

/**
 * A row's drawing, which is also its name.
 *
 * REPLACES the uppercase caption that used to sit above every control. Nine of
 * those captions were costing a line each on a phone, and most of them were
 * saying what the value underneath already said — "ΗΜΕΡΟΜΗΝΙΑ ΛΗΞΗΣ" above
 * 26/08/2026.
 *
 * A drawing is LEARNED, though, where a word is READ — so the word stays one
 * gesture away, and never disappears for assistive technology:
 *
 * - `aria-label` means a screen reader says "Λήξη, 26 Αυγούστου", not "image".
 *   Dropping the caption without this would have made the sheet worse for
 *   somebody who cannot see it at all.
 * - `title` is the desktop hover, free and native.
 * - Press-and-hold is the touchscreen's only honest equivalent of hover: a
 *   finger is either down or it is not, so there is no "passing over". ~400ms
 *   is long enough not to fire on an ordinary tap. Any movement cancels it, or
 *   every scroll that began on an icon would throw a label; and it lingers
 *   after the finger lifts, because while you are pressing, your own finger is
 *   covering the thing you are trying to read.
 */
function FieldIcon({ label, color, children }) {
  const [showing, setShowing] = useState(false);
  const holdTimer = useRef(null);

  function clearHold() {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  useEffect(() => clearHold, []);

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={color ? { color } : undefined}
      onTouchStart={() => {
        clearHold();
        holdTimer.current = setTimeout(() => setShowing(true), 400);
      }}
      onTouchMove={() => { clearHold(); setShowing(false); }}
      onTouchCancel={() => { clearHold(); setShowing(false); }}
      onTouchEnd={() => {
        clearHold();
        holdTimer.current = setTimeout(() => setShowing(false), 1200);
      }}
      className={`flex-shrink-0 inline-flex items-center gap-1.5 select-none ${
        color ? '' : 'text-[var(--text-secondary)]'
      }`}
    >
      <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">{children}</span>
      {/* INSIDE the row, not floating above it.
          A bubble anchored to the icon was the obvious shape and it was wrong
          here: the rows container is overflow-hidden so its corners stay round,
          the sheet body scrolls, and the first row has nothing above it anyway —
          so the label was clipped on exactly the rows somebody would press
          first. Sitting in the row costs a little width, which the value beside
          it gives up (every one of them is min-w-0), and can never be cut off. */}
      {showing && (
        <span className="text-[11px] font-medium text-[var(--text-secondary)] whitespace-nowrap">
          {label}
        </span>
      )}
    </span>
  );
}

/**
 * One line of the sheet: drawing on the left, controls filling the rest.
 *
 * Hairlines between rows instead of a bordered box per field. A border, a
 * radius and a background around every single control made nine separate
 * objects out of what is one object with nine facts about it.
 */
function SheetRow({ icon, children }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-[var(--border-subtle)] last:border-b-0">
      {icon}
      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * An offer, or a thing that already has content.
 *
 * The two look different on purpose. A dashed, muted pill is an empty field
 * you may fill; a solid one with a dot is holding something you cannot see
 * from here. Without that difference, the only way to find out whether a task
 * has a description is to tap and look.
 */
function SheetPill({ filled, expanded, icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className={`tap-40 inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] transition-colors ${
        filled
          ? 'border border-[var(--border-medium)] bg-[var(--bg-card)] text-[var(--text-primary)] font-medium'
          : 'border border-dashed border-[var(--border-medium)] bg-[var(--bg-app)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      <span className="w-4 h-4 flex-shrink-0">{icon}</span>
      {label}
      {filled && (
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[var(--text-secondary)] flex-shrink-0" />
      )}
    </button>
  );
}

/**
 * A control with no box around it.
 *
 * The rows in the edit sheet already carry their own hairline and padding, so
 * an input that brings a second border and a second background draws a box
 * inside a box — which is most of what made the old form look like a form.
 * Focus stays visible; only the resting border goes.
 */
const BARE_INPUT_CLASSES =
  `flex-1 min-w-0 bg-transparent text-sm font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] placeholder:font-normal border-0 p-0 focus:outline-none`;

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
/**
 * `readOnly` is how the History tab reads a task without being able to change
 * it, added 2026-09-19 on the owner's answer to "διαβάζεις ή πειράζεις;" —
 * «οπως οταν ειναι ανοιχτο απλα να μην εχχει επεξεργασία».
 *
 * A FLAG ON THIS SHEET RATHER THAN A SECOND, READING-ONLY SHEET. The whole
 * point of what he asked for is that a finished task looks exactly like a live
 * one; a parallel component would drift from this one field by field, and the
 * thing that drifts is what the reader is trying to check.
 *
 * It closes every door to a write rather than dimming them: there is no Edit
 * button, no ⋯ menu, no completion circle to press, no reminder or calendar
 * switch, and the checklist prints its marks instead of offering them. A
 * disabled control on a deleted task would still be asking a question that has
 * no good answer.
 *
 * `footerAction` is the one exception, and it is the owner's call: opening a
 * row to decide you want it back and then having to close it again and hunt
 * for the row is two steps for one decision. History passes its OWN restore /
 * reopen handler, so the button here and the button on the row are literally
 * the same act.
 *
 * `historyLine` is the only thing this sheet shows that the live one cannot:
 * how the task ended. Without it this would just be an old card.
 */
function TaskDetailSheet({ task, variant = 'default', onClose, onUpdate, onTaskDeleted, onShowToast, readOnly = false, footerAction = null, historyLine = null }) {
  useModalBehavior(onClose);
  const { t } = useTranslation();
  const actions = useTaskActions(task, { onUpdate, onTaskDeleted, onShowToast });
  const { isPending, isCompleted, isRejected, approvesOnEdit } = actions;
  const { workspaces, categoriesFor } = useWorkspaces();
  const recurrence = useRecurrence();
  // Null while the rules are loading, or if the task simply does not repeat.
  // The row below distinguishes the two cases by task.recurrence_rule_id.
  const rule = recurrence.ruleFor(task);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFromTask(task));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // WHAT HAS BEEN ASKED FOR but is still empty. A field holding nothing is a
  // pill at the foot of the sheet until one of these is flipped; then it is a
  // row like any other.
  //
  // Reset by startEditing rather than left standing: open a task, tap "+ Ώρα",
  // change your mind, close it, then open a DIFFERENT task — without the reset
  // that second task would show an empty time row nobody asked it for.
  const [showTime, setShowTime] = useState(false);
  const [showAssignee, setShowAssignee] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [descOpen, setDescOpen] = useState(false);

  // Who this task could be handed to: the members of ITS workspace.
  //
  // Fetched only while editing and only for a filed task, because that is the
  // only moment the answer is needed — opening a task to read it must not cost
  // a members request. An unfiled task has no room and therefore nobody to
  // hand it to, which the backend refuses with its own message
  // (assignee_needs_a_workspace); not offering the field is the same rule the
  // locked Hostaway category follows.
  // The fetched list is stored WITH the workspace it belongs to, and read back
  // only when the two still agree. Two reasons, and neither is cosmetic:
  // clearing it synchronously on the way in is a setState inside an effect
  // body (react-hooks/set-state-in-effect, and it really can cascade), and
  // without the id a switch from one workspace to another would show the old
  // room's people until the new fetch lands — offering a handover to somebody
  // the backend is about to refuse.
  const [memberState, setMemberState] = useState({ workspaceId: null, members: [] });
  const members = memberState.workspaceId === draft.workspace_id ? memberState.members : [];

  useEffect(() => {
    if (!isEditing || !draft.workspace_id) return undefined;
    let cancelled = false;
    const workspaceId = draft.workspace_id;
    getWorkspaceMembers(workspaceId)
      .then((data) => {
        if (!cancelled) setMemberState({ workspaceId, members: data.members });
      })
      // Silent: the picker simply does not appear. A toast about a members
      // list nobody asked for, on a sheet opened to edit a name, is noise.
      .catch(() => {
        if (!cancelled) setMemberState({ workspaceId, members: [] });
      });
    return () => { cancelled = true; };
  }, [isEditing, draft.workspace_id]);

  const [optimisticChecklist, setOptimisticChecklist] = useState(null);
  const [pendingToggleIdx, setPendingToggleIdx] = useState(null);
  const [toggleError, setToggleError] = useState(null);

  const [agentInput, setAgentInput] = useState('');
  // Has the agent field been touched. Gates the ready-made suggestions,
  // which are a way IN for somebody who does not know what to type and were
  // being shown permanently to somebody who does — a wrapping row of chips
  // under every task, forever.
  const [agentOpen, setAgentOpen] = useState(false);
  // What was in the box when dictation started. Interim results replace the
  // tail as the recogniser revises its guess, so without an anchor each
  // revision would append and the field would fill with half-heard repeats.
  const dictationBaseRef = useRef(null);
  const [isAgentBusy, setIsAgentBusy] = useState(false);
  const [agentNote, setAgentNote] = useState(null);
  const [agentError, setAgentError] = useState(null);
  const [agentResult, setAgentResult] = useState(null);

  const displayChecklist = optimisticChecklist ?? task.checklist;
  const showDescription = task.description && task.description !== task.task_name;
  const tone = dueTone(task);

  const priorityOptions = [
    { value: 'P1', label: 'P1' },
    { value: 'P2', label: 'P2' },
    { value: 'P3', label: 'P3' },
  ];

  function startEditing() {
    setDraft(draftFromTask(task));
    setSaveError(null);
    setShowTime(false);
    setShowAssignee(false);
    setShowChecklist(false);
    setDescOpen(false);
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
        // '' back to null: the columns are nullable uuids, and an empty string
        // is not a uuid. Null IS the value that means unfiled.
        workspace_id: draft.workspace_id || null,
        category_id: draft.category_id || null,
        assigned_to: draft.assigned_to || null,
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

  /**
   * Dictated words go INTO the box, never straight to the agent. This one
   * writes to a real task, so a misheard instruction would be a wrong edit —
   * reading it before pressing send is the whole safeguard.
   */
  function handleTranscript(text, { isFinal }) {
    if (dictationBaseRef.current === null) {
      // Anchor to whatever was already typed, so dictation adds to it rather
      // than wiping it.
      dictationBaseRef.current = agentInput ? `${agentInput.trim()} ` : '';
    }
    setAgentInput(dictationBaseRef.current + text);
    if (isFinal) dictationBaseRef.current = null;
  }

  const updateDraft = (field, value) => setDraft((d) => ({ ...d, [field]: value }));
  const updateChecklistItem = (index, value) =>
    setDraft((d) => ({ ...d, checklist: d.checklist.map((item, i) => (i === index ? value : item)) }));
  const addChecklistItem = () =>
    setDraft((d) => ({ ...d, checklist: [...d.checklist, { text: '', done: false }] }));
  const removeChecklistItem = (index) =>
    setDraft((d) => {
      const checklist = d.checklist.filter((_, i) => i !== index);
      // Emptying the list puts its pill back. Without this the row simply
      // stays on screen with nothing in it — which is the empty captioned box
      // this whole layout exists to get rid of, rebuilt by hand.
      if (checklist.length === 0) setShowChecklist(false);
      return { ...d, checklist };
    });

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
          {readOnly ? (
            /* The same circle, as a mark. Not a disabled button: a control that
               cannot act is a question with no answer, and this one only ever
               reported a state anyway. */
            <span
              aria-hidden="true"
              className={`w-5 h-5 mt-1 rounded-full flex-shrink-0 flex items-center justify-center
                ${isCompleted
                  ? 'bg-[var(--success)] border-2 border-[var(--success)]'
                  : 'border-2 border-[var(--border-medium)]'}`}
            >
              {isCompleted && <CheckIcon className="w-3 h-3 text-white" />}
            </span>
          ) : (
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
          )}

          {/* While editing, the heading IS the field. It used to be printed
              twice on one screen — here, and again inside a box captioned
              "ΟΝΟΜΑ ΕΡΓΑΣΙΑΣ" a few pixels below — which cost a block of
              height to say something already on screen.

              A textarea, not an <input>: a task name wraps to two lines here
              and an input would scroll it sideways while you type. Growing it
              on each keystroke keeps the whole name visible, and Enter is
              swallowed because a newline in a task name is never wanted and
              the sheet has a Save button of its own. */}
          {isEditing ? (
            <textarea
              value={draft.task_name}
              onChange={(e) => updateDraft('task_name', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              rows={1}
              placeholder={t('task.name_placeholder')}
              aria-label={t('task.name_placeholder')}
              className="flex-1 min-w-0 resize-none bg-transparent text-[17px] leading-snug font-semibold text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
            />
          ) : (
            <h2 className={`flex-1 min-w-0 text-[17px] leading-snug font-semibold break-words ${isCompleted ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
              {task.task_name}
            </h2>
          )}

          {!readOnly && (
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
            onRecurrence={() => recurrence.openEditor(task)}
            isRecurring={Boolean(task.recurrence_rule_id)}
            onDelete={handleDelete}
            t={t}
          />
          )}

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
                {/* The old four-word `category` column is no longer PRINTED
                    anywhere — the owner's decision, 2026-09-11, and the second
                    half of a removal that began on 2026-09-02 when it left the
                    task row for causing exactly this confusion: the sheet was
                    showing "Αταξινόμητα" (his own category, inside a workspace)
                    and "Επαγγελματικά" (the AI's word) side by side, both
                    captioned "category".

                    The COLUMN is untouched. The extractor still writes it, the
                    Hostaway integration still keys off it, Browse still filters
                    on it, and handleSave still carries draft.category through
                    unchanged. It is simply not shown to a person any more. */}
                {task.due_date && (
                  <span className={DUE_TONE_CLASSES[tone]}>
                    {formatDate(task.due_date, task.due_time)}
                  </span>
                )}
                {isPending && (
                  <span className="text-[var(--priority-p2)] font-medium">{t('task.pending')}</span>
                )}
              </div>

              {/* «Μπήκε 3 Σεπ → Ολοκληρώθηκε 17 Σεπ 14:32 · από τη Μαρία».
                  The only thing this sheet says that the live one cannot, and
                  the reason the History tab is worth opening at all — without
                  it this is just an old card. Composed by HistoryList, which
                  already builds exactly this sentence for the row itself, so
                  the row and the sheet can never disagree about how a task
                  ended. */}
              {historyLine && (
                <p className="text-xs text-[var(--text-secondary)] bg-[var(--bg-hover)] rounded-md px-2.5 py-1.5">
                  {historyLine}
                </p>
              )}

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
                        {/* READ-ONLY PRINTS THE SAME ROW WITHOUT THE OFFER.
                            What the reader wants from a finished task is which
                            steps were actually done — so the boxes stay, and
                            only the ability to change them goes. */}
                        {readOnly ? (
                          <span className="flex items-center gap-2 w-full py-1.5 px-2 text-sm">
                            {item.done ? <CheckedBox /> : <EmptyBox />}
                            <span className={item.done ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}>
                              {item.text}
                            </span>
                          </span>
                        ) : (
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
                        )}
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
              {/* A reminder, a calendar sync and a repeat pattern are all
                  instructions about the FUTURE. On a task that is finished or
                  deleted they have no future to act on, so they are absent
                  rather than disabled — a switch you cannot flip still invites
                  you to try. */}
              {!readOnly && (
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

                {/* Not a Switch, though it sits with two of them. Repetition is
                    not a thing you turn on — it is a pattern that has to be
                    described — so it opens the form instead of toggling, and
                    is drawn as a row you press rather than a lever. It states
                    "Never" when there is none, because a setting that hides
                    when it is off is a setting nobody finds. */}
                <button
                  type="button"
                  onClick={() => recurrence.openEditor(task)}
                  className="w-full flex items-center justify-between gap-3 text-left py-1 rounded hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <span className="text-sm text-[var(--text-primary)]">
                    {t('recurrence.task_label')}
                  </span>
                  <span className="text-sm text-[var(--text-secondary)] truncate">
                    {!task.recurrence_rule_id && t('recurrence.never')}
                    {/* It repeats, but by what pattern is not known yet — the
                        rules are still in flight, or their fetch failed.
                        "Never" here would be a flat lie about the user's own
                        data, which is worse than saying less. */}
                    {task.recurrence_rule_id && (rule ? describeRecurrence(rule, t) : t('recurrence.repeats_unknown'))}
                  </span>
                </button>
              </div>
              )}
            </>
          ) : (
            <>
              {/* WHAT IS THERE, as rows. What is NOT, as pills underneath.
                  The form this replaces showed nine captioned boxes whether or
                  not they held anything — an empty "ΩΡΑ ΛΗΞΗΣ" took as much of
                  a phone screen as the date beside it. */}
              <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">

                {/* Where it lives. Two selects, ONE row: "Business ·
                    Αταξινόμητα" is one answer to one question, and splitting it
                    across two captioned boxes made it look like two.

                    Changing the workspace CLEARS the category in the same draft
                    update: the backend refuses a category from another
                    workspace with a 422 (services.validate_workspace_placement),
                    so carrying the old one over would fail the whole save and
                    lose the workspace change with it. */}
                <SheetRow icon={<FieldIcon label={t('workspace.label')}><FolderIcon className="w-[18px] h-[18px]" /></FieldIcon>}>
                  <div className="flex-1 min-w-[8rem]">
                    <CustomSelect
                      value={draft.workspace_id}
                      options={[
                        { value: '', label: t('workspace.unfiled') },
                        ...workspaces.map((w) => ({ value: w.record_id, label: w.name })),
                      ]}
                      onChange={(value) => setDraft((d) => ({ ...d, workspace_id: value, category_id: '' }))}
                      ariaLabel={t('workspace.label')}
                    />
                  </div>
                  {draft.workspace_id && (
                    <div className="flex-1 min-w-[8rem]">
                      <CustomSelect
                          value={draft.category_id}
                        options={[
                          { value: '', label: t('workspace.unfiled') },
                          ...categoriesFor(draft.workspace_id).map((c) => ({
                            value: c.record_id, label: c.name,
                          })),
                        ]}
                        onChange={(value) => updateDraft('category_id', value)}
                        ariaLabel={t('workspace.category_label')}
                      />
                    </div>
                  )}
                </SheetRow>

                {/* When. Date and time are two columns in the database and ONE
                    thought in a person's head, so they share a row.

                    It also puts the missing half where it gets noticed: a
                    reminder needs a due_time, and an empty time two rows below
                    was never seen while the date was being set — the task was
                    simply silent on the day. */}
                <SheetRow icon={<FieldIcon label={t('task.due_date_label')}><CalendarIcon className="w-[18px] h-[18px]" /></FieldIcon>}>
                  <input
                    type="date"
                    value={draft.due_date}
                    onChange={(e) => updateDraft('due_date', e.target.value)}
                    aria-label={t('task.due_date_label')}
                    className={BARE_INPUT_CLASSES}
                  />
                  {draft.due_time || showTime ? (
                    <>
                      <FieldIcon label={t('task.due_time_label')}>
                        <ClockIcon className="w-[18px] h-[18px]" />
                      </FieldIcon>
                      <input
                        type="time"
                        autoFocus={showTime && !draft.due_time}
                        value={draft.due_time}
                        onChange={(e) => updateDraft('due_time', e.target.value)}
                        aria-label={t('task.due_time_label')}
                        className={BARE_INPUT_CLASSES}
                      />
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowTime(true)}
                      className="tap-40 flex-shrink-0 px-2.5 py-1 rounded-full border border-dashed border-[var(--border-medium)] text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                    >
                      + {t('task.due_time_label')}
                    </button>
                  )}
                </SheetRow>

                {/* The flag is the priority's own colour — the same red, amber
                    and blue the dots use everywhere else in this app. That is
                    what lets the caption go: a flag shape means "priority" only
                    to somebody who learned it, but the colour is already
                    learned from every list in the app. */}
                <SheetRow
                  icon={(
                    <FieldIcon label={t('task.priority_label')} color={priorityColor(draft.priority)}>
                      <FlagIcon className="w-[18px] h-[18px]" />
                    </FieldIcon>
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <CustomSelect
                      value={draft.priority}
                      options={priorityOptions}
                      onChange={(value) => updateDraft('priority', value)}
                      ariaLabel={t('task.priority_label')}
                    />
                  </div>
                </SheetRow>

                {/* Only when there is somebody to hand it to. A workspace with
                    one member is every solo account, and a picker whose only
                    option is yourself is a field that asks a question with one
                    answer. */}
                {members.length > 1 && (draft.assigned_to || showAssignee) && (
                  <SheetRow icon={<FieldIcon label={t('task.assignee_label')}><PersonIcon className="w-[18px] h-[18px]" /></FieldIcon>}>
                    <div className="flex-1 min-w-0">
                      <CustomSelect
                          value={draft.assigned_to}
                        options={[
                          { value: '', label: t('task.unassigned') },
                          ...members.map((m) => ({
                            value: m.user_id,
                            label: m.display_name || m.email || m.user_id,
                          })),
                        ]}
                        onChange={(value) => updateDraft('assigned_to', value)}
                        ariaLabel={t('task.assignee_label')}
                      />
                    </div>
                  </SheetRow>
                )}

                {(draft.checklist.length > 0 || showChecklist) && (
                  <SheetRow icon={<FieldIcon label={t('task.checklist_label')}><ChecklistIcon className="w-[18px] h-[18px]" /></FieldIcon>}>
                    <div className="flex-1 min-w-0 space-y-1.5 py-0.5">
                      {draft.checklist.map((item, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={item.text}
                            onChange={(e) => updateChecklistItem(index, { ...item, text: e.target.value })}
                            placeholder={t('task.checklist_item_placeholder', { n: index + 1 })}
                            className={BARE_INPUT_CLASSES}
                          />
                          <button
                            type="button"
                            onClick={() => removeChecklistItem(index)}
                            className="tap-40 px-1 text-xs text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors flex-shrink-0"
                            title={t('task.remove_item')}
                            aria-label={t('task.remove_item')}
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
                  </SheetRow>
                )}
              </div>

              {/* The pills. Words here, drawings above — deliberately: you scan
                  a row you have seen a hundred times, but you READ a thing you
                  are adding for the first time.

                  The description one is always offered and carries its filled
                  state, because a description is usually long, usually
                  machine-written (a Hostaway message, an extracted e-mail) and
                  almost never the reason the sheet was opened — it was taking
                  the top of the screen to say something rarely wanted. */}
              <div className="flex flex-wrap gap-2">
                <SheetPill
                  filled={Boolean(draft.description)}
                  expanded={descOpen}
                  icon={<TextLinesIcon className="w-4 h-4" />}
                  label={t('task.description_label')}
                  onClick={() => setDescOpen((v) => !v)}
                />
                {members.length > 1 && !draft.assigned_to && !showAssignee && (
                  <SheetPill
                    icon={<PersonIcon className="w-4 h-4" />}
                    label={t('task.assignee_label')}
                    onClick={() => setShowAssignee(true)}
                  />
                )}
                {draft.checklist.length === 0 && !showChecklist && (
                  <SheetPill
                    icon={<ChecklistIcon className="w-4 h-4" />}
                    label={t('task.checklist_label')}
                    onClick={() => { setShowChecklist(true); addChecklistItem(); }}
                  />
                )}
              </div>

              {descOpen && (
                <textarea
                  autoFocus
                  value={draft.description}
                  onChange={(e) => updateDraft('description', e.target.value)}
                  rows={3}
                  placeholder={t('task.description_label')}
                  aria-label={t('task.description_label')}
                  className={`${INPUT_CLASSES} resize-none`}
                />
              )}
            </>
          )}

          {/* A Hostaway task points at the conversation it came from. The URL
              shape was confirmed against a real inbox URL, not documentation:
              a conversation's id from the API is exactly the id in this path. */}
          {task.hostaway_conversation_id && (
            <div className="flex items-center gap-2 flex-wrap" data-no-toggle>
              <a
                href={`${HOSTAWAY_INBOX_URL}/${task.hostaway_conversation_id}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs font-medium text-[var(--brand-primary)] underline"
              >
                {t('task.hostaway_open_conversation')}
              </a>
              {task.hostaway_message_count > 1 && (
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {t('task.hostaway_message_count', { count: task.hostaway_message_count })}
                </span>
              )}
              {task.hostaway_answered_at && (
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {t('task.hostaway_answered')}
                </span>
              )}
            </div>
          )}

          {/* Inline task agent, in both EDITING modes but never in read-only.
              It suits a reading context as well as an editing one — it is a
              sentence, not a form — and "move it to next week" is exactly what
              someone who just opened a task to look at it wants to say.

              NOT IN THE HISTORY TAB. Caught by the owner on sight — «απλα να
              μην υπαρχει το ai εκει» — and he is right twice over: it is a way
              to CHANGE the task, which is the one thing read-only exists to
              prevent, and every sentence it accepts ("move it to next week")
              is meaningless about work that is already finished or deleted.

              ONE LINE AT REST, as of 2026-09-11. It used to be four stacked
              things inside a bordered grey card: a caption, the input row, a
              wrapping row of suggestions, and the room for an answer — which
              on a phone was most of the space below the task itself.

              Three of the four earned their way out rather than being
              squeezed:

              - The caption «ΒΟΗΘΟΣ AI» said what the sparkle and the
                placeholder underneath it already said. The sparkle moved INTO
                the field, where it labels the thing it belongs to.
              - The card went with it. A border and a fill around a control say
                "separate object"; this is one line of the sheet, not a panel.
              - The suggestions wait until the field is touched. They are a way
                IN for somebody who does not know what to type, and they were
                being shown permanently to somebody who does.

              What did NOT change: what it does, what it asks the server, and
              the fact that nothing happens to the task until you approve it. */}
          {!readOnly && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 flex items-center gap-2 rounded-md border border-[var(--border-medium)] bg-[var(--bg-input)] px-2.5 py-2 focus-within:border-[var(--border-focus)] focus-within:ring-2 focus-within:ring-[color:var(--ring-soft)] transition-colors">
                <SparkleIcon className="w-4 h-4 shrink-0 text-[var(--brand-primary)]" />
                <input
                  type="text"
                  value={agentInput}
                  onChange={(e) => setAgentInput(e.target.value)}
                  // Once. Never turned off again by a blur.
                  //
                  // The obvious version — hide the suggestions when the field
                  // loses focus — breaks the only thing they are for: tapping
                  // one blurs the input first, so the chip is gone by the time
                  // the tap lands on it. Leaving them up once asked for costs a
                  // row that the user has just shown they want, and the sheet
                  // closing resets it.
                  onFocus={() => setAgentOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAgentEdit();
                    }
                  }}
                  disabled={isAgentBusy || isSaving || actions.isDeleting}
                  placeholder={t('task.agent_placeholder')}
                  aria-label={t('task.agent_title')}
                  className="flex-1 min-w-0 bg-transparent border-0 p-0 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none disabled:opacity-60"
                />
              </div>

              <DictateButton
                onTranscript={handleTranscript}
                onError={() => setAgentError(t('voice.permission_denied'))}
                disabled={isAgentBusy || isSaving || actions.isDeleting}
              />

              {/* Only once there is something to send. The button was always
                  drawn and disabled, which is a 44px square of nothing on a
                  line whose whole point is now that it is one line. The mic
                  stays, because dictating is how you START when the field is
                  empty — it is not the same kind of control. */}
              {(agentInput.trim() || isAgentBusy) && (
                <button
                  type="button"
                  onClick={() => handleAgentEdit()}
                  disabled={isAgentBusy || isSaving || actions.isDeleting}
                  className="w-11 h-11 flex items-center justify-center rounded-md bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors shrink-0"
                  aria-label={t('task.agent_send')}
                >
                  {/* Was a literal '↵', which rendered at the button's font-size
                      and came out tiny. An icon has a size of its own. */}
                  {isAgentBusy ? <SpinnerIcon className="w-5 h-5 animate-spin" /> : <SendIcon className="w-5 h-5" />}
                </button>
              )}
            </div>

            {agentOpen && !agentInput && !agentResult && !agentNote && !isAgentBusy && (
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
              <div className="rounded-md bg-[var(--bg-hover)] border border-[var(--border-subtle)] px-3 py-2 space-y-1">
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
          )}

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
          {readOnly ? (
            /* Where Edit sits on a live task. History passes its own restore /
               reopen handler, so this button and the one on the row are the
               same act reached two ways — the owner's call: «το πρώτο, βάλε το
               κουμπί». A row whose kind has no way back (a missed occurrence)
               passes nothing and the footer is simply empty. */
            footerAction && (
              <button
                type="button"
                onClick={footerAction.onAct}
                disabled={footerAction.isBusy}
                className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-muted)] disabled:cursor-not-allowed transition-colors"
              >
                {footerAction.isBusy ? footerAction.busyLabel : footerAction.label}
              </button>
            )
          ) : !isEditing ? (
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
