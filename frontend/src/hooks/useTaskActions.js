import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteTask, acknowledgeTaskCompletion, dropTask, undropTask } from '../api';

const ACTION_TOAST_KEYS = {
  approve: 'toast.approved',
  uncomplete: 'toast.uncompleted',
  reject: 'toast.rejected',
  unreject: 'toast.unrejected',
};

/**
 * Everything that CHANGES a task, in one place.
 *
 * It exists because the row and the detail sheet both need all of it — both can
 * complete a task, both carry the ⋯ menu — and because TaskCard had grown to
 * seventeen useState calls in a single component, most of them bookkeeping for
 * these handlers rather than anything to do with rendering.
 *
 * Deliberately NOT included: the edit form's draft, the checklist editor and
 * the inline agent. Those belong to the sheet alone, and folding them in here
 * would just rebuild the same god-component behind a hook.
 */
export function useTaskActions(task, { onUpdate, onTaskDeleted, onShowToast, onAcknowledged }) {
  const { t } = useTranslation();

  const [pendingAction, setPendingAction] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [optimisticCompleted, setOptimisticCompleted] = useState(null);
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const isPending = !task.approval_status;
  const isCompleted = optimisticCompleted ?? task.is_completed;
  const isRejected = task.is_rejected;
  const isDropped = Boolean(task.dropped_at);
  // The «Γιατί;» box. Held here rather than in each screen because the row and
  // the sheet both offer «Ακύρωση εργασίας…» from the same menu.
  const [isDropDialogOpen, setIsDropDialogOpen] = useState(false);

  // Editing a task that is waiting for approval — by Save or by the inline
  // agent — approves it: opening it, changing something and confirming IS the
  // review, and making the user then hunt for the ○ asks them to say yes
  // twice. Rejected tasks are excluded: rejecting only sets is_rejected and
  // leaves approval_status false, so without this a rejected task would come
  // back approved-but-still-rejected merely for being edited.
  const approvesOnEdit = isPending && !isRejected;

  async function runAction(actionName, updates) {
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

  /**
   * The completion circle. In the Inbox the same circle means "approve" — that
   * list is a triage queue, and there is nothing to complete before the task
   * has been accepted at all.
   */
  async function toggleComplete(variant) {
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

  /**
   * Deleting reports what happened to the Google Calendar event, because all
   * four outcomes used to look identical to the user — including the one where
   * the event is deliberately left alone because it was not ours to delete.
   */
  async function remove({ skipConfirm = false } = {}) {
    if (!skipConfirm && !window.confirm(t('confirm.delete_task'))) return false;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      const { calendar } = await deleteTask(task.record_id);
      onTaskDeleted(task.record_id);
      if (calendar === 'kept_google_origin') {
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
      return true;
    } catch (err) {
      setDeleteError(err.message);
      setIsDeleting(false);
      return false;
    }
  }

  /**
   * "I have seen that somebody else closed this." The OK on a handover, which
   * is what lets the task finally leave this person's list.
   *
   * NOT optimistic, unlike toggleComplete above. Ticking a task is an act the
   * user is performing and the row should follow their thumb; this is an
   * acknowledgement of somebody ELSE's act, and if the write fails the honest
   * thing is for the strip to still be there. A handover that disappears from
   * the screen without reaching the database is the failure this whole feature
   * exists to prevent, one level up.
   *
   * Its own endpoint rather than a field on the PATCH: see api.js.
   */
  async function acknowledge() {
    setIsAcknowledging(true);
    setActionError(null);
    try {
      const updated = await acknowledgeTaskCompletion(task.record_id);
      onAcknowledged?.(updated);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setIsAcknowledging(false);
    }
  }

  /**
   * Calling a task off — «Ακυρώθηκε», with an optional reason (2026-09-26).
   *
   * Its own endpoint, and the server hands back the whole task, which is folded
   * in through onAcknowledged: App's handler for that simply replaces the task
   * with the server's copy, which is exactly what this needs too. A second
   * callback threaded through ten screens to do the same replacement would be
   * the same function under another name.
   *
   * THROWS on failure rather than setting actionError: DropDialog awaits it and
   * keeps itself open with the message, so a cancellation that did not happen
   * never looks as if it had.
   */
  async function drop(reason) {
    const updated = await dropTask(task.record_id, reason);
    onAcknowledged?.(updated);
    onShowToast('toast.dropped', 'success');
  }

  async function undrop() {
    setPendingAction('undrop');
    setActionError(null);
    try {
      const updated = await undropTask(task.record_id);
      onAcknowledged?.(updated);
      onShowToast('toast.undropped', 'success');
    } catch (err) {
      setActionError(err.message);
    } finally {
      setPendingAction(null);
    }
  }

  async function setNotify(enabled) {
    try {
      await onUpdate(task.record_id, { notify_enabled: enabled });
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function setCalendarSync(enabled) {
    try {
      await onUpdate(task.record_id, { calendar_sync_enabled: enabled });
    } catch (err) {
      setActionError(err.message);
    }
  }

  return {
    isPending,
    isCompleted,
    isRejected,
    isDropped,
    approvesOnEdit,
    pendingAction,
    actionError,
    isDeleting,
    deleteError,
    isAcknowledging,
    toggleComplete,
    acknowledge,
    remove,
    setNotify,
    setCalendarSync,
    approve: () => runAction('approve', { approval_status: true }),
    uncomplete: () => runAction('uncomplete', { is_completed: false }),
    reject: () => runAction('reject', { is_rejected: true }),
    unreject: () => runAction('unreject', { is_rejected: false }),
    isDropDialogOpen,
    openDrop: () => setIsDropDialogOpen(true),
    closeDrop: () => setIsDropDialogOpen(false),
    drop,
    undrop,
  };
}

export default useTaskActions;
