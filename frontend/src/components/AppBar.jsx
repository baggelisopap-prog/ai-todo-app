import { useTranslation } from 'react-i18next';
import { GearIcon, ChatIcon } from './icons';
import { getInitials } from '../utils/profile';

/**
 * The app's top bar.
 *
 * Replaces two circular buttons that used to float over the content at
 * top-4 left-4 and top-4 right-4. Those cost more than they looked like they
 * did: every view had to render its own <h1> INSIDE its scrolling container to
 * avoid them, so the screen's title scrolled away as soon as you moved, and
 * <main> carried a pt-14 whose only job was to stop the circles covering those
 * headings. Both are gone with this.
 *
 * The title lives here now, so it stays put. Settings moved behind the avatar,
 * which is the conventional place to look for "your account" and gives the
 * Profile section a door of its own — a floating grey gear over a task list is
 * legible to the person who built it and to nobody else.
 */
/**
 * `showProfile` — false on the desktop layout, where the avatar has a better
 * home at the foot of SideNav and a second copy up here would be two doors to
 * one room.
 *
 * `wide` — the bar normally holds the same 768px column as the list beneath
 * it, so the title sits directly above its own content. Calendar is the one
 * screen that spreads across the whole window on a desktop, and a title
 * floating in the middle of a wide grid looks like a mistake, so the bar
 * follows whatever the screen below it does.
 */
function AppBar({ title, profile, onOpenAgent, onOpenSettings, showProfile = true, wide = false }) {
  const { t } = useTranslation();

  return (
    // sticky rather than fixed: it scrolls with the document's flow, so no
    // sibling needs a padding-top to compensate for it — which is exactly the
    // hack the floating buttons required.
    <header className="sticky top-0 z-30 bg-[var(--bg-card)] border-b border-[var(--border-subtle)]">
      <div className={`${wide ? 'max-w-none md:px-6' : 'max-w-3xl'} mx-auto flex items-center gap-2 px-4 h-14`}>
        <h1 className="flex-1 min-w-0 truncate text-lg font-semibold text-[var(--text-primary)]">
          {title}
        </h1>

        <button
          type="button"
          onClick={onOpenAgent}
          className="tap-44 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          aria-label={t('agent.open')}
        >
          <ChatIcon className="w-4 h-4" />
          {/* The label is the point, and it is not hidden at any width. This is
              the app's distinguishing feature and it spent its life as an
              unlabelled grey circle. The title beside it truncates instead. */}
          <span className="text-sm font-medium">{t('agent.short_label')}</span>
        </button>

        {showProfile && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="tap-44 w-9 h-9 rounded-full bg-[var(--brand-primary)] text-white text-sm font-semibold flex items-center justify-center flex-shrink-0 hover:bg-[var(--brand-primary-hover)] transition-colors"
            aria-label={t('settings.open')}
          >
            {profile ? (
              getInitials(profile.display_name, profile.email)
            ) : (
              <GearIcon className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    </header>
  );
}

export default AppBar;
