import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteTask } from '../api';

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
export function useTaskActions(task, { onUpdate, onTaskDeleted, onShowToast }) {
  const { t } = useTranslation();

  const [pendingAction, setPendingAction] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [optimisticCompleted, setOptimisticCompleted] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const isPending = !task.approval_status;
  const isCompleted = optimisticCompleted ?? task.is_completed;
  const isRejected = task.is_rejected;

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
    approvesOnEdit,
    pendingAction,
    actionError,
    isDeleting,
    deleteError,
    toggleComplete,
    remove,
    setNotify,
    setCalendarSync,
    approve: () => runAction('approve', { approval_status: true }),
    uncomplete: () => runAction('uncomplete', { is_completed: false }),
    reject: () => runAction('reject', { is_rejected: true }),
    unreject: () => runAction('unreject', { is_rejected: false }),
  };
}

export default useTaskActions;
