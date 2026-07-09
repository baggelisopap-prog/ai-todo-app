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
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          {t('nav.inbox')}
          <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">({inboxTasks.length})</span>
        </h1>
      </div>

      {inboxTasks.length === 0 ? (
        <div className="p-8 text-center text-[var(--text-muted)] text-sm italic">{t('empty.inbox')}</div>
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
