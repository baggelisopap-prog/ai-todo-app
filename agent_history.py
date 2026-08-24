"""
Pure shaping for the agent history screen. No I/O, no AI, no clock reads —
every function here is a regrouping of rows it was handed, which is why it can
be tested without a database and why the endpoints stay thin.

Same shape as `hostaway_threading.py` and `recurrence.py`: the decisions live
here, the round trips live in `repository.py`, and nothing in between.

The one rule worth stating out loud: a proposal the user never touched is
`undecided`, NOT cancelled. Walking away from a card and refusing it are
different facts, and collapsing them would corrupt the signal the decisions
table exists to collect (see docs/migrations/2026-08-23-agent-action-decisions.sql).
"""

from datetime import datetime, timezone
from typing import Optional

# Sorts last. Used for a row whose created_at is missing or unparseable, so one
# bad timestamp cannot reorder a whole conversation.
_EPOCH = datetime.min.replace(tzinfo=timezone.utc)


def _at(row: dict) -> datetime:
    """The row's created_at as a comparable instant. Never raises."""
    value = row.get("created_at")
    if not value:
        return _EPOCH
    try:
        parsed = datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return _EPOCH
    # Supabase returns timestamptz with an offset, but a naive value would make
    # every comparison against an aware one raise. Assume UTC rather than crash.
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def group_into_conversations(runs: list[dict]) -> list[dict]:
    """
    One entry per conversation, newest conversation first.

    `title` is the FIRST question asked, not the most recent one: a conversation
    is recognised by how it started, and titling it with the latest turn would
    rename it under the user every time they follow up.
    """
    by_conversation: dict[Optional[str], list[dict]] = {}
    for run in runs:
        by_conversation.setdefault(run.get("conversation_id"), []).append(run)

    conversations = []
    for conversation_id, rows in by_conversation.items():
        ordered = sorted(rows, key=_at)
        conversations.append({
            "conversation_id": conversation_id,
            "title": ordered[0].get("question") or "",
            "turns": len(ordered),
            "proposals": sum(len(r.get("proposed_actions") or []) for r in ordered),
            "started_at": ordered[0].get("created_at"),
            "last_at": ordered[-1].get("created_at"),
        })

    return sorted(conversations, key=lambda c: _at({"created_at": c["last_at"]}), reverse=True)


def build_conversation(runs: list[dict], decisions: list[dict]) -> dict:
    """
    One conversation, oldest turn first — the order it was actually asked in —
    with every proposal carrying what the user decided about it.

    Decisions are matched on `action_id`, which every proposal has carried since
    the propose_* tools were written (a uuid minted per proposal), so one answer
    offering three cards resolves each card independently. A decision whose
    action_id matches nothing is ignored rather than guessed at.
    """
    decided = {d.get("action_id"): d.get("decision") for d in decisions if d.get("action_id")}

    turns = []
    for run in sorted(runs, key=_at):
        proposals = []
        for proposal in run.get("proposed_actions") or []:
            proposals.append({
                **proposal,
                "status": decided.get(proposal.get("action_id"), "undecided"),
            })
        turns.append({
            "run_id": run.get("id"),
            "question": run.get("question"),
            "answer": run.get("answer"),
            "outcome": run.get("outcome"),
            "created_at": run.get("created_at"),
            "proposals": proposals,
        })

    ordered = sorted(runs, key=_at)
    return {
        "conversation_id": ordered[0].get("conversation_id") if ordered else None,
        "title": ordered[0].get("question") or "" if ordered else "",
        "turns": turns,
    }
