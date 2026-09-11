"""
sharing.py — invitations, membership and archiving.

The rules that decide whether a link works live here rather than in the
repository, so a refusal can say WHICH refusal it is. A bare "that did not
work" is the difference between a colleague retrying and a colleague phoning
the owner.
"""
import pytest

import sharing


@pytest.fixture
def repo(monkeypatch):
    """A stand-in for every repository call sharing.py makes, recording what it
    was asked to do. Returned as a plain namespace so a test can rewrite one
    answer without rebuilding the rest."""
    state = {
        "owner_of": {("user-1", "ws-1")},
        "members": {"ws-1": ["user-1"]},
        "workspace": {"id": "ws-1", "name": "Καθαριότητα", "user_id": "user-1",
                      "archived_at": None},
        "invite": None,
        "calls": [],
    }

    def _record(name):
        def inner(*a, **kw):
            state["calls"].append((name, a, kw))
        return inner

    monkeypatch.setattr(sharing.repository, "is_workspace_owner",
                        lambda u, w: (u, w) in state["owner_of"])
    monkeypatch.setattr(sharing.repository, "get_member_workspace_ids",
                        lambda u: [w for w, ms in state["members"].items() if u in ms])
    monkeypatch.setattr(sharing.repository, "get_workspace_row",
                        lambda w: state["workspace"])
    monkeypatch.setattr(sharing.repository, "get_invite_by_token_hash",
                        lambda h: state["invite"])
    def _create_invite(**kw):
        # Mirrors the real repository.create_workspace_invite, which returns
        # _invite_public(row) and therefore never includes token_hash. A fake
        # that returned it would let a leak through this test unnoticed.
        state["calls"].append(("create_workspace_invite", (), kw))
        return {k: v for k, v in {"id": "inv-1", **kw}.items() if k != "token_hash"}

    monkeypatch.setattr(sharing.repository, "create_workspace_invite", _create_invite)

    def _add(workspace_id, user_id, role="member"):
        state["members"].setdefault(workspace_id, []).append(user_id)
        state["calls"].append(("add_workspace_member", (workspace_id, user_id, role), {}))
        return {"workspace_id": workspace_id, "user_id": user_id, "role": role}

    monkeypatch.setattr(sharing.repository, "add_workspace_member", _add)
    for name in ("mark_invite_accepted", "revoke_workspace_invite",
                 "remove_workspace_member", "unassign_tasks_for_member",
                 "set_workspace_archived", "clear_workspace_from_all_settings",
                 "log_workspace_activity", "set_member_notify_all"):
        monkeypatch.setattr(sharing.repository, name, _record(name))

    monkeypatch.setattr(sharing.repository, "get_workspace_invites",
                        lambda w: [state["invite"]] if state["invite"] else [])

    # Stubbed because archiving resolves the Business workspace to fall back
    # to. Left unstubbed this reached the REAL Supabase client, and
    # _business_workspace_id's try/except swallowed the result — a live network
    # call inside a unit test, hidden by the same fail-quietly shape that makes
    # an exit code 0 worthless as evidence.
    from models import Workspace
    monkeypatch.setattr(sharing.repository, "get_workspaces",
                        lambda u: [Workspace(record_id="ws-business", name="Business")])
    return state


def _called(state, name):
    return [c for c in state["calls"] if c[0] == name]


# -------------------------------------------------------------- the token


def test_the_stored_hash_is_not_the_token():
    raw, hashed = sharing.mint_invite_token()

    assert raw != hashed
    assert len(hashed) == 64          # sha256 hex
    assert sharing.hash_invite_token(raw) == hashed


def test_two_tokens_are_never_the_same():
    assert sharing.mint_invite_token()[0] != sharing.mint_invite_token()[0]


def test_the_token_is_long_enough_to_be_a_credential():
    """It is the whole secret. Short enough to guess is short enough to lose a
    workspace to somebody running a loop."""
    raw, _ = sharing.mint_invite_token()

    assert len(raw) >= 32


# ------------------------------------------------------------- creating


def test_only_the_owner_may_invite(repo):
    with pytest.raises(sharing.SharingError) as e:
        sharing.create_invite("user-2", "ws-1")

    assert e.value.code == "not_owner"


def test_creating_returns_the_raw_token_exactly_once(repo):
    result = sharing.create_invite("user-1", "ws-1")

    assert result["token"]
    assert "token_hash" not in result["invite"]


def test_the_invite_stores_the_hash_of_the_token_it_handed_out(repo):
    """Asserted at the repository call, not on the return value: the hash is
    what gets STORED and must never be what gets RETURNED."""
    result = sharing.create_invite("user-1", "ws-1")

    sent = _called(repo, "create_workspace_invite")[0][2]
    assert sent["token_hash"] == sharing.hash_invite_token(result["token"])
    assert "token" not in sent


def test_an_invite_expires(repo):
    result = sharing.create_invite("user-1", "ws-1")

    assert result["invite"]["expires_at"]


def test_creating_an_invite_is_recorded(repo):
    sharing.create_invite("user-1", "ws-1")

    assert _called(repo, "log_workspace_activity")


# ------------------------------------------------------------- accepting


def _live_invite(**overrides):
    from datetime import datetime, timedelta, timezone
    base = {"id": "inv-1", "workspace_id": "ws-1", "invited_by": "user-1",
            "role": "member", "accepted_at": None, "revoked_at": None,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()}
    base.update(overrides)
    return base


def test_a_good_link_makes_you_a_member(repo):
    repo["invite"] = _live_invite()

    result = sharing.accept_invite("user-2", "any-token")

    assert result["status"] == "joined"
    assert _called(repo, "add_workspace_member")
    assert _called(repo, "mark_invite_accepted")


def test_an_unknown_link_says_so(repo):
    repo["invite"] = None

    with pytest.raises(sharing.SharingError) as e:
        sharing.accept_invite("user-2", "nonsense")

    assert e.value.code == "invite_not_found"


def test_a_used_link_is_dead(repo):
    """Single use. The second person down the WhatsApp thread does not get in
    on the same link."""
    repo["invite"] = _live_invite(accepted_at="2026-09-11T09:00:00Z",
                                  accepted_by="user-9")

    with pytest.raises(sharing.SharingError) as e:
        sharing.accept_invite("user-2", "any-token")

    assert e.value.code == "invite_used"


def test_a_revoked_link_is_dead(repo):
    repo["invite"] = _live_invite(revoked_at="2026-09-11T09:00:00Z")

    with pytest.raises(sharing.SharingError) as e:
        sharing.accept_invite("user-2", "any-token")

    assert e.value.code == "invite_revoked"


def test_an_expired_link_is_dead(repo):
    from datetime import datetime, timedelta, timezone
    repo["invite"] = _live_invite(
        expires_at=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat())

    with pytest.raises(sharing.SharingError) as e:
        sharing.accept_invite("user-2", "any-token")

    assert e.value.code == "invite_expired"


def test_a_link_into_an_archived_workspace_is_dead(repo):
    """Otherwise somebody joins a room that is not there and sees an empty
    app with no explanation."""
    repo["invite"] = _live_invite()
    repo["workspace"]["archived_at"] = "2026-09-11T08:00:00Z"

    with pytest.raises(sharing.SharingError) as e:
        sharing.accept_invite("user-2", "any-token")

    assert e.value.code == "workspace_archived"


def test_accepting_twice_when_already_a_member_is_a_success_not_an_error(repo):
    """A colleague taps the WhatsApp link twice. That must not look like a
    failure, and it must not consume a second invitation either."""
    repo["invite"] = _live_invite()
    repo["members"]["ws-1"].append("user-2")

    result = sharing.accept_invite("user-2", "any-token")

    assert result["status"] == "already_member"
    assert not _called(repo, "add_workspace_member")


def test_joining_is_recorded(repo):
    repo["invite"] = _live_invite()

    sharing.accept_invite("user-2", "any-token")

    actions = [c[2].get("action") or (c[1][2] if len(c[1]) > 2 else None)
               for c in _called(repo, "log_workspace_activity")]
    assert "member_joined" in actions


# -------------------------------------------------------------- revoking


def test_only_the_owner_may_revoke(repo):
    repo["invite"] = _live_invite()

    with pytest.raises(sharing.SharingError) as e:
        sharing.revoke_invite("user-2", "ws-1", "inv-1")

    assert e.value.code == "not_owner"


def test_revoking_stamps_the_invite(repo):
    repo["invite"] = _live_invite()

    sharing.revoke_invite("user-1", "ws-1", "inv-1")

    assert _called(repo, "revoke_workspace_invite")


# --------------------------------------------------------------- removing


def test_only_the_owner_may_remove_somebody(repo):
    with pytest.raises(sharing.SharingError) as e:
        sharing.remove_member("user-2", "ws-1", "user-3")

    assert e.value.code == "not_owner"


def test_removing_unassigns_their_work_first(repo):
    """Order matters. Remove the membership first and the unassign still works
    — the tasks table does not care — but the activity log would then be
    written by somebody who is no longer in the room."""
    sharing.remove_member("user-1", "ws-1", "user-2")

    names = [c[0] for c in repo["calls"]]
    assert names.index("unassign_tasks_for_member") < names.index("remove_workspace_member")


def test_the_owner_cannot_be_removed_from_their_own_workspace(repo):
    """There would be nobody left who could invite, archive or delete. The
    owner leaves by archiving the workspace, which is a different act."""
    with pytest.raises(sharing.SharingError) as e:
        sharing.remove_member("user-1", "ws-1", "user-1")

    assert e.value.code == "cannot_remove_owner"


# --------------------------------------------------------------- leaving


def test_a_member_may_leave(repo):
    repo["members"]["ws-1"].append("user-2")

    sharing.leave_workspace("user-2", "ws-1")

    assert _called(repo, "remove_workspace_member")
    assert _called(repo, "unassign_tasks_for_member")


def test_the_owner_cannot_leave_their_own_workspace(repo):
    with pytest.raises(sharing.SharingError) as e:
        sharing.leave_workspace("user-1", "ws-1")

    assert e.value.code == "owner_cannot_leave"


def test_leaving_something_you_are_not_in_says_so(repo):
    with pytest.raises(sharing.SharingError) as e:
        sharing.leave_workspace("user-3", "ws-1")

    assert e.value.code == "not_a_member"


# -------------------------------------------------------------- archiving


def test_only_the_owner_may_archive(repo):
    with pytest.raises(sharing.SharingError) as e:
        sharing.archive_workspace("user-2", "ws-1")

    assert e.value.code == "not_owner"


def test_archiving_repoints_everybodys_settings(repo):
    """The half that is easy to forget. Both settings that can name a workspace
    are per-user rows."""
    sharing.archive_workspace("user-1", "ws-1")

    assert _called(repo, "set_workspace_archived")
    assert _called(repo, "clear_workspace_from_all_settings")


def test_archiving_unlinks_nothing(repo):
    """The whole point of archiving over deleting: tasks keep their workspace,
    their category and their assignee, so restoring brings back the
    organisation and not just the rows."""
    sharing.archive_workspace("user-1", "ws-1")

    assert not _called(repo, "unassign_tasks_for_member")
    assert not _called(repo, "remove_workspace_member")


def test_restoring_clears_the_stamp(repo):
    repo["workspace"]["archived_at"] = "2026-09-11T08:00:00Z"

    sharing.restore_workspace("user-1", "ws-1")

    calls = _called(repo, "set_workspace_archived")
    assert calls
    assert calls[-1][1][2] is None


def test_a_refusal_carries_something_the_user_can_read(repo):
    """The code is for the API and the tests; the message is for the person who
    tapped the link. Greek, because the app is."""
    with pytest.raises(sharing.SharingError) as e:
        sharing.create_invite("user-2", "ws-1")

    assert e.value.message
    assert e.value.message != e.value.code


def test_archiving_falls_back_to_Business_for_the_default_workspace(repo):
    """default_workspace_id is whose vocabulary the extractor is given. Leaving
    it pointing at an archived workspace would hand the model the category
    names of a room nobody is in."""
    sharing.archive_workspace("user-1", "ws-1")

    call = _called(repo, "clear_workspace_from_all_settings")[0]
    assert call[2]["fallback_default"] == "ws-business"


def test_the_fallback_is_None_rather_than_a_guess_when_Business_is_gone(repo, monkeypatch):
    """An empty setting is honest. Pointing the extractor at whatever workspace
    happened to be first would be a guess about somebody's life."""
    monkeypatch.setattr(sharing.repository, "get_workspaces", lambda u: [])

    sharing.archive_workspace("user-1", "ws-1")

    call = _called(repo, "clear_workspace_from_all_settings")[0]
    assert call[2]["fallback_default"] is None
