"""
What the agent proposed, and what the user decided — the record that did not exist.

Confirm used to execute the write and leave no trace it came from the agent;
Cancel never reached the server at all, so "the AI proposed this and I refused
it" — the sharpest signal there is about the agent's judgement — was thrown
away on the phone. These tests pin both halves down, plus the third state the
pair does not cover: a proposal the user simply walked away from.
"""
import pytest
from fastapi import HTTPException

import agent_history
import main
import repository
from models import TaskRecord


# --- fixtures shaped like the real thing ------------------------------------
# Captured from agent_runs.proposed_actions on 2026-08-12, not invented: every
# proposal carries its own action_id, which is what a decision matches on.

def _proposal(action_id, type_="update_task", record_id="rec-1", task_name="Αλλαγή ώρας"):
    return {
        "type": type_,
        "fields": {"due_date": "2026-08-12", "due_time": "09:43"},
        "action_id": action_id,
        "record_id": record_id,
        "task_name": task_name,
    }


def _run(conversation_id, question, created_at, answer="απάντηση", proposals=None):
    return {
        "id": f"run-{created_at}",
        "conversation_id": conversation_id,
        "question": question,
        "answer": answer,
        "proposed_actions": proposals or [],
        "created_at": created_at,
        "outcome": "ok",
    }


def _decision(action_id, decision="confirmed"):
    return {"action_id": action_id, "decision": decision, "created_at": "2026-08-12T10:00:00+03:00"}


# --- the pure grouping ------------------------------------------------------

def test_runs_group_into_conversations_newest_first():
    runs = [
        _run("conv-a", "πρώτη ερώτηση", "2026-08-10T09:00:00+03:00"),
        _run("conv-a", "δεύτερη ερώτηση", "2026-08-10T09:05:00+03:00"),
        _run("conv-b", "άλλη συζήτηση", "2026-08-12T18:00:00+03:00"),
    ]

    conversations = agent_history.group_into_conversations(runs)

    assert [c["conversation_id"] for c in conversations] == ["conv-b", "conv-a"]
    assert conversations[1]["turns"] == 2


def test_the_title_is_the_first_question_asked_not_the_last():
    """A conversation is recognised by how it STARTED. Titling it with the most
    recent turn would rename it under the user every time they follow up."""
    runs = [
        _run("conv-a", "πόσα tasks έχω σήμερα;", "2026-08-10T09:00:00+03:00"),
        _run("conv-a", "και αύριο;", "2026-08-10T09:05:00+03:00"),
    ]

    assert agent_history.group_into_conversations(runs)[0]["title"] == "πόσα tasks έχω σήμερα;"


def test_a_conversation_counts_the_proposals_it_carried():
    runs = [
        _run("conv-a", "q1", "2026-08-10T09:00:00+03:00", proposals=[_proposal("a1"), _proposal("a2")]),
        _run("conv-a", "q2", "2026-08-10T09:05:00+03:00", proposals=[_proposal("a3")]),
    ]

    assert agent_history.group_into_conversations(runs)[0]["proposals"] == 3


# --- the pure merge of proposals with decisions -----------------------------

def test_a_proposal_carries_the_decision_that_matches_its_action_id():
    runs = [_run("conv-a", "q", "2026-08-10T09:00:00+03:00",
                 proposals=[_proposal("a1"), _proposal("a2")])]
    decisions = [_decision("a1", "confirmed"), _decision("a2", "cancelled")]

    conversation = agent_history.build_conversation(runs, decisions)

    statuses = {p["action_id"]: p["status"] for p in conversation["turns"][0]["proposals"]}
    assert statuses == {"a1": "confirmed", "a2": "cancelled"}


def test_an_untouched_proposal_is_undecided_and_not_cancelled():
    """The third state, and the reason decisions are their own rows: walking
    away from a card is a different fact from refusing it, and reporting it as
    a refusal would poison the very signal this table exists to collect."""
    runs = [_run("conv-a", "q", "2026-08-10T09:00:00+03:00", proposals=[_proposal("a1")])]

    conversation = agent_history.build_conversation(runs, decisions=[])

    assert conversation["turns"][0]["proposals"][0]["status"] == "undecided"


def test_turns_come_back_oldest_first_the_way_they_were_asked():
    runs = [
        _run("conv-a", "δεύτερη", "2026-08-10T09:05:00+03:00"),
        _run("conv-a", "πρώτη", "2026-08-10T09:00:00+03:00"),
    ]

    conversation = agent_history.build_conversation(runs, decisions=[])

    assert [t["question"] for t in conversation["turns"]] == ["πρώτη", "δεύτερη"]


# --- the recording seam -----------------------------------------------------

class _FakeQuery:
    def __init__(self, sink, rows, fail=False):
        self.sink, self.rows, self.fail = sink, rows, fail

    def insert(self, values):
        self.sink["insert"] = values
        return self

    def select(self, *a):
        self.sink["select"] = a
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def is_(self, col, val):
        self.sink.setdefault("is_", []).append((col, val))
        return self

    def order(self, col, **kw):
        self.sink.setdefault("order", []).append((col, kw))
        return self

    def limit(self, n):
        self.sink["limit"] = n
        return self

    def execute(self):
        if self.fail:
            raise RuntimeError("supabase is down")
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows=None, fail=False):
        self.calls = {}
        self.rows = rows if rows is not None else []
        self.fail = fail

    def table(self, name):
        self.calls["table"] = name
        return _FakeQuery(self.calls, self.rows, self.fail)


def test_a_decision_is_written_scoped_to_its_user(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(repository, "supabase", fake)

    repository.record_agent_action_decision("user-1", {
        "conversation_id": "conv-a",
        "action_id": "a1",
        "action_type": "update_task",
        "record_id": "rec-1",
        "task_name": "Αλλαγή ώρας",
        "fields": {"due_time": "09:43"},
        "decision": "confirmed",
    })

    assert fake.calls["table"] == "agent_action_decisions"
    assert fake.calls["insert"]["user_id"] == "user-1"
    assert fake.calls["insert"]["decision"] == "confirmed"
    assert fake.calls["insert"]["action_id"] == "a1"


def test_a_failed_recording_never_reaches_the_caller(monkeypatch):
    """This runs inside the user's Confirm. If the audit write can raise, a
    logging outage becomes a user-visible failure on a write that SUCCEEDED."""
    monkeypatch.setattr(repository, "supabase", _FakeSupabase(fail=True))

    repository.record_agent_action_decision("user-1", {
        "action_type": "complete_task", "decision": "confirmed",
    })  # must not raise


def test_the_history_query_hides_my_test_runs(monkeypatch):
    """282 of the 348 rows in agent_runs are tagged test runs. Without this
    filter the screen shows the developer's noise instead of the user's work."""
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.get_agent_runs_for_history("user-1", limit=200)

    assert ("test_label", "null") in fake.calls["is_"]


# --- the endpoints ----------------------------------------------------------

def _wire_confirm(monkeypatch, raises=None):
    recorded = []
    monkeypatch.setattr(main, "_reject_if_pending_approval", lambda u, r: None)
    monkeypatch.setattr(main.repository, "record_agent_action_decision",
                        lambda user_id, d: recorded.append((user_id, d)))

    # A real TaskRecord, not a stand-in: the endpoint's response model
    # validates it, so a stub would fail the test for a reason that has
    # nothing to do with what is being tested.
    task = TaskRecord(
        task_name="Αλλαγή ώρας", description="", category="Personal",
        priority="P3", checklist=[],
        ai_suggested_category="Personal", ai_suggested_priority="P3",
        record_id="rec-1",
    )

    def _update(user_id, record_id, fields, **kwargs):
        if raises:
            raise raises
        return task

    monkeypatch.setattr(main.service, "update_task", _update)
    return recorded


def test_confirming_records_that_it_was_confirmed(monkeypatch):
    recorded = _wire_confirm(monkeypatch)

    main.confirm_agent_action(
        main.ConfirmActionRequest(
            action_id="a1", type="update_task", record_id="rec-1",
            task_name="Αλλαγή ώρας", fields={"due_time": "09:43"},
            conversation_id="conv-a",
        ),
        user_id="user-1",
    )

    assert len(recorded) == 1
    user_id, decision = recorded[0]
    assert user_id == "user-1"
    assert decision["decision"] == "confirmed"
    assert decision["action_id"] == "a1"
    assert decision["conversation_id"] == "conv-a"


def test_a_confirm_that_failed_records_nothing(monkeypatch):
    """The row means "this happened". A write that raised did not happen, and
    recording it would make the history lie in the one direction that matters."""
    recorded = _wire_confirm(monkeypatch, raises=HTTPException(status_code=404, detail="gone"))

    with pytest.raises(HTTPException):
        main.confirm_agent_action(
            main.ConfirmActionRequest(action_id="a1", type="update_task", record_id="rec-1",
                                      fields={"due_time": "09:43"}, conversation_id="conv-a"),
            user_id="user-1",
        )

    assert recorded == []


def test_cancelling_records_it_and_writes_nothing_to_the_task(monkeypatch):
    recorded = []
    monkeypatch.setattr(main.repository, "record_agent_action_decision",
                        lambda user_id, d: recorded.append((user_id, d)))

    def _must_not_run(*a, **kw):
        raise AssertionError("cancel must never touch a task")

    monkeypatch.setattr(main.service, "update_task", _must_not_run)
    monkeypatch.setattr(main.service, "create_task_manual", _must_not_run)

    main.cancel_agent_action(
        main.CancelActionRequest(action_id="a1", type="update_task", record_id="rec-1",
                                 task_name="Αλλαγή ώρας", conversation_id="conv-a"),
        user_id="user-1",
    )

    assert recorded[0][1]["decision"] == "cancelled"
    assert recorded[0][1]["action_id"] == "a1"
