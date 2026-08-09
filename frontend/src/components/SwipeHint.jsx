import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const STORAGE_KEY = 'swipe_hint_seen';

/**
 * Says once that the rows can be swiped.
 *
 * A gesture with no visible affordance is undiscoverable by construction —
 * there is nothing on a row to suggest it moves. The accessible path (the ⋯
 * menu) carries every one of these actions regardless, so this hint is about
 * speed, not access: nobody is locked out by missing it.
 *
 * Shown once ever, then remembered. Persisted like the language and theme
 * preferences, in localStorage: it is a property of this device, and a user
 * who has learned the gesture on their phone has not learned anything about
 * their laptop's trackpad.
 */
function SwipeHint({ onDismiss }) {
  const { t } = useTranslation();
  const [isSeen, setIsSeen] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true');

  if (isSeen) return null;

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, 'true');
    setIsSeen(true);
    onDismiss?.();
  }

  return (
    <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-md bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
      <span className="flex-1">{t('hints.swipe')}</span>
      <button
        type="button"
        onClick={dismiss}
        className="tap-44 text-[var(--text-muted)] hover:text-[var(--text-primary)] px-1"
        aria-label={t('actions.close')}
      >
        ✕
      </button>
    </div>
  );
}

export default SwipeHint;
