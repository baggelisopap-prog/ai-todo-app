import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from './EmptyState';
import TaskCard from './TaskCard';
import SwipeHint from './SwipeHint';

function TaskList({ tasks, sortBy = 'newest', variant = 'default', expandedTaskId, onToggleExpand, onUpdateTask, onTaskDeleted, onShowToast }) {
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

  return (
    <>
      {!hintDismissed && <SwipeHint onDismiss={() => setHintDismissed(true)} />}
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
    </>
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

/**
 * When a task was created, for sorting.
 *
 * `created_at` first, and that is a fix rather than a preference: `created_time`
 * is the Airtable-era column, it is popped from both the insert and the update
 * path, and unlike created_at it carries no database default — so nothing has
 * ever written it, and "Νεότερα"/"Παλαιότερα" have been sorting a column full
 * of nulls. created_at is the database's own `default now()`, present on every
 * row. created_time stays as a fallback rather than being deleted, so any row
 * that does carry one is still ordered by it instead of dropping to the end.
 */
function createdAt(task) {
  return task.created_at || task.created_time || null;
}

/**
 * Date.parse rather than localeCompare, because the two columns are not
 * written in the same offset — Postgres hands created_at back in UTC while the
 * app's own timestamps are Athens-local — and ISO strings only sort correctly
 * when their offsets match.
 */
function compareCreatedTime(a, b, direction) {
  const at = createdAt(a);
  const bt = createdAt(b);
  if (!at && !bt) return 0;
  // A task with no creation date sinks, whichever way the list is sorted:
  // "oldest first" must not be led by rows whose age is simply unknown.
  if (!at) return 1;
  if (!bt) return -1;
  const result = Date.parse(at) - Date.parse(bt);
  return direction === 'desc' ? -result : result;
}

function priorityRank(priority) {
  const ranks = { P1: 1, P2: 2, P3: 3 };
  return ranks[priority] || 99;
}

export default TaskList;