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
import services
from models import TaskRecord


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
