"""
Making a task the user already has into the first occurrence of a new rule.

The property is one sentence: after "make this repeat", the user must not be
looking at two copies of the same thing today. Everything else here is about
which tasks are eligible to be adopted at all.
"""
from datetime import date

import pytest

import services
from models import RecurrenceRule, TaskRecord


def _rule(**overrides):
    base = dict(record_id="rule-1", task_name="Χάπι", category="Personal", priority="P2",
                due_time="09:00", freq="weekly", weekdays=[1, 2, 3, 4, 5],
                starts_on="2026-08-17")
    base.update(overrides)
    return RecurrenceRule(**base)


def _task(**overrides):
    base = dict(record_id="task-1", task_name="Χάπι", description="", category="Personal",
                priority="P2", due_date="2026-08-17", due_time="09:00",
                ai_suggested_category="Personal", ai_suggested_priority="P2",
                approval_status=True)
    base.update(overrides)
    return TaskRecord(**base)


class _FakeRepo:
    """Records the one write adoption is allowed to make."""

    def __init__(self, task=None):
        self.task = task
        self.updates = []

    def get_task(self, user_id, record_id):
        return self.task

    def update_task(self, user_id, record_id, updates):
        self.updates.append((record_id, dict(updates)))
        return self.task


def _service(repo):
    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = repo
    return svc


def test_a_dated_task_keeps_its_own_day_as_the_occurrence():
    """
    occurrence_date is the task's existing due_date, not today — that is the
    date the generator checks against, so anything else leaves the duplicate
    this whole mechanism exists to prevent.
    """
    repo = _FakeRepo(_task(due_date="2026-08-19"))
    adopted = _service(repo).adopt_task_into_rule("user-1", repo.task, _rule())

    assert adopted is True
    record_id, updates = repo.updates[0]
    assert record_id == "task-1"
    assert updates["recurrence_rule_id"] == "rule-1"
    assert updates["occurrence_date"] == "2026-08-19"


def test_a_dated_task_is_not_moved():
    """
    Adoption links; it does not edit. The rule's due_time is deliberately not
    copied over the task's — the user asked for this task to repeat, not to be
    rewritten.
    """
    repo = _FakeRepo(_task(due_date="2026-08-19", due_time="07:30"))
    _service(repo).adopt_task_into_rule("user-1", repo.task, _rule(due_time="09:00"))

    _, updates = repo.updates[0]
    assert "due_date" not in updates
    assert "due_time" not in updates


def test_an_undated_task_is_pinned_to_the_rules_start():
    """
    occurrence_date is NOT nullable in any useful sense here: the generator
    matches on it, so an occurrence without one is invisible to the dedupe and
    gets a twin on the next tick. A loose task therefore lands on starts_on,
    and its due_date follows so the two agree.
    """
    repo = _FakeRepo(_task(due_date=None))
    adopted = _service(repo).adopt_task_into_rule("user-1", repo.task, _rule(starts_on="2026-08-17"))

    assert adopted is True
    _, updates = repo.updates[0]
    assert updates["occurrence_date"] == "2026-08-17"
    assert updates["due_date"] == "2026-08-17"


@pytest.mark.parametrize("closed", [
    {"is_completed": True},
    {"is_rejected": True},
    {"missed_at": "2026-08-16T00:00:00"},
    {"cancelled_at": "2026-08-16T00:00:00"},
])
def test_a_closed_task_is_left_alone(closed):
    """
    "Do this every week from now on" is a statement about the future. Reaching
    back into a finished row to relabel it as an occurrence rewrites history
    the user did not ask about — and a completed one would hand the rule a day
    that is already ticked off.
    """
    repo = _FakeRepo(_task(**closed))
    adopted = _service(repo).adopt_task_into_rule("user-1", repo.task, _rule())

    assert adopted is False
    assert repo.updates == []


def test_the_adopted_day_is_not_generated_a_second_time(monkeypatch):
    """
    The two halves meeting: adoption writes an occurrence_date, and the
    generator reads occurrence_dates to decide what is missing. If they ever
    stop agreeing, the user gets two identical tasks on day one — the single
    most visible way this feature can fail.
    """
    repo = _FakeRepo(_task(due_date="2026-08-17"))
    svc = _service(repo)

    # The fake store the two halves share: adoption writes into it, the
    # generator reads out of it.
    on_disk = set()

    def _update_task(user_id, record_id, updates):
        on_disk.add(updates["occurrence_date"])
        return repo.task

    repo.update_task = _update_task

    created = []
    monkeypatch.setattr(services.repository, "get_occurrence_dates",
                        lambda u, r, f, t: set(on_disk))
    monkeypatch.setattr(services.repository, "update_recurrence_rule",
                        lambda u, rid, updates: None)
    monkeypatch.setattr(svc, "create_task_manual",
                        lambda user_id, fields, approval_status=True:
                            created.append(fields) or fields,
                        raising=False)

    rule = _rule()
    svc.adopt_task_into_rule("user-1", repo.task, rule)
    svc.materialize_recurrence_rule("user-1", rule, date(2026, 8, 17))

    dates = [f["occurrence_date"] for f in created]
    assert "2026-08-17" not in dates, "the adopted task's own day was generated again"
    assert dates[0] == "2026-08-18", "the day after it, however, must still appear"
