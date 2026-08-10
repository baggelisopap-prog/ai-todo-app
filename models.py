from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from typing import Optional, Literal


class ChecklistItem(BaseModel):
    text: str
    done: bool = False


class SingleTask(BaseModel):
    """
    Schema 1 — What the AI produces from natural language.
    Does not include application state or database metadata.
    """
    task_name: str = Field(max_length=80)
    description: str
    category: Literal["Business", "Personal", "Unknown", "Hostaway"]
    priority: Literal["P1", "P2", "P3"]
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    checklist: list[ChecklistItem] = Field(
        default_factory=list,
        description="List of checklist items. Each item is an object with 'text' (the item description) and 'done' (whether completed, defaults to false). AI should always set done=false for new tasks.",
    )

    @field_validator("due_date")
    @classmethod
    def validate_due_date(cls, v):
        if v is None:
            return v
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("due_date must be a valid date in YYYY-MM-DD format")
        return v

    @field_validator("due_time")
    @classmethod
    def validate_due_time(cls, v):
        if v is None:
            return v
        try:
            datetime.strptime(v, "%H:%M")
        except ValueError:
            raise ValueError("due_time must be a valid time in HH:MM 24-hour format")
        return v


class TaskList(BaseModel):
    """
    Wrapper for multiple SingleTasks.
    Used when the AI extracts several tasks from a single natural language input.
    """
    items: list[SingleTask]


class TaskRecord(SingleTask):
    """
    Schema 2 — What is stored in the database (Airtable).
    Inherits from SingleTask and adds application state, AI snapshots, and database metadata.
    """
    approval_status: bool = False
    is_completed: bool = False
    is_rejected: bool = False
    notify_enabled: bool = False
    notification_sent: bool = False
    calendar_sync_enabled: bool = False

    # Frozen snapshots of the original AI output, kept for the future learning loop.
    # These must never change after creation to preserve the original AI intent.
    ai_suggested_category: Literal["Business", "Personal", "Unknown", "Hostaway"] = Field(frozen=True)
    ai_suggested_priority: Literal["P1", "P2", "P3"] = Field(frozen=True)
    
    record_id: Optional[str] = None
    created_time: Optional[str] = None

    # Hostaway escalation tracking (only set on category="Hostaway" tasks).
    # hostaway_last_notified_at advances every time an escalation notification
    # fires, so "time since last notification" can be compared against the
    # priority's interval on each scheduler tick.
    hostaway_created_at: Optional[str] = None
    hostaway_last_notified_at: Optional[str] = None

    # Hostaway message threading (2026-08-10). hostaway_last_message_at holds
    # HOSTAWAY's message date, never a server clock read — that is what makes
    # the 90-second burst window independent of when the webhook reached us.
    # hostaway_thread accumulates the raw guest messages so the whole thread
    # can be re-classified; hostaway_answered_at marks a P1 that was replied
    # to (escalation stops, the task deliberately stays open).
    hostaway_conversation_id: Optional[str] = None
    hostaway_last_message_at: Optional[str] = None
    hostaway_message_count: int = 0
    hostaway_answered_at: Optional[str] = None
    hostaway_thread: Optional[str] = None


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys


class PushSubscriptionRecord(BaseModel):
    record_id: Optional[str] = None
    endpoint: str
    p256dh: str
    auth: str


class AppSettings(BaseModel):
    notifications_enabled: bool = True
    send_all_enabled: bool = True
    daily_summary_enabled: bool = False
    daily_summary_mode: str = "fixed_time"
    daily_summary_time: str = "08:00"
    daily_summary_last_sent_date: str = ""
    calendar_sync_all_enabled: bool = False
    calendar_show_events: bool = True