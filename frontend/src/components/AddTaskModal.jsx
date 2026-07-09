import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { extractTasks } from '../api';

function AddTaskModal({ onClose, onTasksAdded }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const trimmedText = text.trim();
  const canSubmit = trimmedText.length > 0 && !isSubmitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await extractTasks(trimmedText);
      onTasksAdded(result.saved_tasks);
    } catch (err) {
      setError(err.message);
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full md:max-w-md bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl p-4 shadow-[var(--shadow-modal)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('modal.add_task_title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 rounded"
            aria-label={t('actions.cancel')}
          >
            ✕
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('modal.placeholder')}
          rows={4}
          disabled={isSubmitting}
          className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-medium)] rounded-md text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-blue-100 resize-none transition-colors disabled:opacity-50"
        />

        {error && (
          <div className="mt-2 p-2 rounded border border-red-200 bg-red-50 text-red-800 text-xs">
            {t('errors.failed_add')}: {error}
          </div>
        )}

        <div className="flex justify-between items-center mt-3">
          <span className="text-xs text-[var(--text-muted)]">
            {isSubmitting ? t('modal.submitting') : t('modal.submit_hint')}
          </span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white text-sm font-medium disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-muted)] disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? t('actions.adding') : t('actions.add')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddTaskModal;
