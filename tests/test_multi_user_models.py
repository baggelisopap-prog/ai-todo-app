"""
The models multi-user adds.

Nothing here talks to a database — these tests exist so the DEFAULTS are
pinned. A default that drifts is how a task quietly acquires an assignee
nobody chose, or how a shared workspace becomes noisy on the day it is
created.
"""
from models import TaskRecord, Workspace, WorkspaceMember


def _task(**overrides):
    base = dict(
        task_name="Καθαρισμός Β2",
        description="",
        category="Business",
        priority="P3",
        ai_suggested_category="Business",
        ai_suggested_priority="P3",
    )
    base.update(overrides)
    return TaskRecord(**base)


def test_a_new_task_has_nobody_responsible_for_it():
    """NULL is not "unset", it is a real state: in a shared workspace it means
    the work exists and nobody has taken it. get_owned_or_assigned_tasks reads
    it that way — an unclaimed task is in its creator's day view and nobody
    else's."""
    assert _task().assigned_to is None


def test_a_task_can_carry_an_assignee():
    assert _task(assigned_to="user-2").assigned_to == "user-2"


def test_assigned_to_is_separate_from_who_wrote_the_task():
    """user_id is not on TaskRecord at all — ownership is a data-layer concern
    and the repository never surfaces it. So assigned_to is the ONLY person
    this model knows about, and it deliberately answers a different question
    from the column it sits beside in the database."""
    assert not hasattr(_task(assigned_to="user-2"), "user_id")


def test_a_workspace_is_live_until_it_is_archived():
    assert Workspace(name="Business").archived_at is None


def test_a_workspace_can_be_archived():
    w = Workspace(name="Καθαριότητα", archived_at="2026-09-11T10:00:00Z")

    assert w.archived_at == "2026-09-11T10:00:00Z"


def test_a_member_defaults_to_member_and_to_silence():
    """notify_all defaults to false: the owner who wants the team's
    notifications has to ask for them. A switch that is on by default would
    make every shared workspace noisy on day one."""
    m = WorkspaceMember(workspace_id="ws-1", user_id="user-2")

    assert m.role == "member"
    assert m.notify_all is False


def test_the_owners_membership_row_says_owner():
    m = WorkspaceMember(workspace_id="ws-1", user_id="user-1", role="owner")

    assert m.role == "owner"


def test_a_membership_needs_both_halves_of_the_pair():
    """Neither side has a default. A membership row with a workspace and no
    person, or a person and no workspace, is not a partial record — it is a
    meaningless one."""
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        WorkspaceMember(workspace_id="ws-1")

    with pytest.raises(ValidationError):
        WorkspaceMember(user_id="user-2")
