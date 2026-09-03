"""
What a brand-new account is furnished with, and when.

Two facts drove this. First, NOTHING created workspaces for a new user: the
2026-09-01 migration furnished the accounts that existed that day and nothing
has furnished one since, so the next person to sign up would have got no
workspaces, no categories, no chip row (it needs two), and every task unfiled
forever.

Second, the owner is aiming this at companies. A company uses both halves, and
a sole trader can ignore one — so both exist from the first request, Business
is the default, and every integration lands there. That last part also retires
a limitation: a category cannot be moved between workspaces, so an integration
created in whatever single workspace happened to exist would have been stuck
there. Business always existing removes the question.
"""
import pytest

import repository
import services
from models import AppSettings, Category, Workspace

USER = "user-1"


class _Store:
    """Just enough of the repository to watch what gets created."""

    def __init__(self, workspaces=None, categories=None, settings=None):
        self.workspaces = list(workspaces or [])
        self.categories = list(categories or [])
        self.settings = settings or AppSettings()
        self.settings_writes = []

    def install(self, monkeypatch):
        monkeypatch.setattr(repository, "get_workspaces", lambda u: self.workspaces)
        monkeypatch.setattr(repository, "get_categories", lambda u: self.categories)
        monkeypatch.setattr(repository, "get_categories_for_workspace",
                            lambda u, w: [c for c in self.categories if c.workspace_id == w])
        monkeypatch.setattr(repository, "get_app_settings", lambda u: self.settings)
        monkeypatch.setattr(repository, "create_workspace", self._create_workspace)
        monkeypatch.setattr(repository, "create_category", self._create_category)
        monkeypatch.setattr(repository, "update_app_settings", self._update_settings)
        monkeypatch.setattr(repository, "get_system_category", self._system_category)
        return self

    def _create_workspace(self, user_id, workspace):
        created = workspace.model_copy(update={"record_id": f"ws-{workspace.name.lower()}"})
        self.workspaces.append(created)
        return created

    def _create_category(self, user_id, category):
        created = category.model_copy(update={"record_id": f"cat-{category.name.lower()}"})
        self.categories.append(created)
        return created

    def _update_settings(self, user_id, **fields):
        self.settings_writes.append(fields)
        self.settings = self.settings.model_copy(update=fields)
        return self.settings

    def _system_category(self, user_id, key):
        return next((c for c in self.categories if c.system_key == key), None)


@pytest.fixture
def service():
    return services.TaskService()


# ------------------------------------------------------- furnishing an account

def test_a_brand_new_account_gets_business_and_personal(service, monkeypatch):
    store = _Store().install(monkeypatch)

    service.ensure_account_workspaces(USER)

    assert [w.name for w in store.workspaces] == ["Business", "Personal"]


def test_business_becomes_the_default_workspace(service, monkeypatch):
    """It is what the extractor speaks for when the user is on "Όλα", and the
    owner is aiming this at companies."""
    store = _Store().install(monkeypatch)

    service.ensure_account_workspaces(USER)

    assert store.settings.default_workspace_id == "ws-business"


def test_no_category_is_invented_for_a_new_account(service, monkeypatch):
    """Guessing someone's categories means guessing their life. The workspaces
    are structure; the categories are theirs to name."""
    store = _Store().install(monkeypatch)

    service.ensure_account_workspaces(USER)

    assert store.categories == []


def test_an_account_that_already_has_workspaces_is_left_alone(service, monkeypatch):
    """Called on every workspace read, so it must be a no-op the second time —
    and must never re-add a workspace the user deliberately deleted."""
    existing = [Workspace(record_id="ws-mine", name="Δικός μου")]
    store = _Store(workspaces=existing).install(monkeypatch)

    service.ensure_account_workspaces(USER)

    assert [w.name for w in store.workspaces] == ["Δικός μου"]
    assert store.settings_writes == []


# --------------------------------------------------- where an integration lands

def test_connecting_hostaway_creates_its_category_in_business(service, monkeypatch):
    store = _Store().install(monkeypatch)
    service.ensure_account_workspaces(USER)

    category = service.ensure_integration_category(USER, "hostaway", "Hostaway")

    assert category.workspace_id == "ws-business"
    assert category.system_key == "hostaway"


def test_connecting_twice_does_not_make_two(service, monkeypatch):
    """unique(user_id, system_key) would refuse the second one anyway; this is
    the half that keeps a reconnect from surfacing that as a 500."""
    store = _Store().install(monkeypatch)
    service.ensure_account_workspaces(USER)

    first = service.ensure_integration_category(USER, "hostaway", "Hostaway")
    second = service.ensure_integration_category(USER, "hostaway", "Hostaway")

    assert first.record_id == second.record_id
    assert len([c for c in store.categories if c.system_key == "hostaway"]) == 1


def test_the_category_exists_only_once_someone_connects(service, monkeypatch):
    """The whole point. A user who never touches Hostaway must not carry an
    undeletable category named after a product they do not use."""
    store = _Store().install(monkeypatch)

    service.ensure_account_workspaces(USER)

    assert [c for c in store.categories if c.system_key] == []


def test_it_falls_back_to_the_first_workspace_if_business_is_gone(service, monkeypatch):
    """The user may have renamed or deleted Business. The integration still
    needs a home, and no home at all would mean guest tasks arriving unfiled."""
    store = _Store(workspaces=[Workspace(record_id="ws-only", name="Δουλειά")]).install(monkeypatch)

    category = service.ensure_integration_category(USER, "hostaway", "Hostaway")

    assert category.workspace_id == "ws-only"
