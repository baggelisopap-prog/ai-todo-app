import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalBehavior } from '../hooks/useModalBehavior';
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  subscribeToPush,
} from '../utils/notifications';
import {
  registerPushSubscription,
  getTokenUsage,
  getCalendarStatus,
  disconnectGoogleCalendar,
  getProfile,
  updateProfile,
  deleteAccount,
} from '../api';
import { supabase } from '../supabaseClient';
import { getStoredTheme, setTheme } from '../utils/theme';
import { useAppSettings } from '../hooks/useAppSettings';
import CollapsibleSection from './CollapsibleSection';

// Hardcoded owner user_id — same "one door" pattern hostaway_integration.py's
// get_user_id_for_hostaway_account() uses to gate the Hostaway integration to
// a single account. Used here purely for frontend visibility (hide the
// Developer section from everyone else); the /dev/token-usage endpoint
// itself is unchanged and still scopes data by the caller's own user_id.
const OWNER_USER_ID = 'fdedc7be-964b-4e75-b4a0-bd16cb6b05e7';

const APP_VERSION = '1.0.0';

function getInitials(displayName, email) {
  const name = displayName?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return '?';
}

export function SettingsModal({ onClose, onShowToast }) {
  useModalBehavior(onClose);
  const { t } = useTranslation();
  const [profile, setProfile] = useState(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Empty object = every section collapsed — the required default. Since
  // SettingsModal is mounted/unmounted by App.jsx (`{isSettingsOpen && ...}`,
  // not shown/hidden via an `isOpen` prop on an always-mounted instance),
  // this useState default already resets sections to all-closed on every
  // fresh open — no extra effect needed.
  const [openSections, setOpenSections] = useState({});
  const toggleSection = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  useEffect(() => {
    getProfile()
      .then(setProfile)
      .catch(err => console.error('Failed to load profile:', err))
      .finally(() => setProfileLoaded(true));
  }, []);

  const isOwner = profile?.id === OWNER_USER_ID;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 animate-fade-in flex items-end md:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-md bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-4 border-b border-[var(--border-subtle)] flex-shrink-0">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] flex-1">
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

        <div className="p-4 space-y-2 overflow-y-auto">
          <CollapsibleSection
            title={t('settings.my_profile')}
            isOpen={!!openSections.profile}
            onToggle={() => toggleSection('profile')}
          >
            <ProfileSection profile={profile} profileLoaded={profileLoaded} onProfileUpdate={setProfile} />
          </CollapsibleSection>

          <CollapsibleSection
            title={t('settings.notifications')}
            isOpen={!!openSections.notifications}
            onToggle={() => toggleSection('notifications')}
          >
            <NotificationsSection onShowToast={onShowToast} />
          </CollapsibleSection>

          <CollapsibleSection
            title={t('settings.calendar')}
            isOpen={!!openSections.calendar}
            onToggle={() => toggleSection('calendar')}
          >
            <CalendarConnectionView onShowToast={onShowToast} />
          </CollapsibleSection>

          <CollapsibleSection
            title={t('settings.language')}
            isOpen={!!openSections.language}
            onToggle={() => toggleSection('language')}
          >
            <LanguageSection />
          </CollapsibleSection>

          <CollapsibleSection
            title={t('settings.appearance')}
            isOpen={!!openSections.appearance}
            onToggle={() => toggleSection('appearance')}
          >
            <AppearanceSection />
          </CollapsibleSection>

          {isOwner && (
            <CollapsibleSection
              title={t('settings.developer')}
              isOpen={!!openSections.developer}
              onToggle={() => toggleSection('developer')}
            >
              <DeveloperUsageView />
            </CollapsibleSection>
          )}

          <CollapsibleSection
            title={t('settings.account')}
            isOpen={!!openSections.account}
            onToggle={() => toggleSection('account')}
          >
            <AccountSection />
          </CollapsibleSection>

          <CollapsibleSection
            title={t('settings.about')}
            isOpen={!!openSections.about}
            onToggle={() => toggleSection('about')}
          >
            <AboutSection />
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}

function ProfileSection({ profile, profileLoaded, onProfileUpdate }) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (profile) setNameInput(profile.display_name || '');
  }, [profile]);

  if (!profileLoaded) {
    return <p className="text-sm text-[var(--text-muted)]">{t('settings.loading')}</p>;
  }
  if (!profile) {
    return <p className="text-sm text-[var(--text-muted)]">{t('settings.load_failed')}</p>;
  }

  async function handleSave() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setIsSaving(true);
    try {
      const updated = await updateProfile(trimmed);
      onProfileUpdate(updated);
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to update profile:', err);
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancelEdit() {
    setNameInput(profile.display_name || '');
    setIsEditing(false);
  }

  const initials = getInitials(profile.display_name, profile.email);

  return (
    <div className="flex items-center gap-4">
      <div
        className="w-14 h-14 rounded-full bg-[var(--brand-primary)] text-white flex items-center justify-center text-lg font-semibold flex-shrink-0"
        aria-hidden="true"
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={t('settings.name_placeholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') handleCancelEdit();
              }}
              className="w-full min-w-0 px-2 py-1 rounded-md border border-[var(--border-medium)] text-sm font-medium text-[var(--text-primary)] bg-[var(--bg-input)] focus:outline-none focus:border-[var(--border-focus)]"
            />
            <button
              onClick={handleSave}
              disabled={isSaving || !nameInput.trim()}
              className="text-xs px-2 py-1.5 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white font-medium disabled:opacity-50 flex-shrink-0"
            >
              {isSaving ? t('actions.saving') : t('settings.save')}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold text-[var(--text-primary)] truncate">
              {profile.display_name || profile.email}
            </p>
            <button
              onClick={() => setIsEditing(true)}
              aria-label={t('settings.edit_name')}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] flex-shrink-0 p-1"
            >
              <PencilIcon className="w-4 h-4" />
            </button>
          </div>
        )}
        <p className="text-sm text-[var(--text-muted)] truncate mt-0.5">{profile.email}</p>
      </div>
    </div>
  );
}

function NotificationsSection({ onShowToast }) {
  const { t } = useTranslation();
  const [permission, setPermission] = useState(getNotificationPermission());
  const [isRequesting, setIsRequesting] = useState(false);

  // No local copy of the settings, and no local defaults to fall back on. Both
  // used to exist here and were half of the pair that silently reverted each
  // other's writes — see useAppSettings.jsx.
  const { settings, updateSettings } = useAppSettings();
  const settingsLoaded = settings !== null;

  const supported = isNotificationSupported();

  useEffect(() => {
    if (permission === 'granted') {
      subscribeToPush()
        .then(sub => sub && registerPushSubscription(sub))
        .catch(err => console.error('Push subscription failed:', err));
    }
  }, [permission]);

  async function handleRequestPermission() {
    setIsRequesting(true);
    const result = await requestNotificationPermission();
    setPermission(result);
    setIsRequesting(false);
  }

  // One handler for all three, because they only ever differed in which field
  // they wrote. The store does the optimistic update and the revert; all that
  // is left here is telling the user when it failed, which is the part the
  // three copies used to skip.
  async function applyChange(patch) {
    try {
      await updateSettings(patch);
    } catch (err) {
      console.error('Failed to update settings:', err);
      onShowToast('errors.failed_update', 'error');
    }
  }

  const handleToggle = (field) => applyChange({ [field]: !settings[field] });
  const handleModeChange = (mode) => applyChange({ daily_summary_mode: mode });
  const handleTimeChange = (time) => applyChange({ daily_summary_time: time });

  return (
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

          <div className="pt-4 border-t border-[var(--border-subtle)]">
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
  );
}

function CalendarConnectionView({ onShowToast }) {
  const { t } = useTranslation();
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);

  // This view used to keep its own copy of app settings, with a comment
  // claiming the untouched fields "just ride along unchanged". They did not:
  // they rode along as they were AT MOUNT, so a PATCH from here overwrote
  // whatever the Notifications section had changed in the meantime. Both now
  // read and write the same object — see useAppSettings.jsx.
  const { settings, updateSettings } = useAppSettings();

  // Fires automatically on mount (no button needed) — this is what makes
  // "Connected" show immediately whenever the user opens the Settings modal.
  useEffect(() => {
    getCalendarStatus()
      .then(s => setCalendarConnected(s.connected))
      .catch(err => console.error('Failed to load calendar status:', err))
      .finally(() => setStatusLoaded(true));
  }, []);

  async function applyChange(patch) {
    try {
      await updateSettings(patch);
    } catch (err) {
      console.error('Failed to update settings:', err);
      onShowToast('errors.failed_update', 'error');
    }
  }

  const handleToggleSyncAll = () =>
    applyChange({ calendar_sync_all_enabled: !settings.calendar_sync_all_enabled });
  const handleToggleShowEvents = () =>
    applyChange({ calendar_show_events: !settings.calendar_show_events });

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
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {t('calendar.show_events')}
              </span>
              <button
                onClick={handleToggleShowEvents}
                disabled={!settings}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  settings?.calendar_show_events ? 'bg-[var(--brand-primary)]' : 'bg-[var(--border-subtle)]'
                }`}
                aria-label={t('calendar.show_events')}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    settings?.calendar_show_events ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {t('calendar.show_events_description')}
            </p>
          </div>

          <div className="pt-3 border-t border-[var(--border-subtle)]">
            <button
              onClick={handleDisconnectCalendar}
              className="w-full text-left px-3 py-2 rounded-md hover:bg-[var(--bg-hover)] text-[var(--danger)] text-sm"
            >
              {t('calendar.disconnect')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LanguageSection() {
  const { i18n } = useTranslation();
  const currentLang = i18n.resolvedLanguage?.startsWith('el') ? 'el' : 'en';

  function handleChange(lang) {
    i18n.changeLanguage(lang);
    localStorage.setItem('app_language', lang);
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={() => handleChange('en')}
        className={`flex-1 px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
          currentLang === 'en'
            ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
            : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
        }`}
      >
        English
      </button>
      <button
        onClick={() => handleChange('el')}
        className={`flex-1 px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
          currentLang === 'el'
            ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
            : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
        }`}
      >
        Ελληνικά
      </button>
    </div>
  );
}

// Three options rather than an on/off switch. A two-state toggle has to start
// somewhere, and whichever side it starts on silently becomes a CHOICE the
// moment the user's phone switches at sunset and the app does not follow.
// "System" is the one answer a boolean cannot express, and it is the default.
function AppearanceSection() {
  const { t } = useTranslation();
  const [theme, setThemeState] = useState(getStoredTheme);

  function handleChange(next) {
    setTheme(next);       // writes localStorage + <html data-theme>
    setThemeState(next);  // only so this row re-renders its selection
  }

  const options = [
    { value: 'system', label: t('settings.theme_system') },
    { value: 'light', label: t('settings.theme_light') },
    { value: 'dark', label: t('settings.theme_dark') },
  ];

  return (
    <div>
      <div className="flex gap-2">
        {options.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => handleChange(value)}
            aria-pressed={theme === value}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
              theme === value
                ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--text-muted)] mt-2">
        {t('settings.theme_description')}
      </p>
    </div>
  );
}

function AccountSection() {
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDeleteAccount() {
    const confirmed = window.confirm(t('settings.delete_confirm'));
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await deleteAccount();
      // The account (and all its data) is gone server-side — sign out
      // locally so App.jsx's session listener drops back to the login
      // screen. onClose is unnecessary: App.jsx stops rendering the
      // Settings modal's parent tree entirely once session becomes null.
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Failed to delete account:', err);
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={() => supabase.auth.signOut()}
        className="w-full text-left px-3 py-2.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium text-sm"
      >
        {t('settings.sign_out')}
      </button>

      <div className="pt-2 mt-1 border-t border-[var(--border-subtle)]">
        <button
          onClick={handleDeleteAccount}
          disabled={isDeleting}
          className="w-full text-left px-3 py-2.5 rounded-md hover:bg-[var(--danger-bg)] text-[var(--danger)] font-medium text-sm disabled:opacity-50"
        >
          {isDeleting ? t('settings.deleting') : t('settings.delete_account')}
        </button>
      </div>
    </div>
  );
}

function AboutSection() {
  const { t } = useTranslation();
  return (
    <div className="text-sm space-y-1">
      <p className="font-semibold text-[var(--text-primary)]">{t('app.title')}</p>
      <p className="text-[var(--text-secondary)]">{t('settings.version')} {APP_VERSION}</p>
      <p className="text-xs text-[var(--text-muted)]">{t('settings.about_tagline')}</p>
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
        <div className="bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-md p-3">
          <div className="text-xs text-[var(--text-muted)] uppercase">{t('settings.today')}</div>
          <div className="text-lg font-semibold text-[var(--text-primary)] mt-1">{usage.today.total_tokens.toLocaleString()} tok</div>
          <div className="text-xs text-[var(--text-secondary)]">${usage.today.estimated_cost_usd.toFixed(4)} • {usage.today.call_count} calls</div>
        </div>
        <div className="bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-md p-3">
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

function PencilIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export default SettingsModal;
