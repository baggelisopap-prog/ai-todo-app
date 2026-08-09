/**
 * One line in the settings list: a name on the left, its CURRENT VALUE on the
 * right, and a chevron if it leads somewhere.
 *
 * The value is the whole point. Settings used to be eight accordions, all
 * closed on every open, and a closed accordion shows only its name — so the
 * only way to find out what your language was set to, or whether daily
 * summaries were on, was to open the section and look. Eight doors, no labels
 * on the contents. A row that reads "Language › Ελληνικά" has already answered
 * the question most visits were asking.
 */
function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-muted)] flex-shrink-0">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function SettingsRow({ label, value, onClick, danger = false, showChevron = true }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)] ${
        danger ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]'
      }`}
    >
      <span className="flex-1 min-w-0 text-sm font-medium truncate">{label}</span>
      {value && (
        <span className="text-sm text-[var(--text-secondary)] truncate max-w-[45%]">{value}</span>
      )}
      {showChevron && <ChevronIcon />}
    </button>
  );
}

/**
 * Rows are grouped into cards rather than separated by headings. Fewer words on
 * screen, and the grouping still reads — which matters here because the list
 * replaced eight named sections and would otherwise be a wall of equal lines.
 */
export function SettingsGroup({ children }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--border-subtle)]">
      {children}
    </div>
  );
}

export default SettingsRow;
