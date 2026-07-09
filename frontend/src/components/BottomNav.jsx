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

function UpcomingIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <polyline points="9 16 12 13 15 16" />
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

const TABS = [
  { id: 'inbox', labelKey: 'nav.inbox', Icon: InboxIcon },
  { id: 'today', labelKey: 'nav.today', Icon: TodayIcon },
  { id: 'upcoming', labelKey: 'nav.upcoming', Icon: UpcomingIcon },
  { id: 'browse', labelKey: 'nav.browse', Icon: BrowseIcon },
];

function BottomNav({ activeTab, onTabChange }) {
  const { t } = useTranslation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--bg-card)] border-t border-[var(--border-subtle)] shadow-[0_-1px_3px_rgba(0,0,0,0.03)]">
      <div className="flex justify-around max-w-3xl mx-auto">
        {TABS.map(({ id, labelKey, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              className={`flex-1 flex flex-col items-center py-3 transition-colors min-h-[56px] ${
                isActive ? 'text-[var(--brand-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              aria-pressed={isActive}
            >
              <Icon />
              <span className="text-xs mt-1">{t(labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default BottomNav;
