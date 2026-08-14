"""
The account lookup must be a filtered QUERY, and must return EVERY colleague.

Fifteen staff share account 147809. A lookup that returns one row would
silently drop every colleague but one.
"""
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

    def upsert(self, values, **kwargs):
        self.sink["upsert"] = values
        self.sink["upsert_kwargs"] = kwargs
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

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows=None):
        self.calls = {}
        self.rows = rows if rows is not None else []

    def table(self, name):
        self.calls["table"] = name
        return _FakeQuery(self.calls, self.rows)


def _row(user_id="user-1", **overrides):
    row = {
        "id": "cccccccc-0000-0000-0000-000000000001",
        "user_id": user_id,
        "account_id": "147809",
        "client_secret_encrypted": "gAAAAA-not-a-real-secret",
        "webhook_id": 34986,
        "tasks_enabled": True,
        "auto_close_enabled": True,
        "connected_at": "2026-08-13T18:00:00+03:00",
    }
    row.update(overrides)
    return row


def test_one_account_returns_every_colleague(monkeypatch):
    fake = _FakeSupabase([_row("user-1"), _row("user-2"), _row("user-3")])
    monkeypatch.setattr(repository, "supabase", fake)

    rows = repository.get_hostaway_connections_for_account("147809")

    assert [r["user_id"] for r in rows] == ["user-1", "user-2", "user-3"]
    assert fake.calls["table"] == "hostaway_connections"
    assert ("account_id", "147809") in fake.calls["eq"]


def test_an_unknown_account_returns_empty(monkeypatch):
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([]))
    assert repository.get_hostaway_connections_for_account("999") == []


def test_a_lookup_failure_returns_empty_rather_than_raising(monkeypatch):
    """This runs inside the webhook, which must always answer 200."""
    class _Boom:
        def table(self, name):
            raise RuntimeError("postgrest is down")

    monkeypatch.setattr(repository, "supabase", _Boom())
    assert repository.get_hostaway_connections_for_account("147809") == []
    assert repository.get_hostaway_connection("user-1") is None


def test_one_user_has_one_connection(monkeypatch):
    fake = _FakeSupabase([_row("user-1")])
    monkeypatch.setattr(repository, "supabase", fake)

    row = repository.get_hostaway_connection("user-1")

    assert row["account_id"] == "147809"
    assert ("user_id", "user-1") in fake.calls["eq"]


def test_a_user_with_no_connection_gets_none(monkeypatch):
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([]))
    assert repository.get_hostaway_connection("user-1") is None


def test_saving_upserts_on_user_id(monkeypatch):
    """Reconnecting replaces the row instead of failing on the unique index."""
    fake = _FakeSupabase([_row("user-1")])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.upsert_hostaway_connection("user-1", "147809", "cipher", 34986)

    assert fake.calls["upsert"]["user_id"] == "user-1"
    assert fake.calls["upsert"]["client_secret_encrypted"] == "cipher"
    assert fake.calls["upsert"]["webhook_id"] == 34986
    assert fake.calls["upsert_kwargs"]["on_conflict"] == "user_id"


def test_a_switch_update_is_scoped_to_the_user(monkeypatch):
    fake = _FakeSupabase([_row("user-1")])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.update_hostaway_connection("user-1", {"auto_close_enabled": False})

    assert fake.calls["update"] == {"auto_close_enabled": False}
    assert ("user_id", "user-1") in fake.calls["eq"]


def test_an_empty_update_writes_nothing(monkeypatch):
    fake = _FakeSupabase([_row("user-1")])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.update_hostaway_connection("user-1", {})

    assert "update" not in fake.calls


def test_deleting_is_scoped_to_the_user(monkeypatch):
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.delete_hostaway_connection("user-1")

    assert fake.calls["delete"] is True
    assert ("user_id", "user-1") in fake.calls["eq"]
