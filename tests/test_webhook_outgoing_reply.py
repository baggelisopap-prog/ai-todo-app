"""An outgoing message closes a task only when a human wrote it."""
import hostaway_threading as ht
import main
from models import TaskRecord


def _task(record_id="task-1", priority="P3"):
    return TaskRecord(
        task_name="Hostaway: Κώστας - Arachova",
        description="δεν βρίσκω τα κλειδιά",
        category="Hostaway", priority=priority, checklist=[],
        ai_suggested_category="Hostaway", ai_suggested_priority=priority,
        record_id=record_id, hostaway_conversation_id="47342748",
    )


def _wire(monkeypatch, open_tasks):
    calls = {"updates": [], "pushes": []}
    monkeypatch.setattr(main.repository, "get_open_tasks_for_conversation",
                        lambda u, c: open_tasks)
    monkeypatch.setattr(main.repository, "update_hostaway_thread_fields",
                        lambda u, r, updates: calls["updates"].append((r, updates)))
    monkeypatch.setattr(main.service, "send_push_to_user",
                        lambda u, **kw: calls["pushes"].append(kw))
    return calls


def test_the_auto_reply_changes_nothing(monkeypatch):
    """THE trap: 'we received your message and will reply shortly'."""
    calls = _wire(monkeypatch, [_task()])
    result = main._handle_outgoing_hostaway_message("user-1", {
        "isIncoming": 0, "userId": None, "communicationId": 368747,
        "communicationEvent": "messageReceived", "conversationId": 47342748,
    })
    assert result["status"] == "ignored"
    assert calls["updates"] == []


def test_a_guestarrive_message_changes_nothing(monkeypatch):
    calls = _wire(monkeypatch, [_task()])
    main._handle_outgoing_hostaway_message("user-1", {
        "isIncoming": 0, "userId": None, "communicationId": None,
        "conversationId": 47342748,
    })
    assert calls["updates"] == []


def test_a_human_reply_completes_a_p3_task(monkeypatch):
    calls = _wire(monkeypatch, [_task(priority="P3")])
    main._handle_outgoing_hostaway_message("user-1", {
        "isIncoming": 0, "userId": 990952, "conversationId": 47342748,
    })
    record_id, updates = calls["updates"][0]
    assert record_id == "task-1"
    assert updates["is_completed"] is True


def test_a_human_reply_does_NOT_complete_a_p1_task(monkeypatch):
    """Replying is not fixing. The P1 stops nagging and stays open."""
    calls = _wire(monkeypatch, [_task(priority="P1")])
    main._handle_outgoing_hostaway_message("user-1", {
        "isIncoming": 0, "userId": 990952, "conversationId": 47342748,
    })
    _, updates = calls["updates"][0]
    assert "is_completed" not in updates
    assert updates["hostaway_answered_at"] is not None


def test_the_reply_is_recorded_with_hostaways_date(monkeypatch):
    """
    One column, one format. The scheduler's reply check parses this field to
    tell "already recorded" from "new reply"; a server clock read is
    unparseable to it and an answered P1 would look unanswered forever.
    """
    calls = _wire(monkeypatch, [_task(priority="P1")])
    main._handle_outgoing_hostaway_message("user-1", {
        "isIncoming": 0, "userId": 990952, "conversationId": 47342748,
        "date": "2026-08-12 07:51:05",
    })
    _, updates = calls["updates"][0]
    assert updates["hostaway_answered_at"] == "2026-08-12 07:51:05"
    assert ht.parse_hostaway_datetime(updates["hostaway_answered_at"]) is not None


def test_two_open_tasks_are_left_alone_and_reported(monkeypatch):
    """One reply cannot be attributed to one of two tasks — so ask."""
    calls = _wire(monkeypatch, [_task("task-1"), _task("task-2")])
    result = main._handle_outgoing_hostaway_message("user-1", {
        "isIncoming": 0, "userId": 990952, "conversationId": 47342748,
    })
    assert calls["updates"] == []
    assert len(calls["pushes"]) == 1
    assert result["status"] == "ambiguous"


def test_a_reply_with_no_open_task_is_harmless(monkeypatch):
    calls = _wire(monkeypatch, [])
    result = main._handle_outgoing_hostaway_message("user-1", {
        "isIncoming": 0, "userId": 990952, "conversationId": 47342748,
    })
    assert calls["updates"] == []
    assert result["status"] == "ok"
