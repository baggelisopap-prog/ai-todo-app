import { useEffect } from 'react';

const VARIANT_CLASSES = {
  success: 'bg-[var(--success-bg)] border-[var(--success-border)] text-[var(--success-text)]',
  error: 'bg-[var(--danger-bg)] border-[var(--danger-border)] text-[var(--danger-text)]',
  neutral: 'bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)]',
};

const VARIANT_ICON_CLASSES = {
  success: 'text-[var(--success-strong)]',
  error: 'text-[var(--danger-strong)]',
  neutral: 'text-[var(--text-secondary)]',
};

/**
 * Toast — brief notification that auto-dismisses.
 * * Receives a message and an onDismiss callback. After `duration` ms,
 * automatically calls onDismiss to remove itself. An optional `action`
 * ({ label, onClick }) renders a button that runs onClick then dismisses.
 */
function Toast({ message, onDismiss, duration = 3000, variant = 'success', action }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    // Cleanup if component unmounts before timeout
    return () => clearTimeout(timer);
  }, [onDismiss, duration]);

  return (
    // bottom-safe-20 keeps the old 5rem gap above the nav and adds the home
    // indicator's inset underneath it, so the toast clears both.
    <div className={`fixed bottom-safe-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg border shadow-[var(--shadow-modal)] text-sm font-medium flex items-center gap-2 ${VARIANT_CLASSES[variant]}`}>
      {variant === 'success' && <span className={VARIANT_ICON_CLASSES.success}>✓</span>}
      {variant === 'error' && <span className={VARIANT_ICON_CLASSES.error}>✕</span>}
      <span>{message}</span>
      {action && (
        <button
          type="button"
          onClick={() => { action.onClick(); onDismiss(); }}
          className="font-semibold underline underline-offset-2 hover:no-underline"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export default Toast;
