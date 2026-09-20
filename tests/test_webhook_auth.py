"""
The webhook is the only endpoint without a bearer token, and until
2026-09-20 it had nothing in its place.

Hostaway is a server: it has no account here and nobody to log in as, so it
authenticates with a shared secret instead — the `login`/`password` pair it
sends as HTTP Basic credentials on every delivery. What made the gap worth
closing is that neither half of "who are you" was secret: the URL is printed
in the app's own Settings screen, and `accountId` is a six-digit identifier
from the user's Hostaway settings page. Anyone could invent guest messages,
spend a Gemini call per message, and complete real P3 tasks through the
outgoing-message path.

The cost test at the bottom is the one that matters most: a rejection that
happens AFTER the classification would still be paid for.
"""
import asyncio
import base64

import pytest

import main

SECRET = "the-shared-secret"


def _headers(login=None, password=None, raw=None):
    if raw is not None:
        return {"authorization": raw}
    login = main.hostaway_integration.HOSTAWAY_WEBHOOK_LOGIN if login is None else login
    password = SECRET if password is None else password
    pair = f"{login}:{password}"
    return {"authorization": "Basic " + base64.b64encode(pair.encode()).decode()}


class _FakeRequest:
    def __init__(self, headers):
        self.headers = headers
        self.client = None

    async def json(self):
        return _INCOMING


_INCOMING = {
    "event": "message.received",
    "accountId": 147809,
    "data": {
        "isIncoming": 1, "body": "δεν βρίσκω τα κλειδιά", "conversationId": 49446111,
        "date": "2026-09-20 16:00:00", "listingMapId": 410175, "reservationId": 64375741,
    },
}


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setattr(main, "HOSTAWAY_WEBHOOK_SECRET", SECRET)


def _post(headers):
    return asyncio.run(main.hostaway_webhook(_FakeRequest(headers)))


def _expect_401(headers):
    with pytest.raises(main.HTTPException) as caught:
        _post(headers)
    assert caught.value.status_code == 401
    return caught.value


# --- what gets turned away ----------------------------------------------

def test_no_authorization_header_is_refused():
    """Today's attacker: an ordinary POST with a JSON body and nothing else."""
    _expect_401({})


def test_the_wrong_password_is_refused():
    _expect_401(_headers(password="not-the-secret"))


def test_the_wrong_login_is_refused():
    _expect_401(_headers(login="somebody-else"))


def test_an_empty_password_is_refused():
    """A webhook registered with the login filled in and the password left
    blank would otherwise authenticate on an empty string."""
    _expect_401(_headers(password=""))


def test_a_bearer_token_is_refused():
    """Basic is the only scheme Hostaway sends. A bearer token here is either
    a confused caller or someone probing."""
    _expect_401({"authorization": "Bearer " + SECRET})


def test_the_bare_secret_without_a_scheme_is_refused():
    _expect_401({"authorization": SECRET})


def test_malformed_base64_is_refused_rather_than_crashing():
    """A 500 here is its own problem: Hostaway disables a webhook that keeps
    failing, so a malformed probe could cost us the integration."""
    _expect_401({"authorization": "Basic !!!not-base64!!!"})


def test_base64_without_a_colon_is_refused():
    """`partition` returns the whole string and an empty password on a
    missing colon — which must not be read as "the password was empty"."""
    encoded = base64.b64encode(b"no-colon-here").decode()
    _expect_401({"authorization": f"Basic {encoded}"})


def test_non_utf8_credentials_are_refused_rather_than_crashing():
    encoded = base64.b64encode(b"\xff\xfe\x00bad").decode()
    _expect_401({"authorization": f"Basic {encoded}"})


def test_an_unset_secret_refuses_everything(monkeypatch):
    """
    Fails CLOSED, like run_scheduler. Waving deliveries through when the
    variable is missing is how an endpoint stays open because of a
    deployment slip — silently, and for as long as nobody looks.
    """
    monkeypatch.setattr(main, "HOSTAWAY_WEBHOOK_SECRET", None)
    _expect_401(_headers())


def test_an_unset_secret_refuses_an_empty_header_too(monkeypatch):
    monkeypatch.setattr(main, "HOSTAWAY_WEBHOOK_SECRET", "")
    _expect_401({})


# --- what gets through ---------------------------------------------------

def test_the_right_credentials_reach_the_handler(monkeypatch):
    """The other side of every test above: the real Hostaway still gets in."""
    monkeypatch.setattr(main.repository, "get_hostaway_connections_for_account",
                        lambda account_id: [])

    result = _post(_headers())

    assert result["status"] == "ignored"
    assert result["reason"] == "no connection wants this message"


# --- the part that costs money ------------------------------------------

def test_a_rejected_delivery_costs_no_gemini_call(monkeypatch):
    """
    The whole point. One Gemini call per invented message is the bill an open
    webhook runs up, so the check has to sit above the classification — not
    merely somewhere in the function.
    """
    spend = []
    monkeypatch.setattr(main.hostaway_integration, "classify_message",
                        lambda text, user_id: spend.append(text) or {})
    monkeypatch.setattr(main.repository, "get_hostaway_connections_for_account",
                        lambda account_id: (_ for _ in ()).throw(
                            AssertionError("the database was reached before authentication")
                        ))

    _expect_401({})

    assert spend == [], "a rejected delivery still paid for a classification"


def test_a_rejected_delivery_never_reads_the_body(monkeypatch):
    """
    Above the JSON parse as well. A body that is never read cannot be a
    parser's problem, and the check stays cheap under a flood.
    """
    class _ExplodingRequest:
        headers = {}
        client = None

        async def json(self):
            raise AssertionError("the payload was parsed before authentication")

    with pytest.raises(main.HTTPException) as caught:
        asyncio.run(main.hostaway_webhook(_ExplodingRequest()))
    assert caught.value.status_code == 401


def test_a_rejected_delivery_cannot_complete_a_task(monkeypatch):
    """
    The outgoing path completes P3 tasks on a human reply. Unauthenticated,
    that is a stranger deleting work off the owner's list — quieter than a
    flood of fake tasks, and worse.
    """
    closed = []
    monkeypatch.setattr(main.repository, "update_hostaway_thread_fields",
                        lambda u, r, updates: closed.append(updates))

    outgoing = {
        "event": "message.received",
        "accountId": 147809,
        "data": {"isIncoming": 0, "userId": 990952, "conversationId": 49446111,
                 "date": "2026-09-20 16:05:00"},
    }

    class _OutgoingRequest:
        headers = {}
        client = None

        async def json(self):
            return outgoing

    with pytest.raises(main.HTTPException) as caught:
        asyncio.run(main.hostaway_webhook(_OutgoingRequest()))

    assert caught.value.status_code == 401
    assert closed == [], "an unauthenticated caller completed a task"
