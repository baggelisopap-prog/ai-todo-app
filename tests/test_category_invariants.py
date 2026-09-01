"""
The things a category endpoint must refuse. Each one is a spec requirement, and
each one protects something a 500 would not explain.
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


def _cat(**overrides):
    base = dict(record_id="cat-1", workspace_id="ws-1", name="γραφείο", position=0)
    base.update(overrides)
    return Category(**base)


_SYSTEM = _cat(record_id="cat-h", name="Hostaway", system_key="hostaway")


def test_renaming_the_system_category_is_refused(client, monkeypatch):
    """Its label is cosmetic, but allowing the rename invites allowing the
    delete, and deleting it stops every guest escalation on the account."""
    monkeypatch.setattr(main.repository, "get_category", lambda u, i: _SYSTEM)

    r = client.patch("/categories/cat-h", json={"name": "Ό,τι θέλω"})

    assert r.status_code == 422


def test_deleting_the_system_category_is_refused(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_category", lambda u, i: _SYSTEM)

    r = client.delete("/categories/cat-h")

    assert r.status_code == 422


def test_recolouring_the_system_category_is_allowed(client, monkeypatch):
    """Only the name and its existence are protected. Colour is pure display
    and the user should be able to make their own board legible."""
    monkeypatch.setattr(main.repository, "get_category", lambda u, i: _SYSTEM)
    monkeypatch.setattr(main.repository, "get_categories", lambda u: [_SYSTEM])
    monkeypatch.setattr(main.repository, "update_category",
                        lambda u, i, up: _SYSTEM.model_copy(update=up))

    r = client.patch("/categories/cat-h", json={"color": "#ff0000"})

    assert r.status_code == 200


def test_the_api_cannot_mint_a_system_category(client, monkeypatch):
    """system_key is not a field on the create request at all, so a client
    sending one is ignored rather than obeyed. The migration is the only thing
    that creates a protected row."""
    captured = {}
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: Workspace(
        record_id="ws-1", name="Business"))
    monkeypatch.setattr(main.repository, "get_categories", lambda u: [])
    monkeypatch.setattr(main.repository, "create_category",
                        lambda u, c: captured.update(c.model_dump()) or _cat())

    r = client.post("/categories", json={
        "workspace_id": "ws-1", "name": "ψεύτικη", "system_key": "hostaway"})

    assert r.status_code == 201
    assert captured["system_key"] is None


def test_creating_a_category_in_someone_elses_workspace_is_404(client, monkeypatch):
    """get_workspace is scoped by user_id, so another user's workspace reads as
    absent. 404 rather than 403 — confirming a row exists is itself a leak."""
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: None)

    r = client.post("/categories", json={"workspace_id": "ws-999", "name": "κλεμμένη"})

    assert r.status_code == 404


def test_a_duplicate_name_in_the_same_workspace_is_409(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: Workspace(
        record_id="ws-1", name="Business"))
    monkeypatch.setattr(main.repository, "get_categories", lambda u: [_cat()])

    r = client.post("/categories", json={"workspace_id": "ws-1", "name": "γραφείο"})

    assert r.status_code == 409


def test_the_same_name_in_a_DIFFERENT_workspace_is_allowed(client, monkeypatch):
    """Uniqueness is per workspace, not per account: 'έξοδα' under Business and
    'έξοδα' under Personal are two different things, and the user means both."""
    monkeypatch.setattr(main.repository, "get_workspace", lambda u, i: Workspace(
        record_id="ws-2", name="Personal"))
    monkeypatch.setattr(main.repository, "get_categories", lambda u: [_cat()])
    monkeypatch.setattr(main.repository, "create_category",
                        lambda u, c: _cat(record_id="cat-2", workspace_id="ws-2"))

    r = client.post("/categories", json={"workspace_id": "ws-2", "name": "γραφείο"})

    assert r.status_code == 201


def test_deleting_an_ordinary_category_reports_what_became_unfiled(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_category", lambda u, i: _cat())
    monkeypatch.setattr(main.repository, "count_tasks_in_category", lambda u, i: 4)
    monkeypatch.setattr(main.repository, "delete_category", lambda u, i: None)

    r = client.delete("/categories/cat-1")

    assert r.status_code == 200
    assert r.json()["tasks_unfiled"] == 4


# --------------------------------------------------------- the placement rule
# A task's category must live inside the task's own workspace. Enforced in the
# service layer because a CHECK constraint cannot see another table.


def test_a_task_cannot_take_a_category_from_another_workspace(client, monkeypatch):
    """A task in Personal must not be filed under 'μετοχές', which lives in
    Business. Left unenforced this produces a task the UI cannot render."""
    monkeypatch.setattr(main.repository, "get_category", lambda u, i: _cat(
        record_id="cat-stocks", workspace_id="ws-business", name="μετοχές"))

    r = client.patch("/tasks/t1", json={
        "workspace_id": "ws-personal", "category_id": "cat-stocks"})

    assert r.status_code == 422
    assert "workspace" in r.json()["detail"].lower()


def test_a_matching_pair_is_accepted(client, monkeypatch):
    monkeypatch.setattr(main.repository, "get_category", lambda u, i: _cat(
        record_id="cat-1", workspace_id="ws-1"))
    monkeypatch.setattr(main.service, "update_task",
                        lambda u, i, up: _stub_task(**up))

    r = client.patch("/tasks/t1", json={"workspace_id": "ws-1", "category_id": "cat-1"})

    assert r.status_code == 200


def test_clearing_the_category_is_always_allowed(client, monkeypatch):
    """Moving a task to Unfiled must never be blocked — it is the escape hatch
    from any bad placement, including one this rule would otherwise refuse."""
    monkeypatch.setattr(main.service, "update_task", lambda u, i, up: _stub_task(**up))

    r = client.patch("/tasks/t1", json={"category_id": None})

    assert r.status_code == 200


def test_a_category_that_does_not_exist_is_422_not_500(client, monkeypatch):
    """A stale id from a client whose category was deleted on another device.
    That is the user's data being out of date, not a server fault."""
    monkeypatch.setattr(main.repository, "get_category", lambda u, i: None)

    r = client.patch("/tasks/t1", json={"workspace_id": "ws-1", "category_id": "gone"})

    assert r.status_code == 422


def _stub_task(**overrides):
    from models import TaskRecord
    base = dict(record_id="t1", task_name="Χ", description="", category="Business",
                priority="P2", ai_suggested_category="Business",
                ai_suggested_priority="P2")
    base.update({k: v for k, v in overrides.items()
                 if k in TaskRecord.model_fields})
    return TaskRecord(**base)
