import { useTranslation } from 'react-i18next';
import TaskList from './TaskList';

function UpcomingView({ tasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted }) {
  const { t } = useTranslation();

  const today = new Date().toISOString().split('T')[0];

  const upcomingTasks = tasks.filter((task) =>
    task.approval_status &&
    !task.is_completed &&
    !task.is_rejected &&
    task.due_date &&
    task.due_date > today
  );

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          {t('nav.upcoming')}
          <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">({upcomingTasks.length})</span>
        </h1>
      </div>

      {upcomingTasks.length === 0 ? (
        <div className="p-8 text-center text-[var(--text-muted)] text-sm italic">{t('empty.upcoming')}</div>
      ) : (
        <TaskList
          tasks={upcomingTasks}
          sortBy="due_date"
          expandedTaskId={expandedTaskId}
          onToggleExpand={onToggleExpand}
          onUpdateTask={onTaskUpdate}
          onTaskDeleted={onTaskDeleted}
        />
      )}
    </div>
  );
}

export default UpcomingView;
