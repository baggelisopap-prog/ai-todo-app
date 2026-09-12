import { useTranslation } from 'react-i18next';
import { useTaskFilters } from '../hooks/useTaskFilters';

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
 * exists at all, and that the «Φίλτρα» button it sits beside carries the funnel
 * and the count.
 *
 * The spacing is 8px between pills and 32px of pill height, and those two
 * numbers are the owner's correction of the first version of this row: «τα
 * μάζεψες πάρα πολύ κολλητά χωρίς αποστάσεις». 4px apart and 26px tall was too
 * small to aim a thumb at and read as one grey smear rather than as separate
 * things you can remove one at a time.
 */
function ActiveFilters() {
  const { t } = useTranslation();
  const { chips, clearOne, clearAll, roomActive } = useTaskFilters();

  if (chips.length === 0) return null;

  // The room counts as one of the things "clear everything" would clear, so it
  // counts toward deciding whether that button is worth showing. Two records
  // is the threshold: with one, the chip's own × already is the clear button
  // and a second control saying the same thing beside it is noise.
  const records = chips.length + (roomActive ? 1 : 0);

  return (
    <div
      role="group"
      aria-label={t('filters.active_label')}
      // No margin of its own: it is placed inside whatever spacing its caller
      // already uses, and a row that only sometimes exists must not also
      // sometimes add a gap.
      className="flex flex-wrap items-center gap-2"
    >
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => clearOne(chip.key)}
          // The accessible name says what the tap DOES. "κήπος" alone would
          // read to a screen reader as a label, and this is a button that
          // removes it.
          aria-label={t('filters.remove_one', { name: chip.label })}
          className="tap-44 group flex items-center gap-1.5 min-h-[32px] max-w-full rounded-full border border-[var(--border-medium)] bg-[var(--bg-hover)] pl-3 pr-2.5 py-1.5 text-sm font-medium text-[var(--text-primary)] hover:border-[var(--text-secondary)] transition-colors"
        >
          <span className="truncate">{chip.label}</span>
          <svg
            className="w-3.5 h-3.5 flex-shrink-0 text-[var(--text-muted)] group-hover:text-[var(--text-primary)]"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      ))}

      {/* Clears the ROOM as well — the owner's decision, and the honest
          reading of it: if the workspace is a filter, a button promising to
          clear the filters cannot leave one running. */}
      {records >= 2 && (
        <button
          type="button"
          onClick={clearAll}
          className="tap-44 px-2 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline decoration-[var(--border-medium)] underline-offset-2 transition-colors"
        >
          {t('filters.clear_all')}
        </button>
      )}
    </div>
  );
}

export default ActiveFilters;
