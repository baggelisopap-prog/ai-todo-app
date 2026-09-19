ACTIVE TASK — The task row's bottom line: date first, calendar glyph, wider gaps. Pushed, not yet seen working
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

> **PUSHED TO MAIN AS `a9aa78d`, WHICH AUTO-DEPLOYS.** One file changed:
> `frontend/src/components/TaskRow.jsx`, +114 −26, most of it comments. No behaviour
> changed — no new state, no new request, no new prop. Only the ORDER of the elements on
> the row's second line, their weight, and the gaps between them.
>
> The previous task (a completion by somebody else is a handover, migration applied by the
> owner on 2026-09-18, live counts read back and recorded) is **finished** and lives in git
> and in PROJECT_STATUS.md. Nothing here supersedes it.

## What was asked

Opened as polish, 2026-09-19:

> «θελω να κανουμε ενα μικρο polish πως φαινονται τα τασκ»

Asked what specifically, he gave the whole brief in one message:

> «η η ημερομηνια ειναι με μεγαλο κενο θελω η κατω γραμμη να ειναι ποιο ομορφη θελω η σειρα
> να ειναι ημερομηνια ωρα και μετα τα αλλα που εχει σχεδιασε μου σε html τι καταλαβες»

Then, after seeing the three drawn options:

> «β αλλα τα χρωματα κατω να ειναι ολα ιδια ρε φιλε»

and, when asked how far «όλα ίδια» went and told what greying the date would cost:

> «οχι αστα με τα χρωματα αυτα τα δυο οκ»

and finally, after it shipped:

> «θελω πρωτα να εχει ενα εικονιδιο ημερολογιο μετα τον μηνα και την ωρα και λιγο ποιο
> μεγαλες αποστασης»

## The decisions that were his

1. **Option Β of three**, drawn as an HTML mock at `https://claude.ai/artifact/2psv1AzG36bD1focG6cDrp`
   (the page has since been updated to show what actually shipped). Α was a plain reorder; Γ
   removed every separator dot.
2. **No colour changes.** Β as drawn darkened the date and faded the tail. He cut that —
   «αστα με τα χρωματα» — after being told, before answering, that greying the date would
   remove the only at-a-glance «this is late» signal a list has. The overdue red and today
   amber are now a standing constraint on this line, not a passing preference.
3. **A calendar glyph, by name**, after being told the row already carries one at the other
   end of the same line as the Google Calendar sync switch. He asked for the calendar anyway.
   A clock is a one-word change if he changes his mind on seeing it.

## What changed, and where

All of it in `frontend/src/components/TaskRow.jsx`, in the `<div>` that draws the second line.

- **The date and time moved to the front**, immediately after the completion circle.
- **A hairline rule** separates them from the workspace pill — not a « · », which reads as
  punctuation belonging to the date and makes «19 Σεπ, 11:00 ·» look like a cut-off sentence.
- **The elastic spacer stayed flex-1 and moved to the end of the facts.** This is the part
  that answers the complaint. It used to sit BETWEEN the category and the date, pushing every
  date to the same right edge; its length changed with every row, and that variable hole is
  what he saw. At the end of the line the same slack separates the facts from the controls,
  where nothing has to line up across rows.
- **`tabular-nums` on the date.** Proportional digits make «11:00» and «09:30» different
  widths, so whatever follows starts at a different x on every row.
- **`font-medium` on all four due tones.** `DUE_TONE_CLASSES` gave the weight to overdue and
  today and withheld it from the rest — invisible while the date sat alone at the end, obvious
  the moment dates stack in a column. The colours in that map are untouched.
- **A 12px calendar glyph INSIDE the date's span**, not beside it, so it inherits the due tone
  through `currentColor`. As a sibling it would have needed a colour of its own, and a grey
  calendar welded to a red date reads as two facts rather than one. 12px and not the 16px the
  controls use, because at 16 it outweighed the number it labels.
- **Gaps 6px → 8px**, not 10 or 12. The air comes out of the category, the only element on the
  line allowed to truncate; at 10-12px «Καθαριότητα» starts being cut on a 400px screen. The
  trade was named to him rather than decided quietly.

**Five comments in the file that described the old order were corrected in place**, each
saying what it used to claim rather than being deleted — including the one that asserted the
spacer was what made the dates line up, which was true when written and is now the opposite
of how the alignment is achieved.

## Evidence

Re-run after the final change, 2026-09-19:

```
npm run check   → ui-check: OK — 93 files, 50 tokens, 541 translation keys
                  all passed (13 suites)          exit 0
npm run build   → ✓ 338 modules transformed. ✓ built in 353ms
npm run lint    → ✖ 12 problems (12 errors, 0 warnings)
```

`npm run build` is run separately and on purpose: `npm run check` does **not** compile the
components, so a broken JSX file passes it silently.

The 12 lint errors are **pre-existing and in other files** — `api.js`, `App.jsx`,
`public/sw.js`, `components/SettingsModal.jsx`, `components/TodayView.jsx`. `TaskRow.jsx` is
not among them. This count was not compared against a previous run, so it is stated as "not
caused by this change", not as "unchanged".

## What a person has SEEN

- The three options, as a static HTML mock. He chose from it.
- The app booting at `http://localhost:5173` and reaching its login screen.

## What NOBODY has seen

- **The change itself, running, against real tasks.** This is the whole of it. The servers
  were started for him (`uvicorn main:app` on 8000, `vite` on 5173) and the tab was left on
  the login screen; logging in is his, not the assistant's. He said «καλο push» without
  reporting back on what the rows looked like, so the last word on this is a mock, not the app.
- **Whether 8px is enough air**, or whether the category now truncates sooner than he likes.
- **The two-calendar collision in practice.** It is accepted in principle and has never been
  looked at on a real row.
- **A row with no date**, which now draws a calendar glyph next to «Χωρίς ημερομηνία».
- **A shared workspace row**, where the avatar sits on the line above and the pill is widest.

What would settle all of it: open a list on a phone-width window with the servers running,
and look at Σήμερα, Επερχόμενα and Ημερολόγιο — the last one because it lists completed rows
permanently, which is the only place the faded variant of this line appears.

## Servers, if picking this back up

```
./venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
cd frontend && npm run dev
```

Open **`http://localhost:5173`**, never `http://127.0.0.1:5173`. The CORS allowlist in
`main.py:431` names `http://localhost:5173`, and the browser treats the two spellings as
different origins — from `127.0.0.1` every preflight comes back `400 Bad Request` and the app
loads but shows no data. This cost a round trip in this session; it is a launch mistake, not
an app bug, and the allowlist is correct as it stands.
