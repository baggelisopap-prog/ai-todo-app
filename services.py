import base64
import json
import logging
import os
import tempfile
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo
from pywebpush import webpush, WebPushException
from models import RecurrenceRule, SingleTask, TaskList, TaskRecord
from ai_engine import extract_tasks, extract_tasks_from_audio, extract_tasks_from_image
from repository import AirtableTaskRepository
import google_calendar
import hostaway_integration
import hostaway_threading
import recurrence
import repository

logger = logging.getLogger(__name__)

VAPID_CONTACT_EMAIL = os.getenv("VAPID_CONTACT_EMAIL", "baggelisopap@gmail.com")

# How far ahead of a task's due time to send the advance reminder.
REMINDER_OFFSET_MINUTES = 15

# Fixed lead time for "before_first_task" daily summary mode (not user-configurable).
DAILY_SUMMARY_BEFORE_FIRST_TASK_OFFSET_MINUTES = 30

# How often an unresolved Hostaway task gets re-notified, by priority.
# Repeats indefinitely at this pace until the task is marked completed.
HOSTAWAY_ESCALATION_INTERVALS = {
    "P1": timedelta(minutes=30),
    "P2": timedelta(hours=1),
    "P3": timedelta(hours=2),
}

# Which priorities a human reply is allowed to COMPLETE outright.
#
# Deliberately the least urgent one only, as a staged rollout: the owner
# wants to watch auto-completion work before trusting it with anything that
# matters («για αρχή, μην χάσω κανένα τασκ», 2026-08-13). P3 is "where's a
# good taverna" and "we're out of toilet paper" — a wrong close costs
# nothing. Add "P2" here when it has been seen working; that is the whole
# change, both callers read this set.
#
# P1 is not a candidate and should not be added: replying to "I can't find
# the keys" with "I'm coming in 20 minutes" is an answer, not a fix (design
# §3.2). Every priority outside this set still records the reply and stops
# the escalation nagging — it just stays on the list for a human to close.
HOSTAWAY_REPLY_AUTOCOMPLETE_PRIORITIES = {"P3"}


def hostaway_completion_fields() -> dict:
    """
    The three fields that together mean "a guest reply closed this task".

    One function, because two paths can close a task this way — the scheduler's
    reply check and the webhook's outgoing handler — and "what closed this?"
    must never have two spellings to grep for.
    """
    return {
        "is_completed": True,
        "completed_at": datetime.now(ZoneInfo("Europe/Athens")).isoformat(),
        "completed_source": "hostaway_reply",
    }

# Ceiling on how many conversations the reply check pulls from Hostaway in a
# single scheduler tick. One HTTP call each, run sequentially on a cron that
# fires every ~2 minutes, so an unbounded loop is what turns a busy week into
# a scheduler that never finishes its pass. Freshest conversation first, since
# that is where a reply is most likely; if the cap ever bites it says so in
# the log rather than skipping quietly. Today the real number is 1.
HOSTAWAY_REPLY_POLL_LIMIT = 20

# pywebpush's webpush() only accepts a Vapid instance or a private-key file
# path for vapid_private_key — passing the raw multi-line PEM string directly
# fails, since it's not routed through Vapid.from_file()'s PEM parsing. So we
# write the PEM (read from the env var) to a temp file once per process and
# reuse that path.
_vapid_key_file_path = None


def _load_vapid_private_key_pem() -> str:
    """
    Reads the base64-encoded VAPID private key from the environment and
    decodes it back to its original PEM text. Base64 (rather than the raw
    multi-line PEM) avoids corruption from web dashboard text fields
    (Render, Vercel, etc.) mangling newlines/whitespace — a single unbroken
    base64 line has no such risk.
    """
    b64_value = os.getenv("VAPID_PRIVATE_KEY_B64")
    if not b64_value:
        raise RuntimeError("VAPID_PRIVATE_KEY_B64 is not set")
    try:
        pem_bytes = base64.b64decode(b64_value)
        return pem_bytes.decode("utf-8")
    except Exception as e:
        raise RuntimeError(f"VAPID_PRIVATE_KEY_B64 is set but could not be decoded: {e}")


def _get_vapid_key_file() -> str:
    global _vapid_key_file_path
    if _vapid_key_file_path and os.path.isfile(_vapid_key_file_path):
        return _vapid_key_file_path

    private_key_pem = _load_vapid_private_key_pem()

    fd, path = tempfile.mkstemp(suffix=".pem")
    with os.fdopen(fd, "w") as f:
        f.write(private_key_pem)
    _vapid_key_file_path = path
    return path


def sync_google_calendar_for_user(user_id: str) -> dict:
    """
    One user's worth of Google Calendar sync for a single scheduler tick:
    pushes locally-changed timed tasks to Google, then pulls back any
    changes Google reports for events this app created (see
    google_calendar.pull_calendar_changes for the pull-scope rules). Never
    raises — a connection lookup or API failure for one user must not
    interrupt the scheduler's processing of every other user, or any of
    the other per-user checks (reminders, daily summary, Hostaway
    escalations) in the same loop tick.
    """
    connection = repository.get_google_calendar_connection(user_id)
    if not connection:
        return {"status": "not_connected"}

    try:
        tasks_to_push = repository.get_tasks_needing_calendar_push(user_id)
        pushed = 0
        for task in tasks_to_push:
            event_id = google_calendar.sync_task_to_google_calendar(user_id, task)
            if event_id:
                repository.update_task_calendar_sync(task["id"], event_id)
                pushed += 1

        pulled = google_calendar.pull_calendar_changes(user_id)

        return {"status": "ok", "pushed": pushed, "pulled": pulled}
    except Exception as e:
        logger.error(f"[calendar sync] Failed for user {user_id}: {e}")
        return {"status": "error", "error": str(e)}


class TaskService:
    """
    Business logic layer. Coordinates AI extraction with data persistence.
    Does not know about HTTP, terminal, or any specific presentation layer.
    """
    
    def __init__(self, repository: Optional[AirtableTaskRepository] = None):
        """
        Accepts an optional repository for dependency injection (useful for testing).
        If not provided, creates a default AirtableTaskRepository.
        """
        self.repository = repository or AirtableTaskRepository()

    def _single_task_to_record(self, task: SingleTask) -> TaskRecord:
        """
        Private helper. Converts a SingleTask (Schema 1) to a TaskRecord (Schema 2)
        by filling in the ai_suggested_* snapshots.
        """
        return TaskRecord(
            task_name=task.task_name,
            description=task.description,
            category=task.category,
            priority=task.priority,
            due_date=task.due_date,
            due_time=task.due_time,
            checklist=task.checklist,
            # Snapshots of the AI's original suggestion
            ai_suggested_category=task.category,
            ai_suggested_priority=task.priority,
            # approval_status and is_completed use their defaults (False)
        )

    def extract_and_save(self, raw_input: str, user_id: str) -> list[TaskRecord]:
        """
        Main business operation.
        Extracts tasks from raw text via AI, converts them to records, and saves them to the DB.
        Returns a list of successfully saved TaskRecords.
        """
        logger.info("Processing input for extraction and save...")

        # 1. AI Extraction
        task_list = extract_tasks(raw_input, user_id=user_id)

        if not task_list:
            raise RuntimeError("AI extraction failed to produce valid tasks.")

        saved_tasks = []

        # 2. Conversion and Saving
        for task in task_list.items:
            task_record = self._single_task_to_record(task)

            try:
                saved_task = self.repository.save_task(user_id, task_record)
                saved_tasks.append(saved_task)
            except Exception as e:
                # Log individual failures but continue processing the rest
                logger.error(f"Failed to save task '{task.task_name}' to database: {e}")

        # 3. Final Validation
        if not saved_tasks and len(task_list.items) > 0:
            raise RuntimeError("All extracted tasks failed to save to the database.")

        logger.info(f"Successfully saved {len(saved_tasks)} tasks to database.")
        return saved_tasks

    def extract_and_save_from_audio(self, audio_bytes: bytes, mime_type: str, user_id: str) -> list[TaskRecord]:
        """
        Extracts tasks from an audio recording via AI and saves them to the database.
        Mirrors extract_and_save exactly — only the AI call differs.
        """
        logger.info("Processing audio input for extraction and save...")

        # 1. AI Extraction
        task_list = extract_tasks_from_audio(audio_bytes, mime_type, user_id=user_id)

        if not task_list:
            raise RuntimeError("AI extraction failed to produce valid tasks from audio.")

        saved_tasks = []

        # 2. Conversion and Saving
        for task in task_list.items:
            task_record = self._single_task_to_record(task)

            try:
                saved_task = self.repository.save_task(user_id, task_record)
                saved_tasks.append(saved_task)
            except Exception as e:
                logger.error(f"Failed to save task '{task.task_name}' to database: {e}")

        # 3. Final Validation
        if not saved_tasks and len(task_list.items) > 0:
            raise RuntimeError("All extracted tasks failed to save to the database.")

        logger.info(f"Successfully saved {len(saved_tasks)} tasks from audio to database.")
        return saved_tasks

    def extract_and_save_from_image(self, image_bytes: bytes, mime_type: str, user_id: str, additional_context: str = None) -> list[TaskRecord]:
        """
        Extracts tasks from an image via AI and saves them to the database.
        Mirrors extract_and_save exactly — only the AI call differs.
        """
        logger.info("Processing image input for extraction and save...")

        # 1. AI Extraction
        task_list = extract_tasks_from_image(image_bytes, mime_type, user_id=user_id, additional_context=additional_context)

        if not task_list:
            raise RuntimeError("AI extraction failed to produce valid tasks from image.")

        saved_tasks = []

        # 2. Conversion and Saving
        for task in task_list.items:
            task_record = self._single_task_to_record(task)

            try:
                saved_task = self.repository.save_task(user_id, task_record)
                saved_tasks.append(saved_task)
            except Exception as e:
                logger.error(f"Failed to save task '{task.task_name}' to database: {e}")

        # 3. Final Validation
        if not saved_tasks and len(task_list.items) > 0:
            raise RuntimeError("All extracted tasks failed to save to the database.")

        logger.info(f"Successfully saved {len(saved_tasks)} tasks from image to database.")
        return saved_tasks

    def create_task_manual(self, user_id: str, fields: dict, approval_status: bool = True) -> TaskRecord:
        """
        Manually create a task. Fills in AI-suggested fields as duplicates
        of user's choices (since there's no AI here) and sets defaults for
        approval flags.

        approval_status defaults to True (pre-approved) for the normal
        manual-create path (POST /tasks). The agent-write confirm flow
        (POST /agent/confirm-action, main.py) passes False instead, so an
        agent-created task lands in the Inbox for review rather than
        appearing directly in the user's list.
        """
        checklist = fields.get("checklist") or []

        task = TaskRecord(
            task_name=fields["task_name"].strip(),
            description=fields.get("description", "").strip(),
            category=fields.get("category", "Unknown"),
            priority=fields.get("priority", "P3"),
            due_date=fields.get("due_date"),
            due_time=fields.get("due_time"),
            checklist=checklist,
            approval_status=approval_status,
            is_completed=False,
            is_rejected=False,
            notify_enabled=fields.get("notify_enabled", False),
            calendar_sync_enabled=fields.get("calendar_sync_enabled", False),
            ai_suggested_category=fields.get("category", "Unknown"),
            ai_suggested_priority=fields.get("priority", "P3"),
            record_id=None,
            created_time=None,
            hostaway_created_at=fields.get("hostaway_created_at"),
            hostaway_last_notified_at=fields.get("hostaway_last_notified_at"),
            hostaway_conversation_id=fields.get("hostaway_conversation_id"),
            hostaway_last_message_at=fields.get("hostaway_last_message_at"),
            hostaway_message_count=fields.get("hostaway_message_count", 0),
            hostaway_thread=fields.get("hostaway_thread"),
            recurrence_rule_id=fields.get("recurrence_rule_id"),
            occurrence_date=fields.get("occurrence_date"),
        )
        return self.repository.save_task(user_id, task)

    def get_all_tasks(self, user_id: str) -> list[TaskRecord]:
        """
        Retrieves all tasks belonging to user_id from the database.
        """
        return self.repository.get_all_tasks(user_id)

    def update_task(
        self, user_id: str, record_id: str, updates: dict, completed_source: str = "ui"
    ) -> TaskRecord:
        """
        Updates an existing task in the database, scoped to user_id.
        There is no separate "mark complete"/"un-complete" endpoint — both
        go through this same generic PATCH path with is_completed in
        updates, alongside any other field change.

        A completion also records WHO did it. `completed_source` defaults to
        "ui" because this generic path IS the UI's; the agent's confirm-action
        passes "agent", and the Hostaway reply poller writes "hostaway_reply"
        through its own repository call. On 2026-08-13 a task completed itself
        six seconds after being created, and neither the row, nor the
        application log, nor agent_runs could say what had done it — the
        investigation could only get as far as "a write shaped like the UI's",
        which is a guess. This column is the answer to that question.

        If this update changes
        is_completed AND the task has a linked Google Calendar event, the
        event's title gets a "✓ " prefix added (complete) or removed
        (un-complete) — completion no longer DELETES the event (revised
        from an earlier behavior); the event survives on the calendar
        either way. Never blocks the actual completion/un-completion if
        the calendar update fails.
        """
        if "is_completed" in updates:
            # A new dict, never the caller's: this method is handed request
            # bodies and agent payloads that the caller may still be using.
            stamp = (
                {
                    "completed_at": datetime.now(ZoneInfo("Europe/Athens")).isoformat(),
                    "completed_source": completed_source,
                }
                if updates["is_completed"]
                # Re-opening clears it. A task that is open again must not keep
                # claiming it was closed, and by whom.
                else {"completed_at": None, "completed_source": None}
            )
            updates = {**updates, **stamp}

        updated_task = self.repository.update_task(user_id, record_id, updates)

        if "is_completed" in updates:
            try:
                calendar_fields = repository.get_task_calendar_fields(user_id, record_id)
                if calendar_fields and calendar_fields.get("google_event_id"):
                    google_calendar.mark_event_completed(
                        user_id,
                        calendar_fields["google_event_id"],
                        completed=bool(updates["is_completed"]),
                        current_title=updated_task.task_name,
                    )
            except Exception as e:
                logger.error(f"[calendar sync] Failed to mark calendar event completion for task {record_id}: {e}")

        return updated_task

    def delete_task(self, user_id: str, record_id: str) -> str:
        """
        Disposes of a task, scoped to user_id, permanently: hard-deletes an
        ordinary task, cancels a recurring occurrence. Raises on failure.

        A recurring occurrence (non-null recurrence_rule_id) is the one
        exception: it is cancelled instead of hard-deleted, because
        get_occurrence_dates skips any occurrence_date that already exists,
        so removing the row would make the generator recreate it on the next
        ~2-minute tick. An ordinary task has no rule that could resurrect it
        and keeps the hard delete below.

        Origin-aware calendar cleanup: only deletes the linked Google
        Calendar event if this task originated in the app
        (calendar_origin == 'app'). A task converted FROM a Google event
        (calendar_origin == 'google') keeps its event on Google's side even
        after the derived task is deleted here — the event pre-existed
        there and deleting the task shouldn't remove it. A failure on the
        calendar side is logged and never blocks the actual task deletion.

        Returns WHAT HAPPENED TO THE CALENDAR, so the caller can tell the
        user instead of showing a bare "deleted" for four different outcomes:
          "none"               — no linked event; nothing to do
          "deleted"            — app-origin event, removed from Google too
          "kept_google_origin" — event created in Google Calendar first, so it
                                 stays there; only the app's task is gone
          "delete_failed"      — app-origin, but Google refused the delete
        The task itself is deleted in every one of these cases.
        """
        calendar_fields = None
        try:
            calendar_fields = repository.get_task_calendar_fields(user_id, record_id)
        except Exception as e:
            logger.error(f"[calendar sync] Failed to look up linked calendar event before deleting task {record_id}: {e}")

        recurrence_fields = repository.get_task_recurrence_fields(user_id, record_id)
        if recurrence_fields and recurrence_fields.get("recurrence_rule_id"):
            # The row must survive: get_occurrence_dates skips any date that
            # already exists, so a hard delete here would make the generator
            # recreate this task on the next ~2-minute tick.
            cancelled = repository.cancel_task(user_id, record_id, datetime.now(ZoneInfo("Europe/Athens")).isoformat())
            if not cancelled:
                raise RuntimeError(f"Failed to cancel task {record_id}")
            logger.info(
                f"Cancelled recurring occurrence {record_id} (rule "
                f"{recurrence_fields.get('recurrence_rule_id')}) instead of deleting it, "
                f"so the generator will not recreate it."
            )
        else:
            success = self.repository.delete_task(user_id, record_id)
            if not success:
                raise RuntimeError(f"Failed to delete task {record_id}")
            logger.info(f"Deleted task {record_id}.")

        if not calendar_fields or not calendar_fields.get("google_event_id"):
            return "none"

        if calendar_fields.get("calendar_origin") != "app":
            logger.info(
                f"[calendar sync] Task {record_id} came FROM Google Calendar "
                f"(calendar_origin={calendar_fields.get('calendar_origin')}) — leaving its event in place"
            )
            return "kept_google_origin"

        deleted = google_calendar.delete_calendar_event(user_id, calendar_fields["google_event_id"])
        return "deleted" if deleted else "delete_failed"

    def send_push_to_user(self, user_id: str, title: str, body: str, view: Optional[str] = None) -> dict:
        """
        Sends a push notification to every subscription belonging to
        user_id. Cleans up subscriptions that the push service reports as
        gone (404/410 — meaning the browser unsubscribed or the
        installation was removed).

        `view` is an optional tab id (e.g. "today") tagged onto the push
        payload so the service worker's notificationclick handler knows
        which in-app view to open/switch to.
        """
        subscriptions = repository.list_push_subscriptions(user_id)
        sent = 0
        failed = 0

        vapid_key_file = _get_vapid_key_file()

        payload = {"title": title, "body": body}
        if view:
            payload["view"] = view

        for sub in subscriptions:
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {
                            "p256dh": sub.p256dh,
                            "auth": sub.auth,
                        },
                    },
                    data=json.dumps(payload),
                    vapid_private_key=vapid_key_file,
                    vapid_claims={"sub": f"mailto:{VAPID_CONTACT_EMAIL}"},
                )
                sent += 1
            except WebPushException as e:
                failed += 1
                status_code = getattr(e.response, "status_code", None)
                if status_code in (404, 410):
                    repository.delete_push_subscription(user_id, sub.endpoint)
                logger.error(f"Push failed for {sub.endpoint[:50]}...: {e}")
            except Exception as e:
                # Covers errors raised before a request is even made (e.g.
                # py_vapid.VapidException for a malformed/blank endpoint),
                # which aren't WebPushException subclasses. One bad
                # subscription must not abort the rest of the batch.
                failed += 1
                logger.error(f"Push failed for {sub.endpoint[:50]}...: {e}")

        return {"sent": sent, "failed": failed, "total": len(subscriptions)}

    # =========================================================
    # Recurring tasks (2026-08-15)
    # =========================================================

    def _occurrence_fields(self, rule: RecurrenceRule, occurrence: "date") -> dict:
        """
        The template, copied fresh for one day.

        The checklist is copied with every item undone: this is a new day's
        work, not a continuation of yesterday's. ai_suggested_* mirror the
        rule's chosen values — the same thing the Google-event conversion in
        repository.py does, and for the same reason: the columns are
        non-nullable and no AI suggested anything here.
        """
        occurrence_str = recurrence.format_date(occurrence)
        return {
            "task_name": rule.task_name,
            "description": rule.description,
            "category": rule.category,
            "priority": rule.priority,
            "due_date": occurrence_str,
            "due_time": rule.due_time,
            "checklist": [{"text": item.text, "done": False} for item in (rule.checklist or [])],
            "notify_enabled": rule.notify_enabled,
            "calendar_sync_enabled": rule.calendar_sync_enabled,
            "recurrence_rule_id": rule.record_id,
            "occurrence_date": occurrence_str,
            "approval_status": True,
        }

    def materialize_recurrence_rule(self, user_id: str, rule: RecurrenceRule, today: "date") -> int:
        """
        Makes sure this rule's next fortnight exists as real task rows.

        Idempotent by construction: it inserts the set difference between what
        the rule wants and what is already on disk, and the UNIQUE constraint
        on (recurrence_rule_id, occurrence_date) is the backstop if two ticks
        ever overlap. Running it twice is a no-op, which matters because the
        scheduler runs it every ~2 minutes.

        Occurrences are created ALREADY APPROVED. The human approved the rule;
        a Monday-to-Friday duty producing five Inbox items a week to approve
        would make the feature unusable.
        """
        if not rule.is_active or not rule.approval_status or not rule.record_id:
            return 0

        window_start, window_end = recurrence.materialization_window(today)

        # The cheap short-circuit: one field comparison, no query. Real work
        # happens about once a day per rule, not every two minutes. Same
        # pattern as daily_summary_last_sent_date.
        already_through = recurrence.parse_date(rule.materialized_through)
        if already_through is not None and already_through >= window_end:
            return 0

        wanted = recurrence.occurrences_between(
            freq=rule.freq,
            weekdays=rule.weekdays,
            month_day=rule.month_day,
            window_start=window_start,
            window_end=window_end,
            starts_on=recurrence.parse_date(rule.starts_on) or window_start,
            ends_on=recurrence.parse_date(rule.ends_on),
        )

        existing = repository.get_occurrence_dates(
            user_id,
            rule.record_id,
            recurrence.format_date(window_start),
            recurrence.format_date(window_end),
        )

        created = 0
        for occurrence in wanted:
            if recurrence.format_date(occurrence) in existing:
                continue
            try:
                self.create_task_manual(
                    user_id, self._occurrence_fields(rule, occurrence), approval_status=True
                )
                created += 1
            except Exception as e:
                # A single day failing must not cost the rule its other
                # thirteen, and must not cost the user the rest of their tick.
                logger.error(
                    f"[recurrence] Rule {rule.record_id} failed on {occurrence}: {e}"
                )

        repository.update_recurrence_rule(
            user_id,
            rule.record_id,
            {"materialized_through": recurrence.format_date(window_end)},
        )
        return created

    def regenerate_recurrence_rule(self, user_id: str, rule: RecurrenceRule, today: "date") -> int:
        """
        Applies a changed (or paused, or resumed) rule from TOMORROW on.

        Today's occurrence is deliberately left alone: it may already be
        half-done or have rung, and it is an ordinary task the user can edit
        directly. Two other things survive: completed occurrences, and any
        occurrence the user moved by hand (due_date no longer equals
        occurrence_date) — deliberately shifting next Tuesday must not be
        undone because the rule's time changed.
        """
        if not rule.record_id:
            return 0

        today_str = recurrence.format_date(today)
        doomed = [
            row["id"]
            for row in repository.get_open_occurrences(user_id, rule.record_id)
            if (row.get("occurrence_date") or "") > today_str
            and row.get("due_date") == row.get("occurrence_date")
        ]
        repository.delete_tasks_by_ids(user_id, doomed)

        # The horizon must be recomputed from scratch, so the short-circuit is
        # cleared first — otherwise the rule would look already-materialised.
        repository.update_recurrence_rule(user_id, rule.record_id, {"materialized_through": None})
        rule.materialized_through = None
        return self.materialize_recurrence_rule(user_id, rule, today)

    def close_missed_occurrences(
        self, user_id: str, user_tasks: list[TaskRecord], today: "date", rules_by_id: dict
    ) -> int:
        """
        Stamps missed_at on occurrences that outlived their grace.

        Only recurrence occurrences forget themselves — an ordinary overdue
        task is the user's business and stays until they deal with it. An
        orphaned occurrence (its rule deleted, so ON DELETE SET NULL cleared
        the link) is an ordinary task too, and is left alone.
        """
        closed = 0
        now_iso = datetime.now(ZoneInfo("Europe/Athens")).isoformat()

        for task in user_tasks:
            if not task.recurrence_rule_id or not task.occurrence_date:
                continue
            if task.is_completed or task.is_rejected or task.missed_at or task.cancelled_at:
                continue

            rule = rules_by_id.get(task.recurrence_rule_id)
            if rule is None:
                continue

            occurrence = recurrence.parse_date(task.occurrence_date)
            if occurrence is None:
                continue

            if recurrence.is_missed(
                occurrence_date=occurrence, today=today, grace_days=rule.grace_days
            ):
                try:
                    repository.mark_task_missed(user_id, task.record_id, now_iso)
                    closed += 1
                except Exception as e:
                    logger.error(f"[recurrence] Could not close {task.record_id}: {e}")

        return closed

    def run_notification_scheduler(self) -> dict:
        """
        Loops through every registered user (repository.get_all_active_user_ids)
        and, for each, checks their master notifications toggle (skip that
        user if off), then finds and sends advance reminders for their
        tasks due within REMINDER_OFFSET_MINUTES. The send_all_enabled
        setting only matters when the master toggle is on: True reminds
        about every eligible timed task regardless of its bell state,
        False restricts reminders to tasks with notify_enabled=True. Meant
        to be triggered every ~5 minutes by an external cron service —
        because of that polling interval, a reminder may fire anywhere
        from ~10 to ~15 minutes before the task is actually due, which is
        expected slack.
        """
        all_user_ids = repository.get_all_active_user_ids()
        now = datetime.now(ZoneInfo("Europe/Athens"))
        results = []

        for user_id in all_user_ids:
            # One user's failure must not cost every other user their tick.
            # This loop had no guard at all, which was survivable only while
            # nothing inside it raised. Per-user Hostaway credentials put a
            # raise in here — a secret that cannot be decrypted (missing or
            # rotated HOSTAWAY_ENCRYPTION_KEY) took down reminders, the daily
            # summary, escalations and calendar sync for everyone processed
            # after that user, every two minutes, deterministically. The tick
            # is a batch over strangers; it fails per user or not at all.
            try:
                settings = repository.get_app_settings(user_id)
                if not settings.notifications_enabled:
                    results.append({"user_id": user_id, "status": "skipped", "reason": "notifications disabled"})
                    continue

                require_bell = not settings.send_all_enabled

                # Recurrences run BEFORE the task list is read, so an occurrence
                # generated for today is in user_tasks and can have its reminder
                # this tick rather than the next one.
                #
                # Wrapped separately from the per-user guard below: a broken rule
                # must cost this user their recurrences and nothing else. The
                # Hostaway encryption key taught this lesson at the cost of every
                # user's reminders, and the fix is cheaper applied in advance.
                recurrences_created = 0
                recurrence_rules = []
                recurrence_rules_loaded = False
                try:
                    recurrence_rules = repository.get_recurrence_rules(user_id)
                    recurrence_rules_loaded = True
                    for rule in recurrence_rules:
                        recurrences_created += self.materialize_recurrence_rule(
                            user_id, rule, now.date()
                        )
                except Exception as e:
                    # Deliberate: one broken rule aborts the remaining rules this
                    # tick rather than skipping past it and continuing.
                    logger.exception(f"[recurrence] Generation failed for user {user_id}: {e}")

                # Fetched once per user per tick, then filtered multiple ways in
                # Python — mirrors the original single-global-fetch pattern,
                # just scoped per user now instead of across everyone at once.
                user_tasks = self.repository.get_all_tasks(user_id)

                # `recurrence_rules_loaded` tells apart "the fetch failed" from
                # "the fetch found nothing": when the fetch above failed,
                # `recurrence_rules` is `[]` for the same reason a genuinely
                # rule-free account is `[]`. Running close_missed_occurrences
                # against that empty map would route every real occurrence
                # through the same "orphaned, rule deleted" branch legitimate
                # orphans take, and report recurrences_missed=0 — structurally
                # identical to "this user had nothing missed". So when the
                # fetch did not load, missed-closure is skipped rather than run
                # on data it cannot trust, and `recurrences_missed` stays `None`
                # — "not attempted" is a different fact from "attempted, found
                # nothing".
                recurrences_missed = None
                if recurrence_rules_loaded:
                    try:
                        recurrences_missed = self.close_missed_occurrences(
                            user_id,
                            user_tasks,
                            now.date(),
                            {r.record_id: r for r in recurrence_rules},
                        )
                    except Exception as e:
                        logger.exception(f"[recurrence] Missed-closure failed for {user_id}: {e}")
                else:
                    logger.warning(
                        f"[recurrence] Missed-closure skipped for user {user_id}: rules fetch failed this tick"
                    )

                window_start = now
                window_end = now + timedelta(minutes=REMINDER_OFFSET_MINUTES)

                due_tasks = repository.get_tasks_due_for_notification(
                    user_id, window_start, window_end, tasks=user_tasks, require_bell_enabled=require_bell
                )

                sent = 0
                for task in due_tasks:
                    result = self.send_push_to_user(
                        user_id,
                        title=task.task_name,
                        body=f"Σε 15 λεπτά: {task.task_name}" if not task.description else task.description,
                        view="today",
                    )
                    if result.get("sent", 0) > 0:
                        repository.mark_notification_sent(user_id, task.record_id)
                        sent += 1

                daily_summary_sent = self._maybe_send_daily_summary(user_id, now, settings, user_tasks)

                # Replies BEFORE escalations, and off the same user_tasks list:
                # a task answered two minutes ago must not be nagged about in the
                # very tick that discovers the answer.
                hostaway_replies = self._check_hostaway_replies(user_id, user_tasks)

                hostaway_result = self._check_hostaway_escalations(user_id, now, user_tasks)

                calendar_result = sync_google_calendar_for_user(user_id)

                results.append({
                    "user_id": user_id,
                    "status": "ok",
                    "checked": len(due_tasks),
                    "sent": sent,
                    "recurrences_created": recurrences_created,
                    "recurrences_missed": recurrences_missed,
                    "daily_summary_sent": daily_summary_sent,
                    "hostaway_checked": hostaway_result["checked"],
                    "hostaway_escalations_sent": hostaway_result["escalations_sent"],
                    "hostaway_conversations_polled": hostaway_replies["conversations_polled"],
                    "hostaway_replies_found": hostaway_replies["replies_found"],
                    "hostaway_tasks_completed_by_reply": hostaway_replies["tasks_completed"],
                    "calendar_sync": calendar_result,
                })
            except Exception as e:
                # Reported, not just swallowed: a tick that quietly skips a
                # user looks identical to a tick where that user had nothing
                # to do, which is how this class of bug stays invisible.
                logger.exception(f"[scheduler] User {user_id} failed this tick: {e}")
                results.append({"user_id": user_id, "status": "error", "error": str(e)})

        return {"status": "ok", "users_processed": len(all_user_ids), "results": results}

    def _check_hostaway_replies(self, user_id: str, user_tasks: list[TaskRecord]) -> dict:
        """
        Asks Hostaway what the webhook will never tell us: whether a human
        replied to the guest.

        The webhook handles incoming messages and nothing else, because
        `message.received` is the only message event Hostaway's unified
        webhooks offer (see hostaway_integration.get_conversation_messages
        for how that was established). So the TRIGGER moved here, to the
        existing ~2-minute cron; every DECISION is the same pure function
        the webhook path used, and `_handle_outgoing_hostaway_message` still
        answers a delivery if one ever arrives.

        One HTTP call per conversation, not per task: two open tasks sharing
        a conversation are answered out of one response.
        """
        connection = repository.get_hostaway_connection(user_id)
        if not connection or not connection.get("auto_close_enabled"):
            # No connection, or the user switched auto-completion off. Either
            # way this costs nothing: the check is above the task scan and
            # above every HTTP call.
            return {"conversations_polled": 0, "replies_found": 0, "tasks_completed": 0}

        credentials = hostaway_integration.credentials_from_connection(connection)

        candidates = [
            task
            for task in repository.get_active_hostaway_tasks(user_id, tasks=user_tasks)
            if task.hostaway_conversation_id
        ]
        if not candidates:
            return {"conversations_polled": 0, "replies_found": 0, "tasks_completed": 0}

        by_conversation: dict[str, list[TaskRecord]] = {}
        for task in candidates:
            by_conversation.setdefault(task.hostaway_conversation_id, []).append(task)

        ordered = sorted(
            by_conversation.items(),
            key=lambda item: max((t.hostaway_last_message_at or "") for t in item[1]),
            reverse=True,
        )
        if len(ordered) > HOSTAWAY_REPLY_POLL_LIMIT:
            logger.warning(
                f"[hostaway replies] {len(ordered)} conversations open for user {user_id}, "
                f"polling the {HOSTAWAY_REPLY_POLL_LIMIT} freshest this tick"
            )
        ordered = ordered[:HOSTAWAY_REPLY_POLL_LIMIT]

        polled = 0
        replies_found = 0
        tasks_completed = 0

        for conversation_id, conversation_tasks in ordered:
            messages = hostaway_integration.get_conversation_messages(conversation_id, credentials)
            polled += 1
            if not messages:
                continue

            answered = []
            for task in conversation_tasks:
                reply_date = hostaway_threading.find_unanswered_human_reply(
                    messages, task.hostaway_last_message_at, task.hostaway_answered_at
                )
                if reply_date:
                    answered.append((task, reply_date))

            if not answered:
                continue
            replies_found += len(answered)

            # Which of two open tasks did one reply answer? A judgement, so
            # it is not made (design §3.2). The webhook could leave both
            # untouched and just say so; a check that runs every two minutes
            # cannot — "touch nothing" would re-send that notice forever. So
            # the reply is recorded on both (the nagging stops, the notice
            # fires once) and NEITHER is completed. The user decides.
            ambiguous = len(answered) > 1
            if ambiguous:
                try:
                    self.send_push_to_user(
                        user_id,
                        title="Απάντησες στον πελάτη",
                        body=f"{len(answered)} tasks αυτής της συζήτησης είναι ακόμα ανοιχτά.",
                    )
                except Exception as e:
                    logger.error(f"[hostaway replies] Failed to send ambiguity notice: {e}")

            for task, reply_date in answered:
                updates = {"hostaway_answered_at": reply_date}
                if not ambiguous and task.priority in HOSTAWAY_REPLY_AUTOCOMPLETE_PRIORITIES:
                    updates.update(hostaway_completion_fields())

                try:
                    repository.update_hostaway_thread_fields(user_id, task.record_id, updates)
                except Exception as e:
                    logger.error(f"[hostaway replies] Failed to update task {task.record_id}: {e}")
                    continue

                # Keep the in-memory record in step with the row just
                # written: _check_hostaway_escalations runs next in this same
                # tick, off this same list, and would otherwise nag about a
                # task we just learned was answered.
                task.hostaway_answered_at = reply_date
                if updates.get("is_completed"):
                    task.is_completed = True
                    tasks_completed += 1

                outcome = (
                    "completed" if updates.get("is_completed")
                    else "left open (two tasks, one reply)" if ambiguous
                    else f"left open ({task.priority} does not auto-complete)"
                )
                logger.info(
                    f"[hostaway replies] Conversation {conversation_id}: reply at "
                    f"{reply_date} -> task {task.record_id} ({task.priority}) {outcome}"
                )

        return {
            "conversations_polled": polled,
            "replies_found": replies_found,
            "tasks_completed": tasks_completed,
        }

    def _check_hostaway_escalations(self, user_id: str, now: datetime, user_tasks: list[TaskRecord]) -> dict:
        """
        Checks all of user_id's active (not completed, not rejected)
        Hostaway-category tasks. For each, if the time since its last
        notification meets or exceeds its priority's escalation interval
        (HOSTAWAY_ESCALATION_INTERVALS), sends another notification and
        advances the timestamp. This repeats indefinitely — no cap on the
        number of re-notifications — for as long as the task remains open.
        """
        hostaway_tasks = repository.get_active_hostaway_tasks(user_id, tasks=user_tasks)

        escalations_sent = 0

        for task in hostaway_tasks:
            if task.hostaway_answered_at:
                # A human replied to this conversation. On a P1 the task
                # deliberately stays open (replying is not fixing — see the
                # threading design §3.2), but it must stop nagging.
                continue

            if not task.hostaway_last_notified_at:
                continue  # missing tracking field (e.g. task created before this feature existed)

            try:
                last_notified = datetime.fromisoformat(task.hostaway_last_notified_at)
            except (ValueError, TypeError):
                continue

            interval = HOSTAWAY_ESCALATION_INTERVALS.get(task.priority, timedelta(hours=2))

            if now - last_notified >= interval:
                try:
                    self.send_push_to_user(
                        user_id,
                        title=f"⏰ {task.task_name}",
                        body="Ακόμα δεν έχει απαντηθεί.",
                    )
                    repository.update_hostaway_last_notified(user_id, task.record_id, now.isoformat())
                    escalations_sent += 1
                except Exception as e:
                    logger.error(f"[hostaway escalation] Failed to send for task {task.record_id}: {e}")

        return {"checked": len(hostaway_tasks), "escalations_sent": escalations_sent}

    def _maybe_send_daily_summary(self, user_id: str, now: datetime, settings, user_tasks: list[TaskRecord]) -> bool:
        """
        Sends user_id's once-a-day task summary if enabled and not already
        sent today. The ONLY guard against repeat-firing is the date
        comparison against daily_summary_last_sent_date — there is
        deliberately no upper-bound time window (unlike the per-task
        reminder's window): whichever cron tick first satisfies "now >=
        target time" fires it, and every later tick that same day sees the
        date already recorded and skips. The guard resets naturally at
        midnight.
        """
        today_str = now.strftime("%Y-%m-%d")
        if not settings.daily_summary_enabled or settings.daily_summary_last_sent_date == today_str:
            return False

        should_send_now = False

        if settings.daily_summary_mode == "fixed_time":
            time_str = settings.daily_summary_time or "08:00"
            target_hour, target_minute = map(int, time_str.split(":"))
            target_datetime = now.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)
            if now >= target_datetime:
                should_send_now = True

        elif settings.daily_summary_mode == "before_first_task":
            first_task_time = repository.get_first_task_datetime_today(user_id, today_str, tasks=user_tasks)
            if first_task_time is not None:
                first_task_time = first_task_time.replace(tzinfo=now.tzinfo)
                target_datetime = first_task_time - timedelta(minutes=DAILY_SUMMARY_BEFORE_FIRST_TASK_OFFSET_MINUTES)
                if now >= target_datetime:
                    should_send_now = True

        if not should_send_now:
            return False

        todays_tasks = repository.get_tasks_for_date(user_id, today_str, tasks=user_tasks)
        summary_body = _format_daily_summary(todays_tasks)
        result = self.send_push_to_user(user_id, title="Το πρόγραμμα της ημέρας", body=summary_body, view="today")
        if result.get("sent", 0) > 0:
            repository.update_daily_summary_last_sent_date(user_id, today_str)
            return True
        return False


def _format_daily_summary(tasks: list[TaskRecord]) -> str:
    """
    Builds a plain-text summary of today's tasks for the push notification
    body. Push notifications can only show plain text, not interactive
    checkboxes — this is a hard platform limitation, not a design choice.
    """
    if not tasks:
        return "Δεν έχεις καμία εργασία σήμερα."

    lines = []
    for t in sorted(tasks, key=lambda x: x.due_time or "99:99"):
        if t.due_time:
            lines.append(f"{t.due_time} — {t.task_name}")
        else:
            lines.append(t.task_name)

    count = len(tasks)
    header = f"Έχεις {count} {'εργασία' if count == 1 else 'εργασίες'} σήμερα:"
    return header + "\n" + "\n".join(lines)