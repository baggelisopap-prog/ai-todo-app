import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon } from './TaskIcons';
import { useTaskFilters } from '../hooks/useTaskFilters';
import { ALL, needsFind, matchesOption } from '../utils/taskFilters';
import { UNFILED } from '../utils/workspaces';
import {
  ASSIGNMENT_ALL,
  ASSIGNMENT_MINE,
  ASSIGNMENT_UNASSIGNED,
} from '../utils/assignment';

/**
 * All three filters in one sheet, opened from the «Φίλτρα» button.
 *
 * WHY THEY LEFT THE SCREEN. They used to be two or three rows of controls
 * sitting permanently above every task list — a category dropdown, a priority
 * dropdown, a three-way segmented control — about 66px of chrome carried all
 * day for questions most days never ask. The owner's words after seeing it
 * shipped: «ρε τα μάζεψες πάρα πολύ κολλητά χωρίς αποστάσεις και δεν φαίνονται
 * καλά». He was right, and the fix is not tighter packing: it is giving the
 * controls a place with room in it, and leaving a single button behind.
 *
 * So this sheet is deliberately roomy — 44px rows, 10px gaps, real section
 * labels — and the screen it came from is now 66px taller. The chip row above
 * the list keeps saying what is on, so nothing is hidden by being in here.
 *
 * Everything is a PILL rather than a dropdown, and that is the second half of
 * the trade. A dropdown inside a sheet is a menu inside a menu: two taps to
 * see three options. Here every option for every axis is visible at once, and
 * choosing one is a single tap.
 */
function FilterSheet({ onClose }) {
  const { t } = useTranslation();
  const {
    filters, setFilter, clearAll, activeCount, roomActive,
    categories, counts, showCategory, showAssignment,
  } = useTaskFilters();

  const [query, setQuery] = useState('');
  const withFind = needsFind(categories.length);

  const categoryRows = [
    { value: ALL, label: t('filters.any'), hint: counts.All },
    ...categories.map((c) => ({
      value: c.record_id,
      label: c.name,
      hint: counts[c.record_id] ?? 0,
    })),
    { value: UNFILED, label: t('workspace.unfiled'), hint: counts[UNFILED] ?? 0 },
  ].filter((row) => !withFind || !query.trim() || matchesOption(row.label, query));

  const priorityRows = [
    { value: ALL, label: t('filters.any') },
    { value: 'P1', label: 'P1' },
    { value: 'P2', label: 'P2' },
    { value: 'P3', label: 'P3' },
  ];

  const assignmentRows = [
    { value: ASSIGNMENT_ALL, label: t('assignment.all') },
    { value: ASSIGNMENT_MINE, label: t('assignment.mine') },
    { value: ASSIGNMENT_UNASSIGNED, label: t('assignment.unassigned') },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 animate-fade-in flex items-end md:items-center justify-center md:p-4"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-sm bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('filters.title')}
      >
        <div className="px-5 pt-5 pb-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('filters.title')}</h2>
        </div>

        <div className="px-5 pb-2 space-y-5">
          {showCategory && (
            <Section label={t('task.category_label')}>
              {withFind && (
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('filters.find')}
                  aria-label={t('filters.find')}
                  className="w-full mb-2 px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
                />
              )}
              <Pills
                rows={categoryRows}
                value={filters.category}
                onPick={(value) => setFilter('category', value)}
                empty={t('filters.no_matches')}
              />
            </Section>
          )}

          <Section label={t('task.priority_label')}>
            <Pills
              rows={priorityRows}
              value={filters.priority}
              onPick={(value) => setFilter('priority', value)}
            />
          </Section>

          {/* Only where more than one person can hold a task — on a solo
              account these three buttons all produce the same list. */}
          {showAssignment && (
            <Section label={t('assignment.label')}>
              <Pills
                rows={assignmentRows}
                value={filters.assignment || ASSIGNMENT_ALL}
                onPick={(value) => setFilter('assignment', value)}
              />
            </Section>
          )}
        </div>

        {/* pb-safe: on a phone this sheet is the bottom-most thing on screen,
            so without the inset its buttons sit under the home indicator. */}
        <div className="sticky bottom-0 flex items-center gap-3 px-5 py-4 mt-2 border-t border-[var(--border-subtle)] bg-[var(--bg-modal)] pb-safe">
          {/* Clears the ROOM as well, which is the owner's decision and the
              honest reading of it: if the workspace is a filter, a button
              promising to clear the filters cannot leave one running. */}
          {(activeCount > 0 || roomActive) && (
            <button
              type="button"
              onClick={() => { clearAll(); onClose(); }}
              className="tap-44 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline decoration-[var(--border-medium)] underline-offset-2"
            >
              {t('filters.clear_all')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="tap-44 ml-auto px-4 py-2 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-[var(--text-inverse)] text-sm font-semibold"
          >
            {t('actions.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {label}
      </p>
      {children}
    </div>
  );
}

/**
 * One axis as a wrap of pills, the selected one ticked.
 *
 * The tick and not only the fill: the same rule the rest of the app follows,
 * so the selection survives someone who cannot tell the two shades apart.
 */
function Pills({ rows, value, onPick, empty }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">{empty}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((row) => {
        const isSelected = row.value === value;
        return (
          <button
            key={row.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onPick(row.value)}
            className={`tap-44 flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-full border text-sm transition-colors ${
              isSelected
                ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium'
                : 'border-[var(--border-medium)] bg-[var(--bg-input)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            {isSelected && <CheckIcon className="w-3 h-3 flex-shrink-0" />}
            <span className="truncate max-w-[11rem]">{row.label}</span>
            {row.hint !== undefined && (
              <span className={`text-xs tabular-nums ${isSelected ? 'opacity-80' : 'text-[var(--text-muted)]'}`}>
                {row.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default FilterSheet;
