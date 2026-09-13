import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalBehavior } from '../hooks/useModalBehavior';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useConfirm } from '../hooks/useConfirm';
import { useMediaQuery, DESKTOP_QUERY } from '../hooks/useMediaQuery';
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
  testCalendarConnection,
  disconnectGoogleCalendar,
  getHostawayStatus,
  connectHostaway,
  updateHostawaySwitches,
  disconnectHostaway,
  updateProfile,
  deleteAccount,
} from '../api';
import { supabase } from '../supabaseClient';
import { getStoredTheme, setTheme } from '../utils/theme';
import {
  DICTATION_LANGS,
  resolveDictationLang,
  setDictationLang,
  dictationLabelFor,
} from '../utils/dictationLang';
import { useAppSettings } from '../hooks/useAppSettings';
import SettingsRow, { SettingsGroup } from './SettingsRow';
import OptionSheet from './OptionSheet';
import RecurrencesView from './RecurrencesView';
import WorkspacesView from './WorkspacesView';
import WorkspaceDetail from './WorkspaceDetail';
import ConfirmDialog from './ConfirmDialog';

// Hardcoded owner user_id, used purely for frontend visibility: it hides the
// Developer section from everyone else. The /dev/token-usage endpoint still
// scopes data by the caller's own user_id, so this is not the gate.
//
// It used to be described as the same "one door" pattern as
// hostaway_integration.get_user_id_for_hostaway_account(). That function is
// gone — Hostaway is per-user now, resolved from hostaway_connections — and
// this constant is the last hardcoded user_id in the app.
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

const SCREENS = {
  profile: 'settings.my_profile',
  notifications: 'settings.notifications',
  appearance: 'settings.appearance_language',
  recurrences: 'recurrence.title',
  workspaces: 'workspace.manage',
  calendar: 'settings.calendar',
  hostaway: 'hostaway.title',
  developer: 'settings.developer',
};

// The left column on a wide screen, grouped. The groups are not decoration:
// they separate what is TRUE OF YOU (your name, your phone, your language)
// from what is true of the WORK (rooms, repeats) and from the outside services
// the app talks to. On a phone this grouping is carried by three separate
// cards; here it is carried by three headings, because a nav column has the
// vertical room to name them and a phone list does not.
const NAV_GROUPS = [
  { label: 'settings.group_account', items: ['notifications', 'appearance'] },
  { label: 'settings.group_work', items: ['workspaces', 'recurrences'] },
  { label: 'settings.group_connections', items: ['calendar', 'hostaway'] },
];

/**
 * Settings.
 *
 * This was eight accordions, every one of them closed on every open. A closed
 * accordion shows only its name, so finding anything cost an exploratory tap
 * and the current value of every setting was invisible until you opened its
 * section. Half of them held a single control: Language was two buttons,
 * Appearance three, About three lines of text.
 *
 * It is now a list of rows that state their own value, with sub-screens for the
 * sections that have enough content to deserve one. Three deliberate choices
 * inside that:
 *
 * - **Profile is a header, not a row.** It is who you are, not a setting, and
 *   it is the natural partner of the avatar in the app bar that opens this.
 * - **Language and Appearance did NOT get sub-screens on a phone.** A whole
 *   screen for a two-option choice is a tap in, a tap to choose and a tap back;
 *   the row already shows the value, so the screen would buy nothing. They open
 *   a small option sheet instead — see OptionSheet.jsx.
 * - **About stopped being a section.** A version string is a footer, not a door.
 *
 * Sign out and Delete account are isolated at the bottom, away from anything
 * you might tap while looking for something else.
 *
 * ── TWO SHAPES, ONE SET OF SCREENS ───────────────────────────────────────────
 *
 * From 1024px up this stops being a 448px window in the middle of a 1920px
 * screen and becomes a page: a nav column on the left, the section on the
 * right, which is what Notion, Slack and Linear all settled on and what the
 * rest of this app has already done since the SideNav shipped.
 *
 * **Only the CHROME branches.** Every section component below is rendered by
 * one `renderSection()` and does not know which shape it is inside — the
 * alternative was a second Settings screen, and the phone one would have been
 * the one that quietly fell behind. The branch is `useMediaQuery`, not CSS
 * classes, for the same reason App.jsx branches rather than hiding: two trees
 * rendered and one hidden would mount every section twice.
 *
 * The one thing the two shapes genuinely do not share is the root list. A
 * phone needs it — it is the menu you drill down from. A wide screen has the
 * nav column permanently on screen, so a root would be a page listing links to
 * the links already visible beside it. On desktop there is therefore no 'root':
 * the screen opens on Profile.
 */
export function SettingsModal({ onClose, onShowToast, profile, onProfileUpdate }) {
  useModalBehavior(onClose);
  const { t, i18n } = useTranslation();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  // 'root', one named screen, and — for workspaces alone — one level below that.
  //
  // CORRECTED: this comment used to read "'root' plus one level. Not a general
  // navigation stack: two screens deep is already more than this amount of
  // settings justifies." Workspaces went two deep anyway, and not because the
  // settings grew: ONE workspace holds three unrelated jobs (what it is called,
  // what categories are in it, who is in it), and flattening those into one card
  // is what put its people three taps away behind a disclosure.
  //
  // It is still not a general stack. Exactly one screen may have a child, the
  // child is identified by an id rather than by a name, and Back is two explicit
  // cases — because a real history would need handling to stop Back closing the
  // whole modal, which is the thing that comment was right about.
  const [screen, setScreen] = useState('root');
  const [openWorkspaceId, setOpenWorkspaceId] = useState(null);
  const [picker, setPicker] = useState(null); // 'language' | 'appearance' | null

  // Looked up rather than carried: the title below is this name, and a copy
  // taken when the row was tapped would still say «Business» after it was
  // renamed on the screen underneath.
  const { workspaces } = useWorkspaces();
  const openWorkspace = workspaces.find((w) => w.record_id === openWorkspaceId);

  // Stable, because WorkspaceDetail calls it from an effect when its workspace
  // disappears — a fresh function each render would make that effect re-run on
  // every render of this modal.
  const closeWorkspace = useCallback(() => setOpenWorkspaceId(null), []);

  // There is no 'root' on a wide screen, so a window resized from narrow to
  // wide while sitting on the root list would otherwise render nothing at all.
  const section = screen === 'root' ? 'profile' : screen;

  function openSection(name) {
    setOpenWorkspaceId(null);
    setScreen(name);
  }

  function handleBack() {
    if (openWorkspaceId) { setOpenWorkspaceId(null); return; }
    // A wide screen has nowhere to go back TO — the nav is already on screen —
    // so Back only ever exists there for the workspace level.
    if (!isDesktop) setScreen('root');
  }

  const isOwner = profile?.id === OWNER_USER_ID;

  const currentLang = i18n.resolvedLanguage?.startsWith('el') ? 'el' : 'en';
  const languageOptions = [
    { value: 'en', label: 'English' },
    { value: 'el', label: 'Ελληνικά' },
  ];

  const [theme, setThemeState] = useState(getStoredTheme);
  const themeOptions = [
    { value: 'system', label: t('settings.theme_system') },
    { value: 'light', label: t('settings.theme_light') },
    { value: 'dark', label: t('settings.theme_dark') },
  ];

  // Separate from the interface language on purpose: the language you read is
  // not necessarily the language you speak, and conflating them is what made
  // Greek dictation come back as English nonsense. See utils/dictationLang.js.
  const [dictationLang, setDictationLangState] = useState(() => resolveDictationLang(i18n.resolvedLanguage));
  const dictationOptions = DICTATION_LANGS.map(({ code, label }) => ({ value: code, label }));

  function handleDictationPick(code) {
    setDictationLang(code);
    setDictationLangState(code);
    setPicker(null);
  }

  function handleLanguagePick(lang) {
    i18n.changeLanguage(lang);
    localStorage.setItem('app_language', lang);
    setPicker(null);
  }

  function handleThemePick(next) {
    setTheme(next);       // writes localStorage + <html data-theme>
    setThemeState(next);  // only so this row re-renders its value
    setPicker(null);
  }

  // The three preference rows, built once and rendered in two places: inside
  // the phone's root list, and as the «Εμφάνιση & γλώσσα» section a wide screen
  // needs because it has no root list to put them on. Written twice, they would
  // drift — and this is exactly the shape that produced the eight accordions.
  const preferenceRows = (
    <SettingsGroup>
      <SettingsRow
        label={t('settings.language')}
        value={languageOptions.find(o => o.value === currentLang)?.label}
        onClick={() => setPicker('language')}
      />
      <SettingsRow
        label={t('settings.appearance')}
        value={themeOptions.find(o => o.value === theme)?.label}
        onClick={() => setPicker('appearance')}
      />
      <SettingsRow
        label={t('settings.dictation_language')}
        value={dictationLabelFor(dictationLang)}
        onClick={() => setPicker('dictation')}
      />
    </SettingsGroup>
  );

  const signOutGroup = (
    <SettingsGroup>
      <SettingsRow
        label={t('settings.sign_out')}
        onClick={() => supabase.auth.signOut()}
        showChevron={false}
      />
      <DeleteAccountRow t={t} />
    </SettingsGroup>
  );

  const versionLine = (
    <p className="text-center text-xs text-[var(--text-muted)] pt-1">
      {t('app.title')} · {t('settings.version')} {APP_VERSION}
    </p>
  );

  // ONE renderer for both shapes. Nothing below knows whether it is inside a
  // phone sheet or a desktop pane.
  function renderSection(name) {
    if (name === 'workspaces') {
      return openWorkspaceId ? (
        <WorkspaceDetail
          workspaceId={openWorkspaceId}
          onShowToast={onShowToast}
          onBack={closeWorkspace}
        />
      ) : (
        <WorkspacesView onShowToast={onShowToast} onOpen={setOpenWorkspaceId} />
      );
    }
    if (name === 'profile') return <ProfileSection profile={profile} onProfileUpdate={onProfileUpdate} />;
    if (name === 'notifications') return <NotificationsSection onShowToast={onShowToast} />;
    if (name === 'appearance') return preferenceRows;
    if (name === 'recurrences') return <RecurrencesView onShowToast={onShowToast} />;
    if (name === 'calendar') return <CalendarConnectionView onShowToast={onShowToast} />;
    if (name === 'hostaway') return <HostawayConnectionView onShowToast={onShowToast} />;
    if (name === 'developer') return <DeveloperUsageView />;
    return null;
  }

  const title = openWorkspace
    ? openWorkspace.name
    : isDesktop ? t(SCREENS[section])
      : screen === 'root' ? t('settings.title') : t(SCREENS[screen]);

  const pickers = (
    <>
      {picker === 'language' && (
        <OptionSheet
          title={t('settings.language')}
          options={languageOptions}
          value={currentLang}
          onPick={handleLanguagePick}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'appearance' && (
        <OptionSheet
          title={t('settings.appearance')}
          options={themeOptions}
          value={theme}
          onPick={handleThemePick}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'dictation' && (
        <OptionSheet
          title={t('settings.dictation_language')}
          options={dictationOptions}
          value={dictationLang}
          onPick={handleDictationPick}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );

  // ───────────────────────────────────────────────────────── wide screen
  if (isDesktop) {
    return (
      <div
        className="fixed inset-0 z-50 bg-black/40 animate-fade-in flex items-center justify-center p-6"
        onClick={onClose}
      >
        <div
          className="w-full max-w-5xl h-[85vh] bg-[var(--bg-modal)] rounded-xl shadow-[var(--shadow-modal)] overflow-hidden grid grid-cols-[240px_1fr]"
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={t('settings.title')}
        >
          <nav className="flex flex-col gap-4 overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--bg-app)] p-3">
            <ProfileHeader
              profile={profile}
              onClick={() => openSection('profile')}
              t={t}
              compact
              selected={section === 'profile'}
            />

            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="flex flex-col gap-0.5">
                <span className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {t(group.label)}
                </span>
                {group.items.map((name) => (
                  <NavItem
                    key={name}
                    label={t(SCREENS[name])}
                    selected={section === name}
                    onClick={() => openSection(name)}
                  />
                ))}
              </div>
            ))}

            {isOwner && (
              <div className="flex flex-col gap-0.5">
                <NavItem
                  label={t(SCREENS.developer)}
                  selected={section === 'developer'}
                  onClick={() => openSection('developer')}
                />
              </div>
            )}

            <div className="mt-auto flex flex-col gap-2 pt-2">
              {signOutGroup}
              {versionLine}
            </div>
          </nav>

          <div className="flex min-w-0 flex-col">
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] p-4">
              {openWorkspaceId && (
                <button
                  onClick={handleBack}
                  className="tap-44 text-xl leading-none text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  aria-label={t('settings.back')}
                >
                  ‹
                </button>
              )}
              <h2 className="flex-1 truncate text-lg font-semibold text-[var(--text-primary)]">
                {title}
              </h2>
              <button
                onClick={onClose}
                className="tap-44 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                aria-label={t('actions.close')}
              >
                ✕
              </button>
            </div>

            {/* The reading column stays 640px wide inside a pane that is
                wider. A settings form stretched across 900px makes every label
                and its value the length of the screen apart — the same measure
                rule the task lists already keep at 768px. */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-2xl">{renderSection(section)}</div>
            </div>
          </div>
        </div>

        {pickers}
      </div>
    );
  }

  // ───────────────────────────────────────────────────────────── phone
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 animate-fade-in flex items-end md:items-center justify-center md:p-4"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-md bg-[var(--bg-modal)] md:rounded-lg rounded-t-2xl shadow-[var(--shadow-modal)] max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center gap-2 p-4 border-b border-[var(--border-subtle)] flex-shrink-0">
          {screen !== 'root' && (
            <button
              onClick={handleBack}
              className="tap-44 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xl leading-none"
              aria-label={t('settings.back')}
            >
              ‹
            </button>
          )}
          <h2 className="text-lg font-semibold text-[var(--text-primary)] flex-1 truncate">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="tap-44 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label={t('actions.close')}
          >
            ✕
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          {screen === 'root' ? (
            <div className="space-y-4">
              <ProfileHeader profile={profile} onClick={() => openSection('profile')} t={t} />

              <SettingsGroup>
                <SettingsRow label={t('settings.notifications')} onClick={() => openSection('notifications')} />
                <SettingsRow label={t('recurrence.title')} onClick={() => openSection('recurrences')} />
                <SettingsRow label={t('workspace.manage')} onClick={() => openSection('workspaces')} />
                <SettingsRow label={t('settings.calendar')} onClick={() => openSection('calendar')} />
                <SettingsRow label={t('hostaway.title')} onClick={() => openSection('hostaway')} />
              </SettingsGroup>

              {preferenceRows}

              {isOwner && (
                <SettingsGroup>
                  <SettingsRow label={t('settings.developer')} onClick={() => openSection('developer')} />
                </SettingsGroup>
              )}

              {/* Its own group, at the bottom, away from anything you might be
                  reaching for. Deleting the account still sits behind a
                  confirmation on top of that. */}
              {signOutGroup}
              {versionLine}
            </div>
          ) : (
            renderSection(section)
          )}
        </div>
      </div>

      {pickers}
    </div>
  );
}

/**
 * One row in the desktop nav column.
 *
 * Selection is a filled row, not a coloured word: the column is scanned rather
 * than read, and a background says "you are here" from the corner of an eye
 * while a colour change has to be looked at. Same reasoning as the room pill,
 * and the same shape SideNav already uses for the active tab.
 */
function NavItem({ label, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      className={`w-full rounded-lg px-2 py-2 text-left text-sm transition-colors ${
        selected
          ? 'bg-[var(--bg-hover)] font-semibold text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      <span className="block truncate">{label}</span>
    </button>
  );
}

/**
 * Identity, not a setting — so it gets the avatar and the email rather than a
 * row with a chevron and a name. It is also the partner of the app bar's
 * avatar, which is what opened this modal.
 *
 * `compact` is the nav-column size, not a second component: it is the same
 * identity block the phone shows at the top of its root list, and splitting it
 * in two would be two places to change a name.
 */
function ProfileHeader({ profile, onClick, t, compact = false, selected = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      className={`w-full flex items-center rounded-lg border transition-colors text-left ${
        compact ? 'gap-2.5 p-2' : 'gap-4 p-4'
      } ${
        selected
          ? 'border-[var(--border-medium)] bg-[var(--bg-hover)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      <span
        className={`rounded-full bg-[var(--brand-primary)] text-white flex items-center justify-center font-semibold flex-shrink-0 ${
          compact ? 'w-9 h-9 text-sm' : 'w-12 h-12 text-base'
        }`}
        aria-hidden="true"
      >
        {getInitials(profile?.display_name, profile?.email)}
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block font-semibold text-[var(--text-primary)] truncate ${compact ? 'text-sm' : 'text-base'}`}>
          {profile?.display_name || profile?.email || t('settings.loading')}
        </span>
        <span className={`block text-[var(--text-muted)] truncate ${compact ? 'text-[11px]' : 'text-sm'}`}>
          {profile?.email}
        </span>
      </span>
    </button>
  );
}

function DeleteAccountRow({ t }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const confirm = useConfirm();

  async function handleDeleteAccount() {
    const ok = await confirm.ask({
      title: t('settings.delete_account_title'),
      body: t('settings.delete_confirm'),
      confirmLabel: t('settings.delete_account'),
    });
    if (!ok) return;
    setIsDeleting(true);
    try {
      await deleteAccount();
      // The account (and all its data) is gone server-side — sign out locally
      // so App.jsx's session listener drops back to the login screen.
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Failed to delete account:', err);
      setIsDeleting(false);
    }
  }

  return (
    <>
      <SettingsRow
        label={isDeleting ? t('settings.deleting') : t('settings.delete_account')}
        onClick={handleDeleteAccount}
        danger
        showChevron={false}
      />
      {/* Inside the group's divided list, which is why it is a fragment rather
          than a wrapper div: a div here would become a third "row" and take the
          divider that belongs between Sign out and this one. The dialog itself
          portals to body, so it renders nowhere near this markup. */}
      <ConfirmDialog request={confirm.request} onAnswer={confirm.onAnswer} />
    </>
  );
}

function ProfileSection({ profile, onProfileUpdate }) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (profile) setNameInput(profile.display_name || '');
  }, [profile]);

  // Null means either "still loading" or "the fetch failed" — App.jsx owns it
  // now and does not distinguish, because the two look the same from here and
  // the recovery is identical: reopen the app.
  if (!profile) {
    return <p className="text-sm text-[var(--text-muted)]">{t('settings.loading')}</p>;
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

function HostawayConnectionView({ onShowToast }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [manualUrl, setManualUrl] = useState(null);

  useEffect(() => {
    getHostawayStatus()
      .then(setStatus)
      .catch(err => console.error('Failed to load Hostaway status:', err));
  }, []);

  async function handleConnect() {
    setBusy(true);
    try {
      const result = await connectHostaway(accountId.trim(), apiKey.trim());
      setStatus(result);
      setApiKey('');
      if (!result.webhook_registered) setManualUrl(result.webhook_url);
    } catch (err) {
      // The toast says "check your details", which is the common case. The
      // log separates that from a network failure or a 500.
      console.error('Hostaway connect failed:', err);
      onShowToast?.(t('hostaway.invalid'));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(key) {
    const next = { [key]: !status[key] };
    setStatus({ ...status, ...next });          // optimistic
    try {
      setStatus(await updateHostawaySwitches(next));
    } catch (err) {
      console.error('Hostaway switch failed:', err);
      setStatus(await getHostawayStatus());     // put it back if the server said no
    }
  }

  async function handleDisconnect() {
    await disconnectHostaway();
    setStatus({ connected: false });
    setManualUrl(null);
  }

  if (!status) return null;

  if (!status.connected) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[var(--text-secondary)]">{t('hostaway.not_connected')}</p>
        <input
          value={accountId}
          onChange={e => setAccountId(e.target.value)}
          placeholder={t('hostaway.account_id')}
          inputMode="numeric"
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-2 text-sm"
        />
        <input
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={t('hostaway.api_key')}
          type="password"
          autoComplete="off"
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-2 text-sm"
        />
        <button
          onClick={handleConnect}
          disabled={busy || !accountId.trim() || !apiKey.trim()}
          className="w-full rounded-lg bg-[var(--brand-primary)] p-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? t('hostaway.connecting') : t('hostaway.connect')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-[var(--success)]">
        {t('hostaway.connected')} ✓ · {status.account_id}
      </p>

      {manualUrl && (
        <p className="text-xs text-[var(--text-secondary)] break-all">
          {t('hostaway.webhook_manual')} {manualUrl}
        </p>
      )}

      {['tasks_enabled', 'auto_close_enabled'].map(key => (
        <div key={key}>
          <div className="flex items-center justify-between">
            <span className="text-sm">{t(`hostaway.${key}`)}</span>
            <button
              onClick={() => handleToggle(key)}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                status[key] ? 'bg-[var(--brand-primary)]' : 'bg-[var(--border-subtle)]'
              }`}
              aria-label={t(`hostaway.${key}`)}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  status[key] ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {t(`hostaway.${key}_description`)}
          </p>
        </div>
      ))}

      <button onClick={handleDisconnect} className="text-sm text-[var(--danger)] underline">
        {t('hostaway.disconnect')}
      </button>
    </div>
  );
}

function CalendarConnectionView({ onShowToast }) {
  const { t } = useTranslation();
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  // 'checking' | 'ok' | 'broken'. Separate from calendarConnected on purpose:
  // that one only says a connection is STORED, which is a different fact from
  // the connection working. A refresh token Google has invalidated leaves the
  // row untouched, so the screen said "Connected" while every sync failed —
  // reported by the owner on 2026-08-26 and fixed by reconnecting, with
  // nothing anywhere having said what was wrong.
  const [health, setHealth] = useState('checking');
  const [calendarName, setCalendarName] = useState(null);

  // This view used to keep its own copy of app settings, with a comment
  // claiming the untouched fields "just ride along unchanged". They did not:
  // they rode along as they were AT MOUNT, so a PATCH from here overwrote
  // whatever the Notifications section had changed in the meantime. Both now
  // read and write the same object — see useAppSettings.jsx.
  const { settings, updateSettings } = useAppSettings();

  // Fires automatically on mount (no button needed) — this is what makes
  // "Connected" show immediately whenever the user opens the Settings modal.
  useEffect(() => {
    let cancelled = false;
    getCalendarStatus()
      .then(async (s) => {
        if (cancelled) return;
        setCalendarConnected(s.connected);
        if (!s.connected) return;
        // Only now ask Google itself. One API call, and only when a connection
        // is actually stored — /calendar/test has existed on the server since
        // Phase 1 with no caller anywhere in the app.
        try {
          const result = await testCalendarConnection();
          if (cancelled) return;
          setCalendarName(result.calendar_name || null);
          setHealth('ok');
        } catch {
          if (!cancelled) setHealth('broken');
        }
      })
      .catch(err => console.error('Failed to load calendar status:', err))
      .finally(() => { if (!cancelled) setStatusLoaded(true); });
    return () => { cancelled = true; };
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
          {health === 'checking' && (
            <p className="text-sm text-[var(--text-secondary)]">{t('calendar.checking')}</p>
          )}
          {health === 'ok' && (
            <div>
              <p className="text-sm text-[var(--success)] font-medium">{t('calendar.connected')} ✓</p>
              {calendarName && (
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {t('calendar.connected_as', { name: calendarName })}
                </p>
              )}
            </div>
          )}
          {health === 'broken' && (
            <div className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3">
              <p className="text-sm font-medium text-[var(--danger-text)]">
                {t('calendar.connection_broken')}
              </p>
              <p className="text-xs text-[var(--danger-text)] mt-1">
                {t('calendar.connection_broken_help')}
              </p>
            </div>
          )}

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
