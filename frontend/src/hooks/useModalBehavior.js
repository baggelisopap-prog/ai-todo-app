import { useEffect } from 'react';

/**
 * The two things every modal in this app needs and only some of them had:
 * Escape closes it, and the page behind it stops scrolling.
 *
 * Six components here hand-roll a `fixed inset-0` overlay, so both behaviours
 * had to be remembered six times and were not — before this hook, Escape
 * worked in AddTaskModal alone, and nothing anywhere locked body scroll, so
 * opening Settings on a phone and swiping moved the task list underneath
 * instead of the modal.
 *
 * Deliberately a hook and NOT a shared <Modal> component. The modals have
 * genuinely different chrome — a full-screen sheet, a centred dialog, a chat
 * column — and unifying their markup is a much larger, riskier change than
 * the two behaviours they were actually missing. This adds the behaviour and
 * leaves the markup alone.
 *
 * Scroll locking is refcounted via a counter on document.body, because modals
 * here can stack (the photo preview opens over the floating buttons). Without
 * the count, the inner one closing would unlock the page while the outer one
 * is still open.
 *
 * @param {() => void} onClose        Called on Escape. Omit to keep Escape inert.
 * @param {boolean}    [lockScroll]   Defaults true.
 */
export function useModalBehavior(onClose, { lockScroll = true } = {}) {
  useEffect(() => {
    if (!onClose) return undefined;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!lockScroll) return undefined;

    const body = document.body;
    const depth = Number(body.dataset.modalDepth || 0) + 1;
    body.dataset.modalDepth = String(depth);
    // Only the outermost modal touches the style, and it remembers what was
    // there before rather than assuming '' — another stylesheet may own it.
    if (depth === 1) {
      body.dataset.prevOverflow = body.style.overflow;
      body.style.overflow = 'hidden';
    }

    return () => {
      const remaining = Number(body.dataset.modalDepth || 1) - 1;
      if (remaining > 0) {
        body.dataset.modalDepth = String(remaining);
        return;
      }
      delete body.dataset.modalDepth;
      body.style.overflow = body.dataset.prevOverflow || '';
      delete body.dataset.prevOverflow;
    };
  }, [lockScroll]);
}

export default useModalBehavior;
