"""
The write gate — the one place that answers "may this person write to this
task".

Before 2026-09-11 there was no such place. The check was copy-pasted into each
query as .eq("user_id", user_id) — 19 of the 29 statements touching `tasks` in
repository.py — and services.update_task never asked at all: it called
repository.update_task(user_id, record_id, updates) and the filter rode along
inside. That works while "may I write" and "is it mine" are the same question.
Sharing separates them, and 19 copies of a rule is 19 chances to miss one.
"""
import pytest

import access


class _FakeQuery:
    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a, **kw):
        self.sink["select"] = a
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def limit(self, n):
        self.sink["limit"] = n
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows):
        self.rows, self.sink = rows, {}

    def table(self, name):
        self.sink["table"] = name
        return _FakeQuery(self.sink, self.rows)


def _own(**overrides):
    base = {"id": "t-1", "user_id": "user-1", "workspace_id": "ws-1",
            "assigned_to": None}
    base.update(overrides)
    return base


def test_the_gate_reads_the_row_UNSCOPED(monkeypatch):
    """The gate is the thing that DOES the scoping, so its own lookup cannot be
    scoped — it has to be able to see a row in order to refuse it. A filtered
    read here would collapse "you may not touch this" into "there is no such
    task", which is a different fact and a worse error message."""
    fake = _FakeSupabase([_own()])
    monkeypatch.setattr(access, "supabase", fake)

    access.task_ownership("t-1")

    assert fake.sink["table"] == "tasks"
    assert fake.sink["eq"] == [("id", "t-1")]


def test_the_gate_asks_for_four_columns_not_the_whole_row(monkeypatch):
    """Four facts decide everything here. Pulling `select *` would drag the
    checklist and the Hostaway thread across the wire on every single write."""
    fake = _FakeSupabase([_own()])
    monkeypatch.setattr(access, "supabase", fake)

    access.task_ownership("t-1")

    selected = fake.sink["select"][0]
    for column in ("id", "user_id", "workspace_id", "assigned_to"):
        assert column in selected
    assert "*" not in selected


def test_a_missing_task_reads_as_None(monkeypatch):
    monkeypatch.setattr(access, "supabase", _FakeSupabase([]))

    assert access.task_ownership("t-404") is None


def test_the_creator_may_write(monkeypatch):
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own()]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: [])

    assert access.can_write("user-1", "t-1") is True


def test_a_member_of_the_workspace_may_write(monkeypatch):
    """v1 answers "yes, if you can see it" — the shape Trello and Todoist both
    settled on. The owner's eventual tightening (a member changes only what is
    assigned to them) is an `if` HERE and nowhere else, which is the whole
    reason this module exists as a module."""
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own()]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: ["ws-1"])

    assert access.can_write("user-2", "t-1") is True


def test_a_stranger_may_not_write(monkeypatch):
    """The negative test. If this one is missing, it is learned about from a
    customer rather than from a test run."""
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own()]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: ["ws-9"])

    assert access.can_write("user-3", "t-1") is False


def test_a_stranger_may_not_write_to_an_unfiled_task(monkeypatch):
    """workspace_id NULL means the task is in nobody's room, so membership
    cannot grant anything and only the creator is left. Without this branch,
    `None in [...]` would quietly decide a security question."""
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own(workspace_id=None)]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: ["ws-1"])

    assert access.can_write("user-2", "t-1") is False


def test_the_creator_may_still_write_to_their_own_unfiled_task(monkeypatch):
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own(workspace_id=None)]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: [])

    assert access.can_write("user-1", "t-1") is True


def test_a_missing_task_is_refused_not_crashed(monkeypatch):
    monkeypatch.setattr(access, "supabase", _FakeSupabase([]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: ["ws-1"])

    assert access.can_write("user-2", "t-404") is False


def test_only_the_workspace_owner_may_delete(monkeypatch):
    """The one irreversible act stays with one person. A member may change and
    complete anything in the room; removing it is not theirs."""
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own()]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: ["ws-1"])
    monkeypatch.setattr(access.repository, "is_workspace_owner",
                        lambda u, w: u == "user-1")

    assert access.can_delete("user-1", "t-1") is True
    assert access.can_delete("user-2", "t-1") is False


def test_the_creator_may_delete_their_own_unfiled_task(monkeypatch):
    """An unfiled task has no workspace and therefore no workspace owner. The
    creator must still be able to delete it, or a personal task outside every
    workspace becomes undeletable."""
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own(workspace_id=None)]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: [])

    assert access.can_delete("user-1", "t-1") is True


def test_a_stranger_may_not_delete_an_unfiled_task(monkeypatch):
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own(workspace_id=None)]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: [])

    assert access.can_delete("user-2", "t-1") is False


def test_require_write_raises_rather_than_returning_false(monkeypatch):
    """Two shapes on purpose: can_* for a screen that greys out a button,
    require_* for a write path that must stop. A write path calling can_* and
    forgetting to check the result is exactly the mistake this pair prevents."""
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own()]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: [])

    with pytest.raises(access.TaskAccessDenied):
        access.require_write("user-3", "t-1")

    assert access.require_write("user-1", "t-1")["id"] == "t-1"


def test_require_delete_raises_for_a_member(monkeypatch):
    monkeypatch.setattr(access, "supabase", _FakeSupabase([_own()]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: ["ws-1"])
    monkeypatch.setattr(access.repository, "is_workspace_owner",
                        lambda u, w: u == "user-1")

    with pytest.raises(access.TaskAccessDenied):
        access.require_delete("user-2", "t-1")

    assert access.require_delete("user-1", "t-1")["id"] == "t-1"


def test_require_write_on_a_missing_task_raises(monkeypatch):
    """Not a KeyError, not a None dereference three frames later."""
    monkeypatch.setattr(access, "supabase", _FakeSupabase([]))
    monkeypatch.setattr(access.repository, "get_member_workspace_ids", lambda u: [])

    with pytest.raises(access.TaskAccessDenied):
        access.require_write("user-1", "t-404")


def test_the_service_write_paths_all_call_the_gate():
    """
    The guard that makes the stubbing in test_calendar_sync.py,
    test_completion_source.py and test_recurrence_materialization.py safe.

    Those three files grant permission outright with an autouse fixture,
    because they are about what happens AFTER the gate says yes. That stubbing
    would also hide the gate being REMOVED — so this asserts on the source
    instead of waiting for a refusal that never comes.

    Deleting is require_delete, not require_write: the one irreversible act is
    the workspace owner's alone. Restoring is require_write, because bringing
    work back is not the irreversible act — removing it was.
    """
    import inspect

    import services

    assert "access.require_write" in inspect.getsource(services.TaskService.update_task)
    assert "access.require_delete" in inspect.getsource(services.TaskService.delete_task)
    assert "access.require_write" in inspect.getsource(services.TaskService.restore_task)


def test_deleting_does_not_settle_for_the_weaker_check():
    """delete_task must not call require_write. A member passing the write gate
    and reaching a delete is the exact hole this pair exists to close."""
    import inspect

    import services

    source = inspect.getsource(services.TaskService.delete_task)
    calls = [line.strip() for line in source.splitlines()
             if line.strip().startswith("access.require_")]

    assert calls == ["access.require_delete(user_id, record_id)"]


def test_a_refused_write_is_a_403_and_not_a_500():
    """
    access.py raises a plain exception rather than an HTTPException, because it
    is imported by services and by the scheduler and neither is serving a
    request. main.py is where that becomes HTTP — once, instead of every
    endpoint growing its own try/except.

    403 rather than 404: the person is authenticated and the task exists, they
    are simply not allowed to change it. Pretending it is missing would send a
    colleague hunting for a task they can see on their own screen.
    """
    import main

    handler = main.app.exception_handlers.get(access.TaskAccessDenied)

    assert handler is not None, "TaskAccessDenied has no handler — a refusal would be a 500"

    import asyncio

    response = asyncio.run(handler(None, access.TaskAccessDenied("t-1")))

    assert response.status_code == 403
