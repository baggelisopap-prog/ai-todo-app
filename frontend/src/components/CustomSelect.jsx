import { useState, useRef, useEffect } from 'react';

export function CustomSelect({ value, options, onChange, placeholder, ariaLabel, compact = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedLabel = options.find((o) => o.value === value)?.label || placeholder;

  return (
    <div ref={ref} className="relative" data-no-toggle>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={ariaLabel}
        className={`
          w-full flex items-center justify-between
          ${compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'}
          bg-[var(--bg-input)]
          border border-[var(--border-medium)]
          rounded-md
          text-[var(--text-primary)]
          hover:border-[var(--text-secondary)]
          focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-blue-100
          transition-colors
        `}
      >
        <span className="truncate">{selectedLabel}</span>
        <svg className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} flex-shrink-0 text-[var(--text-muted)]`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div
          className="
            absolute z-30 mt-1 w-full
            bg-[var(--bg-card)]
            border border-[var(--border-subtle)]
            rounded-md shadow-[var(--shadow-menu)]
            py-1
            max-h-60 overflow-auto
          "
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              className={`
                w-full text-left px-3 py-2 text-sm
                hover:bg-[var(--bg-hover)]
                ${opt.value === value ? 'bg-[var(--bg-hover)] font-medium' : 'text-[var(--text-primary)]'}
              `}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default CustomSelect;
