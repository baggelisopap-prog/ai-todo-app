"""The five new Hostaway threading columns must survive a row -> TaskRecord read."""
from repository import _get_shared_tasks_repo

repo = _get_shared_tasks_repo()


def _row(**overrides):
    """A minimal Supabase row; ai_suggested_* are required by _supabase_row_to_task."""
    row = {
        "id": "11111111-1111-1111-1111-111111111111",
        "task_name": "Hostaway: Κώστας - Arachova",
        "description": "δεν βρίσκω τα κλειδιά",
        "category": "Hostaway",
        "priority": "P1",
        "checklist": [],
        "ai_suggested_category": "Hostaway",
        "ai_suggested_priority": "P1",
    }
    row.update(overrides)
    return row


def test_threading_columns_are_read_from_the_row():
    task = repo._supabase_row_to_task(_row(
        hostaway_conversation_id="47342748",
        hostaway_last_message_at="2026-08-10 14:00:40",
        hostaway_message_count=3,
        hostaway_answered_at="2026-08-10 14:30:00",
        hostaway_thread="καλησπέρα σας\n---\nδεν βρίσκω τα κλειδιά",
    ))
    assert task.hostaway_conversation_id == "47342748"
    assert task.hostaway_last_message_at == "2026-08-10 14:00:40"
    assert task.hostaway_message_count == 3
    assert task.hostaway_answered_at == "2026-08-10 14:30:00"
    assert task.hostaway_thread == "καλησπέρα σας\n---\nδεν βρίσκω τα κλειδιά"


def test_a_non_hostaway_row_defaults_cleanly():
    """Every existing task has these columns null — that must not raise."""
    task = repo._supabase_row_to_task(_row(category="Personal"))
    assert task.hostaway_conversation_id is None
    assert task.hostaway_message_count == 0
    assert task.hostaway_thread is None
