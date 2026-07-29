import logging
import os
import requests
from datetime import datetime, timedelta, timezone
from typing import Optional

import repository

GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")

if not GOOGLE_OAUTH_CLIENT_ID or not GOOGLE_OAUTH_CLIENT_SECRET:
    raise RuntimeError("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in .env")

# Default event duration for pushed tasks — tasks only have a due_time, not
# an explicit end time, so every pushed event gets this fixed duration.
EVENT_DEFAULT_DURATION_MINUTES = 30

# Extended-property key used to tag Google Calendar events that THIS app
# created, so pull_calendar_changes can tell "our own task, synced back"
# apart from arbitrary events the user created directly in Google Calendar
# (which must NOT be imported as new tasks — see Phase 2 scope notes).
TASK_ID_EXTENDED_PROPERTY = "ai_todo_app_task_id"


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
    """
    Verifies the connection works by listing a small number of events on the
    user's primary calendar — an events-scope operation, matching the
    calendar.events OAuth scope actually requested. (A calendar-metadata-only
    endpoint like GET /calendars/primary requires a broader scope than
    calendar.events and would incorrectly 403 even with a valid connection.)
    The events.list response conveniently includes a top-level 'summary'
    field with the calendar's display name, so we still get a name to show
    in the UI without needing broader scope.
    """
    access_token = get_valid_access_token(user_id)
    response = requests.get(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"maxResults": 1},
    )
    response.raise_for_status()
    data = response.json()
    return {"calendar_name": data.get("summary", "Google Calendar")}


def sync_task_to_google_calendar(user_id: str, task: dict) -> Optional[str]:
    """
    Creates or updates a Google Calendar event for this task. Returns the
    google_event_id if successful, None otherwise. Never raises — calendar
    sync failures must never block normal task operations; log and move on.
    """
    try:
        access_token = get_valid_access_token(user_id)

        if task.get("due_time"):
            start_dt = datetime.fromisoformat(f"{task['due_date']}T{task['due_time']}:00")
            end_dt = start_dt + timedelta(minutes=EVENT_DEFAULT_DURATION_MINUTES)
            time_fields = {
                "start": {"dateTime": start_dt.isoformat(), "timeZone": "Europe/Athens"},
                "end": {"dateTime": end_dt.isoformat(), "timeZone": "Europe/Athens"},
            }
        else:
            # All-day event. Google Calendar's all-day 'end.date' is EXCLUSIVE,
            # so a single-day all-day event needs end = start + 1 day.
            due_date_obj = datetime.strptime(task["due_date"], "%Y-%m-%d").date()
            next_day = due_date_obj + timedelta(days=1)
            time_fields = {
                "start": {"date": task["due_date"]},
                "end": {"date": next_day.strftime("%Y-%m-%d")},
            }

        event_body = {
            "summary": task["task_name"],
            "description": task.get("description") or "",
            **time_fields,
            "extendedProperties": {"private": {TASK_ID_EXTENDED_PROPERTY: task["id"]}},
        }

        existing_event_id = task.get("google_event_id")

        if existing_event_id:
            response = requests.put(
                f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{existing_event_id}",
                headers={"Authorization": f"Bearer {access_token}"},
                json=event_body,
            )
            if response.status_code == 404:
                existing_event_id = None  # event was deleted on Google's side; fall through to create a new one

        if not existing_event_id:
            response = requests.post(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                headers={"Authorization": f"Bearer {access_token}"},
                json=event_body,
            )

        response.raise_for_status()
        return response.json()["id"]

    except Exception as e:
        logging.error(f"[calendar sync] Failed to push task {task.get('id')} for user {user_id}: {e}")
        return None


def delete_calendar_event(user_id: str, google_event_id: str) -> None:
    """Deletes a Google Calendar event. Never raises — logs and moves on."""
    try:
        access_token = get_valid_access_token(user_id)
        requests.delete(
            f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{google_event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    except Exception as e:
        logging.error(f"[calendar sync] Failed to delete event {google_event_id} for user {user_id}: {e}")


BOOTSTRAP_LOOKBACK_DAYS = 90


def _bootstrap_time_min_isoformat() -> str:
    """
    90 days before now, in UTC. Used as the bootstrap sync's timeMin so a
    fresh sync captures past events too, not just from today onward. No
    corresponding timeMax — future events stay unbounded, since Google's
    events.list with only timeMin already returns everything from that
    point forward (paginated).
    """
    lookback_start = datetime.now(timezone.utc) - timedelta(days=BOOTSTRAP_LOOKBACK_DAYS)
    return lookback_start.isoformat()


def pull_calendar_changes(user_id: str) -> int:
    """
    Pulls changes from Google Calendar since the last sync (using Google's
    incremental sync token mechanism), and for any changed event that has
    OUR OWN task-id marker, updates or unlinks the corresponding task.
    Events without our marker are ignored (see Phase 2 scope notes —
    deliberately not importing arbitrary calendar events as new tasks).
    Returns the number of our-own-task events processed.
    """
    connection = repository.get_google_calendar_connection(user_id)
    if not connection:
        return 0

    access_token = get_valid_access_token(user_id)
    sync_token = connection.get("calendar_sync_token")

    # singleEvents=True expands recurring events into their actual individual
    # date instances (without it, a recurring event only shows its first-ever
    # occurrence) — kept on both request paths per Google's docs, which say a
    # syncToken request should keep the same non-excluded parameters as the
    # initial sync.
    params = {"maxResults": 250, "singleEvents": True}
    if sync_token:
        params["syncToken"] = sync_token
        # Do NOT add orderBy, timeMin, timeMax, q, or updatedMin here — all
        # confirmed incompatible with syncToken (Google returns HTTP 400).
        logging.info(f"[calendar pull] user={user_id} using syncToken={sync_token[:20]}...")
    else:
        params["timeMin"] = _bootstrap_time_min_isoformat()
        params["orderBy"] = "startTime"  # only valid (and only added) for non-syncToken requests
        logging.info(f"[calendar pull] user={user_id} BOOTSTRAP sync, timeMin={params['timeMin']}")

    changes_processed = 0

    while True:
        logging.info(f"[calendar pull DIAGNOSTIC] user={user_id} requesting with params={params}")
        response = requests.get(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )

        if response.status_code == 410:
            # Sync token expired/invalid — reset and do a fresh sync from now
            logging.info(f"[calendar pull] user={user_id} sync token expired (410), resetting to fresh bootstrap")
            repository.update_calendar_sync_token(user_id, None)
            params.pop("syncToken", None)
            params["timeMin"] = _bootstrap_time_min_isoformat()
            params["orderBy"] = "startTime"  # this retry is also a fresh bootstrap (no syncToken)
            logging.info(f"[calendar pull DIAGNOSTIC] user={user_id} retrying with params={params}")
            response = requests.get(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
            )

        response.raise_for_status()
        data = response.json()

        items = data.get("items", [])
        logging.info(f"[calendar pull] user={user_id} Google returned {len(items)} events in this page")
        logging.info(f"[calendar pull DIAGNOSTIC] user={user_id} raw event count: {len(items)}")
        for event in items:
            logging.info(
                f"[calendar pull DIAGNOSTIC] event: id={event.get('id')} "
                f"summary={event.get('summary')!r} eventType={event.get('eventType')} "
                f"organizer={event.get('organizer')} creator={event.get('creator')} "
                f"start={event.get('start')} recurringEventId={event.get('recurringEventId')} "
                f"status={event.get('status')}"
            )

        for event in items:
            task_id = event.get("extendedProperties", {}).get("private", {}).get(TASK_ID_EXTENDED_PROPERTY)
            event_summary = event.get("summary", "(no title)")
            event_start = event.get("start", {})
            event_status = event.get("status")
            logging.info(
                f"[calendar pull] event: summary={event_summary!r} status={event_status} "
                f"start={event_start} our_task_id={task_id!r}"
            )

            if task_id:
                # Our own task-linked event.
                if event.get("status") == "cancelled":
                    repository.mark_task_calendar_deleted(task_id)
                    logging.info(f"[calendar pull] task {task_id} calendar event deleted — note added, unlinked")
                else:
                    start_info = event.get("start", {})
                    start_datetime = start_info.get("dateTime")
                    start_date = start_info.get("date")

                    if start_datetime:
                        dt = datetime.fromisoformat(start_datetime)
                        due_date = dt.strftime("%Y-%m-%d")
                        due_time = dt.strftime("%H:%M")
                    elif start_date:
                        due_date = start_date
                        due_time = None
                    else:
                        logging.info(f"[calendar pull] event for task {task_id} has no start date/time, skipping")
                        continue  # malformed event, skip

                    repository.update_task_from_calendar_event(
                        task_id, due_date, due_time, event.get("summary", "")
                    )
                    logging.info(f"[calendar pull] updated task {task_id}: due_date={due_date} due_time={due_time}")
            else:
                # Foreign event (not created by this app) — store it for the
                # separate "Google Calendar Events" view, do NOT create a task.
                if event.get("status") == "cancelled":
                    repository.delete_google_calendar_event_record(user_id, event["id"])
                    logging.info(f"[calendar pull] foreign event {event['id']} removed (cancelled on Google's side)")
                else:
                    start_info = event.get("start", {})
                    start_datetime = start_info.get("dateTime")
                    start_date_only = start_info.get("date")

                    if start_datetime:
                        dt = datetime.fromisoformat(start_datetime)
                        ev_date = dt.strftime("%Y-%m-%d")
                        ev_time = dt.strftime("%H:%M")
                        is_all_day = False
                    elif start_date_only:
                        ev_date = start_date_only
                        ev_time = None
                        is_all_day = True
                    else:
                        logging.info(f"[calendar pull] foreign event {event.get('id')} has no start date/time, skipping")
                        continue  # malformed event, skip

                    repository.upsert_google_calendar_event(
                        user_id=user_id,
                        google_event_id=event["id"],
                        title=event.get("summary", "(χωρίς τίτλο)"),
                        description=event.get("description", ""),
                        start_date=ev_date,
                        start_time=ev_time,
                        is_all_day=is_all_day,
                    )
                    logging.info(f"[calendar pull] stored foreign event {event['id']}: start_date={ev_date} start_time={ev_time}")

            changes_processed += 1

        page_token = data.get("nextPageToken")
        if page_token:
            params["pageToken"] = page_token
            continue

        next_sync_token = data.get("nextSyncToken")
        if next_sync_token:
            repository.update_calendar_sync_token(user_id, next_sync_token)
            logging.info(f"[calendar pull] user={user_id} stored new syncToken for next run")
        break

    logging.info(f"[calendar pull] user={user_id} finished, {changes_processed} of our own tasks processed")
    return changes_processed
