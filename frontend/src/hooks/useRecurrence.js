import { createContext, useContext } from 'react';

/**
 * The context holding this user's recurrence rules and the one editor that
 * opens on top of them. The provider that fills it lives in
 * components/RecurrenceProvider.jsx.
 *
 * Split across two files for the same reason AppSettingsContext is: a module
 * exporting a component may export nothing else, or react-refresh complains.
 */
export const RecurrenceContext = createContext(null);

/**
 * Returns { ruleFor, openEditor, reload }.
 *
 * - `ruleFor(task)` — the rule that produced this task, or null. Null also
 *   means "not known yet": callers must render something either way rather
 *   than waiting, because a task row cannot blink in and out of existence
 *   while a settings-shaped fetch resolves.
 * - `openEditor(task)` — opens the editor for that task. Editing its rule if
 *   it already has one, creating a new rule that adopts it if it does not.
 *   `openEditor(null)` is not supported; the Settings screen owns from-scratch
 *   rule creation and renders RecurrenceForm directly.
 * - `reload()` — refetch the shared copy. The Recurrences screen calls this
 *   after every write, because it keeps a second copy of its own and the
 *   badges on the task rows would otherwise describe a rule as it used to be.
 *
 * The context is deliberately reachable from anywhere: a task row is four
 * components deep (App → view → TaskList → TaskCard → TaskRow) and the
 * calendar reaches TaskCard by a different path, so threading a callback down
 * would mean editing both chains and every component in between.
 */
export function useRecurrence() {
  const context = useContext(RecurrenceContext);
  if (!context) {
    throw new Error('useRecurrence must be used inside <RecurrenceProvider>');
  }
  return context;
}
