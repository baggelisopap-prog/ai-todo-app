"""An answered P1 stays on the list but stops nagging."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import services
from models import TaskRecord


def _task(answered_at=None):
    long_ago = (datetime.now(ZoneInfo("Europe/Athens")) - timedelta(hours=9)).isoformat()
    return TaskRecord(
        task_name="Hostaway: Κώστας - Arachova",
        description="δεν βρίσκω τα κλειδιά",
        category="Hostaway", priority="P1", checklist=[],
        ai_suggested_category="Hostaway", ai_suggested_priority="P1",
        record_id="task-1",
        hostaway_last_notified_at=long_ago,
        hostaway_answered_at=answered_at,
    )


def _run(monkeypatch, task):
    sent = []
    monkeypatch.setattr(services.repository, "get_active_hostaway_tasks", lambda u, tasks=None: [task])
    monkeypatch.setattr(services.repository, "update_hostaway_last_notified", lambda *a: None)
    svc = services.TaskService.__new__(services.TaskService)
    monkeypatch.setattr(svc, "send_push_to_user", lambda u, **kw: sent.append(kw), raising=False)
    result = svc._check_hostaway_escalations("user-1", datetime.now(ZoneInfo("Europe/Athens")), [])
    return sent, result


def test_an_unanswered_p1_still_escalates(monkeypatch):
    sent, result = _run(monkeypatch, _task(answered_at=None))
    assert result["escalations_sent"] == 1
    assert len(sent) == 1


def test_an_answered_p1_does_not_escalate(monkeypatch):
    sent, result = _run(monkeypatch, _task(answered_at="2026-08-10 14:30:00"))
    assert result["escalations_sent"] == 0
    assert sent == []
