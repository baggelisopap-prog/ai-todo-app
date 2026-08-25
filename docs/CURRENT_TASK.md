ACTIVE TASK — Verify recurring tasks against a real midnight, a real reminder, and the new make-this-repeat path
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Context
Recurring tasks Slice 1 is code-complete on `main` as of 2026-08-17. Design: `docs/superpowers/specs/2026-08-15-recurring-tasks-design.md`. Plan: `docs/superpowers/plans/2026-08-15-recurring-tasks.md`. Two migrations already applied and verified by the owner reading the query output, not assumed: `recurrence_rules` (2026-08-15) and `tasks.cancelled_at` (2026-08-16). No third migration was needed for the work below.

**Gap 1 is closed.** The owner ran the six-step browser walkthrough on 2026-08-17 and reported it passed: the Recurrences screen, the New/Edit form, generation into Today/Upcoming/the calendar, pause, resume and delete all behaved. That is a person watching the feature work, which is what the rest of this file is still asking for elsewhere.

A second slice of UI landed on top of it the same day (below). Backend suite is at 209 (was 197), frontend build clean, ESLint at its pre-existing baseline of 13 (**13 as of that date; 12 since 2026-08-25**, one of them fixed by the calendar pass), `npm run check` green.

## Making an existing task repeat (2026-08-17) — code-complete, not seen running
"Make this repeat" now exists on a task, where before a recurrence could only be born from Settings.

- `POST /recurrences` takes an optional `adopt_task_id`. The task named becomes the rule's FIRST OCCURRENCE — it is given `recurrence_rule_id` and `occurrence_date`, and because the generator skips any `occurrence_date` already on disk, no twin is created for that day. Order is load-bearing: adopt, then materialize.
- Guards, all with tests: a task that is not yours → 404; one that already belongs to a rule → 422; both checked BEFORE the rule row is written, so a failed adoption cannot leave an orphan rule firing every morning. A closed task (completed, rejected, missed, cancelled) is silently not adopted — the rule just starts fresh — and an undated task is pinned to the rule's `starts_on`.
- Adoption LINKS and does not edit: the rule's time/priority/category are not copied over the task's.
- The `↻` marker is now a button reading "Repeats · Mon-Fri", and tapping it opens that rule. `RecurrenceProvider` holds the one copy of the rules and hosts the editor modal, which is what made the marker clickable — the old note about "threading a callback through three components" was solved by a context, not by prop-drilling.
- Two entry points, as the owner asked: the `⋯` menu (shared by the row and the detail sheet) and a "Repeat — Never / Mon-Fri at 09:00" row in `TaskDetailSheet` beside the reminder and calendar switches.
- The form opens prefilled from the task, with the days defaulting to the ONE day that task already falls on, not Mon-Fri.

**Not one pixel of this has been seen in a browser.** Tests cover the backend seam and the pure display helpers; nothing has run in a real browser against a real rule.

## Gap 2 — a rule surviving a real midnight, unattended
- [ ] With a rule created and its window materialized, let a real midnight pass with nothing run by hand.
- [ ] Confirm the next day's occurrence appears from the scheduler's own ~2-minute tick, `materialized_through` having advanced by exactly one day — no jump, no gap, no duplicate row.

## Gap 3 — a missed occurrence closing itself on day two
- [ ] Let a generated occurrence go untouched past its one day of grace.
- [ ] Confirm `missed_at` gets stamped by the tick itself, unattended — not by a test calling the function directly — and the row leaves Today/Upcoming/the calendar on its own without being deleted.

## Gap 4 — a reminder firing for a generated occurrence
- [ ] A rule-generated occurrence with the reminder bell on actually rings at the right time. The reminder path (`notification_sent`, the existing scheduler) has never been exercised against a row this feature created — only against ordinary tasks.

## Gap 5 — the reminder bell is silently inert without a time
Closed: `RecurrenceForm.jsx`'s reminder `Switch` adopts `TaskDetailSheet.jsx`'s existing `disabledReason` pattern, matching the same guard already used for a single task's bell.

## Gap 6 — the make-this-repeat walkthrough
- [ ] On a task due today with no recurrence: `⋯` → Repeat… → the form opens with its name, time and its own weekday already selected → Save.
- [ ] **Today shows exactly ONE copy of that task, still carrying whatever was already ticked in its checklist** — this is the whole point of adoption, and the one thing no test can prove.
- [ ] That task's badge now reads "Επανάληψη · <pattern>"; tapping it reopens the rule for editing.
- [ ] Open a task in the detail sheet → the "Επανάληψη" row reads "Ποτέ" for an ordinary task and the pattern for a recurring one.
- [ ] Edit a rule from Settings → the badge text on already-visible rows updates rather than staying stale.

## Slice 2 — not started
The AI understanding "every Monday" is designed (same spec) but not implemented. With Gap 1 closed, the argument for holding it back is weaker than it was — but Gaps 2-4 and 6 still mean a duplicate task cannot yet be attributed with confidence to the generator rather than the extractor. Owner's call.

## How to resume
Read this file, then PROJECT_STATUS.md's "In progress" section for the Recurring tasks entry it summarizes.

**There is a fuller record than either.** `.superpowers/sdd/2026-08-15-recurring-tasks/progress.md` is the controller's ledger from the session that built Slice 1 — every defect found and how, every plan error, every controller mistake, and what was verified by what evidence. It is git-ignored, so it exists only on the machine that built this; it is not in the repo history. Read it before continuing this feature, and do not trust a summary of it over the file itself. Highlights it records that no other doc does: the `create_task_manual` bug that would have inserted ~8,000 tasks a day, the CHECK constraint whose own comment lied about what it enforced, and the same root cause appearing three separate times — one value carrying two facts, with the failure case silently losing.
