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
