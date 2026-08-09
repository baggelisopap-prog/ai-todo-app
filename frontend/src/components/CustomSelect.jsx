import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

const GAP = 4;
const MAX_MENU_HEIGHT = 240; // max-h-60

/**
 * A select whose list is rendered into document.body.
 *
 * Same reason as TaskMenu: the list used to be an absolutely-positioned
 * sibling, which is fine in ordinary page flow and gets clipped the moment an
 * ancestor scrolls or hides its overflow. The task detail sheet is exactly such
 * an ancestor — its body is `overflow-y-auto` — so opening Category or Priority
 * low in the form showed a list cut off partway with no sign that anything was
 * missing.
 *
 * The trade-off of a portal is that the list no longer follows its trigger for
 * free: it is measured on open and closed on scroll, rather than drifting away
 * from the control it belongs to.
 */
export function CustomSelect({ value, options, onChange, placeholder, ariaLabel, compact = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = Math.min(menuRef.current?.scrollHeight ?? 0, MAX_MENU_HEIGHT);

    // Open upwards when there is not enough room below, so the list is never
    // cut off by the bottom of the screen either.
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = menuHeight > 0 && spaceBelow < menuHeight + GAP && rect.top > menuHeight;

    setPosition({
      top: openUp ? rect.top - menuHeight - GAP : rect.bottom + GAP,
      left: rect.left,
      width: rect.width, // matches the trigger, as `w-full` used to
    });
  }, []);

  useLayoutEffect(() => {
    if (isOpen) place();
  }, [isOpen, place]);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e) {
      if (triggerRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setIsOpen(false);
    }
    const close = () => setIsOpen(false);

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [isOpen]);

  const selectedLabel = options.find((o) => o.value === value)?.label || placeholder;

  return (
    <div className="relative" data-no-toggle>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        className={`
          w-full flex items-center justify-between
          ${compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'}
          bg-[var(--bg-input)]
          border border-[var(--border-medium)]
          rounded-md
          text-[var(--text-primary)]
          hover:border-[var(--text-secondary)]
          focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[color:var(--ring-soft)]
          transition-colors
        `}
      >
        <span className="truncate">{selectedLabel}</span>
        <svg className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} flex-shrink-0 text-[var(--text-muted)]`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          data-no-toggle
          role="listbox"
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            width: position?.width,
          }}
          className={`
            fixed z-[60]
            bg-[var(--bg-card)]
            border border-[var(--border-subtle)]
            rounded-md shadow-[var(--shadow-menu)]
            py-1
            max-h-60 overflow-auto
            ${position ? '' : 'invisible'}
          `}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              className={`
                w-full text-left px-3 py-2 text-sm
                hover:bg-[var(--bg-hover)]
                ${opt.value === value ? 'bg-[var(--bg-hover)] font-medium text-[var(--text-primary)]' : 'text-[var(--text-primary)]'}
              `}
            >
              {opt.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export default CustomSelect;
