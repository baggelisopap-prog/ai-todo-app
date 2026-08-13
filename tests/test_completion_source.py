"""
Every completion says who did it.

Written because a task closed itself on 2026-08-13 six seconds after it was
created and the question "what closed it?" had no answer anywhere — not in
the row, not in a log, not in agent_runs. Ruling out the Hostaway poller took
half an hour of forensics and ended at "a write shaped like the UI's", which
is a guess. One column ends that.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import services
from models import TaskRecord


def _task(record_id="task-1", completed=False):
    return TaskRecord(
        task_name="Hostaway: vangelis papazoglou - Pine Lodge",
        description="γεια σας", category="Hostaway", priority="P3", checklist=[],
        ai_suggested_category="Hostaway", ai_suggested_priority="P3",
        record_id=record_id, is_completed=completed,
    )


def _service(monkeypatch):
    """A TaskService whose repository records the updates it is handed."""
    calls = []

    class _Repo:
        def update_task(self, user_id, record_id, updates):
            calls.append(updates)
            return _task(record_id)

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = _Repo()
    # The calendar leg of update_task is not what these tests are about.
    monkeypatch.setattr(services.repository, "get_task_calendar_fields", lambda u, r: None)
    return svc, calls


def _is_recent_athens_iso(value: str) -> bool:
    stamped = datetime.fromisoformat(value)
    assert stamped.tzinfo is not None, "a timestamptz column needs an offset"
    return abs((datetime.now(ZoneInfo("Europe/Athens")) - stamped).total_seconds()) < 60


def test_completing_from_the_ui_records_the_ui(monkeypatch):
    svc, calls = _service(monkeypatch)
    svc.update_task("user-1", "task-1", {"is_completed": True})

    assert calls[0]["completed_source"] == "ui"
    assert _is_recent_athens_iso(calls[0]["completed_at"])


def test_completing_from_the_agent_records_the_agent(monkeypatch):
    """The agent's confirm-action path shares update_task with the UI."""
    svc, calls = _service(monkeypatch)
    svc.update_task("user-1", "task-1", {"is_completed": True}, completed_source="agent")

    assert calls[0]["completed_source"] == "agent"


def test_un_completing_clears_the_stamp(monkeypatch):
    """Otherwise a reopened task keeps claiming it was closed, and when."""
    svc, calls = _service(monkeypatch)
    svc.update_task("user-1", "task-1", {"is_completed": False})

    assert calls[0]["completed_at"] is None
    assert calls[0]["completed_source"] is None


def test_an_edit_that_is_not_a_completion_leaves_the_stamp_alone(monkeypatch):
    """Renaming a task must not restamp — or rewrite — how it was closed."""
    svc, calls = _service(monkeypatch)
    svc.update_task("user-1", "task-1", {"task_name": "renamed"})

    assert "completed_at" not in calls[0]
    assert "completed_source" not in calls[0]
