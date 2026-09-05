import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from './EmptyState';
import TaskCard from './TaskCard';
import SwipeHint from './SwipeHint';
// Ordering lives in utils/ so scripts/*.test.mjs can reach it under plain
// Node. It was inside this file while it was silently sorting a column of
// nulls, where no check could see it.
import { sortTasks, sortsByCreation } from '../utils/sortTasks';

function TaskList({ tasks, sortBy = 'newest', variant = 'default', expandedTaskId, newTaskIds = [], onToggleExpand, onUpdateTask, onTaskDeleted, onShowToast }) {
  const { t } = useTranslation();
  // One hint for the whole app, not one per list — several TaskLists are on
  // screen at once in Today, and three identical hints stacked down the page
  // would be worse than none.
  const [hintDismissed, setHintDismissed] = useState(false);

  if (tasks.length === 0) {
    return (
      // inline: a TaskList is always nested inside a section that has its own
      // heading and siblings, never the whole screen.
      <EmptyState message={t('empty.default')} size="inline" />
    );
  }

  const sortedTasks = sortTasks(tasks, sortBy);
  const showCreated = sortsByCreation(sortBy);

  return (
    <>
      {!hintDismissed && <SwipeHint onDismiss={() => setHintDismissed(true)} />}
      <ul className="space-y-2">
      {sortedTasks.map((task) => (
        <li key={task.record_id}>
          <TaskCard
            task={task}
            variant={variant}
            showCreated={showCreated}
            isExpanded={expandedTaskId === task.record_id}
            isNew={newTaskIds.includes(task.record_id)}
            onToggleExpand={onToggleExpand}
            onUpdate={onUpdateTask}
            onTaskDeleted={onTaskDeleted}
            onShowToast={onShowToast}
          />
        </li>
      ))}
      </ul>
    </>
  );
}

export default TaskList;