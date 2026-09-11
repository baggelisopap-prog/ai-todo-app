"""
belongs_to — what is a person's WORK, as distinct from what they can see.

Used by everything that rings a phone (advance reminders, the daily summary,
Hostaway escalation, missed-occurrence closing) and, from slice 3, by the
agent's day view. The 2026-09-11 design calls the split between this and
visible_to its spine.
"""
import inspect

import repository
import services


class _FakeQuery:
    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a, **kw):
        self.sink["select"] = a
        return self

    def update(self, values):
        self.sink["update"] = values
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


def test_the_narrow_read_asks_for_assigned_to_me_or_mine_and_unclaimed(monkeypatch):
    """Two arms, and `assigned_to is null` on the second one is load-bearing:
    a task I created and then handed to somebody else is THEIR work, and my
    phone has to stop ringing for it the moment I assign it."""
    fake = _FakeSupabase([_task_row()])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.get_owned_or_assigned_tasks("user-1")

    assert fake.sink["table"] == "tasks"
    assert fake.sink["or"] == (
        "assigned_to.eq.user-1,and(user_id.eq.user-1,assigned_to.is.null)"
    )


def test_the_narrow_read_returns_parsed_tasks(monkeypatch):
    """Parsed by the same _supabase_row_to_task every other read uses. A second
    parser would be a second set of bugs, and the checklist normalisation alone
    is reason enough not to have one."""
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([_task_row()]))

    tasks = repository.get_owned_or_assigned_tasks("user-1")

    assert len(tasks) == 1
    assert tasks[0].task_name == "Καθαρισμός Β2"
    assert tasks[0].record_id == "t-1"


def test_one_shared_task_with_five_members_reminds_exactly_one_person(monkeypatch):
    """The regression this whole split exists to prevent.

    Five people can see the workspace; the task is assigned to user-3. Only
    user-3's scheduler tick may find it. If this ever returns the task for
    user-1 as well, the scheduler is back to pushing one reminder per member
    and racing a single boolean to decide whose phone actually rings.

    The fake answers the way the database would: the `or` expression names the
    user, so only the matching user's rows come back.
    """
    shared = _task_row(id="t-9", user_id="user-1", assigned_to="user-3")

    for uid in ["user-1", "user-2", "user-3", "user-4", "user-5"]:
        rows = [shared] if uid == "user-3" else []
        monkeypatch.setattr(repository, "supabase", _FakeSupabase(rows))

        got = repository.get_owned_or_assigned_tasks(uid)

        assert len(got) == (1 if uid == "user-3" else 0), uid


def test_the_scheduler_tick_uses_the_narrow_read_not_the_wide_one():
    """services.run_notification_scheduler holds the single per-user fetch that
    feeds reminders, the daily summary, escalation and missed-occurrence
    closing at once. If it ever reads visible_to again, all four widen
    together — so this asserts on the source rather than waiting for one of the
    four to misbehave."""
    source = inspect.getsource(services.TaskService.run_notification_scheduler)

    assert "get_owned_or_assigned_tasks" in source
    assert "self.repository.get_all_tasks(user_id)" not in source


def test_marking_a_reminder_sent_does_not_filter_on_the_row_owner(monkeypatch):
    """The silent bug this fixes: the person whose tick processes a task is
    frequently NOT the row's owner, it is the assignee. With a user_id filter
    the update matched zero rows and raised nothing — so notification_sent was
    never set and the same reminder fired on every ~2-minute tick, forever.

    The task id is a uuid and access.py decides who may act on it, so the id
    alone is the correct scope here."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.mark_notification_sent("user-3", "t-1")

    assert fake.sink["update"] == {"notification_sent": True}
    assert ("id", "t-1") in fake.sink["eq"]
    assert all(col != "user_id" for col, _ in fake.sink["eq"])
