import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DotsIcon } from './TaskIcons';

const MENU_WIDTH = 176; // w-44
const GAP = 4;

/**
 * A ⋯ button and the menu it opens. The MECHANISM only — callers supply the items.
 *
 * EXTRACTED FROM TaskMenu, which is where all of this was learned the hard way
 * and where the comments below came from. Settings needed the same menu for
 * category and member rows, and the alternative was a second implementation of
 * exactly the bugs this one already survived — the thing this codebase keeps
 * paying for and keeps writing down ("two mechanisms answering the same
 * question"). TaskMenu now renders this and supplies a list of items; not one
 * of its items changed in the move.
 *
 * **The menu is rendered into document.body, not next to its button.** It used
 * to be an absolutely-positioned sibling, which worked until the task row
 * gained `overflow-hidden` to contain the swipe tray — and then the dropdown
 * was silently clipped to the height of the row, so the last few items simply
 * were not there. Nothing errored; the menu just came up short.
 *
 * A portal is the fix rather than removing that `overflow-hidden`, because the
 * clipping is doing a real job: without it, a row dragged to the right during a
 * swipe hangs outside its own bounds and can push the page sideways. Escaping
 * the ancestor entirely is also what stops this recurring the next time
 * something upstream gets an overflow rule — and Settings is exactly that next
 * time: its modal body scrolls inside a fixed-height box.
 *
 * Portals keep React's event bubbling, so a click inside the menu still travels
 * to the row's onClick in the React tree. `data-no-toggle` on the portal root
 * is what the task row's handler looks for — and `closest()` finds it, because
 * it walks the REAL DOM, where this div is a child of body.
 *
 * `items` is an array of `{ label, onClick, disabled, danger, separator }`.
 * Falsy entries are dropped, so a caller may write `isOwner && { ... }` inline.
 * **Closing is this component's job, not the caller's**: every item closes
 * before it acts. That rule was already here, because each caller used to have
 * to remember it and one of them (the agent's delete path) did not.
 */
function KebabMenu({ items, ariaLabel, buttonClassName = '' }) {
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
    if (!isOpen) return undefined;

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
    // Escape closes it too. The task row never needed this because a menu there
    // is one tap from anywhere; inside a modal, the key that dismisses things
    // is already in the user's fingers and would otherwise close the whole
    // modal with a menu still hanging over it.
    function handleKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey, true);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey, true);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  const visible = (items || []).filter(Boolean);
  if (visible.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-no-toggle
        onClick={(e) => { e.stopPropagation(); setIsOpen((v) => !v); }}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        className={`tap-44 p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors flex-shrink-0 ${buttonClassName}`}
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
          {visible.map((item, index) => (
            <MenuItem
              key={item.key || item.label}
              {...item}
              separator={item.separator && index > 0}
              onClick={() => { setIsOpen(false); item.onClick?.(); }}
            />
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

function MenuItem({ label, onClick, disabled, danger, separator }) {
  return (
    <>
      {separator && <hr className="my-1 border-[var(--border-subtle)]" />}
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        disabled={disabled}
        className={`block w-full text-left px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[var(--bg-hover)] ${
          danger ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]'
        }`}
      >
        {label}
      </button>
    </>
  );
}

export default KebabMenu;
