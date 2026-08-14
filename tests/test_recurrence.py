"""The generator: a rule plus a window becomes a list of dates. No I/O anywhere."""
from datetime import date

import recurrence


def _weekly(weekdays, window_start, window_end, starts_on=None, ends_on=None):
    return recurrence.occurrences_between(
        freq=recurrence.WEEKLY,
        weekdays=weekdays,
        month_day=None,
        window_start=window_start,
        window_end=window_end,
        starts_on=starts_on or window_start,
        ends_on=ends_on,
    )


def test_monday_to_friday_skips_the_weekend():
    # 2026-08-17 is a Monday; the window runs one full week.
    got = _weekly([1, 2, 3, 4, 5], date(2026, 8, 17), date(2026, 8, 23))
    assert got == [
        date(2026, 8, 17), date(2026, 8, 18), date(2026, 8, 19),
        date(2026, 8, 20), date(2026, 8, 21),
    ]


def test_all_seven_weekdays_is_daily():
    got = _weekly([1, 2, 3, 4, 5, 6, 7], date(2026, 8, 17), date(2026, 8, 20))
    assert got == [date(2026, 8, 17), date(2026, 8, 18), date(2026, 8, 19), date(2026, 8, 20)]


def test_a_single_weekday_appears_once_per_week():
    got = _weekly([3], date(2026, 8, 17), date(2026, 8, 31))  # Wednesdays
    assert got == [date(2026, 8, 19), date(2026, 8, 26)]


def test_both_window_ends_are_inclusive():
    got = _weekly([1], date(2026, 8, 17), date(2026, 8, 17))
    assert got == [date(2026, 8, 17)]


def test_nothing_is_generated_before_starts_on():
    got = _weekly([1, 2, 3, 4, 5], date(2026, 8, 17), date(2026, 8, 21),
                  starts_on=date(2026, 8, 19))
    assert got == [date(2026, 8, 19), date(2026, 8, 20), date(2026, 8, 21)]


def test_nothing_is_generated_after_ends_on():
    got = _weekly([1, 2, 3, 4, 5], date(2026, 8, 17), date(2026, 8, 21),
                  ends_on=date(2026, 8, 19))
    assert got == [date(2026, 8, 17), date(2026, 8, 18), date(2026, 8, 19)]


def test_an_empty_weekday_set_generates_nothing():
    """The database CHECK forbids this, so it must fail quietly rather than crash a tick."""
    assert _weekly([], date(2026, 8, 17), date(2026, 8, 23)) == []
    assert _weekly(None, date(2026, 8, 17), date(2026, 8, 23)) == []


def test_a_backwards_window_generates_nothing():
    assert _weekly([1, 2, 3, 4, 5], date(2026, 8, 23), date(2026, 8, 17)) == []
