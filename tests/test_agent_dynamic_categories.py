"""
The agent's vocabulary becomes the user's own names — without undoing the
prompt-caching fix that build_system_instruction's docstring exists to record.

That fix is why the dynamic part is APPENDED. The long static block above it
stays byte-identical, so it remains a shared cacheable prefix; only the tail
differs, and it differs weekly rather than per-minute.
"""
import agent_tools
from models import Category, Workspace

WS = [Workspace(record_id="ws-b", name="Business"),
      Workspace(record_id="ws-p", name="Personal")]
CATS = [Category(record_id="c1", workspace_id="ws-b", name="μετοχές"),
        Category(record_id="c2", workspace_id="ws-p", name="κήπος")]


def test_the_vocabulary_names_every_workspace_and_category():
    """The agent still sees EVERYTHING — scoping it would break 'what do I have
    today', which is its whole job. Only the extractor is scoped."""
    block = agent_tools.build_vocabulary_block(WS, CATS)

    assert "Business" in block and "Personal" in block
    assert "μετοχές" in block and "κήπος" in block


def test_a_workspace_with_no_categories_is_said_so_not_left_blank():
    block = agent_tools.build_vocabulary_block(
        [Workspace(record_id="ws-x", name="Empty")], [])

    assert "Empty" in block
    assert "no categories" in block


def test_a_user_with_nothing_gets_an_empty_block_not_a_broken_sentence():
    assert agent_tools.build_vocabulary_block([], []) == ""


def test_the_static_block_is_still_a_PREFIX_of_the_dynamic_one():
    """The load-bearing assertion of this file. If the vocabulary were
    interpolated into the MIDDLE, this fails — and prompt caching would go back
    to the 0.4% its docstring records, on a block that is 74% of every prompt
    token ever billed."""
    static = agent_tools.build_system_instruction()
    dynamic = agent_tools.build_system_instruction(
        agent_tools.build_vocabulary_block(WS, CATS))

    assert dynamic.startswith(static)
    assert len(dynamic) > len(static)


def test_no_vocabulary_leaves_the_instruction_byte_identical():
    """A user with no workspaces must produce exactly the old constant, so
    nothing about their billing changes."""
    assert agent_tools.build_system_instruction("") == agent_tools.build_system_instruction()
