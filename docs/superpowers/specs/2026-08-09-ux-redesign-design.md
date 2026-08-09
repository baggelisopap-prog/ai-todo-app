# UX redesign — shell, task row, settings

**Date**: 2026-08-09 · **Status**: **all six phases implemented 2026-08-09**, not yet seen in a browser · **Scope**: frontend only

This is a design, not a plan. It states what should change and why. Each phase below is sized to become its own spec → plan → implementation cycle; **do not try to execute this document as one piece of work**. That decomposition is deliberate and is explained in §1.2.

Nothing here requires a backend change except Phase 0, which changes no endpoint — only who calls it.

> **Implementation log (2026-08-09).** Shipped as six commits, `UX 0/5` … `UX 5/5`. Two places where the code departs from what is written below, both marked inline where they occur:
>
> - **Phase 3 could not offer undo on delete.** Deletion is a hard delete; the section is corrected in place with the reasoning.
> - **Phase 4 gave Language and Appearance an option sheet rather than a sub-screen**, which §Phase 4 already anticipated and argued for.
>
> Four automated checks came out of the work and run in `npm run check`: the settings revert scenario (`settings-store.test.mjs`, which asserts the OLD model fails as well as the new one passing), Greek search folding (`search.test.mjs`), and two new `ui-check` rules — light/dark palette parity, and the bottom nav's tab count and label lengths. The nav rule was fault-injected both ways.
>
> **Everything below is still unverified in a running browser.** The build, the lint baseline and the checks all pass; nobody has looked at it.

---

## 1. Decisions taken before designing

### 1.1 The audience is other people, not only the owner
Confirmed 2026-08-09. Today the app has one real user and a hardcoded `OWNER_USER_ID`, but the intent is to put it in front of others.

This is the single most load-bearing decision in the document, because it settles arguments that would otherwise be matters of taste:

- **Icons need words.** A gear floating over the task list is legible to the person who built it and to nobody else.
- **Errors must be visible.** `console.error` is not a user interface.
- **Defaults must be safe**, because most people never open settings at all.
- **Density is not free.** The owner can read a six-element metadata row because he knows what the six elements are.

Where this document rejects an option, it is usually this that rejected it.

### 1.2 Depth: full navigation redesign
Three depths were offered — tidy-in-place, restructure the two painful surfaces, or redesign the navigation. The third was chosen over an explicit recommendation of the second.

The recommendation was not that the third is wrong; it was that it touches all five views at once. That objection is answered by decomposition rather than by scope reduction: six phases, each of which leaves the app shippable, in an order where each one removes an obstacle for the next. Phase 0 must be first for a correctness reason given below. The rest are ordered by how much they unblock, not by how visible they are.

### 1.3 The two surfaces the owner actually finds painful
Named directly: the **settings** (eight collapsed accordions) and the **task card** (loaded metadata row, and tapping it opens an edit form). Those became Phases 4 and 2. Everything else in this document earns its place either by being a correctness problem or by being in the way of those two.

---

## 2. What the research says

Five findings survived; the rest of what was read was generic.

**Reduce clutter without reducing capability** — Nielsen Norman Group's sixth guideline for complex applications: use *staged disclosure*, showing options only when they are relevant to the task. Its eighth is the companion: eliminate superfluous elements *so that* critical information stands out. Both matter here because the instinct when a screen is busy is to delete features; the guideline says to delete their permanent visibility instead.

**Never encode meaning in colour alone.** Task apps that handle priority well give it a second channel — a count of exclamation marks, a shape, a label — explicitly so that people with limited colour perception are not excluded. This app currently encodes priority as an 8px coloured dot and nothing else.

**Colour a date only when the date means something.** The pattern reported from task-manager design work is that dates become coloured only when overdue or approaching, specifically so they do not produce visual noise the rest of the time. This app colours no dates at all, which is the same failure from the other side: overdue is currently communicated only by which section a task sits in.

**A swipe gesture is never the only path to an action.** Accessible swipe design requires a visible, tappable equivalent (targets ≥48px), because swipe excludes users with motor impairments and assistive technology. Destructive swipes additionally need a confirmation message and an undo affordance, plus feedback that the gesture registered.

**Bottom navigation holds three to five destinations.** Beyond five, tap targets crowd. At four or five, the common convention is to drop labels for inactive tabs — a convention this design deliberately does not follow (§Phase 1).

---

## 3. What we have today

Verified by reading the source on 2026-08-09, not from memory. Split by kind, because these are not the same sort of problem and should not be fixed with the same urgency.

### 3.1 One correctness bug

**App settings exist in four independent copies, and the write is a whole-object overwrite.**

`getAppSettings()` is called from four places, each keeping its own `useState` copy:

| Caller | Reads |
| --- | --- |
| `TodayView.jsx:21` | `calendar_show_events` |
| `CalendarView.jsx:174` | `calendar_show_events` |
| `SettingsModal.jsx:276` (`NotificationsSection`) | the notification fields |
| `SettingsModal.jsx:504` (`CalendarConnectionView`) | the calendar fields |

`PATCH /settings` (`main.py:563`) accepts a full `AppSettings` body and writes all seven fields unconditionally. Both settings sections send `{...theirOwnCopy, changedField}`.

The two sections inside `SettingsModal` are mounted at the same time — `CollapsibleSection` hides collapsed content with a CSS class while keeping it mounted — so both fetch on open and both hold a snapshot from that moment. Therefore:

1. Turn **Notifications** off → `PATCH` with `notifications_enabled: false`. Server is correct.
2. Open **Google Calendar**, toggle **show events** → `PATCH` with that section's snapshot, in which `notifications_enabled` is still `true`.
3. Notifications are **silently back on**. Nothing in the UI reports it, and the section that shows the toggle is still displaying its own stale `false`.

The same shape applies in reverse. It requires only two toggles in one sitting, which is ordinary use of a settings screen.

This is why Phase 0 comes first. Phase 4 increases the number of components that write settings; shipping it on top of this bug makes the bug more frequent, not less.

### 3.2 A UI element that lies

In the collapsed card's metadata row, the reminder bell and the calendar-sync button render at `opacity-40` when the task lacks the field they need — no `due_time` for the bell, no `due_date` for calendar sync (`TaskCard.jsx:595-636`). Forty percent opacity is the universal signal for *disabled*. They are not disabled: they are fully clickable and respond with a toast explaining why they cannot work.

So the control's appearance states one thing and its behaviour states another. A user who believes the visual is not confused about the feature — they are confused about the interface.

### 3.3 Friction

- **Settings is eight collapsed doors.** Profile, Notifications, Calendar, Language, Appearance, Developer (owner-only), Account, About — all closed on every open, by design, so section state resets. A closed row shows only its name, so finding any setting costs at least one exploratory tap, and **the current value of every setting is invisible until you open its section**. Half the sections hold a single control: Language is two buttons, Appearance is three, About is three lines of text.
- **Settings failures are invisible.** Every `catch` in `SettingsModal.jsx` is `console.error`. On a failed write the optimistic toggle reverts and the user sees a switch move by itself with no explanation.
- **The card's metadata row carries six things**: date, category, Hostaway received-at, a "pending" flag, and two toggle buttons. Two of the six are controls living inside a row of information.
- **Tapping a task opens an edit form.** There is no read state. `TaskCard.jsx:702` onward is a form: name input, description textarea, two selects, date and time inputs, a checklist editor, the inline agent, Save/Cancel. The whole card is clickable, so an accidental tap lands in an editing context.
- **The checklist renders in full in the collapsed card.** A ten-item checklist produces a very tall row in a list.
- **Every view prints its own `<h1>` inside the scrolling container**, so the screen's title scrolls away. Two fixed circular buttons float over the content instead of sitting in a bar, and `App.jsx` carries a `pt-14` on `<main>` whose only purpose is to stop those buttons covering each view's heading.
- **Five bottom tabs, always icon + label, with `truncate`** (`BottomNav.jsx:95`). In Greek, `nav.inbox` is "Εισερχόμενα" — eleven characters at `text-xs` in a fifth of a phone screen. It clips silently.

### 3.4 A gap

**There is no text search anywhere in the app.** `BrowseView` offers category cards, four sort orders and two visibility toggles — no search field. The only way to find a task by name is to ask the AI agent, which spends a model call and a round trip on what is a substring match.

Meanwhile `App.jsx` already holds every task in memory, and the agent's own `search_tasks` proves the filtering logic is well understood. This is the cheapest large improvement available in the whole document.

### 3.5 What is already good, and should survive

Listed because a redesign that quietly discards these would be a regression:

- The **token layer**. 47 tokens, no hardcoded colours, light and dark asserted at parity by `ui-check.mjs`. Every phase below styles with tokens.
- The **FAB speed dial** — voice, text, photo. This is the app's identity and the pattern is correct.
- **Drag-and-drop rescheduling** in `CalendarView` (`@dnd-kit`, task chip onto a day). It works and it argues *for* merging Upcoming into Calendar rather than against.
- **Undo toasts** for agent edits. The pattern exists; Phase 3 reuses it rather than inventing one.
- `tap-44` / `tap-40` touch targets, safe-area helpers, `:focus-visible`, reduced-motion handling.

---

## 4. Principles for this redesign

1. **Staged disclosure over hiding.** A setting or control that is not relevant right now should be somewhere else, not greyed out where it is.
2. **Nothing is encoded in colour alone.**
3. **Colour means something or is absent.** A coloured date must mean overdue or today.
4. **Every gesture has a visible equivalent.**
5. **Destructive is reversible.** Red, plus undo, plus a message.
6. **The user sees failures.** No user-facing operation reports only to the console.
7. **A control's appearance matches its behaviour.** Nothing that looks disabled may be clickable.

---

## 5. The phases

### Phase 0 — One settings state, and visible failures
**Fixes**: §3.1, and the settings half of §3.3.

Lift app settings to a single owner in `App.jsx` — one fetch, one copy, one writer — and have the four current readers consume it. Writes send the one current object, so no stale snapshot can exist to overwrite with. Failed writes surface through the existing `Toast`, which already supports a `danger` variant.

*Why first*: Phase 4 multiplies the number of components that read and write settings. Doing it in the other order means building the new settings UI on a state model that is already known to lose data.

*Rejected*: passing settings down as props from `App.jsx` without a shared hook. It works for four callers and stops working at the sixth, which Phase 4 creates.

### Phase 1 — A real shell
**Fixes**: the header, tab and floating-button parts of §3.3.

- **An app bar.** View title on the left; on the right, the agent (icon plus label) and the user's avatar, which is where settings now lives. This removes both floating circles and the `pt-14` that exists only to dodge them, and it gives Profile a natural home — the avatar is the standard entry point to "your account".
- **Four tabs instead of five.** Upcoming folds into Calendar as a list/month switch: both answer "what is coming", and Calendar already has the rescheduling gesture. Result: Inbox, Today, Calendar, All.
- **Labels stay on all tabs.** This deliberately breaks the four-or-five-tab convention of icon-only inactive tabs (§2). Cryptic icons are precisely the failure mode §1.1 rules out. Going to four tabs is what buys the room for the labels to fit — at five, Greek already clips.
- **A count badge on Inbox.** Pending tasks are currently invisible until you visit the tab that holds them.

*Rejected*: a navigation drawer. It solves a problem this app does not have — it has four destinations, not nine — and would bury the agent one level deeper.

### Phase 2 — Task row, and a detail sheet
**Fixes**: §3.2, and the card parts of §3.3.

**The row** carries only what is true at a glance:
- completion circle (already a 44px target);
- **priority with a second channel** — the colour stays, and gains a form (`P1`/`P2`/`P3`), per §2;
- title, one line;
- a second line only when there is something to say: date — **coloured only when overdue or today** — category as a labelled chip, and checklist progress as `2/5`;
- reminder and calendar-sync appear as **status indicators only, never as buttons**. This is what fixes §3.2: an icon that is not a control cannot lie about being disabled.

**The detail sheet** opens on tap and **reads before it edits**: title, metadata, description, an interactive checklist, reminder and calendar sync as labelled rows with real switches, and the inline agent — which suits a read context, being natural language rather than a form. An explicit **Edit** reveals the fields; Save and Cancel exist only in edit mode.

*Why a sheet rather than the current expand-in-place*: expanding rewrites the list under the user's thumb and produces a card several hundred pixels tall inside a scrolling list. A sheet also has room for real labels, which the cramped card does not.

*Rejected*: keeping tap-to-edit and merely tidying the row. It is faster for the owner and wrong for everyone else — an accidental tap should never land in an editing context (§1.1).

### Phase 3 — Gestures
**Depends on**: Phase 2, since it acts on the row that phase defines.

Swipe right completes. Swipe left reveals Schedule and Delete. Per §2, and non-negotiably:

- **every one of these actions also lives in the `⋯` menu**, which is the accessible path and already exists;
- delete is red and never happens on the gesture alone;
- the gesture is hinted on first use.

`@dnd-kit` is confined to `CalendarView`, so its drag sensors cannot conflict with swipe in `TaskList`. Verify this when implementing rather than assuming it, since both listen to pointer events.

> **CORRECTED while implementing (2026-08-09).** This section originally said delete "always raises a toast with **undo**". That is not available: deletion here is a hard delete, and DECISIONS.md already records it as the one action with no undo, which is why the agent's delete path routes into the confirm dialog rather than the applied-with-undo flow every other agent edit uses. Promising undo would have meant either lying in the toast or reconstructing the task client-side under a new `record_id`, breaking its Google Calendar link. The safeguard is the existing confirmation instead, and the swipe was designed around the same limit: **swipe left does not act, it reveals a tray**. Reschedule and Delete each need a deliberate second tap, so a gesture can never destroy anything on its own. Swipe right does act immediately, because completing is reversible by the same circle that did it.
>
> Reschedule needed a destination that did not exist. It is a three-option sheet — today, tomorrow, next week — written straight to `due_date` with no model call. The inline agent already offers those three as chips, but each of those spends a request on arithmetic the browser does for free. Anything else still goes through the date field in the detail sheet.

### Phase 4 — Settings
**Fixes**: the rest of §3.3. **Depends on**: Phase 0.

- **Profile becomes a header row** at the top — avatar, name, email — tapping through to a profile screen.
- **Sub-screens** for Notifications and Google Calendar. These have enough content to deserve a screen, and pushing them out of the main list shortens it to something scannable.
- **Language and Appearance stay inline**, as rows showing their current value on the right: *Language › Ελληνικά*, *Appearance › Dark*. This is a **deliberate deviation** from "sub-screens everywhere": a sub-screen for a two-option choice is a tap tax, and showing the value on the row solves the actual complaint in §3.3 — that a closed row tells you nothing.
- **Destructive actions are isolated** at the bottom: sign out, then delete account in red behind a confirmation.
- **About stops being a section.** A version string is a footer, not a door.

*Rejected*: a search field within settings. Seven server-side settings plus language, theme, display name and the push permission — about a dozen controls across six rows — do not justify it, and it would be one more thing to translate and maintain.

### Phase 5 — Search
**Fixes**: §3.4.

An instant local filter over the tasks already in memory, in the "All" view: filter as you type, no backend call, no tokens, no round trip. Match against name and description.

It is last only because it is independent — it needs nothing from the other phases and blocks nothing. If the appetite for the redesign runs out partway, **this is the phase to pull forward**, because it is the largest gain per unit of work in this document.

---

## 6. Not doing, and why

- **Onboarding.** Justified by a second real user, not by the intention of one. The first-run gesture hint in Phase 3 is the exception, because a gesture with no visible affordance is undiscoverable by construction.
- **Manual drag-to-reorder in lists.** There is no ordering column in the schema; sorting is derived from date and priority. Adding one is a data-model change, not a UX change.
- **Search inside settings.** See Phase 4.
- **Any change to the AI agent, the capture flow, or the Calendar view's internals.** The FAB and the calendar drag-and-drop work; this document touches the shell around them.
- **New colour tokens.** The palette is complete and asserted at light/dark parity. Every phase styles from existing tokens.

---

## 7. Risks

- **Phase 2 is the risky one.** `TaskCard.jsx` is 1,137 lines and holds seventeen `useState` calls in one component, optimistic updates for completion and checklist items, two click-outside handlers, and the inline agent. Splitting read from edit means splitting that file. Expect the row, the detail sheet and the edit form to become separate components; treat that split as part of the phase, not as a follow-up.
- **`CalendarView.jsx` is 1,299 lines** and Phase 1 asks it to absorb Upcoming. If that lands badly, the fallback is to keep five tabs and cut the tab labels for inactive tabs instead — worse, per §1.1, but honest, and a smaller change.
- **Two locales.** Every phase adds keys to both `en.json` and `el.json`. `ui-check.mjs` already fails the build on drift, so this is a cost rather than a risk — but Greek strings are consistently longer than English ones, which is what broke the tab labels in the first place. Check layouts in Greek, not in English.
- **Nothing here has been seen in a browser.** The whole document is derived from reading source. Every phase needs looking at on a real phone before it is called done.

---

## 8. How we will know each phase worked

Not metrics — this app has one user and analytics would be theatre. Concrete checks instead:

- **Phase 0**: turn off notifications, then toggle a calendar setting, then reopen settings — notifications are still off. This is the reproduction from §3.1 and it must fail before the fix and pass after.
- **Phase 1**: at the narrowest supported width, in Greek, no tab label is clipped; no view's title scrolls out of sight.
- **Phase 2**: no element in the row is both dimmed and clickable. Tapping a task never puts the user in an editing state.
- **Phase 3**: every swipe action is reachable from the `⋯` menu; no gesture deletes anything without a second, deliberate tap; a mostly-vertical drag scrolls the page instead of moving the row.
- **Phase 4**: the current value of Language and Appearance is readable without opening anything; a failed write shows the user a message.
- **Phase 5**: typing part of a task name finds it without a network request.

The existing gates still apply to every phase: `npm run check` (undefined tokens, locale drift, hardcoded colours, light/dark palette parity, theme behaviour, modal scroll-lock), `npm run build`, `npm run lint`.

---

## Sources

- [8 Design Guidelines for Complex Applications — Nielsen Norman Group](https://www.nngroup.com/articles/complex-application-design/)
- [Designing swipe-to-delete and swipe-to-reveal interactions — LogRocket](https://blog.logrocket.com/ux-design/accessible-swipe-contextual-action-triggers/)
- [Bottom navigation — Material Design](https://m1.material.io/components/bottom-navigation.html)
- [UI/UX Case Study: Designing the Friendliest To-Do List App](https://medium.muz.li/designing-pocket-lists-18b6cafd1161) — source of the priority-not-by-colour-alone and colour-the-date-only-when-it-matters patterns
- [Progressive disclosure in UX design — LogRocket](https://blog.logrocket.com/ux-design/progressive-disclosure-ux-types-use-cases/)
