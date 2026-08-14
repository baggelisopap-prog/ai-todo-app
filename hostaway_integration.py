import os
import logging
import time
import requests
from google import genai
from google.genai import types
from pydantic import ValidationError, BaseModel
from typing import Literal, NamedTuple, Optional
from dotenv import load_dotenv

import crypto
import token_tracker

load_dotenv()

google_api_key = os.getenv("GOOGLE_API_KEY")
client = genai.Client(api_key=google_api_key)

HOSTAWAY_CLASSIFICATION_MODEL = "gemini-3.5-flash"  # deliberately the higher-accuracy model, not the cheaper agent model — misclassifying a real guest emergency has real business consequences

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


def get_listing_name(listing_map_id: int, credentials: HostawayCredentials) -> str:
    """Fetches the listing's name from Hostaway. Confirmed field: 'name' (verified against Hostaway's documented Listing object schema)."""
    try:
        token = get_access_token(credentials)
        response = requests.get(
            f"https://api.hostaway.com/v1/listings/{listing_map_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        response.raise_for_status()
        result = response.json().get("result", {})
        return result.get("name") or "Άγνωστο property"
    except Exception as e:
        logging.error(f"[hostaway] Failed to fetch listing {listing_map_id}: {e}")
        return "Άγνωστο property"


def get_reservation_details(reservation_id: int, credentials: HostawayCredentials) -> dict:
    """
    Fetches guest name and stay dates from Hostaway's reservation object.

    Field names VERIFIED against a live API response (2026-08-10): the
    Reservation object really does carry guestName, arrivalDate and
    departureDate. This previously warned that they were guessed from a
    naming pattern and had never been confirmed — they were right.
    """
    try:
        token = get_access_token(credentials)
        response = requests.get(
            f"https://api.hostaway.com/v1/reservations/{reservation_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        response.raise_for_status()
        result = response.json().get("result", {})

        return {
            "guest_name": result.get("guestName") or "Πελάτης",
            "arrival_date": result.get("arrivalDate") or "?",
            "departure_date": result.get("departureDate") or "?",
        }
    except Exception as e:
        logging.error(f"[hostaway] Failed to fetch reservation {reservation_id}: {e}")
        return {"guest_name": "Πελάτης", "arrival_date": "?", "departure_date": "?"}


def get_conversation_messages(conversation_id, credentials: HostawayCredentials) -> list[dict]:
    """
    Every message in one Hostaway conversation, newest first.

    This is how the app learns that a human replied to a guest. The webhook
    cannot tell us: it is subscribed to `message.received`, which is the only
    message event Hostaway's unified webhooks offer — the account's three
    other registered webhooks (Make, Zapier, GuestArrive) each enumerate the
    same five events and none of them covers a sent message. Verified
    2026-08-12 against the API, and against `tasks`, where
    hostaway_answered_at was null on every row ever written while real human
    replies sat in this endpoint.

    Field names VERIFIED against a live response (2026-08-12, conversations
    49166048 and 44234683): `date` ("2026-08-12 07:51:05", naive and
    listing-local, exactly what parse_hostaway_datetime reads), `isIncoming`,
    `userId`, `communicationId`, `communicationEvent`.

    Returns [] on any failure rather than raising. That is the safe
    direction: no reply seen means the task stays open and is closed by
    hand, and the scheduler tick that calls this must not die on it.
    """
    try:
        token = get_access_token(credentials)
        response = requests.get(
            f"https://api.hostaway.com/v1/conversations/{conversation_id}/messages",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        response.raise_for_status()
        return response.json().get("result") or []
    except Exception as e:
        logging.error(f"[hostaway] Failed to fetch messages for conversation {conversation_id}: {e}")
        return []


class _MessageClassification(BaseModel):
    summary: str
    priority: Literal["P1", "P2", "P3"]


def _build_classification_instruction() -> str:
    return """You are classifying guest messages from a vacation rental property management system to determine urgency and summarize what the guest needs.

PRIORITY CLASSIFICATION RULES (apply strictly):
- P1 (immediate/critical — affects the guest's ability to actually stay at the property right now): can't find the keys, can't find the property/house, arrived and the property isn't ready or clean, power outage and guest doesn't know what to do, a burst/broken pipe, or similar emergencies that block or severely disrupt the stay.
- P2 (guest experience/comfort issues, not critical): missing a towel, a slow water heater, can't find some item or amenity, similar comfort issues that don't block the stay but affect satisfaction.
- P3 (general questions or minor consumable requests that don't change the core experience): questions about nearby places or attractions, requests for extra towels, running out of soap or toilet paper, general non-stay-critical questions.

Read the guest's message and:
1. Write a brief summary (1-2 sentences) of what they need, in the SAME language as the message.
2. Classify the priority as P1, P2, or P3 based on the rules above — when genuinely ambiguous between two levels, prefer the MORE urgent classification (better to over-notify on a real issue than miss one).

Respond only with the structured output matching the required schema."""


def classify_message(message_text: str, user_id: str) -> dict:
    """
    Uses AI to summarize a guest message and classify its priority.
    Uses gemini-3.5-flash (not the cheaper agent model) since misclassifying
    a real guest emergency has real business consequences — accuracy matters
    more than cost here, and call volume is naturally low (guest messages
    per day, not per-query agent traffic).
    """
    system_instruction = _build_classification_instruction()

    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=HOSTAWAY_CLASSIFICATION_MODEL,
                contents=message_text,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    response_mime_type="application/json",
                    response_schema=_MessageClassification,
                ),
            )
            if response and response.text:
                parsed = _MessageClassification.model_validate_json(response.text)
                try:
                    token_tracker.log_token_usage("hostaway_classification", response.usage_metadata, model=HOSTAWAY_CLASSIFICATION_MODEL, user_id=user_id)
                except Exception as e:
                    logging.error(f"[hostaway] Failed to log token usage: {e}")
                return {"summary": parsed.summary, "priority": parsed.priority}
        except (ValidationError, Exception) as e:
            logging.error(f"[hostaway] Classification attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)

    # Fallback: if AI classification fails entirely, default to P1 (safer to
    # over-notify than silently drop a potentially urgent guest message)
    logging.error("[hostaway] Classification failed after retries, defaulting to P1")
    return {"summary": message_text[:200], "priority": "P1"}


HOSTAWAY_WEBHOOK_EVENTS = ["message.received"]


def hostaway_register_webhook(credentials: HostawayCredentials, callback_url: str) -> Optional[int]:
    """
    Points the user's Hostaway account at our webhook, and returns its id.

    Looks before creating: reconnecting must not leave a trail of duplicate
    webhooks all delivering the same guest message. Returns the existing id
    when one already points at callback_url.

    POST here was ASSUMED until 2026-08-14, when it was called once against
    the owner's account: 200, with the new id at result.id (design spec,
    "POST and DELETE, as they actually answered").
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
    """
    Removes a webhook we registered. Returns whether Hostaway accepted it.

    The success body is `{"status": "success", "result": []}` — an empty list,
    not the deleted object — so the status code is the only thing to read.
    """
    token = get_access_token(credentials)
    response = requests.delete(
        f"https://api.hostaway.com/v1/webhooks/unifiedWebhooks/{webhook_id}",
        headers={"Authorization": f"Bearer {token}"}, timeout=10,
    )
    return response.status_code < 300
