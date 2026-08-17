ACTIVE TASK — Verify recurring tasks against a real browser, a real midnight, and a real reminder
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Context
Recurring tasks Slice 1 is code-complete on `main` as of 2026-08-17 (40 commits, 197 backend tests, frontend build clean, ESLint at its pre-existing baseline, zero `eslint-disable` anywhere). Design: `docs/superpowers/specs/2026-08-15-recurring-tasks-design.md`. Plan: `docs/superpowers/plans/2026-08-15-recurring-tasks.md`. Two migrations already applied and verified by the owner reading the query output, not assumed: `recurrence_rules` (2026-08-15) and `tasks.cancelled_at` (2026-08-16).

**None of that is the feature working.** 197 unit tests exercise the generator, the missed-closure, cancellation and the scheduler wiring against a fake repository; none of it has run against the live database with a real rule, and no recurring task has ever been generated in production. Nothing in the frontend has been seen running either — not the Recurrences screen, not the New/Edit form, not the ↻ marker, not the Settings row it hangs from. The build compiles and the EN/EL translations resolve; that is all that has been checked.

## Gap 1 — the owner's six-step browser walkthrough
Handed to the owner 2026-08-17. Not yet reported back.
- [ ] Settings → Recurrences → empty state shows.
- [ ] New recurrence → name "Χάπι", time 09:00, all seven days → Save.
- [ ] Today shows a "Χάπι" task for today; Upcoming and the calendar show the next thirteen.
- [ ] Toggle the rule off → the future ones disappear, today's stays.
- [ ] Toggle it on → they come back.
- [ ] Delete → confirm → they are gone.

## Gap 2 — a rule surviving a real midnight, unattended
- [ ] With a rule created and its window materialized, let a real midnight pass with nothing run by hand.
- [ ] Confirm the next day's occurrence appears from the scheduler's own ~2-minute tick, `materialized_through` having advanced by exactly one day — no jump, no gap, no duplicate row.

## Gap 3 — a missed occurrence closing itself on day two
- [ ] Let a generated occurrence go untouched past its one day of grace.
- [ ] Confirm `missed_at` gets stamped by the tick itself, unattended — not by a test calling the function directly — and the row leaves Today/Upcoming/the calendar on its own without being deleted.

## Gap 4 — a reminder firing for a generated occurrence
- [ ] A rule-generated occurrence with the reminder bell on actually rings at the right time. The reminder path (`notification_sent`, the existing scheduler) has never been exercised against a row this feature created — only against ordinary tasks.

## Gap 5 — the reminder bell is silently inert without a time
Closed: `RecurrenceForm.jsx`'s reminder `Switch` now adopts `TaskDetailSheet.jsx`'s existing `disabledReason` pattern (`checked={Boolean(notify && dueTime)}`, `disabledReason` set to `task.no_time_for_reminder` when `dueTime` is empty), matching the same guard already used for a single task's bell.

## Slice 2 — not started
The AI understanding "every Monday" is designed (same spec) but not implemented. **Do not start it until Slice 1 has been seen working in a browser** — the whole point of the two-slice split is that a duplicate task must be attributable to either the generator or the extractor, never ambiguously to both.

## How to resume
Read this file, then PROJECT_STATUS.md's "In progress" section for the Recurring tasks entry it summarizes.

**There is a fuller record than either.** `.superpowers/sdd/2026-08-15-recurring-tasks/progress.md` is the controller's ledger from the session that built this — every defect found and how, every plan error, every controller mistake, and what was verified by what evidence. It is git-ignored, so it exists only on the machine that built this; it is not in the repo history. Read it before continuing this feature, and do not trust a summary of it over the file itself. Highlights it records that no other doc does: the `create_task_manual` bug that would have inserted ~8,000 tasks a day, the CHECK constraint whose own comment lied about what it enforced, and the same root cause appearing three separate times — one value carrying two facts, with the failure case silently losing.
