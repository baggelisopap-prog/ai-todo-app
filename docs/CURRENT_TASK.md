ACTIVE TASK — An added task lands in the Inbox, and says which one it is
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## What was asked
Two requests the same day (2026-09-05), the second raised after the first had shipped:

1. «οταν περνάω ένα καινουργιο τασκ απο το + και ειμαι στο ημερολογιο η στα σημερινα, θέλω να με πετάει στα aprove πάντα»
2. «θέλω τώρα επίσης το νέο τασκ κάπως να ξεχωρίζει για λίγο σαν να αναβοσβήνει… γιατι ερχεται και μεχρι να διαβασω ποιο ειναι χανω λίγο χρόνο»

Both are the same complaint from two sides: a task you just created is somewhere you are not, and then it is one of several cards that all look alike.

Three decisions were the owner's:
1. **All three add methods, not only typed text** — «ναι απο ολα οχι μονο απο το κειμενο». Typing, dictation and photo already share one handler, so this cost nothing extra.
2. **The mark PERSISTS after the pulses** rather than pulsing and vanishing — chosen from two options offered, because the complaint was about how long it takes to find the task, and a mark on a short timer only races that problem instead of solving it.
3. **The middle of three intensities.** He was shown a throwaway preview page (three strengths, light and dark, a replay button) and picked the middle one, which was what had already been written.

## Where this stands
**Shipped to production on 2026-09-05.** Two commits on `main`, both pushed — `9ba92dd` (lands in the Inbox) and `11175fa` (the mark). Vercel and Render deploy themselves from `main`, so this is live in the business.

**Changed:** `App.jsx` (the switch, the `newTaskIds` state and its timer), `InboxView.jsx`, `TaskList.jsx`, `TaskCard.jsx` (one prop each, passed on), `TaskRow.jsx` (one class on the wrapper), `index.css` (two tokens in both palettes, one keyframe, one class, one reduced-motion rule). No new file, no backend change, no locale key.

## What it does
An add through the + — typed, dictated or photographed — switches to the Inbox, and the new cards take an amber ring that pulses three times (2px → 5px → back, ~1,1 s a beat) with a halo thrown outward on each beat, then stops, leaving the steady ring behind.

**Corrected the same day, and it is the reason the pulse looks the way it does.** The first version left the ring at a constant 2px and animated only a faint halo OUTSIDE it. It passed every check and it was visible on a preview page; on the owner's actual phone he reported it as not moving at all — «δεν αναβοσβηνει». It was not a bug, it was a design that produced no perceptible movement, so the ring itself now changes thickness. **Still unresolved when this was written:** whether his phone also has reduce-motion on (Android/iOS accessibility, or battery saver, which turns animations off system-wide) — that would suppress the pulse BY DESIGN and leave exactly the static ring he described, in which case the answer is a stronger static mark, not a stronger animation. The ring comes off a card when that card is opened (only that one — an extraction can return several), and off everything after 12 seconds if nothing is touched. A second add restarts the clock rather than letting the older timer cut the newer mark short.

Why the Inbox and not "the screen you were on": everything the + produces is born with no `approval_status`, i.e. pending, and `InboxView` is the only screen that lists those. From Calendar or Today the task was genuinely invisible — a toast, a badge, nothing on screen.

## Baselines as of 2026-09-05
- `npm run check` → **exit 0**, `ui-check: OK — 71 files, 49 tokens, 416 translation keys`, 206 PASS. **Tokens were 47** before this pass; the two new ones are the highlight colours, and `ui-check` itself is what forces them to exist in the dark palette as well as the light one.
- `npm run lint` → **12 problems, the unchanged long-standing baseline** (measured after the change).
- `npx vite build` → clean, 316 modules.
- Backend untouched, so its test suite was not re-run.

## What a person has actually seen, and what nobody has
**Seen:**
- [x] **The animation itself**, in a browser, at three strengths and in both themes — a standalone preview page built for the purpose, carrying the real keyframes and the real token values. That is how the owner chose. The file was deleted afterwards at his request; it never lived inside the project.
- [x] **The compiled CSS bundle carries the class, the keyframes, both palettes' tokens and the reduced-motion rule** — grepped out of `dist/assets/*.css` after the build, so the Tailwind pipeline is known not to have dropped any of it.

**Still unseen — and the first one is deliberate:**
- [ ] **The whole thing in the running app.** Every add through the + is a Gemini extraction call on the owner's own account, so testing it end to end spends his money; not done without him asking. What that leaves unproven: that the tab actually switches on a real add, and that a real new card wears the ring.
- [ ] **Where the Inbox is scrolled when you land on it.** Switching tabs does not reset the page's scroll position, so arriving from a Calendar scrolled far down could put the marked card above the fold. Not observed either way; if it happens, the fix is a scroll-to-top on that switch and it is one line.
- [ ] **The reduced-motion path.** The steady ring with no pulsing has been reasoned about and read in the built CSS, never rendered with the OS setting on.
- [ ] **The desktop sidebar's add button.** It routes through the same handler, so it should behave identically — but dictation and photo from a desktop have never been exercised at all, a gap that predates this change.

## One thing to know if this is picked up cold
**The mark is drawn on the wrapper, not on the card.** `TaskRow` returns a wrapper with `overflow-hidden` — that is what hides the swipe tray until you drag — and overflow clips CHILDREN, so a halo drawn on the card inside would be cut off at exactly the edge it needs to cross. An element's own `box-shadow` is not clipped by its own overflow, which is why the class sits on the wrapper. The `z-index: 1` in it is not decoration either: without it the next card's opaque background paints over the halo and clips it on the bottom edge only, which reads as a rendering bug rather than as a design.
