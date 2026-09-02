"""
The per-task editor learns the user's categories — and deliberately never
learns to move a task between WORKSPACES.

The owner drew that line himself, and it is the right one. Changing a category
is a small move inside the box you are already looking at. Changing the
workspace takes the task off the screen you are standing on: you ask for "move
it to Friday", the model also decides it belongs in Personal, and the task
vanishes in front of you. This editor exists for small corrections.
"""
import pytest

import repository
import task_agent
from models import Category, TaskRecord, Workspace

USER = "user-1"

WSS = [Workspace(record_id="ws-b", name="Business"),
       Workspace(record_id="ws-p", name="Personal")]
CATS = [Category(record_id="c-crypto", workspace_id="ws-b", name="crypto"),
        Category(record_id="c-stocks", workspace_id="ws-b", name="μετοχές"),
        Category(record_id="c-garden", workspace_id="ws-p", name="κήπος")]


@pytest.fixture(autouse=True)
def _stub_repo(monkeypatch):
    monkeypatch.setattr(repository, "get_workspaces", lambda u: WSS)
    monkeypatch.setattr(repository, "get_categories", lambda u: CATS)
    monkeypatch.setattr(repository, "get_categories_for_workspace",
                        lambda u, w: [c for c in CATS if c.workspace_id == w])


def _task(**overrides):
    base = dict(record_id="t1", task_name="Χ", description="", category="Business",
                priority="P2", ai_suggested_category="Business",
                ai_suggested_priority="P2", workspace_id="ws-b")
    base.update(overrides)
    return TaskRecord(**base)


def _plan(**overrides):
    base = dict(action="edit", message="ok")
    base.update(overrides)
    return task_agent.TaskEditPlan(**base)


# ------------------------------------------------- the workspace is off limits

def test_the_editor_can_never_move_a_task_between_workspaces():
    """Not a validation rule that could be argued with — the field is simply
    not writable, so there is nothing for the model to aim at."""
    assert "workspace_id" not in task_agent.TASK_AGENT_WRITABLE_FIELDS
    assert "workspace_name" not in task_agent.TASK_AGENT_WRITABLE_FIELDS
    assert not hasattr(task_agent.TaskEditPlan(action="unclear", message=""), "workspace_name")


# ------------------------------------------------------------- what it is shown

def test_the_prompt_offers_this_workspaces_categories():
    prompt = task_agent._build_prompt(_task(), "βάλ' το στα crypto", USER)

    assert "crypto" in prompt and "μετοχές" in prompt
    assert "κήπος" not in prompt  # lives in the other workspace


def test_an_unfiled_task_is_offered_nothing():
    """No workspace means no category list — and nothing for the model to
    invent from."""
    prompt = task_agent._build_prompt(_task(workspace_id=None), "κάν' το αύριο", USER)

    assert "crypto" not in prompt


# ------------------------------------------------------------- name resolution

def test_a_named_category_becomes_an_id():
    result = task_agent._normalize_plan(_plan(category_name="crypto"), _task(), USER)

    assert result["fields"]["category_id"] == "c-crypto"
    assert "category_name" not in result["fields"]


def test_the_same_category_it_already_has_is_not_a_change():
    """Repeating a current value shows up to the user as an edit they did not
    ask for — the whole reason _normalize_plan drops non-changes."""
    result = task_agent._normalize_plan(
        _plan(category_name="crypto"), _task(category_id="c-crypto"), USER)

    assert "category_id" not in result["fields"]


def test_an_invented_name_is_dropped_and_reported():
    result = task_agent._normalize_plan(_plan(category_name="συναλλαγές"), _task(), USER)

    assert "category_id" not in result["fields"]
    assert "category_name" in result["invalid"]


def test_a_category_from_another_workspace_is_refused():
    """'κήπος' is Personal's. Offered only Business's names, a model that
    answers κήπος has hallucinated — and honouring it would silently move the
    task's category outside its own workspace."""
    result = task_agent._normalize_plan(_plan(category_name="κήπος"), _task(), USER)

    assert "category_id" not in result["fields"]
    assert "category_name" in result["invalid"]


def test_an_unfiled_task_cannot_be_given_a_category():
    """There is no workspace to look inside, so no name can resolve."""
    result = task_agent._normalize_plan(
        _plan(category_name="crypto"), _task(workspace_id=None), USER)

    assert "category_id" not in result["fields"]
    assert "category_name" in result["invalid"]


def test_the_undo_payload_carries_the_previous_category():
    """`before` is what Undo restores, and it must be the id the server saw."""
    result = task_agent._normalize_plan(
        _plan(category_name="μετοχές"), _task(category_id="c-crypto"), USER)

    assert result["fields"]["category_id"] == "c-stocks"
    assert result["before"]["category_id"] == "c-crypto"


# ================================================================ the front door
#
# Every test above calls the module's internals directly, which is exactly how
# _build_prompt gained a user_id parameter while the ONE line that calls it kept
# passing two arguments. The suite stayed green; the feature raised TypeError on
# its first real use. This test goes in the way the app does — through
# plan_task_edit — with only the network call stubbed, so a signature that no
# longer matches its call site fails here instead of in production.

def test_the_real_entry_point_runs_end_to_end(monkeypatch):
    class _FakeResponse:
        text = '{"action":"edit","message":"ok","category_name":"crypto"}'
        usage_metadata = None

    monkeypatch.setattr(task_agent.client.models, "generate_content",
                        lambda **kw: _FakeResponse())
    monkeypatch.setattr(task_agent, "token_tracker", None)

    result = task_agent.plan_task_edit("βάλ' το στα crypto", _task(), USER)

    assert result["fields"]["category_id"] == "c-crypto"
    assert "workspace_id" not in result["fields"]


def test_the_front_door_refuses_another_workspaces_category(monkeypatch):
    class _FakeResponse:
        text = '{"action":"edit","message":"ok","category_name":"κήπος"}'
        usage_metadata = None

    monkeypatch.setattr(task_agent.client.models, "generate_content",
                        lambda **kw: _FakeResponse())
    monkeypatch.setattr(task_agent, "token_tracker", None)

    result = task_agent.plan_task_edit("βάλ' το στον κήπο", _task(), USER)

    assert "category_id" not in result["fields"]
    assert "category_name" in result["invalid"]
