"""
Escalation stops matching the literal word "Hostaway" and starts matching the
one category row carrying system_key='hostaway'. This is the single change that
lets categories become user-defined without the integration noticing.
"""
import repository
from models import Category, TaskRecord


def _task(**overrides):
    base = dict(record_id="t1", task_name="Guest", description="", category="Hostaway",
                priority="P1", ai_suggested_category="Hostaway", ai_suggested_priority="P1",
                approval_status=True)
    base.update(overrides)
    return TaskRecord(**base)


_HOSTAWAY_CAT = Category(record_id="cat-h", workspace_id="ws-1",
                         name="Hostaway", system_key="hostaway")


def test_escalation_finds_tasks_by_category_id(monkeypatch):
    monkeypatch.setattr(repository, "get_system_category", lambda u, k: _HOSTAWAY_CAT)
    tasks = [_task(record_id="t1", category_id="cat-h"),
             _task(record_id="t2", category_id="cat-other", category="Business")]

    result = repository.get_active_hostaway_tasks("user-1", tasks=tasks)

    assert [t.record_id for t in result] == ["t1"]


def test_a_renamed_hostaway_category_still_escalates(monkeypatch):
    """The name is the user's label. If matching were on the name, renaming it
    would silently stop every guest escalation on the account."""
    renamed = Category(record_id="cat-h", workspace_id="ws-1",
                       name="Μηνύματα επισκεπτών", system_key="hostaway")
    monkeypatch.setattr(repository, "get_system_category", lambda u, k: renamed)

    result = repository.get_active_hostaway_tasks("user-1", tasks=[_task(category_id="cat-h")])

    assert len(result) == 1


def test_a_task_still_carrying_the_old_word_but_no_category_is_NOT_matched(monkeypatch):
    """The migration is what puts category_id on existing guest tasks. A task
    that somehow escaped it is invisible to escalation — which is exactly why
    migration query 3 must report zero before Part B is ever run."""
    monkeypatch.setattr(repository, "get_system_category", lambda u, k: _HOSTAWAY_CAT)

    result = repository.get_active_hostaway_tasks(
        "user-1", tasks=[_task(category="Hostaway", category_id=None)]
    )

    assert result == []


def test_closed_and_rejected_tasks_are_still_excluded(monkeypatch):
    """Pre-existing behaviour that must survive the rekeying."""
    monkeypatch.setattr(repository, "get_system_category", lambda u, k: _HOSTAWAY_CAT)
    tasks = [_task(record_id="open", category_id="cat-h"),
             _task(record_id="done", category_id="cat-h", is_completed=True),
             _task(record_id="rejected", category_id="cat-h", is_rejected=True)]

    result = repository.get_active_hostaway_tasks("user-1", tasks=tasks)

    assert [t.record_id for t in result] == ["open"]


def test_an_account_with_no_system_category_escalates_nothing(monkeypatch):
    """Rather than raising. This runs inside the scheduler's per-user loop,
    where one raise costs every user processed after it their whole tick — the
    lesson the Hostaway encryption key already taught once."""
    monkeypatch.setattr(repository, "get_system_category", lambda u, k: None)

    assert repository.get_active_hostaway_tasks("user-1", tasks=[_task(category_id="cat-h")]) == []
