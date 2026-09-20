"""
The teaching copy must not quietly start lying.

`agent_engine_explain.py` is not part of the program — nothing imports it.
It exists so the owner, who is not a programmer, can read his own agent with
a Greek comment on almost every line. That makes it the one file where being
WRONG is worse than being absent: he reads it to learn how his system works,
and a stale copy teaches him a system he does not have.

It had drifted badly by 2026-09-20 — last touched 7 August against real code
last touched 17 September; of 55 names, 16 matched, 10 had different bodies
(`ask_agent` and `search_tasks` among them) and 11 were missing entirely.
Nothing announced that, because nothing was watching.

This test watches. It compares the copy against `agent_engine.py` +
`agent_tools.py` structurally — docstrings and comments stripped, so only
real logic counts — and fails when the gap grows beyond what is recorded in
KNOWN_GAPS below. It is a ratchet: shrink the list as the copy is brought up
to date, and the test will not let it slide back.

If this fails after you changed agent_engine.py or agent_tools.py, the copy
needs the same change. If bringing it up to date is not today's job, add the
name here with the date — deliberately visible, never silent.
"""
import ast
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
REAL_SOURCES = ("agent_engine.py", "agent_tools.py")
COPY_SOURCE = "agent_engine_explain.py"

# Recorded 2026-09-20. Every name here is a place the copy is known to be
# out of date. Shrinking this list is the point; growing it needs a reason.
KNOWN_GAPS_DIFFERENT = {
    "_finish",
    "ask_agent",
    "build_system_instruction",
    "build_time_context",
    "build_tool_functions",
    "build_write_proposal_tools",
    "is_open_task",
    "propose_complete_task",
    "propose_update_task",
    "search_tasks",
}

KNOWN_GAPS_MISSING = {
    "STEM_MIN_WORD_LENGTH",
    "STEM_PREFIX_LENGTH",
    "_PENDING_ERROR",
    "_match_with",
    "_scan",
    "_unjustified_target",
    "build_conversation_refs_block",
    "build_vocabulary_block",
    "is_disposed_of",
    "render_task_rows",
    "stem_words",
}


def _names(path: pathlib.Path) -> dict:
    """Every function and UPPER_CASE constant, with its logic fingerprint."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            body = list(node.body)
            # Drop the docstring: the copy's prose is SUPPOSED to differ.
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                body = body[1:]
            found[node.name] = ast.dump(ast.Module(body=body, type_ignores=[]))
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id.isupper():
                    found[target.id] = ast.dump(node.value)
    return found


@pytest.fixture(scope="module")
def comparison():
    real = {}
    for source in REAL_SOURCES:
        real.update(_names(ROOT / source))
    copy = _names(ROOT / COPY_SOURCE)
    shared = set(real) & set(copy)
    return {
        "missing": set(real) - set(copy),
        "different": {n for n in shared if real[n] != copy[n]},
    }


def test_no_new_logic_is_missing_from_the_copy(comparison):
    unexpected = comparison["missing"] - KNOWN_GAPS_MISSING
    assert not unexpected, (
        f"agent_engine_explain.py is missing {sorted(unexpected)}, which the real code has. "
        f"Add the Greek-commented version, or record it in KNOWN_GAPS_MISSING with today's date."
    )


def test_no_new_body_has_drifted(comparison):
    unexpected = comparison["different"] - KNOWN_GAPS_DIFFERENT
    assert not unexpected, (
        f"agent_engine_explain.py teaches a different {sorted(unexpected)} than the code runs. "
        f"Update the copy, or record it in KNOWN_GAPS_DIFFERENT with today's date."
    )


def test_the_recorded_gaps_are_still_real(comparison):
    """
    The ratchet's other tooth. Once a gap is closed, its name must leave the
    list — otherwise the list slowly becomes a place where anything can hide,
    and the test stops meaning anything.
    """
    closed_missing = KNOWN_GAPS_MISSING - comparison["missing"]
    closed_different = KNOWN_GAPS_DIFFERENT - comparison["different"]
    assert not (closed_missing or closed_different), (
        f"These are recorded as out of date but now match: "
        f"{sorted(closed_missing | closed_different)}. Remove them from the lists."
    )


def test_the_copy_warns_the_reader_while_gaps_remain(comparison):
    """
    While anything is stale, the file must say so where the owner will see
    it — in the header he reads first, not in a test he never runs.
    """
    if not (comparison["missing"] or comparison["different"]):
        return
    header = (ROOT / COPY_SOURCE).read_text(encoding="utf-8")[:6000]
    assert "ΠΡΟΣΟΧΗ" in header, (
        "parts of this copy are out of date and its header does not warn about it"
    )
