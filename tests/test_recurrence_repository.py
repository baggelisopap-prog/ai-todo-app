"""Rule CRUD. Every query must be scoped to user_id — this is a per-user table."""
import repository
from models import RecurrenceRule


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
