"""Connecting validates before it stores, and never echoes the secret back."""
import pytest
from fastapi import HTTPException

import crypto
import main


def _wire(monkeypatch, existing=None, token_ok=True, webhooks=None):
    state = {"saved": [], "deleted": [], "updated": [], "registered": [], "removed": []}

    monkeypatch.setenv("HOSTAWAY_ENCRYPTION_KEY", crypto.generate_key())
    monkeypatch.setattr(main.repository, "get_hostaway_connection", lambda u: existing)
    monkeypatch.setattr(
        main.repository, "upsert_hostaway_connection",
        lambda u, a, s, w: state["saved"].append((u, a, s, w)),
    )
    monkeypatch.setattr(main.repository, "update_hostaway_connection",
                        lambda u, updates: state["updated"].append(updates))
    monkeypatch.setattr(main.repository, "delete_hostaway_connection",
                        lambda u: state["deleted"].append(u))
    # Connecting now creates the locked Hostaway category (2026-09-03). Stubbed
    # like every other repository call here: unstubbed it reaches the REAL
    # Supabase, and the connect route swallows the failure — so the test would
    # pass while quietly making a network call on every run.
    monkeypatch.setattr(main.service, "ensure_integration_category",
                        lambda u, key, name: state.setdefault("categories", []).append((u, key)))

    def _token(credentials):
        if not token_ok:
            raise RuntimeError("401 Unauthorized")
        return "tok"

    monkeypatch.setattr(main.hostaway_integration, "get_access_token", _token)
    # The stored ciphertext in these fixtures is the literal "c"/"cipher", not
    # something crypto could decrypt — and disconnect swallows a decryption
    # failure by design, which would hide whether it removed the webhook.
    monkeypatch.setattr(
        main.hostaway_integration, "credentials_from_connection",
        lambda c: main.hostaway_integration.HostawayCredentials(c["account_id"], "decrypted"),
    )
    monkeypatch.setattr(
        main.hostaway_integration, "hostaway_register_webhook",
        lambda credentials, callback_url, password=None: (
            state["registered"].append((callback_url, password)) or 55555
        ),
    )
    monkeypatch.setattr(
        main.hostaway_integration, "hostaway_delete_webhook",
        lambda credentials, webhook_id: state["removed"].append(webhook_id) or True,
    )
    return state


def test_connecting_validates_then_stores(monkeypatch):
    state = _wire(monkeypatch)

    result = main.connect_hostaway(
        main.HostawayConnectRequest(account_id="147809", client_secret="s3cret"),
        user_id="user-1",
    )

    assert result["connected"] is True
    user_id, account_id, stored_secret, webhook_id = state["saved"][0]
    assert (user_id, account_id, webhook_id) == ("user-1", "147809", 55555)
    assert stored_secret != "s3cret", "the secret was stored in the clear"
    assert crypto.decrypt_secret(stored_secret) == "s3cret"
    # The locked category is born HERE and nowhere else, so that a user who
    # never touches Hostaway does not carry an undeletable category named after
    # a product they do not use. Asserted rather than merely stubbed: a wiring
    # that quietly stops being called is exactly the failure this suite has
    # already missed twice.
    assert state.get("categories") == [("user-1", "hostaway")]


def test_bad_credentials_store_nothing(monkeypatch):
    """A saved-but-broken connection is worse than no connection."""
    state = _wire(monkeypatch, token_ok=False)

    with pytest.raises(HTTPException) as raised:
        main.connect_hostaway(
            main.HostawayConnectRequest(account_id="147809", client_secret="wrong"),
            user_id="user-1",
        )

    assert raised.value.status_code == 400
    assert state["saved"] == []
    assert state["registered"] == []


def test_the_status_never_returns_the_secret(monkeypatch):
    _wire(monkeypatch, existing={
        "user_id": "user-1", "account_id": "147809",
        "client_secret_encrypted": "cipher", "webhook_id": 34986,
        "tasks_enabled": True, "auto_close_enabled": False,
    })

    status = main.get_hostaway_status(user_id="user-1")

    assert status == {
        "connected": True, "account_id": "147809",
        "webhook_registered": True, "webhook_url": main.HOSTAWAY_WEBHOOK_URL,
        "tasks_enabled": True, "auto_close_enabled": False,
    }
    assert "client_secret_encrypted" not in status


def test_no_connection_reports_disconnected(monkeypatch):
    _wire(monkeypatch, existing=None)
    assert main.get_hostaway_status(user_id="user-1")["connected"] is False


def test_a_broken_encryption_key_blames_the_server_not_the_user(monkeypatch):
    """
    HOSTAWAY_ENCRYPTION_KEY missing or wrong is a server misconfiguration, and
    it lands AFTER the credentials have already been accepted by Hostaway. It
    used to escape as a bare 500, which the screen reported as "Hostaway did
    not accept those details" — sending the owner off to re-check credentials
    that were provably fine.
    """
    state = _wire(monkeypatch)
    monkeypatch.setattr(main.crypto, "encrypt_secret",
                        lambda s: (_ for _ in ()).throw(RuntimeError("key not set")))

    with pytest.raises(HTTPException) as caught:
        main.connect_hostaway(
            main.HostawayConnectRequest(account_id="147809", client_secret="s3cret"),
            user_id="user-1",
        )

    assert caught.value.status_code == 500, "a 400 would read as 'your details are wrong'"
    assert "HOSTAWAY_ENCRYPTION_KEY" in caught.value.detail
    assert state["saved"] == [], "a connection was stored without an encrypted secret"


def test_a_connection_without_a_webhook_says_so_on_every_read(monkeypatch):
    """
    webhook_id NULL means registration failed: the row exists, and not one
    guest message reaches it. Until 2026-09-20 this was reported only in the
    POST response, so after a reload the screen showed the same green tick as
    a working connection — which is how the owner ended up with a connection
    he believed was fine while Hostaway had no webhook at all.
    """
    _wire(monkeypatch, existing={
        "user_id": "user-1", "account_id": "147809",
        "client_secret_encrypted": "cipher", "webhook_id": None,
        "tasks_enabled": True, "auto_close_enabled": True,
    })

    status = main.get_hostaway_status(user_id="user-1")

    assert status["connected"] is True
    assert status["webhook_registered"] is False
    assert status["webhook_url"], "the screen needs the URL to offer the manual fix"


def test_a_switch_can_be_changed_alone(monkeypatch):
    state = _wire(monkeypatch, existing={"user_id": "user-1", "account_id": "147809",
                                         "client_secret_encrypted": "c", "webhook_id": 1,
                                         "tasks_enabled": True, "auto_close_enabled": True})

    main.update_hostaway_switches(
        main.HostawaySwitchesRequest(auto_close_enabled=False), user_id="user-1"
    )

    assert state["updated"] == [{"auto_close_enabled": False}]


def test_disconnecting_removes_the_webhook_then_the_row(monkeypatch):
    state = _wire(monkeypatch, existing={"user_id": "user-1", "account_id": "147809",
                                         "client_secret_encrypted": "c", "webhook_id": 34986,
                                         "tasks_enabled": True, "auto_close_enabled": True})

    result = main.disconnect_hostaway(user_id="user-1")

    assert state["removed"] == [34986]
    assert state["deleted"] == ["user-1"]
    assert result["connected"] is False


def test_disconnecting_still_deletes_the_row_if_hostaway_refuses(monkeypatch):
    """A webhook we cannot remove must not trap the user in a connection."""
    state = _wire(monkeypatch, existing={"user_id": "user-1", "account_id": "147809",
                                         "client_secret_encrypted": "c", "webhook_id": 34986,
                                         "tasks_enabled": True, "auto_close_enabled": True})
    monkeypatch.setattr(main.hostaway_integration, "hostaway_delete_webhook",
                        lambda credentials, webhook_id: (_ for _ in ()).throw(RuntimeError("boom")))

    main.disconnect_hostaway(user_id="user-1")

    assert state["deleted"] == ["user-1"]


# --- the registration itself, which the tests above deliberately fake out ---

class _Resp:
    def __init__(self, payload, status_code=200):
        self._payload, self.status_code = payload, status_code

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def test_connecting_twice_reuses_the_existing_webhook(monkeypatch):
    """
    Otherwise every reconnect adds another webhook and the same guest message
    arrives twice, three times, five times — each one creating its own task.
    """
    import hostaway_integration as hi

    posted = []
    url = "https://ai-todo-app-sdq8.onrender.com/webhooks/hostaway"

    monkeypatch.setattr(hi, "get_access_token", lambda credentials: "tok")
    monkeypatch.setattr(hi.requests, "get", lambda *a, **kw: _Resp(
        {"result": [{"id": 34986, "url": url, "events": ["message.received"],
                     "login": hi.HOSTAWAY_WEBHOOK_LOGIN}]}
    ))
    monkeypatch.setattr(hi.requests, "post", lambda *a, **kw: posted.append(kw) or _Resp(
        {"result": {"id": 99999}}
    ))

    webhook_id = hi.hostaway_register_webhook(
        hi.HostawayCredentials("147809", "s"), url, password="shh"
    )

    assert webhook_id == 34986
    assert posted == [], "a second webhook was created for the same URL"


def test_a_webhook_without_credentials_is_replaced_rather_than_reused(monkeypatch):
    """
    The webhook registered before authentication existed carries no login.
    Reusing it would report a successful connection while leaving the account
    permanently open — the silent failure the whole change exists to remove.
    """
    import hostaway_integration as hi

    deleted, sent = [], {}
    url = "https://ai-todo-app-sdq8.onrender.com/webhooks/hostaway"

    monkeypatch.setattr(hi, "get_access_token", lambda credentials: "tok")
    monkeypatch.setattr(hi.requests, "get", lambda *a, **kw: _Resp(
        {"result": [{"id": 34986, "url": url, "events": ["message.received"]}]}
    ))
    monkeypatch.setattr(hi.requests, "delete",
                        lambda u, **kw: deleted.append(u) or _Resp({}, status_code=200))

    def _post(post_url, headers=None, timeout=None, json=None):
        sent["json"] = json
        return _Resp({"result": {"id": 99999}})

    monkeypatch.setattr(hi.requests, "post", _post)

    webhook_id = hi.hostaway_register_webhook(
        hi.HostawayCredentials("147809", "s"), url, password="shh"
    )

    assert webhook_id == 99999, "the credential-less webhook was reused"
    assert any("34986" in str(u) for u in deleted), "the old webhook was left behind"
    assert sent["json"]["password"] == "shh"
    assert sent["json"]["login"] == hi.HOSTAWAY_WEBHOOK_LOGIN


def test_registering_sends_the_credentials(monkeypatch):
    """Without these two fields Hostaway sends no Authorization header, and
    every delivery is refused on arrival."""
    import hostaway_integration as hi

    sent = {}
    url = "https://ai-todo-app-sdq8.onrender.com/webhooks/hostaway"

    monkeypatch.setattr(hi, "get_access_token", lambda credentials: "tok")
    monkeypatch.setattr(hi.requests, "get", lambda *a, **kw: _Resp({"result": []}))

    def _post(post_url, headers=None, timeout=None, json=None):
        sent["json"] = json
        return _Resp({"result": {"id": 99999}})

    monkeypatch.setattr(hi.requests, "post", _post)

    hi.hostaway_register_webhook(
        hi.HostawayCredentials("147809", "s"), url, password="the-shared-secret"
    )

    assert sent["json"]["login"] == hi.HOSTAWAY_WEBHOOK_LOGIN
    assert sent["json"]["password"] == "the-shared-secret"


def test_registering_without_a_secret_sends_no_credentials(monkeypatch):
    """
    HOSTAWAY_WEBHOOK_SECRET unset. The webhook is still created — refusing
    would leave the user with no connection at all — but it carries no
    credentials, and the endpoint will reject its deliveries. The error log is
    the only place that says why, so it is part of the behaviour.
    """
    import hostaway_integration as hi

    sent = {}
    url = "https://ai-todo-app-sdq8.onrender.com/webhooks/hostaway"

    monkeypatch.setattr(hi, "get_access_token", lambda credentials: "tok")
    monkeypatch.setattr(hi.requests, "get", lambda *a, **kw: _Resp({"result": []}))

    def _post(post_url, headers=None, timeout=None, json=None):
        sent["json"] = json
        return _Resp({"result": {"id": 99999}})

    monkeypatch.setattr(hi.requests, "post", _post)

    hi.hostaway_register_webhook(hi.HostawayCredentials("147809", "s"), url, password=None)

    assert "login" not in sent["json"]
    assert "password" not in sent["json"]


def test_a_first_connection_creates_the_webhook(monkeypatch):
    import hostaway_integration as hi

    sent = {}
    url = "https://ai-todo-app-sdq8.onrender.com/webhooks/hostaway"

    monkeypatch.setattr(hi, "get_access_token", lambda credentials: "tok")
    monkeypatch.setattr(hi.requests, "get", lambda *a, **kw: _Resp(
        {"result": [{"id": 1, "url": "https://someone-else.example/hook"}]}
    ))

    def _post(post_url, headers=None, timeout=None, json=None):
        sent["json"] = json
        return _Resp({"result": {"id": 99999}})

    monkeypatch.setattr(hi.requests, "post", _post)

    webhook_id = hi.hostaway_register_webhook(hi.HostawayCredentials("147809", "s"), url)

    assert webhook_id == 99999
    assert sent["json"]["url"] == url
    assert sent["json"]["events"] == ["message.received"]
