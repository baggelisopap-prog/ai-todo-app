"""
The four endpoints. What matters here is what each one does BESIDES the write:
creating and editing must materialise synchronously, or the user stares at an
empty list for up to two minutes and concludes it is broken.
"""
import pytest
from fastapi.testclient import TestClient

import main
from models import RecurrenceRule, TaskRecord

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

    def _materialize(u, rule, today):
        # Not `seen.setdefault(...) or 3`: record_id is always truthy, so
        # that idiom always short-circuits to record_id and never reaches 3.
        seen["materialized"] = rule.record_id
        return 3

    monkeypatch.setattr(main.service, "materialize_recurrence_rule", _materialize)

    r = client.post("/recurrences", json={
        "task_name": "Χάπι", "freq": "weekly", "weekdays": [1, 2, 3, 4, 5],
        "starts_on": "2026-08-17", "due_time": "09:00", "category": "Personal",
    })

    assert r.status_code == 201
    assert seen["materialized"] == "rule-1"
    assert r.json()["occurrences_created"] == 3


def _task(**overrides):
    base = dict(record_id="task-1", task_name="Χάπι", description="", category="Personal",
                priority="P2", due_date="2026-08-17",
                ai_suggested_category="Personal", ai_suggested_priority="P2")
    base.update(overrides)
    return TaskRecord(**base)


def test_adopting_a_task_happens_before_the_generator_runs(client, monkeypatch):
    """
    Order is the whole trick: the generator skips occurrence_dates that already
    exist, so the link has to be on disk before it looks. Reversed, the user
    gets two copies of today's task and the feature reads as broken.
    """
    calls = []
    monkeypatch.setattr(main.service.repository, "get_task", lambda u, rid: _task())
    monkeypatch.setattr(main.repository, "create_recurrence_rule",
                        lambda u, rule: calls.append("created") or _rule())
    monkeypatch.setattr(main.service, "adopt_task_into_rule",
                        lambda u, task, rule: calls.append(f"adopted:{rule.record_id}") or True)
    monkeypatch.setattr(main.service, "materialize_recurrence_rule",
                        lambda u, rule, today: calls.append("materialized") or 10)

    r = client.post("/recurrences", json={
        "task_name": "Χάπι", "freq": "weekly", "weekdays": [1, 2, 3, 4, 5],
        "starts_on": "2026-08-17", "adopt_task_id": "task-1",
    })

    assert r.status_code == 201
    assert calls == ["created", "adopted:rule-1", "materialized"]


def test_adopt_task_id_is_not_written_onto_the_rule(client, monkeypatch):
    """It addresses a task; it is not part of what repeats."""
    seen = {}
    monkeypatch.setattr(main.service.repository, "get_task", lambda u, rid: _task())
    monkeypatch.setattr(main.repository, "create_recurrence_rule",
                        lambda u, rule: seen.setdefault("rule", rule) or _rule())
    monkeypatch.setattr(main.service, "adopt_task_into_rule", lambda u, task, rule: True)
    monkeypatch.setattr(main.service, "materialize_recurrence_rule", lambda u, rule, today: 0)

    client.post("/recurrences", json={
        "task_name": "Χάπι", "freq": "weekly", "weekdays": [1],
        "starts_on": "2026-08-17", "adopt_task_id": "task-1",
    })

    assert not hasattr(seen["rule"], "adopt_task_id")


def test_adopting_a_task_that_is_not_yours_is_a_404_and_creates_no_rule(client, monkeypatch):
    """
    Checked before the rule is written, not after. A rule created and then
    abandoned by a failed adoption is a standing commitment the user never got
    to see, firing every morning.
    """
    created = []
    monkeypatch.setattr(main.service.repository, "get_task", lambda u, rid: None)
    monkeypatch.setattr(main.repository, "create_recurrence_rule",
                        lambda u, rule: created.append(rule) or _rule())

    r = client.post("/recurrences", json={
        "task_name": "Χάπι", "freq": "weekly", "weekdays": [1],
        "starts_on": "2026-08-17", "adopt_task_id": "someone-elses",
    })

    assert r.status_code == 404
    assert created == []


def test_adopting_a_task_that_already_repeats_is_a_422_and_creates_no_rule(client, monkeypatch):
    """There is no "change which rule owns this" — that would orphan the first."""
    created = []
    monkeypatch.setattr(main.service.repository, "get_task",
                        lambda u, rid: _task(recurrence_rule_id="rule-0"))
    monkeypatch.setattr(main.repository, "create_recurrence_rule",
                        lambda u, rule: created.append(rule) or _rule())

    r = client.post("/recurrences", json={
        "task_name": "Χάπι", "freq": "weekly", "weekdays": [1],
        "starts_on": "2026-08-17", "adopt_task_id": "task-1",
    })

    assert r.status_code == 422
    assert created == []


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

    monkeypatch.setattr(main.repository, "get_recurrence_rule", lambda u, rid: _rule())
    monkeypatch.setattr(main.repository, "update_recurrence_rule", _update)

    def _regenerate(u, rule, today):
        # Same short-circuit pitfall as _materialize above: record_id is
        # always truthy, so `seen.setdefault(...) or 5` never reaches 5.
        seen["regenerated"] = rule.record_id
        return 5

    monkeypatch.setattr(main.service, "regenerate_recurrence_rule", _regenerate)

    r = client.patch("/recurrences/rule-1", json={"due_time": "20:00"})

    assert r.status_code == 200
    assert seen["updates"] == {"due_time": "20:00"}
    assert seen["regenerated"] == "rule-1"


def test_pausing_a_rule_also_regenerates_so_the_future_clears(client, monkeypatch):
    """Off must mean off now, not in a fortnight."""
    seen = {}
    monkeypatch.setattr(main.repository, "get_recurrence_rule", lambda u, rid: _rule())
    monkeypatch.setattr(main.repository, "update_recurrence_rule",
                        lambda u, rid, updates: _rule(is_active=False))
    monkeypatch.setattr(main.service, "regenerate_recurrence_rule",
                        lambda u, rule, today: seen.setdefault("regenerated", True) or 0)

    r = client.patch("/recurrences/rule-1", json={"is_active": False})

    assert r.status_code == 200
    assert seen["regenerated"] is True


def test_editing_a_rule_that_is_not_yours_is_a_404(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_recurrence_rule", lambda u, rid: None)
    assert client.patch("/recurrences/someone-elses", json={"due_time": "20:00"}).status_code == 404


def test_patching_ends_on_to_null_clears_it(client, monkeypatch):
    """
    exclude_unset=True already omits fields the client never sent — a second
    filter dropping None values would ALSO discard a field sent explicitly as
    null, which is precisely how a client says "clear this field."
    """
    seen = {}
    monkeypatch.setattr(main.repository, "get_recurrence_rule",
                        lambda u, rid: _rule(ends_on="2026-12-31"))

    def _update(u, rid, updates):
        seen["updates"] = updates
        return _rule()

    monkeypatch.setattr(main.repository, "update_recurrence_rule", _update)
    monkeypatch.setattr(main.service, "regenerate_recurrence_rule", lambda u, rule, today: 0)

    r = client.patch("/recurrences/rule-1", json={"ends_on": None})

    assert r.status_code == 200
    assert seen["updates"] == {"ends_on": None}


def test_patching_a_weekly_rule_to_no_weekdays_is_a_422(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_recurrence_rule", lambda u, rid: _rule())
    r = client.patch("/recurrences/rule-1", json={"weekdays": []})
    assert r.status_code == 422


def test_patching_category_to_hostaway_is_a_422(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_recurrence_rule", lambda u, rid: _rule())
    r = client.patch("/recurrences/rule-1", json={"category": "Hostaway"})
    assert r.status_code == 422


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
