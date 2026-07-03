import { useEffect } from 'react';

/**
 * Toast — brief success/info notification that auto-dismisses.
 * * Receives a message and an onDismiss callback. After `duration` ms,
 * automatically calls onDismiss to remove itself.
 */
function Toast({ message, onDismiss, duration = 3000 }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    // Cleanup if component unmounts before timeout
    return () => clearTimeout(timer);
  }, [onDismiss, duration]);

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-emerald-900 border border-emerald-700 text-emerald-100 shadow-lg text-sm font-medium flex items-center gap-2">
      <span className="text-emerald-400">✓</span>
      <span>{message}</span>
    </div>
  );
}

export default Toast;