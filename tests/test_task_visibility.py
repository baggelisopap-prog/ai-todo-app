"""
visible_to — what a person may SEE. Screens, search, the API.

The companion read, belongs_to, lives in test_task_ownership_reads.py and is
what anything that rings a phone must use instead. Splitting the two is the
spine of the 2026-09-11 design: one function fed both machines, and widening it
without splitting it pushes one reminder per member — then races a single
boolean to decide whose phone actually rings.
"""
import repository


class _FakeQuery:
    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a, **kw):
        self.sink["select"] = a
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def or_(self, expr):
        self.sink["or"] = expr
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows):
        self.rows, self.sink = rows, {}

    def table(self, name):
        self.sink["table"] = name
        return _FakeQuery(self.sink, self.rows)


def _task_row(**overrides):
    base = {"id": "t-1", "user_id": "user-1", "task_name": "Καθαρισμός Β2",
            "description": "", "category": "Business", "priority": "P3",
            "ai_suggested_category": "Business", "ai_suggested_priority": "P3",
            "checklist": [], "approval_status": True, "is_completed": False,
            "is_rejected": False, "assigned_to": None}
    base.update(overrides)
    return base


def test_a_user_who_belongs_to_nothing_is_queried_EXACTLY_as_before(monkeypatch):
    """The regression guard for this whole slice.

    An account with no shared workspaces must produce the same query it
    produced yesterday — a plain user_id filter and NO `or` — because that is
    the only evidence that the owner's live app is untouched by this change.
    """
    fake = _FakeSupabase([_task_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: [])

    result = repository.AirtableTaskRepository().get_all_tasks("user-1")

    assert fake.sink["table"] == "tasks"
    assert ("user_id", "user-1") in fake.sink["eq"]
    assert "or" not in fake.sink
    assert len(result) == 1


def test_a_member_gets_an_or_filter_over_their_workspaces(monkeypatch):
    fake = _FakeSupabase([_task_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids",
                        lambda u: ["ws-1", "ws-2"])

    repository.AirtableTaskRepository().get_all_tasks("user-2")

    assert fake.sink["or"] == "user_id.eq.user-2,workspace_id.in.(ws-1,ws-2)"
    assert "eq" not in fake.sink


def test_the_or_filter_keeps_the_tasks_the_user_wrote_themselves(monkeypatch):
    """Both arms matter. Without the user_id arm, an unfiled task — one with no
    workspace at all — would vanish from its own author's list the moment they
    joined somebody else's workspace."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: ["ws-1"])

    repository.AirtableTaskRepository().get_all_tasks("user-2")

    assert fake.sink["or"].startswith("user_id.eq.user-2,")


def test_an_empty_workspace_list_never_reaches_the_in_filter(monkeypatch):
    """`workspace_id.in.()` is a PostgREST syntax error, not an empty match,
    and a malformed filter on this table fails open more often than it fails
    closed — which here means another user's tasks."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: [])

    repository.AirtableTaskRepository().get_all_tasks("user-1")

    assert "in.()" not in str(fake.sink.get("or", ""))


def test_the_module_level_read_still_delegates(monkeypatch):
    """agent_engine.py imports repository directly and calls this rather than
    holding a repository instance. Its signature and its behaviour must not
    move."""
    fake = _FakeSupabase([_task_row()])
    monkeypatch.setattr(repository, "supabase", fake)
    monkeypatch.setattr(repository, "get_member_workspace_ids", lambda u: [])

    tasks = repository.get_tasks_for_user("user-1")

    assert len(tasks) == 1
    assert tasks[0].task_name == "Καθαρισμός Β2"
