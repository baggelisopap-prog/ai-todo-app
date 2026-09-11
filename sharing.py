"""
Invitations, membership and archiving — the rules that decide who is in a room.

Three things live here rather than in repository.py, deliberately:

  - **Why a link failed.** A repository function that returned None for an
    expired invite could not tell a used one from a revoked one from a typo,
    and "that did not work" is the difference between a colleague retrying and
    a colleague phoning the owner.
  - **The order of operations.** Removing somebody unassigns their work BEFORE
    the membership row goes, so the activity entry is still written by
    somebody who was in the room.
  - **The raw token.** It is minted here, hashed here, and handed back to the
    caller exactly once. Nothing below this module ever sees it.

Design: docs/superpowers/specs/2026-09-11-multi-user-workspace-sharing-design.md
"""
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import repository

logger = logging.getLogger(__name__)

# Seven days. Long enough that a colleague can join over a weekend, short
# enough that a link forwarded into a group chat months ago is dead.
INVITE_TTL_DAYS = 7

# 32 bytes of randomness, url-safe. This IS the whole secret — there is no
# second factor and no rate limit in front of it — so it has to be long enough
# that guessing is not a strategy.
_TOKEN_BYTES = 32


class SharingError(Exception):
    """
    Carries a machine-readable `code` AND a Greek `message`.

    The code is what main.py and the tests branch on; the message is what the
    person who tapped the link actually reads. Keeping both on the exception
    means the reason survives the trip up through the layers — the thing a bare
    boolean return would have thrown away.
    """

    def __init__(self, code: str, message: str):
        super().__init__(code)
        self.code = code
        self.message = message


_MESSAGES = {
    "not_owner": "Μόνο ο ιδιοκτήτης του workspace μπορεί να το κάνει αυτό.",
    "invite_not_found": "Ο σύνδεσμος δεν είναι έγκυρος.",
    "invite_used": "Ο σύνδεσμος έχει ήδη χρησιμοποιηθεί.",
    "invite_revoked": "Ο σύνδεσμος ακυρώθηκε.",
    "invite_expired": "Ο σύνδεσμος έχει λήξει.",
    "workspace_archived": "Το workspace έχει αρχειοθετηθεί.",
    "workspace_not_found": "Το workspace δεν βρέθηκε.",
    "cannot_remove_owner": "Ο ιδιοκτήτης δεν μπορεί να αφαιρεθεί από το δικό του workspace.",
    "owner_cannot_leave": "Ο ιδιοκτήτης δεν μπορεί να αποχωρήσει από το δικό του workspace. Αρχειοθέτησέ το.",
    "not_a_member": "Δεν είσαι μέλος αυτού του workspace.",
    "assignee_not_a_member": "Αυτό το άτομο δεν είναι μέλος του workspace. Κάλεσέ το πρώτα.",
    "assignee_needs_a_workspace": "Βάλε πρώτα το task σε ένα workspace, και μετά ανάθεσέ το.",
}


def _fail(code: str) -> None:
    raise SharingError(code, _MESSAGES[code])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_owner(user_id: str, workspace_id: str) -> None:
    if not repository.is_workspace_owner(user_id, workspace_id):
        _fail("not_owner")


# ------------------------------------------------------------------ tokens


def mint_invite_token() -> tuple[str, str]:
    """Returns (raw, hash). The raw value is shown to the owner once and is
    unrecoverable afterwards — only the hash is stored."""
    raw = secrets.token_urlsafe(_TOKEN_BYTES)
    return raw, hash_invite_token(raw)


def hash_invite_token(raw: str) -> str:
    """sha256, no salt and no stretching — unlike a password this is already
    32 bytes of uniform randomness, so there is no dictionary to defend
    against and a slow hash would only slow the person accepting."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ----------------------------------------------------------------- invites


def create_invite(user_id: str, workspace_id: str, role: str = "member") -> dict:
    """
    Returns {"token": <raw>, "invite": {...}}. The raw token appears in this
    return value and nowhere else, ever again.
    """
    _require_owner(user_id, workspace_id)

    raw, hashed = mint_invite_token()
    expires_at = (_now() + timedelta(days=INVITE_TTL_DAYS)).isoformat()

    invite = repository.create_workspace_invite(
        workspace_id=workspace_id,
        invited_by=user_id,
        token_hash=hashed,
        role=role,
        expires_at=expires_at,
    )
    repository.log_workspace_activity(
        workspace_id=workspace_id, actor_user_id=user_id, action="invite_created",
    )
    # The hash is NOT echoed back. This return value goes to the endpoint and
    # on to the phone, and a field that reaches the API is a field somebody
    # eventually logs. What was stored is asserted at the repository call.
    return {"token": raw, "invite": invite}


def accept_invite(user_id: str, raw_token: str) -> dict:
    """
    Turns a link into a membership.

    Every refusal names itself, because the person holding the link cannot see
    the database and the owner will be asked why it did not work.
    """
    invite = repository.get_invite_by_token_hash(hash_invite_token(raw_token))
    if not invite:
        _fail("invite_not_found")
    if invite.get("accepted_at"):
        _fail("invite_used")
    if invite.get("revoked_at"):
        _fail("invite_revoked")

    expires_at = invite.get("expires_at")
    if expires_at and _parse(expires_at) < _now():
        _fail("invite_expired")

    workspace_id = invite["workspace_id"]
    workspace = repository.get_workspace_row(workspace_id)
    if not workspace:
        _fail("workspace_not_found")
    if workspace.get("archived_at"):
        # Otherwise somebody joins a room that is not there and sees an empty
        # app with nothing explaining why.
        _fail("workspace_archived")

    if workspace_id in repository.get_member_workspace_ids(user_id):
        # A colleague tapping the WhatsApp link twice is not an error, and it
        # must not consume a second invitation either.
        return {"status": "already_member", "workspace_id": workspace_id}

    repository.add_workspace_member(workspace_id, user_id, invite.get("role", "member"))
    repository.mark_invite_accepted(invite["id"], user_id, _now().isoformat())
    repository.log_workspace_activity(
        workspace_id=workspace_id, actor_user_id=user_id, action="member_joined",
    )
    logger.info(f"[sharing] {user_id} joined {workspace_id} via invite {invite['id']}")
    return {"status": "joined", "workspace_id": workspace_id}


def revoke_invite(user_id: str, workspace_id: str, invite_id: str) -> None:
    _require_owner(user_id, workspace_id)
    repository.revoke_workspace_invite(invite_id, _now().isoformat())
    repository.log_workspace_activity(
        workspace_id=workspace_id, actor_user_id=user_id, action="invite_revoked",
    )


def _parse(value: str) -> datetime:
    """Postgres hands timestamps back with a 'Z' that fromisoformat refused
    until 3.11 and still will not take in every shape, so normalise it."""
    text = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


# -------------------------------------------------------------- membership


def remove_member(actor_user_id: str, workspace_id: str, member_user_id: str) -> None:
    """
    Takes somebody out of a room and leaves their work behind, unclaimed.

    The owner cannot be removed from their own workspace: there would be nobody
    left who could invite, archive or administer it. The owner's way out is to
    archive the workspace, which is a different act with a different name.
    """
    _require_owner(actor_user_id, workspace_id)
    if repository.is_workspace_owner(member_user_id, workspace_id):
        _fail("cannot_remove_owner")

    # Unassign FIRST. Both orders work as far as the tables are concerned, but
    # this way the activity entry is written while the person is still in the
    # room it belongs to.
    repository.unassign_tasks_for_member(workspace_id, member_user_id)
    repository.remove_workspace_member(workspace_id, member_user_id)
    repository.log_workspace_activity(
        workspace_id=workspace_id, actor_user_id=actor_user_id, action="member_removed",
        details={"member": member_user_id},
    )


def leave_workspace(user_id: str, workspace_id: str) -> None:
    """The same mechanic as removal, chosen by the person leaving. It earns its
    place the first time a workspace is shared with somebody who is not an
    employee — an accountant, a partner, a spouse."""
    if repository.is_workspace_owner(user_id, workspace_id):
        _fail("owner_cannot_leave")
    if workspace_id not in repository.get_member_workspace_ids(user_id):
        _fail("not_a_member")

    repository.unassign_tasks_for_member(workspace_id, user_id)
    repository.remove_workspace_member(workspace_id, user_id)
    repository.log_workspace_activity(
        workspace_id=workspace_id, actor_user_id=user_id, action="member_left",
    )


def set_notify_all(user_id: str, workspace_id: str, enabled: bool) -> None:
    """The switch for an owner who wants the team's reminders as well as their
    own — «για έναν υπεελεγχτικο προιστάμενο». Per workspace, and it is the
    caller's OWN membership row, so no ownership check: anyone may decide how
    loud their own phone is."""
    if workspace_id not in repository.get_member_workspace_ids(user_id):
        _fail("not_a_member")
    repository.set_member_notify_all(workspace_id, user_id, enabled)


# -------------------------------------------------------------- assignment


def validate_assignment(workspace_id, assignee_user_id) -> None:
    """
    You may only hand work to somebody who is in the room.

    Without this rule a task can carry an assignee who cannot see it, will
    never be notified about it and cannot complete it — handed over in
    appearance only, which is worse than not handed over at all.

    Clearing (assignee_user_id is None) is always allowed and is checked FIRST:
    putting work back on the pile needs nobody's permission, and running None
    through a membership test would refuse it.

    An unfiled task gets its own refusal rather than falling through to the
    membership one, which would say something untrue — the problem is not that
    the person is missing from the room, it is that there is no room.
    """
    if assignee_user_id is None:
        return
    if not workspace_id:
        _fail("assignee_needs_a_workspace")
    if workspace_id not in repository.get_member_workspace_ids(assignee_user_id):
        _fail("assignee_not_a_member")


# --------------------------------------------------------------- archiving


def archive_workspace(user_id: str, workspace_id: str) -> None:
    """
    Replaces deleting. Work is never lost — the owner's rule.

    NOTHING IS UNLINKED. Tasks keep their workspace_id, category_id and
    assigned_to, which is the whole difference from deleting: restoring brings
    back the organisation and not just the rows.

    The settings repoint is the half that is easy to forget, and it must reach
    every member rather than only the owner.
    """
    _require_owner(user_id, workspace_id)

    repository.set_workspace_archived(user_id, workspace_id, _now().isoformat())
    repository.clear_workspace_from_all_settings(
        workspace_id, fallback_default=_business_workspace_id(user_id)
    )
    repository.log_workspace_activity(
        workspace_id=workspace_id, actor_user_id=user_id, action="workspace_archived",
    )


def restore_workspace(user_id: str, workspace_id: str) -> None:
    """One write. Everything comes back because nothing was taken apart."""
    _require_owner(user_id, workspace_id)

    repository.set_workspace_archived(user_id, workspace_id, None)
    repository.log_workspace_activity(
        workspace_id=workspace_id, actor_user_id=user_id, action="workspace_restored",
    )


def _business_workspace_id(user_id: str) -> Optional[str]:
    """
    Where default_workspace_id falls back to when its workspace is archived.

    Business, because ensure_account_workspaces guarantees every account has
    one. Returns None if it cannot be found, which leaves the setting empty —
    honest, and better than pointing the extractor at an arbitrary workspace.
    """
    try:
        for workspace in repository.get_workspaces(user_id):
            if workspace.name == "Business":
                return workspace.record_id
    except Exception as e:
        logger.error(f"[sharing] could not resolve a fallback workspace: {e}")
    return None
