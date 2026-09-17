"""
The two places a deleted task came BACK, rather than merely rang.

Found on 2026-09-16 while fixing the reminder that reached the owner for a task
he had deleted (tests/test_deleted_tasks_stay_quiet.py). Same root cause — the
2026-09-04 change from a real delete to a `deleted_at` stamp — but these two are
not notifications, so they are in their own file:

  1. get_tasks_needing_calendar_push: stamping deleted_at IS a change, so the
     database's updated_at trigger fires, so the task looks "changed since its
     last calendar push". The app then PUTs to the Google event it deleted a
     moment earlier, gets a 404, and sync_task_to_google_calendar has an
     explicit branch that CREATES A NEW ONE. The event returns to the calendar
     and Google sends its own reminder — which is why this is the candidate for
     a notification that does not look like the app's.

  2. get_open_tasks_for_conversation: a new guest message is threaded onto the
     conversation's existing open task rather than creating a second one. A
     DELETED task still counted as that open task, so the message was appended
     to a row no screen shows. Not a notification — a disappearance.

WHAT THESE TESTS CAN AND CANNOT PROVE. Both functions are Supabase queries, so
the exclusion belongs in the query and a fake can only witness that the query
ASKED for it — not that Postgres honoured it. The genuinely behavioural test in
this file is the one for push_task_to_calendar_now, which filters a TaskRecord
in Python and can therefore be exercised for real.
"""
import google_calendar
import repository
import services
from models import TaskRecord


class _FakeQuery:
    """Records every filter, returns `rows` unfiltered — see the module
    docstring for why that is the honest shape here."""

    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a):
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def order(self, col, **kw):
        return self

    def is_(self, col, val):
        self.sink.setdefault("is_", []).append((col, val))
        return self

    @property
    def not_(self):
        self.sink["not_"] = True
        return _FakeNot(self)

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeNot:
    def __init__(self, q):
        self.q = q

    def is_(self, col, val):
        self.q.sink.setdefault("not_is_", []).append((col, val))
        return self.q


class _FakeSupabase:
    def __init__(self, rows=None):
        self.calls = {}
        self.rows = rows if rows is not None else []

    def table(self, name):
        self.calls["table"] = name
        return _FakeQuery(self.calls, self.rows)


DEAD_COLUMNS = {"deleted_at", "cancelled_at", "missed_at"}


# --- 1. the calendar push queue ----------------------------------------------

def test_the_calendar_push_queue_excludes_dead_rows(monkeypatch):
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(
        repository, "get_app_settings",
        lambda u: type("S", (), {"calendar_sync_all_enabled": True})(),
    )

    repository.get_tasks_needing_calendar_push("u1")

    asked_null = {col for col, val in fake.calls.get("is_", []) if val == "null"}
    assert DEAD_COLUMNS <= asked_null


def test_the_calendar_push_queue_still_excludes_completed_and_rejected(monkeypatch):
    """Pre-existing behaviour that must survive the change."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(
        repository, "get_app_settings",
        lambda u: type("S", (), {"calendar_sync_all_enabled": True})(),
    )

    repository.get_tasks_needing_calendar_push("u1")

    assert ("is_completed", False) in fake.calls["eq"]
    assert ("is_rejected", False) in fake.calls["eq"]


# --- the immediate push, which really can be tested --------------------------
# Its docstring promises it "can never push something the scheduler would refuse
# to push", so it has to learn the same three columns or that stops being true.

def _pushed(monkeypatch, task) -> bool:
    sent = []
    monkeypatch.setattr(repository, "get_google_calendar_connection", lambda u: {"ok": True})
    monkeypatch.setattr(repository, "get_task_calendar_fields", lambda u, r: {})
    monkeypatch.setattr(repository, "update_task_calendar_sync", lambda r, e: None)
    monkeypatch.setattr(
        google_calendar, "sync_task_to_google_calendar",
        lambda u, t: sent.append(t) or "evt-1",
    )
    services.push_task_to_calendar_now("u1", task)
    return bool(sent)


def _task(**overrides):
    base = dict(record_id="t1", task_name="Task", description="", category="Business",
                priority="P1", ai_suggested_category="Business",
                ai_suggested_priority="P1", approval_status=True, due_date="2026-09-20")
    base.update(overrides)
    return TaskRecord(**base)


def test_a_deleted_task_is_not_pushed_to_the_calendar_immediately(monkeypatch):
    assert _pushed(monkeypatch, _task(deleted_at="2026-09-15T20:00:00+03:00")) is False


def test_a_cancelled_occurrence_is_not_pushed_to_the_calendar_immediately(monkeypatch):
    assert _pushed(monkeypatch, _task(cancelled_at="2026-09-15T20:00:00+03:00")) is False


def test_a_missed_occurrence_is_not_pushed_to_the_calendar_immediately(monkeypatch):
    assert _pushed(monkeypatch, _task(missed_at="2026-09-15T06:00:00+03:00")) is False


def test_a_live_task_is_still_pushed_to_the_calendar_immediately(monkeypatch):
    """The control."""
    assert _pushed(monkeypatch, _task()) is True


# --- 2. guest-message threading ----------------------------------------------

def test_a_deleted_task_no_longer_swallows_the_next_guest_message(monkeypatch):
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.get_open_tasks_for_conversation("u1", "conv-1")

    asked_null = {col for col, val in fake.calls.get("is_", []) if val == "null"}
    assert DEAD_COLUMNS <= asked_null


def test_conversation_lookup_keeps_its_existing_scoping(monkeypatch):
    """Pre-existing behaviour that must survive the change: scoped to the user,
    to the conversation, and still excluding completed/rejected."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.get_open_tasks_for_conversation("u1", "conv-1")

    assert ("user_id", "u1") in fake.calls["eq"]
    assert ("hostaway_conversation_id", "conv-1") in fake.calls["eq"]
    assert ("is_completed", False) in fake.calls["eq"]
    assert ("is_rejected", False) in fake.calls["eq"]
