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
    { value: 'All', labelKey: 'browse.filter_all', accentClass: 'hover:border-slate-600', selectedClass: 'border-slate-400 bg-slate-800' },
    { value: 'Business', labelKey: 'browse.filter_business', accentClass: 'hover:border-blue-700', selectedClass: 'border-blue-500 bg-blue-950' },
    { value: 'Personal', labelKey: 'browse.filter_personal', accentClass: 'hover:border-purple-700', selectedClass: 'border-purple-500 bg-purple-950' },
    { value: 'Unknown', labelKey: 'browse.filter_unknown', accentClass: 'hover:border-slate-600', selectedClass: 'border-slate-400 bg-slate-800' },
  ];

  const sortOptions = [
    { value: 'newest', labelKey: 'browse.sort_newest' },
    { value: 'oldest', labelKey: 'browse.sort_oldest' },
    { value: 'priority', labelKey: 'browse.sort_priority' },
    { value: 'due_date', labelKey: 'browse.sort_due_date' },
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h2 className="text-lg font-semibold text-white mb-4">{t('nav.browse')}</h2>

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
                    : `border-slate-800 bg-slate-900 ${accentClass}`
                }`}
              >
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">
                  {t(labelKey)}
                </span>
                <span className="text-xl font-semibold text-white mt-0.5">
                  {categoryCounts[value]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Sort buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400 mr-1">{t('browse.sort_label')}</span>
          {sortOptions.map(({ value, labelKey }) => {
            const isActive = sortBy === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setSortBy(value)}
                aria-pressed={isActive}
                className={`inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  isActive
                    ? 'border-slate-500 bg-slate-700 text-white'
                    : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
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
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              showCompleted
                ? 'border-slate-600 bg-slate-800 text-slate-100'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
            }`}
          >
            <span
              className={`w-3 h-3 rounded-sm border ${
                showCompleted ? 'border-slate-400 bg-slate-400' : 'border-slate-600 bg-transparent'
              }`}
              aria-hidden="true"
            />
            {t('browse.show_completed')} ({completedCount})
          </button>
          <button
            type="button"
            onClick={() => setShowRejected((v) => !v)}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              showRejected
                ? 'border-red-800 bg-red-950/50 text-red-200'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
            }`}
          >
            <span
              className={`w-3 h-3 rounded-sm border ${
                showRejected ? 'border-red-400 bg-red-400' : 'border-slate-600 bg-transparent'
              }`}
              aria-hidden="true"
            />
            {t('browse.show_rejected')} ({rejectedCount})
          </button>
        </div>
      </div>

      {filteredTasks.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-sm">{t('empty.browse')}</div>
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
