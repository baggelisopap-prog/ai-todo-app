"""
Workspaces and categories: the two tables that turn a category from a word into
a row. Every query here must be scoped to user_id — the backend uses the secret
key and bypasses RLS, so this scoping IS the protection.
"""
from models import Category, Workspace


def test_a_workspace_needs_only_a_name():
    """Everything else has a sane default, because the create endpoint takes
    only a name and the user should not have to pick a colour to get started."""
    w = Workspace(name="Business")

    assert w.name == "Business"
    assert w.position == 0
    assert w.color is None
    assert w.record_id is None


def test_an_ordinary_category_has_no_system_key():
    """system_key is what marks a row the integration owns. A user-made
    category must never carry one, or it becomes undeletable."""
    c = Category(workspace_id="ws-1", name="γραφείο")

    assert c.system_key is None
    assert c.workspace_id == "ws-1"


def test_the_hostaway_category_carries_its_system_key():
    c = Category(workspace_id="ws-1", name="Hostaway", system_key="hostaway")

    assert c.system_key == "hostaway"


import repository


class _FakeQuery:
    """Chainable stand-in for the supabase query builder. Records every call so
    a test can assert WHICH filters were applied, not just what came back."""

    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a, **kw):
        self.sink["select"] = a
        self.sink["select_kw"] = kw
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

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def order(self, col, **kw):
        # A list, not a single slot: get_workspaces orders by position THEN by
        # created_at, and a single slot would silently keep only the last one.
        self.sink.setdefault("orders", []).append((col, kw))
        return self

    def limit(self, n):
        self.sink["limit"] = n
        return self

    def execute(self):
        return type("R", (), {"data": self.rows, "count": len(self.rows)})()


class _FakeSupabase:
    def __init__(self, rows):
        self.rows, self.sink = rows, {}

    def table(self, name):
        self.sink["table"] = name
        return _FakeQuery(self.sink, self.rows)


def _ws_row(**overrides):
    base = {"id": "ws-1", "user_id": "user-1", "name": "Business",
            "color": "#2563eb", "position": 0, "created_at": "2026-09-01T00:00:00Z"}
    base.update(overrides)
    return base


def test_listing_workspaces_is_scoped_to_the_user_and_ordered(monkeypatch):
    fake = _FakeSupabase([_ws_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    result = repository.get_workspaces("user-1")

    assert fake.sink["table"] == "workspaces"
    assert ("user_id", "user-1") in fake.sink["eq"]
    assert fake.sink["orders"][0][0] == "position"
    assert result[0].name == "Business"
    assert result[0].record_id == "ws-1"


def test_reading_one_workspace_filters_on_BOTH_id_and_user(monkeypatch):
    """A workspace id alone must never read another user's row. The backend
    bypasses RLS, so this pair of filters is the whole protection."""
    fake = _FakeSupabase([_ws_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.get_workspace("user-1", "ws-1")

    assert ("id", "ws-1") in fake.sink["eq"]
    assert ("user_id", "user-1") in fake.sink["eq"]


def test_creating_a_workspace_stamps_the_owner(monkeypatch):
    fake = _FakeSupabase([_ws_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.create_workspace("user-1", Workspace(name="Business", color="#2563eb"))

    assert fake.sink["insert"]["user_id"] == "user-1"
    assert fake.sink["insert"]["name"] == "Business"
    assert "id" not in fake.sink["insert"]


def test_deleting_a_workspace_is_scoped_to_the_user(monkeypatch):
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.delete_workspace("user-1", "ws-1")

    assert fake.sink["delete"] is True
    assert ("id", "ws-1") in fake.sink["eq"]
    assert ("user_id", "user-1") in fake.sink["eq"]
