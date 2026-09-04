ACTIVE TASK — Browse rebuilt: soft delete, a History tab, and filters in one row
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## What was asked
"Την σελίδα browsing θέλω να την βελτιώσουμε, έτσι όπως είναι δεν μου αρέσει. Θέλω σίγουρα να έχει ιστορικό (input, complete, deleted), καλύτερη ταξινόμηση φίλτρων και δεν ξέρω εγώ τι άλλο." (2026-09-03)

Designed in chat, not as a spec file — one column and one screen did not earn a 300-line document (the owner asked; the reasoning went to `docs/DECISIONS.md` and `DATABASE_SCHEMA.md` instead, which are the files he actually reads).

Four decisions he made:
1. **Soft delete AND a permanent archive**, not one or the other — once the row survives, both fall out of the same change.
2. **Two tabs inside Browse** ("Ενεργά" / "Ιστορικό"), each with its own filters. Not a fifth bottom-nav tab: that nav is deliberately four wide, because at a fifth of a phone screen "Εισερχόμενα" was being clipped.
3. **Every closed state goes in History**, with a "Τι" filter to narrow.
4. **One row of controls**, always visible, matching Today/Calendar — not the three rows Browse had.

## Where this stands
Both slices are **written and green locally**. The migration has been **run and read back by the owner** (2026-09-04): `select count(*) as total, count(deleted_at) as deleted from tasks` → **total 325, deleted 0**. That one query proves both halves — it names `deleted_at`, so a missing column would have raised rather than returned a number, and `deleted = 0` shows the ALTER touched no rows. (325, not the 301 quoted from 2026-09-03: Hostaway messages and daily recurrence occurrences add rows continuously.) Nothing has been deployed yet.

**Baselines as of 2026-09-04:** backend `./venv/Scripts/python.exe -m pytest tests/ -q` → **328 passed** (was 312). Frontend `npm run check` green (two new suites: `task-visibility.test.mjs`, `task-history.test.mjs`); `npm run lint` → **12 problems**, unchanged long-standing baseline, none in the new files; `npx vite build` clean.

- Migration: `docs/migrations/2026-09-04-task-soft-delete.sql`
- Reasoning: `docs/DECISIONS.md` (two new entries) and `docs/DATABASE_SCHEMA.md` (the `deleted_at` section)

## What is NOT verified, and it is the whole point
**Nothing has run in the real app.** Every claim above is tests and a build. The list below is what has to happen in the owner's browser, in this order:

- [x] ~~Migration applied and read back~~ — done 2026-09-04, total 325 / deleted 0.
- [ ] The owner's `git push` — Render and Vercel. **The migration is already applied**, so this direction is safe.
- [ ] Delete a task. It leaves Today/Browse **and appears under Ιστορικό → Σήμερα** with "Διαγράφηκε HH:MM".
- [ ] Press **Επαναφορά**. It returns to Ενεργά.
- [ ] Delete a task **that has a Google Calendar event**, then restore it. The toast must say the calendar event did NOT come back. This is the accepted hole and the one place the UI is allowed to be wordy.
- [ ] A **completed** task shows "Ολοκληρώθηκε HH:MM · από εσένα/από τον agent". Old completions (pre-2026-08-13) should read "η ώρα δεν καταγράφηκε" rather than inventing an hour.
- [ ] **`created_at` actually arrives**: every history row shows "Μπήκε <date>". If it is missing everywhere, the column is not being selected and the sort fix below is inert too.

## Two bugs found on the way, both fixed here
- **Browse leaked deleted tasks.** The "Εμφάνιση απορριφθέντων" toggle bypassed `isVisibleTask`, so a soft-deleted task would have shown up in the live list. Closed before it could ship.
- **"Νεότερα"/"Παλαιότερα" have been sorting nothing.** `TaskList` ordered by `created_time` — the Airtable-era column, popped from both the insert and the update path, with no database default, so **nothing has ever written it**. `created_at` is now surfaced on `TaskRecord` and both the sort and the History tab read it. Worth confirming in the app: the sort should visibly change order now, where before it did nothing.

## Deliberately not done
- **`delete_tasks_by_ids` still hard-deletes** — its two callers are recurrence housekeeping (regenerating future occurrences after a rule edit, clearing them after a rule delete), not a person deleting work. Soft-deleting those would fill History with entries for acts the user never performed. Reasoning in `DECISIONS.md`.
- **No purge and no restore cutoff.** With nothing purging rows, a 30-day limit would be code whose only job is to refuse something that works. If a purge is ever added, that decision reopens first.
- **No "what changed when"** (who moved the date, who raised the priority). A much larger feature; History answers "what happened to this task", not "how did it get like this".

## Still open from earlier tasks
Carried forward deliberately — untouched by this work and still unverified.

- [ ] **The Hostaway escalation rekey has never met a real guest message.** `get_active_hostaway_tasks` matches the category carrying `system_key='hostaway'` rather than the literal word. Both halves have tests; the pair has never run against a message actually arriving. First thing to check if it looks wrong: `select count(*) from tasks where category = 'Hostaway' and category_id is null` must be 0.
- [ ] **Recurrence Gap 2** — a rule surviving a real midnight unattended, `materialized_through` advancing by exactly one day.
- [ ] **Gap 3** — a missed occurrence stamping `missed_at` from the scheduler's own tick, not a test calling the function.
- [ ] **Gap 4** — a reminder firing for a rule-generated occurrence.
- [ ] **Gap 6** — the make-this-repeat walkthrough; Today showing exactly ONE copy of an adopted task with its checklist intact.
- [ ] `tasks.category` still exists and is still written by the extractor; the Part B migration dropping it is unwritten.
- [ ] `recurrence_rules.workspace_id` / `category_id` exist but nothing writes them.

## How to resume
Read this file, then `docs/DECISIONS.md` from "deleting a task stamps `deleted_at`" onward. The `deleted_at` section of `docs/DATABASE_SCHEMA.md` has the why behind every choice, including the two that look like oversights and are not.

One habit worth keeping from this session: `test_the_write_path_sends_only_real_columns` fired the moment `deleted_at` reached the model, exactly as designed. It is the reason the code could not go out ahead of the migration. Do not weaken it.
