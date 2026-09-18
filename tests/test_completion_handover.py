"""
A completion by somebody else is a HANDOVER, not a finished fact.

The owner closed a task a colleague had created, in a workspace they share,
and nothing anywhere recorded that he had done it — the row keeps `when` and
`from which channel`, never `who`, and workspace_activity knew only about
assignment. That is the half of the 2026-09-11 bargain that was never
delivered: members may edit anything in the room BECAUSE the log says who did
what, and for the one act that ends a task the log said nothing.

So two columns and one rule:

  completed_by        — who closed it
  completion_seen_by  — who has since acknowledged that it was closed

and a task closed by somebody else STAYS on the other party's list, struck
through, until they press OK. The parties are the creator and the assignee,
minus whoever did the closing.

completed_by is NULL for the machine paths (the Hostaway reply poller writes
its own completion straight through the repository, missed occurrences close
themselves), which is what keeps every task completed before today behaving
exactly as it does now: no backfill, nothing reappearing on anybody's list.
"""

import access
import services
from models import TaskRecord


def _task(record_id="task-1", completed=False):
    return TaskRecord(
        task_name="Καθαριότητα Α12",
        description="", category="Business", priority="P3", checklist=[],
        ai_suggested_category="Business", ai_suggested_priority="P3",
        record_id=record_id, is_completed=completed,
    )


def _service(monkeypatch, workspace_id=None, creator="creator-1", assigned_to=None):
    """
    A TaskService whose repository records the updates it is handed, with the
    write gate already answered yes — these tests are about what happens after
    it does. Every refusal the gate makes is tested in test_task_access.py.

    The gate's return value is not decoration here: services.update_task reads
    the workspace off it to write the room's log, which is the whole reason it
    stopped throwing that row away.
    """
    calls = []
    activity = []

    monkeypatch.setattr(access, "require_write", lambda user_id, task_id: {
        "id": task_id,
        "user_id": creator,
        "workspace_id": workspace_id,
        "assigned_to": assigned_to,
    })

    class _Repo:
        def update_task(self, user_id, record_id, updates):
            calls.append(updates)
            return _task(record_id)

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = _Repo()
    monkeypatch.setattr(services.repository, "get_task_calendar_fields", lambda u, r: None)
    monkeypatch.setattr(services.repository, "log_workspace_activity",
                        lambda **kwargs: activity.append(kwargs))
    return svc, calls, activity


# ------------------------------------------------------------ who closed it


def test_completing_records_who_closed_it(monkeypatch):
    svc, calls, _ = _service(monkeypatch)
    svc.update_task("maria", "task-1", {"is_completed": True})

    assert calls[0]["completed_by"] == "maria"


def test_the_agent_records_the_person_it_acted_for(monkeypatch):
    """
    Telling the agent to close a task IS closing it. The source column already
    separates the two channels; the person is the same person either way, and
    a handover the owner triggered through the chat must reach its creator
    exactly as one he triggered with his thumb.
    """
    svc, calls, _ = _service(monkeypatch)
    svc.update_task("maria", "task-1", {"is_completed": True}, completed_source="agent")

    assert calls[0]["completed_by"] == "maria"
    assert calls[0]["completed_source"] == "agent"


def test_reopening_forgets_who_closed_it_and_who_had_seen_it(monkeypatch):
    """
    A task that is open again must not keep claiming it was closed, by whom, or
    that anybody had accepted it — otherwise closing it a second time would
    find the acknowledgement already there and never reach the other party.
    """
    svc, calls, _ = _service(monkeypatch)
    svc.update_task("maria", "task-1", {"is_completed": False})

    assert calls[0]["completed_by"] is None
    assert calls[0]["completion_seen_by"] == []


def test_a_fresh_completion_starts_with_nobody_having_accepted_it(monkeypatch):
    """
    completion_seen_by is the one column written from two places — here, and
    the acknowledgement path. Clearing it on every completion means a handover
    never depends on a reopen having happened first to wipe the previous one:
    an inherited acknowledgement is a notice that silently reaches nobody.
    """
    svc, calls, _ = _service(monkeypatch)
    svc.update_task("maria", "task-1", {"is_completed": True})

    assert calls[0]["completion_seen_by"] == []


def test_an_edit_that_is_not_a_completion_leaves_both_columns_alone(monkeypatch):
    """Renaming a task must not rewrite who closed it, or erase an acknowledgement."""
    svc, calls, _ = _service(monkeypatch)
    svc.update_task("maria", "task-1", {"task_name": "renamed"})

    assert "completed_by" not in calls[0]
    assert "completion_seen_by" not in calls[0]


# ------------------------------------------------------------- the room log


def test_completing_in_a_shared_room_is_written_to_the_room_log(monkeypatch):
    svc, _, activity = _service(monkeypatch, workspace_id="ws-1")
    svc.update_task("maria", "task-1", {"is_completed": True})

    entry = next(e for e in activity if e["action"] == "task_completed")
    assert entry["workspace_id"] == "ws-1"
    assert entry["actor_user_id"] == "maria"
    assert entry["task_id"] == "task-1"
    assert entry["task_name"] == "Καθαριότητα Α12"


def test_reopening_in_a_shared_room_is_written_to_the_room_log(monkeypatch):
    """
    Un-completing is its own event, not the absence of one. Without it the log
    would show a task completed twice and never say it came back.
    """
    svc, _, activity = _service(monkeypatch, workspace_id="ws-1")
    svc.update_task("maria", "task-1", {"is_completed": False})

    assert [e["action"] for e in activity] == ["task_reopened"]


def test_completing_an_unfiled_task_writes_no_room_log(monkeypatch):
    """A task in no workspace has no room whose diary this could belong in."""
    svc, _, activity = _service(monkeypatch, workspace_id=None)
    svc.update_task("maria", "task-1", {"is_completed": True})

    assert activity == []


def test_the_log_is_written_only_after_the_task_really_changed(monkeypatch):
    """
    The same rule the assignment log already follows: a diary that records
    something that did not happen is worse than no diary, because it is the one
    place somebody goes to settle a disagreement.
    """
    activity = []
    monkeypatch.setattr(access, "require_write", lambda user_id, task_id: {
        "id": task_id, "user_id": "creator-1", "workspace_id": "ws-1", "assigned_to": None,
    })

    class _FailingRepo:
        def update_task(self, user_id, record_id, updates):
            raise ValueError("no visible row")

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = _FailingRepo()
    monkeypatch.setattr(services.repository, "get_task_calendar_fields", lambda u, r: None)
    monkeypatch.setattr(services.repository, "log_workspace_activity",
                        lambda **kwargs: activity.append(kwargs))

    try:
        svc.update_task("maria", "task-1", {"is_completed": True})
    except ValueError:
        pass

    assert activity == []


# --------------------------------------------------------- acknowledgement


def test_acknowledging_hands_the_task_and_the_person_to_the_repository(monkeypatch):
    seen = []

    class _Repo:
        def acknowledge_completion(self, user_id, record_id):
            seen.append((user_id, record_id))
            return _task(record_id, completed=True)

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = _Repo()

    result = svc.acknowledge_completion("vangelis", "task-1")

    assert seen == [("vangelis", "task-1")]
    assert result.record_id == "task-1"


def test_acknowledging_is_scoped_to_what_the_caller_can_see():
    """
    A guard on the source rather than on behaviour, because this path has
    exactly one permission check and it is a single function call. Every other
    write here is protected by access.require_* and by the test above that
    reads those calls out of the source; this one is protected by
    scope_to_visible, and its removal would look like a tidy-up.
    """
    import inspect

    import repository

    source = inspect.getsource(repository.AirtableTaskRepository.acknowledge_completion)
    assert "scope_to_visible" in source


# ----------------------------------------------------------- the front door


def test_the_endpoint_returns_the_task_with_the_acknowledgement_on_it(monkeypatch):
    import main

    monkeypatch.setattr(main.service, "acknowledge_completion",
                        lambda u, r: _task(r, completed=True))

    result = main.acknowledge_task_completion("task-1", user_id="vangelis")

    assert result.record_id == "task-1"


def test_a_task_the_caller_cannot_see_is_a_404_rather_than_a_crash(monkeypatch):
    """
    The repository raises for an invisible task on purpose. What reaches the
    phone must be "there is no such task for you" and not a 500 — a 500 is what
    the client retries, and this button would then retry forever.
    """
    import main
    import pytest
    from fastapi import HTTPException

    def _refuse(user_id, record_id):
        raise ValueError("no row matching it is visible")

    monkeypatch.setattr(main.service, "acknowledge_completion", _refuse)

    with pytest.raises(HTTPException) as caught:
        main.acknowledge_task_completion("task-1", user_id="vangelis")

    assert caught.value.status_code == 404
