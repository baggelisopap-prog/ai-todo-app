"""
A task can have a start date — «από» beside the deadline's «έως» (2026-09-26).

What the owner decided, one test group each:
  - set BY HAND ONLY: the extractor is never offered the field, and the agent
    may read it but not write it;
  - moving the deadline moves the start with it, and a start after the
    deadline is refused, never silently swapped;
  - the agent reads it: a Wednesday-to-Friday job is found by a question about
    Thursday, and the day view lists what has started and is due later.

Offline: nothing here reaches Supabase or the model.
"""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import agent_tools
import main
import services
from models import SingleTask, TaskRecord, Workspace, WorkspaceMember

ME = "0f3c9d2e-1111-4a5b-9c7d-aaaaaaaaaaaa"
TODAY = "2026-09-30"   # a Wednesday


def _task(**overrides):
    base = dict(task_name="Βάψιμο στο 3", description="", category="Business", priority="P2",
                checklist=[], ai_suggested_category="Business", ai_suggested_priority="P2",
                record_id="task-1", approval_status=True)
    base.update(overrides)
    return TaskRecord(**base)


# ---------------------------------------------------------- by hand only

def test_the_extractor_is_never_offered_a_start_date():
    """SingleTask is the schema the model answers in. The field being absent
    there is what makes «κενό για τον καταγραφέα» true."""
    assert "start_date" not in SingleTask.model_fields
    assert "start_date" in TaskRecord.model_fields


def test_the_agent_cannot_write_it():
    assert "start_date" not in agent_tools.AGENT_WRITABLE_FIELDS


def test_a_malformed_start_date_is_refused_by_the_model():
    with pytest.raises(ValueError):
        _task(start_date="30/09/2026")


# ------------------------------------------------- the range stays a range

def test_moving_the_deadline_moves_the_start_with_it():
    """Wednesday-to-Friday dragged a week later is still Wednesday-to-Friday."""
    existing = _task(start_date="2026-09-30", due_date="2026-10-02")

    settled = services.settle_task_range(existing, {"due_date": "2026-10-09"})

    assert settled == {"due_date": "2026-10-09", "start_date": "2026-10-07"}


def test_moving_the_deadline_earlier_keeps_the_start_before_it():
    existing = _task(start_date="2026-09-30", due_date="2026-10-02")

    settled = services.settle_task_range(existing, {"due_date": "2026-09-29"})

    assert settled["start_date"] == "2026-09-27"


def test_an_explicit_start_is_taken_as_given():
    existing = _task(start_date="2026-09-30", due_date="2026-10-02")

    settled = services.settle_task_range(existing, {"start_date": "2026-10-01", "due_date": "2026-10-05"})

    assert settled == {"start_date": "2026-10-01", "due_date": "2026-10-05"}


def test_a_start_after_the_deadline_is_refused_not_swapped():
    existing = _task(due_date="2026-10-02")

    with pytest.raises(services.InvalidTaskRange):
        services.settle_task_range(existing, {"start_date": "2026-10-05"})


def test_clearing_the_deadline_keeps_the_start():
    """"Starts Monday" is a real task."""
    existing = _task(start_date="2026-09-30", due_date="2026-10-02")

    assert services.settle_task_range(existing, {"due_date": None}) == {"due_date": None}


def test_a_task_without_a_start_is_untouched_by_a_reschedule():
    existing = _task(due_date="2026-10-02")

    assert services.settle_task_range(existing, {"due_date": "2026-10-09"}) == {"due_date": "2026-10-09"}


def test_the_callers_dict_is_never_modified():
    existing = _task(start_date="2026-09-30", due_date="2026-10-02")
    updates = {"due_date": "2026-10-09"}

    services.settle_task_range(existing, updates)

    assert updates == {"due_date": "2026-10-09"}


def test_update_task_settles_the_range_before_writing(monkeypatch):
    written = []
    existing = _task(start_date="2026-09-30", due_date="2026-10-02")

    class _Repo:
        def get_task(self, user_id, record_id):
            return existing

        def update_task(self, user_id, record_id, updates):
            written.append(updates)
            return existing.model_copy(update=updates)

    monkeypatch.setattr(services.access, "require_write", lambda u, t: {"id": t})
    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = _Repo()

    svc.update_task(ME, "task-1", {"due_date": "2026-10-09"})

    assert written[0]["start_date"] == "2026-10-07"


# -------------------------------------------------------------- the routes

@pytest.fixture
def client():
    main.app.dependency_overrides[main.get_current_user_id] = lambda: ME
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def test_an_inverted_range_on_patch_is_a_422(client, monkeypatch):
    def _refuse(user_id, record_id, updates):
        raise services.InvalidTaskRange("The start date is after the deadline.")

    monkeypatch.setattr(main.service, "update_task", _refuse)

    assert client.patch("/tasks/task-1", json={"start_date": "2026-10-05"}).status_code == 422


def test_an_inverted_range_on_create_is_a_422_and_nothing_is_created(client, monkeypatch):
    created = []
    monkeypatch.setattr(main.service, "create_task_manual", lambda u, f: created.append(f))

    r = client.post("/tasks", json={"task_name": "Χ", "start_date": "2026-10-05", "due_date": "2026-10-02"})

    assert r.status_code == 422
    assert created == []


def test_a_new_task_keeps_its_start_date(monkeypatch):
    saved = []

    class _Repo:
        def save_task(self, user_id, task):
            saved.append(task)
            return task

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = _Repo()

    svc.create_task_manual(ME, {"task_name": "Χ", "start_date": "2026-09-30", "due_date": "2026-10-02"})

    assert saved[0].start_date == "2026-09-30"


# --------------------------------------------------------- the agent reads it

def _ctx():
    people = agent_tools.build_people_directory(
        ME, [WorkspaceMember(workspace_id="ws-1", user_id=ME, role="owner")],
        {ME: {"display_name": "Owner", "email": "me@example.com"}})
    return agent_tools.build_agent_context(ME, [Workspace(record_id="ws-1", name="Business")], [], people, {})


def _agent_task(record_id, **overrides):
    base = dict(record_id=record_id, task_name=record_id, description="", priority="P2",
                due_date=None, due_time=None, is_completed=False, approval_status=True,
                is_rejected=False, missed_at=None, cancelled_at=None, deleted_at=None,
                workspace_id="ws-1", category_id=None, assigned_to=None, created_by=ME, checklist=[])
    base.update(overrides)
    return SimpleNamespace(**base)


def test_a_search_about_thursday_finds_a_wednesday_to_friday_job():
    job = _agent_task("painting", start_date="2026-09-30", due_date="2026-10-02")
    other = _agent_task("friday-only", due_date="2026-10-02")
    ctx = _ctx()
    search, _ = agent_tools.build_tool_functions([job, other], ctx)

    result = search(date_from="2026-10-01", date_to="2026-10-01")

    names = [row["task_name"] for row in result["tasks"]]
    assert names == ["painting"]


def test_a_job_starting_after_the_asked_days_is_not_found():
    job = _agent_task("later", start_date="2026-10-05", due_date="2026-10-07")
    search, _ = agent_tools.build_tool_functions([job], _ctx())

    assert search(date_from="2026-10-01", date_to="2026-10-02")["tasks"] == []


def test_a_row_shows_a_real_start_and_no_other_row_grows():
    rows = agent_tools.render_task_rows(
        [_agent_task("ranged", start_date="2026-09-30", due_date="2026-10-02"),
         _agent_task("plain", due_date="2026-10-02"),
         _agent_task("stranded", start_date="2026-10-09", due_date="2026-10-02")],
        _ctx(),
    )

    assert rows[0]["start_date"] == "2026-09-30"
    assert "start_date" not in rows[1]
    # A start the calendar left after the deadline is ignored, not trusted.
    assert "start_date" not in rows[2]


def test_the_day_view_lists_what_has_started_and_is_due_later():
    started = _agent_task("started", start_date="2026-09-28", due_date="2026-10-02")
    not_yet = _agent_task("not-yet", start_date="2026-10-01", due_date="2026-10-03")
    due_today = _agent_task("due-today", start_date="2026-09-28", due_date=TODAY)
    ctx = _ctx()

    assert [t.record_id for t in agent_tools.running_tasks([started, not_yet, due_today], TODAY, ctx)] == ["started"]
    view = agent_tools.build_day_view([started, not_yet, due_today], TODAY, "12:00", ctx)
    assert "RUNNING (1)" in view and "2026-09-28 to 2026-10-02" in view


def test_a_day_with_nothing_running_costs_no_extra_line():
    view = agent_tools.build_day_view([_agent_task("plain", due_date=TODAY)], TODAY, "12:00", _ctx())

    assert "RUNNING" not in view


def test_the_instruction_explains_running_in_one_sentence():
    assert agent_tools.build_system_instruction().count("RUNNING") == 1
