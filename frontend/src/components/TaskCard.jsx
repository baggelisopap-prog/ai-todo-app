import TaskRow from './TaskRow';
import TaskDetailSheet from './TaskDetailSheet';

/**
 * A task in a list, plus its detail sheet when it is the open one.
 *
 * This file used to be 1,137 lines and seventeen useState calls in a single
 * component: the row, the edit form, the checklist editor, the inline agent,
 * the ⋯ menu and every mutation, all in one. It is now the seam between the
 * two things a task actually is — a row you scan, and a sheet you open —
 * with the shared mutations in useTaskActions.
 *
 * The props are deliberately UNCHANGED. TaskList, CalendarView's weekly
 * selection and its day popup all render this, and rewriting three call sites
 * at the same time as splitting the component would have made a failure
 * impossible to place. `isExpanded`/`onToggleExpand` still mean what they did;
 * what changed is that "expanded" now draws a sheet instead of growing the row
 * into a form.
 */
function TaskCard({ task, variant = 'default', isExpanded, onToggleExpand, onUpdate, onTaskDeleted, onShowToast }) {
  return (
    <>
      <TaskRow
        task={task}
        variant={variant}
        isSelected={isExpanded}
        onOpen={onToggleExpand}
        onUpdate={onUpdate}
        onTaskDeleted={onTaskDeleted}
        onShowToast={onShowToast}
      />
      {isExpanded && (
        <TaskDetailSheet
          task={task}
          variant={variant}
          onClose={() => onToggleExpand(null)}
          onUpdate={onUpdate}
          onTaskDeleted={onTaskDeleted}
          onShowToast={onShowToast}
        />
      )}
    </>
  );
}

export default TaskCard;
