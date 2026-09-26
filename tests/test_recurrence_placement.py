"""
Where a recurrence files its occurrences (2026-09-26).

Until then the form offered only the four old category words, which file
nothing, and every occurrence was stored unfiled — while the owner's one rule,
«Χάπι end», said Personal in its own row: 29 occurrences of it had no
workspace. The rule now carries a workspace and a category, the routes check
them the way task placement is checked, and every occurrence copies them.
"""
from datetime import date

import pytest
from fastapi.testclient import TestClient

import main
import repository
import services
from models import Category, RecurrenceRule

USER = "user-1"


def _rule(**overrides):
    base = dict(record_id="rule-1", task_name="Χάπι end", category="Personal", priority="P1",
                due_time="10:00", freq="weekly", weekdays=[1, 2, 3, 4, 5, 6, 7],
                starts_on="2026-09-21")
    base.update(overrides)
    return RecurrenceRule(**base)


# ------------------------------------------------------------ the rule's row

def test_the_row_reader_returns_the_placement():
    """The columns existed since 2026-09-01 and the migration had filled
    workspace_id — but the reader dropped them, so the rule never knew."""
    rule = repository._supabase_row_to_rule({
        "id": "rule-1", "task_name": "Χάπι end", "freq": "weekly", "weekdays": [1],
        "starts_on": "2026-09-21", "workspace_id": "ws-personal", "category_id": "cat-health",
    })

    assert (rule.workspace_id, rule.category_id) == ("ws-personal", "cat-health")


# ------------------------------------------------------------ occurrences

def _wire(monkeypatch, visible):
    created = []
    monkeypatch.setattr(services.repository, "get_occurrence_dates", lambda u, r, f, t: set())
    monkeypatch.setattr(services.repository, "update_recurrence_rule", lambda u, rid, up: None)
    monkeypatch.setattr(services.repository, "get_visible_workspace_ids", lambda u: list(visible))
    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = services.repository
    monkeypatch.setattr(svc, "create_task_manual",
                        lambda user_id, fields, approval_status=True: created.append(fields) or fields,
                        raising=False)
    return svc, created


def test_every_occurrence_goes_where_its_rule_says(monkeypatch):
    svc, created = _wire(monkeypatch, visible=["ws-personal"])

    svc.materialize_recurrence_rule(USER, _rule(workspace_id="ws-personal", category_id="cat-health"),
                                    date(2026, 9, 26))

    assert created
    assert {(f["workspace_id"], f["category_id"]) for f in created} == {("ws-personal", "cat-health")}


def test_a_rule_in_a_room_the_user_no_longer_sees_files_its_days_nowhere(monkeypatch):
    """Archived, or a room they left: a daily pill put where its owner cannot
    see it is a pill nobody is reminded of. Unfiled is still in «Όλα»."""
    svc, created = _wire(monkeypatch, visible=["ws-other"])

    svc.materialize_recurrence_rule(USER, _rule(workspace_id="ws-gone", category_id="cat-gone"),
                                    date(2026, 9, 26))

    assert created
    assert {(f["workspace_id"], f["category_id"]) for f in created} == {(None, None)}


def test_an_unfiled_rule_asks_nothing_and_stays_unfiled(monkeypatch):
    svc, created = _wire(monkeypatch, visible=[])
    monkeypatch.setattr(services.repository, "get_visible_workspace_ids",
                        lambda u: pytest.fail("no workspace, so no membership read"))

    svc.materialize_recurrence_rule(USER, _rule(), date(2026, 9, 26))

    assert {(f["workspace_id"], f["category_id"]) for f in created} == {(None, None)}


# ------------------------------------------------------------ the routes

@pytest.fixture
def client():
    main.app.dependency_overrides[main.get_current_user_id] = lambda: USER
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


CATS = [
    Category(record_id="cat-health", workspace_id="ws-personal", name="υγεία"),
    Category(record_id="cat-host", workspace_id="ws-business", name="Hostaway", system_key="hostaway"),
    Category(record_id="cat-office", workspace_id="ws-business", name="γραφείο"),
]


def _world(monkeypatch, member_of=("ws-personal", "ws-business")):
    monkeypatch.setattr(main.repository, "get_member_workspace_ids", lambda u: list(member_of))
    monkeypatch.setattr(main.repository, "get_category_in_workspaces", lambda i, ids: next(
        (c for c in CATS if c.record_id == i and c.workspace_id in ids), None))
    saved = {}
    monkeypatch.setattr(main.repository, "create_recurrence_rule",
                        lambda u, rule: saved.setdefault("rule", rule.model_copy(update={"record_id": "rule-1"})))
    monkeypatch.setattr(main.service, "materialize_recurrence_rule", lambda u, rule, today: 0)
    return saved


BODY = {"task_name": "Χάπι end", "freq": "weekly", "weekdays": [1, 2, 3, 4, 5, 6, 7],
        "starts_on": "2026-09-26"}


def test_a_new_rule_keeps_its_workspace_and_category(client, monkeypatch):
    saved = _world(monkeypatch)

    r = client.post("/recurrences", json={**BODY, "workspace_id": "ws-personal", "category_id": "cat-health"})

    assert r.status_code == 201
    assert (saved["rule"].workspace_id, saved["rule"].category_id) == ("ws-personal", "cat-health")
    assert r.json()["recurrence"]["workspace_id"] == "ws-personal"


def test_a_rule_cannot_go_into_a_room_the_user_is_not_in(client, monkeypatch):
    saved = _world(monkeypatch, member_of=["ws-personal"])

    r = client.post("/recurrences", json={**BODY, "workspace_id": "ws-someone-else"})

    assert r.status_code == 404
    assert saved == {}


def test_a_rule_cannot_go_under_the_integrations_category(client, monkeypatch):
    """A hand-made daily task inside Hostaway would be escalated as a guest
    message every two hours."""
    saved = _world(monkeypatch)

    r = client.post("/recurrences", json={**BODY, "workspace_id": "ws-business", "category_id": "cat-host"})

    assert r.status_code == 422
    assert saved == {}


def test_a_category_from_another_room_is_refused(client, monkeypatch):
    saved = _world(monkeypatch)

    r = client.post("/recurrences", json={**BODY, "workspace_id": "ws-personal", "category_id": "cat-office"})

    assert r.status_code == 422
    assert saved == {}


def test_a_category_without_its_workspace_is_refused(client, monkeypatch):
    saved = _world(monkeypatch)

    r = client.post("/recurrences", json={**BODY, "category_id": "cat-health"})

    assert r.status_code == 422
    assert saved == {}


def test_an_unfiled_rule_is_still_allowed(client, monkeypatch):
    saved = _world(monkeypatch)

    r = client.post("/recurrences", json=BODY)

    assert r.status_code == 201
    assert saved["rule"].workspace_id is None


def _existing(monkeypatch, rule, member_of=("ws-personal", "ws-business")):
    _world(monkeypatch, member_of=member_of)
    written = {}
    monkeypatch.setattr(main.repository, "get_recurrence_rule", lambda u, rid: rule)
    monkeypatch.setattr(main.repository, "update_recurrence_rule",
                        lambda u, rid, up: written.setdefault("updates", up) and rule.model_copy(update=up))
    monkeypatch.setattr(main.service, "regenerate_recurrence_rule", lambda u, rule, today: 0)
    return written


def test_moving_a_rule_to_another_room_drops_the_old_rooms_category(client, monkeypatch):
    """A category of the old room would not fit the new one — what the task
    sheet does when its workspace changes."""
    written = _existing(monkeypatch, _rule(workspace_id="ws-personal", category_id="cat-health"))

    r = client.patch("/recurrences/rule-1", json={"workspace_id": "ws-business"})

    assert r.status_code == 200
    assert written["updates"]["workspace_id"] == "ws-business"
    assert written["updates"]["category_id"] is None


def test_moving_a_rule_into_a_room_the_user_is_not_in_is_404(client, monkeypatch):
    written = _existing(monkeypatch, _rule(workspace_id="ws-personal"), member_of=["ws-personal"])

    r = client.patch("/recurrences/rule-1", json={"workspace_id": "ws-someone-else"})

    assert r.status_code == 404
    assert written == {}


def test_re_saving_a_rule_whose_room_was_left_is_not_refused(client, monkeypatch):
    """The form sends the placement on every save. An unchanged one is not
    re-judged, or leaving a room would lock the rule's owner out of renaming it."""
    written = _existing(monkeypatch, _rule(workspace_id="ws-left", category_id=None), member_of=[])

    r = client.patch("/recurrences/rule-1", json={"task_name": "Χάπι", "workspace_id": "ws-left"})

    assert r.status_code == 200
    assert written["updates"]["task_name"] == "Χάπι"
