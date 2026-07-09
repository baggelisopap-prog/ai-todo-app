import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import TaskList from './TaskList';

function BrowseView({ tasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted }) {
  const { t } = useTranslation();
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
    };
  }, [tasks, showCompleted, showRejected]);

  const completedCount = useMemo(() => tasks.filter((t) => t.is_completed).length, [tasks]);
  const rejectedCount = useMemo(() => tasks.filter((t) => t.is_rejected).length, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (!showCompleted) result = result.filter((t) => !t.is_completed);
    if (!showRejected) result = result.filter((t) => !t.is_rejected);
    if (selectedCategory !== 'All') result = result.filter((t) => t.category === selectedCategory);
    return result;
  }, [tasks, selectedCategory, showCompleted, showRejected]);

  const categoryOptions = [
    { value: 'All', labelKey: 'browse.filter_all', accentClass: 'hover:border-[var(--text-secondary)]', selectedClass: 'border-[var(--text-secondary)] bg-[var(--bg-hover)]' },
    { value: 'Business', labelKey: 'browse.filter_business', accentClass: 'hover:border-[var(--category-business)]/60', selectedClass: 'border-[var(--category-business)] bg-[var(--category-business)]/10' },
    { value: 'Personal', labelKey: 'browse.filter_personal', accentClass: 'hover:border-[var(--category-personal)]/60', selectedClass: 'border-[var(--category-personal)] bg-[var(--category-personal)]/10' },
    { value: 'Unknown', labelKey: 'browse.filter_unknown', accentClass: 'hover:border-[var(--text-secondary)]', selectedClass: 'border-[var(--text-secondary)] bg-[var(--bg-hover)]' },
  ];

  const sortOptions = [
    { value: 'newest', labelKey: 'browse.sort_newest' },
    { value: 'oldest', labelKey: 'browse.sort_oldest' },
    { value: 'priority', labelKey: 'browse.sort_priority' },
    { value: 'due_date', labelKey: 'browse.sort_due_date' },
  ];

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{t('nav.browse')}</h1>
      </div>

      <div className="mb-6 space-y-4">
        {/* Category cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
        <div className="p-8 text-center text-[var(--text-muted)] text-sm italic">{t('empty.browse')}</div>
      ) : (
        <TaskList
          tasks={filteredTasks}
          sortBy={sortBy}
          expandedTaskId={expandedTaskId}
          onToggleExpand={onToggleExpand}
          onUpdateTask={onTaskUpdate}
          onTaskDeleted={onTaskDeleted}
        />
      )}
    </div>
  );
}

export default BrowseView;
