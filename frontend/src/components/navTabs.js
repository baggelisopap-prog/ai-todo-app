import { InboxIcon, TodayIcon, CalendarIcon, BrowseIcon } from './icons';

/**
 * The four screens, in order — the single source both navigations read.
 *
 * BottomNav renders them across the bottom of a phone; SideNav renders the
 * same four down the left of a desktop window. One list, so a fifth tab (or a
 * renamed one) can never appear in one place and not the other.
 *
 * Data, not a component, which is why it is here and not in BottomNav.jsx:
 * a module exporting a component may export nothing else without tripping
 * react-refresh. `scripts/ui-check.mjs` parses THIS file for the tab count
 * and label lengths.
 *
 * Four, not five. "Upcoming" moved inside Calendar as its List mode — the two
 * answered the same question with two tabs (see UpcomingList.jsx) — and the
 * fifth tab was costing more than it looked like: at a fifth of a phone screen,
 * `truncate` was silently clipping the Greek "Εισερχόμενα" to something like
 * "Εισερχό…". The usual fix at five tabs is to drop labels for inactive ones;
 * this app is going to people who did not build it, so unlabelled icons are the
 * wrong trade. Removing a tab is what buys the labels their room.
 */
export const TABS = [
  { id: 'inbox', labelKey: 'nav.inbox', Icon: InboxIcon },
  { id: 'today', labelKey: 'nav.today', Icon: TodayIcon },
  { id: 'calendar', labelKey: 'nav.calendar', Icon: CalendarIcon },
  { id: 'browse', labelKey: 'nav.browse', Icon: BrowseIcon },
];
