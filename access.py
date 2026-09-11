"""
The one place that answers "may this person write to this task".

Before 2026-09-11 there was no such place. The check was copy-pasted into each
query as `.eq("user_id", user_id)` — 19 of the 29 statements touching `tasks`
in repository.py — and services.update_task never asked at all: it called
repository.update_task(user_id, record_id, updates) and the filter rode along
inside. That works for exactly as long as "may I write" and "is it mine" are
the same question. Sharing separates them, and 19 scattered copies of a rule is
19 chances to miss one.

Today this answers "yes, if you can see it", with deleting reserved to the
workspace owner — the shape Trello and Todoist both settled on, where the
boundary is the container rather than the individual card. The tightening the
owner has already asked about ("βλέπει όλα, αλλάζει μόνο τα δικά του") is an
`if` inside can_write and nothing else in the codebase has to move. That is the
whole reason this exists as its own module rather than as a helper inside
services.

It deliberately sits BELOW both the UI path and the agent path, for the same
reason the calendar-switch item in BACKLOG.md gives: a rule that lives above
only one caller is a rule the other caller walks around.

Design: docs/superpowers/specs/2026-09-11-multi-user-workspace-sharing-design.md
"""
import logging
from typing import Optional

import repository
from repository import supabase

logger = logging.getLogger(__name__)


class TaskAccessDenied(Exception):
    """
    Raised by require_write / require_delete.

    Callers translate it into whatever their own layer speaks — main.py turns
    it into an HTTP 403. It is deliberately NOT an HTTPException: this module
    is imported by services and by the scheduler, neither of which is serving a
    request.
    """


def task_ownership(task_id: str) -> Optional[dict]:
    """
    The facts the gate decides from: who created the task, which workspace it
    is in, and who is responsible for it.

    DELIBERATELY UNSCOPED. This is the function that performs the scoping, so
    it has to be able to see a row in order to refuse it. A user-filtered read
    here would collapse "you may not touch this" into "there is no such task" —
    a different fact, and a worse error message for anyone trying to work out
    why a colleague cannot save.

    Four columns rather than `select *`: pulling the whole row would drag the
    checklist and the Hostaway thread across the wire on every single write.

    Returns None when there is no such task.
    """
    response = (
        supabase.table("tasks")
        .select("id, user_id, workspace_id, assigned_to")
        .eq("id", task_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0] if rows else None


def can_write(user_id: str, task_id: str) -> bool:
    """
    v1: you may write to what you can see — you created it, or you are a
    member of its workspace.

    THIS is where the owner's eventual tightening goes. Adding
    `and row.get("assigned_to") in (None, user_id)` to the membership branch
    turns this into "a member changes only what is assigned to them", with no
    migration and no other file touched, because tasks written under the loose
    rule stay valid under the strict one.
    """
    row = task_ownership(task_id)
    if row is None:
        return False

    if row.get("user_id") == user_id:
        return True

    workspace_id = row.get("workspace_id")
    if not workspace_id:
        # An unfiled task is in nobody's room, so membership grants nothing and
        # the creator is the only person left. Without this branch a None would
        # be tested against the id list and quietly decide a security question.
        return False

    return workspace_id in repository.get_member_workspace_ids(user_id)


def can_delete(user_id: str, task_id: str) -> bool:
    """
    Deleting is the owner's alone — the one irreversible act, kept with one
    person while everything else in the room is shared. It is one of the three
    things that make "a member may edit anything" honest, the others being the
    activity log and putting the team in its own workspace.

    An unfiled task has no workspace and therefore no workspace owner, so its
    creator decides; otherwise a personal task outside every workspace would
    become undeletable.
    """
    row = task_ownership(task_id)
    if row is None:
        return False

    workspace_id = row.get("workspace_id")
    if not workspace_id:
        return row.get("user_id") == user_id

    return repository.is_workspace_owner(user_id, workspace_id)


def require_write(user_id: str, task_id: str) -> dict:
    """
    Raises TaskAccessDenied instead of returning False, and returns the
    ownership row so the caller does not read it a second time.

    Two shapes on purpose: can_* for a screen deciding whether to grey out a
    button, require_* for a write path that must stop. A write path that calls
    can_* and forgets to check the result is exactly the mistake this pair
    exists to prevent.
    """
    row = task_ownership(task_id)
    if row is None or not can_write(user_id, task_id):
        logger.warning(f"[access] write refused: user {user_id} on task {task_id}")
        raise TaskAccessDenied(task_id)
    return row


def require_delete(user_id: str, task_id: str) -> dict:
    row = task_ownership(task_id)
    if row is None or not can_delete(user_id, task_id):
        logger.warning(f"[access] delete refused: user {user_id} on task {task_id}")
        raise TaskAccessDenied(task_id)
    return row
