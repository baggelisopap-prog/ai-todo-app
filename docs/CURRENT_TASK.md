ACTIVE TASK — Workspaces and user-defined categories: shipped, in use, and one thing still unwatched
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Where this stands
Three slices designed, built, migrated, deployed and — unusually for this project — **used by the owner in the real app before the session ended**. He reported "όλα καλά τώρα δουλεύει" after the last fix.

- Design: `docs/superpowers/specs/2026-08-31-workspaces-and-categories-design.md`
- Plans: `docs/superpowers/plans/2026-09-01-workspaces-slice-1-backend.md`, `…-slice-2-frontend.md`, `docs/superpowers/plans/2026-09-02-workspaces-slice-3-ai-and-filters.md`
- Migrations, both run by the owner and read back: `2026-09-01-workspaces-and-categories.sql`, `2026-09-02-default-workspace.sql`

**Baselines as of 2026-09-03:** backend `./venv/Scripts/python.exe -m pytest tests/ -q` → **312 passed** (was 221 on 2026-09-01). Frontend `npm run check` green; `npm run lint` → **12 problems**, the long-standing baseline; `npx vite build` clean.

## What is verified, and by what
- **The migration, against 301 real tasks.** Counts read back by the owner: 126 Hostaway tasks placed with **0 missing**; 289 placed + 12 unfiled = 301; unfiled exactly equalled the old `Unknown` count. Nothing was stranded.
- **The extractor, against the live model.** Standing in Business "αγόρασε bitcoin" → Business/crypto (3/3). From "Όλα" "ραντεβού με τον Κώστα στις 7" → **Personal, tomorrow 19:00** (3/3) — the owner's own reported failure, now correct in both halves.
- **The time rule.** 15 calls, every one stable, no past time produced. "ραντεβού στις 7" → 19:00 while "ξύπνα με στις 7" → 07:00: same words, different hour, right both times.
- **The per-task editor, five instructions against the real model.** Only the intended field changes; both refusals now say why instead of announcing success.
- **The UI**, by the owner in his own browser.

## The one thing NOT watched — and it is the business
**No real Hostaway guest message has arrived since escalation was rekeyed.** `repository.get_active_hostaway_tasks` no longer matches the literal word `"Hostaway"`; it matches the category carrying `system_key='hostaway'`, and `main._create_hostaway_task` writes that category's id on every new guest task. Both halves have tests and the 126 existing tasks were verified to carry the id — but the pair has never run against a message actually arriving from Hostaway.

- [ ] A real guest message becomes a task, lands in Business/Hostaway, and **escalates** at its priority interval.
- [ ] A human reply still closes it (the reply path was not touched, but it reads the same task rows).

If this ever looks wrong, the first thing to check is `select count(*) from tasks where category = 'Hostaway' and category_id is null` — it must be 0.

## Still open from the previous task (recurring tasks, 2026-08-15/17)
Carried forward deliberately: these were never closed and are unrelated to workspaces.

- [ ] **Gap 2** — a rule surviving a real midnight unattended: the next day's occurrence appearing from the scheduler's own tick, `materialized_through` advancing by exactly one day.
- [ ] **Gap 3** — a missed occurrence stamping `missed_at` by the tick itself, not by a test calling the function.
- [ ] **Gap 4** — a reminder firing for a rule-generated occurrence. That path has never been exercised against a row this feature created.
- [ ] **Gap 6** — the make-this-repeat walkthrough, in particular: Today showing exactly ONE copy of an adopted task with its checklist intact.

## What is deliberately unfinished in workspaces
- **`tasks.category` still exists and is still written** by the extractor. It is invisible in the UI and read by nothing user-facing. The Part B migration that drops it **has not been written**.
- **`recurrence_rules.workspace_id` / `category_id` exist but nothing writes them.** A recurrence still copies its own old `category` TEXT into each occurrence.
- **A category cannot be moved between workspaces.** Parked with its reasoning in BACKLOG.md — there is no obviously right answer for the tasks already filed under it.
- **Sharing a task with another person** — the other half of the owner's original request — is not designed. `workspaces.user_id` exists so that project adds a members table beside this schema rather than restructuring it.

## Three bugs this session found, and the pattern behind two of them
- **`category_name` broke ALL task creation in production.** A model-only field reached `model_dump()` and Supabase rejects the whole INSERT for one unknown key (PGRST204). Manual creation, all three extraction paths and the Hostaway webhook went down together.
- **`_build_prompt` gained a parameter and its one call site did not.** The ✨ editor raised TypeError on every use.
- **Swipe-left Delete had never worked.** A `fixed inset-0 z-10` overlay covered the tray's own buttons; every tap closed the tray instead. Reschedule was broken the same way and nobody had tried it.

The first two share a cause: **the tests called internals, not the front door.** Both now have a guard that goes in the way the app does — an explicit set of the real `tasks` columns asserted against `model_dump()`, and two tests that call `plan_task_edit` itself with only the network stubbed. A third recurring hazard is unstubbed repository calls reaching the LIVE database from inside tests; it happened three times this session and each time surfaced as either a uuid-syntax error or a supabase deprecation warning in the output. **If the suite prints that warning, a test is on the network.**

## How to resume
Read this file, then `docs/DECISIONS.md` from "the category stops being a word and becomes a row" onward — that is where the reasoning lives. `docs/DATABASE_SCHEMA.md` has the tables and, more usefully, why each foreign key is SET NULL rather than CASCADE.
