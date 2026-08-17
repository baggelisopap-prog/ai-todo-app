import { useTranslation } from 'react-i18next';
import { useModalBehavior } from '../hooks/useModalBehavior';
import RecurrenceForm from './RecurrenceForm';

/**
 * RecurrenceForm, on top of everything, opened from a task.
 *
 * A shell and nothing more: the same backdrop, sheet-on-mobile and Escape
 * handling AddTaskModal uses, wrapped around the form the Settings screen
 * already renders inline. Settings keeps rendering it inline — a sub-screen
 * that has already replaced its own content does not need a second layer on
 * top of itself.
 *
 * `rule` null means this task does not repeat yet, and the form will create a
 * rule that adopts it. `rule` set means edit that rule.
 */
function RecurrenceModal({ task, rule, onClose, onSaved }) {
  const { t } = useTranslation();
  useModalBehavior(onClose);

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 animate-fade-in flex items-end md:items-center justify-center"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full md:max-w-md max-h-[90vh] overflow-y-auto bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl p-4 shadow-[var(--shadow-modal)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {rule ? t('recurrence.edit_title') : t('recurrence.make_repeating_title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 rounded"
            aria-label={t('actions.cancel')}
          >
            ✕
          </button>
        </div>

        <RecurrenceForm rule={rule} task={rule ? null : task} onCancel={onClose} onSaved={onSaved} />
      </div>
    </div>
  );
}

export default RecurrenceModal;
