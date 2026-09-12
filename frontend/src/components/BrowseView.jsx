import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from './EmptyState';
import TaskList from './TaskList';
import HistoryList from './HistoryList';
import CustomSelect from './CustomSelect';
import ActiveFilters from './ActiveFilters';
import { searchTasks } from '../utils/searchTasks';
import { isVisibleTask } from '../utils/taskDisplay';
import { useTaskFilters } from '../hooks/useTaskFilters';
import { needsFind } from '../utils/taskFilters';
import {
  selectHistory,
  countByKind,
  KIND_COMPLETED,
  KIND_DELETED,
  KIND_MISSED,
  KIND_REJECTED,
  RANGE_WEEK,
  RANGE_MONTH,
  RANGE_YEAR,
  RANGE_ALL,
} from '../utils/taskHistory';

/**
 * Browse: the whole library, in two tabs.
 *
 * The split is not decoration. In "Ενεργά" you are looking for something to
 * DO, so the useful controls are category, priority and sort order. In
 * "Ιστορικό" you are looking for what HAPPENED, so they are what kind of event
 * and how far back — and the list is grouped by day rather than sorted by
 * urgency. One screen carrying both sets of controls would show five rows of
 * filters above two tasks, which is what this screen used to do.
 *
 * The controls are plain CustomSelects rather than the shared FilterBar: that
 * component has no sort control, and threading one through it would have made
 * every other screen's filter row negotiate an option it does not use. Same
 * component, same `compact` styling, so the two still read as one habit.
 *
 * The VALUES behind category and priority are no longer this screen's own,
 * though — they come from the one shared copy every task screen reads, so
 * narrowing to κήπος here is still κήπος in Today. Only the sort order, the
 * search box and the two history controls stay local: they are questions the
 * other screens do not ask.
 */
function BrowseView({
  tasks,
  expandedTaskId,
  onToggleExpand,
  onTaskUpdate,
  onTaskDeleted,
  onTaskRestored,
  onShowToast,
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('active');
  const [query, setQuery] = useState('');

  // Sort order is this screen's alone — nothing else offers it.
  const [sortBy, setSortBy] = useState('created_desc');

  // History-tab filters. 30 days rather than everything, because the question
  // that brings someone here is almost always recent ("where did that go");
  // "Όλο το αρχείο" is one tap away for the rarer one.
  const [historyKind, setHistoryKind] = useState('all');
  const [historyRange, setHistoryRange] = useState(RANGE_MONTH);

  const {
    filters, setFilter, apply, activeCount, clearAll,
    categories, categoryOptions, priorityOptions,
  } = useTaskFilters();

  // Everything still live: what the Ενεργά tab is about. Completed tasks left
  // this list on 2026-09-04 — they are history now, and the "Εμφάνιση
  // ολοκληρωμένων" toggle that used to reveal them here went with them.
  const liveTasks = useMemo(
    () => tasks.filter((task) => isVisibleTask(task) && !task.is_completed),
    [tasks]
  );

  // The counts beside each category are the provider's now, computed the way
  // this screen used to compute them — over the whole live library, not over
  // what is already narrowed — so Today and the Calendar print the same number
  // instead of a different one.
  const filteredTasks = useMemo(
    // Search last, so it runs over the smallest set.
    () => searchTasks(apply(liveTasks), query),
    [liveTasks, apply, query]
  );

  const historyCounts = useMemo(
    () => countByKind(tasks, { range: historyRange }),
    [tasks, historyRange]
  );

  // Both numbers come out of one pass: the rows to draw, and how many the
  // kind/range picked before the filters had their say. The second is what the
  // "hidden by filters" line reports, and it has to be counted HERE — asking
  // historyCounts.all instead would count every kind of event in the range,
  // so a filter hiding three completions would claim to be hiding forty.
  const history = useMemo(() => {
    const rows = selectHistory(tasks, { kind: historyKind, range: historyRange });
    // The same three filters as the Ενεργά tab, through the same function: a
    // chip reading «Δικά μου» has to mean the same thing on both tabs, or the
    // row that explains what is hidden explains the wrong thing.
    const scoped = activeCount === 0
      ? rows
      : rows.filter((row) => apply([row.task]).length === 1);
    if (!query.trim()) return { rows: scoped, total: rows.length };
    const matching = new Set(searchTasks(scoped.map((row) => row.task), query));
    return { rows: scoped.filter((row) => matching.has(row.task)), total: rows.length };
  }, [tasks, historyKind, historyRange, apply, activeCount, query]);
  const historyRows = history.rows;

  // Hidden entirely when the active workspace has no categories: the chips
  // above are already doing the coarse filtering, and there is no single
  // coherent category list across two workspaces.
  //
  // The counts appear on the Ενεργά tab only. They describe live work, and
  // printing "Ακίνητα (18)" over a list of things that already happened would
  // be a number answering the other tab's question — worse than no number,
  // because it looks like it belongs.
  const categoryChoices = categories.length
    ? categoryOptions({ withCounts: tab === 'active' })
    : null;

  // Each option names WHICH date and WHICH direction. "Νεότερα" did neither:
  // the row shows the due date while that sort ordered by the creation date,
  // so the list read as shuffled and a working sort was indistinguishable from
  // a broken one. "Λήγει: αργότερα πρώτα" is genuinely new — sorting by due
  // date only ever went one way.
  const sortOptions = [
    { value: 'created_desc', label: t('browse.sort_created_desc') },
    { value: 'created_asc', label: t('browse.sort_created_asc') },
    { value: 'due_asc', label: t('browse.sort_due_asc') },
    { value: 'due_desc', label: t('browse.sort_due_desc') },
    { value: 'priority', label: t('browse.sort_priority') },
  ];

  const kindOptions = [
    { value: 'all', label: `${t('browse.filter_all')} (${historyCounts.all})` },
    { value: KIND_COMPLETED, label: `${t('browse.kind_completed')} (${historyCounts[KIND_COMPLETED]})` },
    { value: KIND_DELETED, label: `${t('browse.kind_deleted')} (${historyCounts[KIND_DELETED]})` },
    { value: KIND_MISSED, label: `${t('browse.kind_missed')} (${historyCounts[KIND_MISSED]})` },
    { value: KIND_REJECTED, label: `${t('browse.kind_rejected')} (${historyCounts[KIND_REJECTED]})` },
  ];

  const rangeOptions = [
    { value: RANGE_WEEK, label: t('browse.range_week') },
    { value: RANGE_MONTH, label: t('browse.range_month') },
    { value: RANGE_YEAR, label: t('browse.range_year') },
    { value: RANGE_ALL, label: t('browse.range_all') },
  ];

  const tabs = [
    { id: 'active', label: t('browse.tab_active') },
    { id: 'history', label: t('browse.tab_history') },
  ];

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      {/* Heading lives in AppBar — see TodayView for the reasoning. */}

      {/* Two tabs, underlined rather than pilled: they switch what the screen
          IS, while the pill-shaped controls below switch what it shows. Giving
          them the same shape would have made the hierarchy unreadable. */}
      <div className="flex gap-1 border-b border-[var(--border-subtle)] mb-4" role="tablist">
        {tabs.map(({ id, label }) => {
          const isActive = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
                isActive
                  ? 'border-[var(--brand-primary)] text-[var(--text-primary)] font-medium'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* No debounce and no request. The tasks are already in memory, so this
          filters on every keystroke for free — which is also why it can be the
          first thing on the screen rather than hidden behind a magnifier. */}
      <div className="relative mb-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('browse.search_placeholder')}
          aria-label={t('browse.search_placeholder')}
          className="w-full pl-9 pr-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[color:var(--ring-soft)] transition-colors"
        />
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
      </div>

      {/* One row of controls, not three. Which controls depends on the question
          the tab answers. */}
      <div className={`flex gap-2 ${activeCount > 0 ? 'mb-2' : 'mb-5'}`}>
        {categoryChoices && (
          <div className="flex-1 min-w-0">
            <CustomSelect
              compact
              value={filters.category}
              options={categoryChoices}
              onChange={(value) => setFilter('category', value)}
              ariaLabel={t('workspace.category_label')}
              // A find box once the list is longer than a list is good at.
              searchable={needsFind(categories.length)}
            />
          </div>
        )}

        {tab === 'active' ? (
          <>
            <div className="flex-1 min-w-0">
              <CustomSelect
                compact
                value={filters.priority}
                options={priorityOptions()}
                onChange={(value) => setFilter('priority', value)}
                ariaLabel={t('task.priority_label')}
              />
            </div>
            <div className="flex-1 min-w-0">
              <CustomSelect
                compact
                value={sortBy}
                options={sortOptions}
                onChange={setSortBy}
                ariaLabel={t('browse.sort_label')}
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <CustomSelect
                compact
                value={historyKind}
                options={kindOptions}
                onChange={setHistoryKind}
                ariaLabel={t('browse.history_what')}
              />
            </div>
            <div className="flex-1 min-w-0">
              <CustomSelect
                compact
                value={historyRange}
                options={rangeOptions}
                onChange={setHistoryRange}
                ariaLabel={t('browse.history_when')}
              />
            </div>
          </>
        )}
      </div>

      {/* Same row, same place, same gesture as Today and the Calendar. It
          renders nothing at all when nothing is filtered, which is why the
          controls above lost their bottom margin to it rather than gaining
          height. */}
      {activeCount > 0 && (
        <div className="mb-5">
          <ActiveFilters />
        </div>
      )}

      {tab === 'active' ? (
        filteredTasks.length === 0 ? (
          // Three different silences, told apart. A search that found nothing
          // is not an empty library, and neither is a filter that excluded
          // everything — that last one used to read "Δεν βρέθηκαν εργασίες"
          // over a library with 340 of them.
          query.trim() ? (
            <EmptyState message={t('empty.no_search_results', { query })} />
          ) : activeCount > 0 && liveTasks.length > 0 ? (
            <EmptyState
              message={t('filters.hidden', { count: liveTasks.length })}
              action={{ label: t('filters.clear_all'), onClick: clearAll }}
            />
          ) : (
            <EmptyState message={t('empty.browse')} />
          )
        ) : (
          <TaskList
            tasks={filteredTasks}
            sortBy={sortBy}
            expandedTaskId={expandedTaskId}
            onToggleExpand={onToggleExpand}
            onUpdateTask={onTaskUpdate}
            onTaskDeleted={onTaskDeleted}
            onShowToast={onShowToast}
          />
        )
      ) : historyRows.length === 0 ? (
        // Three different silences, told apart. A filter that excluded
        // everything is not an empty archive, and an empty archive on a system
        // that only started recording deletions today is not a fault.
        <EmptyState
          message={
            query.trim()
              ? t('empty.no_search_results', { query })
              : activeCount > 0 && history.total > 0
                ? t('filters.hidden', { count: history.total })
                : historyCounts.all === 0 && historyRange === RANGE_ALL
                  ? t('browse.empty_history')
                  : t('browse.empty_history_filtered')
          }
          action={
            !query.trim() && activeCount > 0 && history.total > 0
              ? { label: t('filters.clear_all'), onClick: clearAll }
              : undefined
          }
          hint={
            historyCounts.all === 0 && historyRange === RANGE_ALL && !query.trim()
              ? t('browse.empty_history_hint')
              : undefined
          }
        />
      ) : (
        <HistoryList
          rows={historyRows}
          onTaskUpdate={onTaskUpdate}
          onTaskRestored={onTaskRestored}
          onShowToast={onShowToast}
        />
      )}
    </div>
  );
}

export default BrowseView;
