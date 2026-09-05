ACTIVE TASK — A desktop and tablet shell: the bottom tabs become a left sidebar at 1024px
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## What was asked
"θελω να φτιαξουμε ενα ξεχωριστό ui στον υπολογιστή όταν ανοίγη η εφαρμογή. το φαντάζομαι αντι να ειναι κάτω σε pills να ειναι αριστερα όπως τα dashboards. να μην αλλάκει όμως τίποτα απο την λειτουργεία και μονο για pc και tablets" (2026-09-05)

Designed in chat, not as a spec file — a shell around four unchanged screens did not earn a document. The reasoning went to `docs/DECISIONS.md`.

Three of the four decisions were the owner's; on two of them he asked for research first ("κανε ερευνα τι παιζει καλυτερα και προτεινε μου") and took the recommendation:
1. **Breakpoint 1024px** — his choice, from three offered. Tablet upright keeps the phone's bottom nav.
2. **What the sidebar carries** — recommended from what this class of app does: Todoist's sidebar is add-button → fixed views → projects, and his workspaces are that list. So the chip row moves in. The agent stays in the top bar: an action, not a location.
3. **Content width** — lists keep `max-w-3xl` (768px, already inside the 680–780px reading measure); Calendar alone widens, because a month grid is a table and the cap only shrinks its cells.
4. **The add button** — his words were "βάλτο για αρχη όπου θέλεις", so: a full "Νέα εργασία" button at the top of the sidebar, same three choices in a dropdown.

## Where this stands
**Written and committed. Not yet pushed** — the owner pushes.

Nothing in `frontend/src/components/{Inbox,Today,Calendar,Browse}View.jsx` changed except one width class in Calendar. No backend file was touched at all.

**New:** `components/SideNav.jsx`, `components/navTabs.js`, `hooks/useMediaQuery.js`, `utils/profile.js`.
**Changed:** `App.jsx` (the layout branch), `AppBar.jsx` (`showProfile`, `wide`), `BottomNav.jsx` (reads the shared TABS), `FloatingActionButtons.jsx` (a `variant`), `CalendarView.jsx` (one line), both locale files (three keys), `scripts/ui-check.mjs` (follows TABS to its new file).

**Baselines as of 2026-09-05:** frontend `npm run check` → exit 0, `ui-check: OK — 71 files, 47 tokens, 416 translation keys`. `npm run lint` → **12 problems, the unchanged long-standing baseline** (it went to 13 mid-pass from a setState-in-effect in the first version of `useMediaQuery`; rewritten on `useSyncExternalStore` and back to 12). `npx vite build` clean. Backend untouched, so its 328-test baseline was not re-run.

## What a person has actually seen, and what nobody has
**Seen, and it counts as evidence:**
- [x] **The desktop layout, running, logged in, against live data** — the owner ran it locally and reported it working ("εχω μπει και ολα καλα").
- [x] **The session's backend log corroborates what he touched.** 297 tasks served; `GET /workspaces`, `/recurrences`, `/settings`, `/profile`, `/tasks`, `/calendar/events` all 200; a **weekly-range** `GET /calendar/events?start=…&end=…` (so he reached Calendar and changed its mode through the new sidebar) and a **`PATCH /settings`** (so he used the sidebar's workspace switcher and it wrote through). **Zero 4xx or 5xx in the whole session.**

**Still unseen:**
- [ ] **Dictation and photo from the desktop button.** The dropdown is new geometry over old machinery; only the "Κείμενο" path is implied by anything observed, and even that is inference, not sight.
- [ ] **A screenshot of either layout.** None exists. The browser tab available to the assistant does not share the owner's login, so it never got past the sign-in screen — the visual record is his eyes. Worth knowing for next time: driving this app through that tab needs a session in that tab.
- [ ] **The phone, after this change.** The code path below 1024px is byte-identical in the diff and the checks pass, but nobody has opened the app on a phone since.
- [ ] **A tablet, either way up.** 1024px is exactly the line iPads sit on; which side a given tablet lands on has not been watched.
- [ ] **The installed PWA on a desktop.** It will get the sidebar, which is intended, but has not been opened.

## Two things to know if this is picked up cold
**The navigation is one list in two shapes.** `components/navTabs.js` holds `TABS`; `BottomNav` and `SideNav` both read it, so a fifth tab or a renamed one can never appear in one and not the other. `scripts/ui-check.mjs` parses that file (it used to parse `BottomNav.jsx`) and still enforces the bottom nav's budget: four tabs, twelve characters.

**Only one navigation is mounted at a time.** `App` branches on `useMediaQuery(DESKTOP_QUERY)` rather than hiding one with CSS, because `FloatingActionButtons` mounts a microphone and two file inputs, and two live copies of that on every screen is a real cost. If you ever make this CSS-only, that is the thing you are paying.
