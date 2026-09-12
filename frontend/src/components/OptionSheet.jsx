import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon } from './TaskIcons';
import { matchesOption } from '../utils/taskFilters';

/**
 * Pick one of a list, from the bottom of the screen.
 *
 * This started as the deliberate exception to "settings open in a sub-screen":
 * Language has two options and Appearance has three, and pushing a whole screen
 * to show two buttons is a tap to get in, a tap to choose and a tap to get
 * back. The row above it already shows the current value, which was the actual
 * problem with the old accordions, so the screen would have bought nothing.
 *
 * It now also carries the ROOM PICKER — the list of workspaces behind the app
 * bar's title. That is a bigger list than "a handful", so three things were
 * added rather than a second sheet written:
 *
 *   `option.swatch` — a colour dot, because a workspace's colour is how it is
 *                     recognised everywhere else in the app.
 *   `option.hint`   — a right-aligned number, "how much is in there".
 *   `searchable`    — a find box, for the account with twenty rooms. Same
 *                     accent-folding as the task search, so «κηπος» finds
 *                     «Κήπος».
 *
 * What did NOT change is the tick: the selection survives someone who cannot
 * tell two shades apart, which is exactly why the colour dot is an addition
 * beside it and never a replacement for it.
 */
function OptionSheet({ title, options, value, onPick, onClose, searchable = false }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const visible = searchable ? options.filter((o) => matchesOption(o.label, query)) : options;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 animate-fade-in flex items-end md:items-center justify-center md:p-4"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-xs bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] p-2 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <p className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {title}
        </p>

        {searchable && (
          <div className="px-2 pb-2 pt-1">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('filters.find')}
              aria-label={t('filters.find')}
              className="w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
            />
          </div>
        )}

        {visible.map((option) => {
          const isSelected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={isSelected}
              onClick={() => onPick(option.value)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-md hover:bg-[var(--bg-hover)] text-left"
            >
              {/* A room with no colour of its own gets a hollow ring rather
                  than a filled dot — the same distinction SideNav already makes
                  for «Όλα» and «Αταξινόμητα», which are views and not rooms. */}
              {option.swatch !== undefined && (
                <span
                  aria-hidden="true"
                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    option.swatch ? '' : 'border border-[var(--border-medium)]'
                  }`}
                  style={option.swatch ? { backgroundColor: option.swatch } : undefined}
                />
              )}
              <span className={`flex-1 min-w-0 truncate text-sm ${isSelected ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>
                {option.label}
              </span>
              {option.hint !== undefined && (
                <span className="flex-shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
                  {option.hint}
                </span>
              )}
              {/* The tick, not a coloured row: the selection has to survive
                  someone who cannot tell the two shades apart. */}
              {isSelected && <CheckIcon className="w-3.5 h-3.5 flex-shrink-0 text-[var(--brand-primary)]" />}
            </button>
          );
        })}

        {visible.length === 0 && (
          <p className="px-4 py-4 text-sm text-[var(--text-muted)]">{t('filters.no_matches')}</p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full px-4 py-3 mt-1 rounded-md text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          {t('actions.cancel')}
        </button>
      </div>
    </div>
  );
}

export default OptionSheet;
