import { useId } from 'react';

// Shared accordion-row shell used by SettingsModal.jsx. The content wrapper
// stays MOUNTED at all times — visibility is toggled with a class, not
// conditional rendering — so collapsing a section never resets in-progress
// form state inside it (e.g. a partially typed display_name) and never
// re-runs that section's own effects on every expand.
function CollapsibleSection({ title, isOpen, onToggle, children }) {
  const contentId = useId();

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={contentId}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-[var(--bg-hover)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-inset"
      >
        <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
        <ChevronDownIcon
          className={`w-4 h-4 text-[var(--text-muted)] flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <div id={contentId} className={isOpen ? 'block' : 'hidden'}>
        <div className="px-4 pb-4 pt-3 border-t border-[var(--border-subtle)]">
          {children}
        </div>
      </div>
    </div>
  );
}

function ChevronDownIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default CollapsibleSection;
