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
        self._negated = False

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

    def is_(self, col, val):
        # get_workspaces excludes archived rows since 2026-09-11.
        if self._negated:
            self._negated = False
            self.sink.setdefault("not_is", []).append((col, val))
        else:
            self.sink.setdefault("is", []).append((col, val))
        return self

    @property
    def not_(self):
        # postgrest spells negation as a property that flips the NEXT operator:
        # `.not_.is_("archived_at", "null")`. Recording it as its own slot is
        # what lets a test tell "archived" from "not archived", which is the
        # difference between a restore list and every live workspace.
        self._negated = True
        return self

    def in_(self, col, vals):
        self.sink.setdefault("in", []).append((col, list(vals)))
        return self

    def or_(self, expr):
        self.sink["or"] = expr
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
    """Still the plain owner filter for somebody who belongs to nothing —
    widening the read for members must not change what a solo account sees.
    The member case lives in test_workspace_visibility.py."""
    fake = _FakeSupabase([_ws_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: [])
    # Stubbed so the sink still describes the WORKSPACES query. The fake keeps
    # one shared sink and `table` is its only single-assignment slot, so the
    # member-count query that follows would otherwise be the one it remembers.
    monkeypatch.setattr(repository, "get_member_counts", lambda ids: {})

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

    # Creating a workspace now also inserts the owner's membership row, so the
    # owner is present in the table that answers "who may SEE this".
    monkeypatch.setattr(repository, "add_workspace_member",
                        lambda w, u, role="member": None)

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


def test_listing_categories_follows_the_workspaces_you_can_see(monkeypatch):
    """CORRECTED 2026-09-11. This test used to assert the opposite — that
    categories are scoped by `user_id`, "NOT by workspace" — and that was right
    while a workspace had exactly one person in it.

    It stopped being right when a member could be invited into somebody else's
    workspace: those category rows carry the OWNER's user_id, so filtering on
    it would show a colleague every task in that workspace as unfiled. Still
    one call for the whole set, which was the real point of the old note."""
    fake = _FakeSupabase([_cat_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_visible_workspace_ids", lambda u: ["ws-1"])

    result = repository.get_categories("user-1")

    assert fake.sink["table"] == "categories"
    assert ("workspace_id", ["ws-1"]) in fake.sink["in"]
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


def test_a_missing_categories_TABLE_also_returns_None(monkeypatch):
    """Deploy order must not be able to lose a guest message. If the code ships
    before the migration runs, the table does not exist and the query raises —
    which on the Hostaway webhook path would mean no task at all. It degrades to
    unfiled instead, which is recoverable."""
    class _Exploding:
        def table(self, name):
            raise RuntimeError("Could not find the table 'public.categories'")

    monkeypatch.setattr(repository, "supabase", _Exploding())

    assert repository.get_system_category("user-1", "hostaway") is None


# The exact set of `tasks` columns that _task_to_supabase_fields is allowed to
# produce. user_id and calendar_origin are added by save_task afterwards; every
# other real column is server-generated and never in a model_dump.
TASK_COLUMNS = {
    "task_name", "description", "category", "priority", "due_date", "due_time",
    "checklist", "approval_status", "is_completed", "is_rejected",
    "notify_enabled", "notification_sent", "calendar_sync_enabled",
    "ai_suggested_category", "ai_suggested_priority",
    "hostaway_created_at", "hostaway_last_notified_at", "hostaway_conversation_id",
    "hostaway_last_message_at", "hostaway_message_count", "hostaway_answered_at",
    "hostaway_thread",
    "recurrence_rule_id", "occurrence_date", "missed_at", "cancelled_at",
    "deleted_at",
    "workspace_id", "category_id",
    # Multi-user (2026-09-11). A real column, added by
    # docs/migrations/2026-09-11-multi-user-sharing.sql — so it belongs here
    # rather than in the pop() list, and the migration MUST be applied before
    # this code is deployed or every insert is rejected wholesale (PGRST204),
    # which is the exact failure this guard exists to catch.
    "assigned_to",
    # Handover (2026-09-17). Real columns, added by
    # docs/migrations/2026-09-17-completion-handover.sql. Listed here rather
    # than popped because a new task legitimately carries both — nobody closed
    # it and nobody has acknowledged that — and because being listed here is
    # what makes this guard refuse to pass until the migration exists.
    "completed_at", "completed_source", "completed_by", "completion_seen_by",
}


def test_the_write_path_sends_only_real_columns():
    """
    The guard that was missing when `category_name` was added to SingleTask.

    TaskRecord inherits every SingleTask field, and _task_to_supabase_fields is
    built from model_dump(), so a new model field silently becomes a new column
    in the INSERT. Supabase rejects the WHOLE insert for one unknown key
    (PGRST204) — which took down manual creation, all three AI extraction paths
    and the Hostaway webhook simultaneously, on a change whose unit tests all
    passed because none of them touch the real schema.

    If this fails, either the field belongs in TASK_COLUMNS and the migration
    adding it should be in docs/migrations/, or it is model-only and belongs in
    the pop() list beside record_id.
    """
    from models import TaskRecord

    fields = _task_repo._task_to_supabase_fields(TaskRecord(
        task_name="Χ", description="", category="Business", priority="P2",
        ai_suggested_category="Business", ai_suggested_priority="P2",
    ))

    assert set(fields) == TASK_COLUMNS, (
        f"unexpected: {set(fields) - TASK_COLUMNS} / missing: {TASK_COLUMNS - set(fields)}"
    )


def test_the_models_answer_never_reaches_the_database():
    """category_name is what the MODEL says; category_id is the column."""
    from models import TaskRecord

    fields = _task_repo._task_to_supabase_fields(TaskRecord(
        task_name="Χ", description="", category="Business", priority="P2",
        ai_suggested_category="Business", ai_suggested_priority="P2",
        category_name="crypto", category_id="c1",
    ))

    assert "category_name" not in fields
    assert fields["category_id"] == "c1"


def test_member_counts_are_grouped_per_workspace(monkeypatch):
    """Three membership rows across two workspaces must come back as two
    numbers, not three rows — this is what tells a screen which room is
    shared."""
    fake = _FakeSupabase([
        {"workspace_id": "ws-1"},
        {"workspace_id": "ws-1"},
        {"workspace_id": "ws-2"},
    ])
    monkeypatch.setattr(repository, "supabase", fake)

    assert repository.get_member_counts(["ws-1", "ws-2"]) == {"ws-1": 2, "ws-2": 1}
    assert fake.sink["table"] == "workspace_members"


def test_member_counts_of_nothing_issues_no_query(monkeypatch):
    """An empty list must not reach PostgREST as `workspace_id.in.()`, which is
    a syntax error rather than an empty match — the same trap get_all_tasks and
    get_workspaces both guard."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    assert repository.get_member_counts([]) == {}
    assert fake.sink == {}


def test_listing_workspaces_carries_how_many_people_are_in_each(monkeypatch):
    """The number the screen uses to decide whether anything about other people
    is drawn at all."""
    fake = _FakeSupabase([_ws_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: [])
    monkeypatch.setattr(repository, "get_member_counts", lambda ids: {"ws-1": 3})

    assert repository.get_workspaces("user-1")[0].member_count == 3


def test_a_workspace_with_no_membership_row_still_reads_as_one_person(monkeypatch):
    """Cannot happen — create_workspace adds the owner's row and the migration
    backfilled the rest — but 0 would read as a room with nobody in it and hide
    the owner's own name from their own screen."""
    fake = _FakeSupabase([_ws_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: [])
    monkeypatch.setattr(repository, "get_member_counts", lambda ids: {})

    assert repository.get_workspaces("user-1")[0].member_count == 1


def test_the_archived_read_asks_for_rows_that_ARE_archived(monkeypatch):
    """The mirror image of get_workspaces, which filters archived_at to null.
    Getting this backwards would list every live workspace under a heading that
    says "Archived" and offer to restore rooms nobody archived."""
    fake = _FakeSupabase([_ws_row(archived_at="2026-09-11T12:00:00Z")])
    monkeypatch.setattr(repository, "supabase", fake)

    result = repository.get_archived_workspaces("user-1")

    assert fake.sink["table"] == "workspaces"
    assert ("user_id", "user-1") in fake.sink["eq"]
    assert ("archived_at", "null") in fake.sink.get("not_is", [])
    assert fake.sink["orders"][0] == ("archived_at", {"desc": True})
    assert result[0].archived_at == "2026-09-11T12:00:00Z"


def test_the_archived_read_is_owned_and_not_merely_visible(monkeypatch):
    """Restoring is the owner's alone (sharing._require_owner), so a member
    listed here would be offered a room they cannot bring back."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids",
                        lambda u: (_ for _ in ()).throw(AssertionError("must not ask membership")))

    repository.get_archived_workspaces("user-1")

    assert "or" not in fake.sink


def test_a_live_workspace_reads_as_not_archived(monkeypatch):
    """archived_at is surfaced now; every live read filters it to null, so it
    must come back as None rather than as a missing attribute."""
    fake = _FakeSupabase([_ws_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: [])
    monkeypatch.setattr(repository, "get_member_counts", lambda ids: {})

    assert repository.get_workspaces("user-1")[0].archived_at is None
