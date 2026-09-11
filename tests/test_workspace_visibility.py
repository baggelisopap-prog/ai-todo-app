"""
Workspaces and categories become visible to members — and the second read that
has to exist because of it.

Same shape as the task reads, for the same reason. `get_workspaces` is what a
SCREEN asks; `get_owned_workspaces` is what "does this person have their own
furniture yet" asks. Collapsing them would mean a colleague who is invited
before they ever open the app is never furnished, and every task they create is
unfiled forever — which is the exact failure ensure_account_workspaces was
written to prevent, coming back through a side door.
"""
import services
import repository


class _FakeQuery:
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

    def is_(self, col, val):
        self.sink.setdefault("is", []).append((col, val))
        return self

    def in_(self, col, vals):
        self.sink.setdefault("in", []).append((col, list(vals)))
        return self

    def or_(self, expr):
        self.sink["or"] = expr
        return self

    def order(self, col, **kw):
        self.sink.setdefault("orders", []).append((col, kw))
        return self

    def limit(self, n):
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows):
        self.rows, self.sink = rows, {}

    def table(self, name):
        self.sink["table"] = name
        return _FakeQuery(self.sink, self.rows)


def _ws_row(**overrides):
    base = {"id": "ws-1", "user_id": "user-1", "name": "Business",
            "color": "#2563eb", "position": 0, "archived_at": None,
            "created_at": "2026-09-01T00:00:00Z"}
    base.update(overrides)
    return base


def _cat_row(**overrides):
    base = {"id": "c-1", "user_id": "user-1", "workspace_id": "ws-1",
            "name": "γραφείο", "color": None, "position": 0,
            "system_key": None, "created_at": "2026-09-01T00:00:00Z"}
    base.update(overrides)
    return base


# ------------------------------------------------------- the narrow read


def test_the_owned_read_is_the_old_query_exactly(monkeypatch):
    """The regression guard. This is what ensure_account_workspaces asks, and
    it must keep meaning "workspaces this person created" and nothing else."""
    fake = _FakeSupabase([_ws_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    result = repository.get_owned_workspaces("user-1")

    assert ("user_id", "user-1") in fake.sink["eq"]
    assert "or" not in fake.sink
    assert result[0].name == "Business"


def test_the_owned_read_hides_archived_workspaces(monkeypatch):
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.get_owned_workspaces("user-1")

    assert ("archived_at", "null") in fake.sink.get("is", [])


# --------------------------------------------------------- the wide read


def test_a_user_who_belongs_to_nothing_is_queried_as_before(monkeypatch):
    """Same regression guard as the task read: an account with no shared
    workspaces must produce the plain owner filter and no `or`."""
    fake = _FakeSupabase([_ws_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: [])

    repository.get_workspaces("user-1")

    assert ("user_id", "user-1") in fake.sink["eq"]
    assert "or" not in fake.sink


def test_a_member_sees_the_workspace_they_were_invited_to(monkeypatch):
    fake = _FakeSupabase([_ws_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: ["ws-1"])

    repository.get_workspaces("user-2")

    assert fake.sink["or"] == "user_id.eq.user-2,id.in.(ws-1)"


def test_the_wide_read_also_hides_archived(monkeypatch):
    """An archived workspace leaves the switcher for everybody, not only its
    owner."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: ["ws-1"])

    repository.get_workspaces("user-2")

    assert ("archived_at", "null") in fake.sink.get("is", [])


# ------------------------------------------------------------ categories


def test_categories_follow_the_workspaces_you_can_see(monkeypatch):
    """A member needs the category names of the room they are in, or every
    task in it shows as unfiled on their screen."""
    fake = _FakeSupabase([_cat_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_visible_workspace_ids", lambda u: ["ws-1", "ws-2"])

    repository.get_categories("user-2")

    assert ("workspace_id", ["ws-1", "ws-2"]) in fake.sink["in"]


def test_categories_are_empty_when_there_is_nothing_to_see(monkeypatch):
    """Returned without asking the database at all. An empty list reaching
    PostgREST as `workspace_id.in.()` is a syntax error, not an empty match."""
    fake = _FakeSupabase([_cat_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_visible_workspace_ids", lambda u: [])

    assert repository.get_categories("user-3") == []
    assert "table" not in fake.sink


# ------------------------------------------------ furnishing a new account


def test_a_colleague_invited_before_they_ever_log_in_still_gets_furnished(monkeypatch):
    """The bug this second read exists to prevent.

    Maria is invited to the owner's workspace and only then opens the app. If
    the furnishing check asked what she can SEE, it would find the owner's
    workspace, decide she is furnished, and leave her with no Business, no
    Personal, no default_workspace_id — every task she creates unfiled forever
    and the extractor with no vocabulary to offer her.
    """
    created = []
    monkeypatch.setattr(repository, "get_owned_workspaces", lambda u: [])
    monkeypatch.setattr(repository, "get_workspaces",
                        lambda u: ["the owner's workspace, which is not hers"])
    monkeypatch.setattr(repository, "create_workspace",
                        lambda u, w: created.append(w) or _Workspace(w))
    monkeypatch.setattr(repository, "update_app_settings", lambda u, **kw: None)

    svc = services.TaskService.__new__(services.TaskService)
    result = svc.ensure_account_workspaces("user-2")

    assert len(created) == 2, "Maria was left unfurnished"
    assert [w.name for w in created] == ["Business", "Personal"]
    assert len(result) == 2


def test_furnishing_still_does_nothing_for_somebody_who_has_their_own(monkeypatch):
    """Unchanged behaviour, and the more important half: it must never
    re-create a workspace the user deleted."""
    created = []
    monkeypatch.setattr(repository, "get_owned_workspaces", lambda u: ["mine"])
    monkeypatch.setattr(repository, "create_workspace",
                        lambda u, w: created.append(w))

    svc = services.TaskService.__new__(services.TaskService)
    result = svc.ensure_account_workspaces("user-1")

    assert created == []
    assert result == ["mine"]


class _Workspace:
    """Minimal stand-in for what create_workspace returns."""

    def __init__(self, w):
        self.name = w.name
        self.record_id = f"ws-{w.name.lower()}"


# ------------------------------------------------ creating gives you a row


def test_creating_a_workspace_makes_the_owner_a_member_of_it(monkeypatch):
    """Otherwise the owner is not in their own room, and every read that asks
    membership rather than ownership quietly leaves them out."""
    added = []
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([_ws_row()]))
    monkeypatch.setattr(repository, "add_workspace_member",
                        lambda w, u, role="member": added.append((w, u, role)))

    from models import Workspace
    repository.create_workspace("user-1", Workspace(name="Καθαριότητα"))

    assert added == [("ws-1", "user-1", "owner")]


def test_the_workspaces_endpoint_returns_what_you_can_SEE_not_what_you_own(monkeypatch):
    """Furnishing and listing ask different questions and the endpoint must not
    conflate them. ensure_account_workspaces returns OWNED workspaces, because
    that is what decides whether an account needs furnishing; returning its
    value to the client would hide every workspace a colleague was invited
    into — the whole feature, invisible, with every test still green."""
    import main

    from models import Workspace

    owned = Workspace(record_id="ws-own", name="Personal")
    shared = Workspace(record_id="ws-shared", name="Καθαριότητα")

    monkeypatch.setattr(main.service, "ensure_account_workspaces", lambda u: [owned])
    monkeypatch.setattr(main.repository, "get_workspaces", lambda u: [owned, shared])
    monkeypatch.setattr(main.repository, "get_categories", lambda u: [])

    result = main.list_workspaces(user_id="user-2")

    names = [w.name for w in result.workspaces]
    assert "Καθαριότητα" in names, "the invited workspace never reached the screen"
    assert len(result.workspaces) == 2
