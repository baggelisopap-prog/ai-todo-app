import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  subscribeToPush,
} from '../utils/notifications';
import {
  registerPushSubscription,
  getAppSettings,
  updateAppSettings,
  getTokenUsage,
  getCalendarStatus,
  disconnectGoogleCalendar,
  testCalendarConnection,
} from '../api';
import { supabase } from '../supabaseClient';
import GoogleCalendarEventsView from './GoogleCalendarEventsView';

const SETTINGS_CATEGORIES = [
  { id: 'notifications', labelKey: 'settings.category_notifications', icon: BellIcon },
  { id: 'calendar', labelKey: 'settings.category_calendar', icon: CalendarIcon },
];

export function SettingsModal({ onClose }) {
  const { t } = useTranslation();
  const [currentCategory, setCurrentCategory] = useState(null); // null = menu, 'notifications'/'developer' = detail
  const isDevMode = localStorage.getItem('dev_mode') === 'true';
  const categories = isDevMode
    ? [...SETTINGS_CATEGORIES, { id: 'developer', labelKey: 'settings.category_developer', icon: CodeIcon }]
    : SETTINGS_CATEGORIES;

  const [permission, setPermission] = useState(getNotificationPermission());
  const [isRequesting, setIsRequesting] = useState(false);
  const [settings, setSettings] = useState({
    notifications_enabled: true,
    send_all_enabled: true,
    daily_summary_enabled: false,
    daily_summary_mode: 'fixed_time',
    daily_summary_time: '08:00',
  });
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
      .then(s => setSettings(s))
      .catch(err => console.error('Failed to load settings:', err))
      .finally(() => setSettingsLoaded(true));
  }, []);

  async function handleRequestPermission() {
    setIsRequesting(true);
    const result = await requestNotificationPermission();
    setPermission(result);
    setIsRequesting(false);
  }

  async function handleToggle(field) {
    const previous = settings;
    const updated = { ...settings, [field]: !settings[field] };
    setSettings(updated); // optimistic
    try {
      await updateAppSettings(updated);
    } catch (err) {
      setSettings(previous); // revert on failure
      console.error('Failed to update settings:', err);
    }
  }

  async function handleModeChange(mode) {
    const previous = settings;
    const updated = { ...settings, daily_summary_mode: mode };
    setSettings(updated);
    try {
      await updateAppSettings(updated);
    } catch (err) {
      setSettings(previous);
      console.error('Failed to update settings:', err);
    }
  }

  async function handleTimeChange(time) {
    const previous = settings;
    const updated = { ...settings, daily_summary_time: time };
    setSettings(updated);
    try {
      await updateAppSettings(updated);
    } catch (err) {
      setSettings(previous);
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
        <div className="flex items-center gap-2 mb-4">
          {currentCategory && (
            <button
              onClick={() => setCurrentCategory(null)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1"
              aria-label={t('settings.back')}
            >
              <ChevronLeftIcon className="w-5 h-5" />
            </button>
          )}
          <h2 className="text-lg font-semibold text-[var(--text-primary)] flex-1">
            {currentCategory === 'notifications' && t('settings.category_notifications')}
            {currentCategory === 'calendar' && t('settings.category_calendar')}
            {currentCategory === 'developer' && t('settings.category_developer')}
            {!currentCategory && t('settings.title')}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label={t('actions.cancel')}
          >
            ✕
          </button>
        </div>

        {!currentCategory && (
          <div className="space-y-1">
            {categories.map(category => {
              const Icon = category.icon;
              return (
                <button
                  key={category.id}
                  onClick={() => setCurrentCategory(category.id)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-md hover:bg-[var(--bg-hover)] transition-colors text-left"
                >
                  <span className="text-[var(--text-secondary)]">
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="flex-1 text-[var(--text-primary)]">{t(category.labelKey)}</span>
                  <ChevronRightIcon className="w-4 h-4 text-[var(--text-muted)]" />
                </button>
              );
            })}
            <button
              onClick={() => supabase.auth.signOut()}
              className="w-full text-left px-3 py-3 rounded-md hover:bg-[var(--bg-hover)] text-red-600"
            >
              {t('auth.sign_out')}
            </button>
          </div>
        )}

        {currentCategory === 'notifications' && (
          <div>
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
              <p className="text-sm text-[var(--text-secondary)]">
                {t('settings.notifications_enabled')}
              </p>
            )}

            {settingsLoaded && (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {t('settings.notifications_toggle_label')}
                    </span>
                    <button
                      onClick={() => handleToggle('notifications_enabled')}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        settings.notifications_enabled ? 'bg-[var(--brand-primary)]' : 'bg-[var(--border-subtle)]'
                      }`}
                      aria-label={t('settings.notifications_toggle_label')}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                          settings.notifications_enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {t('settings.notifications_toggle_description')}
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {t('settings.send_all_label')}
                    </span>
                    <button
                      onClick={() => handleToggle('send_all_enabled')}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        settings.send_all_enabled ? 'bg-[var(--brand-primary)]' : 'bg-[var(--border-subtle)]'
                      }`}
                      aria-label={t('settings.send_all_label')}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                          settings.send_all_enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {t('settings.send_all_description')}
                  </p>
                </div>

                <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {t('settings.daily_summary_label')}
                    </span>
                    <button
                      onClick={() => handleToggle('daily_summary_enabled')}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        settings.daily_summary_enabled ? 'bg-[var(--brand-primary)]' : 'bg-[var(--border-subtle)]'
                      }`}
                      aria-label={t('settings.daily_summary_label')}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                          settings.daily_summary_enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {t('settings.daily_summary_description')}
                  </p>

                  {settings.daily_summary_enabled && (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleModeChange('fixed_time')}
                          className={`flex-1 px-3 py-2 rounded-md text-sm border transition-colors ${
                            settings.daily_summary_mode === 'fixed_time'
                              ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                              : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          {t('settings.mode_fixed_time')}
                        </button>
                        <button
                          onClick={() => handleModeChange('before_first_task')}
                          className={`flex-1 px-3 py-2 rounded-md text-sm border transition-colors ${
                            settings.daily_summary_mode === 'before_first_task'
                              ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                              : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          {t('settings.mode_before_first_task')}
                        </button>
                      </div>

                      {settings.daily_summary_mode === 'fixed_time' && (
                        <input
                          type="time"
                          value={settings.daily_summary_time}
                          onChange={(e) => handleTimeChange(e.target.value)}
                          className="w-full px-3 py-2 rounded-md border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] bg-[var(--bg-card)]"
                        />
                      )}

                      {settings.daily_summary_mode === 'before_first_task' && (
                        <p className="text-xs text-[var(--text-muted)]">
                          {t('settings.before_first_task_description')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {currentCategory === 'calendar' && <CalendarConnectionView />}

        {currentCategory === 'developer' && <DeveloperUsageView />}
      </div>
    </div>
  );
}

function CalendarConnectionView() {
  const { t } = useTranslation();
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [calendarTestResult, setCalendarTestResult] = useState(null);
  const [showEvents, setShowEvents] = useState(false);

  // Independent copy of app settings, scoped to this view — mirrors how the
  // Notifications category manages its own settings state. Only the
  // calendar_sync_all_enabled field is read/written here; the other fields
  // just ride along unchanged so a PATCH from this view never clobbers the
  // notification settings (the /settings endpoint takes the full object).
  const [settings, setSettings] = useState(null);

  // Fires automatically on mount (no button needed) — this is what makes
  // "Connected" show immediately whenever the user opens this Calendar
  // settings section. "Test connection" below is a separate, optional
  // manual check that the API call still actually works.
  useEffect(() => {
    getCalendarStatus()
      .then(s => setCalendarConnected(s.connected))
      .catch(err => console.error('Failed to load calendar status:', err))
      .finally(() => setStatusLoaded(true));
  }, []);

  useEffect(() => {
    getAppSettings()
      .then(s => setSettings(s))
      .catch(err => console.error('Failed to load settings:', err));
  }, []);

  async function handleToggleSyncAll() {
    const previous = settings;
    const updated = { ...settings, calendar_sync_all_enabled: !settings.calendar_sync_all_enabled };
    setSettings(updated); // optimistic
    try {
      await updateAppSettings(updated);
    } catch (err) {
      setSettings(previous); // revert on failure
      console.error('Failed to update settings:', err);
    }
  }

  async function handleConnectCalendar() {
    // Read by App.jsx's onAuthStateChange listener once this OAuth flow
    // completes, to distinguish it from a normal Google login.
    sessionStorage.setItem('connecting_google_calendar', 'true');
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/calendar.events',
        // Required for Google to reliably re-issue a refresh_token even if
        // this app already has some prior grant from this user (e.g. login)
        // — do not remove.
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
  }

  async function handleDisconnectCalendar() {
    await disconnectGoogleCalendar();
    setCalendarConnected(false);
    setCalendarTestResult(null);
  }

  async function handleTestCalendar() {
    setIsTesting(true);
    setCalendarTestResult(null);
    try {
      const result = await testCalendarConnection();
      setCalendarTestResult(result.calendar_name);
    } catch (err) {
      setCalendarTestResult(t('calendar.test_failed'));
    } finally {
      setIsTesting(false);
    }
  }

  if (!statusLoaded) {
    return <p className="text-sm text-[var(--text-muted)]">{t('settings.loading')}</p>;
  }

  return (
    <div>
      {!calendarConnected ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">{t('calendar.not_connected')}</p>
          <button
            onClick={handleConnectCalendar}
            className="px-4 py-2 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white font-medium"
          >
            {t('calendar.connect')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-[var(--success)] font-medium">{t('calendar.connected')} ✓</p>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {t('calendar.sync_all')}
              </span>
              <button
                onClick={handleToggleSyncAll}
                disabled={!settings}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  settings?.calendar_sync_all_enabled ? 'bg-[var(--brand-primary)]' : 'bg-[var(--border-subtle)]'
                }`}
                aria-label={t('calendar.sync_all')}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    settings?.calendar_sync_all_enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {t('calendar.sync_all_description')}
            </p>
          </div>

          <div className="pt-3 border-t border-[var(--border-subtle)]">
            <button
              onClick={() => setShowEvents((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-[var(--bg-hover)] text-sm font-medium text-[var(--text-primary)]"
            >
              {t('calendar.view_events')}
              <ChevronRightIcon className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${showEvents ? 'rotate-90' : ''}`} />
            </button>
            {showEvents && (
              <div className="mt-2">
                <GoogleCalendarEventsView />
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-[var(--border-subtle)] space-y-3">
            <button
              onClick={handleTestCalendar}
              disabled={isTesting}
              className="px-4 py-2 rounded-md border border-[var(--border-subtle)] text-sm font-medium disabled:opacity-50"
            >
              {t('calendar.test')}
            </button>
            {calendarTestResult && (
              <p className="text-sm text-[var(--text-primary)]">{calendarTestResult}</p>
            )}
            <button
              onClick={handleDisconnectCalendar}
              className="w-full text-left px-3 py-2 rounded-md hover:bg-[var(--bg-hover)] text-red-600 text-sm"
            >
              {t('calendar.disconnect')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DeveloperUsageView() {
  const { t } = useTranslation();
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTokenUsage()
      .then(setUsage)
      .catch(err => console.error('Failed to load token usage:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-[var(--text-muted)]">{t('settings.loading')}</p>;
  if (!usage) return <p className="text-sm text-[var(--text-muted)]">{t('settings.load_failed')}</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md p-3">
          <div className="text-xs text-[var(--text-muted)] uppercase">{t('settings.today')}</div>
          <div className="text-lg font-semibold text-[var(--text-primary)] mt-1">{usage.today.total_tokens.toLocaleString()} tok</div>
          <div className="text-xs text-[var(--text-secondary)]">${usage.today.estimated_cost_usd.toFixed(4)} • {usage.today.call_count} calls</div>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md p-3">
          <div className="text-xs text-[var(--text-muted)] uppercase">{t('settings.this_week')}</div>
          <div className="text-lg font-semibold text-[var(--text-primary)] mt-1">{usage.this_week.total_tokens.toLocaleString()} tok</div>
          <div className="text-xs text-[var(--text-secondary)]">${usage.this_week.estimated_cost_usd.toFixed(4)} • {usage.this_week.call_count} calls</div>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">{t('settings.recent_calls')}</div>
        <div className="space-y-1">
          {usage.recent_calls.map((call, idx) => (
            <div key={idx} className="flex justify-between items-center text-xs py-1.5 border-b border-[var(--border-subtle)] last:border-0">
              <span className="text-[var(--text-primary)]">{call.call_type}</span>
              <span className="text-[var(--text-muted)]">{call.total_tokens} tok • ${call.estimated_cost_usd.toFixed(4)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BellIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function ChevronLeftIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CalendarIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function CodeIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

export default SettingsModal;
