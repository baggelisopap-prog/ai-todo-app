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
