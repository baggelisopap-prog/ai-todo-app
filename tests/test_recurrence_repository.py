"""Rule CRUD. Every query must be scoped to user_id — this is a per-user table."""
import repository
from models import RecurrenceRule

_task_repo = repository._get_shared_tasks_repo()


class _FakeQuery:
    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a):
        self.sink["select"] = a
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def insert(self, values):
        self.sink["insert"] = values
        return self

    def update(self, values):
        self.sink["update"] = values
        return self

    def delete(self):
        self.sink["delete"] = True
        return self

    def limit(self, n):
        self.sink["limit"] = n
        return self

    def order(self, col, **kw):
        self.sink["order"] = (col, kw)
        return self

    def gte(self, col, val):
        self.sink.setdefault("gte", []).append((col, val))
        return self

    def lte(self, col, val):
        self.sink.setdefault("lte", []).append((col, val))
        return self

    def is_(self, col, val):
        self.sink["is_"] = (col, val)
        self.sink.setdefault("is_calls", []).append((col, val))
        return self

    def in_(self, col, vals):
        self.sink["in_"] = (col, vals)
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


def _row(**overrides):
    row = {
        "id": "rule-1",
        "user_id": "user-1",
        "task_name": "Χάπι",
        "description": "",
        "category": "Personal",
        "priority": "P2",
        "due_time": "09:00",
        "checklist": [],
        "freq": "weekly",
        "weekdays": [1, 2, 3, 4, 5],
        "month_day": None,
        "starts_on": "2026-08-17",
        "ends_on": None,
        "is_active": True,
        "approval_status": True,
        "notify_enabled": True,
        "calendar_sync_enabled": False,
        "grace_days": 1,
        "materialized_through": None,
        "created_at": "2026-08-15T10:00:00+00:00",
    }
    row.update(overrides)
    return row


def _rule():
    return RecurrenceRule(task_name="Χάπι", category="Personal", priority="P2",
                          due_time="09:00", freq="weekly", weekdays=[1, 2, 3, 4, 5],
                          starts_on="2026-08-17", notify_enabled=True)


def test_creating_a_rule_writes_the_user_id_and_returns_the_saved_row(monkeypatch):
    fake = _FakeSupabase([_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    saved = repository.create_recurrence_rule("user-1", _rule())

    assert fake.calls["table"] == "recurrence_rules"
    assert fake.calls["insert"]["user_id"] == "user-1"
    assert "record_id" not in fake.calls["insert"], "record_id is server-generated"
    assert saved.record_id == "rule-1"
    assert saved.weekdays == [1, 2, 3, 4, 5]


def test_listing_rules_is_scoped_to_the_user(monkeypatch):
    fake = _FakeSupabase([_row(), _row(id="rule-2")])
    monkeypatch.setattr(repository, "supabase", fake)

    rules = repository.get_recurrence_rules("user-1")

    assert ("user_id", "user-1") in fake.calls["eq"]
    assert [r.record_id for r in rules] == ["rule-1", "rule-2"]


def test_getting_one_rule_filters_on_both_id_and_user(monkeypatch):
    """A rule id alone must never be enough to read someone else's rule."""
    fake = _FakeSupabase([_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    got = repository.get_recurrence_rule("user-1", "rule-1")

    assert ("user_id", "user-1") in fake.calls["eq"]
    assert ("id", "rule-1") in fake.calls["eq"]
    assert got.record_id == "rule-1"


def test_getting_a_missing_rule_returns_none(monkeypatch):
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([]))
    assert repository.get_recurrence_rule("user-1", "nope") is None


def test_updating_a_rule_filters_on_both_id_and_user(monkeypatch):
    fake = _FakeSupabase([_row(is_active=False)])
    monkeypatch.setattr(repository, "supabase", fake)

    got = repository.update_recurrence_rule("user-1", "rule-1", {"is_active": False})

    assert fake.calls["update"] == {"is_active": False}
    # Both filters, not just user_id: dropping the id filter alone would make
    # one edit rewrite every rule this user owns.
    assert ("user_id", "user-1") in fake.calls["eq"]
    assert ("id", "rule-1") in fake.calls["eq"]
    assert got.is_active is False


def test_an_empty_update_does_not_hit_the_database(monkeypatch):
    fake = _FakeSupabase([_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.update_recurrence_rule("user-1", "rule-1", {})

    assert "update" not in fake.calls


def test_deleting_a_rule_is_scoped_to_the_user(monkeypatch):
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.delete_recurrence_rule("user-1", "rule-1")

    assert fake.calls["delete"] is True
    assert ("user_id", "user-1") in fake.calls["eq"]
    assert ("id", "rule-1") in fake.calls["eq"]


def test_occurrence_dates_come_back_as_a_set_for_the_difference(monkeypatch):
    fake = _FakeSupabase([{"occurrence_date": "2026-08-17"}, {"occurrence_date": "2026-08-18"}])
    monkeypatch.setattr(repository, "supabase", fake)

    got = repository.get_occurrence_dates("user-1", "rule-1", "2026-08-17", "2026-08-31")

    assert got == {"2026-08-17", "2026-08-18"}
    assert ("user_id", "user-1") in fake.calls["eq"]
    assert ("recurrence_rule_id", "rule-1") in fake.calls["eq"]


def test_open_occurrences_exclude_completed_rejected_and_already_missed(monkeypatch):
    """The filtering is in the query, so a rule with a year of history stays cheap."""
    fake = _FakeSupabase([
        {"id": "t1", "occurrence_date": "2026-08-17", "due_date": "2026-08-17"},
    ])
    monkeypatch.setattr(repository, "supabase", fake)

    got = repository.get_open_occurrences("user-1", "rule-1")

    assert got == [{"id": "t1", "occurrence_date": "2026-08-17", "due_date": "2026-08-17"}]
    assert ("is_completed", False) in fake.calls["eq"]
    assert ("is_rejected", False) in fake.calls["eq"]
    assert fake.calls["is_"] == ("missed_at", "null")


def test_open_occurrences_also_exclude_a_cancelled_one(monkeypatch):
    """
    Without this filter, editing a rule (which deletes what get_open_occurrences
    reports as still-open) would delete the cancelled row as an "open future
    occurrence" -- and the generator, seeing that date missing again, would
    recreate the task. The cancellation would survive until the first rule
    edit and then silently vanish.
    """
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.get_open_occurrences("user-1", "rule-1")

    assert ("cancelled_at", "null") in fake.calls["is_calls"]
    assert ("missed_at", "null") in fake.calls["is_calls"]


def test_deleting_by_ids_is_scoped_and_skips_an_empty_list(monkeypatch):
    fake = _FakeSupabase([{"id": "t1"}, {"id": "t2"}])
    monkeypatch.setattr(repository, "supabase", fake)

    assert repository.delete_tasks_by_ids("user-1", ["t1", "t2"]) == 2
    assert fake.calls["in_"] == ("id", ["t1", "t2"])
    assert ("user_id", "user-1") in fake.calls["eq"]

    empty = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", empty)
    assert repository.delete_tasks_by_ids("user-1", []) == 0
    assert empty.calls == {}, "an empty list must not reach the database"


def test_marking_missed_writes_only_missed_at(monkeypatch):
    fake = _FakeSupabase([{"id": "t1"}])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.mark_task_missed("user-1", "t1", "2026-08-19T06:00:00+03:00")

    assert fake.calls["update"] == {"missed_at": "2026-08-19T06:00:00+03:00"}
    assert ("user_id", "user-1") in fake.calls["eq"]
    assert ("id", "t1") in fake.calls["eq"]


def test_cancelling_writes_only_cancelled_at(monkeypatch):
    fake = _FakeSupabase([{"id": "t1"}])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.cancel_task("user-1", "t1", "2026-08-20T06:00:00+03:00")

    # Exact equality, not membership: an `in` check would still pass even if
    # some other field were also written alongside cancelled_at.
    assert fake.calls["update"] == {"cancelled_at": "2026-08-20T06:00:00+03:00"}
    assert ("user_id", "user-1") in fake.calls["eq"]
    assert ("id", "t1") in fake.calls["eq"]


def test_cancelling_reports_whether_a_row_was_actually_updated(monkeypatch):
    """
    Same shape as the hard-delete branch: a PostgREST UPDATE matching zero
    rows returns 200 with empty data, not an exception. Without a real
    success signal here, a race or an RLS edge case would leave the row
    untouched while the caller reports success.
    """
    matched = _FakeSupabase([{"id": "t1"}])
    monkeypatch.setattr(repository, "supabase", matched)
    assert repository.cancel_task("user-1", "t1", "2026-08-20T06:00:00+03:00") is True

    unmatched = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", unmatched)
    assert repository.cancel_task("user-1", "t1", "2026-08-20T06:00:00+03:00") is False


def test_the_recurrence_columns_are_read_back_off_a_task_row():
    """
    Without the four lines in _supabase_row_to_task these come back None,
    every later task reads None for recurrence_rule_id, and the feature is
    inert while the whole suite stays green. This test is the tripwire.
    """
    row = {
        "id": "task-1",
        "task_name": "Χάπι",
        "description": "",
        "category": "Personal",
        "priority": "P2",
        "checklist": [],
        "ai_suggested_category": "Personal",
        "ai_suggested_priority": "P2",
        "recurrence_rule_id": "rule-1",
        "occurrence_date": "2026-08-17",
        "missed_at": "2026-08-19T06:00:00+03:00",
        "cancelled_at": "2026-08-20T06:00:00+03:00",
    }

    task = _task_repo._supabase_row_to_task(row)

    assert task.recurrence_rule_id == "rule-1"
    assert task.occurrence_date == "2026-08-17"
    assert task.missed_at == "2026-08-19T06:00:00+03:00"
    assert task.cancelled_at == "2026-08-20T06:00:00+03:00"
