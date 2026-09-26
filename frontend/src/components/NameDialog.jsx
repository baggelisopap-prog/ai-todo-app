import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/**
 * One text box and a Save — for naming a new board and renaming one
 * (2026-09-26). ConfirmDialog's manners: rendered into document.body above any
 * modal, Escape stopped so it does not close what is underneath, backdrop
 * clicks stopped for the portal reason DropDialog gives.
 *
 * Here the box IS focused on open, unlike DropDialog's optional reason: a name
 * is the whole point of this dialog, and the keyboard is what the user needs.
 *
 * `onSave(name)` is awaited; a failure keeps the dialog open with the name
 * still typed.
 */
function NameDialog({ title, initial = '', maxLength = 60, saveLabel, onSave, onClose }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const [name, setName] = useState(initial);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();

    function handleKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [onClose]);

  async function save(e) {
    e.preventDefault();
    if (!name.trim() || isBusy) return;
    setIsBusy(true);
    try {
      await onSave(name.trim());
      onClose();
    } catch {
      setIsBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-black/50 animate-fade-in flex items-center justify-center p-4"
      onClick={(e) => { e.stopPropagation(); if (!isBusy) onClose(); }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-[var(--bg-modal)] shadow-[var(--shadow-modal)] p-5 flex flex-col gap-3"
      >
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={maxLength}
          aria-label={title}
          className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-primary)]"
        />
        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="tap-44 px-4 py-2 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-card)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 transition-colors"
          >
            {t('actions.cancel')}
          </button>
          <button
            type="submit"
            disabled={isBusy || !name.trim()}
            className="tap-44 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] disabled:opacity-50 transition-colors"
          >
            {isBusy ? t('actions.saving') : (saveLabel || t('actions.save'))}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

export default NameDialog;
