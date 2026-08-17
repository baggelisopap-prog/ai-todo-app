import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRecurrences } from '../api';
import { RecurrenceContext } from '../hooks/useRecurrence';
import RecurrenceModal from './RecurrenceModal';

/**
 * The rules a task row needs to describe itself, and the editor it opens.
 *
 * Two jobs, together on purpose. A task row cannot render "↻ Mon-Fri" from the
 * task alone — the row carries only `recurrence_rule_id`, so the sentence lives
 * in a rule the row has never seen. And a row cannot open an editor either,
 * because a modal rendered inside a list item is clipped by the same
 * `overflow-hidden` that already forced TaskMenu into a portal.
 *
 * So the rules are fetched once here and read through a context, and the modal
 * is rendered here too, above everything. The alternative was passing both a
 * rules map and an open-the-editor callback through App → view → TaskList →
 * TaskCard → TaskRow, and separately through CalendarView → TaskCard.
 *
 * `onTasksChanged` fires after a successful save. It has to: POST /recurrences
 * materialises a fortnight of real task rows server-side, and App's task list
 * is fetched once at mount and folded into state by hand thereafter — nothing
 * in it would ever learn those rows exist.
 */
export function RecurrenceProvider({ children, onShowToast, onTasksChanged }) {
  const [rules, setRules] = useState([]);
  // { task, rule } while the editor is open, null otherwise. `rule` is null
  // for a task that does not repeat yet — that is the create-and-adopt case.
  const [editing, setEditing] = useState(null);

  // Held in refs, not read from the closure. Both arrive as fresh function
  // identities on every render of App, and `reload` is the mount effect's only
  // dependency — depending on them directly would refetch every rule this user
  // owns on every keystroke that re-renders the tree above.
  const onShowToastRef = useRef(onShowToast);
  const onTasksChangedRef = useRef(onTasksChanged);
  useEffect(() => { onShowToastRef.current = onShowToast; }, [onShowToast]);
  useEffect(() => { onTasksChangedRef.current = onTasksChanged; }, [onTasksChanged]);

  // A .then() chain rather than an async function, so the setState calls sit
  // in their own callbacks and react-hooks/set-state-in-effect stays quiet
  // when the mount effect below calls this. Same shape, same reason, as
  // RecurrencesView's own loader.
  const reload = useCallback(() => {
    return getRecurrences()
      .then((data) => setRules(data.recurrences || []))
      .catch((err) => onShowToastRef.current?.(err.message, 'error'));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const rulesById = useMemo(() => {
    const map = {};
    for (const rule of rules) map[rule.record_id] = rule;
    return map;
  }, [rules]);

  const ruleFor = useCallback(
    (task) => (task?.recurrence_rule_id ? rulesById[task.recurrence_rule_id] || null : null),
    [rulesById]
  );

  const openEditor = useCallback((task) => {
    if (!task) return;

    if (task.recurrence_rule_id) {
      const rule = rulesById[task.recurrence_rule_id];
      // The task says it repeats and we cannot say what by — the fetch is
      // still in flight, or it failed. Opening anyway would render an empty
      // "new rule" form that, on save, asks the server to adopt a task that
      // already belongs to one: a 422 the user did nothing to deserve.
      if (!rule) {
        onShowToastRef.current?.('recurrence.rule_unavailable', 'neutral');
        reload();
        return;
      }
      setEditing({ task, rule });
      return;
    }

    setEditing({ task, rule: null });
  }, [rulesById, reload]);

  // Deliberately not the `rules` array itself. Nothing outside this file wants
  // the list — a task row wants the one rule that made it, and the Recurrences
  // screen keeps its own copy because it needs to move a switch optimistically.
  // Exposing the array too would invite a third copy for no one to keep in sync.
  const value = useMemo(
    () => ({ ruleFor, openEditor, reload }),
    [ruleFor, openEditor, reload]
  );

  function handleSaved() {
    setEditing(null);
    onShowToastRef.current?.('recurrence.saved', 'success');
    reload();
    onTasksChangedRef.current?.();
  }

  return (
    <RecurrenceContext.Provider value={value}>
      {children}
      {editing && (
        <RecurrenceModal
          task={editing.task}
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </RecurrenceContext.Provider>
  );
}

export default RecurrenceProvider;
