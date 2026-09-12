import { useTranslation } from 'react-i18next';
import CustomSelect from './CustomSelect';
import ActiveFilters from './ActiveFilters';
import { useTaskFilters } from '../hooks/useTaskFilters';
import { needsFind } from '../utils/taskFilters';
import {
  ASSIGNMENT_ALL,
  ASSIGNMENT_MINE,
  ASSIGNMENT_UNASSIGNED,
} from '../utils/assignment';

/**
 * The category + priority + whose controls, used by Today and the Calendar.
 *
 * It takes NO PROPS any more, and that is the change. It used to receive six —
 * three values and three setters — from whichever screen rendered it, which
 * meant each screen owned its own copy of the answers and walking from Today
 * to the Calendar started over. Now it reads the one shared copy
 * (TaskFilterProvider), so the filters follow the user instead of the user
 * re-entering them.
 *
 * The category control still disappears when the active workspace has no
 * categories, and on "Όλα": there is no coherent single list of categories
 * across two workspaces — «μετοχές» and «κήπος» do not belong in one menu —
 * and the chips above are already doing the coarse filtering.
 *
 * What is new below the controls is ActiveFilters, which renders only when
 * something is actually filtered. That is why this component can stay three
 * rows tall at its worst and be SHORTER than before at rest.
 */
function FilterBar() {
  const { t } = useTranslation();
  const {
    filters, setFilter, categoryOptions, priorityOptions, showCategory, showAssignment, categories,
  } = useTaskFilters();

  const categoryChoices = showCategory ? categoryOptions() : null;
  const priorityChoices = priorityOptions();

  const assignmentOptions = [
    { value: ASSIGNMENT_ALL, label: t('assignment.all') },
    { value: ASSIGNMENT_MINE, label: t('assignment.mine') },
    { value: ASSIGNMENT_UNASSIGNED, label: t('assignment.unassigned') },
  ];

  return (
    <div className="mb-3 space-y-2">
      <div className="flex gap-2">
        {categoryChoices && (
          <div className="flex-1 min-w-0">
            <CustomSelect
              compact
              value={filters.category}
              options={categoryChoices}
              onChange={(value) => setFilter('category', value)}
              ariaLabel={t('workspace.category_label')}
              // A find box once the list is past what a list is good at. The
              // threshold is a rule rather than a guess about this account —
              // see switcherShape's comment in utils/taskFilters.js.
              searchable={needsFind(categories.length)}
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <CustomSelect
            compact
            value={filters.priority}
            options={priorityChoices}
            onChange={(value) => setFilter('priority', value)}
            ariaLabel={t('task.priority_label')}
          />
        </div>
      </div>

      {/* A segmented control rather than a fourth dropdown. Three short,
          mutually exclusive answers that are looked at constantly: putting them
          behind a tap means the current one is invisible until you open it,
          which for "am I looking at everything or only my own?" is the one
          thing you must be able to see without asking.

          Shown only where more than one person can hold a task — the provider
          decides that now, so the CONTROL and the FILTER cannot disagree about
          whether the question applies. */}
      {showAssignment && (
        <div
          role="group"
          aria-label={t('assignment.label')}
          className="flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5"
        >
          {assignmentOptions.map((option) => {
            const isActive = (filters.assignment || ASSIGNMENT_ALL) === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => setFilter('assignment', option.value)}
                className={`tap-40 flex-1 min-w-0 truncate rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--brand-primary)] text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}

      <ActiveFilters />
    </div>
  );
}

export default FilterBar;
