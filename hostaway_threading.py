"""
Pure decisions for the Hostaway message-threading feature. No I/O, no AI,
no clock reads — every function here is a comparison over values it was
handed, which is exactly why the feature can promise zero fail.

See docs/superpowers/specs/2026-08-10-hostaway-threading-design.md. The
project's standing lesson applies (DECISIONS.md, "a rule the code can
enforce does not belong in the system instruction"): the model summarises
and prioritises, and decides nothing about identity or authorship.
"""

import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

# Measured, not chosen: across 141 consecutive guest-message pairs, every
# burst was under 42 seconds, nothing at all fell between 1 and 2 minutes,
# and the earliest genuinely-separate second problem was 2.4 minutes out.
# 90 seconds sits in the empty band. Spec §1.3.
THREAD_WINDOW_SECONDS = 90

# Hostaway sends "2026-08-10 14:00:00" — no timezone, listing-local. Both
# sides of every comparison come from the same conversation, so naive
# datetimes are correct here and converting would invent precision.
_HOSTAWAY_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

_PRIORITY_RANK = {"P1": 3, "P2": 2, "P3": 1}


def parse_hostaway_datetime(value: Optional[str]) -> Optional[datetime]:
    """Parses Hostaway's message date. Returns None on anything unusable."""
    if not value:
        return None
    try:
        return datetime.strptime(value, _HOSTAWAY_DATE_FORMAT)
    except (ValueError, TypeError):
        logger.warning(f"[hostaway threading] Unparseable date: {value!r}")
        return None


def should_append_to_thread(
    last_message_at: Optional[str],
    new_message_at: Optional[str],
    window_seconds: int = THREAD_WINDOW_SECONDS,
) -> bool:
    """
    True when the new message belongs to the same burst as the previous one.

    Every failure mode returns False, i.e. "make a new task". That is the
    safe direction: a spurious extra task is today's behaviour and merely
    noisy, whereas wrongly appending buries a real problem inside a task
    the user may already consider handled.
    """
    previous = parse_hostaway_datetime(last_message_at)
    current = parse_hostaway_datetime(new_message_at)
    if previous is None or current is None:
        return False

    gap = (current - previous).total_seconds()
    # A negative gap means out-of-order delivery, not a tight burst.
    return 0 <= gap <= window_seconds


def higher_priority(a: Optional[str], b: Optional[str]) -> str:
    """
    The more urgent of two priorities, so a thread can only ever escalate.
    Unknown values rank lowest; if both are unknown, falls back to P3.
    """
    rank_a = _PRIORITY_RANK.get(a or "", 0)
    rank_b = _PRIORITY_RANK.get(b or "", 0)
    if rank_a == 0 and rank_b == 0:
        return "P3"
    return a if rank_a >= rank_b else b


def is_more_urgent(new_priority: Optional[str], old_priority: Optional[str]) -> bool:
    """
    True only when the priority moved UP.

    The burst re-notification hangs off this. Asking "did it change?" would
    give the same answer today, because higher_priority() cannot return a
    downgrade — but that is a property of another function, and if it ever
    stops holding, "changed" would start firing pushes on de-escalations.
    The condition says what it means instead.
    """
    return _PRIORITY_RANK.get(new_priority or "", 0) > _PRIORITY_RANK.get(old_priority or "", 0)


def is_human_reply(message: dict) -> bool:
    """
    True only when a person typed this outgoing message.

    `userId` is the signal, and the alternative was measured and rejected.
    Across 25 conversations: 66 Hostaway automations, every one with
    userId null; 24 outgoing messages without a communicationId, 23 of them
    carrying userId 990952. The one that disagreed was a GuestArrive
    message — a third-party tool with NEITHER field set — so keying on
    communicationId would have let an automation close a task. userId
    excludes both kinds of automation with one check. Spec §1.2.

    The account also runs a `messageReceived` automation ("we received your
    message and will reply shortly") that fires after EVERY guest message.
    That is why this check exists at all: without it, an outgoing-message
    rule would close every task seconds after creating it.

    Known limit, failing safe: a reply sent from the Airbnb/Booking app
    rather than through Hostaway may carry no userId. Then this returns
    False, the task stays open, and the user closes it by hand. The error
    direction is never "closed something that was not answered".
    """
    if message.get("isIncoming") != 0:
        return False
    return bool(message.get("userId"))
