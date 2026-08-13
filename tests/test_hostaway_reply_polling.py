"""
The scheduler learns about a human reply, because the webhook never will.

Every message fixture below is REAL — captured 2026-08-12 from
GET /v1/conversations/{id}/messages on the owner's account. Conversation
49166048 is the one that exposed the bug (a human reply at 07:51 that the
app never saw); 44234683 is the one that would have been closed wrongly by
the naive version of this check.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import hostaway_threading as ht
import services
from models import TaskRecord

# ── conversation 49166048, exactly as Hostaway returns it (newest first) ──
GUEST_MESSAGE_AT = "2026-08-12 07:42:29"
HUMAN_REPLY_AT = "2026-08-12 07:51:05"

CONV_49166048 = [
    {"date": HUMAN_REPLY_AT, "isIncoming": 0, "userId": 1074746,
     "communicationId": None, "communicationEvent": None,
     "body": "Good morning Marion! I'm Constantine nice to meet you!"},
    {"date": "2026-08-12 07:42:45", "isIncoming": 0, "userId": None,
     "communicationId": 368747, "communicationEvent": "messageReceived",
     "body": "Hello Marion! We received your message and will reply shortly"},
    {"date": GUEST_MESSAGE_AT, "isIncoming": 1, "userId": None,
     "communicationId": None, "communicationEvent": None,
     "body": "Bonjour Nikolaos, Notre date de départ arrive."},
    {"date": "2026-08-09 13:00:00", "isIncoming": 0, "userId": None,
     "communicationId": 347608, "communicationEvent": "arrival",
     "body": "Dear Marion Lievre, Your stay at Livadi Hideaway Chalet"},
]

# ── conversation 44234683: the newest human reply is from YESTERDAY ──
CONV_44234683 = [
    {"date": "2026-08-12 06:23:24", "isIncoming": 1, "userId": None,
     "communicationId": None, "communicationEvent": None,
     "body": "Good morning. Thank you for your kind reply. Hot water works"},
    {"date": "2026-08-11 17:21:19", "isIncoming": 0, "userId": 990952,
     "communicationId": None, "communicationEvent": None,
     "body": "Hi there! I'm so sorry to hear you're having trouble"},
]


# ─────────────────────────── the decision ───────────────────────────

def test_the_real_reply_is_found():
    assert ht.find_unanswered_human_reply(CONV_49166048, GUEST_MESSAGE_AT) == HUMAN_REPLY_AT


def test_the_auto_reply_16_seconds_later_is_not_an_answer():
    """It fires after EVERY guest message. Counting it closes everything."""
    only_robots = [m for m in CONV_49166048 if m["userId"] is None]
    assert ht.find_unanswered_human_reply(only_robots, GUEST_MESSAGE_AT) is None


def test_a_reply_from_before_the_guests_message_is_not_an_answer():
    """
    THE trap this function exists for. Conversation 44234683: the guest
    wrote at 06:23 today, the newest human reply is 17:21 yesterday. It
    answered the PREVIOUS question, and a brand-new task must survive it.
    """
    assert ht.find_unanswered_human_reply(CONV_44234683, "2026-08-12 06:23:24") is None


def test_a_reply_already_recorded_is_not_found_again():
    """An answered P1 stays open — so this runs against it every 2 minutes."""
    assert ht.find_unanswered_human_reply(
        CONV_49166048, GUEST_MESSAGE_AT, task_answered_at=HUMAN_REPLY_AT
    ) is None


def test_a_second_reply_after_a_recorded_one_is_found():
    later = "2026-08-12 09:30:00"
    messages = [{"date": later, "isIncoming": 0, "userId": 1074746}] + CONV_49166048
    assert ht.find_unanswered_human_reply(
        messages, GUEST_MESSAGE_AT, task_answered_at=HUMAN_REPLY_AT
    ) == later


def test_the_newest_reply_wins_regardless_of_api_order():
    """The order was observed, never promised. Don't lean on it."""
    shuffled = list(reversed(CONV_49166048))
    assert ht.find_unanswered_human_reply(shuffled, GUEST_MESSAGE_AT) == HUMAN_REPLY_AT


def test_a_task_with_no_guest_message_date_does_nothing():
    """Nothing to measure 'after' against — so never close anything."""
    assert ht.find_unanswered_human_reply(CONV_49166048, None) is None


def test_an_unparseable_date_does_not_crash():
    assert ht.find_unanswered_human_reply(
        [{"date": "yesterday-ish", "isIncoming": 0, "userId": 1074746}], GUEST_MESSAGE_AT
    ) is None


# ─────────────────────────── the wiring ───────────────────────────

def _task(record_id="task-1", priority="P3", last_message_at=GUEST_MESSAGE_AT,
          answered_at=None, conversation_id="49166048"):
    return TaskRecord(
        task_name="Hostaway: Marion Lievre - Livadi Hideaway Chalet",
        description="départ", category="Hostaway", priority=priority, checklist=[],
        ai_suggested_category="Hostaway", ai_suggested_priority=priority,
        record_id=record_id,
        hostaway_conversation_id=conversation_id,
        hostaway_last_message_at=last_message_at,
        hostaway_answered_at=answered_at,
        hostaway_last_notified_at=(
            datetime.now(ZoneInfo("Europe/Athens")) - timedelta(hours=9)
        ).isoformat(),
    )


def _run(monkeypatch, open_tasks, messages=None):
    calls = {"updates": [], "pushes": [], "fetched": []}
    conversation = CONV_49166048 if messages is None else messages

    monkeypatch.setattr(services.repository, "get_active_hostaway_tasks",
                        lambda u, tasks=None: list(open_tasks))
    monkeypatch.setattr(services.repository, "update_hostaway_thread_fields",
                        lambda u, r, updates: calls["updates"].append((r, updates)))

    def _fetch(conversation_id):
        calls["fetched"].append(conversation_id)
        return conversation

    monkeypatch.setattr(services.hostaway_integration, "get_conversation_messages", _fetch)

    svc = services.TaskService.__new__(services.TaskService)
    monkeypatch.setattr(svc, "send_push_to_user",
                        lambda u, **kw: calls["pushes"].append(kw), raising=False)

    result = svc._check_hostaway_replies("user-1", open_tasks)
    return calls, result, svc


def test_a_human_reply_completes_a_p3_task(monkeypatch):
    task = _task(priority="P3")
    calls, result, _ = _run(monkeypatch, [task])

    record_id, updates = calls["updates"][0]
    assert record_id == "task-1"
    assert updates["is_completed"] is True
    assert updates["hostaway_answered_at"] == HUMAN_REPLY_AT
    assert result["tasks_completed"] == 1


def test_the_poller_names_itself_as_the_source(monkeypatch):
    """
    So "it closed by itself" is answerable from the row. This was the FIRST
    thing that had to be ruled out when a task closed unexplained, and it
    took reasoning about which dict keys are written together to do it.
    """
    calls, _, _ = _run(monkeypatch, [_task(priority="P3")])

    _, updates = calls["updates"][0]
    assert updates["completed_source"] == "hostaway_reply"
    assert updates["completed_at"] is not None


def test_a_task_left_open_is_not_stamped_as_completed(monkeypatch):
    """A P1 records the reply, but it was not completed and must not say so."""
    calls, _, _ = _run(monkeypatch, [_task(priority="P1")])

    _, updates = calls["updates"][0]
    assert "completed_source" not in updates
    assert "completed_at" not in updates


def test_a_human_reply_does_not_complete_a_p1_task(monkeypatch):
    """Replying is not fixing. Stop nagging, stay on the list."""
    calls, result, _ = _run(monkeypatch, [_task(priority="P1")])

    _, updates = calls["updates"][0]
    assert "is_completed" not in updates
    assert updates["hostaway_answered_at"] == HUMAN_REPLY_AT
    assert result["tasks_completed"] == 0


def test_a_human_reply_does_not_complete_a_p2_task_yet(monkeypatch):
    """
    The staged rollout: P3 only until auto-completion has been watched
    working. A P2 records the reply and stops nagging, but stays on the
    list. Flipping this is one entry in HOSTAWAY_REPLY_AUTOCOMPLETE_PRIORITIES.
    """
    calls, result, _ = _run(monkeypatch, [_task(priority="P2")])

    _, updates = calls["updates"][0]
    assert "is_completed" not in updates
    assert updates["hostaway_answered_at"] == HUMAN_REPLY_AT
    assert result["tasks_completed"] == 0


def test_adding_p2_to_the_set_is_the_only_change_needed(monkeypatch):
    """The staged rollout has to be one edit, or it will not be made."""
    monkeypatch.setattr(services, "HOSTAWAY_REPLY_AUTOCOMPLETE_PRIORITIES", {"P2", "P3"})
    calls, result, _ = _run(monkeypatch, [_task(priority="P2")])

    _, updates = calls["updates"][0]
    assert updates["is_completed"] is True
    assert result["tasks_completed"] == 1


def test_p1_never_auto_completes_even_if_someone_adds_it(monkeypatch):
    """
    A guard on the documented decision, not on the code path: if a future
    edit puts P1 in the set, this test says out loud that "I'm coming in 20
    minutes" is an answer and not a fix, and that the design said no.
    """
    assert "P1" not in services.HOSTAWAY_REPLY_AUTOCOMPLETE_PRIORITIES


def test_the_answered_task_does_not_also_escalate_this_tick(monkeypatch):
    """
    The reply check writes the row; the escalation check reads the list. If
    the in-memory record is not updated too, the same tick that discovers
    the answer also sends "Ακόμα δεν έχει απαντηθεί".
    """
    task = _task(priority="P1")
    calls, _, svc = _run(monkeypatch, [task])
    assert task.hostaway_answered_at == HUMAN_REPLY_AT

    monkeypatch.setattr(services.repository, "update_hostaway_last_notified", lambda *a: None)
    escalations = svc._check_hostaway_escalations(
        "user-1", datetime.now(ZoneInfo("Europe/Athens")), [task]
    )
    assert escalations["escalations_sent"] == 0
    assert calls["pushes"] == []


def test_two_open_tasks_are_reported_and_neither_is_completed(monkeypatch):
    """One reply cannot be attributed to one of two tasks — so ask."""
    tasks = [_task("task-1", priority="P3"), _task("task-2", priority="P3")]
    calls, result, _ = _run(monkeypatch, tasks)

    assert len(calls["pushes"]) == 1
    assert result["replies_found"] == 2
    assert result["tasks_completed"] == 0
    assert all("is_completed" not in u for _, u in calls["updates"])
    # ...but both are recorded, so the notice does not repeat every 2 minutes.
    assert all(u["hostaway_answered_at"] == HUMAN_REPLY_AT for _, u in calls["updates"])


def test_two_tasks_in_one_conversation_cost_one_api_call(monkeypatch):
    tasks = [_task("task-1"), _task("task-2")]
    calls, result, _ = _run(monkeypatch, tasks)
    assert calls["fetched"] == ["49166048"]
    assert result["conversations_polled"] == 1


def test_a_conversation_with_no_new_reply_writes_nothing(monkeypatch):
    task = _task(last_message_at="2026-08-12 06:23:24", conversation_id="44234683")
    calls, result, _ = _run(monkeypatch, [task], messages=CONV_44234683)

    assert calls["updates"] == []
    assert calls["pushes"] == []
    assert result["replies_found"] == 0


def test_a_task_with_no_conversation_id_is_not_polled(monkeypatch):
    task = _task(conversation_id=None)
    calls, result, _ = _run(monkeypatch, [task])

    assert calls["fetched"] == []
    assert result["conversations_polled"] == 0


def test_an_api_failure_leaves_everything_alone(monkeypatch):
    """get_conversation_messages returns [] on failure. Fail toward 'open'."""
    calls, result, _ = _run(monkeypatch, [_task()], messages=[])

    assert calls["updates"] == []
    assert result["replies_found"] == 0
    assert result["conversations_polled"] == 1
