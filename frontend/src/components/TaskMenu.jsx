import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DotsIcon } from './TaskIcons';

const MENU_WIDTH = 176; // w-44
const GAP = 4;

/**
 * The ⋯ menu on a task.
 *
 * Beyond being shared by the row and the detail sheet, this is the app's
 * accessible path to every task action: anything reachable by a swipe is also
 * reachable here, because a gesture with no visible equivalent excludes
 * everyone who cannot perform it.
 *
 * **The menu is rendered into document.body, not next to its button.** It used
 * to be an absolutely-positioned sibling, which worked until the row gained
 * `overflow-hidden` to contain the swipe tray — and then the dropdown was
 * silently clipped to the height of the row, so the last few items simply were
 * not there. Nothing errored; the menu just came up short.
 *
 * A portal is the fix rather than removing that `overflow-hidden`, because the
 * clipping is doing a real job: without it, a row dragged to the right during a
 * swipe hangs outside its own bounds and can push the page sideways. Escaping
 * the ancestor entirely is also what stops this recurring the next time
 * something upstream gets an overflow rule.
 *
 * Portals keep React's event bubbling, so a click inside the menu still travels
 * to the row's onClick in the React tree. `data-no-toggle` on the portal root
 * is what the row's handler looks for — and `closest()` finds it, because it
 * walks the REAL DOM, where this div is a child of body.
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
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const place = useCallback(() => {
    const trigger = buttonRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;

    // Right-aligned to the button, then pulled back inside the viewport if that
    // would hang it off the left edge on a narrow screen.
    const left = Math.max(GAP, rect.right - MENU_WIDTH);

    // Flip above the button when there is not enough room below — a menu that
    // opens off the bottom of the screen is the same bug as one that is
    // clipped, just from a different direction.
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = menuHeight > 0 && spaceBelow < menuHeight + GAP && rect.top > menuHeight;
    const top = openUp ? rect.top - menuHeight - GAP : rect.bottom + GAP;

    setPosition({ top, left });
  }, []);

  // Layout effect so the first paint already has the real position; a normal
  // effect lets the menu render at the top-left corner for one frame first.
  useLayoutEffect(() => {
    if (isOpen) place();
  }, [isOpen, place]);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e) {
      if (buttonRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setIsOpen(false);
    }
    // Closed rather than repositioned on scroll: the menu is anchored to a row
    // in a scrolling list, and following it around is more distracting than
    // just dismissing it.
    function handleScrollOrResize() {
      setIsOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  // Every item closes the menu first. Each caller used to remember to do this
  // and one of them (the agent's delete path) did not.
  const run = (fn) => () => {
    setIsOpen(false);
    fn?.();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-no-toggle
        onClick={(e) => { e.stopPropagation(); setIsOpen((v) => !v); }}
        aria-label={t('menu.open_menu')}
        aria-expanded={isOpen}
        className="tap-44 p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors flex-shrink-0"
      >
        <DotsIcon />
      </button>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          data-no-toggle
          role="menu"
          style={{ top: position?.top ?? 0, left: position?.left ?? 0, width: MENU_WIDTH }}
          className={`fixed z-[60] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-[var(--shadow-menu)] py-1 overflow-hidden ${
            position ? '' : 'invisible'
          }`}
        >
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
        </div>,
        document.body
      )}
    </>
  );
}

export default TaskMenu;
