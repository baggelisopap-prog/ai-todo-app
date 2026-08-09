import { useTranslation } from 'react-i18next';

function InboxIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </svg>
  );
}

function TodayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="12" y1="14" x2="12" y2="18" />
      <line x1="10" y1="16" x2="14" y2="16" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="7.5" y1="14" x2="7.5" y2="14" />
      <line x1="12" y1="14" x2="12" y2="14" />
      <line x1="16.5" y1="14" x2="16.5" y2="14" />
      <line x1="7.5" y1="17.5" x2="7.5" y2="17.5" />
      <line x1="12" y1="17.5" x2="12" y2="17.5" />
    </svg>
  );
}

function BrowseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

// Four, not five. "Upcoming" moved inside Calendar as its List mode — the two
// answered the same question with two tabs (see UpcomingList.jsx) — and the
// fifth tab was costing more than it looked like: at a fifth of a phone screen,
// `truncate` was silently clipping the Greek "Εισερχόμενα" to something like
// "Εισερχό…". The usual fix at five tabs is to drop labels for inactive ones;
// this app is going to people who did not build it, so unlabelled icons are the
// wrong trade. Removing a tab is what buys the labels their room.
const TABS = [
  { id: 'inbox', labelKey: 'nav.inbox', Icon: InboxIcon },
  { id: 'today', labelKey: 'nav.today', Icon: TodayIcon },
  { id: 'calendar', labelKey: 'nav.calendar', Icon: CalendarIcon },
  { id: 'browse', labelKey: 'nav.browse', Icon: BrowseIcon },
];

function BottomNav({ activeTab, onTabChange, inboxCount = 0 }) {
  const { t } = useTranslation();

  return (
    // pb-safe: on a phone with a home indicator the nav is the bottom-most
    // element on screen, so without the inset its labels sit underneath it.
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--bg-card)] border-t border-[var(--border-subtle)] shadow-[0_-1px_3px_rgba(0,0,0,0.03)] pb-safe">
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
