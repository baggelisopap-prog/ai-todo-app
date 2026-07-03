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
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h2 className="text-lg font-semibold text-white mb-4">
        {t('nav.upcoming')}
        <span className="ml-2 text-sm font-normal text-slate-400">({upcomingTasks.length})</span>
      </h2>

      {upcomingTasks.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-sm">{t('empty.upcoming')}</div>
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
