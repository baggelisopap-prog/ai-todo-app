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
**Shipped to production on 2026-09-04.** Commits `871bd9b` (backend), `7f2a826` (frontend), `33ab9e7` (the regression fix below), all on `main`, all pushed — Render and Vercel deploy themselves from that.

The migration was **run and read back by the owner** first: `select count(*) as total, count(deleted_at) as deleted from tasks` → **total 325, deleted 0**. That one query proves both halves — it names `deleted_at`, so a missing column would have raised rather than returned a number, and `deleted = 0` shows the ALTER touched no rows. (325, not the 301 quoted from 2026-09-03: Hostaway messages and daily recurrence occurrences add rows continuously.)

**Baselines as of 2026-09-04:** backend `./venv/Scripts/python.exe -m pytest tests/ -q` → **328 passed** (was 312). Frontend `npm run check` green (two new suites: `task-visibility.test.mjs`, `task-history.test.mjs`); `npm run lint` → **12 problems**, unchanged long-standing baseline, none in the new files; `npx vite build` clean.

- Migration: `docs/migrations/2026-09-04-task-soft-delete.sql`
- Reasoning: `docs/DECISIONS.md` (two new entries) and `docs/DATABASE_SCHEMA.md` (the `deleted_at` section)

## What a person has actually seen, and what nobody has
The distinction matters more than usual here, because one item moved from the second list to the first by **failing**.

**Seen, and it counts as evidence:**
- [x] The migration applied and read back — total 325, deleted 0.
- [x] `git push` → deployed.
- [x] **The History tab renders, with completed entries in it.** Not claimed: this is how the owner discovered he could not re-open them, so the screen was demonstrably on his phone with real rows on it.

**Still unseen — this is the list to work through:**
- [ ] Delete a task. It leaves Today/Browse **and appears under Ιστορικό → Σήμερα** with "Διαγράφηκε HH:MM".
- [ ] Press **Επαναφορά**. It returns to Ενεργά.
- [ ] **Ξανάνοιγμα** on a completed row puts it back, un-ticked. (Shipped in `33ab9e7`, after the deploy — never used.)
- [ ] **Αναίρεση** on a rejected row returns it to the **Εισερχόμενα**, not to Ενεργά.
- [ ] Delete a task **that has a Google Calendar event**, then restore it. The toast must say the calendar event did NOT come back. This is the accepted hole and the one place the UI is allowed to be wordy.
- [ ] Old completions (pre-2026-08-13) read "η ώρα δεν καταγράφηκε" rather than inventing an hour.
- [ ] **`created_at` actually arrives**: every history row shows "Μπήκε <date>". If it is missing everywhere, the column is not reaching the frontend and the sort fix below is inert too.
- [ ] **Νεότερα ↔ Παλαιότερα visibly changes the order.** Before this work it did nothing at all, so "it looks the same" is the failure signal.

## The regression this feature caused, and why it was predictable
Moving completed and rejected tasks into History **took away two capabilities the owner had**: Browse's "Εμφάνιση ολοκληρωμένων" and "Εμφάνιση απορριφθέντων" toggles showed those tasks as ordinary cards, where the circle un-completed them and the ⋯ menu un-rejected them. The first version of History was read-only apart from Restore, and Restore was on deleted rows only. He hit it within minutes, on a task he had ticked by accident.

Fixed in `33ab9e7`: **Ξανάνοιγμα** on completed rows, **Αναίρεση** on rejected ones, both through the same `onTaskUpdate` every other screen uses — no new backend, since `is_completed:false` already clears `completed_at`/`completed_source` and `is_rejected:false` was already an action. Missed occurrences deliberately get no button and are the one state where nothing was taken away.

**The lesson worth keeping**: when a screen absorbs rows that used to live somewhere else, the question is not "does the new screen show them" but "what could I DO with them before". Two capabilities were dropped, not one — the rejected half would have gone unnoticed for longer, because nobody was looking at it.

## Two bugs found on the way, both fixed here
- **Browse leaked deleted tasks.** The "Εμφάνιση απορριφθέντων" toggle bypassed `isVisibleTask`, so a soft-deleted task would have shown up in the live list. Closed before it could ship.
- **"Νεότερα"/"Παλαιότερα" have been sorting nothing.** `TaskList` ordered by `created_time` — the Airtable-era column, popped from both the insert and the update path, with no database default, so **nothing has ever written it**. `created_at` is now surfaced on `TaskRecord` and both the sort and the History tab read it. Worth confirming in the app: the sort should visibly change order now, where before it did nothing.

## Deliberately not done
- **`delete_tasks_by_ids` still hard-deletes** — its two callers are recurrence housekeeping (regenerating future occurrences after a rule edit, clearing them after a rule delete), not a person deleting work. Soft-deleting those would fill History with entries for acts the user never performed. Reasoning in `DECISIONS.md`.
- **No purge and no restore cutoff.** With nothing purging rows, a 30-day limit would be code whose only job is to refuse something that works. If a purge is ever added, that decision reopens first.
- **No "what changed when"** (who moved the date, who raised the priority). A much larger feature; History answers "what happened to this task", not "how did it get like this".
- **No way to reopen a missed occurrence.** The one History state without a button, and the one where nothing was taken away — there is no "un-miss" in the backend and the day has passed regardless. Parked in BACKLOG.md alongside the "deleted by the system" bucket, so neither is mistaken later for the oversight the completed/rejected buttons genuinely were.

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
