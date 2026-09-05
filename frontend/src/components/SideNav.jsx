import { useTranslation } from 'react-i18next';
import { TABS } from './navTabs';
import { GearIcon } from './icons';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { UNFILED } from '../utils/workspaces';
import { getInitials } from '../utils/profile';

/**
 * The desktop navigation: a fixed column down the left, from 1024px up.
 *
 * It exists because a bottom bar is a phone's answer. On a wide screen the
 * horizontal room is the cheap resource and the vertical room is the scarce
 * one, so the navigation moves to the side and stops competing with the task
 * list for height. Three things that cost height on the phone come with it
 * and give that height back: the workspace chips, the settings avatar, and
 * the floating add button.
 *
 * It renders NOTHING the phone does not already have. Every control here
 * calls the same handler its phone counterpart calls — the tabs call
 * onTabChange, the workspace rows call setActiveId, the avatar opens the same
 * settings modal. This is a second arrangement of one app, not a second app.
 *
 * `children` is the add-task control, passed in rather than built here:
 * FloatingActionButtons owns the microphone and the two file pickers, and
 * this component has no business knowing about them.
 */
function SideNav({ activeTab, onTabChange, inboxCount = 0, profile, onOpenSettings, children }) {
  const { t } = useTranslation();
  const { workspaces, activeId, setActiveId } = useWorkspaces();

  // Same rule as WorkspaceBar: below two workspaces the switcher is a control
  // that cannot do anything, so it is not drawn at all.
  const showWorkspaces = workspaces.length >= 2;
  const workspaceRows = showWorkspaces
    ? [
        { record_id: null, name: t('workspace.all'), color: null },
        ...workspaces,
        { record_id: UNFILED, name: t('workspace.unfiled'), color: null },
      ]
    : [];

  return (
    // self-start with h-screen: without it the flex row stretches this column
    // to the height of the whole document and `sticky` has nothing to stick
    // inside. top-0 keeps it in place while the task list scrolls past it.
    <aside className="w-64 flex-shrink-0 self-start sticky top-0 h-screen flex flex-col bg-[var(--bg-card)] border-r border-[var(--border-subtle)]">
      {/* h-14 matches AppBar's height on the right, so the two tops line up.
          The product name is not translated — it is the same string that
          index.html carries in its title. */}
      <div className="h-14 flex-shrink-0 flex items-center px-4 border-b border-[var(--border-subtle)]">
        <span className="text-base font-semibold text-[var(--text-primary)]">AI To-Do</span>
      </div>

      <div className="p-3 flex-shrink-0">{children}</div>

      <div className="flex-1 overflow-y-auto pb-3">
        <nav className="px-3 space-y-0.5" aria-label={t('nav.label')}>
          {TABS.map(({ id, labelKey, Icon }) => {
            const isActive = activeTab === id;
            const badge = id === 'inbox' && inboxCount > 0 ? inboxCount : null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onTabChange(id)}
                aria-current={isActive ? 'page' : undefined}
                // Same reasoning as BottomNav: the number beside the label is
                // decoration, so the accessible name has to say what it counts.
                aria-label={badge ? t('nav.inbox_pending', { count: badge }) : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--bg-hover)] text-[var(--brand-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span className="flex-1 min-w-0 text-left truncate">{t(labelKey)}</span>
                {badge && (
                  <span
                    aria-hidden="true"
                    className="flex-shrink-0 min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-[var(--brand-primary)] text-[var(--text-inverse)] text-[0.65rem] font-semibold leading-[1.15rem] text-center"
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {showWorkspaces && (
          <div className="mt-6 px-3">
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {t('nav.workspaces')}
            </p>
            <div
              className="space-y-0.5"
              role="tablist"
              aria-orientation="vertical"
              aria-label={t('workspace.label')}
            >
              {workspaceRows.map((workspace) => {
                const selected = activeId === workspace.record_id;
                return (
                  <button
                    key={workspace.record_id || 'all'}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveId(workspace.record_id)}
                    className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-colors ${
                      selected
                        ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {/* The colour is per-workspace DATA, so it cannot be a
                        Tailwind class: those are compiled ahead of time and a
                        runtime hex has no class to match. The two synthetic
                        rows have no colour of their own, so they get a hollow
                        ring instead of a filled dot. */}
                    <span
                      aria-hidden="true"
                      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        workspace.color ? '' : 'border border-[var(--border-medium)]'
                      }`}
                      style={workspace.color ? { backgroundColor: workspace.color } : undefined}
                    />
                    <span className="flex-1 min-w-0 text-left truncate">{workspace.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-[var(--border-subtle)] p-3">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={t('settings.open')}
          className="tap-44 w-full flex items-center gap-3 px-2 py-2 rounded-md text-left hover:bg-[var(--bg-hover)] transition-colors"
        >
          <span className="w-8 h-8 rounded-full bg-[var(--brand-primary)] text-[var(--text-inverse)] text-xs font-semibold flex items-center justify-center flex-shrink-0">
            {profile ? getInitials(profile.display_name, profile.email) : <GearIcon className="w-4 h-4" />}
          </span>
          <span className="flex-1 min-w-0 truncate text-sm text-[var(--text-primary)]">
            {profile?.display_name || profile?.email || t('settings.title')}
          </span>
          <GearIcon className="w-4 h-4 flex-shrink-0 text-[var(--text-secondary)]" />
        </button>
      </div>
    </aside>
  );
}

export default SideNav;
