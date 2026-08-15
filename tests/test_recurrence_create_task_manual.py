"""
create_task_manual is the single creation path for manual, agent-confirmed,
Hostaway and recurrence tasks. If it drops recurrence_rule_id or
occurrence_date on the floor, every materialised occurrence is written with
both columns NULL. The UNIQUE (recurrence_rule_id, occurrence_date)
constraint cannot catch that -- PostgreSQL treats NULLs as distinct, so two
NULLs never conflict -- and get_occurrence_dates, which filters on
recurrence_rule_id, would then match nothing on every subsequent tick. The
materialiser would see the whole window as missing and recreate it, forever,
every ~2 minutes. This test exists so that regression is caught here, not in
a real person's task list.
"""
from datetime import date

import services
from models import RecurrenceRule, TaskRecord


class _FakeRepository:
    """Captures the TaskRecord handed to save_task; does no real I/O."""

    def __init__(self):
        self.saved = None

    def save_task(self, user_id, task: TaskRecord) -> TaskRecord:
        self.saved = task
        return task


def test_create_task_manual_preserves_the_recurrence_link():
    repo = _FakeRepository()
    svc = services.TaskService(repository=repo)

    svc.create_task_manual("user-1", {
        "task_name": "Χάπι",
        "category": "Personal",
        "priority": "P2",
        "due_date": "2026-08-20",
        "recurrence_rule_id": "rule-xyz",
        "occurrence_date": "2026-08-20",
    })

    assert repo.saved.recurrence_rule_id == "rule-xyz"
    assert repo.saved.occurrence_date == "2026-08-20"


def test_an_ordinary_manual_task_gets_no_recurrence_link():
    repo = _FakeRepository()
    svc = services.TaskService(repository=repo)

    svc.create_task_manual("user-1", {
        "task_name": "πληρωμή",
        "category": "Business",
        "priority": "P1",
    })

    assert repo.saved.recurrence_rule_id is None
    assert repo.saved.occurrence_date is None


def test_materialize_recurrence_rule_produces_an_approved_linked_record(monkeypatch):
    """
    materialize_recurrence_rule's own docstring promises occurrences are
    created ALREADY APPROVED, and _occurrence_fields sets recurrence_rule_id,
    occurrence_date and calendar_sync_enabled -- but a test that only checks
    the dict those methods build proves nothing about what gets saved, since
    create_task_manual reads approval_status from a separate kwarg and, until
    this file's Critical fix, silently dropped the other three on the floor.
    This runs materialize_recurrence_rule end to end, through the REAL
    create_task_manual (no monkeypatch on it), and checks the TaskRecord that
    actually reached save_task.
    """
    repo = _FakeRepository()
    svc = services.TaskService(repository=repo)
    monkeypatch.setattr(services.repository, "get_occurrence_dates", lambda u, r, f, t: set())
    monkeypatch.setattr(services.repository, "update_recurrence_rule", lambda u, r, updates: None)

    # weekdays=[1] with starts_on == ends_on pins the window to exactly one
    # Monday, so exactly one save_task call happens and repo.saved is
    # unambiguous.
    rule = RecurrenceRule(record_id="rule-1", task_name="Χάπι", category="Personal",
                          priority="P2", due_time="09:00", freq="weekly",
                          weekdays=[1], starts_on="2026-08-17", ends_on="2026-08-17",
                          notify_enabled=True, calendar_sync_enabled=True)

    svc.materialize_recurrence_rule("user-1", rule, date(2026, 8, 17))

    assert repo.saved.approval_status is True
    assert repo.saved.recurrence_rule_id == "rule-1"
    assert repo.saved.occurrence_date == "2026-08-17"
    assert repo.saved.calendar_sync_enabled is True
