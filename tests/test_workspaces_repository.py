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


def _cat_row(**overrides):
    base = {"id": "cat-1", "user_id": "user-1", "workspace_id": "ws-1",
            "name": "γραφείο", "color": "#888888", "position": 0,
            "system_key": None, "created_at": "2026-09-01T00:00:00Z"}
    base.update(overrides)
    return base


def test_listing_categories_is_scoped_to_the_user(monkeypatch):
    """Scoped by user, NOT by workspace: the frontend loads every category once
    and groups them by workspace_id in the provider, rather than making one
    request per workspace on every app open."""
    fake = _FakeSupabase([_cat_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    result = repository.get_categories("user-1")

    assert fake.sink["table"] == "categories"
    assert ("user_id", "user-1") in fake.sink["eq"]
    assert result[0].name == "γραφείο"
    assert result[0].workspace_id == "ws-1"


def test_creating_a_category_stamps_owner_and_workspace(monkeypatch):
    fake = _FakeSupabase([_cat_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.create_category("user-1", Category(workspace_id="ws-1", name="γραφείο"))

    assert fake.sink["insert"]["user_id"] == "user-1"
    assert fake.sink["insert"]["workspace_id"] == "ws-1"
    assert fake.sink["insert"]["system_key"] is None


def test_the_system_category_is_found_by_its_key_not_its_name(monkeypatch):
    """The whole point of system_key. The name 'Hostaway' is a label the user
    sees; the key is what escalation and the webhook actually match on, so
    renaming the label could never break the integration."""
    fake = _FakeSupabase([_cat_row(id="cat-h", name="Hostaway", system_key="hostaway")])
    monkeypatch.setattr(repository, "supabase", fake)

    result = repository.get_system_category("user-1", "hostaway")

    assert ("system_key", "hostaway") in fake.sink["eq"]
    assert ("user_id", "user-1") in fake.sink["eq"]
    assert result.record_id == "cat-h"


def test_a_missing_system_category_returns_None_rather_than_raising(monkeypatch):
    """An account that has not run the migration has no such row. Callers
    branch on None; a raise here would take down the whole scheduler tick."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    assert repository.get_system_category("user-1", "hostaway") is None


# The task read/write path. These are METHODS on AirtableTaskRepository, not
# module-level functions — the same shared instance every other repository test
# reaches for.
_task_repo = repository._get_shared_tasks_repo()


def _task_row(**overrides):
    base = {"id": "task-1", "task_name": "Χ", "description": "", "category": "Business",
            "priority": "P2", "ai_suggested_category": "Business",
            "ai_suggested_priority": "P2", "workspace_id": "ws-1", "category_id": "cat-1"}
    base.update(overrides)
    return base


def test_a_task_row_carries_its_workspace_and_category():
    """Read side. The constructor lists every field by hand, so a new column is
    silently dropped until it is named there."""
    task = _task_repo._supabase_row_to_task(_task_row())

    assert task.workspace_id == "ws-1"
    assert task.category_id == "cat-1"


def test_an_unfiled_task_keeps_None_and_is_not_defaulted():
    """Unfiled is a real, meaningful state — NULL here means 'the classifier
    could not tell', and defaulting it to a string would invent a bucket."""
    task = _task_repo._supabase_row_to_task(
        _task_row(category="Unknown", workspace_id=None, category_id=None)
    )

    assert task.workspace_id is None
    assert task.category_id is None


def test_the_write_path_carries_both_columns():
    """Write side needs no change: _task_to_supabase_fields is built from
    task.model_dump(), so a new model field travels automatically. This test
    exists to catch the day someone replaces model_dump() with a hand-written
    field list and silently stops persisting the workspace."""
    from models import TaskRecord

    fields = _task_repo._task_to_supabase_fields(TaskRecord(
        task_name="Χ", description="", category="Business", priority="P2",
        ai_suggested_category="Business", ai_suggested_priority="P2",
        workspace_id="ws-1", category_id="cat-1",
    ))

    assert fields["workspace_id"] == "ws-1"
    assert fields["category_id"] == "cat-1"
