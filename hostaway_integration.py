import os
import logging
import time
import requests
from google import genai
from google.genai import types
from pydantic import ValidationError, BaseModel
from typing import Literal
from dotenv import load_dotenv

load_dotenv()

HOSTAWAY_CLIENT_ID = os.getenv("HOSTAWAY_CLIENT_ID")
HOSTAWAY_CLIENT_SECRET = os.getenv("HOSTAWAY_CLIENT_SECRET")

google_api_key = os.getenv("GOOGLE_API_KEY")
client = genai.Client(api_key=google_api_key)

HOSTAWAY_CLASSIFICATION_MODEL = "gemini-3.5-flash"  # deliberately the higher-accuracy model, not the cheaper agent model — misclassifying a real guest emergency has real business consequences

_cached_access_token = None


def _get_hostaway_access_token() -> str:
    """
    Gets (and caches in-process) an OAuth2 access token for calling back
    into Hostaway's API. Tokens are valid 24 months per Hostaway's docs,
    so simple in-memory caching (re-fetched on process restart/redeploy)
    is sufficient — no need for persistent storage given this app's scale.
    """
    global _cached_access_token
    if _cached_access_token:
        return _cached_access_token

    if not HOSTAWAY_CLIENT_ID or not HOSTAWAY_CLIENT_SECRET:
        raise RuntimeError("HOSTAWAY_CLIENT_ID / HOSTAWAY_CLIENT_SECRET not configured")

    response = requests.post(
        "https://api.hostaway.com/v1/accessTokens",
        data={
            "grant_type": "client_credentials",
            "client_id": HOSTAWAY_CLIENT_ID,
            "client_secret": HOSTAWAY_CLIENT_SECRET,
            "scope": "general",
        },
        headers={"Content-type": "application/x-www-form-urlencoded", "Cache-control": "no-cache"},
        timeout=10,
    )
    response.raise_for_status()
    _cached_access_token = response.json()["access_token"]
    logging.info("[hostaway] Obtained new access token")
    return _cached_access_token


def get_listing_name(listing_map_id: int) -> str:
    """Fetches the listing's name from Hostaway. Confirmed field: 'name' (verified against Hostaway's documented Listing object schema)."""
    try:
        token = _get_hostaway_access_token()
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


def get_reservation_details(reservation_id: int) -> dict:
    """
    Fetches guest name and stay dates from Hostaway's reservation object.

    IMPORTANT: the exact field names for guest name / arrival / departure
    dates on the Reservation object were NOT fully confirmed from available
    documentation (only the Listing object schema was fully confirmed).
    The field names below (guestName, arrivalDate, departureDate) are the
    conventional Hostaway naming pattern based on related fields seen in
    their docs, but VERIFY this against the actual raw API response the
    first time this runs — log the full raw response, compare field names,
    and adjust the .get() keys below if they don't match reality.
    """
    try:
        token = _get_hostaway_access_token()
        response = requests.get(
            f"https://api.hostaway.com/v1/reservations/{reservation_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        response.raise_for_status()
        result = response.json().get("result", {})

        logging.info(f"[hostaway] Raw reservation response for verification: {result}")

        return {
            "guest_name": result.get("guestName") or "Πελάτης",
            "arrival_date": result.get("arrivalDate") or "?",
            "departure_date": result.get("departureDate") or "?",
        }
    except Exception as e:
        logging.error(f"[hostaway] Failed to fetch reservation {reservation_id}: {e}")
        return {"guest_name": "Πελάτης", "arrival_date": "?", "departure_date": "?"}


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


def classify_message(message_text: str) -> dict:
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
                return {"summary": parsed.summary, "priority": parsed.priority}
        except (ValidationError, Exception) as e:
            logging.error(f"[hostaway] Classification attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)

    # Fallback: if AI classification fails entirely, default to P1 (safer to
    # over-notify than silently drop a potentially urgent guest message)
    logging.error("[hostaway] Classification failed after retries, defaulting to P1")
    return {"summary": message_text[:200], "priority": "P1"}
