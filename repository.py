import os
import json
import logging
from datetime import datetime
from typing import Optional
from dotenv import load_dotenv
from pyairtable import Api
from pyairtable.formulas import match
from models import TaskRecord, PushSubscriptionRequest, PushSubscriptionRecord, AppSettings

# Set up module-level logging
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

class AirtableTaskRepository:
    """
    Repository layer for managing TaskRecord persistence in Airtable.
    Handles all translation between Pydantic models and Airtable's specific JSON structure.
    """

    def __init__(self):
        """
        Initializes the Airtable client and verifies environment configuration.
        Fails fast with a RuntimeError if required variables are missing.
        """
        token = os.getenv("AIRTABLE_TOKEN")
        base_id = os.getenv("AIRTABLE_BASE_ID")
        table_id = os.getenv("AIRTABLE_TABLE_ID")

        if not all([token, base_id, table_id]):
            raise RuntimeError(
                "Missing Airtable configuration. Ensure AIRTABLE_TOKEN, AIRTABLE_BASE_ID, "
                "and AIRTABLE_TABLE_ID are set in your .env file."
            )

        self.api = Api(token)
        self.table = self.api.table(base_id, table_id)
        logger.info(f"AirtableTaskRepository initialized (Base: {base_id}, Table: {table_id})")

    def _task_to_airtable_fields(self, task: TaskRecord) -> dict:
        """
        Translates a Pydantic TaskRecord into an Airtable-ready fields dictionary.
        Handles serialization of nested types (like lists to JSON strings).
        Strips server-generated metadata (record_id, created_time).
        """
        # Convert Pydantic object to dict
        fields = task.model_dump()
        
        # Remove server-generated fields that Airtable will reject if sent
        fields.pop("record_id", None)
        fields.pop("created_time", None)

        # Airtable expects lists to be JSON strings if storing in a Long Text field
        fields["checklist"] = json.dumps(fields.get("checklist", []), ensure_ascii=False)

        return fields

    def _airtable_to_task(self, airtable_record: dict) -> TaskRecord:
        """
        Translates a raw Airtable API response dictionary back into a Pydantic TaskRecord.
        Handles deserialization (JSON strings to lists) and extracts top-level metadata.
        """
        fields = airtable_record.get("fields", {})
        
        # Extract top-level metadata
        record_id = airtable_record.get("id")
        created_time = airtable_record.get("createdTime")

        # Parse checklist from JSON string back to a Python list
        raw_checklist = fields.get("checklist")
        if raw_checklist:
            try:
                checklist = json.loads(raw_checklist)
            except json.JSONDecodeError:
                logger.error(f"Failed to parse checklist JSON for record {record_id}: {raw_checklist}")
                checklist = []
        else:
            checklist = []

        # Normalize to new format; accept legacy list[str] and new list[dict] transparently
        normalized = []
        for item in checklist:
            if isinstance(item, str):
                normalized.append({"text": item, "done": False})
            elif isinstance(item, dict) and "text" in item:
                normalized.append({"text": item["text"], "done": item.get("done", False)})
        checklist = normalized

        # Enforce strict data integrity on immutable snapshot fields
        if "ai_suggested_category" not in fields:
            raise ValueError(
                f"Record {record_id} is missing ai_suggested_category. "
                "This is a data integrity issue — the field should never be empty."
            )
        if "ai_suggested_priority" not in fields:
            raise ValueError(
                f"Record {record_id} is missing ai_suggested_priority. "
                "This is a data integrity issue — the field should never be empty."
            )

        # Construct the Pydantic object, providing safe defaults for fields Airtable might omit
        return TaskRecord(
            task_name=fields.get("task_name", ""),
            description=fields.get("description", ""),
            category=fields.get("category", "Unknown"),
            priority=fields.get("priority", "P3"),
            due_date=fields.get("due_date", None),
            due_time=fields.get("due_time", None),
            checklist=checklist,
            approval_status=fields.get("approval_status", False),
            is_completed=fields.get("is_completed", False),
            is_rejected=fields.get("is_rejected", False),
            notify_enabled=fields.get("notify_enabled", False),
            notification_sent=fields.get("notification_sent", False),
            ai_suggested_category=fields["ai_suggested_category"],
            ai_suggested_priority=fields["ai_suggested_priority"],
            record_id=record_id,
            created_time=created_time
        )

    def save_task(self, task: TaskRecord) -> TaskRecord:
        """
        Creates a new task record in Airtable.
        Returns a new TaskRecord instance containing the server-generated record_id and created_time.
        """
        fields_dict = self._task_to_airtable_fields(task)
        
        # Execute the network call
        response = self.table.create(fields_dict)
        
        # Log success
        logger.info(f"Successfully saved new task to Airtable. Assigned ID: {response.get('id')}")
        
        # Return a fresh Pydantic model built from the server response
        return self._airtable_to_task(response)

    def get_all_tasks(self) -> list[TaskRecord]:
        """
        Retrieves all task records currently stored in Airtable.
        """
        records = self.table.all()
        logger.info(f"Retrieved {len(records)} tasks from Airtable.")
        return [self._airtable_to_task(record) for record in records]

    def get_task(self, record_id: str) -> Optional[TaskRecord]:
        """
        Retrieves a single task by its Airtable record_id.
        Returns None if the record does not exist.
        """
        try:
            record = self.table.get(record_id)
            return self._airtable_to_task(record)
        except Exception as e:
            # Catching a broad exception here because pyairtable's specific HTTP error classes 
            # can vary, and our requirement is strictly "return None if not found/failed".
            logger.warning(f"Failed to retrieve task with ID {record_id}: {e}")
            return None

    def update_task(self, record_id: str, updates: dict) -> TaskRecord:
        """
        Updates specific fields on an existing Airtable task.
        Applies data mapping (like JSON encoding) to the update dictionary before sending.
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
            serializable = [
                item if isinstance(item, dict) else item.model_dump()
                for item in mapped_updates["checklist"]
            ]
            mapped_updates["checklist"] = json.dumps(serializable, ensure_ascii=False)
            
        # Prevent accidental overwrites of read-only fields
        mapped_updates.pop("record_id", None)
        mapped_updates.pop("created_time", None)

        response = self.table.update(record_id, mapped_updates)

        logger.info(f"Successfully updated task in Airtable. ID: {record_id}")
        return self._airtable_to_task(response)

    def delete_task(self, record_id: str) -> bool:
        """
        Permanently deletes a task from Airtable.
        Returns True if deletion succeeded.
        Raises an exception on failure (network, not found, etc.).
        """
        response = self.table.delete(record_id)
        logger.info(f"Successfully deleted task from Airtable. ID: {record_id}")
        return response.get("deleted", False)


# --- Push subscriptions ---
# Mirrors AirtableTaskRepository's connection pattern (same Base, different
# Table), but as module-level functions since push subscriptions don't need
# the heavier field-mapping logic tasks do.

_push_subscriptions_table = None


def _get_push_subscriptions_table():
    """
    Lazily initializes and caches the Airtable Table client for push
    subscriptions. Fails fast with a RuntimeError if required env vars
    are missing.
    """
    global _push_subscriptions_table
    if _push_subscriptions_table is not None:
        return _push_subscriptions_table

    token = os.getenv("AIRTABLE_TOKEN")
    base_id = os.getenv("AIRTABLE_BASE_ID")
    table_id = os.getenv("PUSH_SUBSCRIPTIONS_TABLE_ID")

    if not all([token, base_id, table_id]):
        raise RuntimeError(
            "Missing Airtable configuration for push subscriptions. Ensure "
            "AIRTABLE_TOKEN, AIRTABLE_BASE_ID, and PUSH_SUBSCRIPTIONS_TABLE_ID "
            "are set in your .env file."
        )

    api = Api(token)
    _push_subscriptions_table = api.table(base_id, table_id)
    logger.info(f"Push subscriptions table initialized (Base: {base_id}, Table: {table_id})")
    return _push_subscriptions_table


def _airtable_to_push_subscription(record: dict) -> PushSubscriptionRecord:
    fields = record.get("fields", {})
    return PushSubscriptionRecord(
        record_id=record.get("id"),
        endpoint=fields.get("endpoint", ""),
        p256dh=fields.get("p256dh", ""),
        auth=fields.get("auth", ""),
    )


def save_push_subscription(subscription: PushSubscriptionRequest) -> PushSubscriptionRecord:
    """
    Upserts a push subscription by endpoint (the endpoint URL is effectively
    unique per browser installation). If a record with this endpoint already
    exists, update its keys; otherwise create a new record.
    """
    table = _get_push_subscriptions_table()

    fields = {
        "endpoint": subscription.endpoint,
        "p256dh": subscription.keys.p256dh,
        "auth": subscription.keys.auth,
    }

    existing = table.first(formula=match({"endpoint": subscription.endpoint}))
    if existing:
        response = table.update(existing["id"], fields)
        logger.info(f"Updated existing push subscription. ID: {response.get('id')}")
    else:
        response = table.create(fields)
        logger.info(f"Created new push subscription. ID: {response.get('id')}")

    return _airtable_to_push_subscription(response)


def list_push_subscriptions() -> list[PushSubscriptionRecord]:
    """Returns all stored push subscriptions."""
    table = _get_push_subscriptions_table()
    records = table.all()
    return [_airtable_to_push_subscription(record) for record in records]


def delete_push_subscription(endpoint: str) -> None:
    """Removes a subscription by endpoint (used when a push fails permanently, e.g. 404/410)."""
    table = _get_push_subscriptions_table()
    existing = table.first(formula=match({"endpoint": endpoint}))
    if existing:
        table.delete(existing["id"])
        logger.info(f"Deleted stale push subscription. ID: {existing['id']}")


# --- App settings ---
# Single-record table holding app-wide toggles (currently just the
# notifications master switch). Mirrors the push subscriptions connection
# pattern above.

_app_settings_table = None


def _get_app_settings_table():
    global _app_settings_table
    if _app_settings_table is not None:
        return _app_settings_table

    token = os.getenv("AIRTABLE_TOKEN")
    base_id = os.getenv("AIRTABLE_BASE_ID")
    table_id = os.getenv("APP_SETTINGS_TABLE_ID")

    if not all([token, base_id, table_id]):
        raise RuntimeError(
            "Missing Airtable configuration for app settings. Ensure "
            "AIRTABLE_TOKEN, AIRTABLE_BASE_ID, and APP_SETTINGS_TABLE_ID "
            "are set in your .env file."
        )

    api = Api(token)
    _app_settings_table = api.table(base_id, table_id)
    logger.info(f"App settings table initialized (Base: {base_id}, Table: {table_id})")
    return _app_settings_table


def get_app_settings() -> AppSettings:
    """
    Reads the single app_settings record. If no record exists yet (first
    run), returns default settings without creating a row — the row gets
    created on first write via update_app_settings.
    """
    table = _get_app_settings_table()
    records = table.all(max_records=1)
    if not records:
        return AppSettings()
    fields = records[0].get("fields", {})
    return AppSettings(
        notifications_enabled=fields.get("notifications_enabled", True),
        send_all_enabled=fields.get("send_all_enabled", True),
        last_summary_sent_date=fields.get("last_summary_sent_date"),
    )


def update_app_settings(notifications_enabled: bool, send_all_enabled: bool) -> AppSettings:
    """Upserts the single app_settings record's two user-facing toggles."""
    table = _get_app_settings_table()
    records = table.all(max_records=1)
    fields = {
        "notifications_enabled": notifications_enabled,
        "send_all_enabled": send_all_enabled,
    }
    if records:
        table.update(records[0]["id"], fields)
    else:
        table.create(fields)
    return AppSettings(notifications_enabled=notifications_enabled, send_all_enabled=send_all_enabled)


# --- Notification scheduler queries ---
# Reuses AirtableTaskRepository (same Base/Table as the main task CRUD
# path) via a lazily-cached instance, so field parsing stays identical to
# the rest of the app instead of duplicating _airtable_to_task here.

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
    same list in Python instead of each doing their own Airtable scan.
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

    Filtered in Python rather than via an Airtable formula — due_date and
    due_time are separate text fields, and at this app's scale a full
    table scan per scheduler run (every ~5 minutes) is simple and cheap
    enough not to need formula-level filtering. Pass a pre-fetched `tasks`
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
    repo = _get_tasks_repo_for_scheduler()
    repo.table.update(record_id, {"notification_sent": True})


def get_tasks_for_daily_summary(
    today_str: str, tasks: Optional[list[TaskRecord]] = None
) -> list[TaskRecord]:
    """
    Returns active tasks (approved/not completed/not rejected) due today
    or overdue (due_date <= today_str). YYYY-MM-DD string comparison sorts
    identically to chronological order given the validated date format.
    Pass a pre-fetched `tasks` list to avoid a second Airtable scan.
    """
    all_tasks = tasks if tasks is not None else get_all_tasks_for_scheduler()

    result = []
    for task in all_tasks:
        if not (task.approval_status and not task.is_completed and not task.is_rejected):
            continue
        if not task.due_date or task.due_date > today_str:
            continue
        result.append(task)
    return result


def mark_daily_summary_sent(date_str: str) -> None:
    """Upserts last_summary_sent_date on the single app_settings record."""
    table = _get_app_settings_table()
    records = table.all(max_records=1)
    fields = {"last_summary_sent_date": date_str}
    if records:
        table.update(records[0]["id"], fields)
    else:
        table.create(fields)