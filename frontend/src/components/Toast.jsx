import { useEffect } from 'react';

const VARIANT_CLASSES = {
  success: 'bg-green-50 border-green-200 text-green-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  neutral: 'bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)]',
};

const VARIANT_ICON_CLASSES = {
  success: 'text-green-600',
  error: 'text-red-600',
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
    <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg border shadow-[var(--shadow-modal)] text-sm font-medium flex items-center gap-2 ${VARIANT_CLASSES[variant]}`}>
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
