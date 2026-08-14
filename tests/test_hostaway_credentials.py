"""
Two accounts, two tokens. The old module-global token was the hardcoded
single user wearing a different hat.
"""
import crypto
import hostaway_integration as hi


def _connection(account_id="147809", secret="plain-secret"):
    return {
        "user_id": "user-1",
        "account_id": account_id,
        "client_secret_encrypted": crypto.encrypt_secret(secret),
        "webhook_id": 34986,
        "tasks_enabled": True,
        "auto_close_enabled": True,
    }


def test_credentials_come_out_of_a_connection_decrypted(monkeypatch):
    monkeypatch.setenv("HOSTAWAY_ENCRYPTION_KEY", crypto.generate_key())
    creds = hi.credentials_from_connection(_connection(secret="plain-secret"))

    assert creds.account_id == "147809"
    assert creds.client_secret == "plain-secret"


def test_each_account_gets_its_own_token(monkeypatch):
    """One cache keyed by account, not one token for the process."""
    posted = []

    class _Response:
        def __init__(self, token):
            self._token = token

        def raise_for_status(self):
            pass

        def json(self):
            return {"access_token": self._token}

    def _fake_post(url, data=None, headers=None, timeout=None):
        posted.append(data["client_id"])
        return _Response(f"token-for-{data['client_id']}")

    monkeypatch.setattr(hi.requests, "post", _fake_post)
    hi.clear_token_cache()

    a = hi.get_access_token(hi.HostawayCredentials("147809", "secret-a"))
    b = hi.get_access_token(hi.HostawayCredentials("222222", "secret-b"))

    assert a == "token-for-147809"
    assert b == "token-for-222222"
    assert posted == ["147809", "222222"]


def test_a_second_call_for_the_same_account_reuses_the_token(monkeypatch):
    posted = []

    class _Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"access_token": "cached"}

    def _fake_post(url, data=None, headers=None, timeout=None):
        posted.append(1)
        return _Response()

    monkeypatch.setattr(hi.requests, "post", _fake_post)
    hi.clear_token_cache()

    hi.get_access_token(hi.HostawayCredentials("147809", "s"))
    hi.get_access_token(hi.HostawayCredentials("147809", "s"))

    assert len(posted) == 1, "the token was fetched twice for one account"


def test_messages_are_fetched_with_that_accounts_token(monkeypatch):
    seen = {}

    class _Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"result": [{"date": "2026-08-13 10:00:00", "isIncoming": 1}]}

    def _fake_get(url, headers=None, timeout=None):
        seen["url"] = url
        seen["auth"] = headers["Authorization"]
        return _Response()

    monkeypatch.setattr(hi, "get_access_token", lambda creds: f"tok-{creds.account_id}")
    monkeypatch.setattr(hi.requests, "get", _fake_get)

    messages = hi.get_conversation_messages(49446111, hi.HostawayCredentials("147809", "s"))

    assert len(messages) == 1
    assert seen["url"].endswith("/v1/conversations/49446111/messages")
    assert seen["auth"] == "Bearer tok-147809"


def test_a_failed_message_fetch_returns_empty(monkeypatch):
    """Fail toward 'no reply seen': the task stays open, never wrongly closed."""
    def _boom(url, headers=None, timeout=None):
        raise RuntimeError("hostaway is down")

    monkeypatch.setattr(hi, "get_access_token", lambda creds: "tok")
    monkeypatch.setattr(hi.requests, "get", _boom)

    assert hi.get_conversation_messages(1, hi.HostawayCredentials("147809", "s")) == []
