"""
The workspace endpoints. What matters beyond the write: GET returns workspaces
AND categories together (the provider needs both on every app open), and every
route is scoped so one user's id can never reach another's row.
"""
import pytest
from fastapi.testclient import TestClient

import main
from models import Category, Workspace

USER = "user-1"


@pytest.fixture
def client():
    main.app.dependency_overrides[main.get_current_user_id] = lambda: USER
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def _ws(**overrides):
    base = dict(record_id="ws-1", name="Business", color="#2563eb", position=0)
    base.update(overrides)
    return Workspace(**base)


def _cat(**overrides):
    base = dict(record_id="cat-1", workspace_id="ws-1", name="γραφείο", position=0)
    base.update(overrides)
    return Category(**base)


def test_listing_returns_workspaces_and_categories_together(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_workspaces", lambda u: [_ws()])
    monkeypatch.setattr(main.repository, "get_categories", lambda u: [_cat()])

    r = client.get("/workspaces")

    assert r.status_code == 200
    assert r.json()["workspaces"][0]["name"] == "Business"
    assert r.json()["categories"][0]["name"] == "γραφείο"


def test_creating_a_workspace_returns_201(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_workspaces", lambda u: [])
    monkeypatch.setattr(main.repository, "create_workspace", lambda u, w: _ws(name=w.name))

    r = client.post("/workspaces", json={"name": "Επενδύσεις"})

    assert r.status_code == 201
    assert r.json()["workspace"]["name"] == "Επενδύσεις"


def test_a_duplicate_workspace_name_is_409_not_500(client, monkeypatch):
    """The database's unique(user_id, name) would raise a generic exception and
    surface as a 500. The user typed a name that is already taken — that is a
    409 with a message they can act on."""
    monkeypatch.setattr(main.repository, "get_workspaces", lambda u: [_ws(name="Business")])

    r = client.post("/workspaces", json={"name": "Business"})

    assert r.status_code == 409


def test_editing_someone_elses_workspace_is_404(client, monkeypatch):
    """get_workspace is scoped by user_id, so another user's row reads as
    absent. 404 rather than 403 — confirming a row exists is itself a leak."""
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: None)

    r = client.patch("/workspaces/ws-999", json={"name": "Δικό μου τώρα"})

    assert r.status_code == 404


def test_renaming_a_workspace_to_its_own_name_is_not_a_conflict(client, monkeypatch):
    """Saving a form without touching the name resends it. Comparing against
    every sibling INCLUDING itself would reject that as a duplicate."""
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: _ws())
    monkeypatch.setattr(main.repository, "get_workspaces", lambda u: [_ws()])
    monkeypatch.setattr(main.repository, "update_workspace",
                        lambda u, i, up: _ws(**{**{"record_id": "ws-1"}, **up}))

    r = client.patch("/workspaces/ws-1", json={"name": "Business", "color": "#111111"})

    assert r.status_code == 200


def test_deleting_a_workspace_reports_what_became_unfiled(client, monkeypatch):
    """The user is about to lose an organisation they built. Telling them how
    many tasks are about to become unfiled is the difference between an
    informed click and a surprise."""
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: _ws())
    monkeypatch.setattr(main.repository, "count_tasks_in_workspace", lambda u, i: 12)
    monkeypatch.setattr(main.repository, "delete_workspace", lambda u, i: None)

    r = client.delete("/workspaces/ws-1")

    assert r.status_code == 200
    assert r.json()["tasks_unfiled"] == 12


def test_the_unfiled_count_is_read_BEFORE_the_delete(client, monkeypatch):
    """Afterwards there is nothing left to count — the rows have already been
    set to NULL, so the answer would always be zero."""
    order = []
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: _ws())
    monkeypatch.setattr(main.repository, "count_tasks_in_workspace",
                        lambda u, i: order.append("count") or 3)
    monkeypatch.setattr(main.repository, "delete_workspace",
                        lambda u, i: order.append("delete"))

    client.delete("/workspaces/ws-1")

    assert order == ["count", "delete"]


from models import AppSettings, TaskRecord


def _task(**overrides):
    base = dict(record_id="t1", task_name="Χ", description="", category="Business",
                priority="P2", ai_suggested_category="Business",
                ai_suggested_priority="P2", approval_status=True)
    base.update(overrides)
    return TaskRecord(**base)


def test_tasks_can_be_filtered_to_one_workspace(client, monkeypatch):
    monkeypatch.setattr(main.service, "get_all_tasks", lambda u: [
        _task(record_id="in", workspace_id="ws-1"),
        _task(record_id="out", workspace_id="ws-2"),
        _task(record_id="unfiled", workspace_id=None),
    ])

    r = client.get("/tasks?workspace_id=ws-1")

    assert [t["record_id"] for t in r.json()["tasks"]] == ["in"]
    assert r.json()["count"] == 1


def test_no_filter_returns_everything_including_unfiled(client, monkeypatch):
    """The default is 'Όλα'. An unfiled task is still the user's work and must
    never be hidden by the absence of a choice."""
    monkeypatch.setattr(main.service, "get_all_tasks", lambda u: [
        _task(record_id="in", workspace_id="ws-1"),
        _task(record_id="unfiled", workspace_id=None),
    ])

    r = client.get("/tasks")

    assert len(r.json()["tasks"]) == 2


def test_the_active_workspace_is_returned_by_settings(client, monkeypatch):
    """The switcher's position is remembered server-side, so it is the same on
    the phone and the laptop."""
    monkeypatch.setattr(main, "get_app_settings",
                        lambda u: AppSettings(active_workspace_id="ws-1"))

    r = client.get("/settings")

    assert r.json()["active_workspace_id"] == "ws-1"


def test_the_active_workspace_survives_a_patch(client, monkeypatch):
    saved = {}

    def _update(user_id, **fields):
        saved.update(fields)
        return AppSettings(**{k: v for k, v in fields.items()})

    monkeypatch.setattr(main, "update_app_settings", _update)

    r = client.patch("/settings", json={"active_workspace_id": "ws-2"})

    assert r.status_code == 200
    assert saved["active_workspace_id"] == "ws-2"


def test_clearing_the_active_workspace_means_show_everything(client, monkeypatch):
    """NULL is not 'unset', it is the deliberate 'Όλα' position — so a null
    sent explicitly must reach the database rather than being dropped."""
    saved = {}

    def _update(user_id, **fields):
        saved.update(fields)
        return AppSettings(**{k: v for k, v in fields.items()})

    monkeypatch.setattr(main, "update_app_settings", _update)

    client.patch("/settings", json={"active_workspace_id": None})

    assert "active_workspace_id" in saved
    assert saved["active_workspace_id"] is None


def test_the_default_workspace_round_trips(client, monkeypatch):
    """Distinct from active_workspace_id: 'where I am looking' and 'whose
    vocabulary the extractor gets when I am looking at everything' are
    different questions, and Όλα cannot answer the second."""
    saved = {}

    def _update(user_id, **fields):
        saved.update(fields)
        return AppSettings(**{k: v for k, v in fields.items()})

    monkeypatch.setattr(main, "update_app_settings", _update)

    r = client.patch("/settings", json={"default_workspace_id": "ws-1"})

    assert r.status_code == 200
    assert saved["default_workspace_id"] == "ws-1"
