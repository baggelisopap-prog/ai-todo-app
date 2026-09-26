import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/**
 * «Ακύρωση εργασίας» — calling a task off, with an optional reason (2026-09-26).
 *
 * ConfirmDialog's shape and manners (portal above any modal, Escape stopped so
 * it does not also close the sheet underneath, the safe button focused) plus
 * one text box. Not ConfirmDialog with a flag: that one answers yes/no, and
 * this one has to carry a sentence back.
 *
 * THE REASON IS OPTIONAL, the owner's decision: a required box would be one
 * more thing to type on a phone for every cancellation. So the box is not
 * focused on open — focusing it would pop the phone's keyboard over the very
 * button that finishes the job in one tap.
 *
 * The dismiss button says «Πίσω», not the app's usual «Ακύρωση»: on a dialog
 * whose purpose is to CANCEL A TASK, a button reading «Ακύρωση» next to one
 * reading «Ακύρωση εργασίας» is a coin toss.
 *
 * `onConfirm(reason)` is awaited; a failure keeps the dialog open with the
 * error under the box, rather than closing on a cancellation that did not
 * happen.
 */
function DropDialog({ taskName, onConfirm, onClose }) {
  const { t } = useTranslation();
  const backRef = useRef(null);
  const [reason, setReason] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    backRef.current?.focus();

    function handleKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [onClose]);

  async function confirm() {
    setIsBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(err.message);
      setIsBusy(false);
    }
  }

  return createPortal(
    // stopPropagation on the backdrop too: a portal moves the DOM node but not
    // the React tree, so without it a tap outside the box would bubble on to
    // the task sheet this was opened from and close that as well.
    <div
      className="fixed inset-0 z-[70] bg-black/50 animate-fade-in flex items-center justify-center p-4"
      onClick={(e) => { e.stopPropagation(); if (!isBusy) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('drop.title')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-[var(--bg-modal)] shadow-[var(--shadow-modal)] p-5 flex flex-col gap-3"
      >
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{t('drop.title')}</h3>
        <p className="text-sm font-medium text-[var(--text-primary)] break-words">«{taskName}»</p>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{t('drop.hint')}</p>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--text-secondary)]">{t('drop.reason_label')}</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder={t('drop.reason_placeholder')}
            className="w-full resize-none rounded-lg border border-[var(--border-medium)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand-primary)]"
          />
        </label>

        {error && <p className="text-xs text-[var(--danger-text)]">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <button
            ref={backRef}
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="tap-44 px-4 py-2 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-card)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 transition-colors"
          >
            {t('drop.back')}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={isBusy}
            className="tap-44 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[var(--danger-strong)] hover:bg-[var(--brand-primary-hover)] disabled:opacity-50 transition-colors"
          >
            {isBusy ? t('drop.confirming') : t('drop.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default DropDialog;
