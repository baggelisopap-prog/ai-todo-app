ACTIVE TASK — The agent got a permanent, draggable column on the desktop. Pushed; driven in a real browser, but not yet on the deployed app
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

> **ONE COMMIT PUSHED TO MAIN, `12c0e53`, AUTO-DEPLOYED.**
> 6 files, +388 −12. New file: `frontend/src/components/AgentPanel.jsx`.
> Desktop layout only — the phone is untouched by this commit.
>
> The previous task (the phone's AskBar, `10e2b5d`) is **finished**, was seen
> working by the owner, and lives in PROJECT_STATUS.md. Nothing here supersedes it.

## What was asked

2026-09-22, after the phone work was accepted. He asked to look at the desktop screen,
and after seeing what was there:

> «σε πρώτησ φάση να πιάσουμε το ask me»

Shown the current state and three directions, he chose the permanent column and added a
requirement of his own:

> «α αλλα να μπορεί και να μεγαλωσει μικρινει με συρσημω καταλαβες πω΄ς εννοώ?»

After feeling the drag in an interactive mock-up:

> «τελειο»

Then, on the implementation plan:

> «jekina»

And, after seeing it running locally:

> «ενταξει ειναι ανεβασε»

## The problem, stated properly

The desktop agent was **the phone's sheet enlarged**: a 512×600 dialog on a `bg-black/40`
backdrop. Nobody chose that for a desktop — a second shape was simply never written. It
has two costs, and the second is the one that matters:

1. The entry point was a small outlined grey button in the top-right corner.
2. **You asked a question about your tasks and the answer covered your tasks.** Seeing
   both meant closing the conversation and reopening it for the next question.

## His decisions, and two of mine

**The column, not a field.** Of three directions drawn (permanent column / ask-field above
the list / ask-field in the sidebar), only the column fixes the covering. The other two
are doors to the same dialog.

**Draggable — his requirement, and testing proved it was not a flourish.** Which of the
list and the conversation should give way changes within the same hour, so the split
belongs to whoever is looking at it rather than to a constant chosen in the code.

**Mine, stated to him before building and not objected to:** the width is remembered in
`localStorage` (a property of one screen — the same reasoning `SwipeHint` already uses, so
it does not travel to the phone), and below 1280px the panel starts *collapsed, not
absent* — one rule rather than a second code path.

**Also flagged to him before building, because both are real:** the conversation now
survives as long as the page is open (it used to die when the dialog closed; «Νέα
συζήτηση» still clears it), and on desktop the agent's 129 kB chunk is fetched whenever the
panel is expanded rather than only when a dialog opens.

## What changed, where

**`components/AgentPanel.jsx` (new)** — the column and its handle: drag, limits, collapse,
remembered width. The limits are measured, not picked: **300px** because below it the chat
bubbles and the Send button start wrapping; **250px** is where a drag stops squeezing and
closes instead; the maximum is whatever leaves the list 480px, which is not a constant —
it grows with the window.

**`components/AgentChatModal.jsx`** — keeps its name, gains `variant`. This is the split
`FloatingActionButtons` already uses for its round button and its sidebar row. In panel
shape it does **not** lock page scroll (the list beside it is meant to be scrolled while
you talk) and Escape does **not** close it (Escape dismisses something that interrupted
you; a permanent column never did).

**`App.jsx`** — the panel is a sibling of the middle column, not an overlay. The phone's
dialog is now guarded by `!isDesktop` as well, so narrowing a window cannot leave a
dimming dialog on top of the column that does the same job. The AppBar's «Ρώτα» button
became the panel's show/hide.

**`index.css`** — `.agent-grip`: a 1px rule with a 9px grab zone, thickening to the brand
colour on hover, focus and drag.

**`locales/el.json` / `en.json`** — three strings under `agent.panel`.

## Three defects the build could never have caught

All three passed `npm run check` and `npm run build` cleanly, and all three were found by
driving the running app in a browser. They are the reason that step is not optional here.

1. **The handle did not drag at all.** The pointermove was gated on the browser having
   granted pointer capture. A refused capture therefore made the handle *silently dead*
   rather than merely less smooth. It is now gated on whether you pressed; capture is a
   convenience allowed to fail.
2. **Dragging past the threshold killed the gesture.** Collapsing mid-drag unmounted the
   very handle under the pointer, so overshooting inwards left you unable to pull it back
   out — the only way back was releasing and clicking the strip. The drag now clamps at
   the minimum and stays alive; collapsing is decided once, on release.
3. **Closing it by shoving also shrank it.** The shove had clamped the width on its way
   past, so the panel reopened narrower than it was left. The width at pointer-down is
   restored instead.

## Baselines — actual output, 2026-09-22

```
npm run check   → EXIT=0
                  ui-check: OK — 95 files, 46 tokens, 549 translation keys
                  all passed (18 suites)
npm run build   → ✓ 339 modules, clean
npm run lint    → not re-run for this commit; it stood at 12 pre-existing
                  errors on 2026-09-21, none in files touched here
```

## Measured in the running app, not observed and hoped

Driven at `localhost:5173`, logged in as the owner, viewport 2400×1218 CSS px:

| Check | Result |
|---|---|
| Default width | 400 |
| Widened to 620, released | stays 620, persisted |
| Shoved past the edge | clamps to 300, gesture survives |
| Dragged back out mid-gesture | returns to 400 |
| Released past the edge | collapses |
| Strip reopens it | at **620**, not 300 |
| After reload | 620 |
| AppBar «Ρώτα» button | closes, then reopens |
| Keyboard | +16, −64 with Shift, Home → 400 |
| SideNav and panel heights | 1219 each = one viewport, sticky at top; the list scrolls beneath |

## What NOBODY has watched

1. **Any of this on the deployed app.** Everything above is the local dev copy.
2. **A narrow window.** The browser tool could not resize the window, so the breakpoint was
   never seen. The guard is the same `isDesktop` flag that already switches SideNav and
   BottomNav, and the phone's dialog now carries `!isDesktop` too — but that is reasoning,
   not a screenshot. **Settles it: narrow the window.** The column should vanish, the
   bottom dock with AskBar should appear, and no dimmed dialog should be left behind.
3. **The panel on a genuinely small laptop screen**, where `COMFORTABLE_WIDTH` decides it
   starts collapsed. Only ever run on a 2400px-wide viewport.
4. **A real conversation held in the panel** — asking something, getting an answer, and
   confirming a proposed change with the task visible beside it. That is the entire
   argument for the design and it has not been done once.

## A separate finding, measured and deliberately not acted on

**The panel does not fix the empty width.** With the column open, the task list is still
capped at 768px and floats with **484px of dead space on each side**. That cap is its own
problem — a `max-w-3xl` on the list column — and nothing here touched it. Raised with the
owner; no decision taken.

**A correction, out loud:** while presenting the mock-up I told him "16 pixels are missing"
and that the list and the agent could not both fit. That arithmetic was for a 1440px
viewport. His actual viewport is 2400px, where there is room to spare. The drag handle is
still right — he asked for it, and it earns its place on narrow windows — but the claim as
stated was wrong.
