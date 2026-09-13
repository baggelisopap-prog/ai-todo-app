import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/**
 * "Are you sure?", in our own words and our own colours.
 *
 * REPLACES window.confirm, which was in eight places. Three things the
 * browser's grey box cannot do, and all three matter on the screens it guarded:
 *
 * - **Say what will happen.** window.confirm has one line and no shape, so
 *   «Archive Business?» and the paragraph explaining that no task is lost had
 *   to be the same undifferentiated sentence. Here the question is a heading
 *   and the consequence is body text under it.
 * - **Name the action on the button.** OK/Cancel makes the user re-read the
 *   question to work out which one is which. The button says «Αρχειοθέτηση».
 * - **Look like the app.** A Windows-chrome dialog over a dark-theme modal is
 *   the one moment the app admits it is a web page.
 *
 * **It renders into document.body, above the Settings modal** (z-70 against its
 * z-50), for the same reason KebabMenu does: the modal body is a fixed-height
 * scrolling box, and anything that has to sit over it must escape it.
 *
 * **Cancel takes the focus, not the confirm button.** Every dialog this
 * replaces guards something destructive, and a focused confirm turns a stray
 * Enter into a deletion. Escape cancels — captured and stopped, so it does not
 * travel on and close the Settings modal underneath with a question still on
 * screen.
 */
function ConfirmDialog({ request, onAnswer }) {
  const { t } = useTranslation();
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!request) return undefined;
    cancelRef.current?.focus();

    function handleKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onAnswer(false);
      }
    }
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [request, onAnswer]);

  if (!request) return null;

  const { title, body, confirmLabel, danger = true } = request;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-black/50 animate-fade-in flex items-center justify-center p-4"
      onClick={() => onAnswer(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-[var(--bg-modal)] shadow-[var(--shadow-modal)] p-5 flex flex-col gap-3"
      >
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
        {body && (
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{body}</p>
        )}
        <div className="flex gap-2 justify-end pt-1">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onAnswer(false)}
            className="tap-44 px-4 py-2 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-card)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            {t('actions.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onAnswer(true)}
            className={`tap-44 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
              danger
                ? 'bg-[var(--danger-strong)] hover:bg-[var(--brand-primary-hover)]'
                : 'bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ConfirmDialog;
