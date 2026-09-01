"""
Workspaces and categories: the two tables that turn a category from a word into
a row. Every query here must be scoped to user_id — the backend uses the secret
key and bypasses RLS, so this scoping IS the protection.
"""
from models import Category, Workspace


def test_a_workspace_needs_only_a_name():
    """Everything else has a sane default, because the create endpoint takes
    only a name and the user should not have to pick a colour to get started."""
    w = Workspace(name="Business")

    assert w.name == "Business"
    assert w.position == 0
    assert w.color is None
    assert w.record_id is None


def test_an_ordinary_category_has_no_system_key():
    """system_key is what marks a row the integration owns. A user-made
    category must never carry one, or it becomes undeletable."""
    c = Category(workspace_id="ws-1", name="γραφείο")

    assert c.system_key is None
    assert c.workspace_id == "ws-1"


def test_the_hostaway_category_carries_its_system_key():
    c = Category(workspace_id="ws-1", name="Hostaway", system_key="hostaway")

    assert c.system_key == "hostaway"
