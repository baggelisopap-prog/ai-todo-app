import base64
import json
import logging
import os
import tempfile
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo
from pywebpush import webpush, WebPushException
from models import SingleTask, TaskList, TaskRecord
from ai_engine import extract_tasks, extract_tasks_from_audio, extract_tasks_from_image
from repository import AirtableTaskRepository
import repository

logger = logging.getLogger(__name__)

VAPID_CONTACT_EMAIL = os.getenv("VAPID_CONTACT_EMAIL", "baggelisopap@gmail.com")

# How far ahead of a task's due time to send the advance reminder.
REMINDER_OFFSET_MINUTES = 15

# How far ahead of the day's first timed task to send the daily summary,
# and the fixed fallback send time when no timed tasks exist that day.
DAILY_SUMMARY_LEAD_MINUTES = 15
DAILY_SUMMARY_FALLBACK_TIME = "08:00"

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

    def extract_and_save(self, raw_input: str) -> list[TaskRecord]:
        """
        Main business operation. 
        Extracts tasks from raw text via AI, converts them to records, and saves them to the DB.
        Returns a list of successfully saved TaskRecords.
        """
        logger.info("Processing input for extraction and save...")
        
        # 1. AI Extraction
        task_list = extract_tasks(raw_input)
        
        if not task_list:
            raise RuntimeError("AI extraction failed to produce valid tasks.")
            
        saved_tasks = []
        
        # 2. Conversion and Saving
        for task in task_list.items:
            task_record = self._single_task_to_record(task)
            
            try:
                saved_task = self.repository.save_task(task_record)
                saved_tasks.append(saved_task)
            except Exception as e:
                # Log individual failures but continue processing the rest
                logger.error(f"Failed to save task '{task.task_name}' to database: {e}")
                
        # 3. Final Validation
        if not saved_tasks and len(task_list.items) > 0:
            raise RuntimeError("All extracted tasks failed to save to the database.")
            
        logger.info(f"Successfully saved {len(saved_tasks)} tasks to database.")
        return saved_tasks

    def extract_and_save_from_audio(self, audio_bytes: bytes, mime_type: str) -> list[TaskRecord]:
        """
        Extracts tasks from an audio recording via AI and saves them to the database.
        Mirrors extract_and_save exactly — only the AI call differs.
        """
        logger.info("Processing audio input for extraction and save...")

        # 1. AI Extraction
        task_list = extract_tasks_from_audio(audio_bytes, mime_type)

        if not task_list:
            raise RuntimeError("AI extraction failed to produce valid tasks from audio.")

        saved_tasks = []

        # 2. Conversion and Saving
        for task in task_list.items:
            task_record = self._single_task_to_record(task)

            try:
                saved_task = self.repository.save_task(task_record)
                saved_tasks.append(saved_task)
            except Exception as e:
                logger.error(f"Failed to save task '{task.task_name}' to database: {e}")

        # 3. Final Validation
        if not saved_tasks and len(task_list.items) > 0:
            raise RuntimeError("All extracted tasks failed to save to the database.")

        logger.info(f"Successfully saved {len(saved_tasks)} tasks from audio to database.")
        return saved_tasks

    def extract_and_save_from_image(self, image_bytes: bytes, mime_type: str) -> list[TaskRecord]:
        """
        Extracts tasks from an image via AI and saves them to the database.
        Mirrors extract_and_save exactly — only the AI call differs.
        """
        logger.info("Processing image input for extraction and save...")

        # 1. AI Extraction
        task_list = extract_tasks_from_image(image_bytes, mime_type)

        if not task_list:
            raise RuntimeError("AI extraction failed to produce valid tasks from image.")

        saved_tasks = []

        # 2. Conversion and Saving
        for task in task_list.items:
            task_record = self._single_task_to_record(task)

            try:
                saved_task = self.repository.save_task(task_record)
                saved_tasks.append(saved_task)
            except Exception as e:
                logger.error(f"Failed to save task '{task.task_name}' to database: {e}")

        # 3. Final Validation
        if not saved_tasks and len(task_list.items) > 0:
            raise RuntimeError("All extracted tasks failed to save to the database.")

        logger.info(f"Successfully saved {len(saved_tasks)} tasks from image to database.")
        return saved_tasks

    def create_task_manual(self, fields: dict) -> TaskRecord:
        """
        Manually create a task. Fills in AI-suggested fields as duplicates
        of user's choices (since there's no AI here) and sets defaults for
        approval flags.
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
            approval_status=True,  # Manual = pre-approved
            is_completed=False,
            is_rejected=False,
            ai_suggested_category=fields.get("category", "Unknown"),
            ai_suggested_priority=fields.get("priority", "P3"),
            record_id=None,
            created_time=None,
        )
        return self.repository.save_task(task)

    def get_all_tasks(self) -> list[TaskRecord]:
        """
        Retrieves all tasks from the database.
        """
        return self.repository.get_all_tasks()

    def update_task(self, record_id: str, updates: dict) -> TaskRecord:
        """
        Updates an existing task in the database.
        """
        return self.repository.update_task(record_id, updates)

    def delete_task(self, record_id: str) -> None:
        """
        Permanently deletes a task. No return value — raises on failure.
        """
        success = self.repository.delete_task(record_id)
        if not success:
            raise RuntimeError(f"Failed to delete task {record_id}")
        logger.info(f"Deleted task {record_id}.")

    def send_push_to_all(self, title: str, body: str) -> dict:
        """
        Sends a push notification to every stored subscription.
        Cleans up subscriptions that the push service reports as gone
        (404/410 — meaning the browser unsubscribed or the installation
        was removed).
        """
        subscriptions = repository.list_push_subscriptions()
        sent = 0
        failed = 0

        vapid_key_file = _get_vapid_key_file()

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
                    data=json.dumps({"title": title, "body": body}),
                    vapid_private_key=vapid_key_file,
                    vapid_claims={"sub": f"mailto:{VAPID_CONTACT_EMAIL}"},
                )
                sent += 1
            except WebPushException as e:
                failed += 1
                status_code = getattr(e.response, "status_code", None)
                if status_code in (404, 410):
                    repository.delete_push_subscription(sub.endpoint)
                logger.error(f"Push failed for {sub.endpoint[:50]}...: {e}")
            except Exception as e:
                # Covers errors raised before a request is even made (e.g.
                # py_vapid.VapidException for a malformed/blank endpoint),
                # which aren't WebPushException subclasses. One bad
                # subscription must not abort the rest of the batch.
                failed += 1
                logger.error(f"Push failed for {sub.endpoint[:50]}...: {e}")

        return {"sent": sent, "failed": failed, "total": len(subscriptions)}

    def run_notification_scheduler(self) -> dict:
        """
        Checks the master notifications toggle (skip everything if off),
        then finds and sends advance reminders for tasks due within
        REMINDER_OFFSET_MINUTES. The send_all_enabled setting only matters
        when the master toggle is on: True reminds about every eligible
        timed task regardless of its bell state, False restricts reminders
        to tasks with notify_enabled=True. Meant to be triggered every ~5
        minutes by an external cron service — because of that polling
        interval, a reminder may fire anywhere from ~10 to ~15 minutes
        before the task is actually due, which is expected slack.
        """
        settings = repository.get_app_settings()
        if not settings.notifications_enabled:
            return {"status": "skipped", "reason": "notifications disabled"}

        require_bell = not settings.send_all_enabled

        now = datetime.now(ZoneInfo("Europe/Athens"))
        all_tasks = repository.get_all_tasks_for_scheduler()

        window_start = now
        window_end = now + timedelta(minutes=REMINDER_OFFSET_MINUTES)

        due_tasks = repository.get_tasks_due_for_notification(
            window_start, window_end, tasks=all_tasks, require_bell_enabled=require_bell
        )

        sent = 0
        for task in due_tasks:
            result = self.send_push_to_all(
                title=task.task_name,
                body=f"Σε 15 λεπτά: {task.task_name}" if not task.description else task.description,
            )
            if result.get("sent", 0) > 0:
                repository.mark_notification_sent(task.record_id)
                sent += 1

        daily_summary_result = self._maybe_send_daily_summary(now, settings, all_tasks)

        return {
            "status": "ok",
            "checked": len(due_tasks),
            "sent": sent,
            "daily_summary": daily_summary_result,
        }

    def _maybe_send_daily_summary(self, now: datetime, settings, all_tasks: list[TaskRecord]) -> dict:
        """
        Sends the once-a-day task summary if it hasn't already gone out
        today. Fires DAILY_SUMMARY_LEAD_MINUTES before the earliest timed
        task due today, or at DAILY_SUMMARY_FALLBACK_TIME if no timed
        tasks exist today.
        """
        today_str = now.strftime("%Y-%m-%d")
        if settings.last_summary_sent_date == today_str:
            return {"status": "already_sent"}

        tasks = repository.get_tasks_for_daily_summary(today_str, tasks=all_tasks)

        todays_timed = [t for t in tasks if t.due_date == today_str and t.due_time]
        if todays_timed:
            earliest = min(datetime.strptime(t.due_time, "%H:%M").time() for t in todays_timed)
            target = now.replace(hour=earliest.hour, minute=earliest.minute, second=0, microsecond=0)
            target -= timedelta(minutes=DAILY_SUMMARY_LEAD_MINUTES)
        else:
            fallback = datetime.strptime(DAILY_SUMMARY_FALLBACK_TIME, "%H:%M").time()
            target = now.replace(hour=fallback.hour, minute=fallback.minute, second=0, microsecond=0)

        if now < target:
            return {"status": "not_yet"}

        title, body = _format_daily_summary(tasks, today_str)
        result = self.send_push_to_all(title=title, body=body)
        if result.get("sent", 0) > 0:
            repository.mark_daily_summary_sent(today_str)
            return {"status": "sent", "task_count": len(tasks)}
        return {"status": "send_failed", "task_count": len(tasks)}


def _format_daily_summary(tasks: list[TaskRecord], today_str: str) -> tuple[str, str]:
    """Builds the (title, body) for the daily summary push from today's + overdue tasks."""
    if not tasks:
        return "Καθημερινή σύνοψη", "Δεν έχεις εργασίες σήμερα 🎉"

    lines = []
    for t in tasks:
        prefix = "⚠️ " if t.due_date < today_str else ""
        time_suffix = f" ({t.due_time})" if t.due_time else ""
        lines.append(f"• {prefix}{t.task_name}{time_suffix}")

    title = f"Οι εργασίες σου σήμερα ({len(tasks)})"
    body = "\n".join(lines)
    return title, body