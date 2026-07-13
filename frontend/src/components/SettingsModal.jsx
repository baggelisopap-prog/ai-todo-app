import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  showNotification,
} from '../utils/notifications';

export function SettingsModal({ onClose }) {
  const { t } = useTranslation();
  const [permission, setPermission] = useState(getNotificationPermission());
  const [isRequesting, setIsRequesting] = useState(false);
  const [testSent, setTestSent] = useState(false);

  const supported = isNotificationSupported();

  async function handleRequestPermission() {
    setIsRequesting(true);
    const result = await requestNotificationPermission();
    setPermission(result);
    setIsRequesting(false);
  }

  function handleTestNotification() {
    const sent = showNotification(t('settings.test_notification_title'), {
      body: t('settings.test_notification_body'),
    });
    if (sent) {
      setTestSent(true);
      setTimeout(() => setTestSent(false), 3000);
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
              <button
                onClick={handleTestNotification}
                className="px-4 py-2 rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium"
              >
                {testSent ? t('settings.test_sent') : t('settings.send_test')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
