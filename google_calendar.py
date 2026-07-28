import os
import requests
from datetime import datetime, timedelta, timezone

import repository

GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")

if not GOOGLE_OAUTH_CLIENT_ID or not GOOGLE_OAUTH_CLIENT_SECRET:
    raise RuntimeError("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in .env")


def get_valid_access_token(user_id: str) -> str:
    """
    Returns a valid (non-expired) Google access token for this user,
    transparently refreshing it via Google's OAuth endpoint if expired.
    This is OUR OWN refresh logic — deliberately not relying on Supabase's
    session refresh, which does not reliably refresh the underlying
    Google provider token (documented Supabase limitation).
    """
    connection = repository.get_google_calendar_connection(user_id)
    if not connection:
        raise RuntimeError("No Google Calendar connection for this user")

    expiry = datetime.fromisoformat(connection["token_expiry"])
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    if datetime.now(timezone.utc) >= expiry:
        response = requests.post("https://oauth2.googleapis.com/token", data={
            "client_id": GOOGLE_OAUTH_CLIENT_ID,
            "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
            "refresh_token": connection["refresh_token"],
            "grant_type": "refresh_token",
        })
        response.raise_for_status()
        new_tokens = response.json()
        new_access_token = new_tokens["access_token"]
        new_expiry = datetime.now(timezone.utc) + timedelta(seconds=new_tokens.get("expires_in", 3600))
        repository.update_google_calendar_token(user_id, new_access_token, new_expiry)
        return new_access_token

    return connection["access_token"]


def test_calendar_connection(user_id: str) -> dict:
    """Verifies the connection actually works by fetching the user's primary calendar's metadata."""
    access_token = get_valid_access_token(user_id)
    response = requests.get(
        "https://www.googleapis.com/calendar/v3/calendars/primary",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    response.raise_for_status()
    return response.json()
