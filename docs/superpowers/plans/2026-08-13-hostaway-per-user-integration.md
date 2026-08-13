# Per-user Hostaway Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any user connects their own Hostaway account from Settings, with two switches to turn task creation and auto-completion off — replacing the single hardcoded user and the one credential pair in `.env`.

**Architecture:** A new `hostaway_connections` table keyed by `user_id` (unique) and `account_id` (indexed, NOT unique — fifteen colleagues share one Hostaway account). Every Hostaway API call takes the caller's credentials instead of reading `.env`. An inbound webhook looks up every connection for its `accountId` and creates one task per colleague from a single classification. Secrets are Fernet-encrypted with a key from the environment.

**Tech Stack:** FastAPI, Supabase (postgrest-py), pydantic v2, pytest, React + Tailwind, `cryptography` (already a declared dependency via pywebpush).

## Global Constraints

- **Design doc**: `docs/superpowers/specs/2026-08-13-hostaway-per-user-integration-design.md`. Read it before starting.
- **The webhook must always return HTTP 200**, including for unknown accounts and disabled switches. Hostaway disables endpoints that fail repeatedly.
- **Never log a secret, decrypted or encrypted.** Never return one from an endpoint.
- **`requirements.txt` is UTF-16LE and ships to Render — do not edit it.** `cryptography==48.0.0` is already declared. No new dependency is needed.
- **Supabase rejects a write containing an unknown column wholesale.** Any new column must exist in the database before code that writes it deploys.
- **Endpoints are `def`, not `async def`**, unless they genuinely `await` — see `docs/ARCHITECTURE.md`. Every body in this plan is synchronous.
- **Tests run with:** `PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -m pytest tests/ -q`
- **The suite is green at 65 tests before this plan starts.** It must be green after every task.
- **Commit straight to `main`.** No feature branches. The implementer cannot `git push` — leave that to the owner.

---

## File Structure

| File | Responsibility |
|---|---|
| `crypto.py` *(new)* | Fernet encrypt/decrypt of a single secret string. Nothing else. |
| `repository.py` *(modify)* | CRUD for `hostaway_connections`. No business rules. |
| `hostaway_integration.py` *(modify)* | Every Hostaway HTTP call, now credential-bearing. Plus webhook registration/removal. |
| `main.py` *(modify)* | The webhook fan-out and the four `/integrations/hostaway` endpoints. |
| `services.py` *(modify)* | The reply poller reads the connection and honours `auto_close_enabled`. |
| `migrate_owner_hostaway.py` *(new, root)* | One-off: writes the owner's row from `.env`. Matches `migrate_to_supabase.py`'s placement. |
| `frontend/src/api.js` *(modify)* | Four typed wrappers over the endpoints. |
| `frontend/src/components/SettingsModal.jsx` *(modify)* | `HostawayConnectionView`, modelled on `CalendarConnectionView`. |
| `frontend/src/locales/{en,el}.json` *(modify)* | Strings for the screen and both switches. |

---

## Task 1: Confirm Hostaway's webhook write API

**This task is a question, not code.** §4 of the design assumes `POST` and `DELETE` work on `/v1/webhooks/unifiedWebhooks`. Only `GET` has ever been called. Everything in Task 7 is built on the answer.

**STOP — this task writes to the owner's live Hostaway account. Get his explicit go-ahead before running it.** It creates a webhook pointing at a URL that receives nothing, then deletes it.

**Files:**
- Create: `docs/migrations/2026-08-13-hostaway-connections.sql` — already written, verify it exists
- Modify: `docs/superpowers/specs/2026-08-13-hostaway-per-user-integration-design.md` (the verified/assumed table)

- [ ] **Step 1: Run the probe**

```python
# scratchpad only — do not commit this file
import os, json, requests
from dotenv import load_dotenv
load_dotenv(".env")

r = requests.post("https://api.hostaway.com/v1/accessTokens", data={
    "grant_type": "client_credentials",
    "client_id": os.getenv("HOSTAWAY_CLIENT_ID"),
    "client_secret": os.getenv("HOSTAWAY_CLIENT_SECRET"),
    "scope": "general",
}, headers={"Content-type": "application/x-www-form-urlencoded"}, timeout=20)
r.raise_for_status()
h = {"Authorization": "Bearer " + r.json()["access_token"], "Content-type": "application/json"}

created = requests.post(
    "https://api.hostaway.com/v1/webhooks/unifiedWebhooks",
    headers=h, timeout=20,
    json={"url": "https://example.invalid/throwaway-probe", "isEnabled": 0,
          "events": ["message.received"]},
)
print("POST ->", created.status_code, json.dumps(created.json(), indent=2)[:800])

if created.status_code < 300:
    webhook_id = created.json()["result"]["id"]
    gone = requests.delete(
        f"https://api.hostaway.com/v1/webhooks/unifiedWebhooks/{webhook_id}",
        headers=h, timeout=20)
    print("DELETE ->", gone.status_code, gone.text[:300])
```

- [ ] **Step 2: Record the answer in the spec's verified/assumed table**

Replace the `POST and DELETE` row with what actually happened: the status codes, the exact response shape, and the field the new id arrives in. If either verb is unsupported, write that down and **switch Task 7 to the §4.3 fallback** — the connection is stored, the endpoint returns `webhook_registered: false`, and the UI shows the URL for the user to paste in themselves.

- [ ] **Step 3: Confirm the throwaway webhook is gone**

Re-run the read-only listing and check only the four known webhooks remain (29491, 29493, 33255, 34986):

```bash
PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -c "
import os, requests
from dotenv import load_dotenv; load_dotenv('.env')
r = requests.post('https://api.hostaway.com/v1/accessTokens', data={'grant_type':'client_credentials','client_id':os.getenv('HOSTAWAY_CLIENT_ID'),'client_secret':os.getenv('HOSTAWAY_CLIENT_SECRET'),'scope':'general'}, headers={'Content-type':'application/x-www-form-urlencoded'}, timeout=20)
h={'Authorization':'Bearer '+r.json()['access_token']}
for w in requests.get('https://api.hostaway.com/v1/webhooks/unifiedWebhooks', headers=h, timeout=20).json()['result']:
    print(w['id'], w['url'][:60])
"
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-hostaway-per-user-integration-design.md
git commit -m "docs: Hostaway's webhook write API, answered by calling it"
```

---

## Task 2: `crypto.py`

**Files:**
- Create: `crypto.py`
- Test: `tests/test_crypto.py`

**Interfaces:**
- Consumes: nothing
- Produces: `encrypt_secret(plaintext: str) -> str`, `decrypt_secret(ciphertext: str) -> str`, `generate_key() -> str`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_crypto.py
"""A stored Hostaway secret is full API access to someone else's PMS."""
import pytest

import crypto


def test_a_secret_survives_a_round_trip(monkeypatch):
    monkeypatch.setenv("HOSTAWAY_ENCRYPTION_KEY", crypto.generate_key())
    assert crypto.decrypt_secret(crypto.encrypt_secret("s3cret")) == "s3cret"


def test_the_ciphertext_is_not_the_plaintext(monkeypatch):
    monkeypatch.setenv("HOSTAWAY_ENCRYPTION_KEY", crypto.generate_key())
    assert "s3cret" not in crypto.encrypt_secret("s3cret")


def test_a_different_key_cannot_read_it(monkeypatch):
    monkeypatch.setenv("HOSTAWAY_ENCRYPTION_KEY", crypto.generate_key())
    ciphertext = crypto.encrypt_secret("s3cret")

    monkeypatch.setenv("HOSTAWAY_ENCRYPTION_KEY", crypto.generate_key())
    with pytest.raises(Exception):
        crypto.decrypt_secret(ciphertext)


def test_a_missing_key_says_which_variable_is_missing(monkeypatch):
    """The failure a deploy hits. It must name the fix, not say 'None'."""
    monkeypatch.delenv("HOSTAWAY_ENCRYPTION_KEY", raising=False)
    with pytest.raises(RuntimeError, match="HOSTAWAY_ENCRYPTION_KEY"):
        crypto.encrypt_secret("s3cret")


def test_importing_without_a_key_does_not_raise(monkeypatch):
    """
    main.py imports this at startup. A user with no Hostaway connection must
    still be able to log in on a deploy where the key was never set.
    """
    monkeypatch.delenv("HOSTAWAY_ENCRYPTION_KEY", raising=False)
    import importlib
    importlib.reload(crypto)  # must not raise
```

- [ ] **Step 2: Run to verify they fail**

Run: `PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -m pytest tests/test_crypto.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'crypto'`

- [ ] **Step 3: Write the implementation**

```python
# crypto.py
"""
Encryption for stored third-party credentials.

A Hostaway client secret is not a password to this app — it is full API
access to someone else's property management system: reservations, guest
names, emails, phone numbers. Storing it the way google_calendar_connections
stores Google tokens (in the clear) is defensible for the owner's own
credentials and not defensible for a second business's.

The key is read on EVERY call rather than at import, so a deploy without
HOSTAWAY_ENCRYPTION_KEY still boots and still serves every user who has no
Hostaway connection. Only the Hostaway paths fail, and they say why.
"""
import os

from cryptography.fernet import Fernet

_ENV_VAR = "HOSTAWAY_ENCRYPTION_KEY"


def generate_key() -> str:
    """A new key, for setting the environment variable once. Not used at runtime."""
    return Fernet.generate_key().decode()


def _cipher() -> Fernet:
    key = os.getenv(_ENV_VAR)
    if not key:
        raise RuntimeError(
            f"{_ENV_VAR} is not set. Generate one with "
            f"crypto.generate_key() and add it to the environment."
        )
    return Fernet(key.encode())


def encrypt_secret(plaintext: str) -> str:
    return _cipher().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    return _cipher().decrypt(ciphertext.encode()).decode()
```

- [ ] **Step 4: Run to verify they pass**

Run: `PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -m pytest tests/test_crypto.py -q`
Expected: 5 passed

- [ ] **Step 5: Generate the key and give it to the owner**

```bash
PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -c "import crypto; print(crypto.generate_key())"
```

Tell the owner to add it to Render's environment as `HOSTAWAY_ENCRYPTION_KEY` **and** to his local `.env`. **Do not paste the key into a commit message, a doc, or the chat transcript more than once.** Note plainly: if this key is lost, every stored secret is unreadable and every user reconnects.

- [ ] **Step 6: Commit**

```bash
git add crypto.py tests/test_crypto.py
git commit -m "Stored third-party secrets are encrypted, and say so when the key is missing"
```

---

## Task 3: `hostaway_connections` CRUD

**Files:**
- Modify: `repository.py` (add at the end of the Hostaway section, after `update_hostaway_thread_fields`)
- Test: `tests/test_repository_hostaway_connections.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `get_hostaway_connection(user_id: str) -> Optional[dict]`
  - `get_hostaway_connections_for_account(account_id: str) -> list[dict]`
  - `upsert_hostaway_connection(user_id: str, account_id: str, client_secret_encrypted: str, webhook_id: Optional[int]) -> dict`
  - `update_hostaway_connection(user_id: str, updates: dict) -> None`
  - `delete_hostaway_connection(user_id: str) -> None`

  Every returned dict is the raw table row: keys `id`, `user_id`, `account_id`, `client_secret_encrypted`, `webhook_id`, `tasks_enabled`, `auto_close_enabled`, `connected_at`.

- [ ] **Step 1: Run the migration**

The owner runs `docs/migrations/2026-08-13-hostaway-connections.sql` in the Supabase SQL Editor. Confirm before writing code that touches it:

```bash
PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -c "
import repository
print(repository.supabase.table('hostaway_connections').select('user_id').limit(1).execute().data)
"
```
Expected: `[]` — not an exception.

- [ ] **Step 2: Write the failing tests**

```python
# tests/test_repository_hostaway_connections.py
"""
The account lookup must be a filtered QUERY, and must return EVERY colleague.

Fifteen staff share account 147809. A lookup that returns one row would
silently drop every colleague but one.
"""
import repository


class _FakeQuery:
    def __init__(self, sink, rows):
        self.sink, self.rows = sink, rows

    def select(self, *a):
        self.sink["select"] = a
        return self

    def eq(self, col, val):
        self.sink.setdefault("eq", []).append((col, val))
        return self

    def upsert(self, values, **kwargs):
        self.sink["upsert"] = values
        self.sink["upsert_kwargs"] = kwargs
        return self

    def update(self, values):
        self.sink["update"] = values
        return self

    def delete(self):
        self.sink["delete"] = True
        return self

    def limit(self, n):
        self.sink["limit"] = n
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeSupabase:
    def __init__(self, rows=None):
        self.calls = {}
        self.rows = rows if rows is not None else []

    def table(self, name):
        self.calls["table"] = name
        return _FakeQuery(self.calls, self.rows)


def _row(user_id="user-1", **overrides):
    row = {
        "id": "cccccccc-0000-0000-0000-000000000001",
        "user_id": user_id,
        "account_id": "147809",
        "client_secret_encrypted": "gAAAAA-not-a-real-secret",
        "webhook_id": 34986,
        "tasks_enabled": True,
        "auto_close_enabled": True,
        "connected_at": "2026-08-13T18:00:00+03:00",
    }
    row.update(overrides)
    return row


def test_one_account_returns_every_colleague(monkeypatch):
    fake = _FakeSupabase([_row("user-1"), _row("user-2"), _row("user-3")])
    monkeypatch.setattr(repository, "supabase", fake)

    rows = repository.get_hostaway_connections_for_account("147809")

    assert [r["user_id"] for r in rows] == ["user-1", "user-2", "user-3"]
    assert fake.calls["table"] == "hostaway_connections"
    assert ("account_id", "147809") in fake.calls["eq"]


def test_an_unknown_account_returns_empty(monkeypatch):
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([]))
    assert repository.get_hostaway_connections_for_account("999") == []


def test_a_lookup_failure_returns_empty_rather_than_raising(monkeypatch):
    """This runs inside the webhook, which must always answer 200."""
    class _Boom:
        def table(self, name):
            raise RuntimeError("postgrest is down")

    monkeypatch.setattr(repository, "supabase", _Boom())
    assert repository.get_hostaway_connections_for_account("147809") == []
    assert repository.get_hostaway_connection("user-1") is None


def test_one_user_has_one_connection(monkeypatch):
    fake = _FakeSupabase([_row("user-1")])
    monkeypatch.setattr(repository, "supabase", fake)

    row = repository.get_hostaway_connection("user-1")

    assert row["account_id"] == "147809"
    assert ("user_id", "user-1") in fake.calls["eq"]


def test_a_user_with_no_connection_gets_none(monkeypatch):
    monkeypatch.setattr(repository, "supabase", _FakeSupabase([]))
    assert repository.get_hostaway_connection("user-1") is None


def test_saving_upserts_on_user_id(monkeypatch):
    """Reconnecting replaces the row instead of failing on the unique index."""
    fake = _FakeSupabase([_row("user-1")])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.upsert_hostaway_connection("user-1", "147809", "cipher", 34986)

    assert fake.calls["upsert"]["user_id"] == "user-1"
    assert fake.calls["upsert"]["client_secret_encrypted"] == "cipher"
    assert fake.calls["upsert"]["webhook_id"] == 34986
    assert fake.calls["upsert_kwargs"]["on_conflict"] == "user_id"


def test_a_switch_update_is_scoped_to_the_user(monkeypatch):
    fake = _FakeSupabase([_row("user-1")])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.update_hostaway_connection("user-1", {"auto_close_enabled": False})

    assert fake.calls["update"] == {"auto_close_enabled": False}
    assert ("user_id", "user-1") in fake.calls["eq"]


def test_an_empty_update_writes_nothing(monkeypatch):
    fake = _FakeSupabase([_row("user-1")])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.update_hostaway_connection("user-1", {})

    assert "update" not in fake.calls


def test_deleting_is_scoped_to_the_user(monkeypatch):
    fake = _FakeSupabase([])
    monkeypatch.setattr(repository, "supabase", fake)

    repository.delete_hostaway_connection("user-1")

    assert fake.calls["delete"] is True
    assert ("user_id", "user-1") in fake.calls["eq"]
```

- [ ] **Step 3: Run to verify they fail**

Run: `PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -m pytest tests/test_repository_hostaway_connections.py -q`
Expected: FAIL — `AttributeError: module 'repository' has no attribute 'get_hostaway_connections_for_account'`

- [ ] **Step 4: Write the implementation**

Add to `repository.py`, directly after `update_hostaway_thread_fields`:

```python
# --- Hostaway connections (per-user credentials and switches) ---
# account_id is NOT unique: fifteen staff share the owner's Hostaway account,
# and each colleague who uses this app connects that same account under their
# own user_id. See the 2026-08-13 design, §1.2.

def get_hostaway_connections_for_account(account_id: str) -> list[dict]:
    """
    Every app user connected to one Hostaway account.

    Called on every inbound webhook, which must answer 200 whatever happens —
    so a lookup failure returns [] and the message is dropped with a log line,
    rather than raising into a 500 that Hostaway would retry.
    """
    try:
        response = (
            supabase.table("hostaway_connections")
            .select("*")
            .eq("account_id", str(account_id))
            .execute()
        )
        return response.data or []
    except Exception as e:
        logger.error(f"Failed to load Hostaway connections for account {account_id}: {e}")
        return []


def get_hostaway_connection(user_id: str) -> Optional[dict]:
    """This user's Hostaway connection, or None. Never raises."""
    try:
        response = (
            supabase.table("hostaway_connections")
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return rows[0] if rows else None
    except Exception as e:
        logger.error(f"Failed to load Hostaway connection for user {user_id}: {e}")
        return None


def upsert_hostaway_connection(
    user_id: str, account_id: str, client_secret_encrypted: str, webhook_id: Optional[int]
) -> dict:
    """
    Writes this user's connection, replacing any existing one.

    Upsert rather than insert so reconnecting — after rotating the API key,
    say — is the same operation as connecting, instead of a unique-violation
    the user would see as a crash.
    """
    response = (
        supabase.table("hostaway_connections")
        .upsert(
            {
                "user_id": user_id,
                "account_id": str(account_id),
                "client_secret_encrypted": client_secret_encrypted,
                "webhook_id": webhook_id,
            },
            on_conflict="user_id",
        )
        .execute()
    )
    return (response.data or [{}])[0]


def update_hostaway_connection(user_id: str, updates: dict) -> None:
    """Changes the switches. A no-op when there is nothing to change."""
    if not updates:
        return
    supabase.table("hostaway_connections").update(updates).eq("user_id", user_id).execute()


def delete_hostaway_connection(user_id: str) -> None:
    supabase.table("hostaway_connections").delete().eq("user_id", user_id).execute()
```

- [ ] **Step 5: Run to verify they pass, and the whole suite with them**

Run: `PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: 74 passed (65 + 9)

- [ ] **Step 6: Commit**

```bash
git add repository.py tests/test_repository_hostaway_connections.py
git commit -m "Hostaway connections are per user, and one account returns every colleague"
```

---

## Task 4: Credentials travel with the call

**Files:**
- Modify: `hostaway_integration.py:40-115` (`_get_hostaway_access_token`, `get_listing_name`, `get_reservation_details`, `get_conversation_messages`) and delete `get_user_id_for_hostaway_account`
- Test: `tests/test_hostaway_credentials.py`

**Interfaces:**
- Consumes: `crypto.decrypt_secret`, the connection dicts from Task 3
- Produces:
  - `HostawayCredentials` — a `NamedTuple` with fields `account_id: str`, `client_secret: str`
  - `credentials_from_connection(connection: dict) -> HostawayCredentials`
  - `get_access_token(credentials: HostawayCredentials) -> str`
  - `get_listing_name(listing_map_id: int, credentials: HostawayCredentials) -> str`
  - `get_reservation_details(reservation_id: int, credentials: HostawayCredentials) -> dict`
  - `get_conversation_messages(conversation_id, credentials: HostawayCredentials) -> list[dict]`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_hostaway_credentials.py
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
        status_code = 200

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

    monkeypatch.setattr(
        hi.requests, "post",
        lambda url, data=None, headers=None, timeout=None: (posted.append(1), _Response())[1],
    )
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -m pytest tests/test_hostaway_credentials.py -q`
Expected: FAIL — `AttributeError: module 'hostaway_integration' has no attribute 'credentials_from_connection'`

- [ ] **Step 3: Replace the credential plumbing**

In `hostaway_integration.py`, delete `get_user_id_for_hostaway_account` and `_get_hostaway_access_token` along with the `_cached_access_token` global and the two module-level `HOSTAWAY_CLIENT_ID` / `HOSTAWAY_CLIENT_SECRET` reads. Add:

```python
### The module imports `Literal` today, and neither `NamedTuple` nor
### `Optional`. Both are used below and in Task 7 — widen the existing line
### rather than adding a second import.
from typing import Literal, NamedTuple, Optional

import crypto


class HostawayCredentials(NamedTuple):
    """
    One account's API identity. account_id IS the client_id — verified
    2026-08-13: HOSTAWAY_CLIENT_ID, the accountId in every webhook payload,
    and the id the user reads off their Hostaway API settings page are all
    147809.
    """
    account_id: str
    client_secret: str


def credentials_from_connection(connection: dict) -> HostawayCredentials:
    return HostawayCredentials(
        account_id=str(connection["account_id"]),
        client_secret=crypto.decrypt_secret(connection["client_secret_encrypted"]),
    )


# Tokens are valid 24 months per Hostaway's docs, so an in-process dict
# re-filled on restart is enough. Keyed by account: the previous single
# module global was the hardcoded single user in another form, and with two
# accounts it would have handed one user's token to the other's requests.
_token_cache: dict[str, str] = {}


def clear_token_cache() -> None:
    """For tests, and for a reconnect after the API key was rotated."""
    _token_cache.clear()


def get_access_token(credentials: HostawayCredentials) -> str:
    cached = _token_cache.get(credentials.account_id)
    if cached:
        return cached

    response = requests.post(
        "https://api.hostaway.com/v1/accessTokens",
        data={
            "grant_type": "client_credentials",
            "client_id": credentials.account_id,
            "client_secret": credentials.client_secret,
            "scope": "general",
        },
        headers={"Content-type": "application/x-www-form-urlencoded", "Cache-control": "no-cache"},
        timeout=10,
    )
    response.raise_for_status()
    token = response.json()["access_token"]
    _token_cache[credentials.account_id] = token
    logging.info(f"[hostaway] Obtained access token for account {credentials.account_id}")
    return token
```

Then change the three API calls to take `credentials` and use `get_access_token(credentials)` instead of `_get_hostaway_access_token()`:

```python
def get_listing_name(listing_map_id: int, credentials: HostawayCredentials) -> str:
def get_reservation_details(reservation_id: int, credentials: HostawayCredentials) -> dict:
def get_conversation_messages(conversation_id, credentials: HostawayCredentials) -> list[dict]:
```

Each body keeps its existing logic; only the token line changes:

```python
        token = get_access_token(credentials)
```

- [ ] **Step 4: Run to verify they pass**

Run: `PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -m pytest tests/test_hostaway_credentials.py -q`
Expected: 5 passed

The rest of the suite will FAIL at this point — `main.py` and `services.py` still call the old signatures. That is expected and Tasks 5 and 6 fix it. Do not paper over it by leaving a compatibility shim.

- [ ] **Step 5: Commit**

```bash
git add hostaway_integration.py tests/test_hostaway_credentials.py
git commit -m "Hostaway credentials travel with the call instead of living in one global"
```

---

## Task 5: The webhook serves every colleague

**Files:**
- Modify: `main.py:969-1160` (`hostaway_webhook`) and `main.py:916-966` (`_handle_outgoing_hostaway_message` call site)
- Test: `tests/test_webhook_fanout.py`

**Interfaces:**
- Consumes: `repository.get_hostaway_connections_for_account`, `hostaway_integration.credentials_from_connection`, `hostaway_integration.HostawayCredentials`
- Produces: no new public names; `hostaway_webhook` keeps its route and its always-200 contract

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_webhook_fanout.py
"""
One guest message, one classification, one task per connected colleague.

Fifteen staff share account 147809 (design §1.2, §9). Whoever answers, every
copy closes on its own, because each colleague's poller sees the same reply.
"""
import asyncio

import main


class _FakeRequest:
    def __init__(self, payload):
        self._payload = payload

    async def json(self):
        return self._payload


def _post(payload):
    return asyncio.run(main.hostaway_webhook(_FakeRequest(payload)))


def _incoming(body="δεν βρίσκω τα κλειδιά", conversation_id=49446111):
    return {
        "event": "message.received",
        "accountId": 147809,
        "data": {
            "isIncoming": 1, "body": body, "conversationId": conversation_id,
            "date": "2026-08-13 16:00:00", "listingMapId": 410175, "reservationId": 64375741,
        },
    }


def _connection(user_id, **overrides):
    row = {
        "user_id": user_id, "account_id": "147809",
        "client_secret_encrypted": "cipher", "webhook_id": 34986,
        "tasks_enabled": True, "auto_close_enabled": True,
    }
    row.update(overrides)
    return row


def _wire(monkeypatch, connections):
    calls = {"created": [], "classified": [], "listings": 0, "reservations": 0, "pushes": []}

    monkeypatch.setattr(main.repository, "get_hostaway_connections_for_account",
                        lambda account_id: list(connections))
    monkeypatch.setattr(main.repository, "get_open_tasks_for_conversation", lambda u, c: [])
    monkeypatch.setattr(main.hostaway_integration, "credentials_from_connection",
                        lambda c: main.hostaway_integration.HostawayCredentials(c["account_id"], "s"))

    def _classify(text, user_id):
        calls["classified"].append(text)
        return {"summary": "τα κλειδιά", "priority": "P1"}

    monkeypatch.setattr(main.hostaway_integration, "classify_message", _classify)

    def _listing(listing_map_id, credentials):
        calls["listings"] += 1
        return "Pine Lodge"

    def _reservation(reservation_id, credentials):
        calls["reservations"] += 1
        return {"guest_name": "Κώστας", "arrival_date": "2026-08-14", "departure_date": "2026-08-18"}

    monkeypatch.setattr(main.hostaway_integration, "get_listing_name", _listing)
    monkeypatch.setattr(main.hostaway_integration, "get_reservation_details", _reservation)
    monkeypatch.setattr(main.service, "create_task_manual",
                        lambda user_id, fields: calls["created"].append((user_id, fields)))
    monkeypatch.setattr(main.service, "send_push_to_user",
                        lambda u, **kw: calls["pushes"].append((u, kw)))
    return calls


def test_three_colleagues_get_three_tasks(monkeypatch):
    calls = _wire(monkeypatch, [_connection("user-1"), _connection("user-2"), _connection("user-3")])

    result = _post(_incoming())

    assert result["status"] == "ok"
    assert [user_id for user_id, _ in calls["created"]] == ["user-1", "user-2", "user-3"]


def test_the_message_is_classified_once_for_all_of_them(monkeypatch):
    """N colleagues must not mean N Gemini calls for one guest message."""
    calls = _wire(monkeypatch, [_connection("user-1"), _connection("user-2"), _connection("user-3")])

    _post(_incoming())

    assert len(calls["classified"]) == 1


def test_enrichment_is_fetched_once_for_all_of_them(monkeypatch):
    """Two Hostaway round-trips per message, not two per colleague."""
    calls = _wire(monkeypatch, [_connection("user-1"), _connection("user-2")])

    _post(_incoming())

    assert calls["listings"] == 1
    assert calls["reservations"] == 1


def test_a_colleague_with_task_creation_off_is_skipped(monkeypatch):
    calls = _wire(monkeypatch, [
        _connection("user-1"),
        _connection("user-2", tasks_enabled=False),
    ])

    _post(_incoming())

    assert [user_id for user_id, _ in calls["created"]] == ["user-1"]


def test_an_unknown_account_is_ignored_with_200(monkeypatch):
    """A Hostaway account nobody has connected. Never a 500, never a task."""
    calls = _wire(monkeypatch, [])

    result = _post(_incoming())

    assert result["status"] == "ignored"
    assert calls["created"] == []
    assert calls["classified"] == []


def test_nobody_connected_costs_no_gemini_call(monkeypatch):
    """Classification must happen AFTER the connection lookup, not before."""
    calls = _wire(monkeypatch, [])
    _post(_incoming())
    assert calls["classified"] == []


def test_every_colleague_with_the_switch_off_means_no_classification(monkeypatch):
    calls = _wire(monkeypatch, [_connection("user-1", tasks_enabled=False)])
    _post(_incoming())
    assert calls["classified"] == []
    assert calls["created"] == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -m pytest tests/test_webhook_fanout.py -q`
Expected: FAIL — the handler still calls `get_user_id_for_hostaway_account`, which no longer exists

- [ ] **Step 3: Rewrite the incoming half of `hostaway_webhook`**

Replace everything from `message_body = (data.get("body") or "").strip()` to the end of the function with:

```python
    message_body = (data.get("body") or "").strip()
    if not message_body:
        return {"status": "ignored", "reason": "empty message body"}

    listing_map_id = data.get("listingMapId")
    reservation_id = data.get("reservationId")
    conversation_id = data.get("conversationId")
    message_date = data.get("date")

    connections = repository.get_hostaway_connections_for_account(payload.get("accountId"))
    recipients = [c for c in connections if c.get("tasks_enabled")]
    if not recipients:
        # Nobody has connected this account, or everyone switched task
        # creation off. Both are ordinary, and neither costs a Gemini call —
        # which is why this check sits ABOVE the classification.
        logging.info(
            f"[hostaway webhook] No recipient for account {payload.get('accountId')} "
            f"({len(connections)} connected, {len(recipients)} with tasks enabled)"
        )
        return {"status": "ignored", "reason": "no connection wants this message"}

    # Is this message part of a burst an open task already covers? Asked per
    # colleague, because they close their copies independently.
    existing_by_user = {}
    for connection in recipients:
        for candidate in repository.get_open_tasks_for_conversation(
            connection["user_id"], str(conversation_id)
        ) if conversation_id else []:
            if hostaway_threading.should_append_to_thread(
                candidate.hostaway_last_message_at, message_date
            ):
                existing_by_user[connection["user_id"]] = candidate
                break

    # ONE classification for everyone. The thread belongs to the
    # CONVERSATION, not to a colleague — every copy holds the same messages —
    # so the first open task found supplies it and the verdict applies to all.
    text_to_classify = message_body
    for task in existing_by_user.values():
        if task.hostaway_thread:
            text_to_classify = f"{task.hostaway_thread}{HOSTAWAY_THREAD_SEPARATOR}{message_body}"
            break

    try:
        classification = hostaway_integration.classify_message(
            text_to_classify, user_id=recipients[0]["user_id"]
        )
    except Exception as e:
        logging.error(f"[hostaway webhook] Classification failed unexpectedly: {e}")
        classification = {"summary": message_body[:200], "priority": "P1"}

    # Enrichment is two Hostaway round-trips for the MESSAGE, not per
    # colleague, and only when at least one of them needs a new task.
    enrichment = None

    def _enrichment():
        nonlocal enrichment
        if enrichment is None:
            credentials = hostaway_integration.credentials_from_connection(recipients[0])
            try:
                enrichment = (
                    hostaway_integration.get_listing_name(listing_map_id, credentials)
                    if listing_map_id else "Άγνωστο property",
                    hostaway_integration.get_reservation_details(reservation_id, credentials)
                    if reservation_id else
                    {"guest_name": "Πελάτης", "arrival_date": "?", "departure_date": "?"},
                )
            except Exception as e:
                logging.error(f"[hostaway webhook] Enrichment failed: {e}")
                enrichment = ("Άγνωστο property",
                              {"guest_name": "Πελάτης", "arrival_date": "?", "departure_date": "?"})
        return enrichment

    threaded, created = 0, 0
    for connection in recipients:
        user_id = connection["user_id"]
        existing_task = existing_by_user.get(user_id)

        if existing_task:
            previous_priority = existing_task.priority
            updates = _append_to_hostaway_thread(
                user_id, existing_task, message_body, message_date, classification
            )
            if hostaway_threading.is_more_urgent(updates["priority"], previous_priority):
                emoji = {"P1": "🔴", "P2": "🟡", "P3": "🟢"}.get(updates["priority"], "")
                try:
                    service.send_push_to_user(
                        user_id,
                        title=f"{emoji} {existing_task.task_name}",
                        body=classification["summary"],
                    )
                except Exception as e:
                    logging.error(f"[hostaway webhook] Failed to send escalation notification: {e}")
            threaded += 1
            continue

        listing_name, reservation_details = _enrichment()
        if _create_hostaway_task(
            user_id, classification, listing_name, reservation_details,
            message_body, message_date, conversation_id,
        ):
            created += 1

    return {"status": "ok", "tasks_created": created, "threaded_into": threaded}
```

- [ ] **Step 4: Extract the task creation that loop calls**

Add above `hostaway_webhook`:

```python
def _create_hostaway_task(
    user_id: str,
    classification: dict,
    listing_name: str,
    reservation_details: dict,
    message_body: str,
    message_date: Optional[str],
    conversation_id,
) -> bool:
    """
    One colleague's copy of a guest message. Returns whether it was written.

    Pulled out of the webhook when one message started producing one task per
    connected colleague: the body is identical for each, only user_id differs.
    """
    now = datetime.now(ZoneInfo("Europe/Athens"))
    now_str = now.isoformat()
    priority = classification["priority"]
    task_name = f"Hostaway: {reservation_details['guest_name']} - {listing_name}"

    priority_emoji = {"P1": "🔴", "P2": "🟡", "P3": "🟢"}.get(priority, "")
    try:
        service.send_push_to_user(
            user_id, title=f"{priority_emoji} {task_name}", body=classification["summary"]
        )
    except Exception as e:
        logging.error(f"[hostaway webhook] Failed to send instant notification: {e}")

    try:
        service.create_task_manual(user_id, {
            "task_name": task_name,
            "description": _render_hostaway_description(
                classification["summary"],
                f"Property: {listing_name}\n"
                f"Dates: {reservation_details['arrival_date']} → "
                f"{reservation_details['departure_date']}",
                message_body,
            ),
            "category": "Hostaway",
            "priority": priority,
            "due_date": now.strftime("%Y-%m-%d"),
            "due_time": None,
            "checklist": [],
            "hostaway_created_at": now_str,
            "hostaway_last_notified_at": now_str,
            "hostaway_conversation_id": str(conversation_id) if conversation_id else None,
            "hostaway_last_message_at": message_date,
            "hostaway_message_count": 1,
            "hostaway_thread": message_body,
        })
        logging.info(
            f"[hostaway webhook] Created task for {user_id}: {task_name} (priority={priority})"
        )
        return True
    except Exception as e:
        logging.error(f"[hostaway webhook] Failed to create task for {user_id}: {e}")
        return False
```

- [ ] **Step 5: Point the outgoing half at every colleague too**

Replace the `outgoing_user_id = ...` block in the `isIncoming != 1` branch with:

```python
        results = []
        for connection in repository.get_hostaway_connections_for_account(payload.get("accountId")):
            try:
                results.append(_handle_outgoing_hostaway_message(connection["user_id"], data))
            except Exception as e:
                logging.error(f"[hostaway webhook] Outgoing handling failed: {e}")
        return {"status": "ok", "handled": len(results)}
```

Note this path stays in place even though Hostaway has never delivered an outgoing message (see PROJECT_STATUS.md) — it costs nothing and answers a delivery if one ever arrives.

- [ ] **Step 6: Run the whole suite**

Run: `PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: all green. `tests/test_webhook_delivery_logging.py` still passes — the entry log line is above every change here.

- [ ] **Step 7: Commit**

```bash
git add main.py tests/test_webhook_fanout.py
git commit -m "One guest message becomes one task per colleague, from one classification"
```

---

## Task 6: The poller reads the connection

**Files:**
- Modify: `services.py` (`_check_hostaway_replies`)
- Test: `tests/test_hostaway_reply_polling.py` (add to the existing file)

**Interfaces:**
- Consumes: `repository.get_hostaway_connection`, `hostaway_integration.credentials_from_connection`
- Produces: `_check_hostaway_replies` keeps its signature and its returned dict

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_hostaway_reply_polling.py`:

```python
def test_a_user_with_no_connection_makes_no_api_call(monkeypatch):
    """A user who never connected Hostaway must cost nothing on every tick."""
    monkeypatch.setattr(services.repository, "get_hostaway_connection", lambda u: None)
    calls, result, _ = _run(monkeypatch, [_task()])

    assert calls["fetched"] == []
    assert result["conversations_polled"] == 0


def test_auto_close_switched_off_makes_no_api_call(monkeypatch):
    """Off means off — not 'fetch, then decide not to act'."""
    monkeypatch.setattr(
        services.repository, "get_hostaway_connection",
        lambda u: {"user_id": u, "account_id": "147809", "client_secret_encrypted": "c",
                   "tasks_enabled": True, "auto_close_enabled": False},
    )
    calls, result, _ = _run(monkeypatch, [_task()])

    assert calls["fetched"] == []
    assert calls["updates"] == []
    assert result["conversations_polled"] == 0
```

And update `_run` so the connection is present by default:

```python
def _run(monkeypatch, open_tasks, messages=None):
    calls = {"updates": [], "pushes": [], "fetched": []}
    conversation = CONV_49166048 if messages is None else messages

    monkeypatch.setattr(
        services.repository, "get_hostaway_connection",
        lambda u: {"user_id": u, "account_id": "147809", "client_secret_encrypted": "c",
                   "tasks_enabled": True, "auto_close_enabled": True},
        raising=False,
    )
    monkeypatch.setattr(services.hostaway_integration, "credentials_from_connection",
                        lambda c: ("147809", "secret"), raising=False)
    monkeypatch.setattr(services.repository, "get_active_hostaway_tasks",
                        lambda u, tasks=None: list(open_tasks))
    monkeypatch.setattr(services.repository, "update_hostaway_thread_fields",
                        lambda u, r, updates: calls["updates"].append((r, updates)))

    def _fetch(conversation_id, credentials):
        calls["fetched"].append(conversation_id)
        return conversation

    monkeypatch.setattr(services.hostaway_integration, "get_conversation_messages", _fetch)

    svc = services.TaskService.__new__(services.TaskService)
    monkeypatch.setattr(svc, "send_push_to_user",
                        lambda u, **kw: calls["pushes"].append(kw), raising=False)

    result = svc._check_hostaway_replies("user-1", open_tasks)
    return calls, result, svc
```

- [ ] **Step 2: Run to verify the two new ones fail**

Run: `PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -m pytest tests/test_hostaway_reply_polling.py -q`
Expected: FAIL — the poller ignores the connection and fetches anyway

- [ ] **Step 3: Implement**

At the top of `_check_hostaway_replies`, before the candidate scan:

```python
        connection = repository.get_hostaway_connection(user_id)
        if not connection or not connection.get("auto_close_enabled"):
            # No connection, or the user switched auto-completion off. Either
            # way this costs nothing: the check is above the task scan and
            # above every HTTP call.
            return {"conversations_polled": 0, "replies_found": 0, "tasks_completed": 0}

        credentials = hostaway_integration.credentials_from_connection(connection)
```

and pass them through:

```python
            messages = hostaway_integration.get_conversation_messages(conversation_id, credentials)
```

- [ ] **Step 4: Run the whole suite**

Run: `PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: all green

- [ ] **Step 5: Commit**

```bash
git add services.py tests/test_hostaway_reply_polling.py
git commit -m "The reply poller uses the user's own credentials, and stops when switched off"
```

---

## Task 7: The four endpoints

**Files:**
- Modify: `main.py` (add after the `/webhooks/hostaway` handler)
- Test: `tests/test_hostaway_integration_endpoints.py`

**Interfaces:**
- Consumes: everything from Tasks 2–4
- Produces:
  - `hostaway_register_webhook(credentials, callback_url) -> Optional[int]` in `hostaway_integration.py`
  - `hostaway_delete_webhook(credentials, webhook_id) -> bool` in `hostaway_integration.py`
  - Routes `GET/POST/PATCH/DELETE /integrations/hostaway`
  - Request models `HostawayConnectRequest` (`account_id: str`, `client_secret: str`) and `HostawaySwitchesRequest` (`tasks_enabled: Optional[bool]`, `auto_close_enabled: Optional[bool]`)

**If Task 1 found POST unsupported**, implement `hostaway_register_webhook` as a function that returns `None` without calling anything, and have `POST` return `webhook_registered: false` so the UI can show manual instructions. Everything else in this task is unchanged.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_hostaway_integration_endpoints.py
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -m pytest tests/test_hostaway_integration_endpoints.py -q`
Expected: FAIL — `AttributeError: module 'main' has no attribute 'HostawayConnectRequest'`

- [ ] **Step 3: Add webhook registration to `hostaway_integration.py`**

```python
HOSTAWAY_WEBHOOK_EVENTS = ["message.received"]


def hostaway_register_webhook(credentials: HostawayCredentials, callback_url: str) -> Optional[int]:
    """
    Points the user's Hostaway account at our webhook, and returns its id.

    Looks before creating: reconnecting must not leave a trail of duplicate
    webhooks all delivering the same guest message. Returns the existing id
    when one already points at callback_url.
    """
    token = get_access_token(credentials)
    headers = {"Authorization": f"Bearer {token}", "Content-type": "application/json"}

    existing = requests.get(
        "https://api.hostaway.com/v1/webhooks/unifiedWebhooks", headers=headers, timeout=10
    )
    existing.raise_for_status()
    for webhook in existing.json().get("result") or []:
        if webhook.get("url") == callback_url:
            logging.info(f"[hostaway] Reusing webhook {webhook['id']} for {credentials.account_id}")
            return webhook["id"]

    created = requests.post(
        "https://api.hostaway.com/v1/webhooks/unifiedWebhooks",
        headers=headers, timeout=10,
        json={"url": callback_url, "isEnabled": 1, "events": HOSTAWAY_WEBHOOK_EVENTS},
    )
    created.raise_for_status()
    webhook_id = (created.json().get("result") or {}).get("id")
    logging.info(f"[hostaway] Registered webhook {webhook_id} for {credentials.account_id}")
    return webhook_id


def hostaway_delete_webhook(credentials: HostawayCredentials, webhook_id: int) -> bool:
    """Removes a webhook we registered. Returns whether Hostaway accepted it."""
    token = get_access_token(credentials)
    response = requests.delete(
        f"https://api.hostaway.com/v1/webhooks/unifiedWebhooks/{webhook_id}",
        headers={"Authorization": f"Bearer {token}"}, timeout=10,
    )
    return response.status_code < 300
```

- [ ] **Step 4: Add the endpoints to `main.py`**

```python
HOSTAWAY_WEBHOOK_URL = os.getenv(
    "HOSTAWAY_WEBHOOK_URL", "https://ai-todo-app-sdq8.onrender.com/webhooks/hostaway"
)


class HostawayConnectRequest(BaseModel):
    account_id: str
    client_secret: str


class HostawaySwitchesRequest(BaseModel):
    tasks_enabled: Optional[bool] = None
    auto_close_enabled: Optional[bool] = None


@app.get("/integrations/hostaway")
def get_hostaway_status(user_id: str = Depends(get_current_user_id)):
    """The connection as the UI needs it. The secret is never part of that."""
    connection = repository.get_hostaway_connection(user_id)
    if not connection:
        return {"connected": False, "account_id": None,
                "tasks_enabled": False, "auto_close_enabled": False}
    return {
        "connected": True,
        "account_id": connection["account_id"],
        "tasks_enabled": bool(connection["tasks_enabled"]),
        "auto_close_enabled": bool(connection["auto_close_enabled"]),
    }


@app.post("/integrations/hostaway")
def connect_hostaway(
    request: HostawayConnectRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Validates the credentials against Hostaway BEFORE storing anything, then
    registers the webhook, then saves. A connection that is saved but does not
    work is worse than no connection: it fails silently, later, on a guest
    message nobody is watching.
    """
    credentials = hostaway_integration.HostawayCredentials(
        account_id=request.account_id.strip(), client_secret=request.client_secret.strip()
    )
    try:
        hostaway_integration.get_access_token(credentials)
    except Exception as e:
        logging.error(f"[hostaway connect] Credential check failed for {user_id}: {e}")
        raise HTTPException(
            status_code=400,
            detail="Τα στοιχεία Hostaway δεν έγιναν δεκτά. Έλεγξε το Account ID και το API key.",
        )

    webhook_id = None
    try:
        webhook_id = hostaway_integration.hostaway_register_webhook(
            credentials, HOSTAWAY_WEBHOOK_URL
        )
    except Exception as e:
        # The credentials are good; only the webhook failed. Store the
        # connection so the reply poller works, and tell the UI that new
        # messages will not arrive until the webhook is added by hand.
        logging.error(f"[hostaway connect] Webhook registration failed for {user_id}: {e}")

    repository.upsert_hostaway_connection(
        user_id, credentials.account_id, crypto.encrypt_secret(credentials.client_secret), webhook_id
    )
    logging.info(
        f"[hostaway connect] {user_id} connected account {credentials.account_id} "
        f"(webhook={webhook_id})"
    )
    return {
        "connected": True,
        "account_id": credentials.account_id,
        "webhook_registered": webhook_id is not None,
        "webhook_url": HOSTAWAY_WEBHOOK_URL,
        "tasks_enabled": True,
        "auto_close_enabled": True,
    }


@app.patch("/integrations/hostaway")
def update_hostaway_switches(
    request: HostawaySwitchesRequest, user_id: str = Depends(get_current_user_id)
):
    updates = {k: v for k, v in request.model_dump().items() if v is not None}
    repository.update_hostaway_connection(user_id, updates)
    return get_hostaway_status(user_id=user_id)


@app.delete("/integrations/hostaway")
def disconnect_hostaway(user_id: str = Depends(get_current_user_id)):
    """
    Removes the webhook from their Hostaway account, then the row. Existing
    Hostaway tasks are deliberately left alone: they are the user's work, not
    the connection's data.
    """
    connection = repository.get_hostaway_connection(user_id)
    if connection and connection.get("webhook_id"):
        try:
            hostaway_integration.hostaway_delete_webhook(
                hostaway_integration.credentials_from_connection(connection),
                connection["webhook_id"],
            )
        except Exception as e:
            # Never trap the user in a connection because Hostaway said no.
            logging.error(f"[hostaway disconnect] Could not remove webhook for {user_id}: {e}")

    repository.delete_hostaway_connection(user_id)
    hostaway_integration.clear_token_cache()
    return {"connected": False}
```

Add `import crypto` to `main.py`'s imports.

- [ ] **Step 5: Run the whole suite**

Run: `PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -m pytest tests/ -q`
Expected: all green

- [ ] **Step 6: Commit**

```bash
git add main.py hostaway_integration.py tests/test_hostaway_integration_endpoints.py
git commit -m "Connect, switch and disconnect Hostaway over four endpoints"
```

---

## Task 8: Move the owner onto a row

**Files:**
- Create: `migrate_owner_hostaway.py` (repo root, beside `migrate_to_supabase.py`)

**Interfaces:**
- Consumes: `crypto.encrypt_secret`, `repository.upsert_hostaway_connection`
- Produces: nothing importable — a script run once

- [ ] **Step 1: Write the script**

```python
"""
One-off: gives the owner a hostaway_connections row from what is in .env.

Webhook 34986 already exists and already points at the deployed endpoint, so
this claims it rather than registering a second one — reusing an id is
exactly what hostaway_register_webhook does for everyone else.

Safe to run twice: upsert_hostaway_connection replaces the row.

    PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe migrate_owner_hostaway.py
"""
import os

from dotenv import load_dotenv

import crypto
import repository

load_dotenv()

OWNER_USER_ID = "fdedc7be-964b-4e75-b4a0-bd16cb6b05e7"
EXISTING_WEBHOOK_ID = 34986

account_id = os.getenv("HOSTAWAY_CLIENT_ID")
client_secret = os.getenv("HOSTAWAY_CLIENT_SECRET")

if not account_id or not client_secret:
    raise SystemExit("HOSTAWAY_CLIENT_ID / HOSTAWAY_CLIENT_SECRET are not in .env")
if not os.getenv("HOSTAWAY_ENCRYPTION_KEY"):
    raise SystemExit("HOSTAWAY_ENCRYPTION_KEY is not set — see crypto.py")

repository.upsert_hostaway_connection(
    OWNER_USER_ID, account_id, crypto.encrypt_secret(client_secret), EXISTING_WEBHOOK_ID
)

written = repository.get_hostaway_connection(OWNER_USER_ID)
print(f"account_id        = {written['account_id']}")
print(f"webhook_id        = {written['webhook_id']}")
print(f"tasks_enabled     = {written['tasks_enabled']}")
print(f"auto_close_enabled= {written['auto_close_enabled']}")
print(f"secret round-trip = {crypto.decrypt_secret(written['client_secret_encrypted']) == client_secret}")
```

- [ ] **Step 2: Run it**

```bash
PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe migrate_owner_hostaway.py
```
Expected: `account_id = 147809`, `webhook_id = 34986`, both switches `True`, `secret round-trip = True`

- [ ] **Step 3: Prove the whole chain works before anything deploys**

Re-run the dry run that verified the poller, which now has to resolve credentials out of the row instead of `.env`:

```bash
PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe -c "
import repository, services, hostaway_integration
USER='fdedc7be-964b-4e75-b4a0-bd16cb6b05e7'
writes=[]
repository.update_hostaway_thread_fields = lambda u,r,up: writes.append((r,up))
services.repository.update_hostaway_thread_fields = repository.update_hostaway_thread_fields
svc = services.TaskService.__new__(services.TaskService)
svc.send_push_to_user = lambda u, **kw: {'sent': 0}
tasks = repository.get_tasks_for_user(USER)
print(svc._check_hostaway_replies(USER, tasks))
print('would write:', writes)
"
```
Expected: it polls, using the credentials from the row, and writes nothing to the database.

- [ ] **Step 4: Commit**

```bash
git add migrate_owner_hostaway.py
git commit -m "The owner gets a connection row, claiming the webhook he already had"
```

---

## Task 9: The Settings screen

**Files:**
- Modify: `frontend/src/api.js` (after `testCalendarConnection`)
- Modify: `frontend/src/components/SettingsModal.jsx` (a `SettingsRow` in the main list; a `HostawayConnectionView` beside `CalendarConnectionView` at :602)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/el.json`

**Interfaces:**
- Consumes: the four endpoints from Task 7
- Produces: `getHostawayStatus()`, `connectHostaway(accountId, clientSecret)`, `updateHostawaySwitches(switches)`, `disconnectHostaway()`

- [ ] **Step 1: Add the API wrappers**

```javascript
/**
 * GET /integrations/hostaway — { connected, account_id, tasks_enabled, auto_close_enabled }.
 * The client secret is never returned by the backend.
 */
export async function getHostawayStatus() {
  return request('/integrations/hostaway');
}

/**
 * POST /integrations/hostaway — validates the credentials against Hostaway,
 * registers the webhook, stores the connection. 400 if Hostaway rejects them.
 */
export async function connectHostaway(accountId, clientSecret) {
  return request('/integrations/hostaway', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, client_secret: clientSecret }),
  });
}

/** PATCH /integrations/hostaway — either switch, alone or together. */
export async function updateHostawaySwitches(switches) {
  return request('/integrations/hostaway', {
    method: 'PATCH',
    body: JSON.stringify(switches),
  });
}

/** DELETE /integrations/hostaway — removes the webhook, then the connection. */
export async function disconnectHostaway() {
  return request('/integrations/hostaway', { method: 'DELETE' });
}
```

- [ ] **Step 2: Add the strings**

`en.json`:
```json
"hostaway": {
  "title": "Hostaway",
  "not_connected": "Connect your Hostaway account to turn guest messages into tasks.",
  "account_id": "Account ID",
  "api_key": "API key",
  "connect": "Connect",
  "connecting": "Connecting…",
  "connected": "Connected",
  "disconnect": "Disconnect",
  "invalid": "Hostaway did not accept those details. Check the Account ID and API key.",
  "webhook_manual": "Connected, but the webhook could not be added automatically. Add this URL in Hostaway under Settings → Webhooks, for the event message.received:",
  "tasks_enabled": "Create tasks from messages",
  "tasks_enabled_description": "A new guest message becomes a task.",
  "auto_close_enabled": "Close the task when you reply",
  "auto_close_enabled_description": "Replying to a guest closes the task it belongs to, within about two minutes."
}
```

`el.json`:
```json
"hostaway": {
  "title": "Hostaway",
  "not_connected": "Σύνδεσε τον λογαριασμό σου Hostaway για να γίνονται tasks τα μηνύματα των πελατών.",
  "account_id": "Account ID",
  "api_key": "API key",
  "connect": "Σύνδεση",
  "connecting": "Γίνεται σύνδεση…",
  "connected": "Συνδεδεμένο",
  "disconnect": "Αποσύνδεση",
  "invalid": "Η Hostaway δεν δέχτηκε τα στοιχεία. Έλεγξε το Account ID και το API key.",
  "webhook_manual": "Συνδέθηκε, αλλά δεν μπήκε αυτόματα το webhook. Πρόσθεσε αυτό το URL στο Hostaway, στα Settings → Webhooks, για το event message.received:",
  "tasks_enabled": "Δημιουργία tasks από μηνύματα",
  "tasks_enabled_description": "Κάθε νέο μήνυμα πελάτη γίνεται task.",
  "auto_close_enabled": "Κλείσιμο task όταν απαντάς",
  "auto_close_enabled_description": "Όταν απαντάς σε πελάτη, κλείνει το task του μέσα σε ~2 λεπτά."
}
```

- [ ] **Step 3: Add the row that opens the screen**

In the main settings list, beside the Calendar row (`SettingsModal.jsx:173`):

```jsx
<SettingsRow label={t('hostaway.title')} onClick={() => setScreen('hostaway')} />
```

Register the screen title in the `SCREEN_TITLES` map at :53 (`hostaway: 'hostaway.title'`) and render it beside the calendar screen at :220:

```jsx
{screen === 'hostaway' && <HostawayConnectionView onShowToast={onShowToast} />}
```

- [ ] **Step 4: Write the screen**

Add beside `CalendarConnectionView`, reusing its switch markup so the two screens look identical:

```jsx
function HostawayConnectionView({ onShowToast }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [manualUrl, setManualUrl] = useState(null);

  useEffect(() => {
    getHostawayStatus()
      .then(setStatus)
      .catch(err => console.error('Failed to load Hostaway status:', err));
  }, []);

  async function handleConnect() {
    setBusy(true);
    try {
      const result = await connectHostaway(accountId.trim(), apiKey.trim());
      setStatus(result);
      setApiKey('');
      if (!result.webhook_registered) setManualUrl(result.webhook_url);
    } catch (err) {
      onShowToast?.(t('hostaway.invalid'));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(key) {
    const next = { [key]: !status[key] };
    setStatus({ ...status, ...next });          // optimistic
    try {
      setStatus(await updateHostawaySwitches(next));
    } catch (err) {
      setStatus(await getHostawayStatus());     // put it back if the server said no
    }
  }

  async function handleDisconnect() {
    await disconnectHostaway();
    setStatus({ connected: false });
    setManualUrl(null);
  }

  if (!status) return null;

  if (!status.connected) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[var(--text-secondary)]">{t('hostaway.not_connected')}</p>
        <input
          value={accountId}
          onChange={e => setAccountId(e.target.value)}
          placeholder={t('hostaway.account_id')}
          inputMode="numeric"
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-2 text-sm"
        />
        <input
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={t('hostaway.api_key')}
          type="password"
          autoComplete="off"
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-2 text-sm"
        />
        <button
          onClick={handleConnect}
          disabled={busy || !accountId.trim() || !apiKey.trim()}
          className="w-full rounded-lg bg-[var(--brand-primary)] p-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? t('hostaway.connecting') : t('hostaway.connect')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-[var(--success)]">
        {t('hostaway.connected')} ✓ · {status.account_id}
      </p>

      {manualUrl && (
        <p className="text-xs text-[var(--text-secondary)] break-all">
          {t('hostaway.webhook_manual')} {manualUrl}
        </p>
      )}

      {['tasks_enabled', 'auto_close_enabled'].map(key => (
        <div key={key}>
          <div className="flex items-center justify-between">
            <span className="text-sm">{t(`hostaway.${key}`)}</span>
            <button
              onClick={() => handleToggle(key)}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                status[key] ? 'bg-[var(--brand-primary)]' : 'bg-[var(--border-subtle)]'
              }`}
              aria-label={t(`hostaway.${key}`)}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  status[key] ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {t(`hostaway.${key}_description`)}
          </p>
        </div>
      ))}

      <button onClick={handleDisconnect} className="text-sm text-[var(--danger)] underline">
        {t('hostaway.disconnect')}
      </button>
    </div>
  );
}
```

Add the four functions to the `api.js` import block at the top of `SettingsModal.jsx`.

- [ ] **Step 5: See it run**

```bash
cd frontend && npm run dev
```

Open Settings → Hostaway. Check, on a real screen: the disconnected form appears; a wrong API key shows the error toast and leaves you disconnected; a correct one flips to Connected with the account id; both switches move and survive a reload; Disconnect returns to the form. Then switch the app to English and read the screen again.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api.js frontend/src/components/SettingsModal.jsx frontend/src/locales/en.json frontend/src/locales/el.json
git commit -m "Hostaway gets a Settings screen, with the two switches"
```

---

## Task 10: Write down what shipped

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`, `docs/FEATURES.md`, `docs/PROJECT_STATUS.md`, `docs/CURRENT_TASK.md`

- [ ] **Step 1: Update the docs**

- `DATABASE_SCHEMA.md`: the `hostaway_connections` table, every column, and **why `account_id` is not unique**.
- `ARCHITECTURE.md`: the four `/integrations/hostaway` endpoints in the endpoint list; the webhook line gains "resolves every connection for the payload's accountId and creates one task per colleague from one classification"; note `HOSTAWAY_ENCRYPTION_KEY` as a required env var.
- `FEATURES.md`: the Settings screen and what each switch does.
- `PROJECT_STATUS.md`: what is verified against real traffic and what is not. Do not write that the fan-out works until a real guest message has produced two tasks.
- `CURRENT_TASK.md`: replace with the verification pass for this feature — a second colleague connects, a guest message produces two tasks, one colleague replies, both close.

- [ ] **Step 2: Confirm the env var is set on Render**

`HOSTAWAY_ENCRYPTION_KEY` must exist in Render's environment before this deploys, or every Hostaway path raises. Ask the owner to confirm he added it.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: Hostaway is per-user, and what has not been seen running"
```

---

## After the plan

Nothing here has run against a real second colleague. The honest first test is: a colleague connects their own profile to account 147809, a guest writes, and **two** tasks appear. Until that happens, this is 90-odd passing tests and a dry run — which is exactly the distinction `PROJECT_STATUS.md` exists to keep.
