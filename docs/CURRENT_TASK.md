ACTIVE TASK — A recurrence says which workspace its days go to; nothing is placed in a room its author is not in. Pushed `ff03cf1`, live on both server and site; the refile of the 29 «Χάπι end» days waits past Claude Code's safety check
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

> **ONE CODE COMMIT, `ff03cf1`, PUSHED 2026-09-26 AND CONFIRMED LIVE** — the server's public API
> description lists the new recurrence fields, and the site serves a new bundle
> (`index-WvIEbo0X.js`), both ~75 s after the push.
> 13 files. New: `tests/test_recurrence_placement.py` (13 tests).
>
> The previous task (the agent audit, `2670562`) is finished as far as code goes; what nobody has
> watched of it moved into its PROJECT_STATUS.md bullet.

## What was asked

2026-09-26. Told that recurring tasks land with no workspace and that the fix was his call:

> «τα επαναλαμβανομενα να τα ορίζω όταν ορίζω την επανάληψη αυτο που εχω είδη ειναι προσωπικο.
> γτ να βαλουμε εφεδρικο μοντέλο?»

Shown the plan, the membership gap found on the way, and why a fallback model:

> «ναι σε όλα εκτος το μοντελο αν κλεισει θα βάλουμε άλλο κλάην»

So: the recurrence form sets the workspace; his one rule is Personal; the membership check goes
on tasks too; the 29 existing days are refiled; **no fallback model** (his decision — DECISIONS.md).

## What was actually wrong

The recurrence form's «Κατηγορία» offered the four OLD words, which file nothing. His one rule,
«Χάπι end» (daily), said Personal in its own row — the 2026-09-01 migration had filled it — but
the rule reader never read the column, so every occurrence since 2026-09-01 landed unfiled:
**29 of 55** (read-only count, 2026-09-26: 14 open, 15 completed; the other 26 are older and in
Personal). The agent's «(no workspace)» for it, seen in the audit, was this.

## What changed, where

- **`RecurrenceForm.jsx`** — «Χώρος» and «Κατηγορία χώρου», the words of a task's sheet, in place of
  the old select; priority and time now share a row. Opens where the rule goes; for «make this
  repeat», where the task lives; for a new rule, the workspace on screen, else the default one
  (`initialRulePlacement`, `utils/workspaces.js`). The Hostaway category is never offered. An edit
  sends no placement until the user changes it, so a list still loading cannot unfile a rule.
- **`RecurrencesView.jsx`** — each rule's row says where its days go.
- **`repository.py`** — the rule reader returns `workspace_id` / `category_id`;
  `get_category_in_workspaces` finds a category by MEMBERSHIP of its room.
- **`services.py`** — every occurrence copies the rule's placement (`_rule_placement`), or goes
  unfiled when that room is no longer one the user sees (archived, or left) — never hidden.
  `validate_workspace_placement` now checks membership (`WorkspaceNotFound`, a 404) and finds the
  category by membership, not by creator. The extractor files into a room the user is not in
  NOWHERE rather than failing — capture must never fail.
- **`main.py`** — `POST`/`PATCH /tasks` and `POST`/`PATCH /recurrences` judge only what CHANGES;
  recurrences also refuse the integration's category and a category without its workspace, and a
  new workspace without a category word drops the old room's category.
- **`models.py`** — its comment said nothing writes the two columns; corrected.
- **Locales** — `recurrence.form_category` removed (unused). Tests: 20 new backend, 10 new in
  `scripts/workspaces.test.mjs`; `test_category_invariants.py` and `test_extract_workspace.py`
  updated to fake the new membership read.

## Proof — actual output, 2026-09-26

```
The gap, on the PREVIOUS code (stubbed writes, nothing real touched):
  POST /tasks into a foreign room  -> HTTP 201
  PATCH /tasks into a foreign room -> HTTP 200
  writes that reached the service: [('create', 'ws-someone-else'), ('update', 'ws-someone-else')]
Same script, new code:
  POST -> HTTP 404   PATCH -> HTTP 404   writes: []

pytest tests/ -q                                  -> 700 passed   (680 before)
same, with SUPABASE_URL pointed at 127.0.0.1:9    -> 700 passed
   (so no test reads the live database; before the fixtures were updated,
    exactly the 5 tests touching the new membership read failed this way)
npm run check -> EXIT=0, ui-check: OK — 95 files, 46 tokens, 562 translation keys
                 (563 before: recurrence.form_category removed)
npm run build -> ✓ 340 modules transformed
npm run lint  -> ✖ 13 problems (13 errors, 0 warnings) — unchanged; the three touched
                 frontend files lint clean
```

## The refile of the 29 — NOT DONE YET

Approved by the owner («ναι σε όλα», to «μεταφέρω τις 29 του «Χάπι end» στο Personal, αφού
ανέβει ο κώδικας;»). Dry run after the deploy: 29 rows, 14 open + 15 completed, dates
2026-09-12 → 2026-10-10, rule's workspace = his own live Personal, none with calendar sync on.
The write was **refused by Claude Code's safety check on live data** — as the Hostaway refile
was on 2026-09-25 — and was not routed around. Waiting for his explicit go past it. The script
saves the ids to `docs/migrations/2026-09-26-recurrence-occurrences-refiled.json` first, updates
each row only if it is still an unfiled occurrence of that rule, then reads back.

## What a person has actually SEEN

Nothing. Deployed and confirmed live by the API description and the bundle; nobody has opened
the form.

## What NOBODY has watched

1. **The new form on his phone** — «Χώρος» / «Κατηγορία χώρου», and priority beside time. The
   layout changed; he judges these by looking. Settles it: Ρυθμίσεις → Επαναλήψεις → «Χάπι end».
2. **A new occurrence landing in Personal.** The next day the scheduler adds (about once a day
   per rule) should be in Personal. Settles it: Personal's list shows «Χάπι end» for 2026-10-11.
3. **A member filing under the owner's category** — fixed by code, proven by test, never done by
   a real member.
