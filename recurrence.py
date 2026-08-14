"""
Pure date logic for recurring tasks. No I/O, no clock reads, no AI — every
function here is arithmetic over values it was handed, which is why "which
days does this rule produce?" can be tested exhaustively without a database.

Same shape and same reason as hostaway_threading.py. See
docs/superpowers/specs/2026-08-15-recurring-tasks-design.md.
"""

import calendar
import logging
from datetime import date, datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

WEEKLY = "weekly"
MONTHLY = "monthly"

# month_day = -1 means "the last day of whatever month this is", which is a
# different request from "the 31st" and cannot be expressed as a number.
LAST_DAY_OF_MONTH = -1

# One day of grace, then a missed occurrence closes itself. Monday's is still
# visible on Tuesday and gone on Wednesday. Fixed in v1; the column exists so
# making it per-rule later is UI work rather than a migration.
DEFAULT_GRACE_DAYS = 1

# How far ahead real rows exist. Upcoming, the calendar grid, the daily summary
# and the agent's search all read the tasks table, so anything not materialised
# is invisible in every one of them.
MATERIALIZATION_HORIZON_DAYS = 14

_DATE_FORMAT = "%Y-%m-%d"


def parse_date(value: Optional[str]) -> Optional[date]:
    """Parses a stored YYYY-MM-DD string. Returns None on anything unusable."""
    if not value:
        return None
    try:
        return datetime.strptime(value, _DATE_FORMAT).date()
    except (ValueError, TypeError):
        logger.warning(f"[recurrence] Unparseable date: {value!r}")
        return None


def format_date(value: date) -> str:
    return value.strftime(_DATE_FORMAT)


def occurrences_between(
    *,
    freq: str,
    weekdays: Optional[list[int]],
    month_day: Optional[int],
    window_start: date,
    window_end: date,
    starts_on: date,
    ends_on: Optional[date] = None,
) -> list[date]:
    """
    Every date this rule produces inside [window_start, window_end], both ends
    inclusive, clipped to the rule's own starts_on/ends_on.

    An incoherent rule returns [] rather than raising: the database CHECK
    already forbids one, and a scheduler tick must not die over data it cannot
    have created.
    """
    first = max(window_start, starts_on)
    last = window_end if ends_on is None else min(window_end, ends_on)
    if first > last:
        return []

    if freq == WEEKLY:
        return _weekly_occurrences(weekdays, first, last)

    return []


def _weekly_occurrences(weekdays: Optional[list[int]], first: date, last: date) -> list[date]:
    wanted = set(weekdays or [])
    if not wanted:
        return []

    out = []
    cursor = first
    while cursor <= last:
        if cursor.isoweekday() in wanted:
            out.append(cursor)
        cursor += timedelta(days=1)
    return out
