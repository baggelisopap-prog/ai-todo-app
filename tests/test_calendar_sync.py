"""
Two things the Google Calendar sync got wrong, both found on 2026-09-04 by
measuring the live database rather than by reading the code.

1. PRESSING THE PER-TASK CALENDAR BUTTON DID NOTHING FOR UP TO TWO MINUTES.
   The button only wrote a flag; the actual push waited for the next
   scheduler tick. The owner reported it as "the button doesn't work, but
   after I turn on sync-all it starts working" — which it never did: what
   changed was that two minutes had passed. Recurrences already push
   synchronously for exactly this reason (see main.py's create_recurrence).

2. THE PULL REWROTE EVERY LINKED TASK ON EVERY TICK.
   update_task_from_calendar_event was called for each app-created event
   whether or not anything had changed. Measured: 105 of 109 task rows got
   a fresh google_last_synced_at within 170 seconds, with nobody touching
   the app — roughly 75.000 pointless writes a day. Worse than the waste:
   google_last_synced_at is what get_tasks_needing_calendar_push compares
   updated_at against, so a stamp written by the pull could land AFTER a
   real edit and hide that edit from the push queue forever.

   This is the same family as the 2026-08-28 updated_at bug, from the other
   side — there the push kept re-sending, here the pull keeps re-stamping.
"""
import google_calendar
import repository
import services
from models import TaskRecord


def _task(record_id="task-1", due_date="2026-09-10", due_time="17:00", completed=False, name="Αλλαγή σεντονιών"):
    return TaskRecord(
        task_name=name, description="στο σαλέ", category="Business", priority="P2",
        checklist=[], ai_suggested_category="Business", ai_suggested_priority="P2",
        record_id=record_id, due_date=due_date, due_time=due_time, is_completed=completed,
    )


def _service(monkeypatch, returned_task, connected=True, pushed_event_id="event-99"):
    """
    A TaskService whose repository returns `returned_task`, with every
    calendar collaborator faked. Returns (service, log) where log records
    what the calendar side was asked to do.
    """
    log = {"pushed": [], "stored": []}

    class _Repo:
        def update_task(self, user_id, record_id, updates):
            return returned_task

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = _Repo()

    monkeypatch.setattr(services.repository, "get_task_calendar_fields", lambda u, r: {"google_event_id": None})
    monkeypatch.setattr(
        services.repository, "get_google_calendar_connection",
        lambda u: {"access_token": "t"} if connected else None,
    )
    monkeypatch.setattr(
        services.repository, "update_task_calendar_sync",
        lambda task_id, event_id: log["stored"].append((task_id, event_id)),
    )
    monkeypatch.setattr(
        services.google_calendar, "sync_task_to_google_calendar",
        lambda user_id, task: (log["pushed"].append(task), pushed_event_id)[1],
    )
    return svc, log


# --- 1. The button sends now, not in two minutes ---------------------------


def test_turning_the_toggle_on_pushes_the_task_immediately(monkeypatch):
    svc, log = _service(monkeypatch, _task())
    svc.update_task("user-1", "task-1", {"calendar_sync_enabled": True})

    assert len(log["pushed"]) == 1, "the button must not wait for the scheduler tick"
    assert log["pushed"][0]["id"] == "task-1"
    assert log["pushed"][0]["due_date"] == "2026-09-10"
    assert log["pushed"][0]["due_time"] == "17:00"
    assert log["stored"] == [("task-1", "event-99")], "a successful push must be recorded"


def test_the_pushed_values_are_the_ones_just_saved(monkeypatch):
    """Changing the date AND switching sync on in one save must push the NEW date."""
    svc, log = _service(monkeypatch, _task(due_date="2026-12-24", due_time="09:30"))
    svc.update_task("user-1", "task-1", {"due_date": "2026-12-24", "calendar_sync_enabled": True})

    assert log["pushed"][0]["due_date"] == "2026-12-24"
    assert log["pushed"][0]["due_time"] == "09:30"


def test_a_task_with_no_date_is_not_pushed(monkeypatch):
    """Mirrors the push queue's own rule: a task with no due_date is not eligible."""
    svc, log = _service(monkeypatch, _task(due_date=None, due_time=None))
    svc.update_task("user-1", "task-1", {"calendar_sync_enabled": True})

    assert log["pushed"] == []


def test_a_completed_task_is_not_pushed(monkeypatch):
    svc, log = _service(monkeypatch, _task(completed=True))
    svc.update_task("user-1", "task-1", {"calendar_sync_enabled": True})

    assert log["pushed"] == []


def test_turning_the_toggle_off_pushes_nothing(monkeypatch):
    """Deleting the event on OFF is a separate, confirmed decision — not this."""
    svc, log = _service(monkeypatch, _task())
    svc.update_task("user-1", "task-1", {"calendar_sync_enabled": False})

    assert log["pushed"] == []


def test_an_ordinary_edit_does_not_push(monkeypatch):
    """Renaming a task must not start talking to Google on the user's request path."""
    svc, log = _service(monkeypatch, _task())
    svc.update_task("user-1", "task-1", {"task_name": "renamed"})

    assert log["pushed"] == []


def test_no_google_connection_means_no_push_attempt(monkeypatch):
    svc, log = _service(monkeypatch, _task(), connected=False)
    svc.update_task("user-1", "task-1", {"calendar_sync_enabled": True})

    assert log["pushed"] == []


def test_a_refused_push_does_not_break_the_save(monkeypatch):
    """
    The flag is saved either way and the next tick retries — exactly today's
    behaviour. The immediate push may only ever make things faster, never
    less reliable.
    """
    svc, log = _service(monkeypatch, _task(), pushed_event_id=None)
    updated = svc.update_task("user-1", "task-1", {"calendar_sync_enabled": True})

    assert updated.record_id == "task-1"
    assert log["stored"] == [], "nothing to record when Google refused"


def test_a_raising_push_does_not_break_the_save(monkeypatch):
    def _boom(user_id, task):
        raise RuntimeError("Google is having a day")

    svc, log = _service(monkeypatch, _task())
    monkeypatch.setattr(services.google_calendar, "sync_task_to_google_calendar", _boom)

    updated = svc.update_task("user-1", "task-1", {"calendar_sync_enabled": True})
    assert updated.record_id == "task-1"


# --- 2. The pull writes only when something actually changed ---------------


class _Response:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _event(task_id="task-1", title="Αλλαγή σεντονιών", date="2026-09-10", time="17:00"):
    start = {"dateTime": f"{date}T{time}:00+03:00"} if time else {"date": date}
    return {
        "id": "event-99",
        "summary": title,
        "status": "confirmed",
        "start": start,
        "extendedProperties": {"private": {google_calendar.TASK_ID_EXTENDED_PROPERTY: task_id}},
    }


def _pull(monkeypatch, events, snapshot):
    """Runs one pull against a fake Google, returning the write-backs it made."""
    writes = []

    monkeypatch.setattr(
        google_calendar.repository, "get_google_calendar_connection",
        lambda u: {"calendar_sync_token": None, "access_token": "t"},
    )
    monkeypatch.setattr(google_calendar, "get_valid_access_token", lambda u: "t")
    monkeypatch.setattr(
        google_calendar.requests, "get",
        lambda url, headers=None, params=None, timeout=None: _Response({"items": events}),
    )
    monkeypatch.setattr(
        google_calendar.repository, "get_tasks_sync_snapshot",
        lambda user_id, task_ids: {k: v for k, v in snapshot.items() if k in task_ids},
    )
    monkeypatch.setattr(
        google_calendar.repository, "update_task_from_calendar_event",
        lambda task_id, due_date, due_time, task_name: writes.append(
            (task_id, due_date, due_time, task_name)
        ),
    )
    monkeypatch.setattr(google_calendar.repository, "update_calendar_sync_token", lambda u, t: None)

    google_calendar.pull_calendar_changes("user-1")
    return writes


def test_an_unchanged_event_is_not_written_back(monkeypatch):
    """The 75.000-writes-a-day bug: same title, same date, same time — no write."""
    writes = _pull(
        monkeypatch,
        [_event()],
        {"task-1": {"task_name": "Αλλαγή σεντονιών", "due_date": "2026-09-10", "due_time": "17:00"}},
    )
    assert writes == []


def test_an_unchanged_all_day_event_is_not_written_back(monkeypatch):
    """A date-only task holds due_time NULL; the pull computes None. Same thing."""
    writes = _pull(
        monkeypatch,
        [_event(time=None)],
        {"task-1": {"task_name": "Αλλαγή σεντονιών", "due_date": "2026-09-10", "due_time": None}},
    )
    assert writes == []


def test_a_changed_event_is_written_back_exactly_once(monkeypatch):
    writes = _pull(
        monkeypatch,
        [_event(time="19:45")],
        {"task-1": {"task_name": "Αλλαγή σεντονιών", "due_date": "2026-09-10", "due_time": "17:00"}},
    )
    assert writes == [("task-1", "2026-09-10", "19:45", "Αλλαγή σεντονιών")]


def test_a_renamed_event_is_written_back(monkeypatch):
    writes = _pull(
        monkeypatch,
        [_event(title="Αλλαγή σεντονιών και πετσετών")],
        {"task-1": {"task_name": "Αλλαγή σεντονιών", "due_date": "2026-09-10", "due_time": "17:00"}},
    )
    assert len(writes) == 1
    assert writes[0][3] == "Αλλαγή σεντονιών και πετσετών"


def test_the_completion_checkmark_is_not_a_change(monkeypatch):
    """
    A completed task's event carries a "✓ " prefix that this app itself added.
    It is stripped before comparison, or every completed task would be
    rewritten on every tick — which is precisely the bug being fixed.
    """
    writes = _pull(
        monkeypatch,
        [_event(title=f"{google_calendar.COMPLETION_CHECKMARK_PREFIX}Αλλαγή σεντονιών")],
        {"task-1": {"task_name": "Αλλαγή σεντονιών", "due_date": "2026-09-10", "due_time": "17:00"}},
    )
    assert writes == []


def test_an_event_naming_a_task_we_cannot_see_is_not_written(monkeypatch):
    """
    The task id comes from an event's extended property — data from outside.
    If it does not resolve to one of THIS user's tasks, there is nothing to
    write back to.
    """
    writes = _pull(monkeypatch, [_event(task_id="someone-elses-task")], {})
    assert writes == []
