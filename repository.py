import os
import logging
from datetime import datetime, timezone
from typing import Optional
from dotenv import load_dotenv
from supabase import create_client
from models import TaskRecord, PushSubscriptionRequest, PushSubscriptionRecord, AppSettings

# Set up module-level logging
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")

if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env")

# Single module-level client, reused by every function below. The secret
# key always bypasses RLS — every function in this file is therefore
# responsible for its own user_id scoping (RLS is not doing this for us).
supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def _get(row: dict, key: str, default=None):
    """
    Reads a key from a Supabase row, substituting `default` for both a
    missing key AND an explicit SQL NULL. Airtable omitted blank fields
    entirely (so plain dict.get(key, default) was safe there); Supabase
    always includes every column, with blanks coming back as None — so a
    bare dict.get default only kicks in for absent keys, not NULLs, and
    would silently let None through where the rest of the app expects a
    typed default (e.g. "" or False).
    """
    value = row.get(key)
    return value if value is not None else default


class AirtableTaskRepository:
    """
    Repository layer for managing TaskRecord persistence in Supabase.

    Kept the name AirtableTaskRepository (rather than renaming to something
    like SupabaseTaskRepository) because services.py imports and type-hints
    against this exact class name. It is now backed by Supabase's Postgres
    `tasks` table, not Airtable, and — as of this phase — every method
    requires the caller's user_id and scopes its query accordingly. The
    secret key client bypasses RLS, so this in-code scoping is the actual
    enforcement mechanism, not a belt-and-suspenders extra.
    """

    def __init__(self):
        # The module-level `supabase` client above already does all the
        # setup/validation; nothing instance-specific is needed here, but
        # __init__ is kept so `AirtableTaskRepository()` still works
        # everywhere it's currently called.
        logger.info("AirtableTaskRepository initialized (Supabase-backed, table: tasks)")

    def _checklist_to_jsonb(self, checklist) -> list[dict]:
        """
        Normalizes a checklist (list of ChecklistItem models or plain dicts)
        into a list of plain dicts ready to hand to the Supabase client,
        which JSON-encodes them into the JSONB column automatically.
        """
        return [
            item if isinstance(item, dict) else item.model_dump()
            for item in (checklist or [])
        ]

    def _task_to_supabase_fields(self, task: TaskRecord) -> dict:
        """
        Translates a Pydantic TaskRecord into a Supabase-ready fields
        dictionary. Strips server-generated metadata (record_id,
        created_time) that the DB manages itself. Does NOT include
        user_id — callers (save_task) add that separately, since it's an
        ownership concern, not part of the task's own data.
        """
        fields = task.model_dump()

        # Remove server-generated fields Supabase manages itself
        fields.pop("record_id", None)
        fields.pop("created_time", None)

        # checklist is a JSONB column now — hand it a plain list of dicts,
        # no manual JSON string encoding needed.
        fields["checklist"] = self._checklist_to_jsonb(task.checklist)

        return fields

    def _supabase_row_to_task(self, row: dict) -> TaskRecord:
        """
        Translates a raw Supabase row (already a flat dict — no nested
        "fields" wrapper like Airtable had) back into a Pydantic TaskRecord.
        Deliberately does not surface user_id on TaskRecord — ownership is
        a data-layer scoping concern, not part of the model callers/the
        frontend need to see.
        """
        record_id = row.get("id")

        # checklist arrives already parsed (JSONB) as a list of dicts/None.
        # Still normalize defensively to accept legacy list[str] items,
        # same as the old Airtable path did.
        raw_checklist = row.get("checklist") or []
        normalized = []
        for item in raw_checklist:
            if isinstance(item, str):
                normalized.append({"text": item, "done": False})
            elif isinstance(item, dict) and "text" in item:
                normalized.append({"text": item["text"], "done": item.get("done", False)})
        checklist = normalized

        # Enforce strict data integrity on immutable snapshot fields. Unlike
        # Airtable (which omits empty fields entirely), Supabase always
        # includes the key in a `select("*")` row — so the check here is
        # against a None/missing value, not key absence.
        if row.get("ai_suggested_category") is None:
            raise ValueError(
                f"Record {record_id} is missing ai_suggested_category. "
                "This is a data integrity issue — the field should never be empty."
            )
        if row.get("ai_suggested_priority") is None:
            raise ValueError(
                f"Record {record_id} is missing ai_suggested_priority. "
                "This is a data integrity issue — the field should never be empty."
            )

        # Construct the Pydantic object, providing safe defaults for fields Supabase might return as null
        return TaskRecord(
            task_name=_get(row, "task_name", ""),
            description=_get(row, "description", ""),
            category=_get(row, "category", "Unknown"),
            priority=_get(row, "priority", "P3"),
            due_date=row.get("due_date"),
            due_time=row.get("due_time"),
            checklist=checklist,
            approval_status=_get(row, "approval_status", False),
            is_completed=_get(row, "is_completed", False),
            is_rejected=_get(row, "is_rejected", False),
            notify_enabled=_get(row, "notify_enabled", False),
            notification_sent=_get(row, "notification_sent", False),
            calendar_sync_enabled=_get(row, "calendar_sync_enabled", False),
            ai_suggested_category=row["ai_suggested_category"],
            ai_suggested_priority=row["ai_suggested_priority"],
            record_id=record_id,
            created_time=row.get("created_time"),
            hostaway_created_at=row.get("hostaway_created_at"),
            hostaway_last_notified_at=row.get("hostaway_last_notified_at"),
        )

    def save_task(self, user_id: str, task: TaskRecord) -> TaskRecord:
        """
        Creates a new task record in Supabase, owned by user_id.
        Returns a new TaskRecord instance containing the server-generated record_id and created_time.
        """
        fields_dict = self._task_to_supabase_fields(task)
        fields_dict["user_id"] = user_id

        response = supabase.table("tasks").insert(fields_dict).execute()
        new_row = response.data[0]

        logger.info(f"Successfully saved new task to Supabase. Assigned ID: {new_row.get('id')}")

        return self._supabase_row_to_task(new_row)

    def get_all_tasks(self, user_id: str) -> list[TaskRecord]:
        """
        Retrieves all task records belonging to user_id.
        """
        response = supabase.table("tasks").select("*").eq("user_id", user_id).execute()
        rows = response.data
        logger.info(f"Retrieved {len(rows)} tasks from Supabase for user {user_id}.")
        return [self._supabase_row_to_task(row) for row in rows]

    def get_task(self, user_id: str, record_id: str) -> Optional[TaskRecord]:
        """
        Retrieves a single task by its Supabase record_id (UUID), scoped to
        user_id. Returns None if the record does not exist OR belongs to a
        different user.
        """
        try:
            response = (
                supabase.table("tasks")
                .select("*")
                .eq("id", record_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not response.data:
                return None
            return self._supabase_row_to_task(response.data[0])
        except Exception as e:
            # Catching a broad exception here since our requirement is
            # strictly "return None if not found/failed".
            logger.warning(f"Failed to retrieve task with ID {record_id} for user {user_id}: {e}")
            return None

    def update_task(self, user_id: str, record_id: str, updates: dict) -> TaskRecord:
        """
        Updates specific fields on an existing Supabase task, scoped to
        user_id. Applies data mapping (like checklist normalization) to the
        update dictionary before sending. Returns the fully updated
        TaskRecord.
        """
        # Work on a copy so we don't mutate the caller's dict
        mapped_updates = updates.copy()

        # Rescheduling (edit or drag-and-drop) invalidates any reminder
        # already sent for the old time, so it can fire again at the new one.
        if "due_date" in mapped_updates or "due_time" in mapped_updates:
            current = self.get_task(user_id, record_id)
            if current is not None:
                new_due_date = mapped_updates.get("due_date", current.due_date)
                new_due_time = mapped_updates.get("due_time", current.due_time)
                if new_due_date != current.due_date or new_due_time != current.due_time:
                    mapped_updates["notification_sent"] = False

        # Apply data mapping rules to the partial update dictionary
        if "checklist" in mapped_updates:
            mapped_updates["checklist"] = self._checklist_to_jsonb(mapped_updates["checklist"])

        # Prevent accidental overwrites of read-only fields
        mapped_updates.pop("record_id", None)
        mapped_updates.pop("created_time", None)

        # Double eq is deliberate defense-in-depth: even if a wrong/spoofed
        # record_id were somehow passed, this guarantees the update can
        # only ever affect a row that ALSO belongs to user_id.
        response = (
            supabase.table("tasks")
            .update(mapped_updates)
            .eq("id", record_id)
            .eq("user_id", user_id)
            .execute()
        )

        logger.info(f"Successfully updated task in Supabase. ID: {record_id}")
        return self._supabase_row_to_task(response.data[0])

    def delete_task(self, user_id: str, record_id: str) -> bool:
        """
        Permanently deletes a task from Supabase, scoped to user_id.
        Returns True if deletion succeeded.
        """
        response = (
            supabase.table("tasks")
            .delete()
            .eq("id", record_id)
            .eq("user_id", user_id)
            .execute()
        )
        logger.info(f"Successfully deleted task from Supabase. ID: {record_id}")
        return bool(response.data)


# Shared singleton instance, so both the scheduler helpers and the bare
# module-level convenience functions below reuse the same row-parsing
# logic (_supabase_row_to_task) instead of duplicating it.
_shared_tasks_repo = None


def _get_shared_tasks_repo() -> "AirtableTaskRepository":
    global _shared_tasks_repo
    if _shared_tasks_repo is None:
        _shared_tasks_repo = AirtableTaskRepository()
    return _shared_tasks_repo


def get_tasks_for_user(user_id: str) -> list[TaskRecord]:
    """
    Module-level convenience read for callers that don't hold a repository
    instance of their own (e.g. agent_engine.py, which imports this module
    directly rather than instantiating AirtableTaskRepository). Delegates
    to the shared instance so parsing stays identical everywhere.
    """
    return _get_shared_tasks_repo().get_all_tasks(user_id=user_id)


# --- Push subscriptions ---
# Module-level functions since push subscriptions don't need the heavier
# field-mapping logic tasks do.


def _supabase_row_to_push_subscription(row: dict) -> PushSubscriptionRecord:
    return PushSubscriptionRecord(
        record_id=row.get("id"),
        endpoint=_get(row, "endpoint", ""),
        p256dh=_get(row, "p256dh", ""),
        auth=_get(row, "auth", ""),
    )


def save_push_subscription(user_id: str, subscription: PushSubscriptionRequest) -> PushSubscriptionRecord:
    """
    Upserts a push subscription by (user_id, endpoint) — the endpoint URL
    is effectively unique per browser installation, but scoping the
    existence check by user_id too means two different accounts logging
    into the same browser each get their own row instead of silently
    overwriting one another's subscription. If a matching record already
    exists, update its keys; otherwise create a new one.
    """
    fields = {
        "endpoint": subscription.endpoint,
        "p256dh": subscription.keys.p256dh,
        "auth": subscription.keys.auth,
    }

    existing = (
        supabase.table("push_subscriptions")
        .select("id")
        .eq("endpoint", subscription.endpoint)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        response = (
            supabase.table("push_subscriptions")
            .update(fields)
            .eq("id", existing.data[0]["id"])
            .execute()
        )
        logger.info(f"Updated existing push subscription. ID: {response.data[0].get('id')}")
    else:
        response = supabase.table("push_subscriptions").insert({**fields, "user_id": user_id}).execute()
        logger.info(f"Created new push subscription. ID: {response.data[0].get('id')}")

    return _supabase_row_to_push_subscription(response.data[0])


def list_push_subscriptions(user_id: str) -> list[PushSubscriptionRecord]:
    """Returns all stored push subscriptions belonging to user_id."""
    response = supabase.table("push_subscriptions").select("*").eq("user_id", user_id).execute()
    return [_supabase_row_to_push_subscription(row) for row in response.data]


def delete_push_subscription(user_id: str, endpoint: str) -> None:
    """Removes a subscription by (user_id, endpoint) (used when a push fails permanently, e.g. 404/410)."""
    existing = (
        supabase.table("push_subscriptions")
        .select("id")
        .eq("endpoint", endpoint)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        record_id = existing.data[0]["id"]
        supabase.table("push_subscriptions").delete().eq("id", record_id).eq("user_id", user_id).execute()
        logger.info(f"Deleted stale push subscription. ID: {record_id}")


# --- App settings ---
# Single-record-per-user table holding app-wide toggles. Always targets the
# oldest existing row for that user_id (ordered by created_at) as the
# canonical per-user singleton, which also fixes the old duplication bug
# going forward: every write now consistently updates that one row instead
# of sometimes inserting a new one.


def get_app_settings(user_id: str) -> AppSettings:
    """
    Reads user_id's single app_settings record (oldest by created_at). If
    no record exists yet (first run), returns default settings without
    creating a row — the row gets created on first write via
    update_app_settings.
    """
    response = (
        supabase.table("app_settings")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at")
        .limit(1)
        .execute()
    )
    if not response.data:
        return AppSettings()
    row = response.data[0]
    return AppSettings(
        notifications_enabled=_get(row, "notifications_enabled", True),
        send_all_enabled=_get(row, "send_all_enabled", True),
        daily_summary_enabled=_get(row, "daily_summary_enabled", False),
        daily_summary_mode=_get(row, "daily_summary_mode", "fixed_time"),
        daily_summary_time=_get(row, "daily_summary_time", "08:00"),
        daily_summary_last_sent_date=_get(row, "daily_summary_last_sent_date", ""),
        calendar_sync_all_enabled=_get(row, "calendar_sync_all_enabled", False),
    )


def update_app_settings(user_id: str, **fields) -> AppSettings:
    """
    Upserts user_id's single app_settings record with whatever fields are
    passed (typically the 5 user-facing settings; update_daily_summary_last_sent_date
    below writes daily_summary_last_sent_date separately). After writing,
    re-reads via get_app_settings so the return value reflects the true
    current row (including any fields this call didn't touch) rather than
    just echoing back the inputs.
    """
    existing = (
        supabase.table("app_settings")
        .select("id")
        .eq("user_id", user_id)
        .order("created_at")
        .limit(1)
        .execute()
    )
    if existing.data:
        supabase.table("app_settings").update(fields).eq("id", existing.data[0]["id"]).execute()
    else:
        supabase.table("app_settings").insert({**fields, "user_id": user_id}).execute()
    return get_app_settings(user_id)


def update_daily_summary_last_sent_date(user_id: str, date_str: str) -> None:
    """Upserts daily_summary_last_sent_date on user_id's single app_settings record."""
    fields = {"daily_summary_last_sent_date": date_str}
    existing = (
        supabase.table("app_settings")
        .select("id")
        .eq("user_id", user_id)
        .order("created_at")
        .limit(1)
        .execute()
    )
    if existing.data:
        supabase.table("app_settings").update(fields).eq("id", existing.data[0]["id"]).execute()
    else:
        supabase.table("app_settings").insert({**fields, "user_id": user_id}).execute()


# --- Multi-user enumeration ---


def get_all_active_user_ids() -> list[str]:
    """Returns every user_id that has a profile — used by the scheduler to loop through all users."""
    result = supabase.table("profiles").select("id").execute()
    return [row["id"] for row in result.data]


# --- Notification scheduler queries ---
# get_all_tasks_across_all_users_for_scheduler is deliberately kept
# GLOBAL/unfiltered (see docstring) rather than scoped by user_id — the
# scheduler now loops per-user (run_notification_scheduler in services.py)
# and fetches each user's own tasks via AirtableTaskRepository.get_all_tasks
# (or get_tasks_for_user), so nothing in this codebase currently calls this
# function anymore. Kept in place, unfiltered, on explicit instruction
# rather than deleted.


def get_all_tasks_across_all_users_for_scheduler() -> list[TaskRecord]:
    """
    Fetches every task across every user in one query. NOT scoped by
    user_id — this is the one deliberate exception to this file's
    otherwise-universal per-user scoping, kept available for any future
    cross-user/admin use case.
    """
    repo = _get_shared_tasks_repo()
    response = supabase.table("tasks").select("*").execute()
    rows = response.data
    logger.info(f"Retrieved {len(rows)} tasks across all users from Supabase.")
    return [repo._supabase_row_to_task(row) for row in rows]


def get_tasks_due_for_notification(
    user_id: str,
    window_start: datetime,
    window_end: datetime,
    tasks: Optional[list[TaskRecord]] = None,
    require_bell_enabled: bool = True,
) -> list[TaskRecord]:
    """
    Returns tasks (belonging to user_id) eligible for an advance-reminder
    push: not already sent, active (approved/not completed/not rejected),
    and with a due_date+due_time falling within [window_start, window_end].

    If require_bell_enabled is True (default), also requires
    notify_enabled=True (the per-task bell). If False, that filter is
    skipped — used when the "send all" scope setting is on, so every
    eligible timed task gets reminded regardless of its bell state.

    Filtered in Python rather than via a DB-side query — due_date and
    due_time are separate text fields. Pass a pre-fetched `tasks` list
    (that user's own tasks) to avoid a second scan; omit it to fetch fresh
    via user_id.
    """
    all_tasks = tasks if tasks is not None else get_tasks_for_user(user_id)

    due = []
    for task in all_tasks:
        if require_bell_enabled and not task.notify_enabled:
            continue
        if task.notification_sent:
            continue
        if not (task.approval_status and not task.is_completed and not task.is_rejected):
            continue
        if not task.due_date or not task.due_time:
            continue
        try:
            due_dt = datetime.strptime(f"{task.due_date} {task.due_time}", "%Y-%m-%d %H:%M")
        except ValueError:
            continue
        due_dt = due_dt.replace(tzinfo=window_start.tzinfo)
        if window_start <= due_dt <= window_end:
            due.append(task)
    return due


def mark_notification_sent(user_id: str, record_id: str) -> None:
    """Sets notification_sent = True for a task, scoped to user_id."""
    supabase.table("tasks").update({"notification_sent": True}).eq("id", record_id).eq("user_id", user_id).execute()


def get_active_hostaway_tasks(
    user_id: str, tasks: Optional[list[TaskRecord]] = None
) -> list[TaskRecord]:
    """
    Returns all not-completed, not-rejected category="Hostaway" tasks
    belonging to user_id — the candidate set for escalation
    re-notification. Pass a pre-fetched `tasks` list to avoid a second
    table scan; omit it to fetch fresh via user_id.
    """
    all_tasks = tasks if tasks is not None else get_tasks_for_user(user_id)
    return [
        t for t in all_tasks
        if t.category == "Hostaway" and not t.is_completed and not t.is_rejected
    ]


def update_hostaway_last_notified(user_id: str, record_id: str, last_notified_at: str) -> None:
    """Updates hostaway_last_notified_at on a task record, scoped to user_id."""
    supabase.table("tasks").update({"hostaway_last_notified_at": last_notified_at}).eq("id", record_id).eq("user_id", user_id).execute()


def get_tasks_for_date(
    user_id: str, date_str: str, tasks: Optional[list[TaskRecord]] = None
) -> list[TaskRecord]:
    """
    Returns all eligible tasks belonging to user_id (approval_status=True,
    is_completed=False, is_rejected=False) with due_date == date_str,
    regardless of whether they have a due_time — used for the daily
    summary listing, which includes all-day tasks too. Pass a pre-fetched
    `tasks` list to avoid a second table scan.
    """
    all_tasks = tasks if tasks is not None else get_tasks_for_user(user_id)
    return [
        t for t in all_tasks
        if t.approval_status and not t.is_completed and not t.is_rejected and t.due_date == date_str
    ]


def get_first_task_datetime_today(
    user_id: str, date_str: str, tasks: Optional[list[TaskRecord]] = None
) -> Optional[datetime]:
    """
    Returns the (naive) datetime of the earliest due_time among user_id's
    eligible tasks today, or None if no eligible task has a due_time on
    date_str. Returned naively (no tzinfo) since this is a data-layer
    query with no timezone context of its own — callers must attach the
    appropriate tzinfo before comparing against a timezone-aware `now`.
    """
    todays_tasks = get_tasks_for_date(user_id, date_str, tasks=tasks)
    timed = [t for t in todays_tasks if t.due_time]
    if not timed:
        return None
    earliest_time = min(datetime.strptime(t.due_time, "%H:%M").time() for t in timed)
    return datetime.strptime(f"{date_str} {earliest_time.strftime('%H:%M')}", "%Y-%m-%d %H:%M")


# --- Token usage log ---
# Tracks per-call Gemini token usage for the developer-only usage/cost
# dashboard.


def save_token_usage_log(user_id: str, call_type: str, timestamp: str, prompt_tokens: int, output_tokens: int, thinking_tokens: int, total_tokens: int, model: str = "gemini-3.5-flash") -> None:
    """Appends a row to the token_usage_log Supabase table, owned by user_id, including which model was used."""
    supabase.table("token_usage_log").insert({
        "user_id": user_id,
        "call_type": call_type,
        "timestamp": timestamp,
        "prompt_tokens": prompt_tokens,
        "output_tokens": output_tokens,
        "thinking_tokens": thinking_tokens,
        "total_tokens": total_tokens,
        "model": model,
    }).execute()


# --- Google Calendar connections ---
# One row per user, holding the Google OAuth tokens captured once from the
# Supabase session right after the Calendar-scope OAuth flow completes.
# Refreshing is handled entirely by google_calendar.py against Google's own
# OAuth endpoint — never by Supabase — so these functions are plain
# CRUD/upsert on the google_calendar_connections table with no refresh logic
# of their own.


def save_google_calendar_connection(user_id: str, access_token: str, refresh_token: str, token_expiry: datetime) -> None:
    """Upserts the connection — handles both first-time connect and reconnect cleanly."""
    supabase.table("google_calendar_connections").upsert({
        "user_id": user_id,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_expiry": token_expiry.isoformat(),
    }, on_conflict="user_id").execute()


def get_google_calendar_connection(user_id: str) -> Optional[dict]:
    result = supabase.table("google_calendar_connections").select("*").eq("user_id", user_id).execute()
    return result.data[0] if result.data else None


def update_google_calendar_token(user_id: str, access_token: str, token_expiry: datetime) -> None:
    supabase.table("google_calendar_connections").update({
        "access_token": access_token,
        "token_expiry": token_expiry.isoformat(),
    }).eq("user_id", user_id).execute()


def disconnect_google_calendar(user_id: str) -> None:
    supabase.table("google_calendar_connections").delete().eq("user_id", user_id).execute()


# --- Google Calendar sync (Phase 2) ---
# Push/pull bookkeeping used by services.sync_google_calendar_for_user, run
# once per user on every scheduler tick. Deliberately works on raw Supabase
# row dicts (not TaskRecord) for the push-candidate query, since google_event_id
# and google_last_synced_at are internal sync bookkeeping columns, not part of
# the TaskRecord shape the rest of the app (and frontend) works with.


def get_tasks_needing_calendar_push(user_id: str) -> list[dict]:
    """
    Tasks with due_date set (due_time is now optional — a task with only a
    due_date pushes as an all-day event), not completed/rejected, eligible
    per the sync-all-or-per-task-toggle rule (mirrors send_all_enabled for
    notifications: global calendar_sync_all_enabled ON means every eligible
    task syncs regardless of its own calendar_sync_enabled; OFF means only
    tasks with calendar_sync_enabled=True do), that have changed since their
    last calendar push (or were never pushed).
    """
    settings = get_app_settings(user_id)
    sync_all = settings.calendar_sync_all_enabled

    query = (
        supabase.table("tasks")
        .select("*")
        .eq("user_id", user_id)
        .eq("is_rejected", False)
        .eq("is_completed", False)
        .not_.is_("due_date", "null")
    )
    if not sync_all:
        query = query.eq("calendar_sync_enabled", True)

    result = query.execute()

    needing_push = []
    for task in result.data:
        if not task.get("google_last_synced_at"):
            needing_push.append(task)
        else:
            try:
                updated = datetime.fromisoformat(task["updated_at"].replace("Z", "+00:00"))
                synced = datetime.fromisoformat(task["google_last_synced_at"].replace("Z", "+00:00"))
                if updated > synced:
                    needing_push.append(task)
            except (ValueError, TypeError, KeyError):
                needing_push.append(task)  # if timestamps are malformed, err on the side of re-pushing
    return needing_push


def set_task_calendar_sync_enabled(task_id: str, enabled: bool) -> None:
    supabase.table("tasks").update({"calendar_sync_enabled": enabled}).eq("id", task_id).execute()


def update_task_calendar_sync(task_id: str, google_event_id: str) -> None:
    supabase.table("tasks").update({
        "google_event_id": google_event_id,
        "google_last_synced_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", task_id).execute()


def unlink_task_from_calendar(task_id: str) -> None:
    supabase.table("tasks").update({"google_event_id": None}).eq("id", task_id).execute()


def mark_task_calendar_deleted(task_id: str) -> None:
    """Called when a task's linked Google Calendar event was deleted on
    Google's side. Appends a visible note to the task's description and
    clears the link, WITHOUT deleting the task itself."""
    result = supabase.table("tasks").select("description").eq("id", task_id).execute()
    if not result.data:
        return
    existing_description = result.data[0].get("description") or ""
    note = "\n\n⚠️ Διαγράφηκε το συνδεδεμένο event από το Google Calendar."
    if note.strip() not in existing_description:  # avoid duplicate notes if this somehow runs twice
        new_description = existing_description + note
        supabase.table("tasks").update({
            "description": new_description,
            "google_event_id": None,
        }).eq("id", task_id).execute()


def update_task_from_calendar_event(task_id: str, due_date: str, due_time: Optional[str], task_name: str) -> None:
    supabase.table("tasks").update({
        "due_date": due_date,
        "due_time": due_time,
        "task_name": task_name,
        "google_last_synced_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", task_id).execute()


def update_calendar_sync_token(user_id: str, sync_token: Optional[str]) -> None:
    supabase.table("google_calendar_connections").update({
        "calendar_sync_token": sync_token,
    }).eq("user_id", user_id).execute()


def get_all_connected_calendar_user_ids() -> list[str]:
    """Users who have an active Google Calendar connection."""
    result = supabase.table("google_calendar_connections").select("user_id").execute()
    return [row["user_id"] for row in result.data]


# --- Google Calendar foreign events (not created by this app) ---
# Events pulled from the user's primary calendar that carry no TASK_ID_EXTENDED_PROPERTY
# marker — i.e. events the user created directly in Google Calendar. These are
# stored separately here, shown only in their own dedicated view, and never
# auto-converted into tasks (see google_calendar.pull_calendar_changes).


def upsert_google_calendar_event(user_id: str, google_event_id: str, title: str, description: str, start_date: str, start_time: Optional[str], is_all_day: bool) -> None:
    supabase.table("google_calendar_events").upsert({
        "user_id": user_id,
        "google_event_id": google_event_id,
        "title": title,
        "description": description,
        "start_date": start_date,
        "start_time": start_time,
        "is_all_day": is_all_day,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="user_id,google_event_id").execute()


def delete_google_calendar_event_record(user_id: str, google_event_id: str) -> None:
    supabase.table("google_calendar_events").delete().eq("user_id", user_id).eq("google_event_id", google_event_id).execute()


def get_google_calendar_events_for_user(user_id: str) -> list[dict]:
    """Only events not yet converted to a task."""
    result = (
        supabase.table("google_calendar_events")
        .select("*")
        .eq("user_id", user_id)
        .is_("converted_to_task_id", "null")
        .order("start_date")
        .execute()
    )
    return result.data


def convert_calendar_event_to_task(user_id: str, calendar_event_record_id: str) -> dict:
    """Creates a real task from a stored foreign Google Calendar event, links
    them, and marks the event record as converted (so it stops appearing in
    the separate events view)."""
    event_result = (
        supabase.table("google_calendar_events")
        .select("*")
        .eq("id", calendar_event_record_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not event_result.data:
        raise ValueError("Calendar event not found")
    ev = event_result.data[0]

    new_task_result = supabase.table("tasks").insert({
        "user_id": user_id,
        "task_name": ev["title"],
        "description": ev.get("description") or "",
        "due_date": ev["start_date"],
        "due_time": ev.get("start_time"),
        "category": "Unknown",
        "priority": "P3",
        # ai_suggested_category/ai_suggested_priority are non-nullable snapshot
        # fields enforced by _supabase_row_to_task (raises if missing) — there's
        # no actual AI suggestion here since this task originated from a
        # calendar event, not extraction, so they just mirror the chosen values.
        "ai_suggested_category": "Unknown",
        "ai_suggested_priority": "P3",
        "approval_status": True,
        "is_completed": False,
        "is_rejected": False,
        "google_event_id": ev["google_event_id"],
    }).execute()

    new_task = new_task_result.data[0]
    supabase.table("google_calendar_events").update({
        "converted_to_task_id": new_task["id"]
    }).eq("id", calendar_event_record_id).execute()

    return new_task


def get_task_google_event_id(user_id: str, record_id: str) -> Optional[str]:
    """
    Raw lookup of a task's linked google_event_id, scoped to user_id.
    Bypasses the TaskRecord parsing pipeline (which doesn't surface this
    field) since this is purely an internal read used just before deletion,
    to know whether a linked Google Calendar event also needs deleting.
    """
    result = (
        supabase.table("tasks")
        .select("google_event_id")
        .eq("id", record_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        return None
    return result.data[0].get("google_event_id")


def get_all_token_usage_logs(user_id: str) -> list[dict]:
    """Returns all rows from token_usage_log belonging to user_id, as a list of dicts with keys:
    call_type, timestamp, prompt_tokens, output_tokens, thinking_tokens, total_tokens, model.
    Rows logged before the model field existed default to 'gemini-3.5-flash' so
    historical cost estimates don't break."""
    response = supabase.table("token_usage_log").select("*").eq("user_id", user_id).execute()
    return [
        {
            "call_type": _get(r, "call_type", ""),
            "timestamp": _get(r, "timestamp", ""),
            "prompt_tokens": _get(r, "prompt_tokens", 0),
            "output_tokens": _get(r, "output_tokens", 0),
            "thinking_tokens": _get(r, "thinking_tokens", 0),
            "total_tokens": _get(r, "total_tokens", 0),
            "model": _get(r, "model", "gemini-3.5-flash"),
        }
        for r in response.data
    ]
