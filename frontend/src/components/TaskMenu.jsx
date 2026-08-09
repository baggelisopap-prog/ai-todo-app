import { useEffect, useRef, useState } from 'react';
import { DotsIcon } from './TaskIcons';

/**
 * The ⋯ menu on a task.
 *
 * Beyond being shared by the row and the detail sheet, this is the app's
 * accessible path to every task action: anything reachable by a swipe must also
 * be reachable here, because a gesture with no visible equivalent excludes
 * everyone who cannot perform it. Phase 3 adds the swipes; this is what makes
 * them optional rather than required.
 *
 * Owns its own open state and outside-click handling, which the two callers
 * previously each had to wire up.
 */
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
  onDelete,
  t,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Every item closes the menu first. Each caller used to remember to do this
  // and one of them (the agent's delete path) did not.
  const run = (fn) => () => {
    setIsOpen(false);
    fn?.();
  };

  return (
    <div className="relative flex-shrink-0" data-no-toggle ref={menuRef}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setIsOpen((v) => !v); }}
        aria-label={t('menu.open_menu')}
        aria-expanded={isOpen}
        className="tap-44 p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        <DotsIcon />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-8 z-20 w-44 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-[var(--shadow-menu)] py-1 overflow-hidden">
          {isPending && (
            <MenuItem
              label={pendingAction === 'approve' ? t('actions.approving') : t('actions.approve')}
              disabled={pendingAction !== null}
              onClick={run(onApprove)}
            />
          )}
          {isCompleted && (
            <MenuItem
              label={pendingAction === 'uncomplete' ? t('actions.uncompleting') : t('actions.uncomplete')}
              disabled={pendingAction !== null}
              onClick={run(onUncomplete)}
            />
          )}
          {onReschedule && (
            <MenuItem label={t('actions.reschedule')} onClick={run(onReschedule)} />
          )}
          {!isRejected && (
            <MenuItem
              label={pendingAction === 'reject' ? t('actions.rejecting') : t('actions.reject')}
              disabled={pendingAction !== null}
              onClick={run(onReject)}
            />
          )}
          {isRejected && (
            <MenuItem
              label={pendingAction === 'unreject' ? t('actions.unrejecting') : t('actions.unreject')}
              disabled={pendingAction !== null}
              onClick={run(onUnreject)}
            />
          )}
          {onEdit && <MenuItem label={t('actions.edit')} onClick={run(onEdit)} />}
          <hr className="my-1 border-[var(--border-subtle)]" />
          <MenuItem label={t('actions.delete')} onClick={run(onDelete)} danger />
        </div>
      )}
    </div>
  );
}

export default TaskMenu;
