import { useTranslation } from 'react-i18next';
import EmptyState from './EmptyState';
import TaskList from './TaskList';
import { isVisibleTask } from '../utils/taskDisplay';

function InboxView({ tasks, expandedTaskId, onToggleExpand, onTaskUpdate, onTaskDeleted, onShowToast, newTaskIds }) {
  const { t } = useTranslation();

  const inboxTasks = tasks.filter((task) =>
    isVisibleTask(task) && !task.is_completed && !task.approval_status
  );

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      {/* The heading and its count both moved: the title to AppBar, the count
          to the tab's badge, which shows it from anywhere in the app rather
          than only once you are already looking at the list. The hint stays —
          it explains what to DO here, which neither of those can. */}
      {inboxTasks.length > 0 && (
        <p className="text-sm text-[var(--text-muted)] mb-4">
          {t('inbox.hint')}
        </p>
      )}

      {inboxTasks.length === 0 ? (
        <EmptyState message={t('empty.inbox')} />
      ) : (
        <TaskList
          tasks={inboxTasks}
          sortBy="newest"
          variant="inbox"
          expandedTaskId={expandedTaskId}
          newTaskIds={newTaskIds}
          onToggleExpand={onToggleExpand}
          onUpdateTask={onTaskUpdate}
          onTaskDeleted={onTaskDeleted}
          onShowToast={onShowToast}
        />
      )}
    </div>
  );
}

export default InboxView;
