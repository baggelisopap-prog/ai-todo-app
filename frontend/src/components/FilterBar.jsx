import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ActiveFilters from './ActiveFilters';
import FilterSheet from './FilterSheet';
import { useTaskFilters } from '../hooks/useTaskFilters';
import { FunnelIcon } from './icons';

/**
 * One line above the list: a button that opens the filters, and the filters
 * that are on.
 *
 * WHAT IT REPLACED, and the numbers are the argument. This was two or three
 * permanent rows of controls — a category dropdown beside a priority dropdown,
 * then a three-way segmented control — roughly 66px above every task list, all
 * day, for questions most days never ask. With the workspace chips above it
 * (now also gone, into the app bar's title), the first task on the phone
 * started about 205px down a 660px screen.
 *
 * Now: one 36px line. The pickers live in FilterSheet, where they have room to
 * breathe instead of being packed into a 30px strip — which was the owner's
 * complaint about the first version of this work, and a fair one.
 *
 * The button is not the only thing that says something is filtered: the chips
 * beside it name each active filter and remove it with one tap. The badge on
 * the button is the count, so the fact survives even when the chips wrap out of
 * sight on a narrow screen.
 *
 * Takes no props. It reads the one shared copy of the filters, which is what
 * makes «Κήπος» in Today still «Κήπος» in the Calendar.
 */
function FilterBar() {
  const { t } = useTranslation();
  const { activeCount } = useTaskFilters();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className="tap-44 flex items-center gap-1.5 flex-shrink-0 px-3 py-1.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-input)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] transition-colors"
      >
        <FunnelIcon className="w-3.5 h-3.5 flex-shrink-0" />
        {t('filters.title')}
        {activeCount > 0 && (
          <span
            // aria-hidden: the button's text already reads «Φίλτρα», and the
            // chips beside it name every one of them. A screen reader counting
            // them here as well would say the same thing three times.
            aria-hidden="true"
            className="min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-[var(--brand-primary)] text-[var(--text-inverse)] text-[0.65rem] font-semibold leading-[1.15rem] text-center"
          >
            {activeCount}
          </span>
        )}
      </button>

      <ActiveFilters />

      {isOpen && <FilterSheet onClose={() => setIsOpen(false)} />}
    </div>
  );
}

export default FilterBar;
