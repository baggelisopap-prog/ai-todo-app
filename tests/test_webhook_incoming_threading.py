"""Appending a burst message to an open task, and re-classifying the thread."""
import main
from models import TaskRecord


def _task(**overrides):
    fields = dict(
        task_name="Hostaway: Κώστας - Arachova",
        description="Καλησπέρα.\n\nProperty: Arachova\nDates: ? → ?\n\nOriginal message: καλησπέρα σας",
        category="Hostaway",
        priority="P3",
        checklist=[],
        ai_suggested_category="Hostaway",
        ai_suggested_priority="P3",
        record_id="task-1",
        hostaway_conversation_id="47342748",
        hostaway_last_message_at="2026-08-10 14:00:00",
        hostaway_message_count=1,
        hostaway_thread="καλησπέρα σας",
    )
    fields.update(overrides)
    return TaskRecord(**fields)


def test_append_grows_the_thread_and_the_count(monkeypatch):
    written = {}
    monkeypatch.setattr(main.repository, "update_hostaway_thread_fields",
                        lambda u, r, updates: written.update(updates))

    main._append_to_hostaway_thread(
        "user-1", _task(), "δεν βρίσκω τα κλειδιά", "2026-08-10 14:00:40",
        {"summary": "Ο πελάτης δεν βρίσκει τα κλειδιά.", "priority": "P1"},
    )

    assert written["hostaway_thread"] == "καλησπέρα σας\n---\nδεν βρίσκω τα κλειδιά"
    assert written["hostaway_message_count"] == 2
    assert written["hostaway_last_message_at"] == "2026-08-10 14:00:40"


def test_append_escalates_the_priority_but_never_lowers_it(monkeypatch):
    written = {}
    monkeypatch.setattr(main.repository, "update_hostaway_thread_fields",
                        lambda u, r, updates: written.update(updates))

    main._append_to_hostaway_thread(
        "user-1", _task(priority="P1"), "και μια ερώτηση", "2026-08-10 14:00:40",
        {"summary": "Μια ερώτηση.", "priority": "P3"},
    )
    assert written["priority"] == "P1"


def test_append_resets_the_escalation_clock(monkeypatch):
    written = {}
    monkeypatch.setattr(main.repository, "update_hostaway_thread_fields",
                        lambda u, r, updates: written.update(updates))

    main._append_to_hostaway_thread(
        "user-1", _task(), "κάτι", "2026-08-10 14:00:40",
        {"summary": "Κάτι.", "priority": "P3"},
    )
    assert written["hostaway_last_notified_at"] is not None


def test_the_new_summary_replaces_the_old_one_in_the_description(monkeypatch):
    written = {}
    monkeypatch.setattr(main.repository, "update_hostaway_thread_fields",
                        lambda u, r, updates: written.update(updates))

    main._append_to_hostaway_thread(
        "user-1", _task(), "δεν βρίσκω τα κλειδιά", "2026-08-10 14:00:40",
        {"summary": "Ο πελάτης δεν βρίσκει τα κλειδιά.", "priority": "P1"},
    )
    assert written["description"].startswith("Ο πελάτης δεν βρίσκει τα κλειδιά.")
    # both messages survive in the description
    assert "καλησπέρα σας" in written["description"]
    assert "δεν βρίσκω τα κλειδιά" in written["description"]
