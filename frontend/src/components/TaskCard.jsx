import { useState, useEffect, useRef } from 'react';

function TaskCard({ task, isExpanded, onToggleExpand, onUpdate }) {
  // Action state (Approve/Complete/Uncomplete buttons)
  const [pendingAction, setPendingAction] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Edit state — draft is initialized when the card expands
  const [draft, setDraft] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const cardRef = useRef(null);

  const isPending = !task.approval_status;
  const isCompleted = task.is_completed;
  const isRejected = task.is_rejected;

  // Initialize draft on expand, clear on collapse
  useEffect(() => {
    if (isExpanded) {
      setDraft({
        task_name: task.task_name,
        description: task.description || '',
        category: task.category,
        priority: task.priority,
        due_date: task.due_date || '',
        due_time: task.due_time || '',
        checklist: [...(task.checklist || [])],
      });
      setSaveError(null);
    } else {
      setDraft(null);
      setSaveError(null);
    }
  }, [isExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click outside the card collapses it
  useEffect(() => {
    if (!isExpanded) return;
    function handleClickOutside(e) {
      if (cardRef.current && !cardRef.current.contains(e.target)) {
        if (isSaving) return;
        onToggleExpand(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExpanded, isSaving, onToggleExpand]);

  function handleCardClick(e) {
    const tag = e.target.tagName;
    if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(tag)) {
      return;
    }
    if (e.target.closest('[data-no-toggle]')) {
      return;
    }
    onToggleExpand(task.record_id);
  }

  function handleCancel(e) {
    if (e) e.stopPropagation();
    onToggleExpand(null);
  }

  async function handleSave(e) {
    e.stopPropagation();
    setIsSaving(true);
    setSaveError(null);

    const updates = {
      task_name: draft.task_name,
      description: draft.description,
      category: draft.category,
      priority: draft.priority,
      due_date: draft.due_date || null,
      due_time: draft.due_time || null,
      checklist: draft.checklist,
    };

    try {
      await onUpdate(task.record_id, updates);
      // Success: stay expanded so the user can verify changes
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAction(actionName, updates) {
    setPendingAction(actionName);
    setActionError(null);
    try {
      await onUpdate(task.record_id, updates);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setPendingAction(null);
    }
  }

  function updateDraft(field, value) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  function updateChecklistItem(index, value) {
    setDraft((d) => ({
      ...d,
      checklist: d.checklist.map((item, i) => (i === index ? value : item)),
    }));
  }

  function addChecklistItem() {
    setDraft((d) => ({ ...d, checklist: [...d.checklist, ''] }));
  }

  function removeChecklistItem(index) {
    setDraft((d) => ({
      ...d,
      checklist: d.checklist.filter((_, i) => i !== index),
    }));
  }

  const cardClasses = [
    'rounded-lg border p-4 transition-colors cursor-pointer',
    isRejected
      ? 'border-red-900/50 bg-red-950/20'
      : isPending
      ? 'border-amber-900/50 bg-amber-950/30'
      : 'border-slate-800 bg-slate-900',
    isExpanded ? 'ring-1 ring-slate-600' : '',
    isRejected ? 'opacity-60' : isCompleted ? 'opacity-50' : '',
  ].filter(Boolean).join(' ');

  const titleClasses = [
    'text-sm font-medium text-white',
    isCompleted ? 'line-through' : '',
  ].filter(Boolean).join(' ');

  const dateDisplay = formatDateTime(task.due_date, task.due_time);

  return (
    <article ref={cardRef} onClick={handleCardClick} className={cardClasses}>
      {/* === COLLAPSED VIEW === */}
      {!isExpanded && (
        <>
          <div className="flex items-start gap-2">
            {isPending && (
              <span
                className="flex-shrink-0 mt-0.5 text-amber-400"
                title="Pending approval"
                aria-label="Pending approval"
              >
                ⊕
              </span>
            )}
            <h3 className={titleClasses}>{task.task_name}</h3>
          </div>

          {task.description && (
            <p className="text-sm text-slate-400 mt-2 whitespace-pre-wrap">
              {task.description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <CategoryBadge category={task.category} />
            <PriorityBadge priority={task.priority} />
            <span className="text-xs text-slate-500">{dateDisplay}</span>
            {isPending && (
              <span className="text-xs text-amber-400 font-medium">Pending</span>
            )}
          </div>

          {task.checklist && task.checklist.length > 0 && (
            <ul className="mt-3 space-y-1">
              {task.checklist.map((item, index) => (
                <li key={index} className="text-xs text-slate-400 flex items-start gap-2">
                  <span className="text-slate-600 mt-0.5">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-800/50">
            {isRejected ? (
              <ActionButton
                label="Unreject"
                loadingLabel="Restoring..."
                isLoading={pendingAction === 'unreject'}
                disabled={pendingAction !== null}
                onClick={() => handleAction('unreject', { is_rejected: false })}
                variant="secondary"
              />
            ) : (
              <>
                {isPending && (
                  <ActionButton
                    label="Approve"
                    loadingLabel="Approving..."
                    isLoading={pendingAction === 'approve'}
                    disabled={pendingAction !== null}
                    onClick={() => handleAction('approve', { approval_status: true })}
                    variant="primary"
                  />
                )}
                {!isCompleted && (
                  <ActionButton
                    label="Complete"
                    loadingLabel="Completing..."
                    isLoading={pendingAction === 'complete'}
                    disabled={pendingAction !== null}
                    onClick={() =>
                      handleAction('complete', {
                        is_completed: true,
                        ...(isPending ? { approval_status: true } : {}),
                      })
                    }
                    variant="secondary"
                  />
                )}
                {isCompleted && (
                  <ActionButton
                    label="Uncomplete"
                    loadingLabel="Reverting..."
                    isLoading={pendingAction === 'uncomplete'}
                    disabled={pendingAction !== null}
                    onClick={() => handleAction('uncomplete', { is_completed: false })}
                    variant="secondary"
                  />
                )}
                {!isRejected && (
                  <ActionButton
                    label="Reject"
                    loadingLabel="Rejecting..."
                    isLoading={pendingAction === 'reject'}
                    disabled={pendingAction !== null}
                    onClick={() => handleAction('reject', { is_rejected: true })}
                    variant="danger"
                  />
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* === EXPANDED VIEW: form + unified button row === */}
      {isExpanded && draft && (
        <div
          data-no-toggle
          className="space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Task name — prominent at the top */}
          <div className="flex items-start gap-2">
            {isPending && (
              <span
                className="flex-shrink-0 mt-2 text-amber-400"
                title="Pending approval"
                aria-label="Pending approval"
              >
                ⊕
              </span>
            )}
            <input
              type="text"
              value={draft.task_name}
              onChange={(e) => updateDraft('task_name', e.target.value)}
              placeholder="Task name"
              className={`w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm font-medium text-white focus:outline-none focus:border-slate-500 ${isCompleted ? 'line-through' : ''}`}
            />
          </div>

          {/* Description */}
          <Field label="Description">
            <textarea
              value={draft.description}
              onChange={(e) => updateDraft('description', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-slate-500 resize-none"
            />
          </Field>

          {/* Category + Priority side by side */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select
                value={draft.category}
                onChange={(e) => updateDraft('category', e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-slate-500"
              >
                <option value="Business">Business</option>
                <option value="Personal">Personal</option>
                <option value="Unknown">Unknown</option>
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={draft.priority}
                onChange={(e) => updateDraft('priority', e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-slate-500"
              >
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
              </select>
            </Field>
          </div>

          {/* Due date + due time side by side */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Due date">
              <input
                type="date"
                value={draft.due_date}
                onChange={(e) => updateDraft('due_date', e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-slate-500"
              />
            </Field>
            <Field label="Due time">
              <input
                type="time"
                value={draft.due_time}
                onChange={(e) => updateDraft('due_time', e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-slate-500"
              />
            </Field>
          </div>

          {/* Checklist editor */}
          <Field label="Checklist">
            <div className="space-y-2">
              {draft.checklist.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item}
                    onChange={(e) => updateChecklistItem(index, e.target.value)}
                    placeholder={`Item ${index + 1}`}
                    className="flex-1 px-3 py-1.5 rounded-md bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => removeChecklistItem(index)}
                    className="px-2 py-1.5 rounded-md text-xs text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
                    title="Remove item"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addChecklistItem}
                className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                + Add checklist item
              </button>
            </div>
          </Field>

          {/* Save error */}
          {saveError && (
            <div className="text-xs text-red-400">
              Failed to save: {saveError}
            </div>
          )}

          {/* Unified button row: Save, Cancel, then action buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/50">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !draft.task_name.trim()}
              className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving}
              className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>

            {isRejected ? (
              <ActionButton
                label="Unreject"
                loadingLabel="Restoring..."
                isLoading={pendingAction === 'unreject'}
                disabled={pendingAction !== null}
                onClick={() => handleAction('unreject', { is_rejected: false })}
                variant="secondary"
              />
            ) : (
              <>
                {isPending && (
                  <ActionButton
                    label="Approve"
                    loadingLabel="Approving..."
                    isLoading={pendingAction === 'approve'}
                    disabled={pendingAction !== null}
                    onClick={() => handleAction('approve', { approval_status: true })}
                    variant="primary"
                  />
                )}
                {!isCompleted && (
                  <ActionButton
                    label="Complete"
                    loadingLabel="Completing..."
                    isLoading={pendingAction === 'complete'}
                    disabled={pendingAction !== null}
                    onClick={() =>
                      handleAction('complete', {
                        is_completed: true,
                        ...(isPending ? { approval_status: true } : {}),
                      })
                    }
                    variant="secondary"
                  />
                )}
                {isCompleted && (
                  <ActionButton
                    label="Uncomplete"
                    loadingLabel="Reverting..."
                    isLoading={pendingAction === 'uncomplete'}
                    disabled={pendingAction !== null}
                    onClick={() => handleAction('uncomplete', { is_completed: false })}
                    variant="secondary"
                  />
                )}
                {!isRejected && (
                  <ActionButton
                    label="Reject"
                    loadingLabel="Rejecting..."
                    isLoading={pendingAction === 'reject'}
                    disabled={pendingAction !== null}
                    onClick={() => handleAction('reject', { is_rejected: true })}
                    variant="danger"
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="mt-2 text-xs text-red-400">
          Failed to update: {actionError}
        </div>
      )}
    </article>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400 font-medium uppercase tracking-wide block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function ActionButton({ label, loadingLabel, isLoading, disabled, onClick, variant }) {
  const variantClasses = variant === 'primary'
    ? 'bg-blue-600 text-white hover:bg-blue-500 disabled:bg-blue-800'
    : variant === 'danger'
    ? 'bg-red-950/50 text-red-300 hover:bg-red-900/50 disabled:bg-slate-900'
    : 'bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:bg-slate-900';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium border border-transparent disabled:cursor-not-allowed disabled:text-slate-500 transition-colors ${variantClasses}`}
    >
      {isLoading ? loadingLabel : label}
    </button>
  );
}

function CategoryBadge({ category }) {
  const colors = {
    Business: 'bg-blue-950 text-blue-300 border-blue-900',
    Personal: 'bg-purple-950 text-purple-300 border-purple-900',
    Unknown: 'bg-slate-800 text-slate-400 border-slate-700',
  };
  const colorClass = colors[category] || colors.Unknown;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colorClass}`}>
      {category}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const colors = {
    P1: 'bg-red-950 text-red-300 border-red-900',
    P2: 'bg-yellow-950 text-yellow-300 border-yellow-900',
    P3: 'bg-slate-800 text-slate-400 border-slate-700',
  };
  const colorClass = colors[priority] || colors.P3;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colorClass}`}>
      {priority}
    </span>
  );
}

function formatDateTime(date, time) {
  if (!date) return 'No date';
  if (time) return `${date} ${time}`;
  return date;
}

export default TaskCard;
