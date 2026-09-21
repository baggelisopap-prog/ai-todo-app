import { useTranslation } from 'react-i18next';
import { TABS } from './navTabs';

/**
 * The phone's navigation: four tabs across the bottom.
 *
 * Rendered only below 1024px — above that App swaps in SideNav, which reads
 * the same TABS. The icons and the tab list used to live in this file; they
 * moved to icons.jsx and navTabs.js when the second navigation needed them.
 *
 * NOT pinned to the bottom itself any more. AskBar now sits directly on top of
 * it, and App wraps the pair in one fixed dock — so this is the dock's lower
 * floor and takes its position from it. The alternative was leaving this fixed
 * and pinning AskBar "62px up", a number that depends on this file's fonts and
 * label heights and would have broken silently the first time either changed.
 */
function BottomNav({ activeTab, onTabChange, inboxCount = 0 }) {
  const { t } = useTranslation();

  return (
    // pb-safe: on a phone with a home indicator the nav is still the
    // bottom-most element on screen, so without the inset its labels sit
    // underneath it. It stays here rather than moving up to the dock, because
    // this is the element actually touching the bottom edge.
    <nav className="bg-[var(--bg-card)] border-t border-[var(--border-subtle)] shadow-[0_-1px_3px_rgba(0,0,0,0.03)] pb-safe">
      <div className="flex justify-around max-w-3xl mx-auto">
        {TABS.map(({ id, labelKey, Icon }) => {
          const isActive = activeTab === id;
          // Tasks awaiting approval were invisible until you happened to visit
          // the tab that holds them — the one place the count could not help.
          const badge = id === 'inbox' && inboxCount > 0 ? inboxCount : null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              className={`flex-1 flex flex-col items-center py-3 transition-colors min-h-[56px] ${
                isActive ? 'text-[var(--brand-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              aria-pressed={isActive}
              // The count goes in the accessible name rather than into the
              // visible label: appending "(3)" to "Εισερχόμενα" would put the
              // truncation straight back that removing the fifth tab removed.
              aria-label={badge ? t('nav.inbox_pending', { count: badge }) : undefined}
            >
              <span className="relative">
                <Icon />
                {badge && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-1.5 -right-2 min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-[var(--brand-primary)] text-[var(--text-inverse)] text-[0.65rem] font-semibold leading-[1.15rem] text-center"
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              <span className="text-xs mt-1 truncate max-w-full px-0.5">{t(labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default BottomNav;
