"""
A guest message that is ringing your phone is on your Today, and tapping the
ring opens it.

WHY THIS FILE EXISTS. On 2026-10-10 the owner was reminded, every two hours,
about a task he could not find: a guest asking for an invoice at check-out. He
had approved it and moved its date to the check-out day, 18/10 — so it was not
in the Inbox and not on Today, and the escalation went on ringing for it because
nobody had answered the guest. The push did not even say which task it was
about, so tapping it opened the app wherever.

Same lesson as tests/test_deleted_tasks_stay_quiet.py, from the other side:
there the alarm rang for a task the screen had rightly dropped; here the screen
dropped a task the alarm was rightly ringing for. Both happened because the two
asked different questions. So the screen now asks the alarm's question —
repository.get_hostaway_tasks_awaiting_reply is what the escalation loop
iterates over AND what GET /tasks reports as `awaiting_reply_ids`.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

import main
import repository
import services
from models import Category, TaskRecord

ATHENS = ZoneInfo("Europe/Athens")
ME = "user-me"
COLLEAGUE = "user-colleague"

_HOSTAWAY_CAT = Category(record_id="cat-h", workspace_id="ws-1",
                         name="Hostaway", system_key="hostaway")


def _guest_task(**overrides):
    base = dict(
        record_id="guest-1", task_name="Hostaway: GEORGIOS - Arachova",
        description="", category="Hostaway", priority="P3",
        ai_suggested_category="Hostaway", ai_suggested_priority="P3",
        approval_status=True, category_id="cat-h", workspace_id="ws-1",
        created_by=ME, due_date="2026-10-18",
        hostaway_last_notified_at="2026-10-10T15:25:13.759196+03:00",
    )
    base.update(overrides)
    return TaskRecord(**base)


# --- the one definition -------------------------------------------------------

@pytest.fixture
def hostaway_category(monkeypatch):
    monkeypatch.setattr(repository, "get_system_category", lambda u, k: _HOSTAWAY_CAT)


def test_an_unanswered_guest_message_is_awaiting_a_reply(hostaway_category):
    """The owner's task, as it stood on 2026-10-10."""
    found = repository.get_hostaway_tasks_awaiting_reply(ME, tasks=[_guest_task()])
    assert [t.record_id for t in found] == ["guest-1"]


def test_an_answered_one_is_not(hostaway_category):
    answered = _guest_task(hostaway_answered_at="2026-10-10 16:00:00")
    assert repository.get_hostaway_tasks_awaiting_reply(ME, tasks=[answered]) == []


def test_one_with_no_ring_stamp_is_not(hostaway_category):
    """The escalation loop skips a task with no hostaway_last_notified_at, so it
    never rings — and must not be reported as ringing."""
    unstamped = _guest_task(hostaway_last_notified_at=None)
    assert repository.get_hostaway_tasks_awaiting_reply(ME, tasks=[unstamped]) == []


def test_one_with_an_unreadable_stamp_is_not(hostaway_category):
    """Same: the loop cannot measure an interval from it, so it never rings."""
    garbled = _guest_task(hostaway_last_notified_at="not a date")
    assert repository.get_hostaway_tasks_awaiting_reply(ME, tasks=[garbled]) == []


def test_a_finished_or_deleted_one_is_not(hostaway_category):
    done = _guest_task(record_id="done", is_completed=True)
    deleted = _guest_task(record_id="gone", deleted_at="2026-10-10T12:00:00+03:00")
    assert repository.get_hostaway_tasks_awaiting_reply(ME, tasks=[done, deleted]) == []


def test_an_ordinary_task_is_not(hostaway_category):
    ordinary = _guest_task(record_id="plain", category_id="cat-other")
    assert repository.get_hostaway_tasks_awaiting_reply(ME, tasks=[ordinary]) == []


# --- the alarm reads it -------------------------------------------------------

def _escalation_service(monkeypatch, awaiting):
    sent = []
    monkeypatch.setattr(services.repository, "get_hostaway_tasks_awaiting_reply",
                        lambda u, tasks=None: awaiting)
    monkeypatch.setattr(services.repository, "update_hostaway_last_notified", lambda *a: None)
    svc = services.TaskService.__new__(services.TaskService)
    monkeypatch.setattr(svc, "send_push_to_user", lambda u, **kw: sent.append(kw) or {"sent": 1},
                        raising=False)
    return svc, sent


def test_the_escalation_rings_for_exactly_what_the_screen_is_told(monkeypatch):
    """If the loop kept a private filter of its own, the two could drift again.
    It iterates over the shared definition and nothing else."""
    long_ago = (datetime.now(ATHENS) - timedelta(hours=9)).isoformat()
    task = _guest_task(hostaway_last_notified_at=long_ago)
    svc, sent = _escalation_service(monkeypatch, [task])

    result = svc._check_hostaway_escalations(ME, datetime.now(ATHENS), [])

    assert result["escalations_sent"] == 1


def test_the_escalation_push_names_its_task(monkeypatch):
    """So that tapping it can open that task — the push used to carry a title
    and a body and nothing that said which task it was."""
    long_ago = (datetime.now(ATHENS) - timedelta(hours=9)).isoformat()
    svc, sent = _escalation_service(monkeypatch, [_guest_task(hostaway_last_notified_at=long_ago)])

    svc._check_hostaway_escalations(ME, datetime.now(ATHENS), [])

    assert sent[0]["task_id"] == "guest-1"


def test_the_payload_carries_the_task_id(monkeypatch):
    """send_push_to_user puts it where the service worker reads it."""
    payloads = []

    class _Sub:
        endpoint, p256dh, auth = "https://push.example/1", "k", "a"

    monkeypatch.setattr(services.repository, "list_push_subscriptions", lambda u: [_Sub()])
    monkeypatch.setattr(services, "_get_vapid_key_file", lambda: "key.pem")
    monkeypatch.setattr(services, "webpush", lambda **kw: payloads.append(kw["data"]))
    svc = services.TaskService.__new__(services.TaskService)

    svc.send_push_to_user(ME, title="t", body="b", view="today", task_id="guest-1")

    import json
    assert json.loads(payloads[0]) == {"title": "t", "body": "b", "view": "today", "task_id": "guest-1"}


def test_a_push_about_no_task_carries_no_task_id(monkeypatch):
    """The daily summary is about a day, not a task."""
    payloads = []

    class _Sub:
        endpoint, p256dh, auth = "https://push.example/1", "k", "a"

    monkeypatch.setattr(services.repository, "list_push_subscriptions", lambda u: [_Sub()])
    monkeypatch.setattr(services, "_get_vapid_key_file", lambda: "key.pem")
    monkeypatch.setattr(services, "webpush", lambda **kw: payloads.append(kw["data"]))
    svc = services.TaskService.__new__(services.TaskService)

    svc.send_push_to_user(ME, title="t", body="b", view="today")

    import json
    assert "task_id" not in json.loads(payloads[0])


def test_the_fifteen_minute_reminder_names_its_task(monkeypatch):
    now = datetime.now(ATHENS)
    soon = now + timedelta(minutes=10)
    task = TaskRecord(record_id="timed-1", task_name="Ραντεβού", description="",
                      category="Business", priority="P2", ai_suggested_category="Business",
                      ai_suggested_priority="P2", approval_status=True, notify_enabled=True,
                      due_date=soon.strftime("%Y-%m-%d"), due_time=soon.strftime("%H:%M"))

    class _Settings:
        notifications_enabled = True
        send_all_enabled = True

    monkeypatch.setattr(services.repository, "get_all_active_user_ids", lambda: [ME])
    monkeypatch.setattr(services.repository, "get_app_settings", lambda u: _Settings())
    monkeypatch.setattr(services.repository, "get_recurrence_rules", lambda u: [])
    monkeypatch.setattr(services.repository, "get_owned_or_assigned_tasks", lambda u: [task])
    monkeypatch.setattr(services.repository, "mark_notification_sent", lambda *a: None)
    monkeypatch.setattr(services, "sync_google_calendar_for_user", lambda u: {})
    svc = services.TaskService.__new__(services.TaskService)
    sent = []
    monkeypatch.setattr(svc, "send_push_to_user", lambda u, **kw: sent.append(kw) or {"sent": 1},
                        raising=False)
    monkeypatch.setattr(svc, "close_missed_occurrences", lambda *a: 0, raising=False)
    monkeypatch.setattr(svc, "_maybe_send_daily_summary", lambda *a: False, raising=False)
    monkeypatch.setattr(svc, "_check_hostaway_replies",
                        lambda *a: {"conversations_polled": 0, "replies_found": 0, "tasks_completed": 0},
                        raising=False)
    monkeypatch.setattr(svc, "_check_hostaway_escalations",
                        lambda *a: {"checked": 0, "escalations_sent": 0}, raising=False)

    svc.run_notification_scheduler()

    assert [kw.get("task_id") for kw in sent] == ["timed-1"]


# --- the screen is told -------------------------------------------------------

@pytest.fixture
def client():
    main.app.dependency_overrides[main.get_current_user_id] = lambda: ME
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def test_the_task_list_says_which_tasks_are_awaiting_a_reply(client, monkeypatch):
    monkeypatch.setattr(main.service, "get_all_tasks", lambda u: [
        _guest_task(),
        _guest_task(record_id="plain", category_id="cat-other", hostaway_last_notified_at=None),
    ])
    monkeypatch.setattr(main.repository, "get_system_category", lambda u, k: _HOSTAWAY_CAT)

    r = client.get("/tasks")

    assert r.status_code == 200
    assert r.json()["awaiting_reply_ids"] == ["guest-1"]


def test_only_what_rings_MY_phone(client, monkeypatch):
    """The scheduler rings for the tasks that are a person's work — assigned to
    them, or theirs and taken by nobody. A guest task handed to a colleague
    rings the colleague, so it is not awaiting MY reply, even though I can see
    it in our shared room."""
    monkeypatch.setattr(main.service, "get_all_tasks", lambda u: [
        _guest_task(record_id="mine"),
        _guest_task(record_id="handed-over", assigned_to=COLLEAGUE),
    ])
    monkeypatch.setattr(main.repository, "get_system_category", lambda u, k: _HOSTAWAY_CAT)

    r = client.get("/tasks")

    assert r.json()["awaiting_reply_ids"] == ["mine"]


def test_a_list_with_nothing_ringing_costs_no_extra_query(client, monkeypatch):
    """GET /tasks runs every minute on every open screen. A list with no
    guest message in it must not pay for the category lookup."""
    def _must_not_be_called(*a):
        raise AssertionError("looked up the Hostaway category for a list with nothing ringing")

    monkeypatch.setattr(main.service, "get_all_tasks", lambda u: [
        _guest_task(record_id="plain", category_id="cat-other", hostaway_last_notified_at=None),
    ])
    monkeypatch.setattr(main.repository, "get_system_category", _must_not_be_called)

    r = client.get("/tasks")

    assert r.status_code == 200
    assert r.json()["awaiting_reply_ids"] == []


def test_a_failure_to_work_it_out_never_costs_the_task_list(client, monkeypatch):
    """The list is the app. The group on Today is a convenience on top of it."""
    def _boom(*a):
        raise RuntimeError("database hiccup")

    monkeypatch.setattr(main.service, "get_all_tasks", lambda u: [_guest_task()])
    monkeypatch.setattr(main.repository, "get_system_category", _boom)

    r = client.get("/tasks")

    assert r.status_code == 200
    assert len(r.json()["tasks"]) == 1
    assert r.json()["awaiting_reply_ids"] == []
