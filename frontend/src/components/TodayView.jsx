import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import TaskList from './TaskList';
import FilterBar from './FilterBar';
import { toLocalISODate } from '../utils/formatDate';

function TodayView({ tasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted, onShowToast }) {
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedPriority, setSelectedPriority] = useState('All');
  const [overdueExpanded, setOverdueExpanded] = useState(true);

  const today = toLocalISODate(new Date());

  const filteredTasks = tasks.filter((task) =>
    (selectedCategory === 'All' || task.category === selectedCategory) &&
    (selectedPriority === 'All' || task.priority === selectedPriority)
  );

  const todayTasks = filteredTasks.filter((task) =>
    task.approval_status &&
    !task.is_completed &&
    !task.is_rejected &&
    task.due_date === today
  );

  const overdueTasks = filteredTasks.filter((task) =>
    task.approval_status &&
    !task.is_completed &&
    !task.is_rejected &&
    task.due_date &&
    task.due_date < today
  );

  const isEmpty = todayTasks.length === 0 && overdueTasks.length === 0;

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{t('nav.today')}</h1>
      </div>

      <FilterBar
        category={selectedCategory}
        onCategoryChange={setSelectedCategory}
        priority={selectedPriority}
        onPriorityChange={setSelectedPriority}
        t={t}
      />

      {isEmpty ? (
        <div className="p-8 text-center text-[var(--text-muted)] text-sm italic">{t('empty.today')}</div>
      ) : (
        <>
          {overdueTasks.length > 0 && (
            <div className="mb-6">
              <button
                onClick={() => setOverdueExpanded(!overdueExpanded)}
                className="w-full flex items-center justify-between text-left mb-3"
              >
                <h2 className="text-sm font-semibold text-[var(--priority-p1-text)] uppercase tracking-wide">
                  {t('sections.overdue_header')} <span className="ml-1">({overdueTasks.length})</span>
                </h2>
                <svg
                  className={`w-4 h-4 text-[var(--text-muted)] transition-transform flex-shrink-0 ${overdueExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {overdueExpanded && (
                <TaskList
                  tasks={overdueTasks}
                  sortBy="due_date"
                  expandedTaskId={expandedTaskId}
                  onToggleExpand={onToggleExpand}
                  onUpdateTask={onTaskUpdate}
                  onTaskDeleted={onTaskDeleted}
                  onShowToast={onShowToast}
                />
              )}
            </div>
          )}

          <div className="mb-6">
            <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
              {t('sections.today_header')} <span className="ml-1 text-[var(--text-muted)]">({todayTasks.length})</span>
            </h2>
            {todayTasks.length === 0 ? (
              <div className="py-4 text-center text-[var(--text-muted)] text-sm italic">{t('empty.today')}</div>
            ) : (
              <TaskList
                tasks={todayTasks}
                sortBy="due_date"
                expandedTaskId={expandedTaskId}
                onToggleExpand={onToggleExpand}
                onUpdateTask={onTaskUpdate}
                onTaskDeleted={onTaskDeleted}
                onShowToast={onShowToast}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default TodayView;
