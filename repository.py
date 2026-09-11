import os
import logging
from datetime import datetime, timezone
from typing import Optional
from dotenv import load_dotenv
from supabase import create_client
from models import TaskRecord, PushSubscriptionRequest, PushSubscriptionRecord, AppSettings, RecurrenceRule, Workspace, WorkspaceMember, Category

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
        # created_at is a real column with a database default, so unlike
        # category_name it would not be rejected — it would be silently
        # OVERWRITTEN with whatever the model happened to be holding, which on
        # a re-save is the row's own old value and on a fresh object is None.
        # A creation date that moves is worse than one that is missing.
        fields.pop("created_at", None)

        # category_name is what the MODEL answers with; the column is
        # category_id, which services.resolve_category_name has already filled
        # in from it. TaskRecord inherits the field from SingleTask, so
        # model_dump() carries it here whether we want it or not — and Supabase
        # rejects the whole INSERT for one unknown key (PGRST204), which took
        # down every task-creation path at once until this line existed.
        fields.pop("category_name", None)
        fields.pop("workspace_name", None)

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
            created_at=row.get("created_at"),
            hostaway_created_at=row.get("hostaway_created_at"),
            hostaway_last_notified_at=row.get("hostaway_last_notified_at"),
            hostaway_conversation_id=row.get("hostaway_conversation_id"),
            hostaway_last_message_at=row.get("hostaway_last_message_at"),
            hostaway_message_count=_get(row, "hostaway_message_count", 0),
            hostaway_answered_at=row.get("hostaway_answered_at"),
            hostaway_thread=row.get("hostaway_thread"),
            recurrence_rule_id=row.get("recurrence_rule_id"),
            occurrence_date=row.get("occurrence_date"),
            missed_at=row.get("missed_at"),
            cancelled_at=row.get("cancelled_at"),
            deleted_at=row.get("deleted_at"),
            # row.get, deliberately not _get(row, key, default): NULL here is a
            # real value meaning "unfiled", not a blank standing in for a typed
            # default. The write side needs no equivalent — it is built from
            # task.model_dump(), so a new model field travels on its own.
            workspace_id=row.get("workspace_id"),
            category_id=row.get("category_id"),
        )

    def save_task(self, user_id: str, task: TaskRecord) -> TaskRecord:
        """
        Creates a new task record in Supabase, owned by user_id.
        Returns a new TaskRecord instance containing the server-generated record_id and created_time.
        """
        fields_dict = self._task_to_supabase_fields(task)
        fields_dict["user_id"] = user_id
        # Every task created through this normal path (manual, AI extraction
        # from text/voice/photo, Hostaway) originates in the app, not from a
        # converted Google Calendar event — see convert_calendar_event_to_task
        # for the other origin, which bypasses save_task entirely and sets
        # calendar_origin='google' itself.
        fields_dict["calendar_origin"] = "app"

        response = supabase.table("tasks").insert(fields_dict).execute()
        new_row = response.data[0]

        logger.info(f"Successfully saved new task to Supabase. Assigned ID: {new_row.get('id')}")

        return self._supabase_row_to_task(new_row)

    def get_all_tasks(self, user_id: str) -> list[TaskRecord]:
        """
        Every task this user may SEE — `visible_to`. Tasks they created, plus
        every task in a workspace they are a member of.

        THIS IS THE READ FOR SCREENS: the task list endpoint, search, the
        agent's cached list. Anything that rings a phone must call
        repository.get_owned_or_assigned_tasks instead.

        That split is not a nicety. Until 2026-09-11 this one function fed both
        the UI and the scheduler tick, and nobody had to notice because both
        halves wanted the same rows. Widening it without splitting it breaks
        reminders three ways, two of them silent:

          1. every member's tick finds every shared task, so one reminder is
             pushed per member;
          2. tasks.notification_sent is a SINGLE BOOLEAN on the task row, so
             whichever member the loop reached first flips it and the rest find
             nothing — which phone rings would depend on the order
             get_all_active_user_ids() happened to return profiles in;
          3. mark_notification_sent used to filter on user_id, so a member who
             is not the row's owner matched zero rows and raised nothing, and
             the task re-notified on every tick forever.
        """
        workspace_ids = get_member_workspace_ids(user_id)

        query = supabase.table("tasks").select("*")
        if workspace_ids:
            # PostgREST `or`: comma-separated filters, and `in` takes its
            # values in parentheses. The empty list gets its own branch rather
            # than an inline conditional because `workspace_id.in.()` is a
            # SYNTAX ERROR, not an empty match — and a malformed filter on this
            # table fails open, which means another user's tasks.
            #
            # The user_id arm is not redundant with the workspace arm: an
            # unfiled task has no workspace at all, and without it such a task
            # would vanish from its own author's list the moment they joined
            # somebody else's workspace.
            joined = ",".join(workspace_ids)
            query = query.or_(f"user_id.eq.{user_id},workspace_id.in.({joined})")
        else:
            query = query.eq("user_id", user_id)

        response = query.execute()
        rows = response.data
        logger.info(f"Retrieved {len(rows)} visible tasks from Supabase for user {user_id}.")
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
        mapped_updates.pop("created_at", None)

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

    def soft_delete_task(self, user_id: str, record_id: str, deleted_at: str) -> bool:
        """
        Marks a task as deleted by stamping deleted_at, leaving the row in
        place, scoped to user_id. Returns whether a row was actually updated.

        Renamed from delete_task on 2026-09-04 when the DELETE became an
        UPDATE. The rename is the point: a caller still reaching for the old
        name gets an AttributeError instead of silently keeping the old
        behaviour on a path nobody re-read.

        The row survives because it IS the history — Browse's History tab reads
        deleted_at, and Restore clears it again. Nothing purges these rows; the
        archive is deliberately permanent (see docs/DECISIONS.md).

        The bool return matters for the same reason it does in cancel_task: a
        PostgREST UPDATE matching zero rows returns 200 with empty data rather
        than raising, so without this signal a race or an RLS edge case would
        leave the row untouched while the caller reported success.
        """
        response = (
            supabase.table("tasks")
            .update({"deleted_at": deleted_at})
            .eq("id", record_id)
            .eq("user_id", user_id)
            .execute()
        )
        logger.info(f"Marked task deleted in Supabase. ID: {record_id}")
        return bool(response.data)

    def restore_task(self, user_id: str, record_id: str) -> bool:
        """
        Undoes a soft delete by clearing deleted_at, scoped to user_id.
        Returns whether a row was actually updated.

        Clears cancelled_at too, so one button restores both an ordinary task
        and a cancelled recurrence occurrence — to the user they were the same
        act. Restoring an occurrence is safe: get_occurrence_dates skips any
        occurrence_date that already exists regardless of state, and the row
        never went away, so nothing is duplicated.

        Deliberately does NOT touch the Google Calendar link. Deleting an
        app-origin task removes its event on Google's side immediately and
        there is no undo to reach for — services.restore_task clears the dead
        link and reports it, rather than leaving a task pointing at an event
        that no longer exists.
        """
        response = (
            supabase.table("tasks")
            .update({"deleted_at": None, "cancelled_at": None})
            .eq("id", record_id)
            .eq("user_id", user_id)
            .execute()
        )
        logger.info(f"Restored task in Supabase. ID: {record_id}")
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


def get_owned_or_assigned_tasks(user_id: str) -> list[TaskRecord]:
    """
    Every task that is this person's WORK — `belongs_to`. Tasks assigned to
    them, plus tasks they created that nobody has been made responsible for.

    THIS IS THE READ FOR ANYTHING THAT RINGS A PHONE — advance reminders, the
    daily summary, Hostaway escalation, missed-occurrence closing — and, from
    slice 3, for the agent's day view. It must never be swapped for
    get_all_tasks; see that method's docstring for the three ways that breaks,
    two of them silently.

    `assigned_to is null` on the second arm is load-bearing: a task I created
    and then handed to somebody else is THEIR work, and my phone has to stop
    ringing for it the moment I assign it.

    A task in a shared workspace that nobody has taken is in its creator's list
    and nobody else's. Every member sees it on screen; until somebody takes it,
    it is not anybody's work.
    """
    repo = _get_shared_tasks_repo()
    response = (
        supabase.table("tasks")
        .select("*")
        .or_(f"assigned_to.eq.{user_id},and(user_id.eq.{user_id},assigned_to.is.null)")
        .execute()
    )
    rows = response.data or []
    logger.info(f"Retrieved {len(rows)} owned-or-assigned tasks for user {user_id}.")
    return [repo._supabase_row_to_task(row) for row in rows]


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
        calendar_show_events=_get(row, "calendar_show_events", True),
        # row.get, not _get: NULL here is the meaningful "Όλα" position, not a
        # blank standing in for a typed default.
        active_workspace_id=row.get("active_workspace_id"),
        default_workspace_id=row.get("default_workspace_id"),
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


# --- Profile ---
# Thin CRUD over the `profiles` table (id, email, display_name, created_at),
# auto-populated with one row per user on signup. Used by the Settings
# "My Profile" section and, incidentally, as the source of the owner-check
# comparison the frontend uses to gate the Developer section.


def get_profile(user_id: str) -> dict:
    result = supabase.table("profiles").select("*").eq("id", user_id).execute()
    return result.data[0] if result.data else {"id": user_id, "email": None, "display_name": None}


def update_profile(user_id: str, display_name: str) -> dict:
    result = supabase.table("profiles").update({"display_name": display_name}).eq("id", user_id).execute()
    return result.data[0]


def delete_user_account(user_id: str) -> None:
    """
    Deletes the Supabase auth user via the admin API (requires the secret/
    service-role key this module already uses). ON DELETE CASCADE on every
    user_id foreign key across tasks, app_settings, push_subscriptions,
    google_calendar_connections/events, and token_usage_log cleans up all
    of that user's data automatically — nothing else to do here.
    """
    supabase.auth.admin.delete_user(user_id)


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
    """
    Sets notification_sent = True. Scoped by task id ALONE, on purpose.

    It used to carry .eq("user_id", user_id) as well. Once a task can be
    processed by the tick of somebody who did not create it — its ASSIGNEE —
    that filter matches zero rows and raises nothing, so the flag is never set
    and the same reminder fires on every ~2-minute tick, forever. A silent
    no-op is the worst shape that bug could have taken: nothing in the row, the
    log or the response would have said anything was wrong.

    `user_id` stays in the signature. Every caller passes it, it is what makes
    the log line worth reading, and access.py is what decides whether the
    caller was entitled to get this far.
    """
    supabase.table("tasks").update({"notification_sent": True}).eq("id", record_id).execute()
    logger.info(f"[notify] marked task {record_id} notified (tick user {user_id})")


def get_active_hostaway_tasks(
    user_id: str, tasks: Optional[list[TaskRecord]] = None
) -> list[TaskRecord]:
    """
    Returns all not-completed, not-rejected guest-message tasks belonging to
    user_id — the candidate set for escalation re-notification. Pass a
    pre-fetched `tasks` list to avoid a second table scan; omit it to fetch
    fresh via user_id.

    Matched on the category whose system_key is 'hostaway', NOT on the literal
    word: since 2026-09-01 categories are rows the user names, and the label on
    this one is theirs to rename. The key is not.

    Deliberately NOT keyed on hostaway_conversation_id, which is also set on
    every such task: that column is written as `str(conversation_id) if
    conversation_id else None` and can legitimately be NULL, and a NULL there
    would silently drop a P1 guest task out of escalation.

    An account with no such category (one that predates the migration)
    escalates nothing rather than raising — this runs inside the scheduler's
    per-user loop, where a raise costs every later user their tick.
    """
    system_category = get_system_category(user_id, "hostaway")
    if system_category is None:
        return []

    all_tasks = tasks if tasks is not None else get_tasks_for_user(user_id)
    return [
        t for t in all_tasks
        if t.category_id == system_category.record_id
        and not t.is_completed and not t.is_rejected
    ]


def update_hostaway_last_notified(user_id: str, record_id: str, last_notified_at: str) -> None:
    """Updates hostaway_last_notified_at on a task record, scoped to user_id."""
    supabase.table("tasks").update({"hostaway_last_notified_at": last_notified_at}).eq("id", record_id).eq("user_id", user_id).execute()


def get_open_tasks_for_conversation(user_id: str, conversation_id: str) -> list[TaskRecord]:
    """
    Every open (not completed, not rejected) task belonging to one Hostaway
    conversation, newest first, scoped to user_id.

    Deliberately a filtered QUERY rather than the get_tasks_for_user() scan
    its neighbours use: this runs on every inbound webhook, and that
    function is already known to fetch ~124 rows in ~930 ms to use five
    (CURRENT_TASK.md). The partial index on hostaway_conversation_id makes
    this a handful of rows.

    Never raises — a lookup failure must not become a 500 on a webhook that
    Hostaway would then retry or disable. Returning [] degrades to today's
    behaviour: a new task gets created.
    """
    try:
        response = (
            supabase.table("tasks")
            .select("*")
            .eq("user_id", user_id)
            .eq("hostaway_conversation_id", conversation_id)
            .eq("is_completed", False)
            .eq("is_rejected", False)
            .order("created_at", desc=True)
            .execute()
        )
        repo = _get_shared_tasks_repo()
        return [repo._supabase_row_to_task(row) for row in (response.data or [])]
    except Exception as e:
        logger.warning(
            f"Failed to load open tasks for conversation {conversation_id} "
            f"(user {user_id}): {e}"
        )
        return []


def update_hostaway_thread_fields(user_id: str, record_id: str, updates: dict) -> None:
    """
    Writes threading fields (thread text, counts, priority, answered/notified
    timestamps) onto one task, scoped to user_id. A no-op when there is
    nothing to change, so callers can build the dict conditionally.
    """
    if not updates:
        return
    supabase.table("tasks").update(updates).eq("id", record_id).eq("user_id", user_id).execute()


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


def get_tasks_sync_snapshot(user_id: str, task_ids: list[str]) -> dict[str, dict]:
    """
    The three fields the calendar pull writes back (task_name, due_date,
    due_time), for a batch of tasks at once, scoped to user_id.

    ONE query per page of Google events, deliberately — the pull used to
    write every linked task on every tick without looking, and reading each
    task individually before deciding would have swapped ~105 writes for
    ~105 reads per tick, which is the same number of round trips and no
    faster. See google_calendar.pull_calendar_changes.

    Scoped by user_id even though the ids arrive from Google: they come out
    of an event's extendedProperties, i.e. data from outside this system. A
    task id that does not resolve to one of THIS user's tasks is simply
    absent from the result, and the caller writes nothing for it.
    """
    if not task_ids:
        return {}
    result = (
        supabase.table("tasks")
        .select("id, task_name, due_date, due_time")
        .in_("id", task_ids)
        .eq("user_id", user_id)
        .execute()
    )
    return {row["id"]: row for row in result.data}


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


def upsert_google_calendar_event(user_id: str, google_event_id: str, title: str, description: str, start_date: str, start_time: Optional[str], is_all_day: bool, html_link: Optional[str] = None) -> None:
    supabase.table("google_calendar_events").upsert({
        "user_id": user_id,
        "google_event_id": google_event_id,
        "title": title,
        "description": description,
        "start_date": start_date,
        "start_time": start_time,
        "is_all_day": is_all_day,
        "html_link": html_link,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="user_id,google_event_id").execute()


def get_google_calendar_events_snapshot(user_id: str, google_event_ids: list[str]) -> dict[str, dict]:
    """
    The fields upsert_google_calendar_event writes, for a batch of the user's
    stored Google events at once — the foreign-event twin of
    get_tasks_sync_snapshot, and there for the same measured reason: 46 of 64
    of these rows were being re-stored every ~2-minute tick with identical
    values (~33.000 writes a day) because the pull upserted every event it
    saw without looking at what was already there.

    last_synced_at is deliberately NOT selected: it is the column the write
    itself moves, so comparing it would report a difference every time.
    """
    if not google_event_ids:
        return {}
    result = (
        supabase.table("google_calendar_events")
        .select("google_event_id, title, description, start_date, start_time, is_all_day, html_link")
        .in_("google_event_id", google_event_ids)
        .eq("user_id", user_id)
        .execute()
    )
    return {row["google_event_id"]: row for row in result.data}


def delete_google_calendar_event_record(user_id: str, google_event_id: str) -> None:
    supabase.table("google_calendar_events").delete().eq("user_id", user_id).eq("google_event_id", google_event_id).execute()


def get_google_calendar_events_for_user(
    user_id: str,
    date_filter: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> list[dict]:
    """
    Only events not yet converted to a task AND not dismissed. Pass
    date_filter (YYYY-MM-DD) to narrow to a single day (e.g. the Today
    view's inline events section); pass start_date/end_date (YYYY-MM-DD)
    to narrow to a date range (e.g. the Monthly/Weekly Calendar view); omit
    all three for the full list (Settings panel) — all filters are purely
    additive/optional, so every existing caller's behavior is unchanged.
    """
    query = (
        supabase.table("google_calendar_events")
        .select("*")
        .eq("user_id", user_id)
        .is_("converted_to_task_id", "null")
        .eq("dismissed", False)
    )
    if date_filter:
        query = query.eq("start_date", date_filter)
    if start_date:
        query = query.gte("start_date", start_date)
    if end_date:
        query = query.lte("start_date", end_date)
    result = query.order("start_date").execute()
    return result.data


def dismiss_calendar_event(user_id: str, event_record_id: str) -> None:
    """
    Soft-hides a foreign calendar event from the events views without
    deleting the underlying row or touching Google Calendar itself — a
    dismiss is purely a local "stop showing me this" and must not reappear
    on the next pull sync (get_google_calendar_events_for_user already
    filters dismissed=False).
    """
    supabase.table("google_calendar_events").update({"dismissed": True}).eq("id", event_record_id).eq("user_id", user_id).execute()


def convert_calendar_event_to_task(user_id: str, calendar_event_record_id: str) -> dict:
    """
    Creates a real task from a stored foreign Google Calendar event, links
    them, and marks the event record as converted (so it stops appearing in
    the separate events view).

    IMPORTANT: the new task is created WITH the original google_event_id
    already set (below). That means the next scheduler push-sync tick
    (google_calendar.sync_task_to_google_calendar) will see an existing
    google_event_id on this task and PUT-update that same real event
    instead of POST-creating a duplicate — do not remove google_event_id
    from this insert, and do not clear it anywhere after conversion.
    """
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
        # Origin-aware deletion (services.TaskService.delete_task) relies on
        # this: since the event pre-existed on Google's side, deleting this
        # derived task must NOT delete the event, unlike calendar_origin='app'
        # tasks whose event this app itself created.
        "calendar_origin": "google",
    }).execute()

    new_task = new_task_result.data[0]
    supabase.table("google_calendar_events").update({
        "converted_to_task_id": new_task["id"]
    }).eq("id", calendar_event_record_id).execute()

    return new_task


def get_task_calendar_fields(user_id: str, record_id: str) -> Optional[dict]:
    """
    Raw lookup of a task's calendar-linkage bookkeeping fields
    (google_event_id, calendar_origin), scoped to user_id. Bypasses the
    TaskRecord parsing pipeline (which doesn't surface these) — used by
    the delete flow (to decide whether deleting the task should also
    delete the Google event: only for calendar_origin='app') and the
    complete/un-complete flow (to know whether there's an event to mark).
    """
    result = (
        supabase.table("tasks")
        .select("google_event_id, calendar_origin")
        .eq("id", record_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        return None
    return result.data[0]


def get_task_recurrence_fields(user_id: str, record_id: str) -> Optional[dict]:
    """
    This task's recurrence link, or None if the row genuinely does not exist.

    Deliberately does NOT catch exceptions, unlike get_task: the caller
    (delete_task) must be able to tell "no such row" from "the lookup
    failed". Conflating them turns a transient database blip into a hard
    delete of a recurring occurrence, which the generator then recreates on
    the next tick — the exact resurrection cancellation exists to prevent.
    """
    response = (
        supabase.table("tasks")
        .select("recurrence_rule_id")
        .eq("id", record_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0] if rows else None


# --- Agent conversation memory + run diagnostics (one table, agent_runs) ---
# A row in agent_runs IS one question/answer pair, so the same table serves
# BOTH the developer debug archive (log_agent_run, every column) and the Q&A
# agent's bounded short-term memory (get_recent_agent_runs, question/answer/
# refs only). There is no separate messages table — see DECISIONS.md.
# The client never sends history, only a conversation_id — the backend loads
# the last N runs itself and enforces every limit. Every read/write here is
# scoped by user_id, same as the rest of this file: app-code filtering is the
# primary security boundary, RLS is defense-in-depth.


def get_recent_agent_runs(user_id: str, conversation_id: str, limit: int) -> list[dict]:
    """
    Returns up to `limit` most recent agent_runs rows for
    (user_id, conversation_id) that have a non-null answer, REVERSED into
    oldest-to-newest order so callers can append them directly to a
    prompt's `contents` in chronological order. Returns [] on any failure —
    a history read must never block the agent from answering.
    """
    try:
        response = (
            supabase.table("agent_runs")
            .select("id, question, answer, refs")
            .eq("user_id", user_id)
            .eq("conversation_id", conversation_id)
            .not_.is_("answer", "null")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return list(reversed(response.data))
    except Exception as e:
        logger.warning(f"Failed to retrieve agent run history for conversation {conversation_id}: {e}")
        return []


# NEVER a source of usage/cost figures; token_usage_log remains the single
# source of truth for that (see DECISIONS.md). Whitelisted explicitly, not
# splatted, for the same reason documented on token_usage_log above: a write
# containing one unrecognized field is rejected wholesale by Supabase and
# would silently break ALL run logging.
_AGENT_RUN_COLUMNS = [
    "test_label", "raw_question", "question", "conversation_id",
    "first_turn_text", "system_instruction_sha", "day_view_rows",
    "history_messages", "rounds_detail", "rounds", "model",
    "prompt_tokens", "output_tokens", "thinking_tokens", "cached_tokens",
    "total_tokens", "outcome", "proposed_actions", "refs", "answer",
    "latency_ms", "error",
]


def log_agent_run(user_id: str, payload: dict) -> None:
    """
    Inserts one diagnostic row into agent_runs, owned by user_id. This is a
    debugging/verification aid, never a response-blocking operation: any
    failure is swallowed and logged, never raised.
    """
    try:
        fields = {col: payload.get(col) for col in _AGENT_RUN_COLUMNS}
        fields["user_id"] = user_id
        supabase.table("agent_runs").insert(fields).execute()
    except Exception as e:
        logger.warning(f"Failed to log agent run for user {user_id}: {e}")


# --- Agent action decisions (what the user did about each proposal) ---------
# See docs/migrations/2026-08-23-agent-action-decisions.sql for why this is its
# own table rather than a column on agent_runs.

_AGENT_DECISION_COLUMNS = [
    "conversation_id", "action_id", "action_type", "record_id", "task_name",
    "fields", "decision",
]


def record_agent_action_decision(user_id: str, decision: dict) -> None:
    """
    Records that the user confirmed or cancelled one agent proposal.

    Never raises, for the same reason log_agent_run does not: this runs inside
    the user's own Confirm, AFTER the write it describes has already succeeded.
    If an audit failure could propagate, a logging outage would surface as a
    user-visible error on an action that actually worked.

    Whitelisted rather than splatted — a Supabase insert carrying one
    unrecognized field is rejected wholesale, which would silently stop ALL
    decision recording (this exact failure once broke every token log).
    """
    try:
        fields = {col: decision.get(col) for col in _AGENT_DECISION_COLUMNS}
        fields["user_id"] = user_id
        supabase.table("agent_action_decisions").insert(fields).execute()
    except Exception as e:
        logger.warning(f"Failed to record agent action decision for user {user_id}: {e}")


def get_agent_runs_for_history(user_id: str, limit: int = 200) -> list[dict]:
    """
    This user's most recent agent runs, for the history screen.

    `test_label is null` is load-bearing, not tidiness: 282 of the 348 rows in
    agent_runs on 2026-08-23 were tagged development test runs. Without this
    filter the screen shows the developer's noise instead of the user's work.

    Returns [] on failure — a history screen that cannot load is a blank list,
    never an error page.
    """
    try:
        response = (
            supabase.table("agent_runs")
            .select("id, conversation_id, question, answer, outcome, proposed_actions, created_at")
            .eq("user_id", user_id)
            .is_("test_label", "null")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return response.data or []
    except Exception as e:
        logger.warning(f"Failed to load agent run history for user {user_id}: {e}")
        return []


def get_agent_conversation_runs(user_id: str, conversation_id: str) -> list[dict]:
    """Every run of one conversation, this user's only. [] on failure."""
    try:
        response = (
            supabase.table("agent_runs")
            .select("id, conversation_id, question, answer, outcome, proposed_actions, created_at")
            .eq("user_id", user_id)
            .eq("conversation_id", conversation_id)
            .is_("test_label", "null")
            .order("created_at", desc=True)
            .execute()
        )
        return response.data or []
    except Exception as e:
        logger.warning(f"Failed to load conversation {conversation_id} for user {user_id}: {e}")
        return []


def get_agent_action_decisions(user_id: str, conversation_id: str) -> list[dict]:
    """
    What the user decided about the proposals of one conversation. [] on
    failure, which reads as "undecided" everywhere downstream — the safe
    direction: the screen under-claims rather than inventing a decision.
    """
    try:
        response = (
            supabase.table("agent_action_decisions")
            .select("action_id, action_type, record_id, decision, created_at")
            .eq("user_id", user_id)
            .eq("conversation_id", conversation_id)
            .order("created_at", desc=True)
            .execute()
        )
        return response.data or []
    except Exception as e:
        logger.warning(f"Failed to load agent decisions for conversation {conversation_id}: {e}")
        return []


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


# =========================================================
# Recurrence rules (2026-08-15)
# =========================================================

def _supabase_row_to_rule(row: dict) -> RecurrenceRule:
    """A recurrence_rules row as the Pydantic model. user_id is not surfaced,
    the same ownership-is-a-data-layer-concern rule _supabase_row_to_task follows."""
    checklist = []
    for item in row.get("checklist") or []:
        if isinstance(item, str):
            checklist.append({"text": item, "done": False})
        elif isinstance(item, dict) and "text" in item:
            checklist.append({"text": item["text"], "done": item.get("done", False)})

    return RecurrenceRule(
        record_id=row.get("id"),
        task_name=_get(row, "task_name", ""),
        description=_get(row, "description", ""),
        category=_get(row, "category", "Unknown"),
        priority=_get(row, "priority", "P3"),
        due_time=row.get("due_time"),
        checklist=checklist,
        freq=_get(row, "freq", "weekly"),
        weekdays=row.get("weekdays"),
        month_day=row.get("month_day"),
        starts_on=_get(row, "starts_on", "1970-01-01"),
        ends_on=row.get("ends_on"),
        is_active=_get(row, "is_active", True),
        approval_status=_get(row, "approval_status", True),
        notify_enabled=_get(row, "notify_enabled", False),
        calendar_sync_enabled=_get(row, "calendar_sync_enabled", False),
        grace_days=_get(row, "grace_days", 1),
        materialized_through=row.get("materialized_through"),
        created_at=row.get("created_at"),
    )


def _rule_to_supabase_fields(rule: RecurrenceRule) -> dict:
    """Strips the server-generated fields, same as _task_to_supabase_fields."""
    fields = rule.model_dump()
    fields.pop("record_id", None)
    fields.pop("created_at", None)
    fields["checklist"] = [
        item if isinstance(item, dict) else item.model_dump()
        for item in (rule.checklist or [])
    ]
    return fields


def create_recurrence_rule(user_id: str, rule: RecurrenceRule) -> RecurrenceRule:
    fields = _rule_to_supabase_fields(rule)
    fields["user_id"] = user_id
    response = supabase.table("recurrence_rules").insert(fields).execute()
    row = (response.data or [{}])[0]
    logger.info(f"[recurrence] Created rule {row.get('id')} for user {user_id}")
    return _supabase_row_to_rule(row)


def get_recurrence_rules(user_id: str) -> list[RecurrenceRule]:
    response = (
        supabase.table("recurrence_rules")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=False)
        .execute()
    )
    return [_supabase_row_to_rule(row) for row in (response.data or [])]


def get_recurrence_rule(user_id: str, rule_id: str) -> Optional[RecurrenceRule]:
    """Both filters are required. A rule id alone must never read another
    user's rule — the backend uses the service key and bypasses RLS, so
    app-code scoping is the primary protection."""
    response = (
        supabase.table("recurrence_rules")
        .select("*")
        .eq("id", rule_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return _supabase_row_to_rule(rows[0]) if rows else None


def update_recurrence_rule(user_id: str, rule_id: str, updates: dict) -> Optional[RecurrenceRule]:
    if not updates:
        return get_recurrence_rule(user_id, rule_id)
    response = (
        supabase.table("recurrence_rules")
        .update(updates)
        .eq("id", rule_id)
        .eq("user_id", user_id)
        .execute()
    )
    rows = response.data or []
    return _supabase_row_to_rule(rows[0]) if rows else None


def delete_recurrence_rule(user_id: str, rule_id: str) -> None:
    supabase.table("recurrence_rules").delete().eq("id", rule_id).eq("user_id", user_id).execute()


# --------------------------------------------------------------- workspaces
# Two tables added 2026-09-01 that turn the category from a fixed word into a
# row the user owns. See
# docs/superpowers/specs/2026-08-31-workspaces-and-categories-design.md.


def _supabase_row_to_workspace(row: dict) -> Workspace:
    """A workspaces row as the Pydantic model. user_id is not surfaced, the
    same rule _supabase_row_to_task and _supabase_row_to_rule follow."""
    return Workspace(
        record_id=row.get("id"),
        name=_get(row, "name", ""),
        color=row.get("color"),
        position=_get(row, "position", 0),
        created_at=row.get("created_at"),
    )


def create_workspace(user_id: str, workspace: Workspace) -> Workspace:
    fields = {
        "user_id": user_id,
        "name": workspace.name,
        "color": workspace.color,
        "position": workspace.position,
    }
    response = supabase.table("workspaces").insert(fields).execute()
    row = (response.data or [{}])[0]
    logger.info(f"[workspaces] Created workspace {row.get('id')} for user {user_id}")

    # The owner joins their own room. workspaces.user_id answers "who may
    # administer this" and workspace_members answers "who may see it" — two
    # different questions — so without this row the owner is absent from every
    # read that asks membership rather than ownership.
    if row.get("id"):
        add_workspace_member(row["id"], user_id, role="owner")

    return _supabase_row_to_workspace(row)


def get_owned_workspaces(user_id: str) -> list[Workspace]:
    """
    Workspaces this person CREATED. The narrow read, and the old query.

    Kept separate from get_workspaces for the same reason belongs_to is kept
    separate from visible_to on tasks, and the failure it prevents is concrete:
    services.ensure_account_workspaces furnishes an account that has no
    workspaces, and it must ask this rather than the wide read. A colleague
    invited to somebody else's workspace BEFORE they first open the app would
    otherwise look furnished, get no Business, no Personal and no
    default_workspace_id, and have every task they create unfiled forever —
    which is the exact failure that function was written to prevent.

    Also what a duplicate-name check asks: the database unique is
    (user_id, name), so a sibling in somebody else's workspace is not a clash.
    """
    response = (
        supabase.table("workspaces")
        .select("*")
        .eq("user_id", user_id)
        .is_("archived_at", "null")
        .order("position", desc=False)
        .order("created_at", desc=False)
        .execute()
    )
    return [_supabase_row_to_workspace(row) for row in (response.data or [])]


def get_visible_workspace_ids(user_id: str) -> list[str]:
    """Ids of every live workspace this person may see — owned or joined. The
    one place that definition lives, so categories and workspaces cannot drift
    apart on what "visible" means."""
    return [w.record_id for w in get_workspaces(user_id) if w.record_id]


def get_workspaces(user_id: str) -> list[Workspace]:
    """
    Every LIVE workspace this person may see — theirs, plus any they have been
    invited into. The wide read: this is what a screen asks.

    Archived workspaces are excluded for everybody, not only their owner —
    archiving takes the room out of the switcher for the whole team.

    Ordered by position, then created_at: position is what the user drags,
    created_at only breaks ties between two rows never reordered.
    """
    member_ids = get_member_workspace_ids(user_id)

    query = supabase.table("workspaces").select("*")
    if member_ids:
        # Same shape, and the same trap, as get_all_tasks: an empty list would
        # reach PostgREST as `id.in.()`, which is a syntax error rather than an
        # empty match.
        query = query.or_(f"user_id.eq.{user_id},id.in.({','.join(member_ids)})")
    else:
        query = query.eq("user_id", user_id)

    response = (
        query
        .is_("archived_at", "null")
        .order("position", desc=False)
        .order("created_at", desc=False)
        .execute()
    )
    return [_supabase_row_to_workspace(row) for row in (response.data or [])]


def get_workspace(user_id: str, workspace_id: str) -> Optional[Workspace]:
    """Both filters are required. A workspace id alone must never read another
    user's row — the backend uses the service key and bypasses RLS."""
    response = (
        supabase.table("workspaces")
        .select("*")
        .eq("id", workspace_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return _supabase_row_to_workspace(rows[0]) if rows else None


def get_workspace_row(workspace_id: str) -> Optional[dict]:
    """
    One workspace as a raw row, WITHOUT user scoping.

    Deliberately unscoped, and the third function in this file that is — the
    others being access.task_ownership and get_invite_by_token_hash. All three
    exist to DECIDE something about a caller who is not yet established as
    entitled: here, somebody holding an invitation link, who is by definition
    not a member yet and cannot be scoped against the workspace they are trying
    to join.

    Returns the raw dict rather than a Workspace, because the caller needs
    archived_at and user_id — neither of which the model surfaces.
    """
    response = (
        supabase.table("workspaces")
        .select("*")
        .eq("id", workspace_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0] if rows else None


def update_workspace(user_id: str, workspace_id: str, updates: dict) -> Optional[Workspace]:
    if not updates:
        return get_workspace(user_id, workspace_id)
    response = (
        supabase.table("workspaces")
        .update(updates)
        .eq("id", workspace_id)
        .eq("user_id", user_id)
        .execute()
    )
    rows = response.data or []
    return _supabase_row_to_workspace(rows[0]) if rows else None


def delete_workspace(user_id: str, workspace_id: str) -> None:
    """The database does the rest: categories CASCADE with the workspace, while
    tasks pointing at either are SET NULL and become unfiled. Deleting a
    container never deletes work."""
    supabase.table("workspaces").delete().eq("id", workspace_id).eq("user_id", user_id).execute()


# -------------------------------------------------------- workspace members
# Who may SEE a workspace — a different question from workspaces.user_id,
# which is who may ADMINISTER it. See the 2026-09-11 design.


def _supabase_row_to_member(row: dict) -> WorkspaceMember:
    """A workspace_members row as the Pydantic model. Unlike the other
    _supabase_row_to_* helpers this one DOES surface user_id, because here the
    person is the data rather than the ownership stamp."""
    return WorkspaceMember(
        record_id=row.get("id"),
        workspace_id=_get(row, "workspace_id", ""),
        user_id=_get(row, "user_id", ""),
        role=_get(row, "role", "member"),
        notify_all=bool(row.get("notify_all", False)),
        joined_at=row.get("joined_at"),
    )


def get_member_workspace_ids(user_id: str) -> list[str]:
    """
    Every workspace this user may SEE. Ids only — the caller turns them into a
    single `or` filter, and reading whole rows to discard everything but the id
    is a round trip's worth of data for nothing.

    Returns [] and never None: AirtableTaskRepository.get_all_tasks branches on
    emptiness, and a None reaching PostgREST as `workspace_id.in.()` is a
    syntax error rather than an empty match. The None-skip below guards the
    same edge from the other direction.
    """
    response = (
        supabase.table("workspace_members")
        .select("workspace_id")
        .eq("user_id", user_id)
        .execute()
    )
    return [r["workspace_id"] for r in (response.data or []) if r.get("workspace_id")]


def add_workspace_member(workspace_id: str, user_id: str, role: str = "member") -> WorkspaceMember:
    """
    No scoping argument, deliberately: the CALLER has already established the
    right to do this — by accepting a valid invite, or by creating the
    workspace. This function does not re-decide it, the same way save_task does
    not re-decide whether the caller may create a task.
    """
    fields = {"workspace_id": workspace_id, "user_id": user_id, "role": role}
    response = supabase.table("workspace_members").insert(fields).execute()
    row = (response.data or [{}])[0]
    logger.info(f"[members] {user_id} joined workspace {workspace_id} as {role}")
    return _supabase_row_to_member(row)


def get_workspace_members(workspace_id: str) -> list[WorkspaceMember]:
    """Everyone in one room, owner included — the owner has a membership row
    like anyone else, created alongside the workspace."""
    response = (
        supabase.table("workspace_members")
        .select("*")
        .eq("workspace_id", workspace_id)
        .execute()
    )
    return [_supabase_row_to_member(r) for r in (response.data or [])]


def is_workspace_owner(user_id: str, workspace_id: str) -> bool:
    """
    Asks `workspaces`, NOT `workspace_members`.

    workspaces.user_id is the authority on who may administer a workspace —
    rename, archive, invite, remove people, delete tasks. The membership row
    marked 'owner' exists so that "who is in this room" has one answer in one
    table. Deciding ownership from that row instead would make one fact
    answerable two ways, which is how a pair like this starts to drift.

    A member, a stranger, and a workspace that does not exist are all the same
    answer here: False, not an exception.
    """
    response = (
        supabase.table("workspaces")
        .select("id")
        .eq("id", workspace_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return bool(response.data)

# ------------------------------------------------------- workspace invites
# The link is a bearer credential. Nothing here ever sees the raw token —
# sharing.py hashes it before it reaches this layer, and the hash is all that
# is stored. See the 2026-09-11 design.


# What a caller outside this module is allowed to see about an invite. The
# token_hash is deliberately absent: it is useless to anyone who cannot reverse
# it, but it has no business on a screen either, and a field that reaches the
# API is a field somebody eventually logs.
_INVITE_PUBLIC_FIELDS = (
    "id", "workspace_id", "invited_by", "email", "role", "expires_at",
    "accepted_at", "accepted_by", "revoked_at", "created_at",
)


def _invite_public(row: dict) -> dict:
    return {k: row.get(k) for k in _INVITE_PUBLIC_FIELDS}


def create_workspace_invite(
    workspace_id: str, invited_by: str, token_hash: str, role: str, expires_at: str
) -> dict:
    """Stores the HASH. The raw token is returned to the caller by sharing.py
    and is unrecoverable afterwards."""
    fields = {
        "workspace_id": workspace_id,
        "invited_by": invited_by,
        "token_hash": token_hash,
        "role": role,
        "expires_at": expires_at,
    }
    response = supabase.table("workspace_invites").insert(fields).execute()
    row = (response.data or [{}])[0]
    logger.info(f"[invites] created invite {row.get('id')} for workspace {workspace_id}")
    return _invite_public(row)


def get_invite_by_token_hash(token_hash: str) -> Optional[dict]:
    """
    DELIBERATELY UNSCOPED, for the same reason access.task_ownership is: this
    lookup is what DECIDES who the caller is allowed to become, and the person
    accepting an invitation is by definition not yet a member of anything.

    Returns the FULL row, including the state columns the caller has to check
    (accepted_at, revoked_at, expires_at). Validity is decided in sharing.py,
    not here — a repository function that silently returned None for an expired
    invite could not tell the user WHY it did not work.
    """
    response = (
        supabase.table("workspace_invites")
        .select("*")
        .eq("token_hash", token_hash)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0] if rows else None


def mark_invite_accepted(invite_id: str, user_id: str, accepted_at: str) -> None:
    """Single use: filling accepted_at is what kills the link."""
    (
        supabase.table("workspace_invites")
        .update({"accepted_at": accepted_at, "accepted_by": user_id})
        .eq("id", invite_id)
        .execute()
    )
    logger.info(f"[invites] invite {invite_id} accepted by {user_id}")


def revoke_workspace_invite(invite_id: str, revoked_at: str) -> None:
    """
    Stamps rather than deletes. A withdrawn invitation is a fact worth keeping
    — it is what the activity log points at — and removing the row would also
    free its token_hash for a collision that cannot otherwise happen.
    """
    (
        supabase.table("workspace_invites")
        .update({"revoked_at": revoked_at})
        .eq("id", invite_id)
        .execute()
    )
    logger.info(f"[invites] invite {invite_id} revoked")


def get_workspace_invites(workspace_id: str) -> list[dict]:
    """Every invite ever made for this workspace, used and unused. The screen
    decides which to show; this does not hide history."""
    response = (
        supabase.table("workspace_invites")
        .select("*")
        .eq("workspace_id", workspace_id)
        .order("created_at", desc=True)
        .execute()
    )
    return [_invite_public(r) for r in (response.data or [])]


# ------------------------------------------------------ membership changes


def remove_workspace_member(workspace_id: str, user_id: str) -> None:
    """Both filters, always. A workspace_id alone would empty the room; a
    user_id alone would remove that person from every workspace they are in."""
    (
        supabase.table("workspace_members")
        .delete()
        .eq("workspace_id", workspace_id)
        .eq("user_id", user_id)
        .execute()
    )
    logger.info(f"[members] {user_id} removed from workspace {workspace_id}")


def unassign_tasks_for_member(workspace_id: str, user_id: str) -> None:
    """
    Clears assigned_to on that person's tasks IN THAT WORKSPACE ONLY.

    The tasks stay where they are and become unclaimed, visible to the owner
    the moment it happens. Leaving the name in place would keep a departed
    person attached to work nobody is going to do and nobody is watching for.

    Both filters matter: removing somebody from the cleaning team must not
    unassign their work in the office.
    """
    (
        supabase.table("tasks")
        .update({"assigned_to": None})
        .eq("workspace_id", workspace_id)
        .eq("assigned_to", user_id)
        .execute()
    )
    logger.info(f"[members] unassigned {user_id}'s tasks in workspace {workspace_id}")


def set_member_notify_all(workspace_id: str, user_id: str, enabled: bool) -> None:
    """The switch for an owner who wants the team's reminders too. Per
    workspace, because wanting the cleaning team's reminders is not the same as
    wanting the office's."""
    (
        supabase.table("workspace_members")
        .update({"notify_all": enabled})
        .eq("workspace_id", workspace_id)
        .eq("user_id", user_id)
        .execute()
    )


# ------------------------------------------------------ workspace archiving


def set_workspace_archived(user_id: str, workspace_id: str, archived_at: Optional[str]) -> None:
    """
    Archiving replaces deletion. Pass None to restore.

    Owner-scoped: archiving is administration, and administration is
    workspaces.user_id's question, not membership's.
    """
    (
        supabase.table("workspaces")
        .update({"archived_at": archived_at})
        .eq("id", workspace_id)
        .eq("user_id", user_id)
        .execute()
    )
    logger.info(f"[workspaces] {workspace_id} archived_at={archived_at}")


def clear_workspace_from_all_settings(workspace_id: str, fallback_default: Optional[str]) -> None:
    """
    Repoints the two per-user settings that can name a workspace, FOR EVERY
    USER, not just the owner.

    app_settings.active_workspace_id and default_workspace_id are per-user
    rows. Archiving a shared workspace without this leaves a colleague looking
    at a workspace that is not there — and, worse, hands the extractor the
    category vocabulary of an archived workspace.

    active_workspace_id falls back to NULL, which already means "Όλα" and is
    the default for anyone who never touched the switcher. default_workspace_id
    falls back to Business, which ensure_account_workspaces guarantees exists.
    """
    (
        supabase.table("app_settings")
        .update({"active_workspace_id": None})
        .eq("active_workspace_id", workspace_id)
        .execute()
    )
    (
        supabase.table("app_settings")
        .update({"default_workspace_id": fallback_default})
        .eq("default_workspace_id", workspace_id)
        .execute()
    )
    logger.info(f"[workspaces] repointed settings away from {workspace_id}")


# ------------------------------------------------------- workspace activity


def log_workspace_activity(
    workspace_id: str,
    actor_user_id: str,
    action: str,
    task_id: Optional[str] = None,
    task_name: Optional[str] = None,
    details: Optional[dict] = None,
) -> None:
    """
    NEVER RAISES.

    The log is a record of work, not a participant in it. By the time this is
    called the thing the user asked for has already happened, and reporting a
    failure because the diary could not be written would be a lie about what
    occurred. A failure is logged to the application log and swallowed.

    task_name is stored alongside task_id on purpose — with the id alone,
    deleting a task turns its whole history into "somebody did something to
    something".
    """
    try:
        supabase.table("workspace_activity").insert({
            "workspace_id": workspace_id,
            "actor_user_id": actor_user_id,
            "action": action,
            "task_id": task_id,
            "task_name": task_name,
            "details": details,
        }).execute()
    except Exception as e:
        logger.error(f"[activity] failed to record {action} in {workspace_id}: {e}")


def get_workspace_activity(workspace_id: str, limit: int = 100) -> list[dict]:
    """Newest first, capped. The screen pages by lowering the cap rather than
    by offset — the log only grows at one end."""
    response = (
        supabase.table("workspace_activity")
        .select("*")
        .eq("workspace_id", workspace_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return list(response.data or [])

# --------------------------------------------------------------- categories


def _supabase_row_to_category(row: dict) -> Category:
    return Category(
        record_id=row.get("id"),
        workspace_id=_get(row, "workspace_id", ""),
        name=_get(row, "name", ""),
        color=row.get("color"),
        position=_get(row, "position", 0),
        system_key=row.get("system_key"),
        created_at=row.get("created_at"),
    )


def create_category(user_id: str, category: Category) -> Category:
    fields = {
        "user_id": user_id,
        "workspace_id": category.workspace_id,
        "name": category.name,
        "color": category.color,
        "position": category.position,
        "system_key": category.system_key,
    }
    response = supabase.table("categories").insert(fields).execute()
    row = (response.data or [{}])[0]
    logger.info(f"[workspaces] Created category {row.get('id')} for user {user_id}")
    return _supabase_row_to_category(row)


def get_categories(user_id: str) -> list[Category]:
    """
    Every category this user owns, across all their workspaces.

    Keyed on the workspaces the person can SEE rather than on categories.user_id
    (2026-09-11). A member needs the category names of the room they were
    invited into, and those rows carry the OWNER's user_id — filtering on it
    would show a colleague every task in that workspace as unfiled.

    Still one call for the whole set, because the frontend needs all of it on
    every app open to colour task chips that may belong to any workspace.
    """
    workspace_ids = get_visible_workspace_ids(user_id)
    if not workspace_ids:
        # Returned without asking the database: an empty list reaching
        # PostgREST as `workspace_id.in.()` is a syntax error, not an empty
        # match.
        return []

    response = (
        supabase.table("categories")
        .select("*")
        .in_("workspace_id", workspace_ids)
        .order("position", desc=False)
        .order("created_at", desc=False)
        .execute()
    )
    return [_supabase_row_to_category(row) for row in (response.data or [])]


def get_categories_for_workspace(user_id: str, workspace_id: str) -> list[Category]:
    """One workspace's categories. Filtered in Python off the user's full set
    rather than queried per workspace, because every caller here already needs
    the whole set for something else in the same request."""
    if not workspace_id:
        return []
    return [c for c in get_categories(user_id) if c.workspace_id == workspace_id]


def get_category(user_id: str, category_id: str) -> Optional[Category]:
    response = (
        supabase.table("categories")
        .select("*")
        .eq("id", category_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return _supabase_row_to_category(rows[0]) if rows else None


def get_system_category(user_id: str, system_key: str) -> Optional[Category]:
    """
    The one category the integration owns, found by its KEY and never by its
    name. That indirection is the reason a user-defined category system can
    exist at all without the Hostaway path noticing: the label is the user's to
    rename, the key is not.

    Returns None — never raises. Two separate cases reach that same answer:
    an account with no such row, and a database that has no `categories` table
    at all because the code was deployed before the migration was run. The
    second is caught explicitly rather than left to blow up, because this is
    called from the Hostaway webhook (where a raise loses a guest message
    outright) and from the scheduler's per-user loop (where a raise costs every
    later user their tick). Both degrade to "unfiled", which is recoverable;
    a lost message is not.
    """
    try:
        response = (
            supabase.table("categories")
            .select("*")
            .eq("user_id", user_id)
            .eq("system_key", system_key)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.warning(
            f"[workspaces] Could not read the '{system_key}' system category for "
            f"{user_id} — has the workspaces migration been run? ({e})"
        )
        return None

    rows = response.data or []
    return _supabase_row_to_category(rows[0]) if rows else None


def update_category(user_id: str, category_id: str, updates: dict) -> Optional[Category]:
    if not updates:
        return get_category(user_id, category_id)
    response = (
        supabase.table("categories")
        .update(updates)
        .eq("id", category_id)
        .eq("user_id", user_id)
        .execute()
    )
    rows = response.data or []
    return _supabase_row_to_category(rows[0]) if rows else None


def delete_category(user_id: str, category_id: str) -> None:
    """Tasks pointing here are SET NULL by the database and become unfiled."""
    supabase.table("categories").delete().eq("id", category_id).eq("user_id", user_id).execute()


def count_tasks_in_workspace(user_id: str, workspace_id: str) -> int:
    """How many tasks would become unfiled if this workspace went away. Asked
    before the delete, so the confirmation can say a number instead of a
    warning nobody reads."""
    response = (
        supabase.table("tasks")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("workspace_id", workspace_id)
        .execute()
    )
    return response.count or 0


def count_tasks_in_category(user_id: str, category_id: str) -> int:
    """Same purpose as count_tasks_in_workspace: a number in the confirmation
    instead of a warning nobody reads."""
    response = (
        supabase.table("tasks")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("category_id", category_id)
        .execute()
    )
    return response.count or 0


def get_occurrence_dates(user_id: str, rule_id: str, from_date: str, to_date: str) -> set[str]:
    """
    Which occurrence dates this rule already has inside the window.

    A set, because the generator's job is a set difference: produce the dates
    the rule wants, subtract the ones already on disk, insert the rest. Windowed
    rather than fetching every date ever, so a rule with a year of history
    stays as cheap on day 400 as on day 1.
    """
    response = (
        supabase.table("tasks")
        .select("occurrence_date")
        .eq("user_id", user_id)
        .eq("recurrence_rule_id", rule_id)
        .gte("occurrence_date", from_date)
        .lte("occurrence_date", to_date)
        .execute()
    )
    return {row["occurrence_date"] for row in (response.data or []) if row.get("occurrence_date")}


def get_open_occurrences(user_id: str, rule_id: str) -> list[dict]:
    """
    This rule's occurrences that are still open — not completed, not rejected,
    not already missed, not cancelled. Returns id/occurrence_date/due_date
    only: the callers (regeneration and deletion) need to decide and then
    delete by id, never to reconstruct a whole TaskRecord.
    """
    response = (
        supabase.table("tasks")
        .select("id, occurrence_date, due_date")
        .eq("user_id", user_id)
        .eq("recurrence_rule_id", rule_id)
        .eq("is_completed", False)
        .eq("is_rejected", False)
        .is_("cancelled_at", "null")
        .is_("missed_at", "null")
        .execute()
    )
    return response.data or []


def delete_tasks_by_ids(user_id: str, task_ids: list[str]) -> int:
    """Hard-deletes the given tasks, scoped to the user. Returns how many went."""
    if not task_ids:
        return 0
    response = (
        supabase.table("tasks")
        .delete()
        .eq("user_id", user_id)
        .in_("id", task_ids)
        .execute()
    )
    return len(response.data or [])


def mark_task_missed(user_id: str, record_id: str, missed_at: str) -> None:
    """
    Stamps missed_at and nothing else.

    Deliberately NOT is_rejected, even though that flag already hides a task
    everywhere: is_rejected means "the user rejected the AI's suggestion" and
    is preserved to feed the learning loop, so filling it with auto-closed
    occurrences the AI never proposed would corrupt that signal.
    """
    supabase.table("tasks").update({"missed_at": missed_at}).eq("id", record_id).eq(
        "user_id", user_id
    ).execute()


def cancel_task(user_id: str, record_id: str, cancelled_at: str) -> bool:
    """
    Marks one occurrence as cancelled by the user, leaving the row in place.
    Returns whether a row was actually updated.

    The row must survive: get_occurrence_dates skips any date that already
    exists, so a hard delete would make the generator recreate this task on
    the next ~2-minute tick. The bool return matters for the same reason it
    matters on the hard-delete branch it sits beside: a PostgREST UPDATE
    matching zero rows returns 200 with empty data, not an exception, so
    without this signal a race or an RLS edge case would leave the row
    untouched while the caller reports success.
    """
    response = (
        supabase.table("tasks")
        .update({"cancelled_at": cancelled_at})
        .eq("id", record_id)
        .eq("user_id", user_id)
        .execute()
    )
    return bool(response.data)
