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


def _monthly(month_day, window_start, window_end, starts_on=None, ends_on=None):
    return recurrence.occurrences_between(
        freq=recurrence.MONTHLY,
        weekdays=None,
        month_day=month_day,
        window_start=window_start,
        window_end=window_end,
        starts_on=starts_on or window_start,
        ends_on=ends_on,
    )


def test_the_first_of_the_month():
    got = _monthly(1, date(2026, 8, 15), date(2026, 11, 15))
    assert got == [date(2026, 9, 1), date(2026, 10, 1), date(2026, 11, 1)]


def test_the_thirty_first_falls_back_to_the_last_day_of_a_short_month():
    """February has no 31st. The month must not be skipped."""
    got = _monthly(31, date(2027, 1, 1), date(2027, 4, 30))
    assert got == [
        date(2027, 1, 31),
        date(2027, 2, 28),
        date(2027, 3, 31),
        date(2027, 4, 30),
    ]


def test_the_fallback_knows_about_leap_years():
    got = _monthly(31, date(2028, 2, 1), date(2028, 2, 29))
    assert got == [date(2028, 2, 29)]


def test_last_day_of_month_is_its_own_request():
    got = _monthly(recurrence.LAST_DAY_OF_MONTH, date(2026, 8, 1), date(2026, 10, 31))
    assert got == [date(2026, 8, 31), date(2026, 9, 30), date(2026, 10, 31)]


def test_a_monthly_rule_respects_the_window_edges():
    got = _monthly(15, date(2026, 8, 16), date(2026, 9, 14))
    assert got == []


def test_a_monthly_rule_with_no_day_generates_nothing():
    assert _monthly(None, date(2026, 8, 1), date(2026, 12, 31)) == []


def test_clamp_month_day_directly():
    assert recurrence.clamp_month_day(2027, 2, 31) == date(2027, 2, 28)
    assert recurrence.clamp_month_day(2028, 2, 31) == date(2028, 2, 29)
    assert recurrence.clamp_month_day(2026, 8, 15) == date(2026, 8, 15)
    assert recurrence.clamp_month_day(2026, 9, recurrence.LAST_DAY_OF_MONTH) == date(2026, 9, 30)


MONDAY = date(2026, 8, 17)
TUESDAY = date(2026, 8, 18)
WEDNESDAY = date(2026, 8, 19)


def test_todays_occurrence_is_never_missed():
    assert recurrence.is_missed(occurrence_date=MONDAY, today=MONDAY) is False


def test_yesterdays_occurrence_survives_one_day_of_grace():
    """Tuesday: Monday's pill is still on the list, overdue."""
    assert recurrence.is_missed(occurrence_date=MONDAY, today=TUESDAY) is False


def test_the_day_after_grace_it_is_missed():
    """Wednesday: Monday's leaves by itself."""
    assert recurrence.is_missed(occurrence_date=MONDAY, today=WEDNESDAY) is True


def test_zero_grace_misses_it_the_very_next_day():
    assert recurrence.is_missed(occurrence_date=MONDAY, today=MONDAY, grace_days=0) is False
    assert recurrence.is_missed(occurrence_date=MONDAY, today=TUESDAY, grace_days=0) is True


def test_a_future_occurrence_is_not_missed():
    assert recurrence.is_missed(occurrence_date=WEDNESDAY, today=MONDAY) is False


def test_the_window_starts_today_and_never_in_the_past():
    start, end = recurrence.materialization_window(MONDAY)
    assert start == MONDAY
    assert end == date(2026, 8, 31)  # 17 + 14


def test_the_window_horizon_is_configurable():
    start, end = recurrence.materialization_window(MONDAY, horizon_days=2)
    assert (start, end) == (MONDAY, date(2026, 8, 19))


def test_parse_date_reads_the_stored_format_and_rejects_everything_else():
    assert recurrence.parse_date("2026-08-17") == date(2026, 8, 17)
    # Every unusable input is None rather than a raise: this parses values that
    # came out of a TEXT column, and a scheduler tick must not die on one bad row.
    assert recurrence.parse_date(None) is None
    assert recurrence.parse_date("") is None
    assert recurrence.parse_date("17/08/2026") is None
    assert recurrence.parse_date("not a date") is None


def test_format_date_round_trips_through_parse_date():
    assert recurrence.format_date(date(2026, 8, 17)) == "2026-08-17"
    assert recurrence.parse_date(recurrence.format_date(date(2028, 2, 29))) == date(2028, 2, 29)
