"""
A task can be called off, with a reason (2026-09-26).

The owner's words, while designing boards: «θέλω και μία στήλη για
ακυρώθηκε — δεν έγινε το τασκ για χ ψ λόγο». Each rule below is one sentence
of what was agreed:

  - a fourth ending beside completed, deleted and missed — not a deletion;
  - the reason is optional;
  - done and called off are two endings, never both;
  - a called-off task stops ringing, escalating and syncing like a finished one;
  - the agent can say it was called off and why, instead of inventing.

Offline: nothing here reaches Supabase or the model.
"""
import inspect
from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

import access
import agent_tools
import main
import repository
import services
from models import Category, TaskRecord, Workspace, WorkspaceMember

ME = "0f3c9d2e-1111-4a5b-9c7d-aaaaaaaaaaaa"
# An invented colleague — never a real person's name in the tests.
MATE = "5d6e7f80-4444-4a1b-9c2d-dddddddddddd"


def _task(record_id="task-1", **overrides):
    base = dict(
        task_name="Βάψιμο κάγκελων", description="", category="Business", priority="P2",
        checklist=[], ai_suggested_category="Business", ai_suggested_priority="P2",
        record_id=record_id, approval_status=True,
    )
    base.update(overrides)
    return TaskRecord(**base)


@pytest.fixture
def gate(monkeypatch):
    """The write gate says yes and remembers that it was asked — these tests are
    about what happens after it. Its refusals are tested in test_task_access.py."""
    asked = []

    def _require_write(user_id, task_id):
        asked.append(task_id)
        return {"id": task_id, "workspace_id": "ws-1"}

    monkeypatch.setattr(access, "require_write", _require_write)
    return asked


def _service(existing, monkeypatch):
    calls, logged = [], []

    class _Repo:
        def get_task(self, user_id, record_id):
            return existing

        def update_task(self, user_id, record_id, updates):
            calls.append(updates)
            merged = existing.model_dump() if existing else {}
            merged.update(updates)
            return TaskRecord(**merged)

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = _Repo()
    monkeypatch.setattr(services.repository, "log_workspace_activity",
                        lambda **kw: logged.append(kw))
    return svc, calls, logged


def _recent(value):
    stamped = datetime.fromisoformat(value)
    assert stamped.tzinfo is not None, "a timestamptz needs an offset"
    return abs((datetime.now(ZoneInfo("Europe/Athens")) - stamped).total_seconds()) < 60


# ------------------------------------------------------------------ the door

def test_calling_off_stamps_the_server_time_the_caller_and_the_reason(monkeypatch, gate):
    svc, calls, logged = _service(_task(), monkeypatch)

    svc.drop_task(ME, "task-1", "  ο πελάτης το ακύρωσε  ")

    assert _recent(calls[0]["dropped_at"])
    assert calls[0]["dropped_by"] == ME
    assert calls[0]["drop_reason"] == "ο πελάτης το ακύρωσε"
    assert gate == ["task-1"]
    assert logged[0]["action"] == "task_dropped"
    assert logged[0]["details"] == {"reason": "ο πελάτης το ακύρωσε"}


def test_the_reason_is_optional(monkeypatch, gate):
    svc, calls, logged = _service(_task(), monkeypatch)

    svc.drop_task(ME, "task-1", "   ")

    assert calls[0]["drop_reason"] is None
    assert logged[0]["details"] is None


def test_a_pasted_novel_is_cut_rather_than_losing_the_cancellation(monkeypatch, gate):
    """The column has a 500-character CHECK; a violation would be a 500 and
    the cancellation itself would be lost over a paste."""
    svc, calls, _ = _service(_task(), monkeypatch)

    svc.drop_task(ME, "task-1", "λ" * 2000)

    assert len(calls[0]["drop_reason"]) == 500


def test_calling_off_a_completed_task_reopens_it_in_the_same_write(monkeypatch, gate):
    """A card dragged from «Έγινε» to «Ακυρώθηκε» — two endings, never both."""
    done = _task(is_completed=True, completed_at="2026-09-25T10:00:00+03:00",
                 completed_source="ui", completed_by=ME)
    svc, calls, _ = _service(done, monkeypatch)

    result = svc.drop_task(ME, "task-1", None)

    assert calls[0]["is_completed"] is False
    assert calls[0]["completed_at"] is None
    assert calls[0]["completed_by"] is None
    assert result.is_completed is False and result.dropped_at


def test_an_inbox_suggestion_is_rejected_not_called_off(monkeypatch, gate):
    """«Απόρριψη» stays the answer to an AI suggestion nobody approved."""
    svc, calls, _ = _service(_task(approval_status=False), monkeypatch)

    with pytest.raises(ValueError):
        svc.drop_task(ME, "task-1", None)
    assert calls == []


def test_a_deleted_task_cannot_be_called_off(monkeypatch, gate):
    svc, calls, _ = _service(_task(deleted_at="2026-09-20T10:00:00+03:00"), monkeypatch)

    with pytest.raises(ValueError):
        svc.drop_task(ME, "task-1", None)
    assert calls == []


def test_undoing_clears_all_three(monkeypatch, gate):
    dropped = _task(dropped_at="2026-09-26T10:00:00+03:00", dropped_by=ME, drop_reason="x")
    svc, calls, logged = _service(dropped, monkeypatch)

    svc.undrop_task(ME, "task-1")

    assert calls[0] == {"dropped_at": None, "dropped_by": None, "drop_reason": None}
    assert logged[0]["action"] == "task_undropped"


def test_completing_a_called_off_task_stops_it_being_called_off(monkeypatch, gate):
    """Dragging from «Ακυρώθηκε» to «Έγινε», or ticking it anywhere."""
    svc, calls, _ = _service(_task(dropped_at="2026-09-26T10:00:00+03:00"), monkeypatch)
    monkeypatch.setattr(services.repository, "get_task_calendar_fields", lambda u, r: None)

    svc.update_task(ME, "task-1", {"is_completed": True})

    assert calls[0]["dropped_at"] is None
    assert calls[0]["dropped_by"] is None
    assert calls[0]["drop_reason"] is None


def test_reopening_a_completed_task_does_not_touch_a_cancellation(monkeypatch, gate):
    svc, calls, _ = _service(_task(is_completed=True), monkeypatch)
    monkeypatch.setattr(services.repository, "get_task_calendar_fields", lambda u, r: None)

    svc.update_task(ME, "task-1", {"is_completed": False})

    assert "dropped_at" not in calls[0]


def test_both_doors_go_through_the_write_gate():
    """Asserted on the source, like test_task_access does for the others: the
    gate fixture above would hide the call being removed."""
    assert "access.require_write" in inspect.getsource(services.TaskService.drop_task)
    assert "access.require_write" in inspect.getsource(services.TaskService.undrop_task)


def test_patch_cannot_write_the_cancellation_columns():
    """The time must be the server's and the person the caller's."""
    fields = main.UpdateTaskRequest.model_fields
    assert "dropped_at" not in fields and "dropped_by" not in fields and "drop_reason" not in fields


# ------------------------------------------------------------ the endpoints

@pytest.fixture
def client():
    main.app.dependency_overrides[main.get_current_user_id] = lambda: ME
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def test_the_drop_endpoint_passes_the_reason_through(client, monkeypatch):
    seen = {}

    def _drop(user_id, record_id, reason):
        seen.update(user_id=user_id, record_id=record_id, reason=reason)
        return _task(dropped_at="2026-09-26T10:00:00+03:00", drop_reason=reason)

    monkeypatch.setattr(main.service, "drop_task", _drop)

    r = client.post("/tasks/task-1/drop", json={"reason": "βρέχει"})

    assert r.status_code == 200
    assert seen == {"user_id": ME, "record_id": "task-1", "reason": "βρέχει"}
    assert r.json()["drop_reason"] == "βρέχει"


def test_a_refusal_is_a_422_not_a_500(client, monkeypatch):
    """The phone retries a 500, and this refusal is the user's data."""
    def _refuse(user_id, record_id, reason):
        raise ValueError("A task still awaiting approval is rejected, not called off.")

    monkeypatch.setattr(main.service, "drop_task", _refuse)

    r = client.post("/tasks/task-1/drop", json={})

    assert r.status_code == 422


def test_a_refused_write_is_a_403(client, monkeypatch):
    def _deny(user_id, record_id, reason):
        raise access.TaskAccessDenied(record_id)

    monkeypatch.setattr(main.service, "drop_task", _deny)

    assert client.post("/tasks/task-1/drop", json={}).status_code == 403


# ----------------------------------------------- it stops counting as work

def test_a_called_off_task_is_not_open_but_shows_with_finished_work():
    dropped = _task(dropped_at="2026-09-26T10:00:00+03:00")

    assert agent_tools.is_open_task(dropped) is False
    assert agent_tools.is_open_task(dropped, include_completed=True) is True
    assert agent_tools.is_finished(dropped) is True
    # Not a dead row: the agent must still be able to find it.
    assert agent_tools.is_disposed_of(dropped) is False


def test_a_called_off_guest_message_stops_escalating(monkeypatch):
    """The one notification with no cap on how often it re-sends."""
    monkeypatch.setattr(repository, "get_system_category",
                        lambda u, key: Category(record_id="cat-h", workspace_id="ws-1", name="Hostaway"))
    live = _task("live", category_id="cat-h")
    dropped = _task("dropped", category_id="cat-h", dropped_at="2026-09-26T10:00:00+03:00")

    found = repository.get_active_hostaway_tasks(ME, tasks=[live, dropped])

    assert [t.record_id for t in found] == ["live"]


def test_a_called_off_task_gets_no_advance_reminder():
    from datetime import timedelta
    now = datetime.now(ZoneInfo("Europe/Athens"))
    soon = now + timedelta(minutes=10)
    common = dict(due_date=soon.strftime("%Y-%m-%d"), due_time=soon.strftime("%H:%M"),
                  notify_enabled=True)
    live = _task("live", **common)
    dropped = _task("dropped", dropped_at=now.isoformat(), **common)

    due = repository.get_tasks_due_for_notification(
        ME, now, now + timedelta(minutes=30), tasks=[live, dropped])

    assert [t.record_id for t in due] == ["live"]


def test_a_called_off_task_is_not_pushed_to_google(monkeypatch):
    pushed = []
    monkeypatch.setattr(services.repository, "get_google_calendar_connection", lambda u: {"x": 1})
    monkeypatch.setattr(services.google_calendar, "sync_task_to_google_calendar",
                        lambda u, t: pushed.append(t) or "evt")

    services.push_task_to_calendar_now(ME, _task(due_date="2026-09-30",
                                                 dropped_at="2026-09-26T10:00:00+03:00"))

    assert pushed == []


def test_a_called_off_recurring_day_is_not_also_stamped_missed(monkeypatch):
    """It did not lapse — somebody decided."""
    source = inspect.getsource(services.TaskService)
    assert "task.cancelled_at or task.dropped_at:\n                continue" in source


def test_the_queries_that_filter_in_sql_know_the_new_column():
    """Three reads filter in the database rather than through is_finished;
    each must skip a called-off row, or the next guest message threads onto a
    hidden task, the calendar keeps syncing it, or a rule edit deletes it."""
    for fn in (repository.get_open_tasks_for_conversation,
               repository.get_tasks_needing_calendar_push,
               repository.get_open_occurrences):
        assert '.is_("dropped_at", "null")' in inspect.getsource(fn), fn.__name__


# ------------------------------------------------------- what the agent sees

def _ctx(with_colleague: bool):
    workspaces = [Workspace(record_id="ws-1", name="Business")]
    members = [WorkspaceMember(workspace_id="ws-1", user_id=ME, role="owner")]
    profiles = {ME: {"display_name": "Owner", "email": "me@example.com"}}
    if with_colleague:
        members.append(WorkspaceMember(workspace_id="ws-1", user_id=MATE))
        profiles[MATE] = {"display_name": "Ντίνα Δοκιμή", "email": "mate@example.com"}
    people = agent_tools.build_people_directory(ME, members, profiles)
    return agent_tools.build_agent_context(ME, workspaces, [], people, {})


def _agent_task(**overrides):
    base = dict(record_id="t-1", task_name="Βάψιμο", description="", priority="P2",
                due_date=None, due_time=None, is_completed=False, approval_status=True,
                is_rejected=False, missed_at=None, cancelled_at=None, deleted_at=None,
                workspace_id="ws-1", category_id=None, assigned_to=None, created_by=ME,
                checklist=[])
    base.update(overrides)
    return SimpleNamespace(**base)


def test_the_agent_is_told_a_task_was_called_off_and_why():
    row = agent_tools.render_task_rows(
        [_agent_task(dropped_at="2026-09-26T07:30:00+00:00", drop_reason="βρέχει", dropped_by=MATE)],
        _ctx(with_colleague=True),
    )[0]

    assert row["cancelled"] == "2026-09-26"
    assert row["cancel_reason"] == "βρέχει"
    assert row["cancelled_by"] == "Ντίνα Δοκιμή"


def test_a_solo_account_is_not_told_who_it_was_always_them():
    row = agent_tools.render_task_rows(
        [_agent_task(dropped_at="2026-09-26T07:30:00+00:00", dropped_by=ME)],
        _ctx(with_colleague=False),
    )[0]

    assert "cancelled_by" not in row
    assert "cancel_reason" not in row


def test_no_other_row_grows():
    """Every character is billed on every question."""
    row = agent_tools.render_task_rows([_agent_task()], _ctx(with_colleague=False))[0]

    assert not any(key.startswith("cancel") for key in row)


def test_the_instruction_explains_the_field_once():
    text = agent_tools.build_system_instruction()
    assert text.count('"cancelled"') == 1
    assert "not done, not deleted" in text
