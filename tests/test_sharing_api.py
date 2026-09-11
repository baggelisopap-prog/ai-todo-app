"""
The endpoints for members, invitations, archiving and the activity log.

Two things are asserted here that nothing below this layer can assert: that a
refusal reaches the phone as the RIGHT status with a reason a person can read,
and that reading who is in a room is a member's right and nobody else's.
"""
import pytest

import main
import sharing
from models import WorkspaceMember


@pytest.fixture(autouse=True)
def quiet_repo(monkeypatch):
    """Nothing in this file may reach a real database. A forgotten stub in this
    suite is a live query rather than an error — which is how the missing
    get_owned_workspaces stub announced itself on 2026-09-11."""
    monkeypatch.setattr(main.repository, "get_member_workspace_ids", lambda u: ["ws-1"])
    monkeypatch.setattr(main.repository, "get_workspace_members", lambda w: [])
    monkeypatch.setattr(main.repository, "get_profiles", lambda ids: {})
    monkeypatch.setattr(main.repository, "get_workspace_invites", lambda w: [])
    monkeypatch.setattr(main.repository, "get_workspace_activity",
                        lambda w, limit=100: [])


# ------------------------------------------------------------- membership


def test_listing_members_returns_names_from_profiles(monkeypatch):
    monkeypatch.setattr(main.repository, "get_workspace_members", lambda w: [
        WorkspaceMember(record_id="m-1", workspace_id="ws-1", user_id="user-1",
                        role="owner", notify_all=True),
        WorkspaceMember(record_id="m-2", workspace_id="ws-1", user_id="user-2"),
    ])
    monkeypatch.setattr(main.repository, "get_profiles", lambda ids: {
        "user-1": {"id": "user-1", "display_name": "Βαγγέλης", "email": "v@x.gr"},
        "user-2": {"id": "user-2", "display_name": "Μαρία", "email": "m@x.gr"},
    })

    result = main.list_workspace_members("ws-1", user_id="user-1")

    assert [m.display_name for m in result.members] == ["Βαγγέλης", "Μαρία"]
    assert result.members[0].role == "owner"
    assert result.members[0].notify_all is True


def test_a_member_with_no_profile_row_still_appears(monkeypatch):
    """A missing profile must not drop a person out of the list — they are in
    the room whether or not the trigger ever wrote their row."""
    monkeypatch.setattr(main.repository, "get_workspace_members", lambda w: [
        WorkspaceMember(workspace_id="ws-1", user_id="user-9"),
    ])
    monkeypatch.setattr(main.repository, "get_profiles", lambda ids: {})

    result = main.list_workspace_members("ws-1", user_id="user-1")

    assert len(result.members) == 1
    assert result.members[0].user_id == "user-9"
    assert result.members[0].display_name is None


def test_an_outsider_asking_who_is_in_a_room_gets_a_404(monkeypatch):
    """404, not 403, matching what the category endpoints already do:
    confirming that a workspace EXISTS is itself a leak."""
    monkeypatch.setattr(main.repository, "get_member_workspace_ids", lambda u: [])

    with pytest.raises(main.HTTPException) as e:
        main.list_workspace_members("ws-1", user_id="user-3")

    assert e.value.status_code == 404


def test_an_outsider_cannot_read_the_activity_log(monkeypatch):
    monkeypatch.setattr(main.repository, "get_member_workspace_ids", lambda u: [])

    with pytest.raises(main.HTTPException) as e:
        main.list_workspace_activity("ws-1", user_id="user-3")

    assert e.value.status_code == 404


def test_the_activity_limit_is_capped(monkeypatch):
    """A client asking for a million rows gets 500. The cap is server-side
    because the client is the thing that cannot be trusted to have one."""
    asked = {}

    def _activity(workspace_id, limit=100):
        asked["limit"] = limit
        return []

    monkeypatch.setattr(main.repository, "get_workspace_activity", _activity)

    main.list_workspace_activity("ws-1", limit=1_000_000, user_id="user-1")

    assert asked["limit"] == 500


# ---------------------------------------------------------------- invites


def test_creating_an_invite_returns_the_token_once(monkeypatch):
    monkeypatch.setattr(main.sharing, "create_invite", lambda u, w: {
        "token": "raw-secret",
        "invite": {"id": "inv-1", "expires_at": "2026-09-18T00:00:00Z"},
    })

    result = main.create_workspace_invite("ws-1", user_id="user-1")

    assert result.token == "raw-secret"
    assert result.invite_id == "inv-1"


def test_the_invite_list_carries_no_secret(monkeypatch):
    """The endpoint returns whatever the repository hands it, and the
    repository strips token_hash. This pins that the endpoint does not undo
    it by reaching for the raw row."""
    monkeypatch.setattr(main.repository, "get_workspace_invites", lambda w: [
        {"id": "inv-1", "role": "member", "expires_at": "2026-09-18T00:00:00Z"},
    ])

    result = main.list_workspace_invites("ws-1", user_id="user-1")

    assert "token" not in result.invites[0]
    assert "token_hash" not in result.invites[0]


def test_accepting_a_link_twice_reports_success(monkeypatch):
    monkeypatch.setattr(main.sharing, "accept_invite", lambda u, t: {
        "status": "already_member", "workspace_id": "ws-1"})

    result = main.accept_workspace_invite("tok", user_id="user-2")

    assert result.status == "already_member"


# ------------------------------------------------------- refusals over HTTP


def _handle(exc):
    import asyncio
    handler = main.app.exception_handlers[sharing.SharingError]
    return asyncio.run(handler(None, exc))


def test_a_dead_link_is_410_not_404():
    """410 Gone: the link existed, the colleague is not wrong to have tried,
    and it is finished. A 404 would send them hunting for a typo that is not
    there."""
    for code in ("invite_used", "invite_revoked", "invite_expired", "workspace_archived"):
        response = _handle(sharing.SharingError(code, "μήνυμα"))
        assert response.status_code == 410, code


def test_a_wrong_link_is_404():
    response = _handle(sharing.SharingError("invite_not_found", "μήνυμα"))

    assert response.status_code == 404


def test_not_being_the_owner_is_403():
    response = _handle(sharing.SharingError("not_owner", "μήνυμα"))

    assert response.status_code == 403


def test_removing_the_owner_is_409_because_it_is_a_conflict_not_a_permission():
    """The caller IS allowed to remove people; this particular person cannot be
    removed. 403 would say the wrong thing to the one person who has every
    right here."""
    response = _handle(sharing.SharingError("cannot_remove_owner", "μήνυμα"))

    assert response.status_code == 409


def test_every_refusal_carries_a_greek_message_and_a_code():
    """The message is for the person; the code is so the frontend can branch
    without matching on Greek text."""
    import json

    response = _handle(sharing.SharingError("invite_expired",
                                            "Ο σύνδεσμος έχει λήξει."))
    body = json.loads(bytes(response.body).decode("utf-8"))

    assert body["detail"] == "Ο σύνδεσμος έχει λήξει."
    assert body["code"] == "invite_expired"


def test_an_unmapped_code_falls_back_to_400_rather_than_500():
    """A new SharingError code added later must not become a server error while
    somebody forgets to update the table."""
    response = _handle(sharing.SharingError("something_new", "μήνυμα"))

    assert response.status_code == 400


def test_every_code_sharing_can_raise_has_a_status():
    """The fallback above keeps it from being a 500, but a code with no entry
    is still a decision nobody made. This is the list that must stay in step."""
    missing = set(sharing._MESSAGES) - set(main._SHARING_STATUS)

    assert not missing, f"no HTTP status decided for: {sorted(missing)}"


# --------------------------------------------------------- the activity log


def test_activity_rows_carry_the_actors_name(monkeypatch):
    """A log of ids is a record of what happened that cannot say who did it.
    The join has to happen HERE: the frontend only knows the people who are in
    the room now, and half of what a log is for is the ones who have left."""
    monkeypatch.setattr(main.repository, "get_workspace_activity", lambda w, limit=100: [
        {"id": "a-1", "actor_user_id": "user-2", "action": "member_joined",
         "task_name": None, "created_at": "2026-09-11T10:00:00Z"},
        {"id": "a-2", "actor_user_id": "user-1", "action": "task_assigned",
         "task_name": "Καθαρισμός Arachova", "created_at": "2026-09-11T09:00:00Z"},
    ])
    monkeypatch.setattr(main.repository, "get_profiles", lambda ids: {
        "user-1": {"id": "user-1", "display_name": "Βαγγέλης", "email": "v@x.gr"},
        "user-2": {"id": "user-2", "display_name": "Μαρία", "email": "m@x.gr"},
    })

    result = main.list_workspace_activity("ws-1", user_id="user-1")

    assert [r["actor_name"] for r in result.activity] == ["Μαρία", "Βαγγέλης"]
    # Nothing else about the row is disturbed — the verb and the remembered
    # task name are what keep a row readable after its task is gone.
    assert result.activity[1]["action"] == "task_assigned"
    assert result.activity[1]["task_name"] == "Καθαρισμός Arachova"


def test_an_actor_with_no_profile_falls_back_to_the_email(monkeypatch):
    monkeypatch.setattr(main.repository, "get_workspace_activity", lambda w, limit=100: [
        {"id": "a-1", "actor_user_id": "user-3", "action": "invite_created"},
    ])
    monkeypatch.setattr(main.repository, "get_profiles", lambda ids: {
        "user-3": {"id": "user-3", "display_name": None, "email": "kostas@x.gr"},
    })

    result = main.list_workspace_activity("ws-1", user_id="user-1")

    assert result.activity[0]["actor_name"] == "kostas@x.gr"


def test_a_departed_actor_leaves_the_name_empty_rather_than_inventing_one(monkeypatch):
    """actor_user_id is ON DELETE SET NULL. The row keeps its verb and its
    remembered task name; only the name is gone, and the screen says so in its
    own words rather than this guessing."""
    monkeypatch.setattr(main.repository, "get_workspace_activity", lambda w, limit=100: [
        {"id": "a-1", "actor_user_id": None, "action": "workspace_archived"},
    ])

    result = main.list_workspace_activity("ws-1", user_id="user-1")

    assert result.activity[0]["actor_name"] is None
    assert result.activity[0]["action"] == "workspace_archived"


def test_reading_the_log_is_a_members_right_and_nobody_elses(monkeypatch):
    monkeypatch.setattr(main.repository, "get_member_workspace_ids", lambda u: [])

    with pytest.raises(Exception):
        main.list_workspace_activity("ws-1", user_id="stranger")
