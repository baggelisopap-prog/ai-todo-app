"""
FastAPI HTTP layer for the AI To-Do App.

Design decisions:
- Each endpoint is a thin wrapper around TaskService. Business logic stays in services.py.
- Request/response schemas are defined here (not in models.py) because they're 
  HTTP-specific concerns, not data-layer concerns.
- HTTP status codes follow REST conventions: 200 for read/update, 201 for create, 
  422 for validation, 503 for downstream failures, 500 for unexpected errors.
- CORS is configured with explicit origins (not allow_all) for security.
- exclude_unset=True in PATCH ensures partial updates don't overwrite fields with None.

Run with: uvicorn main:app --reload
Interactive docs: http://localhost:8000/docs
"""

import logging
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import FastAPI, HTTPException, Request, status, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Literal
from models import ChecklistItem, TaskRecord, PushSubscriptionRequest, AppSettings, RecurrenceRule
from services import TaskService
import services  # for HOSTAWAY_REPLY_AUTOCOMPLETE_PRIORITIES — one policy, both reply paths
from repository import save_push_subscription, get_app_settings, update_app_settings
from auth import get_current_user_id
import agent_engine
import agent_tools
import task_agent
import crypto
import google_calendar
import hostaway_integration
import hostaway_threading
import repository
import token_tracker
import os
from dotenv import load_dotenv

load_dotenv()
# Request/Response Schemas
class ExtractRequest(BaseModel):
    """Request body for POST /extract"""
    text: str

class ExtractResponse(BaseModel):
    """Response body for POST /extract"""
    saved_tasks: list[TaskRecord]
    count: int

class TasksListResponse(BaseModel):
    """Response body for GET /tasks"""
    tasks: list[TaskRecord]
    count: int

class UpdateTaskRequest(BaseModel):
    """Request body for PATCH /tasks/{record_id}"""
    approval_status: Optional[bool] = None
    is_completed: Optional[bool] = None
    is_rejected: Optional[bool] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    task_name: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    checklist: Optional[list[ChecklistItem]] = None
    notify_enabled: Optional[bool] = None
    calendar_sync_enabled: Optional[bool] = None

class CreateTaskRequest(BaseModel):
    """Request body for manual task creation via POST /tasks"""
    task_name: str
    description: str = ""
    category: str = "Unknown"
    priority: str = "P3"
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    checklist: Optional[list[ChecklistItem]] = None

class RecurrenceCreateRequest(BaseModel):
    """Request body for POST /recurrences. Mirrors RecurrenceRule minus the
    server-owned fields (record_id, materialized_through, created_at)."""
    task_name: str
    description: str = ""
    category: str = "Unknown"
    priority: str = "P3"
    due_time: Optional[str] = None
    checklist: Optional[list[ChecklistItem]] = None
    freq: str
    weekdays: Optional[list[int]] = None
    month_day: Optional[int] = None
    starts_on: str
    ends_on: Optional[str] = None
    notify_enabled: bool = False
    calendar_sync_enabled: bool = False


class RecurrenceUpdateRequest(BaseModel):
    """Request body for PATCH /recurrences/{id}. Every field optional; only the
    ones actually sent are written."""
    task_name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    due_time: Optional[str] = None
    checklist: Optional[list[ChecklistItem]] = None
    freq: Optional[str] = None
    weekdays: Optional[list[int]] = None
    month_day: Optional[int] = None
    starts_on: Optional[str] = None
    ends_on: Optional[str] = None
    is_active: Optional[bool] = None
    approval_status: Optional[bool] = None
    notify_enabled: Optional[bool] = None
    calendar_sync_enabled: Optional[bool] = None


class RecurrencesListResponse(BaseModel):
    recurrences: list[RecurrenceRule]
    count: int


class RecurrenceWriteResponse(BaseModel):
    recurrence: RecurrenceRule
    occurrences_created: int


class RecurrenceDeleteResponse(BaseModel):
    deleted: bool
    occurrences_removed: int

class HealthResponse(BaseModel):
    status: str
    service: str

class CalendarConnectRequest(BaseModel):
    """Request body for POST /calendar/connect"""
    access_token: str
    refresh_token: str

class ProfileUpdateRequest(BaseModel):
    """Request body for PATCH /profile"""
    display_name: str

class DeleteTaskResponse(BaseModel):
    """
    Response body for DELETE /tasks/{record_id}. The task is always deleted;
    this reports what happened to its linked Google Calendar event, which the
    old 204 No Content could not say:
      none               — no linked event
      deleted            — the app created that event, so it was removed too
      kept_google_origin — the event was created in Google Calendar first, so
                           it stays; the app does not own it
      delete_failed      — the app owned the event but Google refused
    """
    calendar: Literal["none", "deleted", "kept_google_origin", "delete_failed"]

class TaskAgentEditRequest(BaseModel):
    """Request body for POST /tasks/{record_id}/agent-edit"""
    instruction: str

class TaskAgentEditResponse(BaseModel):
    """
    Response body for POST /tasks/{record_id}/agent-edit — a validated PLAN,
    not a result. Nothing has been written when this is returned; the client
    applies it through the ordinary PATCH/DELETE endpoints (see the endpoint's
    docstring for why the write does not happen here).

    action:
      edit    — apply `fields`; `before` is the matching Undo payload
      delete  — the user asked to remove the task; the client must confirm,
                then call DELETE /tasks/{id}. Never applied without a
                confirmation, because the delete is permanent.
      unclear — nothing to apply; `message` says what is missing
      none    — understood, but it changes nothing that is not already true
    """
    action: Literal["edit", "delete", "unclear", "none"]
    message: str
    fields: dict = {}
    before: dict = {}
    # Fields the agent asked for that were dropped as invalid or impossible
    # (a malformed date, a reminder on a task with no time). The rest of the
    # instruction is still applied — one bad value must not discard the
    # good ones — so the client tells the user which parts did not take.
    invalid: list[str] = []

class AgentQueryRequest(BaseModel):
    """Request body for POST /agent/query"""
    question: str
    conversation_id: Optional[str] = None

class ProposedAction(BaseModel):
    """
    One agent-proposed write, as recorded by agent_tools.py's propose_*
    tools. Purely descriptive for the frontend to render as a confirmation
    card — /agent/confirm-action re-validates everything from scratch and
    never trusts that a client-echoed action is still accurate.
    """
    action_id: str
    type: Literal["complete_task", "update_task", "create_task"]
    record_id: Optional[str] = None
    task_name: Optional[str] = None
    fields: Optional[dict] = None

class AgentSearch(BaseModel):
    """
    One search_tasks call the agent made while answering, with the filters it
    chose. Shown to the user under the answer: the agent has been observed
    narrowing a search with a category or date the user never mentioned and
    then reporting "you have none" over it. Only the user knows what they
    meant, so the filters are theirs to see.
    """
    filters: dict = {}
    total_matches: int = 0

class AgentQueryResponse(BaseModel):
    """Response body for POST /agent/query"""
    answer: str
    proposed_actions: list[ProposedAction] = []
    conversation_id: str
    searches: list[AgentSearch] = []

class ConfirmActionRequest(BaseModel):
    """
    Request body for POST /agent/confirm-action — the exact proposal object
    the frontend received under proposed_actions in /agent/query's response,
    echoed back unmodified when the user clicks Confirm on its card.
    """
    action_id: Optional[str] = None
    type: Literal["complete_task", "update_task", "create_task"]
    record_id: Optional[str] = None
    task_name: Optional[str] = None
    fields: Optional[dict] = None

class ConfirmActionResponse(BaseModel):
    """Response body for POST /agent/confirm-action"""
    status: str
    message: str
    task: Optional[TaskRecord] = None

# Logging setup
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

# FastAPI app creation
app = FastAPI(
    title="AI To-Do App",
    description="AI-powered task extraction and management API",
    version="0.1.0",
)

# CORS middleware
# Read allowed origins from environment variable, with localhost as fallback for local dev
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:5173"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in ALLOWED_ORIGINS],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Shared secret required by the external cron trigger for /notifications/run-scheduler
SCHEDULER_SECRET = os.getenv("SCHEDULER_SECRET")

# Audio upload constraints
MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_AUDIO_MIME_PREFIX = "audio/"

# Image upload constraints
MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_IMAGE_MIME_PREFIX = "image/"

# Service instance
service = TaskService()

# Endpoints
@app.get("/health", response_model=HealthResponse, status_code=status.HTTP_200_OK)
async def health_check():
    """Health check endpoint. Returns 200 if the server is running."""
    return HealthResponse(status="ok", service="ai-todo-app")

@app.post("/extract", response_model=ExtractResponse, status_code=status.HTTP_201_CREATED)
def extract_and_save_tasks(request: ExtractRequest, user_id: str = Depends(get_current_user_id)):
    """
    Extract tasks from natural language text and save them to the database.
    Returns the saved tasks with their assigned record_ids.
    """
    if not request.text or not request.text.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Text cannot be empty"
        )
    
    try:
        saved_tasks = service.extract_and_save(request.text, user_id=user_id)
        return ExtractResponse(saved_tasks=saved_tasks, count=len(saved_tasks))
    except RuntimeError as e:
        # Service raises RuntimeError when extraction fails or all saves fail
        logger.error(f"Extract failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Task extraction or save failed: {str(e)}"
        )
    except Exception as e:
        # Unexpected error — don't expose internals to client, but log full details
        logger.exception("Unexpected error in /extract")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

@app.post("/extract-voice", response_model=ExtractResponse, status_code=status.HTTP_201_CREATED)
async def extract_voice(audio: UploadFile = File(...), user_id: str = Depends(get_current_user_id)):
    """
    Extract tasks from an audio recording and save them to the database.
    Accepts any audio/* MIME type up to 10 MB. Audio is processed in memory and never stored.
    """
    # Validate MIME type
    if not audio.content_type or not audio.content_type.startswith(ALLOWED_AUDIO_MIME_PREFIX):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported media type: {audio.content_type}. Expected audio/*"
        )

    # Read and validate size
    audio_bytes = await audio.read()
    if len(audio_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty audio file"
        )
    if len(audio_bytes) > MAX_AUDIO_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Audio file too large. Max {MAX_AUDIO_SIZE_BYTES // (1024 * 1024)} MB."
        )

    try:
        saved_tasks = service.extract_and_save_from_audio(
            audio_bytes=audio_bytes,
            mime_type=audio.content_type,
            user_id=user_id,
        )
        return ExtractResponse(saved_tasks=saved_tasks, count=len(saved_tasks))
    except RuntimeError as e:
        logger.error(f"Extract-voice failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Task extraction or save failed: {str(e)}"
        )
    except Exception as e:
        logger.exception("Unexpected error in /extract-voice")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@app.post("/extract-image", response_model=ExtractResponse, status_code=status.HTTP_201_CREATED)
async def extract_image(image: UploadFile = File(...), context: str = Form(None), user_id: str = Depends(get_current_user_id)):
    """
    Extract tasks from an image and save them to the database.
    Accepts any image/* MIME type up to 10 MB. Image is processed in memory and never stored.
    """
    # Validate MIME type
    if not image.content_type or not image.content_type.startswith(ALLOWED_IMAGE_MIME_PREFIX):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported media type: {image.content_type}. Expected image/*"
        )

    # Read and validate size
    image_bytes = await image.read()
    if len(image_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty image file"
        )
    if len(image_bytes) > MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image file too large. Max {MAX_IMAGE_SIZE_BYTES // (1024 * 1024)} MB."
        )

    try:
        saved_tasks = service.extract_and_save_from_image(
            image_bytes=image_bytes,
            mime_type=image.content_type,
            user_id=user_id,
            additional_context=context,
        )
        return ExtractResponse(saved_tasks=saved_tasks, count=len(saved_tasks))
    except RuntimeError as e:
        logger.error(f"Extract-image failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Task extraction or save failed: {str(e)}"
        )
    except Exception as e:
        logger.exception("Unexpected error in /extract-image")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@app.get("/tasks", response_model=TasksListResponse, status_code=status.HTTP_200_OK)
def list_tasks(user_id: str = Depends(get_current_user_id)):
    """Retrieve all tasks from the database."""
    try:
        tasks = service.get_all_tasks(user_id)
        return TasksListResponse(tasks=tasks, count=len(tasks))
    except Exception as e:
        logger.exception("Failed to retrieve tasks")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to retrieve tasks: {str(e)}"
        )

@app.post("/tasks", response_model=TaskRecord, status_code=status.HTTP_201_CREATED)
def create_task_manual(request: CreateTaskRequest, user_id: str = Depends(get_current_user_id)):
    """
    Create a task manually without AI extraction. Used when the user
    knows exactly what they want (e.g., clicking a specific time slot).
    """
    if not request.task_name or not request.task_name.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="task_name cannot be empty"
        )

    try:
        saved = service.create_task_manual(user_id, request.model_dump())
        return saved
    except Exception as e:
        logger.exception("Failed to create task manually")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create task: {str(e)}"
        )

@app.patch("/tasks/{record_id}", response_model=TaskRecord, status_code=status.HTTP_200_OK)
def update_task(record_id: str, request: UpdateTaskRequest, user_id: str = Depends(get_current_user_id)):
    """
    Update specific fields on an existing task.
    Only fields included in the request body will be updated.
    """
    # Convert the Pydantic model to a dict, excluding fields that weren't sent
    updates = request.model_dump(exclude_unset=True)
    
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No fields provided to update"
        )
    
    try:
        updated_task = service.update_task(user_id, record_id, updates)
        return updated_task
    except Exception as e:
        # We can't easily distinguish "not found" from "network error" with current repository
        # For now, log and return 500. Future improvement: repository should raise typed exceptions.
        logger.exception(f"Failed to update task {record_id}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update task: {str(e)}"
        )

@app.delete("/tasks/{record_id}", response_model=DeleteTaskResponse, status_code=status.HTTP_200_OK)
def delete_task(record_id: str, user_id: str = Depends(get_current_user_id)):
    """
    Permanently delete a task. This is a HARD delete — the row is gone.
    For soft delete (preserves data for AI learning), use PATCH with is_rejected=true.

    Returns 200 with `{"calendar": ...}` describing what happened to the linked
    Google Calendar event (was 204 No Content, which could not say). The task is
    deleted either way; the field exists so the UI can tell the user when the
    calendar event deliberately SURVIVED — a task converted from a Google event
    keeps that event, because the event was created there and this app does not
    own it. See services.TaskService.delete_task for the four values.
    """
    try:
        return DeleteTaskResponse(calendar=service.delete_task(user_id, record_id))
    except Exception as e:
        logger.exception(f"Failed to delete task {record_id}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete task: {str(e)}"
        )

@app.post("/tasks/{record_id}/agent-edit", response_model=TaskAgentEditResponse)
def agent_edit_task(record_id: str, request: TaskAgentEditRequest, user_id: str = Depends(get_current_user_id)):
    """
    Natural-language editing of ONE task, from that task's own card.

    Separate from /agent/query and from a different module (task_agent.py):
    the target is this URL's record_id, chosen by the user, never by the
    model — so none of the chat agent's machinery for finding and
    disambiguating tasks applies. See task_agent.py's docstring.

    Returns a PLAN and writes nothing. The client applies it through
    PATCH /tasks/{record_id} and DELETE /tasks/{record_id}, i.e. the exact
    endpoints the manual edit form on the same card already uses, so the
    reminder invalidation, calendar sync and origin-aware delete reporting
    that live on those paths keep working unchanged and there is no second
    write path to keep correct. This costs one extra round trip and grants
    no new privilege — the user can already PATCH their own tasks from this
    screen; the agent only fills in the form.

    The task is loaded here, scoped to user_id, and handed to the agent
    already resolved: a record_id belonging to someone else is a 404 before
    the model is ever called.
    """
    task = service.repository.get_task(user_id, record_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    if not (request.instruction or "").strip():
        raise HTTPException(status_code=422, detail="instruction cannot be empty")

    try:
        plan = task_agent.plan_task_edit(request.instruction, task, user_id=user_id)
    except RuntimeError as e:
        logger.error(f"Task edit agent failed for {record_id}: {e}")
        raise HTTPException(status_code=503, detail=f"Task edit agent failed: {str(e)}")
    except Exception:
        logger.exception(f"Unexpected error in agent-edit for task {record_id}")
        raise HTTPException(status_code=500, detail="Internal server error")

    if plan["action"] in ("delete", "unclear"):
        return TaskAgentEditResponse(action=plan["action"], message=plan["message"])

    # Understood, but nothing to do — every value asked for already matches.
    # A distinct action so the client can say "already the case" instead of
    # flashing an empty success toast with an Undo that undoes nothing.
    if not plan["fields"]:
        return TaskAgentEditResponse(
            action="none", message=plan["message"], invalid=plan["invalid"],
        )

    return TaskAgentEditResponse(
        action="edit",
        message=plan["message"],
        fields=plan["fields"],
        before=plan["before"],
        invalid=plan["invalid"],
    )


@app.post("/push/subscribe", status_code=status.HTTP_201_CREATED)
def subscribe_push(subscription: PushSubscriptionRequest, user_id: str = Depends(get_current_user_id)):
    """
    Registers (or updates) a browser's push subscription so the backend
    can send it Web Push notifications even when the app is closed.
    """
    try:
        record = save_push_subscription(user_id, subscription)
        return {"status": "subscribed", "record_id": record.record_id}
    except Exception as e:
        logger.exception("Failed to save push subscription")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/push/send-test")
def send_test_push(user_id: str = Depends(get_current_user_id)):
    """
    Sends a real Web Push notification to every subscription belonging to
    the calling user. Proves the backend can push on demand — actual
    scheduling (e.g. a daily summary) is handled by a future session.

    Now requires auth (added in this phase): the underlying send-to-all
    capability was replaced by a per-user send, so this endpoint needs a
    user_id to target — it structurally could not stay unauthenticated.
    """
    result = service.send_push_to_user(
        user_id,
        title="Δοκιμαστική ειδοποίηση",
        body="Αυτό είναι ένα πραγματικό push notification από το backend.",
    )
    if result["total"] == 0:
        raise HTTPException(status_code=404, detail="No push subscriptions found. Enable notifications in Settings first.")
    return result


@app.get("/notifications/run-scheduler")
def run_scheduler(secret: str):
    """
    Triggered externally (e.g. a free cron service) every ~5 minutes.
    Checks for tasks due soon and sends their advance reminder pushes.
    Guarded by a shared secret query param since this app has no auth system.
    """
    if not SCHEDULER_SECRET or secret != SCHEDULER_SECRET:
        raise HTTPException(status_code=403, detail="Invalid secret")
    try:
        return service.run_notification_scheduler()
    except Exception as e:
        logger.exception("Notification scheduler run failed")
        raise HTTPException(status_code=500, detail=f"Scheduler run failed: {str(e)}")


@app.get("/settings", response_model=AppSettings)
def get_settings(user_id: str = Depends(get_current_user_id)):
    """Returns the current app-wide settings (notifications, send-all scope, daily summary)."""
    try:
        return get_app_settings(user_id)
    except Exception as e:
        logger.exception("Failed to load app settings")
        raise HTTPException(status_code=500, detail=f"Failed to load settings: {str(e)}")


@app.patch("/settings", response_model=AppSettings)
def update_settings(payload: AppSettings, user_id: str = Depends(get_current_user_id)):
    """Updates the notifications master toggle, send-all scope, and daily summary settings."""
    try:
        return update_app_settings(
            user_id=user_id,
            notifications_enabled=payload.notifications_enabled,
            send_all_enabled=payload.send_all_enabled,
            daily_summary_enabled=payload.daily_summary_enabled,
            daily_summary_mode=payload.daily_summary_mode,
            daily_summary_time=payload.daily_summary_time,
            calendar_sync_all_enabled=payload.calendar_sync_all_enabled,
            calendar_show_events=payload.calendar_show_events,
        )
    except Exception as e:
        logger.exception("Failed to update app settings")
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {str(e)}")


def _athens_today():
    """One clock read, in the same zone as everything else in this app."""
    return datetime.now(ZoneInfo("Europe/Athens")).date()


@app.get("/recurrences", response_model=RecurrencesListResponse)
def list_recurrences(user_id: str = Depends(get_current_user_id)):
    """Every recurrence rule this user owns, oldest first."""
    try:
        rules = repository.get_recurrence_rules(user_id)
        return RecurrencesListResponse(recurrences=rules, count=len(rules))
    except Exception as e:
        logger.exception("Failed to list recurrences")
        raise HTTPException(status_code=500, detail=f"Failed to list recurrences: {str(e)}")


@app.post("/recurrences", response_model=RecurrenceWriteResponse, status_code=status.HTTP_201_CREATED)
def create_recurrence(payload: RecurrenceCreateRequest, user_id: str = Depends(get_current_user_id)):
    """
    Creates a rule and materialises its window SYNCHRONOUSLY.

    The scheduler would get there within ~2 minutes, but a user who saves a
    recurrence and sees an empty list concludes the feature is broken. The
    write is idempotent, so doing it here and again on the next tick costs
    nothing.
    """
    try:
        # RecurrenceRule's validators are the real gate — an incoherent rule
        # (weekly with no weekdays, category Hostaway) raises here as a 422.
        # exclude_none: RecurrenceCreateRequest.checklist defaults to None,
        # but RecurrenceRule.checklist is a plain list (default_factory=list),
        # not Optional — passing checklist=None straight through would 422
        # every request that omits it. The other optional fields already
        # default to None on both sides, so dropping unset Nones changes
        # nothing for them.
        rule = RecurrenceRule(**payload.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        saved = repository.create_recurrence_rule(user_id, rule)
        created = service.materialize_recurrence_rule(user_id, saved, _athens_today())
        return RecurrenceWriteResponse(recurrence=saved, occurrences_created=created)
    except Exception as e:
        logger.exception("Failed to create recurrence")
        raise HTTPException(status_code=500, detail=f"Failed to create recurrence: {str(e)}")


@app.patch("/recurrences/{rule_id}", response_model=RecurrenceWriteResponse)
def update_recurrence(
    rule_id: str, payload: RecurrenceUpdateRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Changes a rule and regenerates from TOMORROW on.

    Pausing goes through here too (is_active=false), and that is the point:
    "off" must clear the fortnight already generated, not leave the user
    ticking off a task they just switched off. Approving an AI-made rule is
    also this call, with approval_status=true.
    """
    updates = payload.model_dump(exclude_unset=True)
    updates = {k: v for k, v in updates.items() if v is not None}
    if "checklist" in updates:
        updates["checklist"] = [item.model_dump() for item in payload.checklist or []]

    try:
        saved = repository.update_recurrence_rule(user_id, rule_id, updates)
    except Exception as e:
        logger.exception("Failed to update recurrence")
        raise HTTPException(status_code=500, detail=f"Failed to update recurrence: {str(e)}")

    if saved is None:
        raise HTTPException(status_code=404, detail="Recurrence not found")

    created = service.regenerate_recurrence_rule(user_id, saved, _athens_today())
    return RecurrenceWriteResponse(recurrence=saved, occurrences_created=created)


@app.delete("/recurrences/{rule_id}", response_model=RecurrenceDeleteResponse)
def delete_recurrence(rule_id: str, user_id: str = Depends(get_current_user_id)):
    """
    Deletes the rule and every OPEN occurrence, past and future. Completed and
    missed ones stay — that is the history, and ON DELETE SET NULL turns them
    into ordinary tasks.

    Past open ones must go as well: with the rule row gone there is no
    grace_days left to close them by, so they would hang overdue for ever.
    """
    rule = repository.get_recurrence_rule(user_id, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Recurrence not found")

    try:
        open_ids = [row["id"] for row in repository.get_open_occurrences(user_id, rule_id)]
        # occurrences_removed is len(open_ids), not delete_tasks_by_ids's return
        # value: we already know exactly which ids we asked to remove, so the
        # count doesn't need to depend on what the delete call hands back.
        repository.delete_tasks_by_ids(user_id, open_ids)
        repository.delete_recurrence_rule(user_id, rule_id)
        return RecurrenceDeleteResponse(deleted=True, occurrences_removed=len(open_ids))
    except Exception as e:
        logger.exception("Failed to delete recurrence")
        raise HTTPException(status_code=500, detail=f"Failed to delete recurrence: {str(e)}")


@app.get("/profile")
def get_profile(user_id: str = Depends(get_current_user_id)):
    """Returns this user's profile (id, email, display_name) from the profiles table."""
    try:
        return repository.get_profile(user_id)
    except Exception as e:
        logger.exception("Failed to load profile")
        raise HTTPException(status_code=500, detail=f"Failed to load profile: {str(e)}")


@app.patch("/profile")
def update_profile(payload: ProfileUpdateRequest, user_id: str = Depends(get_current_user_id)):
    """Updates this user's display_name."""
    try:
        return repository.update_profile(user_id, payload.display_name)
    except Exception as e:
        logger.exception("Failed to update profile")
        raise HTTPException(status_code=500, detail=f"Failed to update profile: {str(e)}")


@app.delete("/account")
def delete_account(user_id: str = Depends(get_current_user_id)):
    """
    Permanently deletes this user's auth account via the Supabase admin API.
    ON DELETE CASCADE on every user_id foreign key cleans up tasks, settings,
    push subscriptions, calendar connections/events, and token usage logs.
    """
    try:
        repository.delete_user_account(user_id)
        return {"status": "deleted"}
    except Exception as e:
        logger.exception("Failed to delete account")
        raise HTTPException(status_code=500, detail=f"Failed to delete account: {str(e)}")


@app.post("/calendar/connect")
def connect_calendar(payload: CalendarConnectRequest, user_id: str = Depends(get_current_user_id)):
    """
    Stores the Google provider tokens captured by the frontend right after
    the Calendar-scope OAuth flow completes. This is a ONE-TIME capture —
    all future refreshing happens server-side via google_calendar.py, never
    via Supabase's own session refresh (see google_calendar.py docstring).
    """
    expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    repository.save_google_calendar_connection(user_id, payload.access_token, payload.refresh_token, expiry)
    return {"status": "connected"}


@app.get("/calendar/status")
def calendar_status(user_id: str = Depends(get_current_user_id)):
    """Returns whether this user has a stored Google Calendar connection."""
    connection = repository.get_google_calendar_connection(user_id)
    return {"connected": connection is not None}


@app.post("/calendar/disconnect")
def disconnect_calendar(user_id: str = Depends(get_current_user_id)):
    """Deletes this user's stored Google Calendar connection."""
    repository.disconnect_google_calendar(user_id)
    return {"status": "disconnected"}


@app.get("/calendar/test")
def test_calendar(user_id: str = Depends(get_current_user_id)):
    """
    Verifies the stored connection actually works by calling the Google
    Calendar API on the user's behalf. Phase 1's success criterion — no
    sync logic here, just proof the tokens are valid and usable.
    """
    try:
        result = google_calendar.test_calendar_connection(user_id)
        return {"status": "ok", "calendar_name": result.get("calendar_name")}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Calendar connection test failed: {e}")


@app.get("/calendar/events")
def get_calendar_events(
    date: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    user_id: str = Depends(get_current_user_id),
):
    """
    Returns Google Calendar events pulled in by the scheduler that were NOT
    created by this app (no task-id marker) and haven't been converted to a
    task yet. Shown only in their own separate view — never auto-merged into
    the regular task lists (see google_calendar.pull_calendar_changes).
    Optional `date` (YYYY-MM-DD) narrows to a single day, used by the Today
    view's inline events section. Optional `start`/`end` (YYYY-MM-DD) narrows
    to a date range, used by the Monthly/Weekly Calendar view. Omit all three
    for the original full list used by the Settings panel.
    """
    return repository.get_google_calendar_events_for_user(user_id, date_filter=date, start_date=start, end_date=end)


@app.post("/calendar/events/{event_record_id}/convert")
def convert_calendar_event(event_record_id: str, user_id: str = Depends(get_current_user_id)):
    """Explicit, user-initiated conversion of a stored foreign calendar event into a real task."""
    try:
        task = repository.convert_calendar_event_to_task(user_id, event_record_id)
        return task
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/calendar/events/{event_record_id}/dismiss")
def dismiss_calendar_event(event_record_id: str, user_id: str = Depends(get_current_user_id)):
    """User-initiated hide of a foreign calendar event — does not touch Google Calendar, just stops showing it here."""
    repository.dismiss_calendar_event(user_id, event_record_id)
    return {"status": "dismissed"}


@app.post("/agent/query", response_model=AgentQueryResponse)
def agent_query(request: AgentQueryRequest, user_id: str = Depends(get_current_user_id)):
    """
    Answers a natural-language question about the user's tasks via the
    read-only AI agent in agent_engine.py. Isolated from the task
    extraction/CRUD system — only reads task data, never writes it.

    conversation_id is optional — omit it to start a fresh conversation, or
    pass back the value returned from a previous call to continue one, so
    the agent can resolve follow-ups like "it"/"that one". It is NOT trusted
    as an authorisation token: every DB read/write ask_agent performs is
    filtered by the authenticated user_id, so a conversation_id belonging to
    another user simply matches no rows.
    """
    if not request.question or not request.question.strip():
        raise HTTPException(status_code=422, detail="question cannot be empty")
    try:
        result = agent_engine.ask_agent(
            request.question.strip(), user_id=user_id, conversation_id=request.conversation_id
        )
        return AgentQueryResponse(
            answer=result["answer"],
            proposed_actions=result["proposed_actions"],
            conversation_id=result["conversation_id"],
            searches=result.get("searches", []),
        )
    except RuntimeError as e:
        logger.error(f"Agent query failed: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected error in /agent/query")
        raise HTTPException(status_code=500, detail="Internal server error")


def _validate_agent_write_fields(fields: dict) -> dict:
    """
    Re-validates a proposed field dict server-side before executing an
    agent-confirmed write. Silently drops any key outside
    agent_tools.AGENT_WRITABLE_FIELDS (defense against a manipulated
    proposal echoed back from the client) and raises HTTPException(422) on
    the first invalid enum value or malformed date/time.
    """
    valid_categories = {"Business", "Personal", "Unknown", "Hostaway"}
    valid_priorities = {"P1", "P2", "P3"}

    cleaned = {k: v for k, v in fields.items() if k in agent_tools.AGENT_WRITABLE_FIELDS}

    if "category" in cleaned and cleaned["category"] not in valid_categories:
        raise HTTPException(status_code=422, detail=f"Invalid category '{cleaned['category']}'")
    if "priority" in cleaned and cleaned["priority"] not in valid_priorities:
        raise HTTPException(status_code=422, detail=f"Invalid priority '{cleaned['priority']}'")
    if cleaned.get("due_date"):
        try:
            datetime.strptime(cleaned["due_date"], "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="due_date must be in YYYY-MM-DD format")
    if cleaned.get("due_time"):
        try:
            datetime.strptime(cleaned["due_time"], "%H:%M")
        except ValueError:
            raise HTTPException(status_code=422, detail="due_time must be in HH:MM format")
    if "task_name" in cleaned:
        name = (cleaned["task_name"] or "").strip()
        if not name:
            raise HTTPException(status_code=422, detail="task_name cannot be empty")
        if len(name) > 80:
            raise HTTPException(status_code=422, detail="task_name too long (max 80 characters)")
        cleaned["task_name"] = name

    return cleaned


def _reject_if_pending_approval(user_id: str, record_id: str) -> None:
    """
    Refuses an agent-proposed write against a task still awaiting Inbox
    approval. agent_tools' propose_* functions already refuse to PROPOSE one,
    but this is the actual write boundary and, per this endpoint's own
    contract, it re-validates from scratch instead of trusting the proposal
    it was handed. Approving a task is the user's decision, made in the
    Inbox — an agent write must never be able to stand in for it.
    """
    task = next(
        (t for t in repository.get_tasks_for_user(user_id=user_id) if t.record_id == record_id),
        None,
    )
    if task is not None and agent_tools.is_pending_task(task):
        raise HTTPException(
            status_code=409,
            detail="This task is still awaiting approval in the Inbox and cannot be changed by the agent.",
        )


@app.post("/agent/confirm-action", response_model=ConfirmActionResponse)
def confirm_agent_action(request: ConfirmActionRequest, user_id: str = Depends(get_current_user_id)):
    """
    Executes exactly ONE agent-proposed write after the user clicks Confirm
    on its card in the chat UI. Nothing in agent_tools.py's propose_*
    functions ever touches the database — this is the only place such a
    write actually happens, and it re-validates the action from scratch
    (allowed type, field whitelist, real values) rather than trusting that
    the client-echoed proposal is still accurate. user_id scoping is
    inherited from TaskService's existing user-scoped methods (a record_id
    belonging to a different user simply won't match any row).
    """
    try:
        if request.type == "complete_task":
            if not request.record_id:
                raise HTTPException(status_code=422, detail="record_id is required for complete_task")
            _reject_if_pending_approval(user_id, request.record_id)
            updated = service.update_task(
                user_id, request.record_id, {"is_completed": True}, completed_source="agent"
            )
            return ConfirmActionResponse(status="done", message=f"Completed: {updated.task_name}", task=updated)

        elif request.type == "update_task":
            if not request.record_id:
                raise HTTPException(status_code=422, detail="record_id is required for update_task")
            fields = _validate_agent_write_fields(request.fields or {})
            if not fields:
                raise HTTPException(status_code=422, detail="No valid fields to update")
            _reject_if_pending_approval(user_id, request.record_id)
            updated = service.update_task(user_id, request.record_id, fields)
            return ConfirmActionResponse(status="done", message=f"Updated: {updated.task_name}", task=updated)

        elif request.type == "create_task":
            fields = _validate_agent_write_fields(request.fields or {})
            if not fields.get("task_name"):
                raise HTTPException(status_code=422, detail="task_name is required for create_task")
            created = service.create_task_manual(user_id, fields, approval_status=False)
            return ConfirmActionResponse(status="done", message=f"Added to Inbox: {created.task_name}", task=created)

        raise HTTPException(status_code=422, detail=f"Unsupported action type: {request.type}")

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to execute agent action ({request.type})")
        raise HTTPException(status_code=500, detail=f"Failed to execute action: {str(e)}")


HOSTAWAY_THREAD_SEPARATOR = "\n---\n"
HOSTAWAY_MESSAGES_HEADING = "Μηνύματα:"


def _hostaway_meta_block(description: str) -> str:
    """
    Pulls the Property/Dates block out of a Hostaway task's description.

    It is written ONCE, at creation, from two Hostaway API calls the append
    path deliberately does not repeat (see the enrichment note in the
    webhook). Rebuilding a threaded task's description without it would
    delete which property and which stay the task is about the moment a
    second message arrives — exactly the context a P1 needs.

    Reads both the current shape and the pre-2026-08-11 one, so a task
    created before this existed keeps its block on its first append.
    """
    if not description:
        return ""
    head = re.split(
        rf"\n\n{HOSTAWAY_MESSAGES_HEADING}\n|\n\nOriginal message: ", description
    )[0]
    parts = head.split("\n\n", 1)
    return parts[1].strip() if len(parts) > 1 else ""


def _render_hostaway_description(summary: str, meta_block: str, thread: str) -> str:
    """The one description shape, used by both the create and append paths."""
    blocks = [summary]
    if meta_block:
        blocks.append(meta_block)
    blocks.append(f"{HOSTAWAY_MESSAGES_HEADING}\n{thread}")
    return "\n\n".join(blocks)


def _append_to_hostaway_thread(
    user_id: str,
    task,
    message_body: str,
    message_date: str,
    classification: dict,
) -> dict:
    """
    Folds a burst message into an existing open task and re-classifies the
    whole thread. Returns the update dict that was written.

    The WHOLE thread is re-classified, not just the new message, because
    the messages being merged are precisely the ones that mean nothing
    alone — «του νησιού», «Πετσέτες εννοώ συγγνώμη». The call count is
    unchanged from today (one per message); only ~23 extra tokens per
    burst are spent re-sending it. Spec §3.1.

    Priority can only ever escalate: a follow-up «και μια ερώτηση» must not
    downgrade a P1 thread about missing keys.
    """
    thread = task.hostaway_thread or ""
    new_thread = f"{thread}{HOSTAWAY_THREAD_SEPARATOR}{message_body}" if thread else message_body
    new_priority = hostaway_threading.higher_priority(task.priority, classification["priority"])

    updates = {
        "hostaway_thread": new_thread,
        "hostaway_message_count": (task.hostaway_message_count or 0) + 1,
        "hostaway_last_message_at": message_date,
        "priority": new_priority,
        "description": _render_hostaway_description(
            classification["summary"], _hostaway_meta_block(task.description), new_thread
        ),
        # A new message restarts the escalation cycle — the clock measures
        # "how long since we nagged", and the burst has just been notified
        # (or deliberately not, on an unchanged priority).
        "hostaway_last_notified_at": datetime.now(ZoneInfo("Europe/Athens")).isoformat(),
    }
    repository.update_hostaway_thread_fields(user_id, task.record_id, updates)
    logging.info(
        f"[hostaway webhook] Appended to thread {task.hostaway_conversation_id} "
        f"(task {task.record_id}, {updates['hostaway_message_count']} messages, "
        f"priority {task.priority} -> {new_priority})"
    )
    return updates


def _handle_outgoing_hostaway_message(user_id: str, data: dict) -> dict:
    """
    An outgoing message arrived. Close the task it answers — if a human
    wrote it, and if there is exactly one task it could be answering.

    Both guards are load-bearing. The account runs a `messageReceived`
    automation that fires after EVERY guest message, so "an outgoing
    message means the task is handled" would close every task within
    seconds of creating it, silently. Spec §1.1.
    """
    if not hostaway_threading.is_human_reply(data):
        return {"status": "ignored", "reason": "automated outgoing message"}

    conversation_id = data.get("conversationId")
    if not conversation_id:
        return {"status": "ignored", "reason": "outgoing message without a conversationId"}

    open_tasks = repository.get_open_tasks_for_conversation(user_id, str(conversation_id))
    if not open_tasks:
        return {"status": "ok", "note": "no open task for this conversation"}

    if len(open_tasks) > 1:
        # Which of the two did the reply answer? That is a judgement, so it
        # is not made — the user is told and decides. Spec §3.2.
        try:
            service.send_push_to_user(
                user_id,
                title="Απάντησες στον πελάτη",
                body=f"{len(open_tasks)} tasks αυτής της συζήτησης είναι ακόμα ανοιχτά.",
            )
        except Exception as e:
            logging.error(f"[hostaway webhook] Failed to send ambiguity notice: {e}")
        return {"status": "ambiguous", "open_tasks": len(open_tasks)}

    task = open_tasks[0]
    # HOSTAWAY's date for the reply, not a clock read here — the same value
    # the scheduler's reply check writes, so one column never holds two
    # formats. It matters: find_unanswered_human_reply parses this field to
    # decide "have I already recorded this reply?", and an Athens ISO string
    # is unparseable to it, which would make an answered P1 look unanswered
    # on every tick. Falls back to now() only if Hostaway omits the date.
    answered_at = data.get("date") or datetime.now(ZoneInfo("Europe/Athens")).isoformat()

    # Same policy the scheduler's reply check applies, read from the same set
    # so the two paths can never disagree about what a reply closes.
    updates = {"hostaway_answered_at": answered_at}
    if task.priority in services.HOSTAWAY_REPLY_AUTOCOMPLETE_PRIORITIES:
        updates.update(services.hostaway_completion_fields())

    repository.update_hostaway_thread_fields(user_id, task.record_id, updates)
    logging.info(
        f"[hostaway webhook] Human reply on conversation {conversation_id}: "
        f"task {task.record_id} ({task.priority}) -> "
        f"{'completed' if updates.get('is_completed') else 'answered, left open'}"
    )
    return {"status": "ok", "task": task.record_id}


def _create_hostaway_task(
    user_id: str,
    classification: dict,
    listing_name: str,
    reservation_details: dict,
    message_body: str,
    message_date: Optional[str],
    conversation_id,
) -> bool:
    """
    One colleague's copy of a guest message. Returns whether it was written.

    Pulled out of the webhook when one message started producing one task per
    connected colleague: the body is identical for each, only user_id differs.
    """
    now = datetime.now(ZoneInfo("Europe/Athens"))
    now_str = now.isoformat()
    priority = classification["priority"]
    task_name = f"Hostaway: {reservation_details['guest_name']} - {listing_name}"

    # Instant notification for every priority, then ongoing re-notification
    # at a priority-paced interval for as long as the task stays open —
    # see TaskService._check_hostaway_escalations / HOSTAWAY_ESCALATION_INTERVALS
    # in services.py, run from the existing scheduler cycle.
    priority_emoji = {"P1": "🔴", "P2": "🟡", "P3": "🟢"}.get(priority, "")
    try:
        service.send_push_to_user(
            user_id, title=f"{priority_emoji} {task_name}", body=classification["summary"]
        )
    except Exception as e:
        logging.error(f"[hostaway webhook] Failed to send instant notification: {e}")

    try:
        service.create_task_manual(user_id, {
            "task_name": task_name,
            # Same shape the append path re-renders, so a threaded task and a
            # fresh one read identically and _hostaway_meta_block has one
            # thing to find.
            "description": _render_hostaway_description(
                classification["summary"],
                f"Property: {listing_name}\n"
                f"Dates: {reservation_details['arrival_date']} → "
                f"{reservation_details['departure_date']}",
                message_body,
            ),
            "category": "Hostaway",
            "priority": priority,
            "due_date": now.strftime("%Y-%m-%d"),
            "due_time": None,
            "checklist": [],
            "hostaway_created_at": now_str,
            "hostaway_last_notified_at": now_str,
            "hostaway_conversation_id": str(conversation_id) if conversation_id else None,
            "hostaway_last_message_at": message_date,
            "hostaway_message_count": 1,
            "hostaway_thread": message_body,
        })
        logging.info(
            f"[hostaway webhook] Created task for {user_id}: {task_name} (priority={priority})"
        )
        return True
    except Exception as e:
        logging.error(f"[hostaway webhook] Failed to create task for {user_id}: {e}")
        return False


@app.post("/webhooks/hostaway")
async def hostaway_webhook(request: Request):
    """
    Receives Hostaway's 'new message received' webhook, enriches it with
    listing/reservation details, classifies priority via AI, and creates
    a pre-approved task. Always returns 200 (even on internal errors) so
    Hostaway doesn't disable the webhook after repeated failures — log
    errors instead of surfacing them as failed deliveries.
    """
    try:
        payload = await request.json()
    except Exception as e:
        logging.error(f"[hostaway webhook] Failed to parse JSON: {e}")
        return {"status": "error", "note": "invalid JSON"}

    data = payload.get("data") or {}
    event = payload.get("event")

    # Logged for EVERY delivery, before any filtering, because the branch
    # right below returns silently: "nothing in the log" could not tell
    # "Hostaway never POSTed" apart from "Hostaway POSTed an event name we
    # don't match". Gap A — does this webhook fire for outgoing messages at
    # all? — was being answered out of exactly that silence, and the answer
    # it gives is not trustworthy while the ignored branch is mute.
    logging.info(
        f"[hostaway webhook] Delivery: event={event!r} "
        f"isIncoming={data.get('isIncoming')!r} "
        f"conversation={data.get('conversationId')} "
        f"userId={data.get('userId')} "
        f"payload_keys={sorted(payload.keys())}"
    )

    if event != "message.received":
        return {"status": "ignored", "reason": "not a message event"}

    if data.get("isIncoming") != 1:
        # Silently dropped until 2026-08-10. An outgoing message is how we
        # learn the conversation was answered — and the log line matters
        # independently: it is the only evidence of whether Hostaway fires
        # this webhook for outgoing messages at all (spec §6).
        logging.info(
            f"[hostaway webhook] Outgoing message: conversation="
            f"{data.get('conversationId')} userId={data.get('userId')} "
            f"communicationId={data.get('communicationId')} "
            f"communicationEvent={data.get('communicationEvent')}"
        )
        # Every colleague on the account holds their own copy of this
        # conversation's task, so one outgoing message answers all of them.
        results = []
        for connection in repository.get_hostaway_connections_for_account(payload.get("accountId")):
            try:
                results.append(_handle_outgoing_hostaway_message(connection["user_id"], data))
            except Exception as e:
                logging.error(f"[hostaway webhook] Outgoing handling failed: {e}")
        return {"status": "ok", "handled": len(results)}

    message_body = (data.get("body") or "").strip()
    if not message_body:
        return {"status": "ignored", "reason": "empty message body"}

    listing_map_id = data.get("listingMapId")
    reservation_id = data.get("reservationId")
    conversation_id = data.get("conversationId")
    message_date = data.get("date")

    connections = repository.get_hostaway_connections_for_account(payload.get("accountId"))
    recipients = [c for c in connections if c.get("tasks_enabled")]
    if not recipients:
        # Nobody has connected this account, or everyone switched task
        # creation off. Both are ordinary, and neither costs a Gemini call —
        # which is why this check sits ABOVE the classification.
        logging.info(
            f"[hostaway webhook] No recipient for account {payload.get('accountId')} "
            f"({len(connections)} connected, {len(recipients)} with tasks enabled)"
        )
        return {"status": "ignored", "reason": "no connection wants this message"}

    # Is this message part of a burst an open task already covers? The
    # comparison uses HOSTAWAY's dates on both sides, never now() — so it
    # behaves identically whether the webhook was instant or the message was
    # picked up minutes later. Spec §3.1. Asked per colleague, because they
    # close their copies independently.
    existing_by_user = {}
    for connection in recipients:
        for candidate in repository.get_open_tasks_for_conversation(
            connection["user_id"], str(conversation_id)
        ) if conversation_id else []:
            if hostaway_threading.should_append_to_thread(
                candidate.hostaway_last_message_at, message_date
            ):
                existing_by_user[connection["user_id"]] = candidate
                break

    # Classify the whole thread when appending, the single message otherwise:
    # the messages that get merged are exactly the ones that mean nothing on
    # their own, so classifying the new one alone would produce noise.
    #
    # ONE classification for everyone. The thread belongs to the
    # CONVERSATION, not to a colleague — every copy holds the same messages —
    # so the first open task found supplies it and the verdict applies to all.
    text_to_classify = message_body
    for task in existing_by_user.values():
        if task.hostaway_thread:
            text_to_classify = f"{task.hostaway_thread}{HOSTAWAY_THREAD_SEPARATOR}{message_body}"
            break

    try:
        classification = hostaway_integration.classify_message(
            text_to_classify, user_id=recipients[0]["user_id"]
        )
    except Exception as e:
        logging.error(f"[hostaway webhook] Classification failed unexpectedly: {e}")
        classification = {"summary": message_body[:200], "priority": "P1"}

    # Enrichment is two Hostaway round-trips for the MESSAGE, not per
    # colleague, and only when at least one of them needs a new task: the
    # append path uses neither the listing name nor the reservation, so a
    # pure-burst delivery spends nothing here.
    enrichment = None

    def _enrichment():
        nonlocal enrichment
        if enrichment is None:
            try:
                # Inside the try, not above it: decrypting the stored secret
                # raises when HOSTAWAY_ENCRYPTION_KEY is missing or wrong, and
                # that used to escape this function, the loop and the handler —
                # turning every guest message into a 500. Hostaway disables a
                # webhook that keeps failing, so the misconfiguration would
                # have cost us the webhook itself.
                credentials = hostaway_integration.credentials_from_connection(recipients[0])
                enrichment = (
                    hostaway_integration.get_listing_name(listing_map_id, credentials)
                    if listing_map_id else "Άγνωστο property",
                    hostaway_integration.get_reservation_details(reservation_id, credentials)
                    if reservation_id else
                    {"guest_name": "Πελάτης", "arrival_date": "?", "departure_date": "?"},
                )
            except Exception as e:
                logging.error(f"[hostaway webhook] Enrichment failed: {e}")
                enrichment = ("Άγνωστο property",
                              {"guest_name": "Πελάτης", "arrival_date": "?", "departure_date": "?"})
        return enrichment

    threaded, created = 0, 0
    for connection in recipients:
        user_id = connection["user_id"]
        existing_task = existing_by_user.get(user_id)

        if existing_task:
            previous_priority = existing_task.priority
            updates = _append_to_hostaway_thread(
                user_id, existing_task, message_body, message_date, classification
            )
            # One push per message is the rule (spec §4) — but inside a burst,
            # three pushes in forty seconds for one thought IS the noise this
            # feature exists to remove. So the burst notifies once, and again
            # ONLY on an escalation: decided by the owner, 2026-08-10.
            if hostaway_threading.is_more_urgent(updates["priority"], previous_priority):
                emoji = {"P1": "🔴", "P2": "🟡", "P3": "🟢"}.get(updates["priority"], "")
                try:
                    service.send_push_to_user(
                        user_id,
                        title=f"{emoji} {existing_task.task_name}",
                        body=classification["summary"],
                    )
                except Exception as e:
                    logging.error(f"[hostaway webhook] Failed to send escalation notification: {e}")
            threaded += 1
            continue

        listing_name, reservation_details = _enrichment()
        if _create_hostaway_task(
            user_id, classification, listing_name, reservation_details,
            message_body, message_date, conversation_id,
        ):
            created += 1

    return {"status": "ok", "tasks_created": created, "threaded_into": threaded}


HOSTAWAY_WEBHOOK_URL = os.getenv(
    "HOSTAWAY_WEBHOOK_URL", "https://ai-todo-app-sdq8.onrender.com/webhooks/hostaway"
)


class HostawayConnectRequest(BaseModel):
    account_id: str
    client_secret: str


class HostawaySwitchesRequest(BaseModel):
    tasks_enabled: Optional[bool] = None
    auto_close_enabled: Optional[bool] = None


@app.get("/integrations/hostaway")
def get_hostaway_status(user_id: str = Depends(get_current_user_id)):
    """The connection as the UI needs it. The secret is never part of that."""
    connection = repository.get_hostaway_connection(user_id)
    if not connection:
        return {"connected": False, "account_id": None,
                "tasks_enabled": False, "auto_close_enabled": False}
    return {
        "connected": True,
        "account_id": connection["account_id"],
        "tasks_enabled": bool(connection["tasks_enabled"]),
        "auto_close_enabled": bool(connection["auto_close_enabled"]),
    }


@app.post("/integrations/hostaway")
def connect_hostaway(
    request: HostawayConnectRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Validates the credentials against Hostaway BEFORE storing anything, then
    registers the webhook, then saves. A connection that is saved but does not
    work is worse than no connection: it fails silently, later, on a guest
    message nobody is watching.
    """
    credentials = hostaway_integration.HostawayCredentials(
        account_id=request.account_id.strip(), client_secret=request.client_secret.strip()
    )
    try:
        hostaway_integration.get_access_token(credentials)
    except Exception as e:
        logging.error(f"[hostaway connect] Credential check failed for {user_id}: {e}")
        raise HTTPException(
            status_code=400,
            detail="Τα στοιχεία Hostaway δεν έγιναν δεκτά. Έλεγξε το Account ID και το API key.",
        )

    webhook_id = None
    try:
        webhook_id = hostaway_integration.hostaway_register_webhook(
            credentials, HOSTAWAY_WEBHOOK_URL
        )
    except Exception as e:
        # The credentials are good; only the webhook failed. Store the
        # connection so the reply poller works, and tell the UI that new
        # messages will not arrive until the webhook is added by hand.
        logging.error(f"[hostaway connect] Webhook registration failed for {user_id}: {e}")

    repository.upsert_hostaway_connection(
        user_id, credentials.account_id, crypto.encrypt_secret(credentials.client_secret), webhook_id
    )
    logging.info(
        f"[hostaway connect] {user_id} connected account {credentials.account_id} "
        f"(webhook={webhook_id})"
    )
    return {
        "connected": True,
        "account_id": credentials.account_id,
        "webhook_registered": webhook_id is not None,
        "webhook_url": HOSTAWAY_WEBHOOK_URL,
        "tasks_enabled": True,
        "auto_close_enabled": True,
    }


@app.patch("/integrations/hostaway")
def update_hostaway_switches(
    request: HostawaySwitchesRequest, user_id: str = Depends(get_current_user_id)
):
    updates = {k: v for k, v in request.model_dump().items() if v is not None}
    repository.update_hostaway_connection(user_id, updates)
    return get_hostaway_status(user_id=user_id)


@app.delete("/integrations/hostaway")
def disconnect_hostaway(user_id: str = Depends(get_current_user_id)):
    """
    Removes the webhook from their Hostaway account, then the row. Existing
    Hostaway tasks are deliberately left alone: they are the user's work, not
    the connection's data.
    """
    connection = repository.get_hostaway_connection(user_id)
    if connection and connection.get("webhook_id"):
        try:
            hostaway_integration.hostaway_delete_webhook(
                hostaway_integration.credentials_from_connection(connection),
                connection["webhook_id"],
            )
        except Exception as e:
            # Never trap the user in a connection because Hostaway said no.
            logging.error(f"[hostaway disconnect] Could not remove webhook for {user_id}: {e}")

    repository.delete_hostaway_connection(user_id)
    hostaway_integration.clear_token_cache()
    return {"connected": False}


@app.get("/dev/token-usage")
def dev_token_usage(user_id: str = Depends(get_current_user_id)):
    """Developer-only: not linked from main navigation. Now gated behind login like every other user-facing endpoint."""
    return token_tracker.get_usage_summary(user_id)