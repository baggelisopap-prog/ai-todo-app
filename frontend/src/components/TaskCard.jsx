import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteTask } from '../api';
import { formatDate } from '../utils/formatDate';
import { priorityColor } from '../utils/priorityColor';
import CustomSelect from './CustomSelect';

function categoryColor(category) {
  switch (category) {
    case 'Business':
      return 'var(--category-business)';
    case 'Personal':
      return 'var(--category-personal)';
    default:
      return 'var(--category-unknown)';
  }
}

const ACTION_TOAST_KEYS = {
  approve: 'toast.approved',
  uncomplete: 'toast.uncompleted',
  reject: 'toast.rejected',
  unreject: 'toast.unrejected',
};

function TaskCard({ task, variant = 'default', isExpanded, onToggleExpand, onUpdate, onTaskDeleted, onShowToast }) {
  const { t } = useTranslation();

  const [pendingAction, setPendingAction] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [draft, setDraft] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [optimisticChecklist, setOptimisticChecklist] = useState(null);
  const [pendingToggleIdx, setPendingToggleIdx] = useState(null);
  const [toggleError, setToggleError] = useState(null);

  const [optimisticCompleted, setOptimisticCompleted] = useState(null);

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const cardRef = useRef(null);
  const menuRef = useRef(null);

  const isPending = !task.approval_status;
  const isCompleted = optimisticCompleted ?? task.is_completed;
  const isRejected = task.is_rejected;
  const displayChecklist = optimisticChecklist ?? task.checklist;
  const showDescription = task.description && task.description !== task.task_name;

  const categoryOptions = [
    { value: 'Business', label: t('browse.filter_business') },
    { value: 'Personal', label: t('browse.filter_personal') },
    { value: 'Unknown', label: t('browse.filter_unknown') },
  ];

  const priorityOptions = [
    { value: 'P1', label: 'P1' },
    { value: 'P2', label: 'P2' },
    { value: 'P3', label: 'P3' },
  ];

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

  useEffect(() => {
    if (!isMenuOpen) return;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

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
    setIsMenuOpen(false);
    setPendingAction(actionName);
    setActionError(null);
    try {
      await onUpdate(task.record_id, updates);
      onShowToast(ACTION_TOAST_KEYS[actionName], 'success');
    } catch (err) {
      setActionError(err.message);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCircleClick(e) {
    e.stopPropagation();
    if (variant === 'inbox') {
      setActionError(null);
      try {
        await onUpdate(task.record_id, { approval_status: true });
        onShowToast('toast.approved', 'success');
      } catch (err) {
        setActionError(err.message);
      }
      return;
    }
    const newValue = !task.is_completed;
    setOptimisticCompleted(newValue);
    setActionError(null);
    try {
      await onUpdate(task.record_id, {
        is_completed: newValue,
        ...(newValue && isPending ? { approval_status: true } : {}),
      });
      setOptimisticCompleted(null);
      onShowToast(newValue ? 'toast.completed' : 'toast.uncompleted', 'success');
    } catch (err) {
      setOptimisticCompleted(null);
      setActionError(err.message);
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
    setIsMenuOpen(false);
    const confirmed = window.confirm(t('confirm.delete_task'));
    if (!confirmed) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteTask(task.record_id);
      onTaskDeleted(task.record_id);
      onShowToast('toast.deleted', 'success');
    } catch (err) {
      setDeleteError(err.message);
      setIsDeleting(false);
    }
  }

  function handleEdit() {
    setIsMenuOpen(false);
    onToggleExpand(task.record_id);
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
    'bg-[var(--bg-card)] border border-[var(--border-subtle)]',
    'rounded-lg p-4 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)]',
    'transition-shadow cursor-pointer',
    isExpanded ? 'ring-2 ring-[var(--border-focus)]/20' : '',
    isRejected ? 'opacity-60' : isCompleted ? 'opacity-70' : '',
  ].filter(Boolean).join(' ');

  const titleClasses = [
    'text-base font-medium text-[var(--text-primary)] break-words',
    isCompleted ? 'line-through text-[var(--text-muted)]' : '',
  ].filter(Boolean).join(' ');

  return (
    <article ref={cardRef} onClick={handleCardClick} className={cardClasses}>
      {/* === COLLAPSED VIEW === */}
      {!isExpanded && (
        <>
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={handleCircleClick}
              className={`w-5 h-5 mt-0.5 rounded-full flex-shrink-0 flex items-center justify-center transition-all
                ${isCompleted
                  ? 'bg-[var(--success)] border-2 border-[var(--success)]'
                  : 'border-2 border-[var(--border-medium)] hover:border-[var(--text-secondary)]'}`}
              aria-label={
                variant === 'inbox'
                  ? t('actions.approve')
                  : (isCompleted ? t('task.mark_incomplete') : t('task.mark_complete'))
              }
            >
              {isCompleted && <CheckIcon className="w-3 h-3 text-white" />}
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: priorityColor(task.priority) }}
                  aria-label={`Priority ${task.priority}`}
                />
                <h3 className={titleClasses}>{task.task_name}</h3>
              </div>

              {showDescription && (
                <p className="text-sm text-[var(--text-secondary)] mt-1 ml-6 truncate">
                  {task.description}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 mt-2 ml-6 text-xs text-[var(--text-secondary)]">
                {task.due_date && (
                  <span className="flex items-center gap-1">
                    <CalendarIcon className="w-3 h-3" />
                    {formatDate(task.due_date, task.due_time)}
                  </span>
                )}
                {task.category && task.category !== 'Unknown' && (
                  <span className="flex items-center gap-1" style={{ color: categoryColor(task.category) }}>
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: categoryColor(task.category) }}
                    />
                    {task.category}
                  </span>
                )}
                {isPending && (
                  <span className="text-[var(--priority-p2)] font-medium">{t('task.pending')}</span>
                )}
              </div>

              {displayChecklist && displayChecklist.length > 0 && (
                <ul className="mt-3 space-y-0.5 ml-6">
                  {displayChecklist.map((item, index) => (
                    <li key={index} className="text-xs">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleChecklistItem(index);
                        }}
                        disabled={pendingToggleIdx !== null}
                        className="flex items-center gap-2 w-full text-left py-0.5 px-2 hover:bg-[var(--bg-hover)] rounded transition-colors disabled:cursor-wait"
                      >
                        {item.done ? <CheckedBox /> : <EmptyBox />}
                        <span className={item.done ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}>
                          {item.text}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {toggleError && (
                <div className="mt-1 ml-6 text-xs text-[var(--danger)]">
                  {t('errors.failed_update')}: {toggleError}
                </div>
              )}

              {actionError && (
                <div className="mt-2 ml-6 text-xs text-[var(--danger)]">
                  {t('errors.failed_update')}: {actionError}
                </div>
              )}

              {deleteError && (
                <div className="mt-2 ml-6 text-xs text-[var(--danger)]">
                  {t('errors.failed_delete')}: {deleteError}
                </div>
              )}
            </div>

            <TaskMenu
              menuRef={menuRef}
              isOpen={isMenuOpen}
              onToggle={() => setIsMenuOpen((v) => !v)}
              isPending={isPending}
              isCompleted={isCompleted}
              isRejected={isRejected}
              pendingAction={pendingAction}
              onApprove={() => handleAction('approve', { approval_status: true })}
              onUncomplete={() => handleAction('uncomplete', { is_completed: false })}
              onReject={() => handleAction('reject', { is_rejected: true })}
              onUnreject={() => handleAction('unreject', { is_rejected: false })}
              onEdit={handleEdit}
              onDelete={handleDelete}
              t={t}
            />
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
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={handleCircleClick}
              className={`w-5 h-5 mt-2 rounded-full flex-shrink-0 flex items-center justify-center transition-all
                ${isCompleted
                  ? 'bg-[var(--success)] border-2 border-[var(--success)]'
                  : 'border-2 border-[var(--border-medium)] hover:border-[var(--text-secondary)]'}`}
              aria-label={
                variant === 'inbox'
                  ? t('actions.approve')
                  : (isCompleted ? t('task.mark_incomplete') : t('task.mark_complete'))
              }
            >
              {isCompleted && <CheckIcon className="w-3 h-3 text-white" />}
            </button>
            <input
              type="text"
              value={draft.task_name}
              onChange={(e) => updateDraft('task_name', e.target.value)}
              placeholder={t('task.name_placeholder')}
              className={`w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-blue-100 transition-colors ${isCompleted ? 'line-through' : ''}`}
            />
            <TaskMenu
              menuRef={menuRef}
              isOpen={isMenuOpen}
              onToggle={() => setIsMenuOpen((v) => !v)}
              isPending={isPending}
              isCompleted={isCompleted}
              isRejected={isRejected}
              pendingAction={pendingAction}
              onApprove={() => handleAction('approve', { approval_status: true })}
              onUncomplete={() => handleAction('uncomplete', { is_completed: false })}
              onReject={() => handleAction('reject', { is_rejected: true })}
              onUnreject={() => handleAction('unreject', { is_rejected: false })}
              onDelete={handleDelete}
              t={t}
            />
          </div>

          <Field label={t('task.description_label')}>
            <textarea
              value={draft.description}
              onChange={(e) => updateDraft('description', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-blue-100 resize-none transition-colors"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('task.category_label')}>
              <CustomSelect
                value={draft.category}
                options={categoryOptions}
                onChange={(value) => updateDraft('category', value)}
                ariaLabel={t('task.category_label')}
              />
            </Field>
            <Field label={t('task.priority_label')}>
              <CustomSelect
                value={draft.priority}
                options={priorityOptions}
                onChange={(value) => updateDraft('priority', value)}
                ariaLabel={t('task.priority_label')}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('task.due_date_label')}>
              <input
                type="date"
                value={draft.due_date}
                onChange={(e) => updateDraft('due_date', e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-blue-100 transition-colors"
              />
            </Field>
            <Field label={t('task.due_time_label')}>
              <input
                type="time"
                value={draft.due_time}
                onChange={(e) => updateDraft('due_time', e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-blue-100 transition-colors"
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
                    className="flex-1 px-3 py-1.5 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-blue-100 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => removeChecklistItem(index)}
                    className="px-2 py-1.5 rounded-md text-xs text-[var(--text-secondary)] hover:text-[var(--danger)] hover:bg-[var(--bg-hover)] transition-colors"
                    title={t('task.remove_item')}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addChecklistItem}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                {t('task.add_checklist_item')}
              </button>
            </div>
          </Field>

          {saveError && (
            <div className="text-xs text-[var(--danger)]">
              {t('errors.failed_save')}: {saveError}
            </div>
          )}
          {deleteError && (
            <div className="text-xs text-[var(--danger)]">
              {t('errors.failed_delete')}: {deleteError}
            </div>
          )}
          {actionError && (
            <div className="text-xs text-[var(--danger)]">
              {t('errors.failed_update')}: {actionError}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isDeleting || !draft.task_name.trim()}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-muted)] disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? t('actions.saving') : t('actions.save')}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving || isDeleting}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-transparent text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed transition-colors"
            >
              {t('actions.cancel')}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function TaskMenu({
  menuRef,
  isOpen,
  onToggle,
  isPending,
  isCompleted,
  isRejected,
  pendingAction,
  onApprove,
  onUncomplete,
  onReject,
  onUnreject,
  onEdit,
  onDelete,
  t,
}) {
  return (
    <div className="relative flex-shrink-0" data-no-toggle ref={menuRef}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={t('menu.open_menu')}
        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        <DotsIcon />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-[var(--shadow-menu)] py-1 overflow-hidden">
          {isPending && (
            <MenuItem
              label={pendingAction === 'approve' ? t('actions.approving') : t('actions.approve')}
              disabled={pendingAction !== null}
              onClick={onApprove}
            />
          )}
          {isCompleted && (
            <MenuItem
              label={pendingAction === 'uncomplete' ? t('actions.uncompleting') : t('actions.uncomplete')}
              disabled={pendingAction !== null}
              onClick={onUncomplete}
            />
          )}
          {!isRejected && (
            <MenuItem
              label={pendingAction === 'reject' ? t('actions.rejecting') : t('actions.reject')}
              disabled={pendingAction !== null}
              onClick={onReject}
            />
          )}
          {isRejected && (
            <MenuItem
              label={pendingAction === 'unreject' ? t('actions.unrejecting') : t('actions.unreject')}
              disabled={pendingAction !== null}
              onClick={onUnreject}
            />
          )}
          {onEdit && (
            <MenuItem label={t('actions.edit')} onClick={onEdit} />
          )}
          <hr className="my-1 border-[var(--border-subtle)]" />
          <MenuItem label={t('actions.delete')} onClick={onDelete} danger />
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, disabled, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`block w-full text-left px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[var(--bg-hover)] ${
        danger ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]'
      }`}
    >
      {label}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--text-secondary)] font-medium uppercase tracking-wide block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function EmptyBox() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 text-[var(--border-medium)]">
      <rect x="1" y="1" width="12" height="12" rx="2" />
    </svg>
  );
}

function CheckedBox() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
      <rect x="1" y="1" width="12" height="12" rx="2" fill="var(--success)" />
      <path d="M3.5 7L5.5 9.5L10.5 4.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon({ className }) {
  return (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M3 7L5.5 9.5L11 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon({ className }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  );
}

export default TaskCard;
