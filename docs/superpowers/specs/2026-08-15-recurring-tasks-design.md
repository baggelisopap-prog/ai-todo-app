# Recurring tasks: one row per occurrence, and a grace day before it is forgotten

**Date**: 2026-08-15
**Status**: design approved by the owner, not implemented
**Audience decision**: personal use is the example, **business is the bet** (owner, 2026-08-15)

## What is wanted

A daily or weekly commitment — a pill, a Monday-to-Friday duty — entered once and
appearing by itself, "like the alarms on a phone" (owner's words). Time, a set of
weekday toggles, an on/off switch.

Nothing in the app does this today. The only trace of the idea is a line in the
long-dead `doc.md` wish list ("Επαναληπτικά tasks — κάθε Δευτέρα στο γυμναστήριο"),
never designed and never in BACKLOG.md.

## The question that decided the shape

Asked as "what do the big apps do", and the answer is not unanimous:

| App | Behaviour |
|---|---|
| Todoist, TickTick, Microsoft To Do, Apple Reminders | **One live row.** Completing advances its date; missing it never creates a second one. History lives in a separate activity log, not the list. |
| Google Tasks | **A row per occurrence, kept forever.** Answers "was it done?" but the missed ones pile up — the product's single most-complained-about behaviour. |
| Streaks, Loop, Habitica | A cell per day in a grid, with a streak. A missed day is a red square, not a to-do. |

The owner's instinct — "one day overdue, then it goes" — is nobody's exact
behaviour, and it turned out to be the right one, for a reason worth writing down.

**The Todoist model is the wrong one for a business**, and this is the load-bearing
argument of the whole design. A recurring business duty is an obligation with
accountability: "was Monday's check done?" must have an answer. Todoist has *one*
row, not thirty, so it cannot answer. Worse: while Monday's row hangs open there
is **no row for Tuesday at all**, so a colleague who did Tuesday's has nowhere to
record it. For a fifteen-person operation that is data loss, not tidiness.

The framing "Todoist or Google, let the user pick" conflates two independent
properties:

1. **Does each occurrence become its own record?** — this is what buys the history
2. **Does an unfinished one stay visible forever?** — this is what causes the mess

Google answers yes to both, Todoist no to both. They are not coupled. A row per
occurrence *plus* automatic closure after a grace window gives both halves right,
with **one** model and **one** number.

Offering both engines was rejected for a second reason: this repo has already paid
for parallel mechanisms. `overdue_count` was deleted because "two mechanisms
answering the same question is exactly the bug shape the invented-filters fix had
to correct" (PROJECT_STATUS.md). Two recurrence engines would mean the Today view,
the daily summary, the agent's day view and calendar sync each handling two shapes.

## Decisions taken, with the owner's answers

| Question | Answer |
|---|---|
| Missed occurrence | **One day of grace**, then auto-closed as missed. Recorded, not deleted. |
| Grace configurable? | **No UI in v1** — a fixed default, but the column exists, so making it per-rule later is UI work, not a migration. |
| Which recurrence kinds | **Weekly (a set of weekdays) + monthly.** Not "every N days", not "every second Tuesday". |
| Where rules come from | **Form and AI extraction, both in v1.** The chat agent is explicitly out. |
| How far ahead occurrences exist | **A rolling ~14-day window** of real rows. |
| Who a rule belongs to | **The user who made it.** Assignment to a colleague is a later, separate project. |
| Architecture | A dedicated rules table (not a "template task", not iCal RRULE). |

### Why a rolling window of real rows

Upcoming, the calendar grid, the daily summary and the agent's `search_tasks` all
read the same `tasks` table. Anything that is not a row there is invisible in all
of them. Materialising a real row per occurrence means **every one of those paths
works with no change at all** — the single largest saving in this design.

The two alternatives were rejected: only-today's-occurrence leaves the calendar and
"what do I have Friday?" blind to every recurrence, which is unacceptable for a
business that plans a week ahead; and computing occurrences virtually at read time
is elegant in the database but requires the repository, the agent, calendar sync
and the summary to each learn a second kind of task.

### Why a dedicated table, and not the two alternatives

**A "template task"** — one `tasks` row flagged as a template — needs no new table,
but creates a second invisible kind of task, so all ~15 existing filters must learn
to hide it. That is the same problem `missed_at` already creates, in double. And a
template has no `due_date`, so it would live forever as an undated task in Browse.

**Full iCal RRULE** with `dateutil.rrule` covers everything for ever, but adds a
dependency and puts `FREQ=WEEKLY;BYDAY=MO,WE` in a column no one can eyeball in the
Supabase editor, for exactly two cases. It is the right destination if Google
Calendar recurrence import/export is ever wanted; it is not the right start.

## What the user sees

### Creating one

A **"Repeat"** switch in the new-task sheet. Opened, it gives the alarm-clock
shape:

- **Time** — optional. A recurrence with no time is allowed; it simply never rings.
- **Days** — seven toggles Δ Τ Τ Π Π Σ Κ. All seven = daily.
- **or Monthly** — a day of the month, or "last day". **If the chosen day does not
  exist in a month (the 31st in February), it falls back to that month's last day.**
  The month is never skipped.
- **Starts on / ends on** — the end date optional.

Plus everything an ordinary task has: name, description, category, priority,
checklist, reminder bell, calendar toggle. Each is inherited by every occurrence.

### After saving

The next fortnight's occurrences **appear immediately**, not on the next cron tick.
Today's in Today, the rest in Upcoming and on the calendar.

And the point of the whole design: **each occurrence is an ordinary task.** Tick it,
edit it, change its time, drag it to another day, add a note, delete it. The bell
rings as for any task. The calendar shows it. The AI assistant knows it — "what do
I have Friday?" lists it, "I finished the gym" closes it. Nothing anywhere needs a
new trick.

A small ↻ marker on the card says it came from a recurrence and opens its rule.

### When it is missed

Monday, the pill was not ticked. **Tuesday**: Monday's shows as overdue alongside
today's. **Wednesday**: Monday's leaves the list by itself and is recorded as
missed.

It is not deleted. "How many times was the check done this month?" has an answer,
while the list never fills with overdue.

### Managing them

A **"Recurrences"** list in Settings: what exists, when it fires, an on/off switch
per rule.

- **Off** — stops now, not in a fortnight. Upcoming occurrences from tomorrow on
  are removed; today's stays, and so does the history. Turning it back on
  regenerates them. Someone switching off "take the pill" because they are away
  for a week means *stop*, and leaving fourteen already-generated tasks standing
  would be the opposite of what the switch says.
- **Edit** — takes effect **from tomorrow**. Today's occurrence is left alone (it
  may already be half-done, or have rung). To change today's, edit it as the
  ordinary task it is.
- **Delete** — every *open* occurrence goes, past and future. Completed and missed
  ones stay as ordinary tasks.

### What the AI does (slice 2)

"every Monday and Wednesday gym at 7" is understood as a recurrence rather than a
single task.

It is not activated on its own. It lands in the **Inbox for approval**, because a
recurrence is not one task — it is a standing commitment that will generate rows
for months. It is shown as a sentence ("Every Monday & Wednesday, 19:00"), approved
or rejected. **Until approved it produces nothing.**

## Data model

### New table `recurrence_rules`

Per-user, RLS enabled with the same owner-only policy as every other table, indexed
on `user_id`, `ON DELETE CASCADE` to `auth.users`.

| Group | Columns |
|---|---|
| Identity | `id` UUID PK, `user_id` UUID NOT NULL, `created_at`, `updated_at` TIMESTAMPTZ |
| Task template | `task_name` TEXT NOT NULL, `description` TEXT, `category` TEXT CHECK in (Business/Personal/Unknown), `priority` TEXT CHECK in (P1/P2/P3), `due_time` TEXT nullable (HH:MM), `checklist` JSONB default `[]` |
| The rule | `freq` TEXT NOT NULL CHECK in (`weekly`, `monthly`), `weekdays` INTEGER[] (ISO 1=Mon…7=Sun), `month_day` INTEGER (1–31, or **-1 = last day**) |
| Life | `is_active` BOOL default true, `starts_on` TEXT NOT NULL, `ends_on` TEXT nullable, `approval_status` BOOL default true |
| Inherited | `notify_enabled` BOOL default false, `calendar_sync_enabled` BOOL default false |
| Maintenance | `grace_days` INTEGER default 1, `materialized_through` TEXT nullable |

`category` deliberately excludes `Hostaway` — that category is owned by the
integration and its escalation logic; a hand-made recurrence must not enter it.

A CHECK constraint enforces coherence: `weekly` requires a non-empty `weekdays`,
`monthly` requires a `month_day`. An incoherent rule cannot be stored, so the
generator never has to defend against one.

### Added to `tasks`

- `recurrence_rule_id` UUID nullable, FK → `recurrence_rules(id)` **ON DELETE SET NULL**
- `occurrence_date` TEXT nullable
- `missed_at` TIMESTAMPTZ nullable
- **`UNIQUE (recurrence_rule_id, occurrence_date)`**
- a partial index on `recurrence_rule_id WHERE recurrence_rule_id IS NOT NULL`

Ordinary tasks have both key columns NULL, and Postgres treats NULLs as distinct in
a unique constraint, so they are entirely unaffected by it.

**`occurrence_date` is separate from `due_date`, and this is the subtlest point in
the design.** Drag Monday's task to Tuesday — `QuickReschedule` already exists — and
`due_date` becomes Tuesday while the occurrence still *is* Monday's. Had the
uniqueness key been `due_date`, the next generator pass would see Monday missing and
create it again: a duplicate task every time anything is rescheduled.
`occurrence_date` is written once and never changes.

**The uniqueness constraint is the real duplicate guard**, deliberately in the
database rather than in Python. The scheduler runs every ~2 minutes and any crash,
retry or overlapping tick must be harmless.

**`ON DELETE SET NULL`**: deleting a rule leaves its completed history as ordinary
tasks. History survives the rule.

### Why "missed" is a new column and not `is_rejected`

`is_rejected` is the flag that hides a task everywhere — ~15 places across
`is_open_task()`, TodayView, UpcomingList, CalendarView, BrowseView and InboxView —
so reusing it would be almost free. It is refused because it means *"the user
rejected the AI's suggestion"* and is preserved on purpose to feed the learning
loop ("Soft delete > hard delete — data preservation for AI learning"). Filling it
with hundreds of auto-closed rows the AI never proposed would corrupt the one
signal that data exists to carry.

### One targeted cleanup this feature forces

The backend already declares `is_open_task()` the single source of truth, so the
missed check is **one line** there. The frontend has the same predicate hand-written
in five separate files. A shared `isVisibleTask()` is introduced and all five point
at it — otherwise the same condition is added by hand five times and the sixth view
someone writes will forget it.

### Room left for assignment

`assigned_to` on the rule is one column when it is wanted; occurrences already
carry `user_id`. Nothing here has to be rewritten for it.

### Snapshot fields on a generated occurrence

`ai_suggested_category` / `ai_suggested_priority` are non-nullable and
`_supabase_row_to_task` raises without them. A rule-generated occurrence mirrors the
rule's chosen values — the precedent already exists for non-AI tasks at
`repository.py`'s Google-event conversion, which does exactly this with a comment
explaining that no AI suggested anything here.

## The generator

A new **pure module `recurrence.py`, with no I/O** — the same shape as
`hostaway_threading.py`, which this repo established and which is the reason "date →
occurrences" can be tested exhaustively without a database, a network or Gemini.

- `occurrences_between(rule, start, end) -> list[date]`
- `is_missed(occurrence_date, today, grace_days) -> bool` — true when
  `(today - occurrence_date).days > grace_days`. With `grace_days = 1`: Monday's
  occurrence is visible on Tuesday (1 > 1 is false) and missed on Wednesday.
- monthly day clamping, including `-1` for last-day-of-month

Dates stay TEXT `YYYY-MM-DD` like every other date in this app, and "today" is read
in `Europe/Athens` from the clock the scheduler already reads once per tick.

## Where it runs

Two trigger points, one code path:

1. **Synchronously**, when a rule is created, edited or approved — so the user sees
   the tasks appear at once rather than within two minutes.
2. **In the existing per-user scheduler tick**, which already loops users, already
   has the per-user `try/except` added after the Hostaway encryption incident, and
   already reads the clock once.

The tick short-circuits on `materialized_through >= today + horizon`: one field
comparison, no query, so real work happens about once a day per rule. This is the
same cheap-guard pattern `daily_summary_last_sent_date` already uses.

Generation reads the rule's existing `occurrence_date`s inside the window, inserts
the set difference, and relies on the unique constraint as the backstop against a
race.

The window starts at `max(today, starts_on)` — **never in the past.** A rule made
at 18:00 whose time is 09:00 still gets today's occurrence, arriving already
overdue. That is deliberate: the day was part of what the user asked for, and
silently skipping it would be the app deciding the day is a write-off.

A rule created from the form is approved on creation; only the AI path (slice 2)
produces an unapproved one.

**Occurrences are created already approved** — the human approved the rule, so they
must never queue up in the Inbox. A Monday-to-Friday duty producing five Inbox items
a week to approve would make the feature unusable.

**Zero AI cost.** The generator makes no model call. Slice 2 adds no extra call
either — the extractor already runs; only its output schema grows.

## Closing missed occurrences

In the same tick, per user: an occurrence that is still open, not completed, not
rejected, and older than its rule's grace window gets `missed_at` stamped. The
existing reminder path cannot re-fire on it (reminders only fire in a window
*before* the due time, and `notification_sent` already guards).

A missed occurrence keeps any Google Calendar event it had. The event is an honest
record of what was scheduled; deleting it would erase that.

## Rule edit, pause and delete

**Edit** — delete this rule's open occurrences strictly after today, reset
`materialized_through`, regenerate. Two things deliberately survive an edit:
completed occurrences, and any occurrence the user moved by hand
(`due_date != occurrence_date`). Someone who deliberately shifted next Tuesday's
task should not lose that because the rule's time changed.

**Pause** (`is_active = false`) — stops generation *and* removes this rule's open
occurrences after today, exactly as an edit does. Today's and the history stay.
Resuming regenerates the window. Pause and edit therefore share one operation:
"drop this rule's open future, then regenerate if it is still active".

**Delete** — removes every *open* occurrence, past and future; keeps completed and
missed ones. Past open ones must go too: once the rule row is gone there is no
`grace_days` to auto-close them by, so they would hang overdue for ever.

## Slice 2 — AI extraction

`SingleTask` gains an optional recurrence object (`freq`, `weekdays`, `month_day`).
The shared text/audio system prompt learns one rule: if the user expresses
repetition, fill it and leave `due_date` null.

An extracted item carrying recurrence creates a **rule with `approval_status =
false`**, which materialises nothing. The Inbox lists pending rules above pending
tasks, rendered as a human sentence. Approving sets the flag and materialises
immediately.

`task_agent.py` (the per-card editor) and the chat agent are untouched.

## Order of work

Two slices in one spec, and the order is the point: **slice 1 is the mechanism and
the form, slice 2 is the AI.** Not to cut scope — both were asked for — but so the
generator can be watched running correctly before the model's uncertainty lands on
top of it. If a duplicate task ever appears, it must be obvious whether the
generator or the extractor produced it.

## What stays the same

Reminders, the daily summary, Hostaway escalation and reply polling, calendar sync,
the chat agent, the per-card agent, `token_usage_log`, and every existing endpoint.
`is_open_task()` gains one condition. Occurrences are ordinary tasks, so every read
path already handles them.

## What v1 does not do

Streaks and statistics ("26 of 30"), assignment to a colleague, "every 3 days",
"every second Tuesday", and end times (start time only, like an alarm). The data is
stored such that streaks can be added later without rewriting anything.

## Testing

Pure-module tests, no database: weekday expansion across a window; Monday-to-Friday;
all seven; monthly clamping (Jan 31 → Feb 28, and → Feb 29 in a leap year);
`month_day = -1`; `starts_on` / `ends_on` boundaries; the grace boundary on both
sides (visible at +1 day, missed at +2); horizon edges.

Service-level, with a fake repository: running the generator twice creates nothing
the second time; a rescheduled occurrence is not regenerated; a rule edit preserves
completed and hand-moved occurrences; deleting a rule keeps history and removes open
rows.

## Open risks

- **`Europe/Athens` is hardcoded app-wide.** A user elsewhere gets Athens days. Pre-existing, not fixed here, but recurrence makes it visible daily rather than occasionally.
- **Row volume against the agent.** A daily rule keeps ~14 live rows. `search_tasks` returns at most 30, so a user with several daily recurrences could crowd out other results on a "this week" question. The day view is already capped and unaffected. Worth watching once real data exists.
- **The extractor becoming eager** in slice 2 — turning any "remind me daily" phrasing into a standing rule. The approval gate is the mitigation, and is the reason it exists.
