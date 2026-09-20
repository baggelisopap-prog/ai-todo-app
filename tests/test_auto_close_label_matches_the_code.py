"""
The switch's label must describe what the switch does.

This is the bug the owner actually reported, in the plainest possible form:
«γτ οταν απανταω σε ενα μυνημα στην hostaway δεν κλεινει μόνο του?». The
screen said «Όταν απαντάς σε πελάτη, κλείνει το task του μέσα σε ~2 λεπτά»
while HOSTAWAY_REPLY_AUTOCOMPLETE_PRIORITIES was {"P3"} — so for a P1 or P2
he was promised a close that was never coming, and spent his own time
wondering what was broken. Nothing WAS broken; the sentence was.

The two live in different files, different languages, and different halves of
the repo, which is exactly how they drifted. Adding "P2" to the set is meant
to stay a one-line change (the constant's own comment says so) — this test is
what makes the second line, the label, impossible to forget.
"""
import json
import pathlib

import pytest

import services

LOCALES = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "src" / "locales"
ALL_PRIORITIES = {"P1", "P2", "P3"}


def _description(language: str) -> str:
    data = json.loads((LOCALES / f"{language}.json").read_text(encoding="utf-8"))
    return data["hostaway"]["auto_close_enabled_description"]


@pytest.mark.parametrize("language", ["el", "en"])
def test_every_priority_that_closes_is_named_in_the_label(language):
    text = _description(language)
    for priority in sorted(services.HOSTAWAY_REPLY_AUTOCOMPLETE_PRIORITIES):
        assert priority in text, (
            f"{language}.json promises nothing about {priority}, but a {priority} "
            f"task closes itself. Someone will wonder why their task vanished."
        )


@pytest.mark.parametrize("language", ["el", "en"])
def test_no_priority_is_named_that_does_not_close(language):
    """
    The original failure, in the opposite direction: a label naming a priority
    that in fact stays open. P1 must never appear here — replying to "I can't
    find the keys" with "I'm coming" is an answer, not a fix.
    """
    text = _description(language)
    for priority in sorted(ALL_PRIORITIES - services.HOSTAWAY_REPLY_AUTOCOMPLETE_PRIORITIES):
        assert priority not in text, (
            f"{language}.json mentions {priority} in the auto-close description, "
            f"but a {priority} task stays open. That is the promise the owner "
            f"waited on and that never arrived."
        )


def test_both_languages_say_the_same_thing_about_which_ones_close():
    """A label that drifts in one language only is worse than one wrong in
    both: it looks correct to whoever checks it."""
    named = {
        language: {p for p in ALL_PRIORITIES if p in _description(language)}
        for language in ("el", "en")
    }
    assert named["el"] == named["en"], f"the two labels disagree: {named}"
    assert named["el"] == set(services.HOSTAWAY_REPLY_AUTOCOMPLETE_PRIORITIES)
