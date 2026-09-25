"""
Assignment — the half of the request that made the owner ask for any of this:
«προιστάμενος στέλνειο δουλεια (task) στον υφιστ'αμενο».

One rule carries it: you may only hand work to somebody who is in the room. A
task can otherwise acquire an assignee who cannot see it, will never be
notified about it, and cannot complete it — a task that looks handed over and
is not.
"""
import pytest

import sharing
import services


@pytest.fixture
def room(monkeypatch):
    """user-2 is in ws-1. user-3 is not in anything."""
    members = {"ws-1": ["user-1", "user-2"]}
    monkeypatch.setattr(sharing.repository, "get_member_workspace_ids",
                        lambda u: [w for w, ms in members.items() if u in ms])
    return members


def test_handing_work_to_somebody_in_the_room_is_allowed(room):
    sharing.validate_assignment("ws-1", "user-2")


def test_handing_work_to_somebody_outside_the_room_is_refused(room):
    """The whole rule. Without it a task can carry an assignee who cannot see
    it, is never notified about it and cannot complete it — handed over in
    appearance only."""
    with pytest.raises(sharing.SharingError) as e:
        sharing.validate_assignment("ws-1", "user-3")

    assert e.value.code == "assignee_not_a_member"


def test_clearing_the_assignee_is_always_allowed(room):
    """Putting work back on the pile needs no permission from anybody — and
    `None` must not be run through a membership check, which would refuse it."""
    sharing.validate_assignment("ws-1", None)
    sharing.validate_assignment(None, None)


def test_an_unfiled_task_cannot_be_handed_to_anybody(room):
    """No workspace means no shared room, so there is nobody it could be handed
    to. Refused with its own reason rather than falling through the membership
    check, which would say the wrong thing."""
    with pytest.raises(sharing.SharingError) as e:
        sharing.validate_assignment(None, "user-2")

    assert e.value.code == "assignee_needs_a_workspace"


def test_the_refusal_is_readable(room):
    with pytest.raises(sharing.SharingError) as e:
        sharing.validate_assignment("ws-1", "user-3")

    assert e.value.message
    assert e.value.message != e.value.code


# ------------------------------------------------- through the service path


@pytest.fixture
def svc(monkeypatch, room):
    """A TaskService with the gate open and the repository stubbed, so these
    tests are about the assignment rule and nothing else."""
    import access

    monkeypatch.setattr(access, "require_write", lambda u, t: {"id": t})
    monkeypatch.setattr(services.repository, "log_workspace_activity",
                        lambda **kw: None)

    service = services.TaskService.__new__(services.TaskService)

    class _Repo:
        def __init__(self):
            self.updates = None

        def get_task(self, user_id, record_id):
            from models import TaskRecord
            return TaskRecord(
                task_name="Καθαρισμός Β2", description="", category="Business",
                priority="P3", ai_suggested_category="Business",
                ai_suggested_priority="P3", record_id=record_id,
                workspace_id="ws-1",
            )

        def update_task(self, user_id, record_id, updates):
            self.updates = updates
            return self.get_task(user_id, record_id)

    service.repository = _Repo()
    return service


def test_the_service_refuses_an_assignee_who_is_not_a_member(svc):
    with pytest.raises(sharing.SharingError) as e:
        svc.update_task("user-1", "t-1", {"assigned_to": "user-3"})

    assert e.value.code == "assignee_not_a_member"
    assert svc.repository.updates is None, "the write happened anyway"


def test_the_service_lets_a_real_handover_through(svc):
    svc.update_task("user-1", "t-1", {"assigned_to": "user-2"})

    assert svc.repository.updates["assigned_to"] == "user-2"


def test_a_normal_edit_does_not_pay_for_a_membership_lookup(svc, monkeypatch):
    """`assigned_to` not being mentioned is the common case — every rename,
    every completion. It must not cost a lookup, and it must not be confused
    with an explicit null."""
    def _explode(*a, **kw):
        raise AssertionError("membership was checked for an edit that never mentioned an assignee")

    monkeypatch.setattr(sharing, "validate_assignment", _explode)

    svc.update_task("user-1", "t-1", {"task_name": "Νέο όνομα"})

    assert svc.repository.updates["task_name"] == "Νέο όνομα"


def test_clearing_the_assignee_reaches_the_database_as_null(svc):
    """An explicit null is how a client puts work back on the pile, and it must
    survive the trip rather than being dropped as "nothing sent"."""
    svc.update_task("user-1", "t-1", {"assigned_to": None})

    assert "assigned_to" in svc.repository.updates
    assert svc.repository.updates["assigned_to"] is None


def test_a_handover_is_recorded_in_the_activity_log(svc, monkeypatch):
    logged = []
    monkeypatch.setattr(services.repository, "log_workspace_activity",
                        lambda **kw: logged.append(kw))

    svc.update_task("user-1", "t-1", {"assigned_to": "user-2"})

    assert logged, "handing work to somebody left no trace"
    assert logged[0]["action"] == "task_assigned"
    assert logged[0]["workspace_id"] == "ws-1"
    assert logged[0]["details"]["assigned_to"] == "user-2"


def test_the_agent_day_view_stays_belongs_to_while_the_agent_reads_visible_to():
    """REVERSED 2026-09-23, on the owner's request that the agent see what he
    can see. This used to assert the agent read get_owned_or_assigned_tasks.
    It now reads the screen's list — and the reason this test existed still
    holds: build_day_view is injected into EVERY question, so it must not carry
    four other people's work forever. It filters to the user's own work itself.
    The full set of guarantees is in test_agent_workspaces.py."""
    import inspect

    import agent_engine
    import agent_tools

    assert "repository.get_tasks_for_user(user_id=user_id)" in inspect.getsource(agent_engine.ask_agent)
    assert "is_mine(t, ctx[\"me\"])" in inspect.getsource(agent_tools.build_day_view)


def test_the_update_endpoint_accepts_an_assignee():
    """Without the field on the request model, Pydantic drops it silently and
    the picker would appear to work while changing nothing."""
    import main

    assert "assigned_to" in main.UpdateTaskRequest.model_fields


# --- the activity log only records what actually happened -------------------
#
# Found in the LIVE log on 2026-09-12: three «X ανέθεσε το Y» rows for one task
# 24 seconds apart, written by one person saving three times and never touching
# the assignee. The task sheet sends every field it holds on every save, so
# "mentioned in the update" and "changed" are different facts — and the whole
# difference lands in the one place a member goes to find out what happened in a
# room they share.


class _Recorder:
    """Stands in for the two collaborators update_task reaches for: the
    repository it writes through, and the log it writes to."""

    def __init__(self, existing_assignee=None):
        self.existing_assignee = existing_assignee
        self.logged = []
        self.validated = []

    # -- repository
    def get_task(self, user_id, record_id):
        return type("T", (), {
            "workspace_id": "ws-1",
            "assigned_to": self.existing_assignee,
            "task_name": "Καθαριότητα",
            "record_id": record_id,
        })()

    def update_task(self, user_id, record_id, updates):
        return self.get_task(user_id, record_id)


def _service_with(monkeypatch, recorder):
    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = recorder
    monkeypatch.setattr(services.access, "require_write", lambda u, r: {"id": r})
    monkeypatch.setattr(services.repository, "log_workspace_activity",
                        lambda **kw: recorder.logged.append(kw))
    monkeypatch.setattr(services.sharing, "validate_assignment",
                        lambda ws, who: recorder.validated.append((ws, who)))
    return svc


def test_saving_without_touching_the_assignee_logs_nothing(monkeypatch):
    """A rename, a reschedule, a tick on the checklist — the sheet sends
    assigned_to along with all of them, and none of them is a handover."""
    rec = _Recorder(existing_assignee="user-2")
    svc = _service_with(monkeypatch, rec)

    svc.update_task("user-1", "t-1", {"task_name": "Καθαριότητα Α1", "assigned_to": "user-2"})

    assert rec.logged == []
    # And it must not pay for a membership lookup either.
    assert rec.validated == []


def test_a_real_handover_is_logged(monkeypatch):
    rec = _Recorder(existing_assignee=None)
    svc = _service_with(monkeypatch, rec)

    svc.update_task("user-1", "t-1", {"assigned_to": "user-2"})

    assert len(rec.logged) == 1
    assert rec.logged[0]["action"] == "task_assigned"
    assert rec.logged[0]["details"] == {"assigned_to": "user-2"}
    assert rec.validated == [("ws-1", "user-2")]


def test_putting_work_back_on_the_pile_is_logged_too(monkeypatch):
    """Clearing an assignee is a real event in a shared room — somebody is no
    longer responsible, and that is exactly the kind of thing a log is read
    for."""
    rec = _Recorder(existing_assignee="user-2")
    svc = _service_with(monkeypatch, rec)

    svc.update_task("user-1", "t-1", {"assigned_to": None})

    assert len(rec.logged) == 1
    assert rec.logged[0]["details"] == {"assigned_to": None}


def test_empty_string_and_null_are_the_same_nobody(monkeypatch):
    """The sheet sends null, a <select> would send ''. Treating them as two
    different values would log a handover from nobody to nobody."""
    rec = _Recorder(existing_assignee=None)
    svc = _service_with(monkeypatch, rec)

    svc.update_task("user-1", "t-1", {"assigned_to": ""})

    assert rec.logged == []
