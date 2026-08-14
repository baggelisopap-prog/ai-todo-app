# Recurring Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user sets a task to repeat — weekly on chosen weekdays, or monthly on a chosen day — and its occurrences appear by themselves as ordinary tasks, with one day of grace before a missed one closes itself.

**Architecture:** A `recurrence_rules` table holds the rule. A pure, I/O-free `recurrence.py` turns a rule plus a date window into a list of dates. The existing per-user scheduler tick materialises those dates as ordinary rows in `tasks`, keyed `UNIQUE (recurrence_rule_id, occurrence_date)` so retries are harmless, and stamps `missed_at` on ones older than their grace window. Because occurrences are ordinary tasks, reminders, the calendar, the daily summary and the agent need no changes.

**Tech Stack:** Python 3.11 / FastAPI / Pydantic v2 / Supabase (PostgreSQL) / pytest 8.3.4 · React + Vite + Tailwind v4 + react-i18next.

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-08-15-recurring-tasks-design.md`. It wins any disagreement with this plan.
- **Dates are TEXT `YYYY-MM-DD`** everywhere in this app. Times are TEXT `HH:MM`. Do not introduce `DATE`/`TIME` columns.
- **"Today" is `datetime.now(ZoneInfo("Europe/Athens")).date()`**, and the scheduler already reads that clock once per tick — reuse the read, do not add a second one.
- **ISO weekdays: 1 = Monday … 7 = Sunday** (`date.isoweekday()`). `month_day = -1` means last day of month.
- **Grace is 1 day, fixed in v1.** The column exists; no UI exposes it.
- **Horizon is 14 days.**
- **Occurrences are created already approved** (`approval_status=True`). They must never land in the Inbox.
- **Category `Hostaway` is forbidden** on a recurrence rule — that category belongs to the integration and its escalation logic.
- **`is_rejected` must not be reused** for missed occurrences. It means "the user rejected the AI's suggestion" and feeds the learning loop.
- **`requirements.txt` is UTF-16LE with a BOM** and ships to Render. This feature adds **no** new runtime dependency; do not touch that file.
- **Tests run with:** `./venv/Scripts/python.exe -m pytest tests/ -q` from the repo root.
- **Frontend build check:** `cd frontend && npm run build`.
- **Commit style:** a descriptive sentence as the subject (see `git log`), `docs:` prefix only for documentation-only commits, and every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Do not `git push`.** The owner pushes.

## File Structure

**Backend — created**
- `recurrence.py` — pure date logic. No I/O, no clock, no AI. Mirrors `hostaway_threading.py`.
- `docs/migrations/2026-08-15-recurring-tasks.sql` — run by hand in the Supabase SQL editor.
- `tests/test_recurrence.py` — the pure module.
- `tests/test_recurrence_repository.py` — repository queries against a fake Supabase.
- `tests/test_recurrence_materialization.py` — the service: generation, idempotency, missed closure, regeneration.
- `tests/test_recurrence_api.py` — the endpoints via `TestClient`.
- `tests/test_recurrence_extraction.py` — slice 2, the extraction → pending-rule path.

**Backend — modified**
- `models.py` — `RecurrenceRule`, `RecurrenceSpec` (slice 2), three new `TaskRecord` fields.
- `repository.py` — rule CRUD + occurrence queries.
- `services.py` — materialisation, missed closure, one wiring block in `run_notification_scheduler`.
- `agent_tools.py` — one line in `is_open_task`.
- `main.py` — four endpoints.
- `ai_engine.py` — slice 2, one prompt section.
- `docs/DATABASE_SCHEMA.md`, `docs/PROJECT_STATUS.md`, `docs/CURRENT_TASK.md`.

**Frontend — created**
- `frontend/src/components/RecurrencesView.jsx` — the Settings sub-screen: list, on/off, delete.
- `frontend/src/components/RecurrenceForm.jsx` — create/edit form.

**Frontend — modified**
- `frontend/src/utils/taskDisplay.js` — `isVisibleTask()`, the shared predicate.
- `frontend/src/components/{TodayView,UpcomingList,InboxView,BrowseView,CalendarView}.jsx` — point at it.
- `frontend/src/api.js` — four functions.
- `frontend/src/components/SettingsModal.jsx` — one row, one screen.
- `frontend/src/components/TaskRow.jsx` — the ↻ marker.
- `frontend/src/locales/{en,el}.json`.

---

# SLICE 1 — the mechanism and the form

---

### Task 1: Pure module — weekly expansion

**Files:**
- Create: `recurrence.py`
- Test: `tests/test_recurrence.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `WEEKLY: str`, `MONTHLY: str`, `LAST_DAY_OF_MONTH: int`, `DEFAULT_GRACE_DAYS: int`, `MATERIALIZATION_HORIZON_DAYS: int`, `parse_date(value: Optional[str]) -> Optional[date]`, `format_date(value: date) -> str`, `occurrences_between(*, freq: str, weekdays: Optional[list[int]], month_day: Optional[int], window_start: date, window_end: date, starts_on: date, ends_on: Optional[date] = None) -> list[date]`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_recurrence.py`:

```python
"""The generator: a rule plus a window becomes a list of dates. No I/O anywhere."""
from datetime import date

import recurrence


def _weekly(weekdays, window_start, window_end, starts_on=None, ends_on=None):
    return recurrence.occurrences_between(
        freq=recurrence.WEEKLY,
        weekdays=weekdays,
        month_day=None,
        window_start=window_start,
        window_end=window_end,
        starts_on=starts_on or window_start,
        ends_on=ends_on,
    )


def test_monday_to_friday_skips_the_weekend():
    # 2026-08-17 is a Monday; the window runs one full week.
    got = _weekly([1, 2, 3, 4, 5], date(2026, 8, 17), date(2026, 8, 23))
    assert got == [
        date(2026, 8, 17), date(2026, 8, 18), date(2026, 8, 19),
        date(2026, 8, 20), date(2026, 8, 21),
    ]


def test_all_seven_weekdays_is_daily():
    got = _weekly([1, 2, 3, 4, 5, 6, 7], date(2026, 8, 17), date(2026, 8, 20))
    assert got == [date(2026, 8, 17), date(2026, 8, 18), date(2026, 8, 19), date(2026, 8, 20)]


def test_a_single_weekday_appears_once_per_week():
    got = _weekly([3], date(2026, 8, 17), date(2026, 8, 31))  # Wednesdays
    assert got == [date(2026, 8, 19), date(2026, 8, 26)]


def test_both_window_ends_are_inclusive():
    got = _weekly([1], date(2026, 8, 17), date(2026, 8, 17))
    assert got == [date(2026, 8, 17)]


def test_nothing_is_generated_before_starts_on():
    got = _weekly([1, 2, 3, 4, 5], date(2026, 8, 17), date(2026, 8, 21),
                  starts_on=date(2026, 8, 19))
    assert got == [date(2026, 8, 19), date(2026, 8, 20), date(2026, 8, 21)]


def test_nothing_is_generated_after_ends_on():
    got = _weekly([1, 2, 3, 4, 5], date(2026, 8, 17), date(2026, 8, 21),
                  ends_on=date(2026, 8, 19))
    assert got == [date(2026, 8, 17), date(2026, 8, 18), date(2026, 8, 19)]


def test_an_empty_weekday_set_generates_nothing():
    """The database CHECK forbids this, so it must fail quietly rather than crash a tick."""
    assert _weekly([], date(2026, 8, 17), date(2026, 8, 23)) == []
    assert _weekly(None, date(2026, 8, 17), date(2026, 8, 23)) == []


def test_a_backwards_window_generates_nothing():
    assert _weekly([1, 2, 3, 4, 5], date(2026, 8, 23), date(2026, 8, 17)) == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'recurrence'`

- [ ] **Step 3: Write the minimal implementation**

Create `recurrence.py`:

```python
"""
Pure date logic for recurring tasks. No I/O, no clock reads, no AI — every
function here is arithmetic over values it was handed, which is why "which
days does this rule produce?" can be tested exhaustively without a database.

Same shape and same reason as hostaway_threading.py. See
docs/superpowers/specs/2026-08-15-recurring-tasks-design.md.
"""

import calendar
import logging
from datetime import date, datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

WEEKLY = "weekly"
MONTHLY = "monthly"

# month_day = -1 means "the last day of whatever month this is", which is a
# different request from "the 31st" and cannot be expressed as a number.
LAST_DAY_OF_MONTH = -1

# One day of grace, then a missed occurrence closes itself. Monday's is still
# visible on Tuesday and gone on Wednesday. Fixed in v1; the column exists so
# making it per-rule later is UI work rather than a migration.
DEFAULT_GRACE_DAYS = 1

# How far ahead real rows exist. Upcoming, the calendar grid, the daily summary
# and the agent's search all read the tasks table, so anything not materialised
# is invisible in every one of them.
MATERIALIZATION_HORIZON_DAYS = 14

_DATE_FORMAT = "%Y-%m-%d"


def parse_date(value: Optional[str]) -> Optional[date]:
    """Parses a stored YYYY-MM-DD string. Returns None on anything unusable."""
    if not value:
        return None
    try:
        return datetime.strptime(value, _DATE_FORMAT).date()
    except (ValueError, TypeError):
        logger.warning(f"[recurrence] Unparseable date: {value!r}")
        return None


def format_date(value: date) -> str:
    return value.strftime(_DATE_FORMAT)


def occurrences_between(
    *,
    freq: str,
    weekdays: Optional[list[int]],
    month_day: Optional[int],
    window_start: date,
    window_end: date,
    starts_on: date,
    ends_on: Optional[date] = None,
) -> list[date]:
    """
    Every date this rule produces inside [window_start, window_end], both ends
    inclusive, clipped to the rule's own starts_on/ends_on.

    An incoherent rule returns [] rather than raising: the database CHECK
    already forbids one, and a scheduler tick must not die over data it cannot
    have created.
    """
    first = max(window_start, starts_on)
    last = window_end if ends_on is None else min(window_end, ends_on)
    if first > last:
        return []

    if freq == WEEKLY:
        return _weekly_occurrences(weekdays, first, last)

    return []


def _weekly_occurrences(weekdays: Optional[list[int]], first: date, last: date) -> list[date]:
    wanted = set(weekdays or [])
    if not wanted:
        return []

    out = []
    cursor = first
    while cursor <= last:
        if cursor.isoweekday() in wanted:
            out.append(cursor)
        cursor += timedelta(days=1)
    return out
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence.py -q`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add recurrence.py tests/test_recurrence.py
git commit -F- <<'EOF'
A rule and a window become a list of dates, with no I/O in between

Same shape as hostaway_threading.py, for the same reason: "which days
does Monday-to-Friday produce?" is arithmetic, so it can be tested
exhaustively without a database, a network or Gemini.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Pure module — monthly expansion and the 31st

**Files:**
- Modify: `recurrence.py`
- Test: `tests/test_recurrence.py`

**Interfaces:**
- Consumes: `occurrences_between`, `WEEKLY`, `MONTHLY`, `LAST_DAY_OF_MONTH` from Task 1.
- Produces: `clamp_month_day(year: int, month: int, month_day: int) -> date`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_recurrence.py`:

```python
def _monthly(month_day, window_start, window_end, starts_on=None, ends_on=None):
    return recurrence.occurrences_between(
        freq=recurrence.MONTHLY,
        weekdays=None,
        month_day=month_day,
        window_start=window_start,
        window_end=window_end,
        starts_on=starts_on or window_start,
        ends_on=ends_on,
    )


def test_the_first_of_the_month():
    got = _monthly(1, date(2026, 8, 15), date(2026, 11, 15))
    assert got == [date(2026, 9, 1), date(2026, 10, 1), date(2026, 11, 1)]


def test_the_thirty_first_falls_back_to_the_last_day_of_a_short_month():
    """February has no 31st. The month must not be skipped."""
    got = _monthly(31, date(2027, 1, 1), date(2027, 4, 30))
    assert got == [
        date(2027, 1, 31),
        date(2027, 2, 28),
        date(2027, 3, 31),
        date(2027, 4, 30),
    ]


def test_the_fallback_knows_about_leap_years():
    got = _monthly(31, date(2028, 2, 1), date(2028, 2, 29))
    assert got == [date(2028, 2, 29)]


def test_last_day_of_month_is_its_own_request():
    got = _monthly(recurrence.LAST_DAY_OF_MONTH, date(2026, 8, 1), date(2026, 10, 31))
    assert got == [date(2026, 8, 31), date(2026, 9, 30), date(2026, 10, 31)]


def test_a_monthly_rule_respects_the_window_edges():
    got = _monthly(15, date(2026, 8, 16), date(2026, 9, 14))
    assert got == []


def test_a_monthly_rule_with_no_day_generates_nothing():
    assert _monthly(None, date(2026, 8, 1), date(2026, 12, 31)) == []


def test_clamp_month_day_directly():
    assert recurrence.clamp_month_day(2027, 2, 31) == date(2027, 2, 28)
    assert recurrence.clamp_month_day(2028, 2, 31) == date(2028, 2, 29)
    assert recurrence.clamp_month_day(2026, 8, 15) == date(2026, 8, 15)
    assert recurrence.clamp_month_day(2026, 9, recurrence.LAST_DAY_OF_MONTH) == date(2026, 9, 30)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence.py -q`
Expected: FAIL — the monthly tests return `[]`, and `AttributeError: module 'recurrence' has no attribute 'clamp_month_day'`

- [ ] **Step 3: Write the minimal implementation**

In `recurrence.py`, add `clamp_month_day` and `_monthly_occurrences`, and replace the `return []` fallthrough in `occurrences_between`:

```python
def clamp_month_day(year: int, month: int, month_day: int) -> date:
    """
    The rule's day of the month, inside a month that may not have it.

    "The 31st" in February becomes the 28th (29th in a leap year) rather than
    skipping the month: a monthly obligation the user asked for must not
    silently vanish four times a year.
    """
    last = calendar.monthrange(year, month)[1]
    if month_day == LAST_DAY_OF_MONTH:
        return date(year, month, last)
    return date(year, month, min(month_day, last))


def _monthly_occurrences(month_day: Optional[int], first: date, last: date) -> list[date]:
    if month_day is None:
        return []

    out = []
    year, month = first.year, first.month
    while (year, month) <= (last.year, last.month):
        candidate = clamp_month_day(year, month, month_day)
        if first <= candidate <= last:
            out.append(candidate)
        month += 1
        if month > 12:
            year, month = year + 1, 1
    return out
```

And in `occurrences_between`, replace the trailing `return []` with:

```python
    if freq == MONTHLY:
        return _monthly_occurrences(month_day, first, last)

    logger.warning(f"[recurrence] Unknown freq {freq!r}; generating nothing")
    return []
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence.py -q`
Expected: PASS, 15 tests

- [ ] **Step 5: Commit**

```bash
git add recurrence.py tests/test_recurrence.py
git commit -F- <<'EOF'
The 31st of February becomes the 28th, rather than skipping the month

A monthly obligation the user asked for must not silently vanish four
times a year, so a day the month does not have falls back to its last
day. "Last day of the month" stays a separate request, because it is one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Pure module — the grace boundary and the window

**Files:**
- Modify: `recurrence.py`
- Test: `tests/test_recurrence.py`

**Interfaces:**
- Consumes: `DEFAULT_GRACE_DAYS`, `MATERIALIZATION_HORIZON_DAYS` from Task 1.
- Produces: `is_missed(*, occurrence_date: date, today: date, grace_days: int = DEFAULT_GRACE_DAYS) -> bool`, `materialization_window(today: date, horizon_days: int = MATERIALIZATION_HORIZON_DAYS) -> tuple[date, date]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_recurrence.py`:

```python
MONDAY = date(2026, 8, 17)
TUESDAY = date(2026, 8, 18)
WEDNESDAY = date(2026, 8, 19)


def test_todays_occurrence_is_never_missed():
    assert recurrence.is_missed(occurrence_date=MONDAY, today=MONDAY) is False


def test_yesterdays_occurrence_survives_one_day_of_grace():
    """Tuesday: Monday's pill is still on the list, overdue."""
    assert recurrence.is_missed(occurrence_date=MONDAY, today=TUESDAY) is False


def test_the_day_after_grace_it_is_missed():
    """Wednesday: Monday's leaves by itself."""
    assert recurrence.is_missed(occurrence_date=MONDAY, today=WEDNESDAY) is True


def test_zero_grace_misses_it_the_very_next_day():
    assert recurrence.is_missed(occurrence_date=MONDAY, today=MONDAY, grace_days=0) is False
    assert recurrence.is_missed(occurrence_date=MONDAY, today=TUESDAY, grace_days=0) is True


def test_a_future_occurrence_is_not_missed():
    assert recurrence.is_missed(occurrence_date=WEDNESDAY, today=MONDAY) is False


def test_the_window_starts_today_and_never_in_the_past():
    start, end = recurrence.materialization_window(MONDAY)
    assert start == MONDAY
    assert end == date(2026, 8, 31)  # 17 + 14


def test_the_window_horizon_is_configurable():
    start, end = recurrence.materialization_window(MONDAY, horizon_days=2)
    assert (start, end) == (MONDAY, date(2026, 8, 19))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence.py -q`
Expected: FAIL — `AttributeError: module 'recurrence' has no attribute 'is_missed'`

- [ ] **Step 3: Write the minimal implementation**

Append to `recurrence.py`:

```python
def is_missed(
    *,
    occurrence_date: date,
    today: date,
    grace_days: int = DEFAULT_GRACE_DAYS,
) -> bool:
    """
    True when this occurrence has outlived its grace and should close itself.

    With grace_days = 1: Monday's occurrence is NOT missed on Tuesday (it is
    merely overdue, and still on the list), and IS missed on Wednesday. The
    comparison is strictly greater-than, which is what makes the day of grace
    a full day rather than a partial one.
    """
    return (today - occurrence_date).days > grace_days


def materialization_window(
    today: date,
    horizon_days: int = MATERIALIZATION_HORIZON_DAYS,
) -> tuple[date, date]:
    """
    The span real rows must exist for, both ends inclusive.

    It starts at today and NEVER in the past. A rule created at 18:00 whose
    time is 09:00 still gets today's occurrence, arriving already overdue —
    deliberately, because the day was part of what the user asked for and
    skipping it would be the app deciding the day is a write-off.
    """
    return today, today + timedelta(days=horizon_days)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence.py -q`
Expected: PASS, 22 tests

- [ ] **Step 5: Commit**

```bash
git add recurrence.py tests/test_recurrence.py
git commit -F- <<'EOF'
One day of grace, and a window that never starts in the past

Monday's occurrence is overdue on Tuesday and forgotten on Wednesday.
The comparison is strictly greater-than, which is what makes the grace
a whole day rather than a partial one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: The migration, and the schema doc

**Files:**
- Create: `docs/migrations/2026-08-15-recurring-tasks.sql`
- Modify: `docs/DATABASE_SCHEMA.md`

**Interfaces:**
- Consumes: nothing.
- Produces: table `recurrence_rules`; columns `tasks.recurrence_rule_id`, `tasks.occurrence_date`, `tasks.missed_at`; constraint `tasks_recurrence_occurrence_key`.

- [ ] **Step 1: Write the migration**

Create `docs/migrations/2026-08-15-recurring-tasks.sql`:

```sql
-- Recurring tasks — run in the Supabase SQL Editor.
-- Design: docs/superpowers/specs/2026-08-15-recurring-tasks-design.md
--
-- The rule lives here; its occurrences are ORDINARY rows in tasks, which is
-- what lets Upcoming, the calendar, reminders, the daily summary and the agent
-- handle them without a single change.

create table if not exists recurrence_rules (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,

  -- the task template, copied into every occurrence
  task_name             text not null,
  description           text not null default '',
  category              text not null default 'Unknown'
                          check (category in ('Business', 'Personal', 'Unknown')),
  priority              text not null default 'P3'
                          check (priority in ('P1', 'P2', 'P3')),
  due_time              text,
  checklist             jsonb not null default '[]'::jsonb,

  -- the rule itself. weekdays is ISO: 1 = Monday .. 7 = Sunday.
  -- month_day = -1 means "the last day of the month", which is a different
  -- request from "the 31st" and cannot be expressed as a number.
  freq                  text not null check (freq in ('weekly', 'monthly')),
  weekdays              integer[],
  month_day             integer,

  starts_on             text not null,
  ends_on               text,
  is_active             boolean not null default true,
  approval_status       boolean not null default true,

  -- inherited by each occurrence
  notify_enabled        boolean not null default false,
  calendar_sync_enabled boolean not null default false,

  grace_days            integer not null default 1,
  materialized_through  text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- An incoherent rule cannot be stored, so the generator never has to defend
  -- against one at four in the morning.
  constraint recurrence_rules_shape check (
    (freq = 'weekly'  and weekdays is not null and array_length(weekdays, 1) > 0)
    or
    (freq = 'monthly' and month_day is not null
                      and (month_day = -1 or (month_day >= 1 and month_day <= 31)))
  )
);

create index if not exists recurrence_rules_user_id_idx on recurrence_rules (user_id);

alter table recurrence_rules enable row level security;

drop policy if exists recurrence_rules_owner on recurrence_rules;
create policy recurrence_rules_owner
  on recurrence_rules
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The same updated_at trigger tasks already uses.
drop trigger if exists set_updated_at on recurrence_rules;
create trigger set_updated_at
  before update on recurrence_rules
  for each row execute function update_updated_at_column();

-- ---------------------------------------------------------------------------
-- tasks: which rule produced this row, which occurrence it is, and whether it
-- was forgotten.
-- ---------------------------------------------------------------------------

alter table tasks add column if not exists recurrence_rule_id uuid
  references recurrence_rules (id) on delete set null;
alter table tasks add column if not exists occurrence_date text;
alter table tasks add column if not exists missed_at timestamptz;

-- THE duplicate guard, deliberately in the database. The scheduler runs every
-- ~2 minutes and any crash, retry or overlapping tick must be harmless.
--
-- occurrence_date is NOT due_date: drag Monday's task to Tuesday and due_date
-- becomes Tuesday while the occurrence still IS Monday's. Keyed on due_date,
-- the next pass would see Monday missing and create it again — a duplicate
-- every time anything is rescheduled.
--
-- Ordinary tasks have both columns NULL, and Postgres treats NULLs as distinct
-- in a unique constraint, so they are untouched by this.
alter table tasks drop constraint if exists tasks_recurrence_occurrence_key;
alter table tasks add constraint tasks_recurrence_occurrence_key
  unique (recurrence_rule_id, occurrence_date);

create index if not exists tasks_recurrence_rule_id_idx
  on tasks (recurrence_rule_id) where recurrence_rule_id is not null;
```

- [ ] **Step 2: Run the migration and verify it took**

Paste the file into the Supabase SQL Editor and run it. Then run this verification query and read the output:

```sql
select column_name, data_type
from information_schema.columns
where table_name = 'tasks'
  and column_name in ('recurrence_rule_id', 'occurrence_date', 'missed_at')
order by column_name;

select conname from pg_constraint where conname = 'tasks_recurrence_occurrence_key';
```

Expected: three rows (`missed_at` timestamptz, `occurrence_date` text, `recurrence_rule_id` uuid) and one constraint row. **If any row is missing, stop — every later task depends on this.**

- [ ] **Step 3: Update the schema doc**

In `docs/DATABASE_SCHEMA.md`, add a new table section after the `hostaway_connections` section:

```markdown
### Table: recurrence_rules — per-user recurring task definitions
Added 2026-08-15 (`docs/migrations/2026-08-15-recurring-tasks.sql`). Columns: `id`, `user_id` (FK → auth.users ON DELETE CASCADE), the task template (`task_name`, `description`, `category` CHECK in Business/Personal/Unknown — **deliberately excludes Hostaway**, which belongs to the integration and its escalation logic, `priority`, `due_time` TEXT nullable, `checklist` JSONB), the rule (`freq` CHECK in weekly/monthly, `weekdays` INTEGER[] **ISO 1=Mon..7=Sun**, `month_day` INTEGER where **-1 means last-day-of-month**, a different request from "the 31st"), life (`starts_on` TEXT, `ends_on` TEXT nullable, `is_active` bool — the alarm switch, `approval_status` bool — false only on the AI path), inheritance (`notify_enabled`, `calendar_sync_enabled` — copied into each occurrence), and maintenance (`grace_days` INTEGER default 1 with no UI in v1, `materialized_through` TEXT — the cheap short-circuit that keeps the 2-minute tick from doing real work more than once a day, same pattern as `daily_summary_last_sent_date`). A CHECK constraint `recurrence_rules_shape` makes an incoherent rule unstorable, so the generator never defends against one. RLS enabled, owner-only policy, `updated_at` trigger shared with `tasks`.

### tasks — three columns added 2026-08-15 for recurrence
`recurrence_rule_id` (UUID FK → recurrence_rules **ON DELETE SET NULL**, so completed history survives deleting the rule and becomes ordinary tasks), `occurrence_date` (TEXT), `missed_at` (TIMESTAMPTZ, null unless the occurrence outlived its grace).
**`UNIQUE (recurrence_rule_id, occurrence_date)`** is the real duplicate guard, in the database rather than in Python because the scheduler runs every ~2 minutes and any retry must be harmless. **`occurrence_date` is NOT `due_date`**: rescheduling Monday's task to Tuesday changes `due_date` while the occurrence still IS Monday's — keyed on `due_date` the next pass would recreate Monday, producing a duplicate every time anything is dragged. Ordinary tasks hold NULL in both, and Postgres treats NULLs as distinct in a unique constraint, so they are unaffected.
**`missed_at` is a new column rather than a reuse of `is_rejected`** even though `is_rejected` already hides a task in ~15 places: it means "the user rejected the AI's suggestion" and is preserved to feed the learning loop, so filling it with auto-closed rows the AI never proposed would corrupt the one signal that data exists to carry.
```

- [ ] **Step 4: Commit**

```bash
git add docs/migrations/2026-08-15-recurring-tasks.sql docs/DATABASE_SCHEMA.md
git commit -F- <<'EOF'
A rules table, and the uniqueness that makes a retry harmless

The duplicate guard is a database constraint, not Python: the scheduler
runs every two minutes and any crash or overlapping tick must cost
nothing. occurrence_date is kept separate from due_date because dragging
Monday's task to Tuesday must not make the next pass believe Monday is
missing and create it again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: The models

**Files:**
- Modify: `models.py`
- Test: `tests/test_recurrence.py` (append a model section)

**Interfaces:**
- Consumes: `ChecklistItem` (already in `models.py`).
- Produces: `RecurrenceRule` (Pydantic v2), and `TaskRecord.recurrence_rule_id: Optional[str]`, `TaskRecord.occurrence_date: Optional[str]`, `TaskRecord.missed_at: Optional[str]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_recurrence.py`:

```python
import pytest
from pydantic import ValidationError

from models import RecurrenceRule, TaskRecord


def _rule(**overrides):
    base = dict(task_name="Χάπι", freq="weekly", weekdays=[1, 2, 3, 4, 5],
                starts_on="2026-08-17")
    base.update(overrides)
    return RecurrenceRule(**base)


def test_a_weekly_rule_needs_weekdays():
    with pytest.raises(ValidationError):
        _rule(weekdays=None)
    with pytest.raises(ValidationError):
        _rule(weekdays=[])


def test_weekdays_must_be_iso_one_to_seven():
    with pytest.raises(ValidationError):
        _rule(weekdays=[0])
    with pytest.raises(ValidationError):
        _rule(weekdays=[8])
    assert _rule(weekdays=[7]).weekdays == [7]


def test_a_monthly_rule_needs_a_month_day():
    with pytest.raises(ValidationError):
        RecurrenceRule(task_name="ΦΠΑ", freq="monthly", starts_on="2026-08-17")
    ok = RecurrenceRule(task_name="ΦΠΑ", freq="monthly", month_day=-1, starts_on="2026-08-17")
    assert ok.month_day == -1


def test_a_month_day_out_of_range_is_refused():
    with pytest.raises(ValidationError):
        RecurrenceRule(task_name="ΦΠΑ", freq="monthly", month_day=32, starts_on="2026-08-17")
    with pytest.raises(ValidationError):
        RecurrenceRule(task_name="ΦΠΑ", freq="monthly", month_day=0, starts_on="2026-08-17")


def test_hostaway_is_not_a_category_a_human_can_choose():
    """That category belongs to the integration and its escalation logic."""
    with pytest.raises(ValidationError):
        _rule(category="Hostaway")


def test_dates_and_times_are_validated_like_everywhere_else():
    with pytest.raises(ValidationError):
        _rule(starts_on="17/08/2026")
    with pytest.raises(ValidationError):
        _rule(due_time="7pm")
    assert _rule(due_time="19:00").due_time == "19:00"


def test_a_rule_defaults_to_active_approved_and_one_day_of_grace():
    r = _rule()
    assert (r.is_active, r.approval_status, r.grace_days) == (True, True, 1)


def test_task_record_carries_the_three_new_fields():
    t = TaskRecord(task_name="x", description="", category="Personal", priority="P3",
                   ai_suggested_category="Personal", ai_suggested_priority="P3")
    assert (t.recurrence_rule_id, t.occurrence_date, t.missed_at) == (None, None, None)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence.py -q`
Expected: FAIL — `ImportError: cannot import name 'RecurrenceRule' from 'models'`

- [ ] **Step 3: Write the minimal implementation**

In `models.py`, change the import line at the top to include `model_validator`:

```python
from pydantic import BaseModel, Field, field_validator, model_validator
```

Add these three fields to `TaskRecord`, after `hostaway_thread`:

```python
    # Recurrence (2026-08-15). recurrence_rule_id is which rule produced this
    # row; occurrence_date is WHICH occurrence it is and never changes, even
    # when the user drags the task to another day — see DATABASE_SCHEMA.md for
    # why keying on due_date instead would duplicate a task on every reschedule.
    # missed_at is set when an occurrence outlived its grace and closed itself.
    recurrence_rule_id: Optional[str] = None
    occurrence_date: Optional[str] = None
    missed_at: Optional[str] = None
```

And add `RecurrenceRule` at the end of the file:

```python
class RecurrenceRule(BaseModel):
    """
    A standing commitment: this task, on these days, until further notice.

    The occurrences it produces are ORDINARY TaskRecords — that is the whole
    design. See docs/superpowers/specs/2026-08-15-recurring-tasks-design.md.
    """
    record_id: Optional[str] = None

    # The template copied into every occurrence.
    task_name: str = Field(max_length=80)
    description: str = ""
    # Hostaway is deliberately absent: that category is owned by the
    # integration and its escalation intervals, and a hand-made recurrence
    # must not be able to enter it.
    category: Literal["Business", "Personal", "Unknown"] = "Unknown"
    priority: Literal["P1", "P2", "P3"] = "P3"
    due_time: Optional[str] = None
    checklist: list[ChecklistItem] = Field(default_factory=list)

    # The rule. weekdays is ISO: 1 = Monday .. 7 = Sunday.
    freq: Literal["weekly", "monthly"]
    weekdays: Optional[list[int]] = None
    # -1 means "the last day of the month" — a different request from "the
    # 31st", which clamps to the last day only in months that are shorter.
    month_day: Optional[int] = None

    starts_on: str
    ends_on: Optional[str] = None
    is_active: bool = True
    approval_status: bool = True

    notify_enabled: bool = False
    calendar_sync_enabled: bool = False

    grace_days: int = 1
    materialized_through: Optional[str] = None
    created_at: Optional[str] = None

    @field_validator("starts_on", "ends_on")
    @classmethod
    def validate_dates(cls, v):
        if v is None:
            return v
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("dates must be YYYY-MM-DD")
        return v

    @field_validator("due_time")
    @classmethod
    def validate_due_time(cls, v):
        if v is None:
            return v
        try:
            datetime.strptime(v, "%H:%M")
        except ValueError:
            raise ValueError("due_time must be HH:MM 24-hour format")
        return v

    @model_validator(mode="after")
    def validate_shape(self):
        """
        Mirrors the recurrence_rules_shape CHECK constraint. Both exist on
        purpose: the database is the guarantee, this is the error message.
        """
        if self.freq == "weekly":
            if not self.weekdays:
                raise ValueError("a weekly rule needs at least one weekday")
            if any(d < 1 or d > 7 for d in self.weekdays):
                raise ValueError("weekdays are ISO 1 (Monday) to 7 (Sunday)")
        else:
            if self.month_day is None:
                raise ValueError("a monthly rule needs a month_day")
            if self.month_day != -1 and not (1 <= self.month_day <= 31):
                raise ValueError("month_day must be 1-31, or -1 for the last day")
        return self
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence.py -q`
Expected: PASS, 30 tests

- [ ] **Step 5: Run the whole suite for regressions**

Run: `./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: PASS, 106 existing + 30 new = 136

- [ ] **Step 6: Commit**

```bash
git add models.py tests/test_recurrence.py
git commit -F- <<'EOF'
A rule that cannot be incoherent, in the model as well as the constraint

Both guards exist on purpose: the CHECK is the guarantee, the validator
is the error message the user actually reads. Hostaway is absent from the
category list because that category is owned by the integration and its
escalation intervals.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Repository — rule CRUD

**Files:**
- Modify: `repository.py`
- Test: `tests/test_recurrence_repository.py`

**Interfaces:**
- Consumes: `RecurrenceRule` from Task 5; the module-level `supabase` client in `repository.py`.
- Produces: `create_recurrence_rule(user_id: str, rule: RecurrenceRule) -> RecurrenceRule`, `get_recurrence_rules(user_id: str) -> list[RecurrenceRule]`, `get_recurrence_rule(user_id: str, rule_id: str) -> Optional[RecurrenceRule]`, `update_recurrence_rule(user_id: str, rule_id: str, updates: dict) -> Optional[RecurrenceRule]`, `delete_recurrence_rule(user_id: str, rule_id: str) -> None`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_recurrence_repository.py`:

```python
"""Rule CRUD. Every query must be scoped to user_id — this is a per-user table."""
import repository
from models import RecurrenceRule


class _FakeQuery:
    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a):
        self.sink["select"] = a
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def insert(self, values):
        self.sink["insert"] = values
        return self

    def update(self, values):
        self.sink["update"] = values
        return self

    def delete(self):
        self.sink["delete"] = True
        return self

    def limit(self, n):
        self.sink["limit"] = n
        return self

    def order(self, col, **kw):
        self.sink["order"] = (col, kw)
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows=None):
        self.calls = {}
        self.rows = rows if rows is not None else []

    def table(self, name):
        self.calls["table"] = name
        return _FakeQuery(self.calls, self.rows)


def _row(**overrides):
    row = {
        "id": "rule-1",
        "user_id": "user-1",
        "task_name": "Χάπι",
        "description": "",
        "category": "Personal",
        "priority": "P2",
        "due_time": "09:00",
        "checklist": [],
        "freq": "weekly",
        "weekdays": [1, 2, 3, 4, 5],
        "month_day": None,
        "starts_on": "2026-08-17",
        "ends_on": None,
        "is_active": True,
        "approval_status": True,
        "notify_enabled": True,
        "calendar_sync_enabled": False,
        "grace_days": 1,
        "materialized_through": None,
        "created_at": "2026-08-15T10:00:00+00:00",
    }
    row.update(overrides)
    return row


def _rule():
    return RecurrenceRule(task_name="Χάπι", category="Personal", priority="P2",
                          due_time="09:00", freq="weekly", weekdays=[1, 2, 3, 4, 5],
                          starts_on="2026-08-17", notify_enabled=True)


def test_creating_a_rule_writes_the_user_id_and_returns_the_saved_row(monkeypatch):
    fake = _FakeSupabase([_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    saved = repository.create_recurrence_rule("user-1", _rule())

    assert fake.calls["table"] == "recurrence_rules"
    assert fake.calls["insert"]["user_id"] == "user-1"
    assert "record_id" not in fake.calls["insert"], "record_id is server-generated"
    assert saved.record_id == "rule-1"
    assert saved.weekdays == [1, 2, 3, 4, 5]


def test_listing_rules_is_scoped_to_the_user(monkeypatch):
    fake = _FakeSupabase([_row(), _row(id="rule-2")])
    monkeypatch.setattr(repository, "supabase", fake)

    rules = repository.get_recurrence_rules("user-1")

    assert ("user_id", "user-1") in fake.calls["eq"]
    assert [r.record_id for r in rules] == ["rule-1", "rule-2"]


def test_getting_one_rule_filters_on_both_id_and_user(monkeypatch):
    """A rule id alone must never be enough to read someone else's rule."""
    fake = _FakeSupabase([_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    got = repository.get_recurrence_rule("user-1", "rule-1")

    assert ("user_id", "user-1") in fake.calls["eq"]
    assert ("id", "rule-1") in fake.calls["eq"]
    assert got.record_id == "rule-1"


def test_getting_a_missing_rule_returns_none(monkeypatch):
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([]))
    assert repository.get_recurrence_rule("user-1", "nope") is None


def test_updating_a_rule_is_scoped_and_returns_the_new_state(monkeypatch):
    fake = _FakeSupabase([_row(is_active=False)])
    monkeypatch.setattr(repository, "supabase", fake)

    got = repository.update_recurrence_rule("user-1", "rule-1", {"is_active": False})

    assert fake.calls["update"] == {"is_active": False}
    assert ("user_id", "user-1") in fake.calls["eq"]
    assert got.is_active is False


def test_an_empty_update_does_not_hit_the_database(monkeypatch):
    fake = _FakeSupabase([_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.update_recurrence_rule("user-1", "rule-1", {})

    assert "update" not in fake.calls


def test_deleting_a_rule_is_scoped_to_the_user(monkeypatch):
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.delete_recurrence_rule("user-1", "rule-1")

    assert fake.calls["delete"] is True
    assert ("user_id", "user-1") in fake.calls["eq"]
    assert ("id", "rule-1") in fake.calls["eq"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence_repository.py -q`
Expected: FAIL — `AttributeError: module 'repository' has no attribute 'create_recurrence_rule'`

- [ ] **Step 3: Write the minimal implementation**

In `repository.py`, add `RecurrenceRule` to the `from models import ...` line, then append:

```python
# =========================================================
# Recurrence rules (2026-08-15)
# =========================================================

def _supabase_row_to_rule(row: dict) -> RecurrenceRule:
    """A recurrence_rules row as the Pydantic model. user_id is not surfaced,
    the same ownership-is-a-data-layer-concern rule _supabase_row_to_task follows."""
    checklist = []
    for item in row.get("checklist") or []:
        if isinstance(item, str):
            checklist.append({"text": item, "done": False})
        elif isinstance(item, dict) and "text" in item:
            checklist.append({"text": item["text"], "done": item.get("done", False)})

    return RecurrenceRule(
        record_id=row.get("id"),
        task_name=_get(row, "task_name", ""),
        description=_get(row, "description", ""),
        category=_get(row, "category", "Unknown"),
        priority=_get(row, "priority", "P3"),
        due_time=row.get("due_time"),
        checklist=checklist,
        freq=_get(row, "freq", "weekly"),
        weekdays=row.get("weekdays"),
        month_day=row.get("month_day"),
        starts_on=_get(row, "starts_on", "1970-01-01"),
        ends_on=row.get("ends_on"),
        is_active=_get(row, "is_active", True),
        approval_status=_get(row, "approval_status", True),
        notify_enabled=_get(row, "notify_enabled", False),
        calendar_sync_enabled=_get(row, "calendar_sync_enabled", False),
        grace_days=_get(row, "grace_days", 1),
        materialized_through=row.get("materialized_through"),
        created_at=row.get("created_at"),
    )


def _rule_to_supabase_fields(rule: RecurrenceRule) -> dict:
    """Strips the server-generated fields, same as _task_to_supabase_fields."""
    fields = rule.model_dump()
    fields.pop("record_id", None)
    fields.pop("created_at", None)
    fields["checklist"] = [
        item if isinstance(item, dict) else item.model_dump()
        for item in (rule.checklist or [])
    ]
    return fields


def create_recurrence_rule(user_id: str, rule: RecurrenceRule) -> RecurrenceRule:
    fields = _rule_to_supabase_fields(rule)
    fields["user_id"] = user_id
    response = supabase.table("recurrence_rules").insert(fields).execute()
    row = (response.data or [{}])[0]
    logger.info(f"[recurrence] Created rule {row.get('id')} for user {user_id}")
    return _supabase_row_to_rule(row)


def get_recurrence_rules(user_id: str) -> list[RecurrenceRule]:
    response = (
        supabase.table("recurrence_rules")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=False)
        .execute()
    )
    return [_supabase_row_to_rule(row) for row in (response.data or [])]


def get_recurrence_rule(user_id: str, rule_id: str) -> Optional[RecurrenceRule]:
    """Both filters are required. A rule id alone must never read another
    user's rule — the backend uses the service key and bypasses RLS, so
    app-code scoping is the primary protection."""
    response = (
        supabase.table("recurrence_rules")
        .select("*")
        .eq("id", rule_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return _supabase_row_to_rule(rows[0]) if rows else None


def update_recurrence_rule(user_id: str, rule_id: str, updates: dict) -> Optional[RecurrenceRule]:
    if not updates:
        return get_recurrence_rule(user_id, rule_id)
    response = (
        supabase.table("recurrence_rules")
        .update(updates)
        .eq("id", rule_id)
        .eq("user_id", user_id)
        .execute()
    )
    rows = response.data or []
    return _supabase_row_to_rule(rows[0]) if rows else None


def delete_recurrence_rule(user_id: str, rule_id: str) -> None:
    supabase.table("recurrence_rules").delete().eq("id", rule_id).eq("user_id", user_id).execute()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence_repository.py -q`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add repository.py tests/test_recurrence_repository.py
git commit -F- <<'EOF'
Rule CRUD, with user_id on every single query

The backend uses the service key and bypasses RLS, so app-code scoping
is the primary protection and a rule id alone must never be enough to
read someone else's rule. Every test asserts the filter, not just the
result.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Repository — occurrence queries

**Files:**
- Modify: `repository.py`
- Test: `tests/test_recurrence_repository.py`

**Interfaces:**
- Consumes: the `supabase` client, `_FakeSupabase` from Task 6's test file.
- Produces: `get_occurrence_dates(user_id: str, rule_id: str, from_date: str, to_date: str) -> set[str]`, `get_open_occurrences(user_id: str, rule_id: str) -> list[dict]`, `delete_tasks_by_ids(user_id: str, task_ids: list[str]) -> int`, `mark_task_missed(user_id: str, record_id: str, missed_at: str) -> None`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_recurrence_repository.py`:

```python
def test_occurrence_dates_come_back_as_a_set_for_the_difference(monkeypatch):
    fake = _FakeSupabase([{"occurrence_date": "2026-08-17"}, {"occurrence_date": "2026-08-18"}])
    monkeypatch.setattr(repository, "supabase", fake)

    got = repository.get_occurrence_dates("user-1", "rule-1", "2026-08-17", "2026-08-31")

    assert got == {"2026-08-17", "2026-08-18"}
    assert ("user_id", "user-1") in fake.calls["eq"]
    assert ("recurrence_rule_id", "rule-1") in fake.calls["eq"]


def test_open_occurrences_exclude_completed_rejected_and_already_missed(monkeypatch):
    """The filtering is in the query, so a rule with a year of history stays cheap."""
    fake = _FakeSupabase([
        {"id": "t1", "occurrence_date": "2026-08-17", "due_date": "2026-08-17"},
    ])
    monkeypatch.setattr(repository, "supabase", fake)

    got = repository.get_open_occurrences("user-1", "rule-1")

    assert got == [{"id": "t1", "occurrence_date": "2026-08-17", "due_date": "2026-08-17"}]
    assert ("is_completed", False) in fake.calls["eq"]
    assert ("is_rejected", False) in fake.calls["eq"]
    assert fake.calls["is_"] == ("missed_at", "null")


def test_deleting_by_ids_is_scoped_and_skips_an_empty_list(monkeypatch):
    fake = _FakeSupabase([{"id": "t1"}, {"id": "t2"}])
    monkeypatch.setattr(repository, "supabase", fake)

    assert repository.delete_tasks_by_ids("user-1", ["t1", "t2"]) == 2
    assert fake.calls["in_"] == ("id", ["t1", "t2"])
    assert ("user_id", "user-1") in fake.calls["eq"]

    empty = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", empty)
    assert repository.delete_tasks_by_ids("user-1", []) == 0
    assert empty.calls == {}, "an empty list must not reach the database"


def test_marking_missed_writes_only_missed_at(monkeypatch):
    fake = _FakeSupabase([{"id": "t1"}])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.mark_task_missed("user-1", "t1", "2026-08-19T06:00:00+03:00")

    assert fake.calls["update"] == {"missed_at": "2026-08-19T06:00:00+03:00"}
    assert ("user_id", "user-1") in fake.calls["eq"]
    assert ("id", "t1") in fake.calls["eq"]
```

Also add these three methods to `_FakeQuery` in the same file, right after `order`:

```python
    def gte(self, col, val):
        self.sink.setdefault("gte", []).append((col, val))
        return self

    def lte(self, col, val):
        self.sink.setdefault("lte", []).append((col, val))
        return self

    def is_(self, col, val):
        self.sink["is_"] = (col, val)
        return self

    def in_(self, col, vals):
        self.sink["in_"] = (col, vals)
        return self
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence_repository.py -q`
Expected: FAIL — `AttributeError: module 'repository' has no attribute 'get_occurrence_dates'`

- [ ] **Step 3: Write the minimal implementation**

Append to `repository.py`:

```python
def get_occurrence_dates(user_id: str, rule_id: str, from_date: str, to_date: str) -> set[str]:
    """
    Which occurrence dates this rule already has inside the window.

    A set, because the generator's job is a set difference: produce the dates
    the rule wants, subtract the ones already on disk, insert the rest. Windowed
    rather than fetching every date ever, so a rule with a year of history
    stays as cheap on day 400 as on day 1.
    """
    response = (
        supabase.table("tasks")
        .select("occurrence_date")
        .eq("user_id", user_id)
        .eq("recurrence_rule_id", rule_id)
        .gte("occurrence_date", from_date)
        .lte("occurrence_date", to_date)
        .execute()
    )
    return {row["occurrence_date"] for row in (response.data or []) if row.get("occurrence_date")}


def get_open_occurrences(user_id: str, rule_id: str) -> list[dict]:
    """
    This rule's occurrences that are still open — not completed, not rejected,
    not already missed. Returns id/occurrence_date/due_date only: the callers
    (regeneration and deletion) need to decide and then delete by id, never to
    reconstruct a whole TaskRecord.
    """
    response = (
        supabase.table("tasks")
        .select("id, occurrence_date, due_date")
        .eq("user_id", user_id)
        .eq("recurrence_rule_id", rule_id)
        .eq("is_completed", False)
        .eq("is_rejected", False)
        .is_("missed_at", "null")
        .execute()
    )
    return response.data or []


def delete_tasks_by_ids(user_id: str, task_ids: list[str]) -> int:
    """Hard-deletes the given tasks, scoped to the user. Returns how many went."""
    if not task_ids:
        return 0
    response = (
        supabase.table("tasks")
        .delete()
        .eq("user_id", user_id)
        .in_("id", task_ids)
        .execute()
    )
    return len(response.data or [])


def mark_task_missed(user_id: str, record_id: str, missed_at: str) -> None:
    """
    Stamps missed_at and nothing else.

    Deliberately NOT is_rejected, even though that flag already hides a task
    everywhere: is_rejected means "the user rejected the AI's suggestion" and
    is preserved to feed the learning loop, so filling it with auto-closed
    occurrences the AI never proposed would corrupt that signal.
    """
    supabase.table("tasks").update({"missed_at": missed_at}).eq("id", record_id).eq(
        "user_id", user_id
    ).execute()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence_repository.py -q`
Expected: PASS, 11 tests

- [ ] **Step 5: Also surface the new columns on read**

In `repository.py`, inside `_supabase_row_to_task`'s `TaskRecord(...)` construction, add three lines after `hostaway_thread=row.get("hostaway_thread"),`:

```python
            recurrence_rule_id=row.get("recurrence_rule_id"),
            occurrence_date=row.get("occurrence_date"),
            missed_at=row.get("missed_at"),
```

- [ ] **Step 6: Run the whole suite**

Run: `./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: PASS, 147

- [ ] **Step 7: Commit**

```bash
git add repository.py tests/test_recurrence_repository.py
git commit -F- <<'EOF'
The generator's set difference, and a missed flag that is not is_rejected

Occurrence dates come back as a set because generating is exactly "what
the rule wants, minus what is already on disk". The window keeps a rule
as cheap on day 400 as on day 1.

missed_at is its own column: is_rejected would have hidden the row for
free, but it means "the user rejected the AI's suggestion" and is kept
to feed the learning loop.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 8: The service — materialisation and missed closure

**Files:**
- Modify: `services.py`
- Test: `tests/test_recurrence_materialization.py`

**Interfaces:**
- Consumes: `recurrence` (Tasks 1–3), `repository.get_occurrence_dates`, `repository.get_open_occurrences`, `repository.delete_tasks_by_ids`, `repository.mark_task_missed`, `repository.update_recurrence_rule` (Tasks 6–7), `TaskService.create_task_manual` (existing, `services.py:276`).
- Produces: `TaskService.materialize_recurrence_rule(self, user_id: str, rule: RecurrenceRule, today: date) -> int`, `TaskService.regenerate_recurrence_rule(self, user_id: str, rule: RecurrenceRule, today: date) -> int`, `TaskService.close_missed_occurrences(self, user_id: str, user_tasks: list[TaskRecord], today: date, rules_by_id: dict) -> int`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_recurrence_materialization.py`:

```python
"""
Generation, idempotency, and the two things a rule edit must never destroy.

The scheduler runs every ~2 minutes, so "running it twice changes nothing"
is not a nicety here — it is the correctness property.
"""
from datetime import date

import services
from models import RecurrenceRule, TaskRecord


def _rule(**overrides):
    base = dict(record_id="rule-1", task_name="Χάπι", category="Personal", priority="P2",
                due_time="09:00", freq="weekly", weekdays=[1, 2, 3, 4, 5],
                starts_on="2026-08-17", notify_enabled=True)
    base.update(overrides)
    return RecurrenceRule(**base)


def _wire(monkeypatch, existing_dates=None, open_occurrences=None):
    """A TaskService whose repository is entirely fake. Records every write."""
    seen = {"created": [], "deleted": [], "missed": [], "rule_updates": []}

    monkeypatch.setattr(services.repository, "get_occurrence_dates",
                        lambda u, r, f, t: set(existing_dates or []))
    monkeypatch.setattr(services.repository, "get_open_occurrences",
                        lambda u, r: list(open_occurrences or []))
    monkeypatch.setattr(services.repository, "delete_tasks_by_ids",
                        lambda u, ids: seen["deleted"].extend(ids) or len(ids))
    monkeypatch.setattr(services.repository, "mark_task_missed",
                        lambda u, rid, at: seen["missed"].append(rid))
    monkeypatch.setattr(services.repository, "update_recurrence_rule",
                        lambda u, rid, updates: seen["rule_updates"].append(updates))

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = services.repository
    monkeypatch.setattr(svc, "create_task_manual",
                        lambda user_id, fields, approval_status=True:
                            seen["created"].append(fields) or fields,
                        raising=False)
    return svc, seen


def test_a_fortnight_of_weekdays_is_created(monkeypatch):
    svc, seen = _wire(monkeypatch)

    created = svc.materialize_recurrence_rule("user-1", _rule(), date(2026, 8, 17))

    dates = [f["occurrence_date"] for f in seen["created"]]
    # 2026-08-17 is a Monday and the window is inclusive at both ends, so
    # 2026-08-31 — also a Monday — is the eleventh.
    assert created == 11
    assert dates[0] == "2026-08-17"
    assert dates[-1] == "2026-08-31"
    assert "2026-08-22" not in dates, "Saturday"
    assert "2026-08-23" not in dates, "Sunday"


def test_an_occurrence_carries_the_template_and_is_pre_approved(monkeypatch):
    """Five Inbox items a week to approve would make the feature unusable."""
    svc, seen = _wire(monkeypatch)

    svc.materialize_recurrence_rule("user-1", _rule(), date(2026, 8, 17))

    first = seen["created"][0]
    assert first["task_name"] == "Χάπι"
    assert first["category"] == "Personal"
    assert first["priority"] == "P2"
    assert first["due_time"] == "09:00"
    assert first["due_date"] == "2026-08-17"
    assert first["occurrence_date"] == "2026-08-17"
    assert first["recurrence_rule_id"] == "rule-1"
    assert first["notify_enabled"] is True
    assert first["approval_status"] is True


def test_running_it_twice_creates_nothing_the_second_time(monkeypatch):
    """The scheduler runs every two minutes. This is the correctness property."""
    already = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21",
               "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28",
               "2026-08-31"]
    svc, seen = _wire(monkeypatch, existing_dates=already)

    created = svc.materialize_recurrence_rule("user-1", _rule(), date(2026, 8, 17))

    assert created == 0
    assert seen["created"] == []


def test_a_rescheduled_occurrence_is_not_regenerated(monkeypatch):
    """
    Drag Monday's task to Tuesday: due_date moves, occurrence_date does not.
    Keyed on due_date this would recreate Monday on the very next tick.
    """
    svc, seen = _wire(monkeypatch, existing_dates=["2026-08-17"])

    svc.materialize_recurrence_rule("user-1", _rule(), date(2026, 8, 17))

    assert "2026-08-17" not in [f["occurrence_date"] for f in seen["created"]]


def test_an_inactive_or_unapproved_rule_produces_nothing(monkeypatch):
    svc, seen = _wire(monkeypatch)

    assert svc.materialize_recurrence_rule("user-1", _rule(is_active=False), date(2026, 8, 17)) == 0
    assert svc.materialize_recurrence_rule(
        "user-1", _rule(approval_status=False), date(2026, 8, 17)) == 0
    assert seen["created"] == []


def test_materialized_through_is_recorded_so_the_tick_can_skip(monkeypatch):
    svc, seen = _wire(monkeypatch)

    svc.materialize_recurrence_rule("user-1", _rule(), date(2026, 8, 17))

    assert seen["rule_updates"] == [{"materialized_through": "2026-08-31"}]


def test_a_rule_already_materialized_far_enough_does_no_work(monkeypatch):
    svc, seen = _wire(monkeypatch)

    created = svc.materialize_recurrence_rule(
        "user-1", _rule(materialized_through="2026-08-31"), date(2026, 8, 17))

    assert created == 0
    assert seen["rule_updates"] == []


# --- regeneration -----------------------------------------------------------

def test_regeneration_drops_open_future_occurrences_only(monkeypatch):
    svc, seen = _wire(monkeypatch, open_occurrences=[
        {"id": "past", "occurrence_date": "2026-08-14", "due_date": "2026-08-14"},
        {"id": "today", "occurrence_date": "2026-08-17", "due_date": "2026-08-17"},
        {"id": "future", "occurrence_date": "2026-08-18", "due_date": "2026-08-18"},
    ])

    svc.regenerate_recurrence_rule("user-1", _rule(), date(2026, 8, 17))

    assert seen["deleted"] == ["future"], "today's may already be half-done or have rung"


def test_regeneration_spares_an_occurrence_the_user_moved_by_hand(monkeypatch):
    """Deliberately shifting next Tuesday must survive a change to the rule."""
    svc, seen = _wire(monkeypatch, open_occurrences=[
        {"id": "moved", "occurrence_date": "2026-08-18", "due_date": "2026-08-20"},
        {"id": "untouched", "occurrence_date": "2026-08-19", "due_date": "2026-08-19"},
    ])

    svc.regenerate_recurrence_rule("user-1", _rule(), date(2026, 8, 17))

    assert seen["deleted"] == ["untouched"]


# --- missed closure ---------------------------------------------------------

def _occurrence(record_id, occurrence_date, **overrides):
    base = dict(task_name="Χάπι", description="", category="Personal", priority="P3",
                ai_suggested_category="Personal", ai_suggested_priority="P3",
                approval_status=True, record_id=record_id,
                recurrence_rule_id="rule-1", occurrence_date=occurrence_date)
    base.update(overrides)
    return TaskRecord(**base)


def test_an_occurrence_past_its_grace_is_closed(monkeypatch):
    svc, seen = _wire(monkeypatch)
    tasks = [_occurrence("t-mon", "2026-08-17")]

    closed = svc.close_missed_occurrences(
        "user-1", tasks, date(2026, 8, 19), {"rule-1": _rule()})

    assert closed == 1
    assert seen["missed"] == ["t-mon"]


def test_yesterdays_occurrence_is_left_alone(monkeypatch):
    svc, seen = _wire(monkeypatch)
    tasks = [_occurrence("t-mon", "2026-08-17")]

    closed = svc.close_missed_occurrences(
        "user-1", tasks, date(2026, 8, 18), {"rule-1": _rule()})

    assert closed == 0
    assert seen["missed"] == []


def test_completed_rejected_and_already_missed_ones_are_skipped(monkeypatch):
    svc, seen = _wire(monkeypatch)
    tasks = [
        _occurrence("done", "2026-08-17", is_completed=True),
        _occurrence("rejected", "2026-08-17", is_rejected=True),
        _occurrence("already", "2026-08-17", missed_at="2026-08-19T06:00:00+03:00"),
    ]

    assert svc.close_missed_occurrences(
        "user-1", tasks, date(2026, 8, 25), {"rule-1": _rule()}) == 0
    assert seen["missed"] == []


def test_an_ordinary_task_is_never_auto_closed(monkeypatch):
    """Only recurrence occurrences forget themselves. Everything else is the user's."""
    svc, seen = _wire(monkeypatch)
    ordinary = TaskRecord(task_name="πληρωμή", description="", category="Business",
                          priority="P1", ai_suggested_category="Business",
                          ai_suggested_priority="P1", approval_status=True,
                          record_id="plain", due_date="2020-01-01")

    assert svc.close_missed_occurrences("user-1", [ordinary], date(2026, 8, 25), {}) == 0
    assert seen["missed"] == []


def test_an_orphaned_occurrence_whose_rule_is_gone_is_left_alone(monkeypatch):
    """ON DELETE SET NULL turns it into an ordinary task, and ordinary tasks stay."""
    svc, seen = _wire(monkeypatch)
    orphan = _occurrence("orphan", "2026-08-17", recurrence_rule_id=None)

    assert svc.close_missed_occurrences("user-1", [orphan], date(2026, 8, 25), {}) == 0
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence_materialization.py -q`
Expected: FAIL — `AttributeError: 'TaskService' object has no attribute 'materialize_recurrence_rule'`

- [ ] **Step 3: Write the minimal implementation**

At the top of `services.py`, add to the imports:

```python
import recurrence
from models import RecurrenceRule
```

(`from datetime import date` — check the existing `from datetime import ...` line and add `date` to it if absent.)

Then add these three methods to `TaskService`, placed just above `run_notification_scheduler`:

```python
    # =========================================================
    # Recurring tasks (2026-08-15)
    # =========================================================

    def _occurrence_fields(self, rule: RecurrenceRule, occurrence: "date") -> dict:
        """
        The template, copied fresh for one day.

        The checklist is copied with every item undone: this is a new day's
        work, not a continuation of yesterday's. ai_suggested_* mirror the
        rule's chosen values — the same thing the Google-event conversion in
        repository.py does, and for the same reason: the columns are
        non-nullable and no AI suggested anything here.
        """
        occurrence_str = recurrence.format_date(occurrence)
        return {
            "task_name": rule.task_name,
            "description": rule.description,
            "category": rule.category,
            "priority": rule.priority,
            "due_date": occurrence_str,
            "due_time": rule.due_time,
            "checklist": [{"text": item.text, "done": False} for item in (rule.checklist or [])],
            "notify_enabled": rule.notify_enabled,
            "recurrence_rule_id": rule.record_id,
            "occurrence_date": occurrence_str,
        }

    def materialize_recurrence_rule(self, user_id: str, rule: RecurrenceRule, today: "date") -> int:
        """
        Makes sure this rule's next fortnight exists as real task rows.

        Idempotent by construction: it inserts the set difference between what
        the rule wants and what is already on disk, and the UNIQUE constraint
        on (recurrence_rule_id, occurrence_date) is the backstop if two ticks
        ever overlap. Running it twice is a no-op, which matters because the
        scheduler runs it every ~2 minutes.

        Occurrences are created ALREADY APPROVED. The human approved the rule;
        a Monday-to-Friday duty producing five Inbox items a week to approve
        would make the feature unusable.
        """
        if not rule.is_active or not rule.approval_status or not rule.record_id:
            return 0

        window_start, window_end = recurrence.materialization_window(today)

        # The cheap short-circuit: one field comparison, no query. Real work
        # happens about once a day per rule, not every two minutes. Same
        # pattern as daily_summary_last_sent_date.
        already_through = recurrence.parse_date(rule.materialized_through)
        if already_through is not None and already_through >= window_end:
            return 0

        wanted = recurrence.occurrences_between(
            freq=rule.freq,
            weekdays=rule.weekdays,
            month_day=rule.month_day,
            window_start=window_start,
            window_end=window_end,
            starts_on=recurrence.parse_date(rule.starts_on) or window_start,
            ends_on=recurrence.parse_date(rule.ends_on),
        )

        existing = repository.get_occurrence_dates(
            user_id,
            rule.record_id,
            recurrence.format_date(window_start),
            recurrence.format_date(window_end),
        )

        created = 0
        for occurrence in wanted:
            if recurrence.format_date(occurrence) in existing:
                continue
            try:
                self.create_task_manual(
                    user_id, self._occurrence_fields(rule, occurrence), approval_status=True
                )
                created += 1
            except Exception as e:
                # A single day failing must not cost the rule its other
                # thirteen, and must not cost the user the rest of their tick.
                logger.error(
                    f"[recurrence] Rule {rule.record_id} failed on {occurrence}: {e}"
                )

        repository.update_recurrence_rule(
            user_id,
            rule.record_id,
            {"materialized_through": recurrence.format_date(window_end)},
        )
        return created

    def regenerate_recurrence_rule(self, user_id: str, rule: RecurrenceRule, today: "date") -> int:
        """
        Applies a changed (or paused, or resumed) rule from TOMORROW on.

        Today's occurrence is deliberately left alone: it may already be
        half-done or have rung, and it is an ordinary task the user can edit
        directly. Two other things survive: completed occurrences, and any
        occurrence the user moved by hand (due_date no longer equals
        occurrence_date) — deliberately shifting next Tuesday must not be
        undone because the rule's time changed.
        """
        if not rule.record_id:
            return 0

        today_str = recurrence.format_date(today)
        doomed = [
            row["id"]
            for row in repository.get_open_occurrences(user_id, rule.record_id)
            if (row.get("occurrence_date") or "") > today_str
            and row.get("due_date") == row.get("occurrence_date")
        ]
        repository.delete_tasks_by_ids(user_id, doomed)

        # The horizon must be recomputed from scratch, so the short-circuit is
        # cleared first — otherwise the rule would look already-materialised.
        repository.update_recurrence_rule(user_id, rule.record_id, {"materialized_through": None})
        rule.materialized_through = None
        return self.materialize_recurrence_rule(user_id, rule, today)

    def close_missed_occurrences(
        self, user_id: str, user_tasks: list[TaskRecord], today: "date", rules_by_id: dict
    ) -> int:
        """
        Stamps missed_at on occurrences that outlived their grace.

        Only recurrence occurrences forget themselves — an ordinary overdue
        task is the user's business and stays until they deal with it. An
        orphaned occurrence (its rule deleted, so ON DELETE SET NULL cleared
        the link) is an ordinary task too, and is left alone.
        """
        closed = 0
        now_iso = datetime.now(ZoneInfo("Europe/Athens")).isoformat()

        for task in user_tasks:
            if not task.recurrence_rule_id or not task.occurrence_date:
                continue
            if task.is_completed or task.is_rejected or task.missed_at:
                continue

            rule = rules_by_id.get(task.recurrence_rule_id)
            if rule is None:
                continue

            occurrence = recurrence.parse_date(task.occurrence_date)
            if occurrence is None:
                continue

            if recurrence.is_missed(
                occurrence_date=occurrence, today=today, grace_days=rule.grace_days
            ):
                try:
                    repository.mark_task_missed(user_id, task.record_id, now_iso)
                    closed += 1
                except Exception as e:
                    logger.error(f"[recurrence] Could not close {task.record_id}: {e}")

        return closed
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence_materialization.py -q`
Expected: PASS, 15 tests

- [ ] **Step 5: Commit**

```bash
git add services.py tests/test_recurrence_materialization.py
git commit -F- <<'EOF'
Generation that a two-minute cron can run forever without duplicating

Materialisation inserts the set difference between what the rule wants
and what is on disk, so running it twice is a no-op — which is the
correctness property, not a nicety, on a tick that fires every two
minutes.

A rule edit spares two things on purpose: today's occurrence, which may
already have rung, and any occurrence the user deliberately dragged
somewhere else.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Wire it into the scheduler tick

**Files:**
- Modify: `services.py` (`run_notification_scheduler`, `services.py:494-566`)
- Test: `tests/test_recurrence_materialization.py`

**Interfaces:**
- Consumes: everything from Task 8, `repository.get_recurrence_rules`.
- Produces: two new keys on each per-user result dict — `recurrences_created`, `recurrences_missed`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_recurrence_materialization.py`:

```python
from models import AppSettings


def test_the_tick_materialises_before_it_reads_the_users_tasks(monkeypatch):
    """
    Order matters: a task generated for today must be in user_tasks, or its
    reminder waits a whole extra tick for no reason.
    """
    order = []

    monkeypatch.setattr(services.repository, "get_all_active_user_ids", lambda: ["user-1"])
    monkeypatch.setattr(services.repository, "get_app_settings",
                        lambda u: AppSettings(notifications_enabled=True, send_all_enabled=False))
    monkeypatch.setattr(services.repository, "get_recurrence_rules",
                        lambda u: order.append("rules") or [])
    monkeypatch.setattr(services.repository, "get_all_tasks",
                        lambda u: order.append("tasks") or [])
    monkeypatch.setattr(services.repository, "get_tasks_due_for_notification",
                        lambda u, s, e, tasks=None, require_bell_enabled=False: [])
    monkeypatch.setattr(services, "sync_google_calendar_for_user", lambda u: {"status": "ok"})

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = services.repository
    monkeypatch.setattr(svc, "_maybe_send_daily_summary",
                        lambda u, now, s, t: False, raising=False)
    monkeypatch.setattr(svc, "_check_hostaway_replies",
                        lambda u, t: {"conversations_polled": 0, "replies_found": 0,
                                      "tasks_completed": 0}, raising=False)
    monkeypatch.setattr(svc, "_check_hostaway_escalations",
                        lambda u, n, t: {"checked": 0, "escalations_sent": 0}, raising=False)

    result = svc.run_notification_scheduler()

    assert order == ["rules", "tasks"]
    assert result["results"][0]["recurrences_created"] == 0
    assert result["results"][0]["recurrences_missed"] == 0


def test_a_broken_rule_does_not_cost_the_user_the_rest_of_the_tick(monkeypatch):
    """Same lesson the Hostaway encryption key taught, applied before it bites."""
    calendar_ran = []

    monkeypatch.setattr(services.repository, "get_all_active_user_ids", lambda: ["user-1"])
    monkeypatch.setattr(services.repository, "get_app_settings",
                        lambda u: AppSettings(notifications_enabled=True, send_all_enabled=False))

    def _boom(user_id):
        raise RuntimeError("recurrence_rules table is missing")

    monkeypatch.setattr(services.repository, "get_recurrence_rules", _boom)
    monkeypatch.setattr(services.repository, "get_all_tasks", lambda u: [])
    monkeypatch.setattr(services.repository, "get_tasks_due_for_notification",
                        lambda u, s, e, tasks=None, require_bell_enabled=False: [])
    monkeypatch.setattr(services, "sync_google_calendar_for_user",
                        lambda u: calendar_ran.append(u) or {"status": "ok"})

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = services.repository
    monkeypatch.setattr(svc, "_maybe_send_daily_summary",
                        lambda u, now, s, t: False, raising=False)
    monkeypatch.setattr(svc, "_check_hostaway_replies",
                        lambda u, t: {"conversations_polled": 0, "replies_found": 0,
                                      "tasks_completed": 0}, raising=False)
    monkeypatch.setattr(svc, "_check_hostaway_escalations",
                        lambda u, n, t: {"checked": 0, "escalations_sent": 0}, raising=False)

    result = svc.run_notification_scheduler()

    assert calendar_ran == ["user-1"], "recurrence took down the rest of the tick"
    assert result["results"][0]["recurrences_created"] == 0
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence_materialization.py -q`
Expected: FAIL — `KeyError: 'recurrences_created'`

- [ ] **Step 3: Write the minimal implementation**

In `services.py`, inside `run_notification_scheduler`'s per-user `try:` block, insert this **immediately after** the `require_bell = not settings.send_all_enabled` line and **before** `user_tasks = self.repository.get_all_tasks(user_id)`:

```python
                # Recurrences run BEFORE the task list is read, so an occurrence
                # generated for today is in user_tasks and can have its reminder
                # this tick rather than the next one.
                #
                # Wrapped separately from the per-user guard below: a broken rule
                # must cost this user their recurrences and nothing else. The
                # Hostaway encryption key taught this lesson at the cost of every
                # user's reminders, and the fix is cheaper applied in advance.
                recurrences_created = 0
                recurrence_rules = []
                try:
                    recurrence_rules = repository.get_recurrence_rules(user_id)
                    for rule in recurrence_rules:
                        recurrences_created += self.materialize_recurrence_rule(
                            user_id, rule, now.date()
                        )
                except Exception as e:
                    logger.exception(f"[recurrence] Generation failed for user {user_id}: {e}")
```

Then, **immediately after** the `user_tasks = self.repository.get_all_tasks(user_id)` line, insert:

```python
                recurrences_missed = 0
                try:
                    recurrences_missed = self.close_missed_occurrences(
                        user_id,
                        user_tasks,
                        now.date(),
                        {r.record_id: r for r in recurrence_rules},
                    )
                except Exception as e:
                    logger.exception(f"[recurrence] Missed-closure failed for {user_id}: {e}")
```

Finally, add two keys to the `results.append({...})` dict in the same block, next to `"sent": sent,`:

```python
                    "recurrences_created": recurrences_created,
                    "recurrences_missed": recurrences_missed,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence_materialization.py -q`
Expected: PASS, 17 tests

- [ ] **Step 5: Run the whole suite**

Run: `./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: PASS, 164

- [ ] **Step 6: Commit**

```bash
git add services.py tests/test_recurrence_materialization.py
git commit -F- <<'EOF'
Recurrences join the tick, guarded so they cannot take it down

Generation runs before the task list is read, so an occurrence created
for today gets its reminder this tick instead of the next one.

Its own try/except, separate from the per-user guard: a broken rule must
cost this user their recurrences and nothing else. That lesson already
cost everybody their reminders once, when a Hostaway key went missing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 10: The agent stops seeing missed occurrences

**Files:**
- Modify: `agent_tools.py:32-38`
- Test: `tests/test_recurrence_materialization.py`

**Interfaces:**
- Consumes: `TaskRecord.missed_at` from Task 5.
- Produces: nothing new; `is_open_task` behaviour changes.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_recurrence_materialization.py`:

```python
import agent_tools


def test_the_agent_does_not_see_a_missed_occurrence():
    """
    is_open_task is the declared single source of truth for the whole agent —
    day view, search, and every write guard — so this is the one line that has
    to change on the backend.
    """
    missed = _occurrence("gone", "2026-08-17", missed_at="2026-08-19T06:00:00+03:00")
    live = _occurrence("here", "2026-08-19")

    assert agent_tools.is_open_task(missed) is False
    assert agent_tools.is_open_task(live) is True


def test_a_missed_occurrence_stays_invisible_even_when_completed_are_included():
    missed = _occurrence("gone", "2026-08-17", missed_at="2026-08-19T06:00:00+03:00")
    assert agent_tools.is_open_task(missed, include_completed=True) is False
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence_materialization.py -k missed_occurrence -q`
Expected: FAIL — `assert True is False`

- [ ] **Step 3: Write the minimal implementation**

In `agent_tools.py`, change the first guard of `is_open_task`:

```python
def is_open_task(t, include_completed: bool = False) -> bool:
    """SINGLE SOURCE OF TRUTH for 'counts as an open task'.
    Any change to the pending-approval policy happens HERE and nowhere else."""
    # missed_at is a recurrence occurrence that outlived its grace and closed
    # itself. It is kept as a record — "was Monday's check done?" must have an
    # answer — but it is not work anybody can still do, so it is not open, not
    # even with include_completed.
    if t.is_rejected or t.missed_at or not t.approval_status:
        return False
    if not include_completed and t.is_completed:
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: PASS, 166

- [ ] **Step 5: Commit**

```bash
git add agent_tools.py tests/test_recurrence_materialization.py
git commit -F- <<'EOF'
A forgotten occurrence is not work the agent can offer you

One line, in the function that already declares itself the single source
of truth for "counts as an open task" — so the day view, every search and
every write guard get it at once.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 11: The endpoints

**Files:**
- Modify: `main.py`
- Test: `tests/test_recurrence_api.py`

**Interfaces:**
- Consumes: `repository.*` (Tasks 6–7), `TaskService.materialize_recurrence_rule` / `regenerate_recurrence_rule` (Task 8), `get_current_user_id` (existing dependency in `main.py`).
- Produces: `GET /recurrences`, `POST /recurrences`, `PATCH /recurrences/{rule_id}`, `DELETE /recurrences/{rule_id}`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_recurrence_api.py`:

```python
"""
The four endpoints. What matters here is what each one does BESIDES the write:
creating and editing must materialise synchronously, or the user stares at an
empty list for up to two minutes and concludes it is broken.
"""
import pytest
from fastapi.testclient import TestClient

import main
from models import RecurrenceRule

USER = "user-1"


@pytest.fixture
def client():
    main.app.dependency_overrides[main.get_current_user_id] = lambda: USER
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def _rule(**overrides):
    base = dict(record_id="rule-1", task_name="Χάπι", category="Personal", priority="P2",
                due_time="09:00", freq="weekly", weekdays=[1, 2, 3, 4, 5],
                starts_on="2026-08-17")
    base.update(overrides)
    return RecurrenceRule(**base)


def test_listing_returns_this_users_rules(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_recurrence_rules", lambda u: [_rule()])

    r = client.get("/recurrences")

    assert r.status_code == 200
    assert r.json()["count"] == 1
    assert r.json()["recurrences"][0]["task_name"] == "Χάπι"


def test_creating_a_rule_materialises_it_immediately(client, monkeypatch):
    """Otherwise the user waits up to two minutes and thinks nothing happened."""
    seen = {}
    monkeypatch.setattr(main.repository, "create_recurrence_rule",
                        lambda u, rule: _rule())
    monkeypatch.setattr(main.service, "materialize_recurrence_rule",
                        lambda u, rule, today: seen.setdefault("materialized", rule.record_id) or 3)

    r = client.post("/recurrences", json={
        "task_name": "Χάπι", "freq": "weekly", "weekdays": [1, 2, 3, 4, 5],
        "starts_on": "2026-08-17", "due_time": "09:00", "category": "Personal",
    })

    assert r.status_code == 201
    assert seen["materialized"] == "rule-1"
    assert r.json()["occurrences_created"] == 3


def test_an_incoherent_rule_is_refused_with_422(client):
    r = client.post("/recurrences", json={
        "task_name": "Χάπι", "freq": "weekly", "weekdays": [], "starts_on": "2026-08-17",
    })
    assert r.status_code == 422


def test_hostaway_cannot_be_chosen_as_a_category(client):
    r = client.post("/recurrences", json={
        "task_name": "x", "freq": "weekly", "weekdays": [1],
        "starts_on": "2026-08-17", "category": "Hostaway",
    })
    assert r.status_code == 422


def test_editing_a_rule_regenerates_the_future(client, monkeypatch):
    seen = {}

    def _update(user_id, rule_id, updates):
        seen["updates"] = updates
        return _rule()

    monkeypatch.setattr(main.repository, "update_recurrence_rule", _update)
    monkeypatch.setattr(main.service, "regenerate_recurrence_rule",
                        lambda u, rule, today: seen.setdefault("regenerated", rule.record_id) or 5)

    r = client.patch("/recurrences/rule-1", json={"due_time": "20:00"})

    assert r.status_code == 200
    assert seen["updates"] == {"due_time": "20:00"}
    assert seen["regenerated"] == "rule-1"


def test_pausing_a_rule_also_regenerates_so_the_future_clears(client, monkeypatch):
    """Off must mean off now, not in a fortnight."""
    seen = {}
    monkeypatch.setattr(main.repository, "update_recurrence_rule",
                        lambda u, rid, updates: _rule(is_active=False))
    monkeypatch.setattr(main.service, "regenerate_recurrence_rule",
                        lambda u, rule, today: seen.setdefault("regenerated", True) or 0)

    r = client.patch("/recurrences/rule-1", json={"is_active": False})

    assert r.status_code == 200
    assert seen["regenerated"] is True


def test_editing_a_rule_that_is_not_yours_is_a_404(client, monkeypatch):
    monkeypatch.setattr(main.repository, "update_recurrence_rule", lambda u, rid, updates: None)
    assert client.patch("/recurrences/someone-elses", json={"due_time": "20:00"}).status_code == 404


def test_deleting_removes_every_open_occurrence_past_and_future(client, monkeypatch):
    """
    Past open ones must go too: once the rule row is gone there is no
    grace_days left to close them by, so they would hang overdue for ever.
    """
    seen = {}
    monkeypatch.setattr(main.repository, "get_recurrence_rule", lambda u, rid: _rule())
    monkeypatch.setattr(main.repository, "get_open_occurrences", lambda u, rid: [
        {"id": "past", "occurrence_date": "2026-08-10", "due_date": "2026-08-10"},
        {"id": "future", "occurrence_date": "2026-08-25", "due_date": "2026-08-25"},
    ])
    monkeypatch.setattr(main.repository, "delete_tasks_by_ids",
                        lambda u, ids: seen.setdefault("deleted", ids) or len(ids))
    monkeypatch.setattr(main.repository, "delete_recurrence_rule",
                        lambda u, rid: seen.setdefault("rule_deleted", rid))

    r = client.delete("/recurrences/rule-1")

    assert r.status_code == 200
    assert sorted(seen["deleted"]) == ["future", "past"]
    assert seen["rule_deleted"] == "rule-1"
    assert r.json()["occurrences_removed"] == 2


def test_deleting_a_rule_that_is_not_yours_is_a_404(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_recurrence_rule", lambda u, rid: None)
    assert client.delete("/recurrences/someone-elses").status_code == 404
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence_api.py -q`
Expected: FAIL — 404s on every route

- [ ] **Step 3: Write the minimal implementation**

In `main.py`, add the request/response models next to the other `BaseModel` classes (after `CreateTaskRequest`):

```python
class RecurrenceCreateRequest(BaseModel):
    """Request body for POST /recurrences. Mirrors RecurrenceRule minus the
    server-owned fields (record_id, materialized_through, created_at)."""
    task_name: str
    description: str = ""
    category: str = "Unknown"
    priority: str = "P3"
    due_time: Optional[str] = None
    checklist: Optional[list[ChecklistItem]] = None
    freq: str
    weekdays: Optional[list[int]] = None
    month_day: Optional[int] = None
    starts_on: str
    ends_on: Optional[str] = None
    notify_enabled: bool = False
    calendar_sync_enabled: bool = False


class RecurrenceUpdateRequest(BaseModel):
    """Request body for PATCH /recurrences/{id}. Every field optional; only the
    ones actually sent are written."""
    task_name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    due_time: Optional[str] = None
    checklist: Optional[list[ChecklistItem]] = None
    freq: Optional[str] = None
    weekdays: Optional[list[int]] = None
    month_day: Optional[int] = None
    starts_on: Optional[str] = None
    ends_on: Optional[str] = None
    is_active: Optional[bool] = None
    approval_status: Optional[bool] = None
    notify_enabled: Optional[bool] = None
    calendar_sync_enabled: Optional[bool] = None


class RecurrencesListResponse(BaseModel):
    recurrences: list[RecurrenceRule]
    count: int


class RecurrenceWriteResponse(BaseModel):
    recurrence: RecurrenceRule
    occurrences_created: int


class RecurrenceDeleteResponse(BaseModel):
    deleted: bool
    occurrences_removed: int
```

Add `RecurrenceRule` to the `from models import ...` line, and `import recurrence` near the other imports.

Then add the four endpoints, placed after the `/settings` endpoints:

```python
def _athens_today():
    """One clock read, in the same zone as everything else in this app."""
    return datetime.now(ZoneInfo("Europe/Athens")).date()


@app.get("/recurrences", response_model=RecurrencesListResponse)
def list_recurrences(user_id: str = Depends(get_current_user_id)):
    """Every recurrence rule this user owns, oldest first."""
    try:
        rules = repository.get_recurrence_rules(user_id)
        return RecurrencesListResponse(recurrences=rules, count=len(rules))
    except Exception as e:
        logger.exception("Failed to list recurrences")
        raise HTTPException(status_code=500, detail=f"Failed to list recurrences: {str(e)}")


@app.post("/recurrences", response_model=RecurrenceWriteResponse, status_code=status.HTTP_201_CREATED)
def create_recurrence(payload: RecurrenceCreateRequest, user_id: str = Depends(get_current_user_id)):
    """
    Creates a rule and materialises its window SYNCHRONOUSLY.

    The scheduler would get there within ~2 minutes, but a user who saves a
    recurrence and sees an empty list concludes the feature is broken. The
    write is idempotent, so doing it here and again on the next tick costs
    nothing.
    """
    try:
        # RecurrenceRule's validators are the real gate — an incoherent rule
        # (weekly with no weekdays, category Hostaway) raises here as a 422.
        rule = RecurrenceRule(**payload.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        saved = repository.create_recurrence_rule(user_id, rule)
        created = service.materialize_recurrence_rule(user_id, saved, _athens_today())
        return RecurrenceWriteResponse(recurrence=saved, occurrences_created=created)
    except Exception as e:
        logger.exception("Failed to create recurrence")
        raise HTTPException(status_code=500, detail=f"Failed to create recurrence: {str(e)}")


@app.patch("/recurrences/{rule_id}", response_model=RecurrenceWriteResponse)
def update_recurrence(
    rule_id: str, payload: RecurrenceUpdateRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Changes a rule and regenerates from TOMORROW on.

    Pausing goes through here too (is_active=false), and that is the point:
    "off" must clear the fortnight already generated, not leave the user
    ticking off a task they just switched off. Approving an AI-made rule is
    also this call, with approval_status=true.
    """
    updates = payload.model_dump(exclude_unset=True)
    updates = {k: v for k, v in updates.items() if v is not None}
    if "checklist" in updates:
        updates["checklist"] = [item.model_dump() for item in payload.checklist or []]

    try:
        saved = repository.update_recurrence_rule(user_id, rule_id, updates)
    except Exception as e:
        logger.exception("Failed to update recurrence")
        raise HTTPException(status_code=500, detail=f"Failed to update recurrence: {str(e)}")

    if saved is None:
        raise HTTPException(status_code=404, detail="Recurrence not found")

    created = service.regenerate_recurrence_rule(user_id, saved, _athens_today())
    return RecurrenceWriteResponse(recurrence=saved, occurrences_created=created)


@app.delete("/recurrences/{rule_id}", response_model=RecurrenceDeleteResponse)
def delete_recurrence(rule_id: str, user_id: str = Depends(get_current_user_id)):
    """
    Deletes the rule and every OPEN occurrence, past and future. Completed and
    missed ones stay — that is the history, and ON DELETE SET NULL turns them
    into ordinary tasks.

    Past open ones must go as well: with the rule row gone there is no
    grace_days left to close them by, so they would hang overdue for ever.
    """
    rule = repository.get_recurrence_rule(user_id, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Recurrence not found")

    try:
        open_ids = [row["id"] for row in repository.get_open_occurrences(user_id, rule_id)]
        removed = repository.delete_tasks_by_ids(user_id, open_ids)
        repository.delete_recurrence_rule(user_id, rule_id)
        return RecurrenceDeleteResponse(deleted=True, occurrences_removed=removed)
    except Exception as e:
        logger.exception("Failed to delete recurrence")
        raise HTTPException(status_code=500, detail=f"Failed to delete recurrence: {str(e)}")
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence_api.py -q`
Expected: PASS, 9 tests

- [ ] **Step 5: Run the whole suite**

Run: `./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: PASS, 175

- [ ] **Step 6: Commit**

```bash
git add main.py tests/test_recurrence_api.py
git commit -F- <<'EOF'
Four endpoints, and both writes materialise before they answer

The tick would get there within two minutes, but a user who saves a
recurrence and sees an empty list concludes it is broken. Generation is
idempotent, so doing it here and again on the next tick costs nothing.

Deleting takes every open occurrence, past ones included: with the rule
gone there is no grace left to close them by, and they would hang
overdue for ever.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 12: One visibility predicate on the frontend, not five

**Files:**
- Modify: `frontend/src/utils/taskDisplay.js`
- Modify: `frontend/src/components/TodayView.jsx:60,67,75`
- Modify: `frontend/src/components/UpcomingList.jsx:28`
- Modify: `frontend/src/components/InboxView.jsx:9`
- Modify: `frontend/src/components/BrowseView.jsx:18,29,34`
- Modify: `frontend/src/components/CalendarView.jsx:134,376,817`
- Modify: `frontend/src/App.jsx:211`

**Interfaces:**
- Consumes: `task.missed_at` from Task 7's read mapping.
- Produces: `isVisibleTask(task) -> boolean` exported from `utils/taskDisplay.js`.

- [ ] **Step 1: Add the shared predicate**

Append to `frontend/src/utils/taskDisplay.js`:

```js
/**
 * Whether a task belongs on a list at all.
 *
 * The backend has had `is_open_task()` as its declared single source of truth
 * for this since the agent overhaul. The frontend had the same rule hand-copied
 * into five files, which was survivable while the rule was one clause long.
 * Recurrence adds a second clause, so it is centralised here rather than pasted
 * a sixth time — the sixth view someone writes would forget it.
 *
 * `missed_at` is a recurrence occurrence that outlived its grace and closed
 * itself. It is deliberately NOT `is_rejected`: rejection means the user turned
 * down the AI's suggestion, and that column is preserved to feed the learning
 * loop.
 */
export function isVisibleTask(task) {
  return !task.is_rejected && !task.missed_at;
}
```

- [ ] **Step 2: Point every view at it**

In each file below, add the import and replace the predicate.

`TodayView.jsx` — add `import { isVisibleTask } from '../utils/taskDisplay';` (or extend the existing import from that module) and replace all three `!task.is_rejected` occurrences with `isVisibleTask(task)`.

`UpcomingList.jsx:28` — replace
`task.approval_status && !task.is_completed && !task.is_rejected;`
with
`task.approval_status && !task.is_completed && isVisibleTask(task);`

`InboxView.jsx:9` — replace
`!task.is_rejected && !task.is_completed && !task.approval_status`
with
`isVisibleTask(task) && !task.is_completed && !task.approval_status`

`App.jsx:211` — same replacement as InboxView.

`CalendarView.jsx:134` — replace `return !task.is_completed && !task.is_rejected;` with `return !task.is_completed && isVisibleTask(task);`
`CalendarView.jsx:376` — replace `if (task.is_rejected) return acc;` with `if (!isVisibleTask(task)) return acc;`
`CalendarView.jsx:817` — replace `if (task.is_rejected) continue;` with `if (!isVisibleTask(task)) continue;`

`BrowseView.jsx` — this one has a "show rejected" toggle, so it needs care. Replace lines 18 and 34's
`base = base.filter((t) => !t.is_rejected);` / `result = result.filter((t) => !t.is_rejected);`
with
`base = base.filter(isVisibleTask);` / `result = result.filter(isVisibleTask);`
and change the two `showRejected` branches so that a missed occurrence is hidden **even when rejected tasks are shown** — v1 has no history UI, so add above each filter:

```js
    // Missed occurrences are never browsable in v1: there is no history view
    // yet (see the spec's "what v1 does not do"), and they are not rejections.
    base = base.filter((t) => !t.missed_at);
```

Leave `rejectedCount` on line 29 as it is — it counts rejections, which is a different thing.

- [ ] **Step 3: Verify the build**

Run: `cd frontend && npm run build`
Expected: build succeeds. Then run `npx eslint src --max-warnings=0` and confirm **no new** violations (a pre-existing error in `CalendarView.jsx` about setState in the events-fetch effect is known and stays).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/taskDisplay.js frontend/src/components frontend/src/App.jsx
git commit -F- <<'EOF'
One visibility rule on the frontend, instead of the same one in five files

The backend has had is_open_task as its single source of truth since the
agent overhaul; the frontend had the rule hand-copied into five views,
which was fine while it was one clause long. Recurrence adds a second,
so it is centralised now rather than pasted a sixth time — the sixth
view someone writes would forget it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 13: The API client

**Files:**
- Modify: `frontend/src/api.js`

**Interfaces:**
- Consumes: the endpoints from Task 11.
- Produces: `getRecurrences()`, `createRecurrence(payload)`, `updateRecurrence(id, updates)`, `deleteRecurrence(id)`.

- [ ] **Step 1: Add the four functions**

Append to `frontend/src/api.js`. `request(path, options)` is the file's existing shared helper (`api.js:30`) — it attaches the Supabase bearer token, sets the JSON content type, throws on a non-OK status and returns the parsed body. Every other function in the file delegates to it, and so do these:

```js
/**
 * GET /recurrences — this user's recurrence rules.
 * Returns { recurrences: [...], count: N }
 */
export async function getRecurrences() {
  return request('/recurrences');
}

/**
 * POST /recurrences — creates a rule AND materialises its window server-side.
 * Returns { recurrence: {...}, occurrences_created: N }
 */
export async function createRecurrence(payload) {
  return request('/recurrences', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * PATCH /recurrences/{id} — edits, pauses (is_active) or approves
 * (approval_status) a rule, regenerating from tomorrow on.
 * Returns { recurrence: {...}, occurrences_created: N }
 */
export async function updateRecurrence(recurrenceId, updates) {
  return request(`/recurrences/${recurrenceId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

/**
 * DELETE /recurrences/{id} — removes the rule and every OPEN occurrence.
 * Completed and missed ones stay as ordinary tasks.
 * Returns { deleted: true, occurrences_removed: N }
 */
export async function deleteRecurrence(recurrenceId) {
  return request(`/recurrences/${recurrenceId}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: Verify the build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.js
git commit -F- <<'EOF'
The client half of the four recurrence endpoints

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 14: The Recurrences screen

**Files:**
- Create: `frontend/src/components/RecurrencesView.jsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/el.json`

**Interfaces:**
- Consumes: `getRecurrences`, `updateRecurrence`, `deleteRecurrence` (Task 13); `Switch` (`components/Switch.jsx`); `SettingsRow`/`SettingsGroup` (`components/SettingsRow.jsx`).
- Produces: default export `RecurrencesView({ onShowToast })`, and the exported helper `describeRecurrence(rule, t) -> string`.

- [ ] **Step 1: Add the translation keys**

In `frontend/src/locales/en.json`, add a `recurrence` object:

```json
  "recurrence": {
    "title": "Recurrences",
    "empty": "No recurrences yet.",
    "empty_hint": "A pill every morning, a report every Monday — set it once.",
    "new": "New recurrence",
    "edit": "Edit",
    "delete": "Delete",
    "delete_confirm": "Delete this recurrence? Upcoming ones disappear; what you already finished stays.",
    "deleted": "Recurrence deleted",
    "paused": "Recurrence off",
    "resumed": "Recurrence on",
    "saved": "Recurrence saved",
    "every_day": "Every day",
    "weekdays": "Mon-Fri",
    "weekends": "Sat-Sun",
    "monthly_day": "Every month on day {{day}}",
    "monthly_last": "Every month on the last day",
    "at_time": "at {{time}}",
    "no_time": "no time",
    "days_short": ["M", "T", "W", "T", "F", "S", "S"],
    "form_name": "Name",
    "form_description": "Description",
    "form_category": "Category",
    "form_priority": "Priority",
    "form_time": "Time",
    "form_pattern": "Repeats",
    "form_weekly": "Weekly",
    "form_monthly": "Monthly",
    "form_day_of_month": "Day of month",
    "form_last_day": "Last day of month",
    "form_starts": "Starts",
    "form_ends": "Ends (optional)",
    "form_notify": "Reminder",
    "form_calendar": "Add to calendar",
    "form_save": "Save",
    "form_cancel": "Cancel",
    "error_no_days": "Pick at least one day.",
    "error_no_name": "Give it a name."
  },
```

In `frontend/src/locales/el.json`, the same keys with Greek values:

```json
  "recurrence": {
    "title": "Επαναλήψεις",
    "empty": "Δεν έχεις επαναλήψεις ακόμα.",
    "empty_hint": "Ένα χάπι κάθε πρωί, ένα report κάθε Δευτέρα — το βάζεις μία φορά.",
    "new": "Νέα επανάληψη",
    "edit": "Επεξεργασία",
    "delete": "Διαγραφή",
    "delete_confirm": "Να διαγραφεί η επανάληψη; Οι επόμενες εξαφανίζονται· ό,τι έχεις ήδη ολοκληρώσει μένει.",
    "deleted": "Η επανάληψη διαγράφηκε",
    "paused": "Η επανάληψη σταμάτησε",
    "resumed": "Η επανάληψη ξεκίνησε",
    "saved": "Η επανάληψη αποθηκεύτηκε",
    "every_day": "Κάθε μέρα",
    "weekdays": "Δευ-Παρ",
    "weekends": "Σαβ-Κυρ",
    "monthly_day": "Κάθε μήνα στις {{day}}",
    "monthly_last": "Κάθε μήνα την τελευταία μέρα",
    "at_time": "στις {{time}}",
    "no_time": "χωρίς ώρα",
    "days_short": ["Δ", "Τ", "Τ", "Π", "Π", "Σ", "Κ"],
    "form_name": "Όνομα",
    "form_description": "Περιγραφή",
    "form_category": "Κατηγορία",
    "form_priority": "Προτεραιότητα",
    "form_time": "Ώρα",
    "form_pattern": "Επαναλαμβάνεται",
    "form_weekly": "Εβδομαδιαία",
    "form_monthly": "Μηνιαία",
    "form_day_of_month": "Μέρα του μήνα",
    "form_last_day": "Τελευταία μέρα του μήνα",
    "form_starts": "Από",
    "form_ends": "Έως (προαιρετικό)",
    "form_notify": "Υπενθύμιση",
    "form_calendar": "Στο ημερολόγιο",
    "form_save": "Αποθήκευση",
    "form_cancel": "Άκυρο",
    "error_no_days": "Διάλεξε τουλάχιστον μία μέρα.",
    "error_no_name": "Δώσ' του ένα όνομα."
  },
```

- [ ] **Step 2: Build the screen**

Create `frontend/src/components/RecurrencesView.jsx`:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getRecurrences, updateRecurrence, deleteRecurrence } from '../api';
import Switch from './Switch';
import RecurrenceForm from './RecurrenceForm';

/**
 * A rule as one line of human language: "Mon-Fri at 09:00".
 *
 * Exported because the Inbox renders pending AI-made rules with the same
 * sentence (slice 2) — a recurrence the user is asked to approve must read
 * the same as one they already own, or they are approving something else.
 */
export function describeRecurrence(rule, t) {
  const days = rule.weekdays || [];
  let when;

  if (rule.freq === 'monthly') {
    when = rule.month_day === -1
      ? t('recurrence.monthly_last')
      : t('recurrence.monthly_day', { day: rule.month_day });
  } else if (days.length === 7) {
    when = t('recurrence.every_day');
  } else if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) {
    when = t('recurrence.weekdays');
  } else if (days.length === 2 && days.includes(6) && days.includes(7)) {
    when = t('recurrence.weekends');
  } else {
    const short = t('recurrence.days_short', { returnObjects: true });
    when = days.slice().sort().map((d) => short[d - 1]).join(' ');
  }

  const time = rule.due_time
    ? t('recurrence.at_time', { time: rule.due_time })
    : t('recurrence.no_time');
  return `${when} · ${time}`;
}

function RecurrencesView({ onShowToast }) {
  const { t } = useTranslation();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | rule object

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRecurrences();
      setRules(data.recurrences || []);
    } catch (err) {
      onShowToast?.(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [onShowToast]);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(rule) {
    const next = !rule.is_active;
    // Optimistic: the switch must move under the finger. A failure reloads.
    setRules((prev) => prev.map((r) =>
      r.record_id === rule.record_id ? { ...r, is_active: next } : r));
    try {
      await updateRecurrence(rule.record_id, { is_active: next });
      onShowToast?.(next ? t('recurrence.resumed') : t('recurrence.paused'), 'success');
    } catch (err) {
      onShowToast?.(err.message, 'error');
      load();
    }
  }

  async function handleDelete(rule) {
    if (!window.confirm(t('recurrence.delete_confirm'))) return;
    try {
      await deleteRecurrence(rule.record_id);
      setRules((prev) => prev.filter((r) => r.record_id !== rule.record_id));
      onShowToast?.(t('recurrence.deleted'), 'success');
    } catch (err) {
      onShowToast?.(err.message, 'error');
    }
  }

  if (editing) {
    return (
      <RecurrenceForm
        rule={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); onShowToast?.(t('recurrence.saved'), 'success'); load(); }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setEditing('new')}
        className="w-full px-4 py-2 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white text-sm font-medium transition-colors"
      >
        + {t('recurrence.new')}
      </button>

      {loading && <p className="text-sm text-[var(--text-muted)]">…</p>}

      {!loading && rules.length === 0 && (
        <div className="py-6 text-center">
          <p className="text-sm text-[var(--text-primary)]">{t('recurrence.empty')}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t('recurrence.empty_hint')}</p>
        </div>
      )}

      {rules.map((rule) => (
        <div
          key={rule.record_id}
          className="flex items-center gap-3 p-3 rounded-md border border-[var(--border-medium)] bg-[var(--bg-input)]"
        >
          <button
            type="button"
            onClick={() => setEditing(rule)}
            className="flex-1 text-left min-w-0"
          >
            <span className={`block text-sm font-medium truncate ${rule.is_active ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
              {rule.task_name}
            </span>
            <span className="block text-xs text-[var(--text-muted)] truncate">
              {describeRecurrence(rule, t)}
            </span>
          </button>

          <Switch
            checked={rule.is_active}
            onChange={() => handleToggle(rule)}
            aria-label={rule.task_name}
          />

          <button
            type="button"
            onClick={() => handleDelete(rule)}
            aria-label={t('recurrence.delete')}
            className="text-[var(--text-muted)] hover:text-[var(--danger-text)] transition-colors p-1"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export default RecurrencesView;
```

**Before writing this file**, open `components/Switch.jsx` and confirm its prop names (`checked`/`onChange` above is the assumption). If they differ, use the real ones — `NotificationsSection` in `SettingsModal.jsx` already uses this component and is the reference.

- [ ] **Step 3: Verify the build**

Run: `cd frontend && npm run build`
Expected: **FAILS**, on `Could not resolve "./RecurrenceForm"`. That file is Task 15, and these two ship as a pair — the screen with no form is not a deliverable. Do not stub it and do not comment the import out; go straight to Task 15 and the build is verified there.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/RecurrencesView.jsx frontend/src/locales
git commit -F- <<'EOF'
The Recurrences screen: what repeats, when, and a switch per row

describeRecurrence is exported rather than inlined because the Inbox
will render pending AI-made rules with the same sentence. A recurrence
someone is asked to approve must read exactly like one they already own,
or they are approving something else.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 15: The form

**Files:**
- Create: `frontend/src/components/RecurrenceForm.jsx`

**Interfaces:**
- Consumes: `createRecurrence`, `updateRecurrence` (Task 13); `CustomSelect` (`components/CustomSelect.jsx`); `Switch`.
- Produces: default export `RecurrenceForm({ rule, onCancel, onSaved })`.

- [ ] **Step 1: Build the form**

Create `frontend/src/components/RecurrenceForm.jsx`:

```jsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createRecurrence, updateRecurrence } from '../api';
import Switch from './Switch';

const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7]; // 1 = Monday .. 7 = Sunday

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The alarm-clock shape: a time, and seven day toggles. Monthly is the second
 * mechanism, not a variation of the first, so it swaps the day toggles out
 * entirely rather than adding a mode to them.
 */
function RecurrenceForm({ rule, onCancel, onSaved }) {
  const { t } = useTranslation();
  const isEdit = Boolean(rule);

  const [taskName, setTaskName] = useState(rule?.task_name || '');
  const [description, setDescription] = useState(rule?.description || '');
  const [category, setCategory] = useState(rule?.category || 'Personal');
  const [priority, setPriority] = useState(rule?.priority || 'P3');
  const [dueTime, setDueTime] = useState(rule?.due_time || '');
  const [freq, setFreq] = useState(rule?.freq || 'weekly');
  const [weekdays, setWeekdays] = useState(rule?.weekdays || [1, 2, 3, 4, 5]);
  const [monthDay, setMonthDay] = useState(rule?.month_day ?? 1);
  const [startsOn, setStartsOn] = useState(rule?.starts_on || todayISO());
  const [endsOn, setEndsOn] = useState(rule?.ends_on || '');
  const [notify, setNotify] = useState(rule?.notify_enabled ?? false);
  const [calendar, setCalendar] = useState(rule?.calendar_sync_enabled ?? false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const dayLabels = t('recurrence.days_short', { returnObjects: true });

  function toggleDay(day) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort());
  }

  async function handleSave() {
    if (!taskName.trim()) { setError(t('recurrence.error_no_name')); return; }
    if (freq === 'weekly' && weekdays.length === 0) {
      setError(t('recurrence.error_no_days'));
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      task_name: taskName.trim(),
      description: description.trim(),
      category,
      priority,
      due_time: dueTime || null,
      freq,
      weekdays: freq === 'weekly' ? weekdays : null,
      month_day: freq === 'monthly' ? Number(monthDay) : null,
      starts_on: startsOn,
      ends_on: endsOn || null,
      notify_enabled: notify,
      calendar_sync_enabled: calendar,
    };

    try {
      if (isEdit) {
        await updateRecurrence(rule.record_id, payload);
      } else {
        await createRecurrence(payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const field = 'w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-medium)] rounded-md text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)] transition-colors';
  const label = 'block text-xs text-[var(--text-muted)] mb-1';

  return (
    <div className="space-y-4">
      <div>
        <label className={label}>{t('recurrence.form_name')}</label>
        <input className={field} value={taskName} onChange={(e) => setTaskName(e.target.value)} maxLength={80} />
      </div>

      <div>
        <label className={label}>{t('recurrence.form_description')}</label>
        <textarea className={`${field} resize-none`} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t('recurrence.form_category')}</label>
          <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="Personal">{t('browse.filter_personal')}</option>
            <option value="Business">{t('browse.filter_business')}</option>
            <option value="Unknown">{t('browse.filter_unknown')}</option>
          </select>
        </div>
        <div>
          <label className={label}>{t('recurrence.form_priority')}</label>
          <select className={field} value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
          </select>
        </div>
      </div>

      <div>
        <label className={label}>{t('recurrence.form_time')}</label>
        <input type="time" className={field} value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
      </div>

      <div>
        <label className={label}>{t('recurrence.form_pattern')}</label>
        <div className="flex gap-2 mb-3">
          {['weekly', 'monthly'].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFreq(f)}
              className={`flex-1 py-2 rounded-md text-sm transition-colors ${
                freq === f
                  ? 'bg-[var(--brand-primary)] text-white'
                  : 'bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border-medium)]'
              }`}
            >
              {t(f === 'weekly' ? 'recurrence.form_weekly' : 'recurrence.form_monthly')}
            </button>
          ))}
        </div>

        {freq === 'weekly' ? (
          <div className="flex gap-1.5">
            {ISO_DAYS.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                aria-pressed={weekdays.includes(day)}
                className={`flex-1 aspect-square rounded-full text-sm font-medium transition-colors ${
                  weekdays.includes(day)
                    ? 'bg-[var(--brand-primary)] text-white'
                    : 'bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border-medium)]'
                }`}
              >
                {dayLabels[day - 1]}
              </button>
            ))}
          </div>
        ) : (
          <div>
            <label className={label}>{t('recurrence.form_day_of_month')}</label>
            <select className={field} value={monthDay} onChange={(e) => setMonthDay(e.target.value)}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
              <option value={-1}>{t('recurrence.form_last_day')}</option>
            </select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t('recurrence.form_starts')}</label>
          <input type="date" className={field} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <div>
          <label className={label}>{t('recurrence.form_ends')}</label>
          <input type="date" className={field} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center justify-between py-1">
        <span className="text-sm text-[var(--text-primary)]">{t('recurrence.form_notify')}</span>
        <Switch checked={notify} onChange={() => setNotify((v) => !v)} aria-label={t('recurrence.form_notify')} />
      </div>

      <div className="flex items-center justify-between py-1">
        <span className="text-sm text-[var(--text-primary)]">{t('recurrence.form_calendar')}</span>
        <Switch checked={calendar} onChange={() => setCalendar((v) => !v)} aria-label={t('recurrence.form_calendar')} />
      </div>

      {error && (
        <div className="p-2 rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs">
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 rounded-md border border-[var(--border-medium)] text-sm text-[var(--text-muted)]"
        >
          {t('recurrence.form_cancel')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-2 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {t('recurrence.form_save')}
        </button>
      </div>
    </div>
  );
}

export default RecurrenceForm;
```

- [ ] **Step 2: Verify the build**

Run: `cd frontend && npm run build`
Expected: build succeeds — this is the check Task 14 deferred to here.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/RecurrenceForm.jsx
git commit -F- <<'EOF'
The alarm-clock form: a time, and seven day toggles

Monthly swaps the day toggles out entirely rather than adding a mode to
them, because it is genuinely the second mechanism and not a variation
of the first.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 16: Reachable from Settings, and marked on the task

**Files:**
- Modify: `frontend/src/components/SettingsModal.jsx`
- Modify: `frontend/src/components/TaskRow.jsx`

**Interfaces:**
- Consumes: `RecurrencesView` (Task 14), the `setScreen` navigation already in `SettingsModal.jsx:180-213`.
- Produces: the `recurrences` screen.

- [ ] **Step 1: Add the row and the screen**

In `SettingsModal.jsx`:

1. `import RecurrencesView from './RecurrencesView';` alongside the other component imports.
2. Add a row next to the existing ones at line ~180-182:

```jsx
                <SettingsRow label={t('recurrence.title')} onClick={() => setScreen('recurrences')} />
```

Place it directly under the Notifications row — a recurrence is a thing that fires on a schedule, and that is where the user will look for it.

3. Register the screen. `HostawayConnectionView` (declared at `SettingsModal.jsx:612`) is the exact model: find where the modal branches on `screen` to render it, and add a sibling branch in the same place, with the same back-button and title handling:

```jsx
{screen === 'recurrences' && <RecurrencesView onShowToast={onShowToast} />}
```

Read `HostawayConnectionView`'s own call site for the prop names before writing this — `onShowToast` above is taken from its signature (`function HostawayConnectionView({ onShowToast })`), and the screen title likely comes from a lookup keyed on `screen` rather than from the child. Use `t('recurrence.title')` wherever the Hostaway screen uses `t('hostaway.title')`.

- [ ] **Step 2: Mark a generated task**

In `TaskRow.jsx`, next to where the due date is rendered, add:

```jsx
          {task.recurrence_rule_id && (
            <span
              className="text-[var(--text-muted)] text-xs"
              title={t('recurrence.title')}
              aria-label={t('recurrence.title')}
            >
              ↻
            </span>
          )}
```

**Scope note:** the marker is a marker. It is deliberately not a link in v1 — making it open the Recurrences screen means threading a callback from the row, through the list, through the view, up to the modal, and the screen is one tap away in Settings regardless.

- [ ] **Step 3: Verify the build**

Run: `cd frontend && npm run build`
Expected: build succeeds, no new ESLint violations.

- [ ] **Step 4: Manual check in a running browser**

Start both servers (`uvicorn main:app --reload`, and `cd frontend && npm run dev`), sign in, and walk through:

1. Settings → Recurrences → empty state shows.
2. New recurrence → name "Χάπι", time 09:00, all seven days → Save.
3. Today shows a "Χάπι" task for today; Upcoming and the calendar show the next thirteen.
4. Toggle the rule off → the future ones disappear, today's stays.
5. Toggle it on → they come back.
6. Delete → confirm → they are gone.

**Record what you actually saw.** This project's standing rule is that "it builds" is not evidence — see the repeated "has not been seen running" entries in `PROJECT_STATUS.md`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SettingsModal.jsx frontend/src/components/TaskRow.jsx
git commit -F- <<'EOF'
Recurrences gets a row in Settings, and a task says where it came from

The row sits under Notifications, which is where someone looks for a
thing that fires on a schedule. The marker on the task is a marker and
not a link on purpose: making it open the screen means threading a
callback up through three components, and the screen is one tap away
regardless.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 17: Slice 1 documentation

**Files:**
- Modify: `docs/PROJECT_STATUS.md`, `docs/CURRENT_TASK.md`, `docs/FEATURES.md`

- [ ] **Step 1: Write what is true, including what is not verified**

Add a "In progress / most recent 🚧" entry at the top of `PROJECT_STATUS.md` covering: what shipped, that the mechanism is unit-tested, and **exactly which behaviours have been seen in a running browser and which have not**. Follow the tone of the existing Hostaway entries — they name their own gaps.

Set `CURRENT_TASK.md` to the open verification: a rule running unattended across a real midnight, a missed occurrence actually closing itself on day two, and the reminder firing for a generated occurrence.

- [ ] **Step 2: Commit**

```bash
git add docs/
git commit -F- <<'EOF'
docs: recurrences ship, and what has not been watched running

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

# SLICE 2 — the AI understands "every Monday"

> Do not start this until slice 1 has been seen working in a browser. The whole
> point of the split is that a duplicate task must be attributable to either the
> generator or the extractor, never ambiguously to both.

---

### Task 18: The extraction schema learns recurrence

**Files:**
- Modify: `models.py`
- Test: `tests/test_recurrence_extraction.py`

**Interfaces:**
- Consumes: `SingleTask` (existing, `models.py:11`).
- Produces: `RecurrenceSpec` with `freq: Literal["weekly","monthly"]`, `weekdays: Optional[list[int]]`, `month_day: Optional[int]`; and `SingleTask.recurrence: Optional[RecurrenceSpec]`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_recurrence_extraction.py`:

```python
"""The extractor's output shape, and what the service does with it."""
import pytest
from pydantic import ValidationError

from models import SingleTask, RecurrenceSpec


def test_a_task_without_recurrence_is_unchanged():
    t = SingleTask(task_name="πληρωμή", description="", category="Business", priority="P1")
    assert t.recurrence is None


def test_a_weekly_recurrence_rides_along_with_the_task():
    t = SingleTask(task_name="γυμναστήριο", description="", category="Personal",
                   priority="P3", due_time="19:00",
                   recurrence=RecurrenceSpec(freq="weekly", weekdays=[1, 3]))
    assert t.recurrence.freq == "weekly"
    assert t.recurrence.weekdays == [1, 3]


def test_a_recurrence_spec_is_validated_like_a_rule():
    with pytest.raises(ValidationError):
        RecurrenceSpec(freq="weekly", weekdays=[])
    with pytest.raises(ValidationError):
        RecurrenceSpec(freq="weekly", weekdays=[9])
    with pytest.raises(ValidationError):
        RecurrenceSpec(freq="monthly")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence_extraction.py -q`
Expected: FAIL — `ImportError: cannot import name 'RecurrenceSpec'`

- [ ] **Step 3: Write the minimal implementation**

In `models.py`, add above `SingleTask`:

```python
class RecurrenceSpec(BaseModel):
    """
    The repetition the extractor heard, and nothing else.

    Deliberately smaller than RecurrenceRule: the model's job is to recognise
    "every Monday", not to decide a start date, a grace window or an approval
    state. Everything else is filled in by the server.
    """
    freq: Literal["weekly", "monthly"]
    weekdays: Optional[list[int]] = None
    month_day: Optional[int] = None

    @model_validator(mode="after")
    def validate_shape(self):
        if self.freq == "weekly":
            if not self.weekdays:
                raise ValueError("a weekly recurrence needs at least one weekday")
            if any(d < 1 or d > 7 for d in self.weekdays):
                raise ValueError("weekdays are ISO 1 (Monday) to 7 (Sunday)")
        else:
            if self.month_day is None:
                raise ValueError("a monthly recurrence needs a month_day")
            if self.month_day != -1 and not (1 <= self.month_day <= 31):
                raise ValueError("month_day must be 1-31, or -1 for the last day")
        return self
```

And add one field to `SingleTask`:

```python
    recurrence: Optional[RecurrenceSpec] = Field(
        default=None,
        description=(
            "Set ONLY when the user expressed repetition ('every Monday', "
            "'daily', 'κάθε μέρα', 'the 1st of every month'). weekdays are ISO "
            "1=Monday..7=Sunday. month_day -1 means the last day of the month. "
            "When this is set, due_date MUST be null — the server computes the "
            "dates."
        ),
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence_extraction.py -q`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add models.py tests/test_recurrence_extraction.py
git commit -F- <<'EOF'
The extractor gets somewhere to put "every Monday"

RecurrenceSpec is deliberately smaller than RecurrenceRule: the model's
job is to recognise the repetition, not to decide a start date, a grace
window or an approval state.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 19: The prompt, and routing an extracted recurrence to a pending rule

**Files:**
- Modify: `ai_engine.py:31-45` (`_build_system_instruction`)
- Modify: `services.py` (`extract_and_save_from_text` and its audio/image siblings — find them around `services.py:169`)
- Test: `tests/test_recurrence_extraction.py`

**Interfaces:**
- Consumes: `SingleTask.recurrence` (Task 18), `repository.create_recurrence_rule` (Task 6).
- Produces: `TaskService._save_extracted_recurrence(user_id: str, item: SingleTask) -> RecurrenceRule`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_recurrence_extraction.py`:

```python
from datetime import date

import services
from models import RecurrenceRule


def test_an_extracted_recurrence_becomes_a_rule_that_is_not_yet_approved(monkeypatch):
    """
    A recurrence is a standing commitment that will generate rows for months.
    It waits in the Inbox exactly as an AI-extracted task does.
    """
    seen = {}
    monkeypatch.setattr(services.repository, "create_recurrence_rule",
                        lambda u, rule: seen.setdefault("rule", rule) or rule)

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = services.repository

    item = SingleTask(task_name="γυμναστήριο", description="", category="Personal",
                      priority="P3", due_time="19:00",
                      recurrence=RecurrenceSpec(freq="weekly", weekdays=[1, 3]))

    saved = svc._save_extracted_recurrence("user-1", item)

    assert isinstance(saved, RecurrenceRule)
    assert seen["rule"].approval_status is False, "it must not start producing"
    assert seen["rule"].is_active is True
    assert seen["rule"].weekdays == [1, 3]
    assert seen["rule"].due_time == "19:00"
    assert seen["rule"].task_name == "γυμναστήριο"


def test_an_extracted_recurrence_starts_today_not_on_an_invented_date(monkeypatch):
    monkeypatch.setattr(services.repository, "create_recurrence_rule", lambda u, rule: rule)
    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = services.repository

    item = SingleTask(task_name="x", description="", category="Personal", priority="P3",
                      recurrence=RecurrenceSpec(freq="monthly", month_day=1))

    saved = svc._save_extracted_recurrence("user-1", item)

    assert saved.starts_on == date.today().isoformat()


def test_the_prompt_tells_the_model_when_to_use_recurrence():
    import ai_engine
    instruction = ai_engine._build_system_instruction()
    assert "recurrence" in instruction.lower()
    assert "due_date must be null" in instruction.lower() or "due_date: null" in instruction.lower()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recurrence_extraction.py -q`
Expected: FAIL — `AttributeError: 'TaskService' object has no attribute '_save_extracted_recurrence'`

- [ ] **Step 3: Write the minimal implementation**

In `ai_engine.py`, append to the f-string returned by `_build_system_instruction()` (after the `checklist:` line):

```
- recurrence: set ONLY when the user expressed a repeating commitment — "every Monday", "daily", "κάθε μέρα", "Δευτέρα με Παρασκευή", "the 1st of every month". weekdays are ISO numbers, 1=Monday to 7=Sunday. month_day -1 means the last day of the month. When recurrence is set, due_date must be null: the app computes every date itself, and a date here would create one stray task alongside the repetition. A one-off future task ("Monday at 5") is NOT a recurrence.
```

In `services.py`, add the method to `TaskService`:

```python
    def _save_extracted_recurrence(self, user_id: str, item) -> RecurrenceRule:
        """
        Turns an extracted repetition into a rule that is NOT yet approved.

        It materialises nothing until the user approves it, and that gate is
        the whole reason it exists: an eager extractor turning every "remind me
        daily" into a standing commitment is the failure mode this feature has,
        and the Inbox is where it gets caught. Same treatment AI-extracted
        tasks already get, for a bigger commitment.
        """
        spec = item.recurrence
        rule = RecurrenceRule(
            task_name=item.task_name,
            description=item.description or "",
            category=item.category if item.category != "Hostaway" else "Unknown",
            priority=item.priority,
            due_time=item.due_time,
            checklist=item.checklist or [],
            freq=spec.freq,
            weekdays=spec.weekdays,
            month_day=spec.month_day,
            # Today, never a date the model chose: due_date is required to be
            # null on a recurrence, so there is nothing else it could mean.
            starts_on=datetime.now(ZoneInfo("Europe/Athens")).date().isoformat(),
            is_active=True,
            approval_status=False,
            notify_enabled=bool(item.due_time),
        )
        return repository.create_recurrence_rule(user_id, rule)
```

Then, in each of the three extraction save paths (`extract_and_save_from_text` and its audio/image siblings), route items carrying a recurrence away from `save_task`. The shape, inside the loop over extracted items:

```python
            if getattr(task, "recurrence", None) is not None:
                self._save_extracted_recurrence(user_id, task)
                continue
```

**Read the existing loop before editing it** — the three paths share their structure, and the `continue` must skip only the save, not any per-item logging or counting the response depends on. Update the response count accordingly so a user who dictated one recurrence is not told "0 tasks added" with no explanation.

- [ ] **Step 4: Run the test to verify it passes**

Run: `./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: PASS, all

- [ ] **Step 5: Commit**

```bash
git add ai_engine.py services.py tests/test_recurrence_extraction.py
git commit -F- <<'EOF'
"Every Monday, gym" becomes a rule that waits to be approved

The gate is the point, not politeness: an eager extractor turning every
"remind me daily" into a standing commitment is this feature's failure
mode, and the Inbox is where it gets caught before it has generated a
fortnight of rows.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 20: The Inbox approves a recurrence

**Files:**
- Modify: `frontend/src/components/InboxView.jsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/el.json`

**Interfaces:**
- Consumes: `getRecurrences`, `updateRecurrence`, `deleteRecurrence` (Task 13); `describeRecurrence` (Task 14).
- Produces: pending-rule cards at the top of the Inbox.

- [ ] **Step 1: Add the translation keys**

Add to the `recurrence` object in both locale files:

en.json:
```json
    "pending_title": "New recurrence",
    "pending_hint": "This will keep creating tasks until you switch it off.",
    "approve": "Approve",
    "reject": "Reject",
    "approved": "Recurrence on",
```

el.json:
```json
    "pending_title": "Νέα επανάληψη",
    "pending_hint": "Αυτό θα φτιάχνει tasks μέχρι να το κλείσεις.",
    "approve": "Έγκριση",
    "reject": "Απόρριψη",
    "approved": "Η επανάληψη ξεκίνησε",
```

- [ ] **Step 2: Render pending rules above pending tasks**

`InboxView.jsx` is 42 lines and currently only filters and renders tasks. Add the pending-rule block above that list. Its props come from the parent — `onTasksChanged` below is whatever callback the Inbox already has for "the task list moved"; read the component and use the real name.

```jsx
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getRecurrences, updateRecurrence, deleteRecurrence } from '../api';
import { describeRecurrence } from './RecurrencesView';

function PendingRecurrences({ onApproved }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState([]);

  useEffect(() => {
    let cancelled = false;
    getRecurrences()
      .then((data) => {
        if (cancelled) return;
        setPending((data.recurrences || []).filter((r) => r.approval_status === false));
      })
      .catch(() => { /* the Inbox's tasks matter more than this strip */ });
    return () => { cancelled = true; };
  }, []);

  async function handleApprove(rule) {
    setPending((prev) => prev.filter((r) => r.record_id !== rule.record_id));
    // The server materialises the whole window inside this same call, so the
    // new tasks already exist by the time it returns.
    await updateRecurrence(rule.record_id, { approval_status: true });
    onApproved?.();
  }

  async function handleReject(rule) {
    setPending((prev) => prev.filter((r) => r.record_id !== rule.record_id));
    await deleteRecurrence(rule.record_id);
  }

  if (pending.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {pending.map((rule) => (
        <div
          key={rule.record_id}
          className="p-3 rounded-md border border-[var(--border-medium)] bg-[var(--bg-input)]"
        >
          <span className="block text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            ↻ {t('recurrence.pending_title')}
          </span>
          <span className="block text-sm font-medium text-[var(--text-primary)] mt-1">
            {rule.task_name}
          </span>
          <span className="block text-xs text-[var(--text-muted)]">
            {describeRecurrence(rule, t)}
          </span>
          {/* Not decoration. A task in the Inbox is one row; this is a standing
              commitment, and if the card does not say so the user is approving
              the wrong kind of thing. */}
          <span className="block text-xs text-[var(--text-muted)] mt-2">
            {t('recurrence.pending_hint')}
          </span>

          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => handleReject(rule)}
              className="flex-1 py-1.5 rounded-md border border-[var(--border-medium)] text-xs text-[var(--text-muted)]"
            >
              {t('recurrence.reject')}
            </button>
            <button
              type="button"
              onClick={() => handleApprove(rule)}
              className="flex-1 py-1.5 rounded-md bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white text-xs font-medium transition-colors"
            >
              {t('recurrence.approve')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

Then render `<PendingRecurrences onApproved={onTasksChanged} />` immediately above the existing task list inside `InboxView`'s returned JSX.

- [ ] **Step 3: Verify the build and check it in a browser**

Run: `cd frontend && npm run build`, then with both servers running, type "κάθε Δευτέρα και Τετάρτη γυμναστήριο στις 7" into the ✚ box and confirm: a pending recurrence card appears in the Inbox, no tasks are created yet, Approve creates the fortnight, and Reject leaves nothing behind.

**Note:** this step calls the real Gemini API. Per the owner's standing instruction, **ask before running it** — it spends their money.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/InboxView.jsx frontend/src/locales
git commit -F- <<'EOF'
A pending recurrence is approved as a commitment, not as a task

The card says outright that this will keep creating tasks until it is
switched off. A task in the Inbox is one row; a rule is a standing
commitment, and if that difference is not on the card the user is
approving the wrong kind of thing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 21: Slice 2 documentation

**Files:**
- Modify: `docs/PROJECT_STATUS.md`, `docs/CURRENT_TASK.md`, `docs/FEATURES.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Record the decisions and the gaps**

`DECISIONS.md` gains: why the Todoist model was refused for a business (one row cannot answer "was Monday's done?", and while Monday hangs open there is no row for Tuesday to record); why "let the user choose Todoist or Google" is a false choice (the two properties are independent, and `overdue_count` is the precedent against two mechanisms); and why `missed_at` is not `is_rejected`.

`PROJECT_STATUS.md` and `CURRENT_TASK.md`: what is verified and what is not. In particular, whether the extractor's recurrence detection has been measured against a real suite of Greek and English phrasings, or only smoke-tested — say which.

- [ ] **Step 2: Commit**

```bash
git add docs/
git commit -F- <<'EOF'
docs: why the Todoist model lost, and what the extractor has not been measured on

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Verification checklist for the whole feature

Run these **logged in, against real data**, and write down what actually happened — not what should have happened.

1. A Mon-Fri rule created on a Saturday produces its first task on Monday, not on Saturday.
2. A daily rule created at 18:00 with time 09:00 produces today's occurrence, overdue.
3. Two scheduler ticks in a row create nothing the second time (check `recurrences_created` in the response).
4. Yesterday's untouched occurrence is still visible today, and gone tomorrow.
5. Dragging Monday's task to Tuesday does not recreate Monday on the next tick.
6. Editing a rule's time changes tomorrow's occurrence and leaves today's alone.
7. Switching a rule off clears the upcoming ones immediately; switching it on brings them back.
8. Deleting a rule leaves completed occurrences in place as ordinary tasks.
9. A generated occurrence with the bell on actually sends its push.
10. A generated occurrence with calendar sync on appears in Google Calendar.
11. The agent answers "what do I have Friday?" including a recurring occurrence, and never mentions a missed one.
12. A second account sees none of the first account's rules.
