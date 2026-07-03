import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteTask } from '../api';

function TaskCard({ task, isExpanded, onToggleExpand, onUpdate, onTaskDeleted }) {
  const { t } = useTranslation();

  const [pendingAction, setPendingAction] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [draft, setDraft] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [optimisticChecklist, setOptimisticChecklist] = useState(null);
  const [pendingToggleIdx, setPendingToggleIdx] = useState(null);
  const [toggleError, setToggleError] = useState(null);

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const cardRef = useRef(null);

  const isPending = !task.approval_status;
  const isCompleted = task.is_completed;
  const isRejected = task.is_rejected;
  const displayChecklist = optimisticChecklist ?? task.checklist;

  const dateDisplay = task.due_date
    ? (task.due_time ? `${task.due_date} ${task.due_time}` : task.due_date)
    : t('task.no_date');

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

  async function handleToggleChecklistItem(idx) {
    const newChecklist = task.checklist.map((it, i) =>
      i === idx ? { ...it, done: !it.done } : it
    );
    setOptimisticChecklist(newChecklist);
    setPendingToggleIdx(idx);
    setToggleError(null);
    try {
      await onUpdate(task.record_id, { checklist: newChecklist });
      setOptimisticChecklist(null);
    } catch (err) {
      setOptimisticChecklist(null);
      setToggleError(err.message);
    } finally {
      setPendingToggleIdx(null);
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(t('confirm.delete_task'));
    if (!confirmed) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteTask(task.record_id);
      onTaskDeleted(task.record_id);
    } catch (err) {
      setDeleteError(err.message);
      setIsDeleting(false);
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
    setDraft((d) => ({ ...d, checklist: [...d.checklist, { text: '', done: false }] }));
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

  return (
    <article ref={cardRef} onClick={handleCardClick} className={cardClasses}>
      {/* === COLLAPSED VIEW === */}
      {!isExpanded && (
        <>
          <div className="flex items-start gap-2">
            {isPending && (
              <span
                className="flex-shrink-0 mt-0.5 text-amber-400"
                title={t('task.pending_approval')}
                aria-label={t('task.pending_approval')}
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
              <span className="text-xs text-amber-400 font-medium">{t('task.pending')}</span>
            )}
          </div>

          {displayChecklist && displayChecklist.length > 0 && (
            <ul className="mt-3 space-y-0.5">
              {displayChecklist.map((item, index) => (
                <li key={index} className="text-xs">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleChecklistItem(index);
                    }}
                    disabled={pendingToggleIdx !== null}
                    className="flex items-center gap-2 w-full text-left py-0.5 px-1 hover:bg-slate-800/40 rounded transition-colors disabled:cursor-wait"
                  >
                    {item.done ? <CheckedBox /> : <EmptyBox />}
                    <span className={item.done ? 'line-through text-slate-500' : 'text-slate-400'}>
                      {item.text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {toggleError && (
            <div className="mt-1 text-xs text-red-400">
              {t('errors.failed_update')}: {toggleError}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-800/50">
            {isRejected ? (
              <ActionButton
                label={t('actions.unreject')}
                loadingLabel={t('actions.unrejecting')}
                isLoading={pendingAction === 'unreject'}
                disabled={pendingAction !== null}
                onClick={() => handleAction('unreject', { is_rejected: false })}
                variant="secondary"
              />
            ) : (
              <>
                {isPending && (
                  <ActionButton
                    label={t('actions.approve')}
                    loadingLabel={t('actions.approving')}
                    isLoading={pendingAction === 'approve'}
                    disabled={pendingAction !== null}
                    onClick={() => handleAction('approve', { approval_status: true })}
                    variant="primary"
                  />
                )}
                {!isCompleted && (
                  <ActionButton
                    label={t('actions.complete')}
                    loadingLabel={t('actions.completing')}
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
                    label={t('actions.uncomplete')}
                    loadingLabel={t('actions.uncompleting')}
                    isLoading={pendingAction === 'uncomplete'}
                    disabled={pendingAction !== null}
                    onClick={() => handleAction('uncomplete', { is_completed: false })}
                    variant="secondary"
                  />
                )}
                {!isRejected && (
                  <ActionButton
                    label={t('actions.reject')}
                    loadingLabel={t('actions.rejecting')}
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

      {/* === EXPANDED VIEW === */}
      {isExpanded && draft && (
        <div
          data-no-toggle
          className="space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-2">
            {isPending && (
              <span
                className="flex-shrink-0 mt-2 text-amber-400"
                title={t('task.pending_approval')}
                aria-label={t('task.pending_approval')}
              >
                ⊕
              </span>
            )}
            <input
              type="text"
              value={draft.task_name}
              onChange={(e) => updateDraft('task_name', e.target.value)}
              placeholder={t('task.name_placeholder')}
              className={`w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm font-medium text-white focus:outline-none focus:border-slate-500 ${isCompleted ? 'line-through' : ''}`}
            />
          </div>

          <Field label={t('task.description_label')}>
            <textarea
              value={draft.description}
              onChange={(e) => updateDraft('description', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-slate-500 resize-none"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('task.category_label')}>
              <select
                value={draft.category}
                onChange={(e) => updateDraft('category', e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-slate-500"
              >
                <option value="Business">{t('browse.filter_business')}</option>
                <option value="Personal">{t('browse.filter_personal')}</option>
                <option value="Unknown">{t('browse.filter_unknown')}</option>
              </select>
            </Field>
            <Field label={t('task.priority_label')}>
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

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('task.due_date_label')}>
              <input
                type="date"
                value={draft.due_date}
                onChange={(e) => updateDraft('due_date', e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-slate-500"
              />
            </Field>
            <Field label={t('task.due_time_label')}>
              <input
                type="time"
                value={draft.due_time}
                onChange={(e) => updateDraft('due_time', e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-slate-500"
              />
            </Field>
          </div>

          <Field label={t('task.checklist_label')}>
            <div className="space-y-2">
              {draft.checklist.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item.text}
                    onChange={(e) => updateChecklistItem(index, { ...item, text: e.target.value })}
                    placeholder={t('task.checklist_item_placeholder', { n: index + 1 })}
                    className="flex-1 px-3 py-1.5 rounded-md bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => removeChecklistItem(index)}
                    className="px-2 py-1.5 rounded-md text-xs text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
                    title={t('task.remove_item')}
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
                {t('task.add_checklist_item')}
              </button>
            </div>
          </Field>

          {saveError && (
            <div className="text-xs text-red-400">
              {t('errors.failed_save')}: {saveError}
            </div>
          )}
          {deleteError && (
            <div className="text-xs text-red-400">
              {t('errors.failed_delete')}: {deleteError}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/50">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isDeleting || !draft.task_name.trim()}
              className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? t('actions.saving') : t('actions.save')}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving || isDeleting}
              className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed transition-colors"
            >
              {t('actions.cancel')}
            </button>

            {isRejected ? (
              <ActionButton
                label={t('actions.unreject')}
                loadingLabel={t('actions.unrejecting')}
                isLoading={pendingAction === 'unreject'}
                disabled={pendingAction !== null}
                onClick={() => handleAction('unreject', { is_rejected: false })}
                variant="secondary"
              />
            ) : (
              <>
                {isPending && (
                  <ActionButton
                    label={t('actions.approve')}
                    loadingLabel={t('actions.approving')}
                    isLoading={pendingAction === 'approve'}
                    disabled={pendingAction !== null}
                    onClick={() => handleAction('approve', { approval_status: true })}
                    variant="primary"
                  />
                )}
                {!isCompleted && (
                  <ActionButton
                    label={t('actions.complete')}
                    loadingLabel={t('actions.completing')}
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
                    label={t('actions.uncomplete')}
                    loadingLabel={t('actions.uncompleting')}
                    isLoading={pendingAction === 'uncomplete'}
                    disabled={pendingAction !== null}
                    onClick={() => handleAction('uncomplete', { is_completed: false })}
                    variant="secondary"
                  />
                )}
                {!isRejected && (
                  <ActionButton
                    label={t('actions.reject')}
                    loadingLabel={t('actions.rejecting')}
                    isLoading={pendingAction === 'reject'}
                    disabled={pendingAction !== null}
                    onClick={() => handleAction('reject', { is_rejected: true })}
                    variant="danger"
                  />
                )}
              </>
            )}

            <button
              type="button"
              onClick={handleDelete}
              disabled={isSaving || isDeleting || pendingAction !== null}
              className="ml-auto inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium bg-red-950/50 text-red-300 hover:bg-red-900/50 disabled:bg-slate-900 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
            >
              {isDeleting ? t('actions.deleting') : t('actions.delete')}
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <div className="mt-2 text-xs text-red-400">
          {t('errors.failed_update')}: {actionError}
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

function EmptyBox() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 text-slate-600">
      <rect x="1" y="1" width="12" height="12" rx="2" />
    </svg>
  );
}

function CheckedBox() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 text-slate-400">
      <rect x="1" y="1" width="12" height="12" rx="2" fill="currentColor" fillOpacity="0.15" />
      <path d="M3.5 7L5.5 9.5L10.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default TaskCard;
