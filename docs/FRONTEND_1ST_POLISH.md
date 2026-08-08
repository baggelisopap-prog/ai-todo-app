# FRONTEND — 1st polish pass

_Plan and running log for the first deliberate UI pass over the app (2026-08-08). Written before any code changed, from a read of every component plus measured counts; updated as each item lands. One phase per commit, so any phase can be reverted on its own._

## Why this exists

The app was built feature-first: every screen works, and nothing here is a rewrite. But nothing had ever been reviewed *as a UI*, so the gaps are the ones that never block a feature — an app whose browser tab says "frontend", a 20-pixel tap target for the most-used action in the product, page titles sitting underneath the buttons that float over them, and one screen colouring Google events red while `index.css` explicitly documents them as cyan "so events never get confused for tasks".

Scope is **presentation and shell only**. No endpoint, no agent, no data shape, no business logic. If a change here alters what the app *does* rather than how it looks or feels, it does not belong in this pass.

## How the findings were established

Read every component under `frontend/src`, plus `index.css`, `index.html` and `package.json`. Where a claim is a measurement it was counted, not estimated:

- **25** hardcoded Tailwind colour utilities (`bg-red-50`, `text-green-600`, …) across **12** files — all of them error or success states. This is the only thing standing between the app and a dark mode, and it is small.
- **6** components hand-roll a `fixed inset-0` overlay. There is no shared modal.
- **1** component in the whole app has a `focus-visible` style (`CollapsibleSection`).
- **0** occurrences of `safe-area-inset` or `env(` anywhere, and no `viewport-fit=cover` — so the insets could not work even if they were used.
- **0** test dependencies. `package.json` has `dev`, `build`, `lint`, `preview` and nothing else.

**One correction to the review that preceded this doc.** It claimed `--brand-primary`, `--danger` and `--priority-p1` being the same red meant "the button that saves and the button that destroys look identical". They *are* the same hex, but destructive actions render as red **text in a menu** (`MenuItem … danger`), never as a red filled button, so there is no live confusion to fix. It is a latent trap for the first destructive button someone adds, not a defect today — demoted to Phase 6 accordingly.

**One finding I could not see with my own eyes.** The browser extension was not connected, so every item here comes from reading code. Item 1.5 (page titles under the floating buttons) is the one I would most want confirmed visually — the geometry is unambiguous, but it is surprising that it has gone unnoticed in daily use. The fix is correct regardless: content should not scroll underneath fixed buttons.

---

## Phase 1 — The app shell and its identity

### 1.1 The app is called "frontend"
`index.html` still carries Vite's scaffold title. That string is the browser tab, the bookmark, the share sheet, and the default name offered by "Add to Home Screen".
**Fix**: real title, plus `theme-color` and `viewport-fit=cover` (the latter is a prerequisite for 1.4 — safe-area insets are inert without it).
**Files**: `frontend/index.html`

### 1.2 There is no web app manifest
`public/` holds `favicon.svg`, `icons.svg` and `sw.js` — no manifest, and no `<link rel="manifest">`. The app therefore cannot install as a proper standalone app: no name, no icon set, no theme colour, no `display: standalone`. It also blocks the TWA/Bubblewrap packaging already parked in BACKLOG.md, which needs a valid manifest as its input.
**Fix**: add a manifest and link it.
**Plan changed once here.** The intention was to derive icons from the existing `favicon.svg` and introduce no new artwork. On opening that file it turned out to be **the Vite logo** — the scaffold default, never replaced. It is not only the browser favicon: `utils/notifications.js` and `sw.js` both pass it as the icon for web-push, so every reminder this app has ever sent showed Vite's logo, and a manifest would have made it the home-screen icon too. Shipping that as a business app's identity was not a defensible "no new artwork", so `favicon.svg` was replaced with a deliberately plain mark — a white checkmark on the app's own `--brand-primary` red, one shape, legible at 16px, with padding for Android's maskable crop. It is a placeholder for a real brand, not a brand.
**Known limitation**: the manifest ships SVG icons only (`sizes: "any"`). Modern Chrome accepts this for installability, but **TWA/Bubblewrap will need real 192px and 512px PNGs** — flagged for whoever picks up the Android packaging item in BACKLOG.md. No image library is installed here to generate them.
**Files**: `frontend/public/manifest.webmanifest`, `frontend/public/favicon.svg`, `frontend/index.html`

### 1.3 `<html lang>` never changes
Hardcoded `lang="en"` while the app ships a complete Greek translation and a language switcher. Wrong `lang` misleads screen readers and hyphenation.
**Fix**: set it from i18next on load and on every language change.
**Files**: `frontend/src/i18n.js` or `App.jsx`

### 1.4 Nothing accounts for the safe area
The bottom nav is `fixed bottom-0` with no inset padding, so on any phone with a home indicator the labels sit under it. The toast is pinned at `bottom-20` and can collide with the same strip.
**Fix**: `env(safe-area-inset-bottom)` on the nav, the toast and the floating buttons.
**Files**: `BottomNav.jsx`, `Toast.jsx`, `FloatingActionButtons.jsx`, `index.css`

### 1.5 Page titles sit underneath the floating buttons
The chat and settings buttons are `fixed top-4 {left,right}-4`, 40×40, so they occupy y:16→56. Every view opens with `<div class="max-w-3xl mx-auto p-4">` and no top offset, putting its `<h1>` at y:16→48, x:16. The buttons are opaque white with a shadow, so they cover the first ~40px of the title on all five screens. On a wide viewport `mx-auto` centres the container and the collision disappears, which is why this survives desktop use.
**Fix**: top padding on `<main>` sized to clear the buttons.
**Files**: `App.jsx`

---

## Phase 2 — Touch targets

The whole app is used on a phone. Apple asks for 44×44pt, Android for 48×48dp. The most important control in the product is currently 20×20.

### 2.1 The complete / approve circle is 20×20
`TaskCard`'s circle is `w-5 h-5`. It is the primary action of a to-do app and its smallest target — and because the entire card is clickable, a miss does not do nothing, it **expands the card**, which is a different and unwanted outcome.
**Fix**: keep the 20px ring as the visual, wrap it in a ≥44px hit area. Nothing about the design changes; only the region that accepts a thumb.

### 2.2 The bell and calendar toggles are ~24px
`w-4 h-4` icons with `p-1 -m-1`. Same treatment, same reasoning — and they sit in a row where a miss expands the card.

### 2.3 The chat and settings buttons are 40×40
Just under the threshold, and they are the only way into two whole surfaces.

**Files**: `TaskCard.jsx`, `App.jsx`, `index.css`

**How it was done**: an invisible centred `::after` (`.tap-44` / `.tap-40` in `index.css`) grows the region that accepts a thumb without changing anything visible. Padding or a larger box would have pushed every neighbouring element around; this leaves the layout untouched.
**One target could not reach 44.** The card's meta row is a `gap-3` (12px) flex row of date, category, bell and calendar. A 44px target on a 16px icon reaches 14px past it and would overlap its neighbour's target; 40px lands exactly on the gap. Getting that row to 44 across the board means redesigning it, which is more than polish — the bell and calendar got `.tap-40`, still a large improvement on the ~24px they had. The circle, which has room, got the full 44.

---

## Phase 3 — Modal behaviour

Six components hand-roll an overlay, so every behaviour a modal needs had to be remembered six times, and was not.

### 3.1 Escape closes one modal out of four
`AddTaskModal` handles it. `SettingsModal`, `AgentChatModal` and the calendar's day popup do not (`SettingsModal`'s only Escape handler cancels an inline field edit, not the modal).

### 3.2 No modal locks body scroll
Open Settings on a phone, scroll, and the list behind it moves instead.

**Fix**: one small shared hook — `useModalBehavior({ onClose })` — that wires Escape and the scroll lock, applied to each modal. Deliberately **not** a shared `<Modal>` component: the four modals have genuinely different chrome (full-screen sheet, centred dialog, chat column), and unifying their markup is a bigger, riskier change than the two behaviours they are actually missing. That refactor stays out of this pass.
**Files**: new `frontend/src/hooks/useModalBehavior.js`, then the four modals

---

## Phase 4 — Consistency

### 4.1 Google events are red in Today and cyan in Calendar
`index.css` defines `--calendar-event` cyan with a comment saying it is *deliberately* distinct from task colours "so events never get confused for tasks". `TodayView` then renders its event strip with `border-l-4 border-[var(--brand-primary)]` — the brand red used by task actions. One screen contradicts the documented decision of the other.
**Fix**: Today uses the event token.
**Files**: `TodayView.jsx`

### 4.2 Categories are untranslated on cards
The card prints `{task.category}` raw — "Business" — while the filter pills for the same concept read "Επαγγελματικά". Same thing, two names, in the same language.
**Fix**: reuse the existing `browse.filter_*` keys.
**Files**: `TaskCard.jsx`

### 4.3 The priority dot's label is untranslated
`aria-label={`Priority ${task.priority}`}` — hardcoded English in an otherwise fully translated app.
**Files**: `TaskCard.jsx`, both locales

### 4.4 Keyboard focus is invisible
One component in the app has a focus ring. Inputs get `focus:ring` from their own classes; buttons get nothing, so tabbing through is untrackable.
**Fix**: a single global `:focus-visible` rule in `index.css`. Global beats per-component here — it cannot be forgotten by the next button.
**Files**: `index.css`

---

## Phase 5 — Dark mode

The token layer is already the right shape; the palette is simply defined once. 25 hardcoded colour utilities are the only thing that would not follow a theme switch, and they are all error/success chrome.

### 5.1 Tokenise the remaining hardcoded colours
Add `--danger-bg/-border/-text` and `--success-bg/-border/-text`, and replace the 25 occurrences across the 12 files.

### 5.2 Add the dark palette
`@media (prefers-color-scheme: dark)` over the existing `:root` tokens. Follows the OS; no in-app toggle in this pass — a toggle needs a persisted setting and a Settings row, which is a feature, not polish.

### 5.3 Dark `theme-color`
So the phone's chrome matches.

**Files**: `index.css`, the 12 files from the count, `index.html`

---

## Phase 6 — Polish and latent traps

### 6.1 Toasts and modals appear instantly
No enter transition anywhere. A short fade/slide on the toast and a fade on modal backdrops.

### 6.2 Empty states are one line of italic text
Every empty view is `p-8 text-center text-sm italic`. Consistent, but it is the moment the app has the most room and says the least.

### 6.3 `--brand-primary` and `--danger` are the same hex
Not a live defect (see the correction at the top). Worth making the aliasing explicit so the first destructive filled button does not silently look like the primary one.

---

## Phase 7 — A check that can be re-run

There is no test framework, and adding one to assert CSS classes would cost more than it returns. What *is* worth automating is the set of invariants this pass establishes, each of which is a real mistake someone will otherwise make again:

- every `var(--…)` used in a component is actually defined in `index.css`
- `en.json` and `el.json` have identical key sets
- no hardcoded Tailwind colour utilities outside the token layer (guards Phase 5 from regressing)

**Fix**: `frontend/scripts/ui-check.mjs`, wired as `npm run check`. Plus `npm run build` and `npm run lint` after every phase.
**Files**: new script, `package.json`

**Built second, and it earned its place immediately.** Two things came out of writing it:
- It found a real bug on its first run: `LoginScreen.jsx` sets `bg-[var(--bg-page)]` **twice**, and `--bg-page` does not exist — the token is `--bg-app`. The class did nothing; the screen only looked right because `body` paints the same colour underneath. Exactly the silent failure rule 1 exists to catch, sitting in the first screen every user sees. Fixed.
- The hardcoded-colour count is **36**, not the 25 counted by hand for this doc. The manual `grep` had no `ring-` in its pattern and missed every `ring-blue-100` focus ring. The script's number is the real one.

**The colour rule is a ratchet, not an absolute.** 36 exist today, and a check that fails from the day it is added guards nothing — it gets ignored. So the count is capped at a baseline: a new hardcoded colour fails the build immediately, and when the count drops the script says so and asks for the baseline to be lowered. Phase 5 takes it to 0 and the ratchet becomes a plain rule.

Each rule was verified to actually fire by injecting a fault (`bg-pink-500`, a deleted `el.json` key, an invented `var()`) and confirming a non-zero exit — a check nobody has seen fail is not a check.

---

## Deliberately out of scope

- **A shared `<Modal>` component.** See 3.2 — the behaviours are worth sharing, the markup is not, yet.
- **An in-app dark mode toggle.** That is a setting, not polish.
- **New artwork or a rebrand.** Icons are derived from the existing favicon.
- **The `set-state-in-effect` lint warning** in `TaskCard`. Pre-existing, unrelated to presentation, and fixing it means touching the expand/draft logic that the task agent depends on.

---

## Progress

**Order changed**: Phase 7's checker is built SECOND, not last. Its whole point is to catch regressions in phases 4 and 5, which is worthless if it only exists after them.

| Phase | Status |
|---|---|
| 1 — Shell and identity | **done** — lint unchanged at 14 pre-existing, build clean |
| 7 — Re-runnable check | **done** — `npm run check` green; found a real undefined-token bug in LoginScreen |
| 2 — Touch targets | **done** — check/lint/build green |
| 3 — Modal behaviour | next |
| 4 — Consistency | not started |
| 5 — Dark mode | not started |
| 6 — Polish | not started |

**Verification after every phase**: `npm run lint`, `npm run build`, and from Phase 7 on, `npm run check`. Anything that needs a human eye is listed under the phase itself and collected at the end of this file as it accumulates.

## Needs a human eye

_Changes whose correctness a build cannot confirm._

**From Phase 1:**
- **The title/button overlap is actually gone.** Open any screen on a phone and check the heading is fully visible and not sitting under the chat icon. This is also the confirmation that the finding was real — if the headings looked fine before, `pt-14` has simply added empty space and should be reconsidered.
- **The new icon.** Tab favicon, and the icon on the next push notification the app sends.
- **Install the app** ("Add to Home Screen"). It should offer "AI To-Do", open without browser chrome, and show a red status bar.
- **The bottom nav on a phone with a home indicator** — labels should sit clear of it, and the toast should clear the nav.
