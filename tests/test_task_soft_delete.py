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
import pytest

import repository

_task_repo = repository._get_shared_tasks_repo()


@pytest.fixture(autouse=True)
def solo_account(monkeypatch):
    """
    Every test in this file predates sharing, so each one means "somebody who
    belongs to no workspace" — and that is now a real question the queries ask.

    Stubbed rather than left to the fake: an unstubbed membership lookup in this
    suite is a LIVE query against the real Supabase project, not an error. That
    is how a missing get_owned_workspaces stub announced itself on 2026-09-11.
    """
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: [])


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

    def or_(self, expr):
        # scope_to_visible uses this for anybody who belongs to a workspace.
        self.sink["or"] = expr
        return self

    def limit(self, n):
        self.sink["limit"] = n
        return self

    def select(self, *a):
        self.sink["select"] = a
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


# --- sharing: the scoping bug a colleague found on 2026-09-12 --------------
#
# access.py decides whether a write is ALLOWED. These queries decide which rows
# a statement can reach. They disagreed for four weeks' worth of a feature: the
# gate said "yes, she is a member", and the query then asked for a row that also
# belonged to her, matched nothing, and the caller crashed on data[0].


def test_a_member_reaches_a_colleagues_row(monkeypatch):
    """The whole bug, in one assertion. The filter must be an `or` — mine OR
    anything in a room I am in — not an equality on the creator."""
    fake = _FakeSupabase([{"id": "t-1"}])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: ["ws-1"])

    _task_repo.soft_delete_task("evi", "t-1", "2026-09-12T11:49:02Z")

    assert fake.calls["or"] == "user_id.eq.evi,workspace_id.in.(ws-1)"
    assert ("user_id", "evi") not in fake.calls.get("eq", [])
    assert ("id", "t-1") in fake.calls["eq"]


def test_somebody_who_belongs_to_nothing_is_queried_exactly_as_before(monkeypatch):
    """The regression guard. A solo account must produce the plain owner filter
    and no `or` at all — widening for members must not change what the only
    kind of account that existed until yesterday sees."""
    fake = _FakeSupabase([{"id": "t-1"}])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: [])

    _task_repo.soft_delete_task("solo", "t-1", "2026-09-12T11:49:02Z")

    assert "or" not in fake.calls
    assert ("user_id", "solo") in fake.calls["eq"]


def test_a_stranger_still_matches_nothing(monkeypatch):
    """Belonging to a DIFFERENT room must not reach this row. The filter still
    names the stranger's own workspaces, so the row simply is not in it — and
    the empty result is what the caller reports."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: ["ws-elsewhere"])

    assert _task_repo.soft_delete_task("stranger", "t-1", "2026-09-12T11:49:02Z") is False
    assert fake.calls["or"] == "user_id.eq.stranger,workspace_id.in.(ws-elsewhere)"


def test_an_update_that_matches_nothing_says_so_instead_of_crashing(monkeypatch):
    """It used to read data[0] off an empty list. An IndexError naming neither
    the task nor the reason is how the member-cannot-complete bug actually
    reached a person's screen."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: [])

    with pytest.raises(ValueError) as excinfo:
        _task_repo.update_task("solo", "t-1", {"is_completed": True})

    assert "t-1" in str(excinfo.value)


def test_restoring_is_scoped_the_same_way(monkeypatch):
    fake = _FakeSupabase([{"id": "t-1"}])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: ["ws-1"])

    _task_repo.restore_task("evi", "t-1")

    assert fake.calls["or"] == "user_id.eq.evi,workspace_id.in.(ws-1)"
    assert fake.calls["update"] == {"deleted_at": None, "cancelled_at": None}
