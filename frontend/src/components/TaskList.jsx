import { useTranslation } from 'react-i18next';
import TaskCard from './TaskCard';

function TaskList({ tasks, sortBy = 'newest', variant = 'default', expandedTaskId, onToggleExpand, onUpdateTask, onTaskDeleted, onShowToast }) {
  const { t } = useTranslation();

  if (tasks.length === 0) {
    return (
      <div className="p-8 text-center text-[var(--text-muted)] text-sm italic">
        {t('empty.default')}
      </div>
    );
  }

  const sortedTasks = sortTasks(tasks, sortBy);

  return (
    <ul className="space-y-2">
      {sortedTasks.map((task) => (
        <li key={task.record_id}>
          <TaskCard
            task={task}
            variant={variant}
            isExpanded={expandedTaskId === task.record_id}
            onToggleExpand={onToggleExpand}
            onUpdate={onUpdateTask}
            onTaskDeleted={onTaskDeleted}
            onShowToast={onShowToast}
          />
        </li>
      ))}
    </ul>
  );
}

function sortTasks(tasks, sortBy) {
  const copy = [...tasks];
  switch (sortBy) {
    case 'oldest':
      return copy.sort((a, b) => compareCreatedTime(a, b, 'asc'));
    case 'priority':
      return copy.sort((a, b) => {
        const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
        if (priorityDiff !== 0) return priorityDiff;
        return compareCreatedTime(a, b, 'desc');
      });
    case 'due_date':
      return copy.sort((a, b) => {
        if (!a.due_date && !b.due_date) return compareCreatedTime(a, b, 'desc');
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date);
      });
    case 'newest':
    default:
      return copy.sort((a, b) => compareCreatedTime(a, b, 'desc'));
  }
}

function compareCreatedTime(a, b, direction) {
  if (!a.created_time && !b.created_time) return 0;
  if (!a.created_time) return 1;
  if (!b.created_time) return -1;
  const result = a.created_time.localeCompare(b.created_time);
  return direction === 'desc' ? -result : result;
}

function priorityRank(priority) {
  const ranks = { P1: 1, P2: 2, P3: 3 };
  return ranks[priority] || 99;
}

export default TaskList;