"""
The handover must survive the trip back from the database.

This file exists because it did not. From the day assignment shipped
(2026-09-11) until the same evening, `_supabase_row_to_task` simply had no
`assigned_to=` line: services.update_task hands its `updates` dict straight to
the column, so every handover was WRITTEN correctly, and every read dropped it.
The picker showed "Χωρίς υπεύθυνο" again the moment a task was reloaded, while
the database held the right person and the reminder loop was using it.

A silent one-way failure: nothing raised, nothing logged, and the only way to
see it was to assign a task and come back later.
"""
from repository import _get_shared_tasks_repo

repo = _get_shared_tasks_repo()


def _row(**overrides):
    row = {
        "id": "11111111-1111-1111-1111-111111111111",
        "user_id": "user-1",
        "task_name": "Καθαρισμός Arachova",
        "description": "",
        "category": "Business",
        "priority": "P2",
        "checklist": [],
        "ai_suggested_category": "Business",
        "ai_suggested_priority": "P2",
    }
    row.update(overrides)
    return row


def test_the_assignee_survives_the_read():
    task = repo._supabase_row_to_task(_row(assigned_to="user-2"))
    assert task.assigned_to == "user-2"


def test_nobody_taking_it_reads_as_nobody_and_not_as_missing():
    """NULL is a real state — "on the pile" — and not an unset field."""
    task = repo._supabase_row_to_task(_row(assigned_to=None))
    assert task.assigned_to is None


def test_the_creator_comes_back_under_a_readable_name():
    """A shared list narrowed to "mine" has to mean what the reminder loop
    means: assigned to me, OR created by me and taken by nobody. The screen can
    only answer the second half if it knows who created the row."""
    task = repo._supabase_row_to_task(_row(user_id="user-7"))
    assert task.created_by == "user-7"


def test_created_by_is_never_written_back():
    """There is NO created_by column. Supabase rejects the whole statement for
    one unknown key (PGRST204) — the way `category_name` took down all four
    task-creation paths at once on 2026-09-01 — so this leaking into a write
    would break every task write in the app, not only assignment."""
    task = repo._supabase_row_to_task(_row(user_id="user-7", assigned_to="user-2"))

    fields = repo._task_to_supabase_fields(task)

    assert "created_by" not in fields
    # The handover itself still travels: it IS a column.
    assert fields["assigned_to"] == "user-2"
