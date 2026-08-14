"""
One user's failure must not cost every other user their tick.

The per-user loop in run_notification_scheduler had no exception guard at
all. That was survivable only for as long as nothing inside it raised —
and per-user Hostaway credentials put a raise in there: a user whose stored
secret cannot be decrypted (missing or rotated HOSTAWAY_ENCRYPTION_KEY)
took down reminders, the daily summary, escalations and calendar sync for
everyone processed after them, every two minutes, deterministically.
"""
import services
from models import AppSettings


def _settings():
    return AppSettings(notifications_enabled=True, send_all_enabled=False)


def _wire(monkeypatch, failing_user=None):
    """Two users; `failing_user`'s Hostaway reply check raises."""
    seen = {"escalations": [], "calendar": []}

    monkeypatch.setattr(services.repository, "get_all_active_user_ids",
                        lambda: ["user-1", "user-2"])
    monkeypatch.setattr(services.repository, "get_app_settings", lambda u: _settings())
    monkeypatch.setattr(services.repository, "get_tasks_due_for_notification",
                        lambda u, s, e, tasks=None, require_bell_enabled=False: [])
    monkeypatch.setattr(services, "sync_google_calendar_for_user",
                        lambda u: seen["calendar"].append(u) or {"status": "ok"})

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = services.repository
    monkeypatch.setattr(services.repository, "get_all_tasks", lambda u: [], raising=False)
    monkeypatch.setattr(svc, "_maybe_send_daily_summary",
                        lambda u, now, settings, tasks: False, raising=False)

    def _replies(user_id, user_tasks):
        if user_id == failing_user:
            raise RuntimeError("HOSTAWAY_ENCRYPTION_KEY is not set")
        return {"conversations_polled": 0, "replies_found": 0, "tasks_completed": 0}

    def _escalations(user_id, now, user_tasks):
        seen["escalations"].append(user_id)
        return {"checked": 0, "escalations_sent": 0}

    monkeypatch.setattr(svc, "_check_hostaway_replies", _replies, raising=False)
    monkeypatch.setattr(svc, "_check_hostaway_escalations", _escalations, raising=False)
    return svc, seen


def test_both_users_are_processed_when_nothing_fails(monkeypatch):
    """The baseline the isolation test is measured against."""
    svc, seen = _wire(monkeypatch)

    result = svc.run_notification_scheduler()

    assert result["users_processed"] == 2
    assert seen["calendar"] == ["user-1", "user-2"]


def test_one_users_failure_does_not_stop_the_next_user(monkeypatch):
    svc, seen = _wire(monkeypatch, failing_user="user-1")

    result = svc.run_notification_scheduler()

    assert seen["calendar"] == ["user-2"], "user-2 lost their whole tick to user-1"
    assert result["users_processed"] == 2


def test_the_failing_user_is_reported_rather_than_silently_dropped(monkeypatch):
    """A swallowed exception that leaves no trace is its own bug."""
    svc, _ = _wire(monkeypatch, failing_user="user-1")

    result = svc.run_notification_scheduler()

    failed = [r for r in result["results"] if r["user_id"] == "user-1"]
    assert len(failed) == 1
    assert failed[0]["status"] == "error"
    assert "HOSTAWAY_ENCRYPTION_KEY" in failed[0]["error"]
