import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from './EmptyState';
import TaskList from './TaskList';
import HistoryList from './HistoryList';
import CustomSelect from './CustomSelect';
import { searchTasks } from '../utils/searchTasks';
import { isVisibleTask } from '../utils/taskDisplay';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { filterTasksByCategory, UNFILED } from '../utils/workspaces';
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
 * component has no sort control and its category list carries no counts, and
 * threading both through it would have made every other screen's filter row
 * negotiate options it does not use. Same component, same `compact` styling,
 * so the two still read as one habit.
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

  // Active-tab filters
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [priority, setPriority] = useState('All');
  const [sortBy, setSortBy] = useState('newest');

  // History-tab filters. 30 days rather than everything, because the question
  // that brings someone here is almost always recent ("where did that go");
  // "Όλο το αρχείο" is one tap away for the rarer one.
  const [historyKind, setHistoryKind] = useState('all');
  const [historyRange, setHistoryRange] = useState(RANGE_MONTH);

  const { activeId, categoriesFor } = useWorkspaces();
  // Memoised, not a bare expression: categoriesFor returns a NEW array every
  // call, so an unwrapped value would change identity on every render and the
  // counts below — which depend on it — would recompute every time, which is
  // the one thing their useMemo exists to prevent.
  //
  // UNFILED is a view, not a workspace: it has no categories of its own.
  const activeCategories = useMemo(
    () => (activeId && activeId !== UNFILED ? categoriesFor(activeId) : []),
    [activeId, categoriesFor]
  );

  // Everything still live: what the Ενεργά tab is about. Completed tasks left
  // this list on 2026-09-04 — they are history now, and the "Εμφάνιση
  // ολοκληρωμένων" toggle that used to reveal them here went with them.
  const liveTasks = useMemo(
    () => tasks.filter((task) => isVisibleTask(task) && !task.is_completed),
    [tasks]
  );

  // Counted over the whole live library rather than over the current search or
  // priority, so the number beside a category answers "how much is in there"
  // instead of "how much of what I already narrowed to".
  const categoryCounts = useMemo(
    () => ({
      All: liveTasks.length,
      [UNFILED]: liveTasks.filter((task) => !task.category_id).length,
      ...Object.fromEntries(
        activeCategories.map((c) => [
          c.record_id,
          liveTasks.filter((task) => task.category_id === c.record_id).length,
        ])
      ),
    }),
    [liveTasks, activeCategories]
  );

  const filteredTasks = useMemo(() => {
    let result = liveTasks;
    if (selectedCategory !== 'All') result = filterTasksByCategory(result, selectedCategory);
    if (priority !== 'All') result = result.filter((task) => (task.priority || 'P3') === priority);
    // Last, so the search runs over the smallest set.
    return searchTasks(result, query);
  }, [liveTasks, selectedCategory, priority, query]);

  const historyCounts = useMemo(
    () => countByKind(tasks, { range: historyRange }),
    [tasks, historyRange]
  );

  const historyRows = useMemo(() => {
    const rows = selectHistory(tasks, { kind: historyKind, range: historyRange });
    const scoped =
      selectedCategory === 'All'
        ? rows
        : rows.filter((row) => filterTasksByCategory([row.task], selectedCategory).length === 1);
    if (!query.trim()) return scoped;
    const matching = new Set(searchTasks(scoped.map((row) => row.task), query));
    return scoped.filter((row) => matching.has(row.task));
  }, [tasks, historyKind, historyRange, selectedCategory, query]);

  // Built from the user's own categories, not from four hardcoded words. Hidden
  // entirely when no workspace is chosen: the chips above are already doing the
  // coarse filtering, and there is no single coherent category list across two
  // workspaces. `label` is a plain string — these names are the user's, so
  // there is nothing to translate.
  //
  // The counts appear on the Ενεργά tab only. They describe live work, and
  // printing "Ακίνητα (18)" over a list of things that already happened would
  // be a number answering the other tab's question — worse than no number,
  // because it looks like it belongs.
  const withCount = (label, n) => (tab === 'active' ? `${label} (${n})` : label);
  const categoryOptions = activeCategories.length
    ? [
        { value: 'All', label: withCount(t('browse.filter_all'), categoryCounts.All) },
        ...activeCategories.map((c) => ({
          value: c.record_id,
          label: withCount(c.name, categoryCounts[c.record_id] ?? 0),
        })),
        { value: UNFILED, label: withCount(t('workspace.unfiled'), categoryCounts[UNFILED]) },
      ]
    : null;

  const priorityOptions = [
    { value: 'All', label: t('task.priority_label') },
    { value: 'P1', label: 'P1' },
    { value: 'P2', label: 'P2' },
    { value: 'P3', label: 'P3' },
  ];

  const sortOptions = [
    { value: 'newest', label: t('browse.sort_newest') },
    { value: 'oldest', label: t('browse.sort_oldest') },
    { value: 'priority', label: t('browse.sort_priority') },
    { value: 'due_date', label: t('browse.sort_due_date') },
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
      <div className="mb-5 flex gap-2">
        {categoryOptions && (
          <div className="flex-1 min-w-0">
            <CustomSelect
              compact
              value={selectedCategory}
              options={categoryOptions}
              onChange={setSelectedCategory}
              ariaLabel={t('workspace.category_label')}
            />
          </div>
        )}

        {tab === 'active' ? (
          <>
            <div className="flex-1 min-w-0">
              <CustomSelect
                compact
                value={priority}
                options={priorityOptions}
                onChange={setPriority}
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

      {tab === 'active' ? (
        filteredTasks.length === 0 ? (
          // A search that found nothing is a different situation from an empty
          // library, and telling someone "no tasks yet" while they are holding a
          // typo is the wrong answer.
          <EmptyState message={query.trim() ? t('empty.no_search_results', { query }) : t('empty.browse')} />
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
              : historyCounts.all === 0 && historyRange === RANGE_ALL
                ? t('browse.empty_history')
                : t('browse.empty_history_filtered')
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
          onTaskRestored={onTaskRestored}
          onShowToast={onShowToast}
        />
      )}
    </div>
  );
}

export default BrowseView;
