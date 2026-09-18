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
    # What the model ANSWERS with for the workspace — a NAME, and ONLY asked for
    # when the user was on "Όλα" so we genuinely do not know it. Standing in a
    # workspace, the model is never asked, and anything it says here is ignored.
    workspace_name: Optional[str] = None
    # What the model ANSWERS with for the user's own categories — a NAME, never
    # an id, because models truncate and invent UUIDs.
    # services.resolve_category_name turns it into tasks.category_id, and an
    # unrecognised name becomes None. Not a database column: TaskRecord carries
    # category_id instead.
    category_name: Optional[str] = None

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

    # WHEN THIS TASK WAS CREATED, surfaced 2026-09-04 for Browse's History tab.
    #
    # created_time above was the Airtable-era field and NOTHING WRITES IT: it is
    # popped from both the insert and the update path, and unlike created_at it
    # carries no database default. The frontend has been sorting Browse by it
    # ("Νεότερα"/"Παλαιότερα") the whole time, which is why that sort has had
    # nothing to sort on. created_at is the real one — `TIMESTAMPTZ default
    # now()`, filled by the database on every row.
    #
    # Read-only, exactly like created_time: popped in _task_to_supabase_fields
    # and in update_task so it can never be written or overwritten from here.
    created_at: Optional[str] = None

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

    # Soft delete (2026-09-04). Set when the user deleted an ORDINARY task. The
    # row survives so Browse's History tab can show what was deleted and when,
    # and so Restore can simply clear this column again.
    #
    # cancelled_at stays a separate column even though it carries the same user
    # intent for a recurrence occurrence: that one exists for a MECHANICAL
    # reason (the generator recreates a hard-deleted occurrence_date within two
    # minutes), which is not true of an ordinary task. One column answering
    # "why is this row still here" two different ways is how a schema starts
    # lying. Both read as "Διαγράφηκε" in the UI, because to the person who
    # pressed Delete they are the same act.
    deleted_at: Optional[str] = None

    # Workspaces (2026-09-01). Both nullable and both ON DELETE SET NULL in the
    # database: deleting a container must never delete work, so a task whose
    # workspace or category is removed becomes unfiled rather than vanishing.
    # `category` (the old TEXT column) is still the live one throughout Slice 1
    # and is dropped only by migration Part B.
    workspace_id: Optional[str] = None
    category_id: Optional[str] = None

    # Multi-user (2026-09-11). WHO IS RESPONSIBLE, as distinct from the
    # database's user_id column, which keeps its meaning — "who created this
    # row" — and every one of its existing uses. Sharing adds a second axis; it
    # does not redefine the first. (user_id is deliberately absent from this
    # model, the same ownership-is-a-data-layer-concern rule Workspace follows.)
    #
    # NULL means nobody has taken it, which is a REAL state and not an unset
    # one: an unassigned task in a shared workspace is visible to every member
    # and is in nobody's day view but its creator's, because until somebody
    # takes it, it is not anybody's work.
    #
    # ON DELETE SET NULL in the database, like workspace_id and category_id:
    # deleting a person must never delete work.
    assigned_to: Optional[str] = None

    # WHO CREATED IT — the `user_id` column, under a name that says what it
    # means to a reader rather than what it does to a query.
    #
    # It is surfaced, and the rule above is not broken by that. `user_id` stays
    # a scoping concern: no caller passes it, no write accepts it, and the
    # repository still scopes every query itself. What this adds is one READ,
    # for the one consumer that cannot work without it — a shared list being
    # narrowed to "mine", which must mean exactly what the reminder loop and
    # the agent mean by it: assigned to me, OR created by me and taken by
    # nobody. Read-only and never written: _task_to_supabase_fields drops it
    # for the same reason it drops created_at.
    created_by: Optional[str] = None

    # WHEN IT WAS CLOSED. The column has existed since 2026-08-13; this model
    # field was added on 2026-09-17, and its absence was a live bug rather than
    # a deliberate omission. utils/taskHistory.js has read `task.completed_at`
    # since 2026-09-04 both to place a finished task on the History timeline and
    # to decide whether that date is exact — and response_model=TaskRecord was
    # quietly stripping it, so every completed task fell to the fallback branch
    # and was dated by its CREATION time under the flag that means "completed
    # before this column existed". Nothing raised; the dates were merely wrong.
    #
    completed_at: Optional[str] = None

    # WHAT KIND OF THING CLOSED IT — "ui" / "agent" / "hostaway_reply". Same
    # column since 2026-08-13, same omission, same screen: HistoryList renders
    # «Ολοκληρώθηκε 14 Σεπ 14:32 · από το AI» by looking this up, and the lookup
    # has been undefined on every row since it was written, so the suffix has
    # never appeared once.
    #
    # It is NOT made redundant by completed_by below. This says what channel the
    # write came through; that says which person. A task closed by the Hostaway
    # poller has a source and no person, which is exactly the distinction the
    # forensic question needed.
    completed_source: Optional[str] = None

    # Handover (2026-09-17). WHO CLOSED IT, as distinct from completed_source,
    # which says what KIND of thing did — ui / agent / hostaway_reply. The
    # source was enough while a task had one person; in a shared room the
    # question people ask is "who closed MY task", and nothing could answer it.
    #
    # NULL means no human pressed anything: the Hostaway reply poller closes a
    # task through its own repository call, and a missed occurrence closes
    # itself. It is also what every task completed before this column existed
    # carries — which is precisely why NULL has to mean "hand this back to
    # nobody", or several hundred finished tasks would reappear on a list.
    completed_by: Optional[str] = None

    # WHO HAS SINCE PRESSED OK on that completion. A task closed by somebody
    # else stays on the other party's list, struck through, until they
    # acknowledge it — the parties being the creator and the assignee, minus
    # whoever did the closing.
    #
    # A list rather than a boolean because there can be two of them: I create a
    # task, hand it to Maria, Nikos closes it, and both Maria and I are owed the
    # news independently. One flag would let whoever read it first clear it for
    # the other — the same shape as tasks.notification_sent, whose single
    # boolean is documented in repository.get_all_tasks as one of the three ways
    # reminders broke when sharing arrived.
    completion_seen_by: list[str] = Field(default_factory=list)


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

    # Archiving replaces deletion (2026-09-11), on the owner's rule that work
    # is never lost. NULL means live.
    #
    # Deleting a workspace already preserved its TASKS — ON DELETE SET NULL,
    # decided 2026-09-01. What it destroyed was everything that made them
    # findable: which workspace, which category, and, once visibility comes
    # from membership, WHO CAN SEE THEM. A colleague keeps what she wrote and
    # loses what was assigned to her, while still being the person who has to
    # do it.
    archived_at: Optional[str] = None

    # How many people are in this room, INCLUDING the owner. Never 0: creating
    # a workspace adds the owner's own membership row.
    #
    # It exists so a screen can tell a shared workspace from a solo one WITHOUT
    # asking per workspace. Everything the list shows about other people — the
    # assignee badge on a row, the "Δικά μου / Όλα" filter — must be absent on a
    # solo account, and finding that out by calling /members once per workspace
    # would be one request per workspace on every app open.
    #
    # ONLY get_workspaces fills this truthfully; it is the screen's read. The
    # other paths (create, update, get_owned_workspaces) leave the default,
    # which is correct for a workspace just created and merely stale for the
    # others — and the frontend re-reads through get_workspaces after every
    # write, so nothing displays the stale value.
    member_count: int = 1


class WorkspaceMember(BaseModel):
    """
    One person's membership of one workspace — the answer to "who may SEE
    this".

    That is a DIFFERENT question from the one `workspaces.user_id` answers,
    which is "who may ADMINISTER this" — rename, archive, invite, remove
    people, delete tasks. The owner appears in both and nothing else is
    derived twice, which is why repository.is_workspace_owner asks the
    `workspaces` table and never the `role` field here. `role` exists so that
    "who is in this room" has one answer in one table.

    `notify_all` is per-workspace on purpose: an owner may want the cleaning
    team's reminders and not the office's. It defaults to false because a
    switch that is on by default makes every shared workspace noisy on the day
    it is created.
    """
    record_id: Optional[str] = None
    workspace_id: str
    user_id: str
    role: Literal["owner", "member"] = "member"
    notify_all: bool = False
    joined_at: Optional[str] = None


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