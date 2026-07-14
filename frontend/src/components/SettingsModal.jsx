import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  subscribeToPush,
} from '../utils/notifications';
import { registerPushSubscription, getAppSettings, updateAppSettings } from '../api';

export function SettingsModal({ onClose }) {
  const { t } = useTranslation();
  const [permission, setPermission] = useState(getNotificationPermission());
  const [isRequesting, setIsRequesting] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const supported = isNotificationSupported();

  useEffect(() => {
    if (permission === 'granted') {
      subscribeToPush()
        .then(sub => sub && registerPushSubscription(sub))
        .catch(err => console.error('Push subscription failed:', err));
    }
  }, [permission]);

  useEffect(() => {
    getAppSettings()
      .then(s => setNotificationsEnabled(s.notifications_enabled))
      .catch(err => console.error('Failed to load settings:', err))
      .finally(() => setSettingsLoaded(true));
  }, []);

  async function handleRequestPermission() {
    setIsRequesting(true);
    const result = await requestNotificationPermission();
    setPermission(result);
    setIsRequesting(false);
  }

  async function handleToggleNotifications() {
    const newValue = !notificationsEnabled;
    setNotificationsEnabled(newValue); // optimistic
    try {
      await updateAppSettings(newValue);
    } catch (err) {
      setNotificationsEnabled(!newValue); // revert on failure
      console.error('Failed to update settings:', err);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-md bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] p-4 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {t('settings.title')}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label={t('actions.cancel')}
          >
            ✕
          </button>
        </div>

        <div className="mb-2">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">
            {t('settings.notifications_section')}
          </h3>

          {!supported && (
            <p className="text-sm text-[var(--text-muted)]">
              {t('settings.notifications_unsupported')}
            </p>
          )}

          {supported && permission === 'default' && (
            <div>
              <p className="text-sm text-[var(--text-secondary)] mb-3">
                {t('settings.notifications_intro')}
              </p>
              <button
                onClick={handleRequestPermission}
                disabled={isRequesting}
                className="px-4 py-2 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white font-medium disabled:opacity-50"
              >
                {isRequesting ? t('settings.requesting') : t('settings.enable_notifications')}
              </button>
            </div>
          )}

          {supported && permission === 'denied' && (
            <p className="text-sm text-[var(--text-muted)]">
              {t('settings.notifications_blocked')}
            </p>
          )}

          {supported && permission === 'granted' && (
            <div>
              <p className="text-sm text-[var(--text-secondary)] mb-3">
                {t('settings.notifications_enabled')}
              </p>
              {settingsLoaded && (
                <div className="flex items-center justify-between mt-3">
                  <span className="text-sm text-[var(--text-primary)]">
                    {t('settings.master_toggle_label')}
                  </span>
                  <button
                    onClick={handleToggleNotifications}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      notificationsEnabled ? 'bg-[var(--brand-primary)]' : 'bg-[var(--border-subtle)]'
                    }`}
                    aria-label={t('settings.master_toggle_label')}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                        notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
