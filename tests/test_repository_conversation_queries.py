"""The conversation lookup must be a scoped, filtered QUERY — not a full scan."""
import repository


class _FakeQuery:
    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a):
        self.sink["select"] = a
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def update(self, values):
        self.sink["update"] = values
        return self

    def order(self, col, desc=False):
        self.sink["order"] = (col, desc)
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows=None):
        self.calls = {}
        self.rows = rows or []

    def table(self, name):
        self.calls["table"] = name
        return _FakeQuery(self.calls, self.rows)


def _row(**overrides):
    row = {
        "id": "aaaaaaaa-0000-0000-0000-000000000001",
        "task_name": "Hostaway: Κώστας - Arachova",
        "description": "δεν βρίσκω τα κλειδιά",
        "category": "Hostaway",
        "priority": "P1",
        "checklist": [],
        "ai_suggested_category": "Hostaway",
        "ai_suggested_priority": "P1",
        "hostaway_conversation_id": "47342748",
    }
    row.update(overrides)
    return row


def test_lookup_filters_by_user_conversation_and_open_state(monkeypatch):
    fake = _FakeSupabase(rows=[_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    tasks = repository.get_open_tasks_for_conversation("user-1", "47342748")

    assert fake.calls["table"] == "tasks"
    assert ("user_id", "user-1") in fake.calls["eq"]
    assert ("hostaway_conversation_id", "47342748") in fake.calls["eq"]
    assert ("is_completed", False) in fake.calls["eq"]
    assert ("is_rejected", False) in fake.calls["eq"]
    assert len(tasks) == 1
    assert tasks[0].hostaway_conversation_id == "47342748"


def test_lookup_returns_empty_when_nothing_matches(monkeypatch):
    monkeypatch.setattr(repository, "supabase", _FakeSupabase(rows=[]))
    assert repository.get_open_tasks_for_conversation("user-1", "999") == []


def test_lookup_never_raises(monkeypatch):
    """An inbound webhook must not 500 because a lookup failed."""
    class _Boom:
        def table(self, name):
            raise RuntimeError("supabase is down")

    monkeypatch.setattr(repository, "supabase", _Boom())
    assert repository.get_open_tasks_for_conversation("user-1", "47342748") == []


def test_update_scopes_to_user_and_record(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(repository, "supabase", fake)

    repository.update_hostaway_thread_fields(
        "user-1", "task-1", {"hostaway_message_count": 2, "priority": "P1"}
    )

    assert fake.calls["update"] == {"hostaway_message_count": 2, "priority": "P1"}
    assert ("id", "task-1") in fake.calls["eq"]
    assert ("user_id", "user-1") in fake.calls["eq"]


def test_update_with_no_changes_does_not_hit_the_database(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(repository, "supabase", fake)
    repository.update_hostaway_thread_fields("user-1", "task-1", {})
    assert fake.calls == {}
