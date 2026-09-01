from datetime import datetime
from pydantic import BaseModel, Field, field_validator, model_validator
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
    Schema 2 — What is stored in the database (Supabase).
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

    # Recurrence (2026-08-15). recurrence_rule_id is which rule produced this
    # row; occurrence_date is WHICH occurrence it is and never changes, even
    # when the user drags the task to another day — see DATABASE_SCHEMA.md for
    # why keying on due_date instead would duplicate a task on every reschedule.
    # missed_at is set when an occurrence outlived its grace and closed itself.
    recurrence_rule_id: Optional[str] = None
    occurrence_date: Optional[str] = None
    missed_at: Optional[str] = None
    # Set when the user deleted THIS occurrence. Deliberately not is_rejected
    # (that means "rejected the AI's suggestion" and feeds the learning loop)
    # and deliberately not missed_at (that means the day passed unfinished).
    # The row survives so the generator, which skips any occurrence_date that
    # already exists, does not recreate the task on the next tick.
    cancelled_at: Optional[str] = None

    # Workspaces (2026-09-01). Both nullable and both ON DELETE SET NULL in the
    # database: deleting a container must never delete work, so a task whose
    # workspace or category is removed becomes unfiled rather than vanishing.
    # `category` (the old TEXT column) is still the live one throughout Slice 1
    # and is dropped only by migration Part B.
    workspace_id: Optional[str] = None
    category_id: Optional[str] = None


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
    # NULL means "Όλα" — every workspace at once, and the default for a user
    # who has never touched the switcher.
    active_workspace_id: Optional[str] = None
    # Which workspace the EXTRACTOR speaks for when active_workspace_id is NULL
    # ("Όλα"). Deliberately a SECOND column: "where am I looking" and "whose
    # vocabulary should the model be given" are different questions, and the
    # model must never be asked to guess between several workspaces.
    default_workspace_id: Optional[str] = None


class Workspace(BaseModel):
    """
    A top-level container the user creates and names. Categories live inside it;
    tasks point at it.

    `user_id` is not a field here, the same ownership-is-a-data-layer-concern
    rule TaskRecord follows — the repository scopes every query and never
    surfaces the owner to the API.
    """
    record_id: Optional[str] = None
    name: str = Field(max_length=40)
    color: Optional[str] = None
    position: int = 0
    created_at: Optional[str] = None


class Category(BaseModel):
    """
    A user-named grouping inside one workspace.

    `system_key` is NULL for everything the user creates and 'hostaway' on
    exactly one row per account. That row is fed by the integration, cannot be
    renamed or deleted, and is what the escalation query keys on — see
    repository.get_active_hostaway_tasks.
    """
    record_id: Optional[str] = None
    workspace_id: str
    name: str = Field(max_length=40)
    color: Optional[str] = None
    position: int = 0
    system_key: Optional[str] = None
    created_at: Optional[str] = None


class RecurrenceRule(BaseModel):
    """
    A standing commitment: this task, on these days, until further notice.

    The occurrences it produces are ORDINARY TaskRecords — that is the whole
    design. See docs/superpowers/specs/2026-08-15-recurring-tasks-design.md.
    """
    record_id: Optional[str] = None

    # The template copied into every occurrence.
    task_name: str = Field(max_length=80)
    description: str = ""
    # Hostaway is deliberately absent: that category is owned by the
    # integration and its escalation intervals, and a hand-made recurrence
    # must not be able to enter it.
    category: Literal["Business", "Personal", "Unknown"] = "Unknown"
    priority: Literal["P1", "P2", "P3"] = "P3"
    due_time: Optional[str] = None
    checklist: list[ChecklistItem] = Field(default_factory=list)

    # The rule. weekdays is ISO: 1 = Monday .. 7 = Sunday.
    freq: Literal["weekly", "monthly"]
    weekdays: Optional[list[int]] = None
    # -1 means "the last day of the month" — a different request from "the
    # 31st", which clamps to the last day only in months that are shorter.
    month_day: Optional[int] = None

    starts_on: str
    ends_on: Optional[str] = None
    is_active: bool = True
    approval_status: bool = True

    notify_enabled: bool = False
    calendar_sync_enabled: bool = False

    grace_days: int = 1
    materialized_through: Optional[str] = None
    created_at: Optional[str] = None

    # Workspaces (2026-09-01). Added here so the columns exist end-to-end, but
    # nothing writes them until Slice 4 — the `category` field above is still
    # what a rule copies into each occurrence.
    workspace_id: Optional[str] = None
    category_id: Optional[str] = None

    @field_validator("starts_on", "ends_on")
    @classmethod
    def validate_dates(cls, v):
        if v is None:
            return v
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("dates must be YYYY-MM-DD")
        return v

    @field_validator("due_time")
    @classmethod
    def validate_due_time(cls, v):
        if v is None:
            return v
        try:
            datetime.strptime(v, "%H:%M")
        except ValueError:
            raise ValueError("due_time must be HH:MM 24-hour format")
        return v

    @model_validator(mode="after")
    def validate_shape(self):
        """
        Mirrors the recurrence_rules_shape CHECK constraint. Both exist on
        purpose: the database is the guarantee, this is the error message.
        """
        if self.freq == "weekly":
            if not self.weekdays:
                raise ValueError("a weekly rule needs at least one weekday")
            if any(d < 1 or d > 7 for d in self.weekdays):
                raise ValueError("weekdays are ISO 1 (Monday) to 7 (Sunday)")
        else:
            if self.month_day is None:
                raise ValueError("a monthly rule needs a month_day")
            if self.month_day != -1 and not (1 <= self.month_day <= 31):
                raise ValueError("month_day must be 1-31, or -1 for the last day")
        return self