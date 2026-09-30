// What the task sheet's form sends when it saves — plain data, no React, so
// scripts/task-draft.test.mjs can hold it to its rules under plain Node.

/**
 * The fields to send, from the sheet's draft.
 *
 * '' back to null for everything a <select> or a date input holds as '': the
 * room, category and assignee are nullable uuids and an empty string is not a
 * uuid, and an empty date is "no date", which the database spells null.
 *
 * `forCreate` is the new card on a board (2026-09-30): the same form, but the
 * assignee is left out — handing work to somebody goes through its own checks
 * on an existing task, so it is offered once the card exists, like the
 * reminder and the calendar.
 */
export function fieldsFromDraft(draft, { forCreate = false } = {}) {
  const fields = {
    task_name: (draft.task_name || '').trim(),
    description: draft.description,
    category: draft.category,
    priority: draft.priority,
    due_date: draft.due_date || null,
    due_time: draft.due_time || null,
    start_date: draft.start_date || null,
    checklist: draft.checklist,
    workspace_id: draft.workspace_id || null,
    category_id: draft.category_id || null,
  };
  if (!forCreate) fields.assigned_to = draft.assigned_to || null;
  return fields;
}
