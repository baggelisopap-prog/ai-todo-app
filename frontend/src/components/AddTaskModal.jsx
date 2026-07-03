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
      className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-slate-900 w-full md:max-w-md md:rounded-lg rounded-t-2xl p-4 border border-slate-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-sm font-semibold text-white">{t('modal.add_task_title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded"
            aria-label={t('actions.cancel')}
          >
            ✕
          </button>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-950 overflow-hidden focus-within:border-slate-500 transition-colors">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('modal.placeholder')}
            rows={4}
            disabled={isSubmitting}
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 px-4 py-3 resize-none focus:outline-none disabled:opacity-50"
          />
        </div>

        {error && (
          <div className="mt-2 p-2 rounded border border-red-900 bg-red-950 text-red-300 text-xs">
            {t('errors.failed_add')}: {error}
          </div>
        )}

        <div className="flex justify-between items-center mt-3">
          <span className="text-xs text-slate-500">
            {isSubmitting ? t('modal.submitting') : t('modal.submit_hint')}
          </span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center px-4 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? t('actions.adding') : t('actions.add')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddTaskModal;
