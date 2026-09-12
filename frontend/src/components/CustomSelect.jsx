import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { matchesOption } from '../utils/taskFilters';

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
 *
 * Two optional additions, both for the case where the list has grown past what
 * a list is good at — a user with twenty categories, which this app has no say
 * over:
 *
 *   `searchable`  — a find box at the top of the menu. Accent- and
 *                   case-insensitive through the same folding the task search
 *                   uses, because "κηπος" must find "Κήπος".
 *   `opt.muted`   — draw that option dimmed. Used for a category with nothing
 *                   in it: still selectable, still in the user's own order,
 *                   just visibly not where the work is.
 */
export function CustomSelect({ value, options, onChange, placeholder, ariaLabel, compact = false, searchable = false }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const [query, setQuery] = useState('');
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

    // Scrolling the PAGE slides the trigger out from under the menu, so the
    // menu has to go. Scrolling the menu's OWN list must not — and a capturing
    // listener on window receives those events too, even though scroll does not
    // bubble. Without the target check, reaching the bottom of a long list
    // closed the thing you were reading.
    function handleScroll(e) {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      setIsOpen(false);
    }

    // A phone fires resize the instant the on-screen keyboard opens. For a
    // searchable menu that means tapping the find box would close the menu
    // before a single character arrived, so it re-measures instead.
    function handleResize() {
      if (searchable) place();
      else setIsOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, searchable, place]);

  const selectedLabel = options.find((o) => o.value === value)?.label || placeholder;
  const visible = searchable ? options.filter((o) => matchesOption(o.label, query)) : options;

  return (
    <div className="relative" data-no-toggle>
      <button
        ref={triggerRef}
        type="button"
        // The query is dropped on every open rather than kept: a menu that
        // reopens still filtered by what you typed last week hides options
        // with no visible reason — the same class of bug as a forgotten filter.
        onClick={() => { setQuery(''); setIsOpen((v) => !v); }}
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
        {/* font-medium: this is the ANSWER the control holds, and it used to be
            set in the same weight as every label and hairline around it —
            which is what made a screen of these read as one flat block
            instead of a list of values. */}
        <span className="truncate font-medium">{selectedLabel}</span>
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
          {searchable && (
            // sticky: the list scrolls under it, so the box is still there
            // after you have scrolled — which is the whole point of having it.
            <div className="sticky top-0 z-10 bg-[var(--bg-card)] px-2 pt-1 pb-2 border-b border-[var(--border-subtle)]">
              {/* No autoFocus on purpose. On a phone it would throw the
                  keyboard up over the list every single time the menu opens,
                  for a list most users can just read. */}
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('filters.find')}
                aria-label={t('filters.find')}
                className="w-full px-2 py-1.5 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
              />
            </div>
          )}

          {visible.map((opt) => (
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
                ${opt.value === value ? 'bg-[var(--bg-hover)] font-medium text-[var(--text-primary)]' : ''}
                ${opt.value !== value && opt.muted ? 'text-[var(--text-muted)]' : ''}
                ${opt.value !== value && !opt.muted ? 'text-[var(--text-primary)]' : ''}
              `}
            >
              {opt.label}
            </button>
          ))}

          {/* A search that matched nothing has to say so. An empty menu looks
              like a broken control, and the fix (clear the box) is invisible. */}
          {visible.length === 0 && (
            <p className="px-3 py-3 text-sm text-[var(--text-muted)]">{t('filters.no_matches')}</p>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

export default CustomSelect;
