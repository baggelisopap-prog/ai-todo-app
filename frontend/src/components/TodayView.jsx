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
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h2 className="text-lg font-semibold text-white mb-4">{t('nav.today')}</h2>

      {isEmpty ? (
        <div className="p-8 text-center text-slate-500 text-sm">{t('empty.today')}</div>
      ) : (
        <>
          <div className="mb-6">
            <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide mb-3">
              {t('sections.today_header')} ({todayTasks.length})
            </h3>
            {todayTasks.length === 0 ? (
              <div className="py-4 text-center text-slate-600 text-sm">{t('empty.today')}</div>
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

          {overdueTasks.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-red-400 uppercase tracking-wide mb-3">
                {t('sections.overdue_header')} ({overdueTasks.length})
              </h3>
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
        </>
      )}
    </div>
  );
}

export default TodayView;
