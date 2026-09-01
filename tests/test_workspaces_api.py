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
