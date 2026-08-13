# Per-user Hostaway integration, with the two switches that make it stoppable

**Date**: 2026-08-13
**Status**: design approved, not implemented
**Follows**: `2026-08-10-hostaway-threading-design.md` (the feature this makes multi-user)

## The problem

Hostaway works for exactly one person, and it is wired that way on purpose — the
day-one comment says so:

```python
def get_user_id_for_hostaway_account(hostaway_account_id) -> str:
    """... Currently hardcoded to the app owner's own user_id ..."""
    return "fdedc7be-964b-4e75-b4a0-bd16cb6b05e7"
```

One pair of credentials in `.env`, one webhook registered by hand in the owner's
Hostaway dashboard, and a function that ignores its own argument. A second user
today would have their guest messages become the owner's tasks.

Two things are wanted: any user connects their own Hostaway from Settings, and
each user can switch the behaviour off without disconnecting.

**Audience decision (owner, 2026-08-13)**: two users to start, but the data model
must be the real one now, so "everyone" later is UI work and not a rewrite.

## What is verified, and what is assumed

This repo has paid for a guessed API shape before, so the line is drawn
explicitly.

| Fact | Status |
|---|---|
| `HOSTAWAY_CLIENT_ID` == `accountId` in webhook payloads == `147809` | **Verified** 2026-08-13 against `.env` and live payloads |
| `GET /v1/webhooks/unifiedWebhooks` lists webhooks with `id`, `url`, `isEnabled`, `events` | **Verified** — returned the account's four webhooks |
| `message.received` is the only message event on offer | **Verified** — three unrelated integrations (Make, Zapier, GuestArrive) each enumerate the same five events, none for a sent message |
| `cryptography==48.0.0` is already a declared dependency | **Verified** — `requirements.txt`, pulled in by pywebpush |
| **POST and DELETE on `/v1/webhooks/unifiedWebhooks`** | **ASSUMED.** Never called. Task 1 of the plan is to confirm it with a throwaway webhook on the owner's account, deleted immediately — with the owner's explicit go-ahead |

If POST turns out not to exist, the fallback is §4.3 and the whole design still
stands: the user pastes the URL into Hostaway themselves.

## §1 Data model — `hostaway_connections`

One new table. Mirrors `google_calendar_connections`, which is the established
shape for a per-user integration in this codebase.

| column | type | notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID **UNIQUE**, FK → `auth.users` ON DELETE CASCADE | one connection per user |
| `account_id` | TEXT **UNIQUE** NOT NULL | Hostaway's `accountId`, which is also the `client_id` |
| `client_secret_encrypted` | TEXT NOT NULL | §2 — never stored or returned in the clear |
| `webhook_id` | INTEGER NULL | the unified webhook we registered, so disconnect knows what to remove |
| `tasks_enabled` | BOOLEAN NOT NULL DEFAULT true | switch 1 |
| `auto_close_enabled` | BOOLEAN NOT NULL DEFAULT true | switch 2 |
| `connected_at` | TIMESTAMPTZ DEFAULT now() | |

RLS enabled, `user_id = auth.uid()`, as on every table here.

**`account_id UNIQUE` is the hinge of the design.** An inbound webhook carries
`accountId` and nothing else identifying; one indexed lookup on that column
answers all three questions the request needs — whose account this is, which
credentials to call Hostaway back with, and whether the user still wants any of
it. `UNIQUE` also states the rule the app depends on: one Hostaway account
cannot feed two app users.

**Deliberately NOT included**: any `last_error` / `last_ok_at` health column. A
connection that has quietly stopped working is a real risk in this project's
history, but it is a feature with its own UI and its own spec, and guessing at
it now would ship a column nobody reads. Noted in BACKLOG instead.

### §1.1 Where the switches live
On the connection row, not in `app_settings`.

`app_settings` is where the Calendar toggles live, so consistency argues for it.
Three things argue louder the other way: the switches are properties OF the
connection and should disappear with it; `app_settings` is a per-user singleton
with a history of duplicate rows (see DATABASE_SCHEMA.md) and this is not a
place to inherit that; and the webhook path — which runs on every guest message
— gets identity and permission from ONE query with no join.

## §2 Encryption

New `crypto.py`, small and boring: Fernet (symmetric, authenticated), key read
from `HOSTAWAY_ENCRYPTION_KEY` in Render's environment.

```
encrypt_secret(plaintext: str) -> str
decrypt_secret(ciphertext: str) -> str
```

A Hostaway secret is not a password to this app — it is full API access to
someone else's property management system: reservations, guest names, emails,
phone numbers. For the owner's own credentials plaintext was defensible. For a
second business's credentials it is not, and a database dump should not be
enough to take over a stranger's PMS.

**Accepted cost**: one more environment variable. If the key is lost, every
stored secret is undecryptable and each user reconnects. Recoverable, but it
must be written down where the other secrets are.

**Known inconsistency, deliberately not fixed here**: `google_calendar_connections`
still stores OAuth tokens in the clear. Out of scope; goes to BACKLOG.

## §3 What this breaks (the actual size of the work)

The UI is the small part. These are the load-bearing changes:

| today | after |
|---|---|
| `get_user_id_for_hostaway_account()` returns a hardcoded id, ignoring its argument | real lookup by `account_id`, returning **`None`** when there is no connection |
| `_get_hostaway_access_token()` — one process-global token from `.env` | one token **per account**, cached per `account_id` |
| `get_listing_name` / `get_reservation_details` / `get_conversation_messages` take no credentials | take the caller's connection |
| `_check_hostaway_replies` polls for every user with open Hostaway tasks | no connection or `auto_close_enabled` false → **zero API calls** |
| webhook assumes the message is the owner's | unknown `accountId` or `tasks_enabled` false → logged and ignored, still 200 |

The webhook must keep returning 200 on every one of those paths. Hostaway
disables endpoints that fail repeatedly, and "this account is not connected" is
not a failure of ours.

The `None` return is the important one. Every caller has to handle it, and the
handling is always the same: log which account was seen, do nothing, return
success. A silent `KeyError` here would look exactly like the bug that started
all of this.

## §4 Connect and disconnect

### §4.1 Connect — `POST /integrations/hostaway`
Body: `account_id`, `client_secret`.

1. **Validate first, store second.** Exchange the credentials for an access
   token. On failure: 400 with a message the user can act on, and **nothing is
   written**. A saved-but-broken connection is worse than no connection.
2. **Look before creating.** `GET /v1/webhooks/unifiedWebhooks`; if one already
   points at our URL, reuse its `id`. Reconnecting must not leave a trail of
   duplicate webhooks delivering the same message five times.
3. Otherwise create one: our URL, `events: ["message.received"]`.
4. Write the row, secret encrypted.

Step 2 is what makes the owner's own migration (§6) a no-op rather than a
duplicate: webhook 34986 already exists and points at the right place.

### §4.2 Disconnect — `DELETE /integrations/hostaway`
Delete the webhook from their account by `webhook_id` (best effort — log and
continue on failure), then delete the row. **Existing Hostaway tasks are left
alone**: they are the user's work, not the connection's data.

### §4.3 Fallback if POST is not supported
The connect endpoint stores the connection and returns a flag saying the webhook
must be added by hand; the UI shows the URL and the event name to select. Same
data model, same switches, one manual step.

## §5 API and UI

Four endpoints, all behind `get_current_user_id`:

| method | returns / does |
|---|---|
| `GET /integrations/hostaway` | `{connected, account_id, tasks_enabled, auto_close_enabled}` — **never the secret** |
| `POST /integrations/hostaway` | §4.1 |
| `PATCH /integrations/hostaway` | either switch |
| `DELETE /integrations/hostaway` | §4.2 |

UI: a `SettingsRow` labelled Hostaway in the main Settings list opening a
`HostawayConnectionView`, built the same way as `CalendarConnectionView`
(`SettingsModal.jsx`). Disconnected: two fields and a Connect button.
Connected: a confirmation line with the account id, the two switches, and
Disconnect. EN and EL strings both.

The switch copy has to say what it does, because "Hostaway" alone tells the user
nothing:
- **Δημιουργία tasks από μηνύματα** — new guest messages become tasks.
- **Αυτόματο κλείσιμο όταν απαντάς** — replying to a guest closes the task it
  belongs to (P3 only today — see `HOSTAWAY_REPLY_AUTOCOMPLETE_PRIORITIES`).

## §6 Migrating the owner

A one-off script writes the owner's row from `.env`: `account_id` `147809`, the
secret encrypted, `webhook_id` `34986` — which already exists and already points
at the deployed endpoint. `user_id` is unchanged, so the 152 existing tasks and
every open conversation keep working with no data change at all.

The `.env` variables stay put until the row is confirmed working, then become
dead weight to be removed in a later cleanup. They are not read once the lookup
exists.

## §7 Testing

Unit, no network:
- encrypt → decrypt round-trips; ciphertext is not the plaintext.
- unknown `accountId` → `None`, and the webhook returns 200 having written
  nothing.
- `tasks_enabled` false → guest message creates no task.
- `auto_close_enabled` false → the poller makes **no HTTP call at all** (assert
  on the call recorder, not on the result).
- two connected users → each one's poll uses that user's credentials. This is
  the test that would catch the hardcoded id coming back.

With a faked Hostaway API:
- connect with bad credentials writes no row.
- connect twice does not create a second webhook.
- disconnect removes the webhook, then the row, and leaves tasks intact.

## §8 Accepted consequences

- **Gemini classification is billed to the owner's key** for every connected
  user's guest messages. Negligible at two users, a business decision at fifty.
  Not solved here.
- **Polling scales with connected users.** The existing per-user ceiling
  (`HOSTAWAY_REPLY_POLL_LIMIT = 20` conversations) now applies per user, so the
  worst case per tick is users × 20 HTTP calls. Fine at two; worth a queue long
  before it is a problem.
- **One Hostaway account cannot be shared by two app users.** Enforced by
  `account_id UNIQUE`. A team wanting shared inboxes needs a different design.
