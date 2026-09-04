"""
Deleting a task stops removing its row (2026-09-04).

The repository half: what actually reaches Supabase, and what comes back off a
row. The routing decision above it — ordinary task gets deleted_at, recurrence
occurrence gets cancelled_at — is tested in test_recurrence_materialization.py
beside the cancellation it has to stay distinct from.

Also covers `created_at`, surfaced in the same slice: the History tab shows
when a task went in as well as when it left, and the field TaskRecord used to
carry for that (created_time) is written by nothing.

A deliberately small fake rather than a shared one: these five tests need
table/update/eq/execute and nothing else, and a local fake that cannot silently
grow new behaviour is the point of a tripwire test.
"""
import repository

_task_repo = repository._get_shared_tasks_repo()


class _FakeQuery:
    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def update(self, values):
        self.sink["update"] = values
        return self

    def delete(self):
        self.sink["delete"] = True
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows=None):
        self.calls = {}
        self.rows = rows if rows is not None else []

    def table(self, name):
        self.calls["table"] = name
        return _FakeQuery(self.calls, self.rows)


# --- the write path --------------------------------------------------------


def test_deleting_updates_the_row_instead_of_removing_it(monkeypatch):
    """
    The one-line summary of this whole feature. If this ever goes back to
    .delete(), the History tab silently shows nothing and Restore has nothing
    to clear — with every other test still green, because nothing else looks
    at which verb reached the database.
    """
    fake = _FakeSupabase([{"id": "t1"}])
    monkeypatch.setattr(repository, "supabase", fake)

    assert _task_repo.soft_delete_task("user-1", "t1", "2026-09-04T09:00:00+03:00") is True

    assert fake.calls["update"] == {"deleted_at": "2026-09-04T09:00:00+03:00"}
    assert "delete" not in fake.calls, "a delete must never reach the database again"


def test_deleting_is_scoped_to_both_the_row_and_the_user(monkeypatch):
    """Double eq, the same defense-in-depth update_task uses: even a wrong or
    spoofed record_id can only ever touch a row that ALSO belongs to user_id."""
    fake = _FakeSupabase([{"id": "t1"}])
    monkeypatch.setattr(repository, "supabase", fake)

    _task_repo.soft_delete_task("user-1", "t1", "2026-09-04T09:00:00+03:00")

    assert ("id", "t1") in fake.calls["eq"]
    assert ("user_id", "user-1") in fake.calls["eq"]


def test_deleting_reports_false_when_no_row_matched(monkeypatch):
    """A PostgREST UPDATE matching zero rows returns 200 with empty data rather
    than raising. Without this bool the service layer would report a task
    deleted while the row sat untouched."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    assert _task_repo.soft_delete_task("user-1", "t1", "2026-09-04T09:00:00+03:00") is False


# --- the restore path ------------------------------------------------------


def test_restoring_clears_both_deletion_columns(monkeypatch):
    """
    One button restores an ordinary task AND a cancelled recurrence occurrence,
    because to the person who pressed Delete they were the same act. Safe for
    the occurrence: get_occurrence_dates skips any occurrence_date that already
    exists whatever its state, and the row never went away, so clearing the
    stamp cannot duplicate anything.
    """
    fake = _FakeSupabase([{"id": "t1"}])
    monkeypatch.setattr(repository, "supabase", fake)

    assert _task_repo.restore_task("user-1", "t1") is True
    assert fake.calls["update"] == {"deleted_at": None, "cancelled_at": None}
    assert ("id", "t1") in fake.calls["eq"]
    assert ("user_id", "user-1") in fake.calls["eq"]


def test_restoring_reports_false_when_no_row_matched(monkeypatch):
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    assert _task_repo.restore_task("user-1", "t1") is False


# --- the read path ---------------------------------------------------------


def test_deleted_at_is_read_back_off_a_task_row():
    """
    The tripwire the recurrence columns needed too: without its line in
    _supabase_row_to_task, deleted_at comes back None on every task, the
    History tab shows an empty list, and the whole suite stays green.
    """
    row = {
        "id": "task-1",
        "task_name": "Πλήρωσε ΔΕΗ",
        "description": "",
        "category": "Business",
        "priority": "P2",
        "checklist": [],
        "ai_suggested_category": "Business",
        "ai_suggested_priority": "P2",
        "deleted_at": "2026-09-04T09:00:00+03:00",
    }

    task = _task_repo._supabase_row_to_task(row)

    assert task.deleted_at == "2026-09-04T09:00:00+03:00"


def test_a_row_with_no_deleted_at_reads_as_not_deleted():
    """Every one of the 301 existing tasks has NULL here. NULL must mean "not
    deleted", never an empty string or a default that later reads as truthy."""
    row = {
        "id": "task-1",
        "task_name": "Πλήρωσε ΔΕΗ",
        "description": "",
        "category": "Business",
        "priority": "P2",
        "checklist": [],
        "ai_suggested_category": "Business",
        "ai_suggested_priority": "P2",
    }

    task = _task_repo._supabase_row_to_task(row)

    assert task.deleted_at is None


# --- created_at, the other timestamp the History tab needs -----------------


def test_created_at_is_read_back_off_a_task_row():
    """
    "When did this go in" is one of the three things the History tab shows, and
    until 2026-09-04 the frontend could not answer it. The only creation field
    TaskRecord carried was created_time — the Airtable-era column, which
    NOTHING writes (popped from both the insert and the update path) and which
    has no database default. created_at is the real one.
    """
    row = {
        "id": "task-1",
        "task_name": "Πλήρωσε ΔΕΗ",
        "description": "",
        "category": "Business",
        "priority": "P2",
        "checklist": [],
        "ai_suggested_category": "Business",
        "ai_suggested_priority": "P2",
        "created_at": "2026-09-01T08:15:00+03:00",
    }

    task = _task_repo._supabase_row_to_task(row)

    assert task.created_at == "2026-09-01T08:15:00+03:00"


def test_created_at_never_reaches_the_write_path():
    """
    The dangerous half. created_at is a REAL column with a default, so unlike
    the category_name incident it would not be rejected — it would be silently
    overwritten with whatever the model was holding: the row's own stale value
    on a re-save, or None on a fresh object. A creation date that moves is
    worse than one that is missing, and nothing in the UI would show it.

    test_the_write_path_sends_only_real_columns guards the same line from the
    other direction (unknown keys); this one guards a known key that must
    still stay out.
    """
    from models import TaskRecord

    fields = _task_repo._task_to_supabase_fields(TaskRecord(
        task_name="Χ", description="", category="Business", priority="P2",
        ai_suggested_category="Business", ai_suggested_priority="P2",
        created_at="2026-09-01T08:15:00+03:00",
    ))

    assert "created_at" not in fields
    assert "created_time" not in fields
