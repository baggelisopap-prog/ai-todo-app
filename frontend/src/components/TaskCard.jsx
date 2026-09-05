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
 *
 * `showCreated` (2026-09-04) is the one addition since, and it is optional so
 * the two CalendarView call sites keep working untouched: it tells the row to
 * print "Μπήκε …" while the list is ordered by creation date, so the ordering
 * the user chose is one they can actually see.
 */
function TaskCard({ task, variant = 'default', showCreated = false, isExpanded, isNew = false, onToggleExpand, onUpdate, onTaskDeleted, onShowToast }) {
  return (
    <>
      <TaskRow
        task={task}
        variant={variant}
        showCreated={showCreated}
        isSelected={isExpanded}
        isNew={isNew}
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
