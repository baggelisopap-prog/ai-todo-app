import { useTranslation } from 'react-i18next';
import TaskList from './TaskList';

function TodayView({ tasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted }) {
  const { t } = useTranslation();

  const today = new Date().toISOString().split('T')[0];

  const todayTasks = tasks.filter((task) =>
    task.approval_status &&
    !task.is_completed &&
    !task.is_rejected &&
    task.due_date === today
  );

  const overdueTasks = tasks.filter((task) =>
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

      {isEmpty ? (
        <div className="p-8 text-center text-[var(--text-muted)] text-sm italic">{t('empty.today')}</div>
      ) : (
        <>
          {overdueTasks.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
                {t('sections.overdue_header')} <span className="ml-1 text-[var(--priority-p1)]">({overdueTasks.length})</span>
              </h2>
              <TaskList
                tasks={overdueTasks}
                sortBy="due_date"
                expandedTaskId={expandedTaskId}
                onToggleExpand={onToggleExpand}
                onUpdateTask={onTaskUpdate}
                onTaskDeleted={onTaskDeleted}
              />
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
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default TodayView;
