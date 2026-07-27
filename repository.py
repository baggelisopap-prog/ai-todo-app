import os
import logging
from datetime import datetime
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
# key always bypasses RLS — fine for now since the app is single-user with
# no auth wiring yet (that's Phase C/D).
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
    against this exact class name — renaming it would ripple into a file
    this migration is explicitly not supposed to touch. It is now backed by
    Supabase's Postgres `tasks` table, not Airtable.
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
        created_time) that the DB manages itself.
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
            ai_suggested_category=row["ai_suggested_category"],
            ai_suggested_priority=row["ai_suggested_priority"],
            record_id=record_id,
            created_time=row.get("created_time"),
            hostaway_created_at=row.get("hostaway_created_at"),
            hostaway_last_notified_at=row.get("hostaway_last_notified_at"),
        )

    def save_task(self, task: TaskRecord) -> TaskRecord:
        """
        Creates a new task record in Supabase.
        Returns a new TaskRecord instance containing the server-generated record_id and created_time.
        """
        fields_dict = self._task_to_supabase_fields(task)

        response = supabase.table("tasks").insert(fields_dict).execute()
        new_row = response.data[0]

        logger.info(f"Successfully saved new task to Supabase. Assigned ID: {new_row.get('id')}")

        return self._supabase_row_to_task(new_row)

    def get_all_tasks(self) -> list[TaskRecord]:
        """
        Retrieves all task records currently stored in Supabase.
        """
        response = supabase.table("tasks").select("*").execute()
        rows = response.data
        logger.info(f"Retrieved {len(rows)} tasks from Supabase.")
        return [self._supabase_row_to_task(row) for row in rows]

    def get_task(self, record_id: str) -> Optional[TaskRecord]:
        """
        Retrieves a single task by its Supabase record_id (UUID).
        Returns None if the record does not exist.
        """
        try:
            response = supabase.table("tasks").select("*").eq("id", record_id).execute()
            if not response.data:
                return None
            return self._supabase_row_to_task(response.data[0])
        except Exception as e:
            # Catching a broad exception here since our requirement is
            # strictly "return None if not found/failed".
            logger.warning(f"Failed to retrieve task with ID {record_id}: {e}")
            return None

    def update_task(self, record_id: str, updates: dict) -> TaskRecord:
        """
        Updates specific fields on an existing Supabase task.
        Applies data mapping (like checklist normalization) to the update dictionary before sending.
        Returns the fully updated TaskRecord.
        """
        # Work on a copy so we don't mutate the caller's dict
        mapped_updates = updates.copy()

        # Rescheduling (edit or drag-and-drop) invalidates any reminder
        # already sent for the old time, so it can fire again at the new one.
        if "due_date" in mapped_updates or "due_time" in mapped_updates:
            current = self.get_task(record_id)
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

        response = supabase.table("tasks").update(mapped_updates).eq("id", record_id).execute()

        logger.info(f"Successfully updated task in Supabase. ID: {record_id}")
        return self._supabase_row_to_task(response.data[0])

    def delete_task(self, record_id: str) -> bool:
        """
        Permanently deletes a task from Supabase.
        Returns True if deletion succeeded.
        Raises an exception on failure (network, not found, etc.).
        """
        response = supabase.table("tasks").delete().eq("id", record_id).execute()
        logger.info(f"Successfully deleted task from Supabase. ID: {record_id}")
        return bool(response.data)


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


def save_push_subscription(subscription: PushSubscriptionRequest) -> PushSubscriptionRecord:
    """
    Upserts a push subscription by endpoint (the endpoint URL is effectively
    unique per browser installation). If a record with this endpoint already
    exists, update its keys; otherwise create a new record.
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
        response = supabase.table("push_subscriptions").insert(fields).execute()
        logger.info(f"Created new push subscription. ID: {response.data[0].get('id')}")

    return _supabase_row_to_push_subscription(response.data[0])


def list_push_subscriptions() -> list[PushSubscriptionRecord]:
    """Returns all stored push subscriptions."""
    response = supabase.table("push_subscriptions").select("*").execute()
    return [_supabase_row_to_push_subscription(row) for row in response.data]


def delete_push_subscription(endpoint: str) -> None:
    """Removes a subscription by endpoint (used when a push fails permanently, e.g. 404/410)."""
    existing = (
        supabase.table("push_subscriptions")
        .select("id")
        .eq("endpoint", endpoint)
        .limit(1)
        .execute()
    )
    if existing.data:
        record_id = existing.data[0]["id"]
        supabase.table("push_subscriptions").delete().eq("id", record_id).execute()
        logger.info(f"Deleted stale push subscription. ID: {record_id}")


# --- App settings ---
# Single-record table holding app-wide toggles. Always targets the oldest
# existing row (ordered by created_at) as the canonical singleton, which
# also fixes the old duplication bug going forward: every write now
# consistently updates that one row instead of sometimes inserting a new
# one.


def get_app_settings() -> AppSettings:
    """
    Reads the single app_settings record (oldest by created_at). If no
    record exists yet (first run), returns default settings without
    creating a row — the row gets created on first write via
    update_app_settings.
    """
    response = supabase.table("app_settings").select("*").order("created_at").limit(1).execute()
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
    )


def update_app_settings(
    notifications_enabled: bool,
    send_all_enabled: bool,
    daily_summary_enabled: bool,
    daily_summary_mode: str,
    daily_summary_time: str,
) -> AppSettings:
    """
    Upserts the single app_settings record's user-facing settings. Does
    NOT touch daily_summary_last_sent_date — that's scheduler-internal
    bookkeeping written separately by update_daily_summary_last_sent_date.
    """
    fields = {
        "notifications_enabled": notifications_enabled,
        "send_all_enabled": send_all_enabled,
        "daily_summary_enabled": daily_summary_enabled,
        "daily_summary_mode": daily_summary_mode,
        "daily_summary_time": daily_summary_time,
    }
    existing = supabase.table("app_settings").select("id").order("created_at").limit(1).execute()
    if existing.data:
        supabase.table("app_settings").update(fields).eq("id", existing.data[0]["id"]).execute()
    else:
        supabase.table("app_settings").insert(fields).execute()
    return AppSettings(
        notifications_enabled=notifications_enabled,
        send_all_enabled=send_all_enabled,
        daily_summary_enabled=daily_summary_enabled,
        daily_summary_mode=daily_summary_mode,
        daily_summary_time=daily_summary_time,
    )


# --- Notification scheduler queries ---
# Reuses AirtableTaskRepository (same underlying `tasks` table) via a
# lazily-cached instance, so row parsing stays identical to the rest of the
# app instead of duplicating _supabase_row_to_task here.

_tasks_repo_for_scheduler = None


def _get_tasks_repo_for_scheduler() -> "AirtableTaskRepository":
    global _tasks_repo_for_scheduler
    if _tasks_repo_for_scheduler is None:
        _tasks_repo_for_scheduler = AirtableTaskRepository()
    return _tasks_repo_for_scheduler


def get_all_tasks_for_scheduler() -> list[TaskRecord]:
    """
    Fetches the full task list once per scheduler tick, so both the
    per-task reminder check and the daily summary check can filter the
    same list in Python instead of each doing their own table scan.
    """
    repo = _get_tasks_repo_for_scheduler()
    return repo.get_all_tasks()


def get_tasks_due_for_notification(
    window_start: datetime,
    window_end: datetime,
    tasks: Optional[list[TaskRecord]] = None,
    require_bell_enabled: bool = True,
) -> list[TaskRecord]:
    """
    Returns tasks eligible for an advance-reminder push: not already sent,
    active (approved/not completed/not rejected), and with a
    due_date+due_time falling within [window_start, window_end].

    If require_bell_enabled is True (default), also requires
    notify_enabled=True (the per-task bell). If False, that filter is
    skipped — used when the "send all" scope setting is on, so every
    eligible timed task gets reminded regardless of its bell state.

    Filtered in Python rather than via a DB-side query — due_date and
    due_time are separate text fields, and at this app's scale a full
    table scan per scheduler run (every ~5 minutes) is simple and cheap
    enough not to need query-level filtering. Pass a pre-fetched `tasks`
    list (e.g. from get_all_tasks_for_scheduler) to avoid a second scan;
    omit it to fetch fresh.
    """
    all_tasks = tasks if tasks is not None else get_all_tasks_for_scheduler()

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


def mark_notification_sent(record_id: str) -> None:
    """Sets notification_sent = True for a task."""
    supabase.table("tasks").update({"notification_sent": True}).eq("id", record_id).execute()


def get_active_hostaway_tasks(tasks: Optional[list[TaskRecord]] = None) -> list[TaskRecord]:
    """
    Returns all not-completed, not-rejected category="Hostaway" tasks —
    the candidate set for escalation re-notification. Pass a pre-fetched
    `tasks` list to avoid a second table scan; omit it to fetch fresh.
    """
    all_tasks = tasks if tasks is not None else get_all_tasks_for_scheduler()
    return [
        t for t in all_tasks
        if t.category == "Hostaway" and not t.is_completed and not t.is_rejected
    ]


def update_hostaway_last_notified(record_id: str, last_notified_at: str) -> None:
    """Updates hostaway_last_notified_at on a task record."""
    supabase.table("tasks").update({"hostaway_last_notified_at": last_notified_at}).eq("id", record_id).execute()


def get_tasks_for_date(
    date_str: str, tasks: Optional[list[TaskRecord]] = None
) -> list[TaskRecord]:
    """
    Returns all eligible tasks (approval_status=True, is_completed=False,
    is_rejected=False) with due_date == date_str, regardless of whether
    they have a due_time — used for the daily summary listing, which
    includes all-day tasks too. Pass a pre-fetched `tasks` list to avoid
    a second table scan.
    """
    all_tasks = tasks if tasks is not None else get_all_tasks_for_scheduler()
    return [
        t for t in all_tasks
        if t.approval_status and not t.is_completed and not t.is_rejected and t.due_date == date_str
    ]


def get_first_task_datetime_today(
    date_str: str, tasks: Optional[list[TaskRecord]] = None
) -> Optional[datetime]:
    """
    Returns the (naive) datetime of the earliest due_time among today's
    eligible tasks, or None if no eligible task has a due_time on
    date_str. Returned naively (no tzinfo) since this is a data-layer
    query with no timezone context of its own — callers must attach the
    appropriate tzinfo before comparing against a timezone-aware `now`.
    """
    todays_tasks = get_tasks_for_date(date_str, tasks=tasks)
    timed = [t for t in todays_tasks if t.due_time]
    if not timed:
        return None
    earliest_time = min(datetime.strptime(t.due_time, "%H:%M").time() for t in timed)
    return datetime.strptime(f"{date_str} {earliest_time.strftime('%H:%M')}", "%Y-%m-%d %H:%M")


def update_daily_summary_last_sent_date(date_str: str) -> None:
    """Upserts daily_summary_last_sent_date on the single app_settings record."""
    fields = {"daily_summary_last_sent_date": date_str}
    existing = supabase.table("app_settings").select("id").order("created_at").limit(1).execute()
    if existing.data:
        supabase.table("app_settings").update(fields).eq("id", existing.data[0]["id"]).execute()
    else:
        supabase.table("app_settings").insert(fields).execute()


# --- Token usage log ---
# Tracks per-call Gemini token usage for the developer-only usage/cost
# dashboard.


def save_token_usage_log(call_type: str, timestamp: str, prompt_tokens: int, output_tokens: int, thinking_tokens: int, total_tokens: int, model: str = "gemini-3.5-flash") -> None:
    """Appends a row to the token_usage_log Supabase table, including which model was used."""
    supabase.table("token_usage_log").insert({
        "call_type": call_type,
        "timestamp": timestamp,
        "prompt_tokens": prompt_tokens,
        "output_tokens": output_tokens,
        "thinking_tokens": thinking_tokens,
        "total_tokens": total_tokens,
        "model": model,
    }).execute()


def get_all_token_usage_logs() -> list[dict]:
    """Returns all rows from token_usage_log as a list of dicts with keys:
    call_type, timestamp, prompt_tokens, output_tokens, thinking_tokens, total_tokens, model.
    Rows logged before the model field existed default to 'gemini-3.5-flash' so
    historical cost estimates don't break."""
    response = supabase.table("token_usage_log").select("*").execute()
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
