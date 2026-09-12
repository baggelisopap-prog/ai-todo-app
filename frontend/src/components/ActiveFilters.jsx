import { useTranslation } from 'react-i18next';
import { useTaskFilters } from '../hooks/useTaskFilters';
import { FunnelIcon } from './icons';

/**
 * The one row that says out loud what is being hidden.
 *
 * THE PROBLEM IT SOLVES, in the owner's words: «χάνομαι — δεν βλέπω τι φίλτρο
 * τρέχει, και δεν έχω κουμπί να τα σβήσω όλα». Until now the only record of an
 * active filter lived INSIDE the menu that set it, so a forgotten P1 produced
 * "Τίποτα για σήμερα 🎉" over a day that had work in it. A closed dropdown
 * does show its value — but you have to look at three of them and know which
 * value counts as "off".
 *
 * Two properties do the work:
 *
 *   - It renders NOTHING when nothing is filtered. So the common case costs no
 *     height at all — this row is cheaper than the controls it explains, and
 *     it only appears in the state that needs explaining.
 *   - Every chip removes ITS OWN filter, and from two up there is a single
 *     "clear everything". Seeing what is on and undoing it are the same
 *     gesture, which is the part a non-technical user should not have to learn.
 *
 * Quiet grey rather than the brand red: red in this app means destructive or
 * primary, and a filter is neither. What makes the row noticeable is that it
 * exists at all, plus the funnel in front of it.
 */
function ActiveFilters() {
  const { t } = useTranslation();
  const { chips, clearOne, clearAll } = useTaskFilters();

  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={t('filters.active_label')}
      // No margin of its own: it is placed inside whatever spacing its caller
      // already uses, and a row that only sometimes exists must not also
      // sometimes add a gap.
      className="flex flex-wrap items-center gap-1.5"
    >
      {/* aria-hidden on a wrapper, not on the icon: FunnelIcon takes only a
          className, and an icon that repeated the group's name would have the
          row announced twice. */}
      <span aria-hidden="true" className="flex-shrink-0 text-[var(--text-muted)]">
        <FunnelIcon />
      </span>

      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => clearOne(chip.key)}
          // The accessible name says what the tap DOES. "κήπος" alone would
          // read to a screen reader as a label, and this is a button that
          // removes it.
          aria-label={t('filters.remove_one', { name: chip.label })}
          className="tap-40 group flex items-center gap-1.5 max-w-full rounded-full border border-[var(--border-medium)] bg-[var(--bg-hover)] pl-2.5 pr-2 py-1 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--text-secondary)] transition-colors"
        >
          <span className="truncate">{chip.label}</span>
          <svg
            className="w-3 h-3 flex-shrink-0 text-[var(--text-muted)] group-hover:text-[var(--text-primary)]"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      ))}

      {/* From two filters up. With one, the chip's own × already is the clear
          button, and a second control beside it saying the same thing is noise. */}
      {chips.length >= 2 && (
        <button
          type="button"
          onClick={clearAll}
          className="tap-40 px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline decoration-[var(--border-medium)] underline-offset-2 transition-colors"
        >
          {t('filters.clear_all')}
        </button>
      )}
    </div>
  );
}

export default ActiveFilters;
