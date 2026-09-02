"""
Which workspace the extractor speaks for, and how a name it returns becomes an
id. The model answers with a NAME on purpose — models truncate and invent
UUIDs — so this resolution is the seam where a hallucination is caught.
"""
import pytest

import repository
import services
from models import AppSettings, Category

USER = "user-1"

CATS = [
    Category(record_id="c-stocks", workspace_id="ws-b", name="μετοχές"),
    Category(record_id="c-crypto", workspace_id="ws-b", name="crypto"),
    Category(record_id="c-garden", workspace_id="ws-p", name="κήπος"),
]


@pytest.fixture
def service(monkeypatch):
    monkeypatch.setattr(repository, "get_categories", lambda u: CATS)
    return services.TaskService()


# ------------------------------------------------------- which workspace

def test_an_explicit_workspace_wins(service, monkeypatch):
    monkeypatch.setattr(repository, "get_app_settings",
                        lambda u: AppSettings(default_workspace_id="ws-default"))

    assert service.resolve_extraction_workspace(USER, "ws-b") == "ws-b"


def test_no_workspace_falls_back_to_the_default(service, monkeypatch):
    """The user is on 'Όλα'. The model still gets exactly ONE vocabulary — it
    is never asked to guess between several, which is the whole point."""
    monkeypatch.setattr(repository, "get_app_settings",
                        lambda u: AppSettings(default_workspace_id="ws-default"))

    assert service.resolve_extraction_workspace(USER, None) == "ws-default"


def test_no_workspace_and_no_default_means_unfiled(service, monkeypatch):
    """Rather than picking the first workspace, which would silently file a
    task somewhere the user never chose."""
    monkeypatch.setattr(repository, "get_app_settings", lambda u: AppSettings())

    assert service.resolve_extraction_workspace(USER, None) is None


# ------------------------------------------------------------ name to id

def test_a_known_name_resolves(service):
    assert service.resolve_category_name(USER, "ws-b", "μετοχές") == "c-stocks"


def test_resolution_ignores_case_and_padding(service):
    """The model echoes what it was given, but not always byte for byte."""
    assert service.resolve_category_name(USER, "ws-b", "  CRYPTO ") == "c-crypto"


def test_a_name_from_ANOTHER_workspace_does_not_resolve(service):
    """'κήπος' lives in Personal. Offered only Business's names, a model that
    answers κήπος has hallucinated, and the task must stay uncategorised."""
    assert service.resolve_category_name(USER, "ws-b", "κήπος") is None


def test_an_invented_name_files_nothing(service):
    """No category is auto-created from a model's output: a hallucinated
    category is worse than no category, because it looks deliberate and the
    user has no reason to distrust it."""
    assert service.resolve_category_name(USER, "ws-b", "συναλλαγές") is None


def test_no_name_and_no_workspace_are_both_safe(service):
    assert service.resolve_category_name(USER, "ws-b", None) is None
    assert service.resolve_category_name(USER, None, "μετοχές") is None


# --------------------------------------------------- what the model is shown

def test_the_prompt_lists_only_this_workspaces_categories(monkeypatch):
    """The whole reason the extractor is scoped. Offered fifteen names across
    three workspaces it guesses; offered five from one, it does not have to."""
    import ai_engine
    monkeypatch.setattr(ai_engine.repository, "get_categories_for_workspace",
                        lambda u, w: [c for c in CATS if c.workspace_id == w])

    instruction = ai_engine.build_extraction_instruction(USER, "ws-b")

    assert "μετοχές" in instruction
    assert "crypto" in instruction
    assert "κήπος" not in instruction  # it lives in the other workspace


def test_a_workspace_with_no_categories_says_so_rather_than_listing_nothing(monkeypatch):
    """An empty list rendered as an empty line reads, to a model, like a
    malformed instruction. Saying there are none is one it can obey."""
    import ai_engine
    monkeypatch.setattr(ai_engine.repository, "get_categories_for_workspace",
                        lambda u, w: [])

    instruction = ai_engine.build_extraction_instruction(USER, "ws-empty")

    assert "category_name" in instruction
    assert "no categories" in instruction.lower()


def test_the_old_four_word_line_survives(monkeypatch):
    """tasks.category is still the live column until a later slice, and the
    model still has to fill it. Adding the new names must not remove the old
    instruction.

    All three repository calls are stubbed, including the ones this path only
    started making later: an unstubbed call here reaches the REAL Supabase, and
    the whole point of these tests is that they never do.
    """
    import ai_engine
    monkeypatch.setattr(ai_engine.repository, "get_categories_for_workspace",
                        lambda u, w: [])
    monkeypatch.setattr(ai_engine.repository, "get_workspaces", lambda u: [])
    monkeypatch.setattr(ai_engine.repository, "get_categories", lambda u: [])

    instruction = ai_engine.build_extraction_instruction(USER, None)

    assert "Business" in instruction and "Personal" in instruction


# ================================================================= the model
# picks the workspace too, but ONLY when we genuinely do not know it.
#
# Measured before it was built: 8 phrases x 3 runs, 7/7 correct on workspace
# and every one stable. "ραντεβού με τον Κώστα στις 7" — the exact phrase the
# owner complained had landed in Business — came back Personal, consistently.

from models import Workspace

WSS = [Workspace(record_id="ws-b", name="Business"),
       Workspace(record_id="ws-p", name="Personal")]


@pytest.fixture
def service_with_workspaces(service, monkeypatch):
    monkeypatch.setattr(repository, "get_workspaces", lambda u: WSS)
    return service


def test_a_known_workspace_name_resolves(service_with_workspaces):
    assert service_with_workspaces.resolve_workspace_name(USER, "Personal") == "ws-p"


def test_workspace_resolution_ignores_case_and_padding(service_with_workspaces):
    assert service_with_workspaces.resolve_workspace_name(USER, "  BUSINESS ") == "ws-b"


def test_an_invented_workspace_name_files_nothing(service_with_workspaces):
    """Same rule as categories: no container is ever created from model output."""
    assert service_with_workspaces.resolve_workspace_name(USER, "Επενδύσεις") is None
    assert service_with_workspaces.resolve_workspace_name(USER, None) is None


def test_the_prompt_asks_for_a_workspace_ONLY_when_none_was_given(monkeypatch):
    """The model is never handed a choice we can already answer. Standing in a
    workspace, it is not asked which one — that is the whole reason the
    extractor stays accurate."""
    import ai_engine
    monkeypatch.setattr(ai_engine.repository, "get_workspaces", lambda u: WSS)
    monkeypatch.setattr(ai_engine.repository, "get_categories_for_workspace",
                        lambda u, w: [c for c in CATS if c.workspace_id == w])
    monkeypatch.setattr(ai_engine.repository, "get_categories", lambda u: CATS)

    known = ai_engine.build_extraction_instruction(USER, "ws-b")
    unknown = ai_engine.build_extraction_instruction(USER, None)

    assert "workspace_name" not in known
    assert "κήπος" not in known           # the other workspace stays out of it

    assert "workspace_name" in unknown
    assert "Business" in unknown and "Personal" in unknown
    assert "μετοχές" in unknown and "κήπος" in unknown


def test_the_model_choice_is_used_when_we_did_not_know(service_with_workspaces):
    from models import SingleTask
    task = SingleTask(task_name="Ραντεβού", description="", category="Personal",
                      priority="P2", workspace_name="Personal", category_name=None)

    record = service_with_workspaces._single_task_to_record(task, USER, None)

    assert record.workspace_id == "ws-p"


def test_where_we_DID_know_the_model_cannot_override_it(service_with_workspaces):
    """It was not asked, so anything it says here is noise, not an opinion."""
    from models import SingleTask
    task = SingleTask(task_name="Χ", description="", category="Business",
                      priority="P2", workspace_name="Personal")

    record = service_with_workspaces._single_task_to_record(task, USER, "ws-b")

    assert record.workspace_id == "ws-b"


def test_a_category_from_the_wrong_workspace_is_dropped_not_forced(service_with_workspaces):
    """The model answered Personal + crypto. crypto lives in Business, so the
    workspace stands and the category falls away — rather than dragging the
    task into a workspace it did not choose."""
    from models import SingleTask
    task = SingleTask(task_name="Χ", description="", category="Personal",
                      priority="P2", workspace_name="Personal", category_name="crypto")

    record = service_with_workspaces._single_task_to_record(task, USER, None)

    assert record.workspace_id == "ws-p"
    assert record.category_id is None
