"""
Generation, idempotency, and the two things a rule edit must never destroy.

The scheduler runs every ~2 minutes, so "running it twice changes nothing"
is not a nicety here — it is the correctness property.
"""
from datetime import date

import services
from models import RecurrenceRule, TaskRecord


def _rule(**overrides):
    base = dict(record_id="rule-1", task_name="Χάπι", category="Personal", priority="P2",
                due_time="09:00", freq="weekly", weekdays=[1, 2, 3, 4, 5],
                starts_on="2026-08-17", notify_enabled=True)
    base.update(overrides)
    return RecurrenceRule(**base)


def _wire(monkeypatch, existing_dates=None, open_occurrences=None):
    """A TaskService whose repository is entirely fake. Records every write."""
    seen = {"created": [], "deleted": [], "missed": [], "rule_updates": []}

    monkeypatch.setattr(services.repository, "get_occurrence_dates",
                        lambda u, r, f, t: set(existing_dates or []))
    monkeypatch.setattr(services.repository, "get_open_occurrences",
                        lambda u, r: list(open_occurrences or []))
    monkeypatch.setattr(services.repository, "delete_tasks_by_ids",
                        lambda u, ids: seen["deleted"].extend(ids) or len(ids))
    monkeypatch.setattr(services.repository, "mark_task_missed",
                        lambda u, rid, at: seen["missed"].append(rid))
    monkeypatch.setattr(services.repository, "update_recurrence_rule",
                        lambda u, rid, updates: seen["rule_updates"].append(updates))

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = services.repository
    monkeypatch.setattr(svc, "create_task_manual",
                        lambda user_id, fields, approval_status=True:
                            seen["created"].append(fields) or fields,
                        raising=False)
    return svc, seen


def test_a_fortnight_of_weekdays_is_created(monkeypatch):
    svc, seen = _wire(monkeypatch)

    created = svc.materialize_recurrence_rule("user-1", _rule(), date(2026, 8, 17))

    dates = [f["occurrence_date"] for f in seen["created"]]
    # 2026-08-17 is a Monday and the window is inclusive at both ends, so
    # 2026-08-31 — also a Monday — is the eleventh.
    assert created == 11
    assert dates[0] == "2026-08-17"
    assert dates[-1] == "2026-08-31"
    assert "2026-08-22" not in dates, "Saturday"
    assert "2026-08-23" not in dates, "Sunday"


def test_an_occurrence_carries_the_template_and_is_pre_approved(monkeypatch):
    """Five Inbox items a week to approve would make the feature unusable."""
    svc, seen = _wire(monkeypatch)

    svc.materialize_recurrence_rule("user-1", _rule(), date(2026, 8, 17))

    first = seen["created"][0]
    assert first["task_name"] == "Χάπι"
    assert first["category"] == "Personal"
    assert first["priority"] == "P2"
    assert first["due_time"] == "09:00"
    assert first["due_date"] == "2026-08-17"
    assert first["occurrence_date"] == "2026-08-17"
    assert first["recurrence_rule_id"] == "rule-1"
    assert first["notify_enabled"] is True
    assert first["approval_status"] is True


def test_running_it_twice_creates_nothing_the_second_time(monkeypatch):
    """The scheduler runs every two minutes. This is the correctness property."""
    already = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21",
               "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28",
               "2026-08-31"]
    svc, seen = _wire(monkeypatch, existing_dates=already)

    created = svc.materialize_recurrence_rule("user-1", _rule(), date(2026, 8, 17))

    assert created == 0
    assert seen["created"] == []


def test_a_rescheduled_occurrence_is_not_regenerated(monkeypatch):
    """
    Drag Monday's task to Tuesday: due_date moves, occurrence_date does not.
    Keyed on due_date this would recreate Monday on the very next tick.
    """
    svc, seen = _wire(monkeypatch, existing_dates=["2026-08-17"])

    svc.materialize_recurrence_rule("user-1", _rule(), date(2026, 8, 17))

    assert "2026-08-17" not in [f["occurrence_date"] for f in seen["created"]]


def test_an_inactive_or_unapproved_rule_produces_nothing(monkeypatch):
    svc, seen = _wire(monkeypatch)

    assert svc.materialize_recurrence_rule("user-1", _rule(is_active=False), date(2026, 8, 17)) == 0
    assert svc.materialize_recurrence_rule(
        "user-1", _rule(approval_status=False), date(2026, 8, 17)) == 0
    assert seen["created"] == []


def test_materialized_through_is_recorded_so_the_tick_can_skip(monkeypatch):
    svc, seen = _wire(monkeypatch)

    svc.materialize_recurrence_rule("user-1", _rule(), date(2026, 8, 17))

    assert seen["rule_updates"] == [{"materialized_through": "2026-08-31"}]


def test_a_rule_already_materialized_far_enough_does_no_work(monkeypatch):
    svc, seen = _wire(monkeypatch)

    created = svc.materialize_recurrence_rule(
        "user-1", _rule(materialized_through="2026-08-31"), date(2026, 8, 17))

    assert created == 0
    assert seen["rule_updates"] == []


def test_the_short_circuit_compares_against_the_window_end_not_the_start(monkeypatch):
    """
    Pins the direction of the services.py comparison: it must be
    already_through >= window_end, not window_start. On 2026-09-01 the
    window is 09-01..09-15; a rule materialized through 09-10 sits INSIDE
    that window -- not yet through the end of it. The correct comparison
    (>= window_end) says "not done yet" and keeps generating out to 09-15.
    A version that compared against window_start instead would see 09-10 >=
    09-01 and call the rule already materialised, producing nothing and
    never advancing materialized_through -- which is exactly how the horizon
    freezes and shrinks a day at a time until the feature silently stops
    producing after about two weeks, with no error, no log, and a green
    suite throughout.
    """
    svc, seen = _wire(monkeypatch)

    created = svc.materialize_recurrence_rule(
        "user-1", _rule(materialized_through="2026-09-10"), date(2026, 9, 1))

    assert created > 0
    assert seen["rule_updates"] == [{"materialized_through": "2026-09-15"}]


# --- regeneration -----------------------------------------------------------

def test_regeneration_drops_open_future_occurrences_only(monkeypatch):
    svc, seen = _wire(monkeypatch, open_occurrences=[
        {"id": "past", "occurrence_date": "2026-08-14", "due_date": "2026-08-14"},
        {"id": "today", "occurrence_date": "2026-08-17", "due_date": "2026-08-17"},
        {"id": "future", "occurrence_date": "2026-08-18", "due_date": "2026-08-18"},
    ])

    svc.regenerate_recurrence_rule(
        "user-1", _rule(materialized_through="2026-08-31"), date(2026, 8, 17))

    assert seen["deleted"] == ["future"], "today's may already be half-done or have rung"
    assert seen["rule_updates"][0] == {"materialized_through": None}, \
        "the horizon must be cleared before recomputing, or an edited rule " \
        "short-circuits out of regenerating for up to 14 days"


def test_regeneration_spares_an_occurrence_the_user_moved_by_hand(monkeypatch):
    """Deliberately shifting next Tuesday must survive a change to the rule."""
    svc, seen = _wire(monkeypatch, open_occurrences=[
        {"id": "moved", "occurrence_date": "2026-08-18", "due_date": "2026-08-20"},
        {"id": "untouched", "occurrence_date": "2026-08-19", "due_date": "2026-08-19"},
    ])

    svc.regenerate_recurrence_rule("user-1", _rule(), date(2026, 8, 17))

    assert seen["deleted"] == ["untouched"]


# --- missed closure ---------------------------------------------------------

def _occurrence(record_id, occurrence_date, **overrides):
    base = dict(task_name="Χάπι", description="", category="Personal", priority="P3",
                ai_suggested_category="Personal", ai_suggested_priority="P3",
                approval_status=True, record_id=record_id,
                recurrence_rule_id="rule-1", occurrence_date=occurrence_date)
    base.update(overrides)
    return TaskRecord(**base)


def test_an_occurrence_past_its_grace_is_closed(monkeypatch):
    svc, seen = _wire(monkeypatch)
    tasks = [_occurrence("t-mon", "2026-08-17")]

    closed = svc.close_missed_occurrences(
        "user-1", tasks, date(2026, 8, 19), {"rule-1": _rule()})

    assert closed == 1
    assert seen["missed"] == ["t-mon"]


def test_yesterdays_occurrence_is_left_alone(monkeypatch):
    svc, seen = _wire(monkeypatch)
    tasks = [_occurrence("t-mon", "2026-08-17")]

    closed = svc.close_missed_occurrences(
        "user-1", tasks, date(2026, 8, 18), {"rule-1": _rule()})

    assert closed == 0
    assert seen["missed"] == []


def test_completed_rejected_and_already_missed_ones_are_skipped(monkeypatch):
    svc, seen = _wire(monkeypatch)
    tasks = [
        _occurrence("done", "2026-08-17", is_completed=True),
        _occurrence("rejected", "2026-08-17", is_rejected=True),
        _occurrence("already", "2026-08-17", missed_at="2026-08-19T06:00:00+03:00"),
    ]

    assert svc.close_missed_occurrences(
        "user-1", tasks, date(2026, 8, 25), {"rule-1": _rule()}) == 0
    assert seen["missed"] == []


def test_an_ordinary_task_is_never_auto_closed(monkeypatch):
    """Only recurrence occurrences forget themselves. Everything else is the user's."""
    svc, seen = _wire(monkeypatch)
    ordinary = TaskRecord(task_name="πληρωμή", description="", category="Business",
                          priority="P1", ai_suggested_category="Business",
                          ai_suggested_priority="P1", approval_status=True,
                          record_id="plain", due_date="2020-01-01")

    assert svc.close_missed_occurrences("user-1", [ordinary], date(2026, 8, 25), {}) == 0
    assert seen["missed"] == []


def test_an_orphaned_occurrence_whose_rule_is_gone_is_left_alone(monkeypatch):
    """ON DELETE SET NULL turns it into an ordinary task, and ordinary tasks stay."""
    svc, seen = _wire(monkeypatch)
    orphan = _occurrence("orphan", "2026-08-17", recurrence_rule_id=None)

    assert svc.close_missed_occurrences("user-1", [orphan], date(2026, 8, 25), {}) == 0


from models import AppSettings


def test_the_tick_materialises_before_it_reads_the_users_tasks(monkeypatch):
    """
    Order matters: a task generated for today must be in user_tasks, or its
    reminder waits a whole extra tick for no reason.
    """
    order = []

    monkeypatch.setattr(services.repository, "get_all_active_user_ids", lambda: ["user-1"])
    monkeypatch.setattr(services.repository, "get_app_settings",
                        lambda u: AppSettings(notifications_enabled=True, send_all_enabled=False))
    monkeypatch.setattr(services.repository, "get_recurrence_rules",
                        lambda u: order.append("rules") or [])
    monkeypatch.setattr(services.repository, "get_all_tasks",
                        lambda u: order.append("tasks") or [], raising=False)
    monkeypatch.setattr(services.repository, "get_tasks_due_for_notification",
                        lambda u, s, e, tasks=None, require_bell_enabled=False: [])
    monkeypatch.setattr(services, "sync_google_calendar_for_user", lambda u: {"status": "ok"})

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = services.repository
    monkeypatch.setattr(svc, "_maybe_send_daily_summary",
                        lambda u, now, s, t: False, raising=False)
    monkeypatch.setattr(svc, "_check_hostaway_replies",
                        lambda u, t: {"conversations_polled": 0, "replies_found": 0,
                                      "tasks_completed": 0}, raising=False)
    monkeypatch.setattr(svc, "_check_hostaway_escalations",
                        lambda u, n, t: {"checked": 0, "escalations_sent": 0}, raising=False)

    result = svc.run_notification_scheduler()

    assert order == ["rules", "tasks"]
    assert result["results"][0]["recurrences_created"] == 0
    assert result["results"][0]["recurrences_missed"] == 0


def test_a_broken_rule_does_not_cost_the_user_the_rest_of_the_tick(monkeypatch):
    """Same lesson the Hostaway encryption key taught, applied before it bites."""
    calendar_ran = []

    monkeypatch.setattr(services.repository, "get_all_active_user_ids", lambda: ["user-1"])
    monkeypatch.setattr(services.repository, "get_app_settings",
                        lambda u: AppSettings(notifications_enabled=True, send_all_enabled=False))

    def _boom(user_id):
        raise RuntimeError("recurrence_rules table is missing")

    monkeypatch.setattr(services.repository, "get_recurrence_rules", _boom)
    monkeypatch.setattr(services.repository, "get_all_tasks", lambda u: [], raising=False)
    monkeypatch.setattr(services.repository, "get_tasks_due_for_notification",
                        lambda u, s, e, tasks=None, require_bell_enabled=False: [])
    monkeypatch.setattr(services, "sync_google_calendar_for_user",
                        lambda u: calendar_ran.append(u) or {"status": "ok"})

    svc = services.TaskService.__new__(services.TaskService)
    svc.repository = services.repository
    monkeypatch.setattr(svc, "_maybe_send_daily_summary",
                        lambda u, now, s, t: False, raising=False)
    monkeypatch.setattr(svc, "_check_hostaway_replies",
                        lambda u, t: {"conversations_polled": 0, "replies_found": 0,
                                      "tasks_completed": 0}, raising=False)
    monkeypatch.setattr(svc, "_check_hostaway_escalations",
                        lambda u, n, t: {"checked": 0, "escalations_sent": 0}, raising=False)

    result = svc.run_notification_scheduler()

    assert calendar_ran == ["user-1"], "recurrence took down the rest of the tick"
    row = result["results"][0]
    assert row["status"] == "ok", "a user whose recurrences failed must still be an ok tick"
    assert row["recurrences_created"] == 0
    assert row["recurrences_missed"] is None, "not attempted is not the same fact as 0 missed"
    # Each spared subsystem named explicitly, not just inferred from calendar
    # sync running last in the chain: a future reorder could keep this test
    # green while quietly breaking one of the others.
    assert row["sent"] == 0
    assert row["daily_summary_sent"] is False
    assert row["hostaway_checked"] == 0
    assert row["hostaway_escalations_sent"] == 0


import agent_tools


def test_the_agent_does_not_see_a_missed_occurrence():
    """
    is_open_task is the declared single source of truth for the whole agent —
    day view, search, and every write guard — so this is the one line that has
    to change on the backend.
    """
    missed = _occurrence("gone", "2026-08-17", missed_at="2026-08-19T06:00:00+03:00")
    live = _occurrence("here", "2026-08-19")

    assert agent_tools.is_open_task(missed) is False
    assert agent_tools.is_open_task(live) is True


def test_a_missed_occurrence_stays_invisible_even_when_completed_are_included():
    missed = _occurrence("gone", "2026-08-17", missed_at="2026-08-19T06:00:00+03:00")
    assert agent_tools.is_open_task(missed, include_completed=True) is False
