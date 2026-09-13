import KebabMenu from './KebabMenu';

/**
 * The ⋯ menu on a task — WHICH items, and when.
 *
 * Beyond being shared by the row and the detail sheet, this is the app's
 * accessible path to every task action: anything reachable by a swipe is also
 * reachable here, because a gesture with no visible equivalent excludes
 * everyone who cannot perform it.
 *
 * **The mechanism moved to KebabMenu** and the reasoning with it — the portal,
 * the clipping it escapes, the flip when there is no room below, and the rule
 * that every item closes the menu before it acts. Settings needed the same menu
 * for its category and member rows, and copying this file would have copied the
 * bugs it took two rounds to fix. Not one item below changed in the move; this
 * file is now only the list.
 */
function TaskMenu({
  isPending,
  isCompleted,
  isRejected,
  pendingAction,
  onApprove,
  onUncomplete,
  onReject,
  onUnreject,
  onEdit,
  onReschedule,
  onRecurrence,
  isRecurring,
  onDelete,
  t,
}) {
  const busy = pendingAction !== null;

  const items = [
    isPending && {
      key: 'approve',
      label: pendingAction === 'approve' ? t('actions.approving') : t('actions.approve'),
      disabled: busy,
      onClick: onApprove,
    },
    isCompleted && {
      key: 'uncomplete',
      label: pendingAction === 'uncomplete' ? t('actions.uncompleting') : t('actions.uncomplete'),
      disabled: busy,
      onClick: onUncomplete,
    },
    onReschedule && {
      key: 'reschedule',
      label: t('actions.reschedule'),
      onClick: onReschedule,
    },
    // Beside Reschedule because they are the same kind of thought — when does
    // this happen — and the one that says "every week" belongs next to the one
    // that says "next Tuesday".
    onRecurrence && {
      key: 'recurrence',
      label: isRecurring ? t('recurrence.menu_edit') : t('recurrence.menu_add'),
      onClick: onRecurrence,
    },
    !isRejected && {
      key: 'reject',
      label: pendingAction === 'reject' ? t('actions.rejecting') : t('actions.reject'),
      disabled: busy,
      onClick: onReject,
    },
    isRejected && {
      key: 'unreject',
      label: pendingAction === 'unreject' ? t('actions.unrejecting') : t('actions.unreject'),
      disabled: busy,
      onClick: onUnreject,
    },
    onEdit && { key: 'edit', label: t('actions.edit'), onClick: onEdit },
    { key: 'delete', label: t('actions.delete'), onClick: onDelete, danger: true, separator: true },
  ];

  return <KebabMenu items={items} ariaLabel={t('menu.open_menu')} />;
}

export default TaskMenu;
