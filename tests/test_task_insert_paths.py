"""
A TRIPWIRE. It does not test behaviour; it fails when somebody adds a new way
to create a task.

WHY IT EXISTS, in the owner's own words on 2026-09-12, when he was told the
database was about to be locked:

    «ναι αλλα να ξερουμε οτι εχουμε κανει αυτο το πραγμα γτ μετα αν γραψουμε
     κωδικα που γραφει και δεν το ξερει κανενας και δεν περναει απο την βαση
     αθορυβα τι κανουμε?»

He is right, and the failure he is describing has already happened once. On
2026-09-01 a write carried a `category_name` key the table did not have;
Supabase rejects an INSERT WHOLESALE for one unknown key (PGRST204), and that
took down ALL FOUR task-creation paths at once — manual, the three AI
extractions, and the Hostaway webhook.

Locking `ai_suggested_category` / `ai_suggested_priority` to NOT NULL
(docs/migrations/2026-09-12-lock-ai-snapshot-columns.sql) trades one risk for
another, on purpose:

  - BEFORE: a path that forgets those columns writes a row that looks fine and
    then raises inside _supabase_row_to_task when anybody READS it. Since
    sharing, that means the whole list breaks for every member of the
    workspace, not just for the row's author — a poisoning that shows up later,
    somewhere else, to somebody else.
  - AFTER: the database refuses the write immediately. Loud, at the source, and
    nobody else's screen is affected.

The second is better. But "the database refuses it" still means a broken
feature in production, and a comment in a file nobody opens does not prevent
that. THIS TEST DOES: a third insert path makes it go red on a laptop, with the
reason written out, before anything ships.

WHAT IT CANNOT DO: it reads the source for one exact spelling. Somebody writing
through a variable, an ORM, or the Supabase console will not be caught here.
That is the honest limit of a tripwire, and it is still worth having — both
existing paths use this spelling, and so will the next one written by habit.
"""
import pathlib
import re

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent

# Every place allowed to create a task, and how each one satisfies the two
# frozen AI-snapshot columns. Adding a line here is the deliberate act; the
# test exists so that it cannot be skipped by accident.
KNOWN_INSERT_PATHS = {
    "repository.py": [
        # save_task — the normal path: manual, voice, photo, text extraction,
        # the Hostaway webhook and every materialised recurrence occurrence.
        # Its fields come from TaskRecord.model_dump(), and models.TaskRecord
        # declares both columns REQUIRED with no default — so a task cannot be
        # built without them in the first place.
        "save_task",
        # convert_calendar_event_to_task — a Google event becoming a task.
        # Writes the row directly, bypassing TaskRecord, and therefore sets
        # both columns by hand. There is no AI suggestion behind a calendar
        # event, so they mirror the chosen values.
        "convert_calendar_event_to_task",
    ],
}

INSERT_PATTERN = re.compile(r'table\(\s*["\']tasks["\']\s*\)\s*\.insert\(')


def _enclosing_function(source: str, position: int) -> str:
    """The nearest `def` above this point in the file."""
    head = source[:position]
    matches = re.findall(r"^\s*def\s+(\w+)", head, re.MULTILINE)
    return matches[-1] if matches else "<module level>"


def test_no_new_way_to_create_a_task_has_appeared():
    """
    If this fails, you have added a task-insert path. Before you add its name
    to KNOWN_INSERT_PATHS, make sure it writes BOTH ai_suggested_category and
    ai_suggested_priority — the database rejects the row without them, and the
    feature you are building will simply not work in production.
    """
    found: dict[str, list[str]] = {}

    for path in REPO_ROOT.glob("*.py"):
        # migrate_to_supabase.py is a one-off from the Airtable era that nothing
        # runs; it is excluded rather than listed so it cannot be mistaken for a
        # live path.
        if path.name == "migrate_to_supabase.py":
            continue
        source = path.read_text(encoding="utf-8")
        for match in INSERT_PATTERN.finditer(source):
            found.setdefault(path.name, []).append(_enclosing_function(source, match.start()))

    assert found == KNOWN_INSERT_PATHS, (
        "The set of places that create tasks has changed.\n"
        f"  expected: {KNOWN_INSERT_PATHS}\n"
        f"  found:    {found}\n\n"
        "A new path must set ai_suggested_category AND ai_suggested_priority. "
        "They are NOT NULL in the database since 2026-09-12, so the INSERT is "
        "refused without them — see this file's docstring for why that is the "
        "lesser of the two evils, and docs/DECISIONS.md for the decision."
    )


def test_the_model_still_refuses_to_build_a_task_without_them():
    """
    The other half of the guarantee, and the one that protects the path
    everything else goes through. If a default ever appears on either field,
    save_task would start writing whatever that default happened to be — and
    the frozen snapshot of what the AI actually suggested would quietly become
    a lie, with nothing rejecting it.
    """
    from models import TaskRecord

    for field in ("ai_suggested_category", "ai_suggested_priority"):
        assert TaskRecord.model_fields[field].is_required(), (
            f"{field} has acquired a default. It is a frozen record of what the "
            "AI actually said; a default turns it into a guess that looks like "
            "a measurement."
        )
