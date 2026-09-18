"""
The repository half of the handover: pressing OK, and the two columns
surviving the trip back out of the database.

Why the round-trip half is here at all, rather than assumed: `assigned_to` was
written correctly to the column for a full day on 2026-09-11 and dropped on the
way back, because _supabase_row_to_task did not name it. Nothing raised. The
picker simply said "Χωρίς υπεύθυνο" while the database held the right person.
A column the writer knows and the reader does not is a silent failure, and it
has already happened once on this exact table.
"""

import pytest

import repository
from repository import AirtableTaskRepository


class _FakeQuery:
    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a, **kw):
        self.sink["select"] = a
        return self

    def update(self, values):
        self.sink["update"] = values
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def or_(self, expr):
        self.sink["or"] = expr
        return self

    def limit(self, n):
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    """
    Answers the read with `read_rows` and the write with `write_rows`, because
    acknowledging is a read-modify-write and the two halves must be told apart:
    a fake that returns the pre-write row to the writer would let a mapper that
    drops the new columns pass.
    """

    def __init__(self, read_rows, write_rows=None):
        self.read_rows, self.write_rows = read_rows, write_rows
        self.sink = {}
        self.calls = 0

    def table(self, name):
        self.sink["table"] = name
        self.calls += 1
        rows = self.read_rows if self.calls == 1 else (self.write_rows or self.read_rows)
        return _FakeQuery(self.sink, rows)


def _task_row(**overrides):
    base = {"id": "t-1", "user_id": "creator-1", "task_name": "Καθαρισμός Β2",
            "description": "", "category": "Business", "priority": "P3",
            "ai_suggested_category": "Business", "ai_suggested_priority": "P3",
            "checklist": [], "approval_status": True, "is_completed": True,
            "is_rejected": False, "assigned_to": None,
            "completed_by": "maria", "completion_seen_by": []}
    base.update(overrides)
    return base


def _no_workspaces(monkeypatch):
    """scope_to_visible asks which rooms the caller is in before it can narrow."""
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda uid: [])


# ------------------------------------------------------------ pressing OK


def test_acknowledging_adds_me_to_the_list(monkeypatch):
    _no_workspaces(monkeypatch)
    fake = _FakeSupabase([{"id": "t-1", "completion_seen_by": None}], [_task_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    AirtableTaskRepository().acknowledge_completion("vangelis", "t-1")

    assert fake.sink["update"] == {"completion_seen_by": ["vangelis"]}


def test_acknowledging_keeps_whoever_had_already_pressed_ok(monkeypatch):
    """
    Two people can be owed the same handover — the creator and the assignee —
    and the second one to press OK must not erase the first. A write that sent
    only its own id would put the task back on a list somebody had already
    cleared.
    """
    _no_workspaces(monkeypatch)
    fake = _FakeSupabase([{"id": "t-1", "completion_seen_by": ["nikos"]}], [_task_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    AirtableTaskRepository().acknowledge_completion("vangelis", "t-1")

    assert fake.sink["update"] == {"completion_seen_by": ["nikos", "vangelis"]}


def test_pressing_ok_twice_does_not_list_me_twice(monkeypatch):
    """A double tap, or a retry after a dropped reply, is the same fact."""
    _no_workspaces(monkeypatch)
    fake = _FakeSupabase([{"id": "t-1", "completion_seen_by": ["vangelis"]}], [_task_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    AirtableTaskRepository().acknowledge_completion("vangelis", "t-1")

    assert fake.sink["update"] == {"completion_seen_by": ["vangelis"]}


def test_acknowledging_is_narrowed_to_what_i_can_see(monkeypatch):
    """
    The one check this path has. Nothing else guards it, because the only thing
    it writes is the caller's own id — so "may I see this task" is the whole
    question, and scope_to_visible is the app's single answer to it.
    """
    _no_workspaces(monkeypatch)
    fake = _FakeSupabase([{"id": "t-1", "completion_seen_by": []}], [_task_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    AirtableTaskRepository().acknowledge_completion("vangelis", "t-1")

    assert ("user_id", "vangelis") in fake.sink["eq"]


def test_a_task_i_cannot_see_is_refused_out_loud(monkeypatch):
    """
    PostgREST answers a match of zero rows with 200 and an empty list, so the
    silent version of this is a task that never leaves the list and an OK button
    that does nothing forever. That exact shape — an empty list read as data —
    is what broke a member's completion on 2026-09-11.
    """
    _no_workspaces(monkeypatch)
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([]))

    with pytest.raises(ValueError):
        AirtableTaskRepository().acknowledge_completion("vangelis", "t-1")


# --------------------------------------------------- surviving the journey


def test_who_closed_it_survives_the_trip_out_of_the_database():
    task = AirtableTaskRepository()._supabase_row_to_task(_task_row(completed_by="maria"))

    assert task.completed_by == "maria"


def test_who_has_pressed_ok_survives_the_trip_out_of_the_database():
    task = AirtableTaskRepository()._supabase_row_to_task(
        _task_row(completion_seen_by=["vangelis"])
    )

    assert task.completion_seen_by == ["vangelis"]


def test_when_it_was_closed_survives_the_trip_out_of_the_database():
    """
    NOT part of the handover — a bug found while building it, in the same
    failure shape the file header describes.

    tasks.completed_at has existed since 2026-08-13 and the History screen has
    read `task.completed_at` since 2026-09-04, both to date a finished task and
    to decide whether that date is exact. TaskRecord never named the column, so
    FastAPI's response_model stripped it on the way out and the browser has
    always seen undefined — which sends every completed task down
    taskHistory.js's fallback branch: dated by its CREATION time and flagged as
    a completion from before the column existed. Silent, and wrong for every
    completed task in the database.

    Surfaced here because the handover strip needs the same value to say when a
    colleague closed something.
    """
    task = AirtableTaskRepository()._supabase_row_to_task(
        _task_row(completed_at="2026-09-17T14:32:00+03:00")
    )

    assert task.completed_at == "2026-09-17T14:32:00+03:00"


def test_what_kind_of_thing_closed_it_survives_the_trip_too():
    """
    The same bug, the same screen, the neighbouring column.

    HistoryList renders «Ολοκληρώθηκε 14 Σεπ 14:32 · από το AI» by looking up
    task.completed_source, and TaskRecord did not name that column either — so
    the lookup has always been undefined and the suffix has never once appeared.
    The column was added on 2026-08-13 precisely so that "what closed this" had
    an answer after a task closed itself six seconds after being created.
    """
    task = AirtableTaskRepository()._supabase_row_to_task(_task_row(completed_source="agent"))

    assert task.completed_source == "agent"


def test_null_columns_read_as_nobody_rather_than_none():
    """
    Every task in the database predates these columns and carries NULL in both.
    completion_seen_by must arrive as a list — the screen calls .includes() on
    it — and completed_by must arrive as None, which is the value that means
    "no human closed this, hand it back to nobody".
    """
    task = AirtableTaskRepository()._supabase_row_to_task(
        _task_row(completed_by=None, completion_seen_by=None)
    )

    assert task.completed_by is None
    assert task.completion_seen_by == []
