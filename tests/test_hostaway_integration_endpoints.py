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
        lambda credentials, callback_url: state["registered"].append(callback_url) or 55555,
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
        "tasks_enabled": True, "auto_close_enabled": False,
    }
    assert "client_secret_encrypted" not in status


def test_no_connection_reports_disconnected(monkeypatch):
    _wire(monkeypatch, existing=None)
    assert main.get_hostaway_status(user_id="user-1")["connected"] is False


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
        {"result": [{"id": 34986, "url": url, "events": ["message.received"]}]}
    ))
    monkeypatch.setattr(hi.requests, "post", lambda *a, **kw: posted.append(kw) or _Resp(
        {"result": {"id": 99999}}
    ))

    webhook_id = hi.hostaway_register_webhook(hi.HostawayCredentials("147809", "s"), url)

    assert webhook_id == 34986
    assert posted == [], "a second webhook was created for the same URL"


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
