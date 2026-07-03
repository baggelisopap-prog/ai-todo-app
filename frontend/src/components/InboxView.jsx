import { useTranslation } from 'react-i18next';
import TaskList from './TaskList';

function InboxView({ tasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted }) {
  const { t } = useTranslation();

  const inboxTasks = tasks.filter((task) =>
    !task.is_rejected && !task.is_completed && (
      !task.approval_status || !task.due_date
    )
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h2 className="text-lg font-semibold text-white mb-4">
        {t('nav.inbox')}
        <span className="ml-2 text-sm font-normal text-slate-400">({inboxTasks.length})</span>
      </h2>

      {inboxTasks.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-sm">{t('empty.inbox')}</div>
      ) : (
        <TaskList
          tasks={inboxTasks}
          sortBy="newest"
          expandedTaskId={expandedTaskId}
          onToggleExpand={onToggleExpand}
          onUpdateTask={onTaskUpdate}
          onTaskDeleted={onTaskDeleted}
        />
      )}
    </div>
  );
}

export default InboxView;
