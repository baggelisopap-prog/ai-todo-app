"""
Membership: the table that answers "who may SEE this workspace".

Every query here IS the protection. The backend uses the secret key and
bypasses RLS, so a missing filter is not a slow leak — it is an open door.
"""
import repository
from models import WorkspaceMember


class _FakeQuery:
    """Chainable stand-in for the supabase query builder. Records every call so
    a test can assert WHICH filters were applied, not just what came back."""

    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a, **kw):
        self.sink["select"] = a
        return self

    def insert(self, values):
        self.sink["insert"] = values
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def limit(self, n):
        self.sink["limit"] = n
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows):
        self.rows, self.sink = rows, {}

    def table(self, name):
        self.sink["table"] = name
        return _FakeQuery(self.sink, self.rows)


def _member_row(**overrides):
    base = {"id": "m-1", "workspace_id": "ws-1", "user_id": "user-1",
            "role": "owner", "notify_all": False,
            "joined_at": "2026-09-11T00:00:00Z"}
    base.update(overrides)
    return base


def test_the_workspace_ids_read_returns_ids_and_nothing_else(monkeypatch):
    """Ids only. The caller turns them into one `or` filter, and reading whole
    rows to throw away everything but the id is a round trip's worth of data
    for nothing."""
    fake = _FakeSupabase([{"workspace_id": "ws-1"}, {"workspace_id": "ws-2"}])
    monkeypatch.setattr(repository, "supabase", fake)

    ids = repository.get_member_workspace_ids("user-1")

    assert fake.sink["table"] == "workspace_members"
    assert ("user_id", "user-1") in fake.sink["eq"]
    assert ids == ["ws-1", "ws-2"]


def test_a_user_who_belongs_nowhere_gets_an_empty_list(monkeypatch):
    """[] and never None. get_all_tasks branches on emptiness, and a None
    reaching PostgREST as `workspace_id.in.()` is a SYNTAX ERROR rather than an
    empty match."""
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([]))

    assert repository.get_member_workspace_ids("user-1") == []


def test_a_row_with_a_null_workspace_is_skipped(monkeypatch):
    """Cannot happen through the foreign key, but a None reaching the `in.()`
    list would build a malformed filter — and a malformed filter on this table
    fails open more often than it fails closed, which means another user's
    tasks."""
    fake = _FakeSupabase([{"workspace_id": None}, {"workspace_id": "ws-2"}])
    monkeypatch.setattr(repository, "supabase", fake)

    assert repository.get_member_workspace_ids("user-1") == ["ws-2"]


def test_adding_a_member_records_the_pair_and_the_role(monkeypatch):
    fake = _FakeSupabase([_member_row(user_id="user-2", role="member")])
    monkeypatch.setattr(repository, "supabase", fake)

    m = repository.add_workspace_member("ws-1", "user-2")

    assert fake.sink["table"] == "workspace_members"
    assert fake.sink["insert"]["workspace_id"] == "ws-1"
    assert fake.sink["insert"]["user_id"] == "user-2"
    assert fake.sink["insert"]["role"] == "member"
    assert isinstance(m, WorkspaceMember)
    assert m.role == "member"


def test_adding_a_member_never_sends_an_id(monkeypatch):
    """The database mints it. Sending one would either collide or silently
    overwrite somebody else's row."""
    fake = _FakeSupabase([_member_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.add_workspace_member("ws-1", "user-2")

    assert "id" not in fake.sink["insert"]


def test_listing_members_is_scoped_to_the_workspace(monkeypatch):
    fake = _FakeSupabase([_member_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    members = repository.get_workspace_members("ws-1")

    assert ("workspace_id", "ws-1") in fake.sink["eq"]
    assert members[0].user_id == "user-1"
    assert members[0].role == "owner"


def test_ownership_asks_the_workspaces_table_not_the_members_table(monkeypatch):
    """workspaces.user_id is the authority on who may ADMINISTER a workspace.
    The membership row marked 'owner' is there so "who is in this room" has one
    answer in one table; deciding ownership from it would make one fact
    answerable two ways, which is how the pair starts to drift."""
    fake = _FakeSupabase([{"id": "ws-1"}])
    monkeypatch.setattr(repository, "supabase", fake)

    assert repository.is_workspace_owner("user-1", "ws-1") is True
    assert fake.sink["table"] == "workspaces"
    assert ("id", "ws-1") in fake.sink["eq"]
    assert ("user_id", "user-1") in fake.sink["eq"]


def test_ownership_is_false_when_nothing_comes_back(monkeypatch):
    """A member, or a stranger, or a workspace that does not exist — all three
    are the same answer here, and all three are False rather than an
    exception."""
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([]))

    assert repository.is_workspace_owner("user-2", "ws-1") is False
