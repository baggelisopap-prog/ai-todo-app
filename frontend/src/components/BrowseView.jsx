import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from './EmptyState';
import TaskList from './TaskList';
import { searchTasks } from '../utils/searchTasks';

function BrowseView({ tasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted, onShowToast }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  const [showCompleted, setShowCompleted] = useState(false);
  const [showRejected, setShowRejected] = useState(false);

  const categoryCounts = useMemo(() => {
    let base = tasks;
    if (!showCompleted) base = base.filter((t) => !t.is_completed);
    if (!showRejected) base = base.filter((t) => !t.is_rejected);
    return {
      All: base.length,
      Business: base.filter((t) => t.category === 'Business').length,
      Personal: base.filter((t) => t.category === 'Personal').length,
      Unknown: base.filter((t) => t.category === 'Unknown').length,
      Hostaway: base.filter((t) => t.category === 'Hostaway').length,
    };
  }, [tasks, showCompleted, showRejected]);

  const completedCount = useMemo(() => tasks.filter((t) => t.is_completed).length, [tasks]);
  const rejectedCount = useMemo(() => tasks.filter((t) => t.is_rejected).length, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (!showCompleted) result = result.filter((t) => !t.is_completed);
    if (!showRejected) result = result.filter((t) => !t.is_rejected);
    if (selectedCategory !== 'All') result = result.filter((t) => t.category === selectedCategory);
    // Last, so the search runs over the smallest set — and so the counts on the
    // category cards keep describing the whole library rather than the search.
    return searchTasks(result, query);
  }, [tasks, selectedCategory, showCompleted, showRejected, query]);

  const categoryOptions = [
    { value: 'All', labelKey: 'browse.filter_all', accentClass: 'hover:border-[var(--text-secondary)]', selectedClass: 'border-[var(--text-secondary)] bg-[var(--bg-hover)]' },
    { value: 'Business', labelKey: 'browse.filter_business', accentClass: 'hover:border-[var(--category-business)]/60', selectedClass: 'border-[var(--category-business)] bg-[var(--category-business)]/10' },
    { value: 'Personal', labelKey: 'browse.filter_personal', accentClass: 'hover:border-[var(--category-personal)]/60', selectedClass: 'border-[var(--category-personal)] bg-[var(--category-personal)]/10' },
    { value: 'Unknown', labelKey: 'browse.filter_unknown', accentClass: 'hover:border-[var(--text-secondary)]', selectedClass: 'border-[var(--text-secondary)] bg-[var(--bg-hover)]' },
    { value: 'Hostaway', labelKey: 'browse.filter_hostaway', accentClass: 'hover:border-[var(--category-hostaway)]/60', selectedClass: 'border-[var(--category-hostaway)] bg-[var(--category-hostaway)]/10' },
  ];

  const sortOptions = [
    { value: 'newest', labelKey: 'browse.sort_newest' },
    { value: 'oldest', labelKey: 'browse.sort_oldest' },
    { value: 'priority', labelKey: 'browse.sort_priority' },
    { value: 'due_date', labelKey: 'browse.sort_due_date' },
  ];

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      {/* Heading lives in AppBar — see TodayView for the reasoning. */}

      {/* No debounce and no request. The tasks are already in memory, so this
          filters on every keystroke for free — which is also why it can be the
          first thing on the screen rather than hidden behind a magnifier. */}
      <div className="relative mb-4">
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

      <div className="mb-6 space-y-4">
        {/* Category cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {categoryOptions.map(({ value, labelKey, accentClass, selectedClass }) => {
            const isSelected = selectedCategory === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setSelectedCategory(value)}
                aria-pressed={isSelected}
                className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-colors cursor-pointer text-center ${
                  isSelected
                    ? selectedClass
                    : `border-[var(--border-subtle)] bg-[var(--bg-card)] ${accentClass}`
                }`}
              >
                <span className="text-xs text-[var(--text-secondary)] font-medium uppercase tracking-wide">
                  {t(labelKey)}
                </span>
                <span className="text-xl font-semibold text-[var(--text-primary)] mt-0.5">
                  {categoryCounts[value]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Sort buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--text-secondary)] mr-1">{t('browse.sort_label')}</span>
          {sortOptions.map(({ value, labelKey }) => {
            const isActive = sortBy === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setSortBy(value)}
                aria-pressed={isActive}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  isActive
                    ? 'bg-[var(--brand-primary)] text-white'
                    : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>

        {/* Show completed / rejected toggles */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
              showCompleted
                ? 'bg-[var(--brand-primary)] text-white'
                : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            {t('browse.show_completed')} ({completedCount})
          </button>
          <button
            type="button"
            onClick={() => setShowRejected((v) => !v)}
            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
              showRejected
                ? 'bg-[var(--brand-primary)] text-white'
                : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            {t('browse.show_rejected')} ({rejectedCount})
          </button>
        </div>
      </div>

      {filteredTasks.length === 0 ? (
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
      )}
    </div>
  );
}

export default BrowseView;
