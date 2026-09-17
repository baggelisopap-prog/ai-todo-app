"""
A task the user deleted must not ring anybody's phone.

WHY THIS FILE EXISTS. On 2026-09-04 delete stopped removing the row and started
stamping `deleted_at` instead, so that Browse's History tab has something to
show and Restore has something to clear. Every SCREEN learned about that column.
The three queries behind the notification scheduler did not: each of them
hand-filters on approval_status / is_completed / is_rejected, the three states
that existed when they were written.

The declared single source of truth for "does this still count" is
agent_tools.is_open_task, and its own comment claims that "the escalation query
and the reminders all read" it. That was never true — it is read only by the
agent. These tests are what makes the claim true.

Reported by the owner, 2026-09-16: a reminder arrived for a task he did not
recognise, because he had deleted it and it was gone from every list he could
have checked against.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import repository
from models import Category, TaskRecord

ATHENS = ZoneInfo("Europe/Athens")


def _task(**overrides):
    base = dict(record_id="t1", task_name="Task", description="", category="Business",
                priority="P1", ai_suggested_category="Business", ai_suggested_priority="P1",
                approval_status=True, notify_enabled=True)
    base.update(overrides)
    return TaskRecord(**base)


def _due_in(minutes: int, now: datetime) -> dict:
    """due_date/due_time landing inside the reminder window."""
    when = now + timedelta(minutes=minutes)
    return {"due_date": when.strftime("%Y-%m-%d"), "due_time": when.strftime("%H:%M")}


# --- advance reminder ---------------------------------------------------------
# The one the owner actually received.

def _window():
    now = datetime(2026, 9, 16, 9, 0, tzinfo=ATHENS)
    return now, now + timedelta(minutes=15)


def test_a_deleted_task_gets_no_advance_reminder():
    now, end = _window()
    deleted = _task(record_id="gone", deleted_at="2026-09-15T20:00:00+03:00", **_due_in(10, now))

    result = repository.get_tasks_due_for_notification("u1", now, end, tasks=[deleted])

    assert result == []


def test_a_cancelled_occurrence_gets_no_advance_reminder():
    now, end = _window()
    cancelled = _task(record_id="gone", cancelled_at="2026-09-15T20:00:00+03:00",
                      recurrence_rule_id="r1", **_due_in(10, now))

    result = repository.get_tasks_due_for_notification("u1", now, end, tasks=[cancelled])

    assert result == []


def test_a_missed_occurrence_gets_no_advance_reminder():
    """Closed itself when its day passed. Cannot normally land in a FUTURE
    window, so this is a guarantee about the shared definition rather than a
    reproduction — it is here so the three dead-row columns stay one answer."""
    now, end = _window()
    missed = _task(record_id="gone", missed_at="2026-09-15T06:00:00+03:00",
                   recurrence_rule_id="r1", **_due_in(10, now))

    result = repository.get_tasks_due_for_notification("u1", now, end, tasks=[missed])

    assert result == []


def test_a_live_task_still_gets_its_advance_reminder():
    """The control. A fix that silences everything is not a fix."""
    now, end = _window()
    live = _task(record_id="here", **_due_in(10, now))

    result = repository.get_tasks_due_for_notification("u1", now, end, tasks=[live])

    assert [t.record_id for t in result] == ["here"]


# --- daily summary ------------------------------------------------------------

def test_a_deleted_task_is_not_counted_in_the_daily_summary():
    deleted = _task(record_id="gone", due_date="2026-09-16",
                    deleted_at="2026-09-15T20:00:00+03:00")
    live = _task(record_id="here", due_date="2026-09-16")

    result = repository.get_tasks_for_date("u1", "2026-09-16", tasks=[deleted, live])

    assert [t.record_id for t in result] == ["here"]


def test_a_deleted_task_does_not_set_the_time_the_summary_fires():
    """`before_first_task` mode aims the morning summary at the earliest task of
    the day. A deleted 07:00 task would drag the whole summary an hour early —
    a wrong time, not just a wrong line in the list."""
    deleted = _task(record_id="gone", due_date="2026-09-16", due_time="07:00",
                    deleted_at="2026-09-15T20:00:00+03:00")
    live = _task(record_id="here", due_date="2026-09-16", due_time="09:00")

    first = repository.get_first_task_datetime_today("u1", "2026-09-16", tasks=[deleted, live])

    assert first == datetime(2026, 9, 16, 9, 0)


# --- Hostaway escalation ------------------------------------------------------
# The worst of the three: nothing caps it, so it re-sends for as long as the
# task stays "open".

_HOSTAWAY_CAT = Category(record_id="cat-h", workspace_id="ws-1",
                         name="Hostaway", system_key="hostaway")


def test_a_deleted_guest_task_stops_escalating(monkeypatch):
    monkeypatch.setattr(repository, "get_system_category", lambda u, k: _HOSTAWAY_CAT)
    deleted = _task(record_id="gone", category_id="cat-h",
                    deleted_at="2026-09-15T20:00:00+03:00")

    result = repository.get_active_hostaway_tasks("u1", tasks=[deleted])

    assert result == []


def test_a_cancelled_guest_task_stops_escalating(monkeypatch):
    monkeypatch.setattr(repository, "get_system_category", lambda u, k: _HOSTAWAY_CAT)
    cancelled = _task(record_id="gone", category_id="cat-h",
                      cancelled_at="2026-09-15T20:00:00+03:00")

    result = repository.get_active_hostaway_tasks("u1", tasks=[cancelled])

    assert result == []


def test_an_unapproved_guest_task_STILL_escalates(monkeypatch):
    """The guarantee the fix must not break. A guest message arrives from the
    webhook UNAPPROVED and sits in the Inbox — escalating it is the entire point
    of escalation, so this query must NOT adopt is_open_task's approval clause
    along with its dead-row clauses."""
    monkeypatch.setattr(repository, "get_system_category", lambda u, k: _HOSTAWAY_CAT)
    pending = _task(record_id="waiting", category_id="cat-h", approval_status=False)

    result = repository.get_active_hostaway_tasks("u1", tasks=[pending])

    assert [t.record_id for t in result] == ["waiting"]
