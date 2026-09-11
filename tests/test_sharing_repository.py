"""
The repository layer for invites, activity and membership removal.

Two things here are unlike the rest of repository.py and both are deliberate:
the invite lookup is UNSCOPED (it is the thing that decides who the caller is
allowed to become), and the activity log keeps a copy of the task's name so it
stays readable after the task is gone.
"""
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

    def update(self, values):
        self.sink["update"] = values
        return self

    def delete(self):
        self.sink["delete"] = True
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

    def order(self, col, **kw):
        self.sink.setdefault("orders", []).append((col, kw))
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


def _invite_row(**overrides):
    base = {"id": "inv-1", "workspace_id": "ws-1", "invited_by": "user-1",
            "token_hash": "hhh", "email": None, "role": "member",
            "expires_at": "2026-09-18T00:00:00Z", "accepted_at": None,
            "accepted_by": None, "revoked_at": None,
            "created_at": "2026-09-11T00:00:00Z"}
    base.update(overrides)
    return base


# ------------------------------------------------------------------ invites


def test_creating_an_invite_stores_the_hash_and_never_the_token(monkeypatch):
    """The single most important assertion in this file. The raw token is a
    bearer credential — whoever holds it gets in — so a database dump must not
    be a working set of keys. Same standard as the Hostaway client secret."""
    fake = _FakeSupabase([_invite_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.create_workspace_invite(
        workspace_id="ws-1", invited_by="user-1", token_hash="hhh",
        role="member", expires_at="2026-09-18T00:00:00Z",
    )

    assert fake.sink["table"] == "workspace_invites"
    assert fake.sink["insert"]["token_hash"] == "hhh"
    assert "token" not in fake.sink["insert"]


def test_looking_an_invite_up_by_hash_is_UNSCOPED(monkeypatch):
    """Deliberately unfiltered by user, exactly like access.task_ownership and
    for the same reason: this lookup is what DECIDES who the caller may become.
    The person accepting is by definition not yet a member of anything."""
    fake = _FakeSupabase([_invite_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.get_invite_by_token_hash("hhh")

    assert fake.sink["eq"] == [("token_hash", "hhh")]


def test_a_hash_that_matches_nothing_reads_as_None(monkeypatch):
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([]))

    assert repository.get_invite_by_token_hash("nope") is None


def test_accepting_stamps_who_accepted_and_when(monkeypatch):
    fake = _FakeSupabase([_invite_row(accepted_by="user-2")])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.mark_invite_accepted("inv-1", "user-2", "2026-09-11T10:00:00Z")

    assert fake.sink["update"]["accepted_by"] == "user-2"
    assert fake.sink["update"]["accepted_at"] == "2026-09-11T10:00:00Z"
    assert ("id", "inv-1") in fake.sink["eq"]


def test_revoking_stamps_revoked_at_and_leaves_the_row(monkeypatch):
    """The row survives. A withdrawn invitation is a fact worth keeping — it is
    what the activity log points at — and deleting it would also free the
    token_hash for a collision that can never otherwise happen."""
    fake = _FakeSupabase([_invite_row(revoked_at="2026-09-11T11:00:00Z")])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.revoke_workspace_invite("inv-1", "2026-09-11T11:00:00Z")

    assert fake.sink["update"] == {"revoked_at": "2026-09-11T11:00:00Z"}
    assert "delete" not in fake.sink


def test_listing_invites_is_scoped_to_the_workspace(monkeypatch):
    fake = _FakeSupabase([_invite_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    invites = repository.get_workspace_invites("ws-1")

    assert ("workspace_id", "ws-1") in fake.sink["eq"]
    assert invites[0]["id"] == "inv-1"


def test_listing_invites_never_returns_a_token_hash(monkeypatch):
    """The hash is useless to an attacker who cannot reverse it, but it has no
    business on a screen either, and a field that reaches the API is a field
    somebody will eventually log."""
    fake = _FakeSupabase([_invite_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    invites = repository.get_workspace_invites("ws-1")

    assert "token_hash" not in invites[0]


# --------------------------------------------------------------- membership


def test_removing_a_member_deletes_exactly_one_pair(monkeypatch):
    """Both filters. A workspace_id alone would empty the room; a user_id alone
    would remove that person from every workspace they are in."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.remove_workspace_member("ws-1", "user-2")

    assert fake.sink["delete"] is True
    assert ("workspace_id", "ws-1") in fake.sink["eq"]
    assert ("user_id", "user-2") in fake.sink["eq"]


def test_unassigning_touches_only_that_persons_tasks_in_that_workspace(monkeypatch):
    """Removing somebody from the cleaning team must not unassign their work in
    the office. Both filters, always."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.unassign_tasks_for_member("ws-1", "user-2")

    assert fake.sink["table"] == "tasks"
    assert fake.sink["update"] == {"assigned_to": None}
    assert ("workspace_id", "ws-1") in fake.sink["eq"]
    assert ("assigned_to", "user-2") in fake.sink["eq"]


def test_setting_notify_all_is_scoped_to_one_membership(monkeypatch):
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.set_member_notify_all("ws-1", "user-1", True)

    assert fake.sink["update"] == {"notify_all": True}
    assert ("workspace_id", "ws-1") in fake.sink["eq"]
    assert ("user_id", "user-1") in fake.sink["eq"]


# ---------------------------------------------------------------- archiving


def test_archiving_stamps_the_workspace_and_is_owner_scoped(monkeypatch):
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.set_workspace_archived("user-1", "ws-1", "2026-09-11T12:00:00Z")

    assert fake.sink["table"] == "workspaces"
    assert fake.sink["update"] == {"archived_at": "2026-09-11T12:00:00Z"}
    assert ("id", "ws-1") in fake.sink["eq"]
    assert ("user_id", "user-1") in fake.sink["eq"]


def test_restoring_a_workspace_clears_the_stamp(monkeypatch):
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.set_workspace_archived("user-1", "ws-1", None)

    assert fake.sink["update"] == {"archived_at": None}


def test_repointing_settings_clears_the_workspace_for_EVERY_member(monkeypatch):
    """Not just the owner. active_workspace_id and default_workspace_id are
    per-user, so archiving must reach each member's row — otherwise a colleague
    is looking at a workspace that is not there, and the extractor is handed an
    archived workspace's category vocabulary."""
    calls = []

    class _Recording(_FakeSupabase):
        def table(self, name):
            self.sink = {}
            calls.append(self.sink)
            self.sink["table"] = name
            return _FakeQuery(self.sink, self.rows)

    fake = _Recording([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.clear_workspace_from_all_settings("ws-1", fallback_default="ws-business")

    active = [c for c in calls if c.get("update", {}).get("active_workspace_id", 1) is None]
    default = [c for c in calls
               if c.get("update", {}).get("default_workspace_id") == "ws-business"]

    assert active, "nothing cleared active_workspace_id"
    assert default, "nothing repointed default_workspace_id"
    for c in active + default:
        assert c["table"] == "app_settings"


# ----------------------------------------------------------------- activity


def test_the_activity_log_keeps_a_copy_of_the_task_name(monkeypatch):
    """A deliberate duplicate. With task_id alone, deleting a task turns its
    whole history into "somebody did something to something"."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.log_workspace_activity(
        workspace_id="ws-1", actor_user_id="user-2", action="task_completed",
        task_id="t-1", task_name="Καθαρισμός Β2", details={"from": False},
    )

    assert fake.sink["table"] == "workspace_activity"
    assert fake.sink["insert"]["task_name"] == "Καθαρισμός Β2"
    assert fake.sink["insert"]["action"] == "task_completed"
    assert fake.sink["insert"]["actor_user_id"] == "user-2"


def test_activity_can_be_recorded_without_a_task(monkeypatch):
    """member_joined and invite_revoked are about the room, not about a task.
    A NOT NULL on task_id would have made those unrecordable."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.log_workspace_activity(
        workspace_id="ws-1", actor_user_id="user-2", action="member_joined",
    )

    assert fake.sink["insert"]["task_id"] is None
    assert fake.sink["insert"]["task_name"] is None


def test_logging_activity_never_raises(monkeypatch):
    """The log is a record of work, not a participant in it. If writing it
    fails, the thing the user asked for has already happened and must not be
    reported as a failure because the diary could not be updated."""
    class _Exploding:
        def table(self, name):
            raise RuntimeError("supabase is having a day")

    monkeypatch.setattr(repository, "supabase", _Exploding())

    repository.log_workspace_activity(
        workspace_id="ws-1", actor_user_id="user-2", action="task_completed",
        task_id="t-1", task_name="Χ",
    )


def test_reading_activity_is_newest_first_and_capped(monkeypatch):
    fake = _FakeSupabase([{"id": "a-1", "action": "task_completed"}])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.get_workspace_activity("ws-1", limit=50)

    assert ("workspace_id", "ws-1") in fake.sink["eq"]
    assert fake.sink["orders"][0][0] == "created_at"
    assert fake.sink["orders"][0][1].get("desc") is True
    assert fake.sink["limit"] == 50
