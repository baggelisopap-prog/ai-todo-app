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
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import FastAPI, HTTPException, Request, status, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from models import ChecklistItem, TaskRecord, PushSubscriptionRequest, AppSettings
from services import TaskService
from repository import save_push_subscription, get_app_settings, update_app_settings
from auth import get_current_user_id
import agent_engine
import google_calendar
import hostaway_integration
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

class HealthResponse(BaseModel):
    status: str
    service: str

class CalendarConnectRequest(BaseModel):
    """Request body for POST /calendar/connect"""
    access_token: str
    refresh_token: str

class AgentQueryRequest(BaseModel):
    """Request body for POST /agent/query"""
    question: str

class AgentQueryResponse(BaseModel):
    """Response body for POST /agent/query"""
    answer: str

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
async def extract_and_save_tasks(request: ExtractRequest, user_id: str = Depends(get_current_user_id)):
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
async def list_tasks(user_id: str = Depends(get_current_user_id)):
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
async def create_task_manual(request: CreateTaskRequest, user_id: str = Depends(get_current_user_id)):
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
async def update_task(record_id: str, request: UpdateTaskRequest, user_id: str = Depends(get_current_user_id)):
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

@app.delete("/tasks/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(record_id: str, user_id: str = Depends(get_current_user_id)):
    """
    Permanently delete a task. Returns 204 No Content on success.
    This is a HARD delete — the record is gone from Airtable.
    For soft delete (preserves data for AI learning), use PATCH with is_rejected=true.
    """
    try:
        service.delete_task(user_id, record_id)
    except Exception as e:
        logger.exception(f"Failed to delete task {record_id}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete task: {str(e)}"
        )


@app.post("/push/subscribe", status_code=status.HTTP_201_CREATED)
async def subscribe_push(subscription: PushSubscriptionRequest, user_id: str = Depends(get_current_user_id)):
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
async def send_test_push(user_id: str = Depends(get_current_user_id)):
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
async def run_scheduler(secret: str):
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
async def get_settings(user_id: str = Depends(get_current_user_id)):
    """Returns the current app-wide settings (notifications, send-all scope, daily summary)."""
    try:
        return get_app_settings(user_id)
    except Exception as e:
        logger.exception("Failed to load app settings")
        raise HTTPException(status_code=500, detail=f"Failed to load settings: {str(e)}")


@app.patch("/settings", response_model=AppSettings)
async def update_settings(payload: AppSettings, user_id: str = Depends(get_current_user_id)):
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


@app.post("/calendar/connect")
async def connect_calendar(payload: CalendarConnectRequest, user_id: str = Depends(get_current_user_id)):
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
async def calendar_status(user_id: str = Depends(get_current_user_id)):
    """Returns whether this user has a stored Google Calendar connection."""
    connection = repository.get_google_calendar_connection(user_id)
    return {"connected": connection is not None}


@app.post("/calendar/disconnect")
async def disconnect_calendar(user_id: str = Depends(get_current_user_id)):
    """Deletes this user's stored Google Calendar connection."""
    repository.disconnect_google_calendar(user_id)
    return {"status": "disconnected"}


@app.get("/calendar/test")
async def test_calendar(user_id: str = Depends(get_current_user_id)):
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
async def get_calendar_events(
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
async def convert_calendar_event(event_record_id: str, user_id: str = Depends(get_current_user_id)):
    """Explicit, user-initiated conversion of a stored foreign calendar event into a real task."""
    try:
        task = repository.convert_calendar_event_to_task(user_id, event_record_id)
        return task
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/calendar/events/{event_record_id}/dismiss")
async def dismiss_calendar_event(event_record_id: str, user_id: str = Depends(get_current_user_id)):
    """User-initiated hide of a foreign calendar event — does not touch Google Calendar, just stops showing it here."""
    repository.dismiss_calendar_event(user_id, event_record_id)
    return {"status": "dismissed"}


@app.post("/agent/query", response_model=AgentQueryResponse)
async def agent_query(request: AgentQueryRequest, user_id: str = Depends(get_current_user_id)):
    """
    Answers a natural-language question about the user's tasks via the
    read-only AI agent in agent_engine.py. Isolated from the task
    extraction/CRUD system — only reads task data, never writes it.
    """
    if not request.question or not request.question.strip():
        raise HTTPException(status_code=422, detail="question cannot be empty")
    try:
        answer = agent_engine.ask_agent(request.question.strip(), user_id=user_id)
        return AgentQueryResponse(answer=answer)
    except RuntimeError as e:
        logger.error(f"Agent query failed: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected error in /agent/query")
        raise HTTPException(status_code=500, detail="Internal server error")


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

    if payload.get("event") != "message.received":
        return {"status": "ignored", "reason": "not a message event"}

    data = payload.get("data", {})

    if data.get("isIncoming") != 1:
        return {"status": "ignored", "reason": "not an incoming guest message"}

    message_body = (data.get("body") or "").strip()
    if not message_body:
        return {"status": "ignored", "reason": "empty message body"}

    listing_map_id = data.get("listingMapId")
    reservation_id = data.get("reservationId")

    hostaway_account_id = payload.get("accountId")
    user_id = hostaway_integration.get_user_id_for_hostaway_account(hostaway_account_id)

    try:
        listing_name = hostaway_integration.get_listing_name(listing_map_id) if listing_map_id else "Άγνωστο property"
        reservation_details = hostaway_integration.get_reservation_details(reservation_id) if reservation_id else {
            "guest_name": "Πελάτης", "arrival_date": "?", "departure_date": "?"
        }
    except Exception as e:
        logging.error(f"[hostaway webhook] Enrichment failed: {e}")
        listing_name = "Άγνωστο property"
        reservation_details = {"guest_name": "Πελάτης", "arrival_date": "?", "departure_date": "?"}

    try:
        classification = hostaway_integration.classify_message(message_body, user_id=user_id)
    except Exception as e:
        logging.error(f"[hostaway webhook] Classification failed unexpectedly: {e}")
        classification = {"summary": message_body[:200], "priority": "P1"}

    guest_name = reservation_details["guest_name"]
    arrival = reservation_details["arrival_date"]
    departure = reservation_details["departure_date"]

    now = datetime.now(ZoneInfo("Europe/Athens"))
    today_str = now.strftime("%Y-%m-%d")
    now_str = now.isoformat()
    priority = classification["priority"]

    task_name = f"Hostaway: {guest_name} - {listing_name}"
    description = (
        f"{classification['summary']}\n\n"
        f"Property: {listing_name}\n"
        f"Dates: {arrival} → {departure}\n\n"
        f"Original message: {message_body}"
    )

    # Instant notification for every priority, then ongoing re-notification
    # at a priority-paced interval for as long as the task stays open —
    # see TaskService._check_hostaway_escalations / HOSTAWAY_ESCALATION_INTERVALS
    # in services.py, run from the existing scheduler cycle.
    priority_emoji = {"P1": "🔴", "P2": "🟡", "P3": "🟢"}.get(priority, "")
    try:
        service.send_push_to_user(
            user_id,
            title=f"{priority_emoji} {task_name}",
            body=classification["summary"],
        )
    except Exception as e:
        logging.error(f"[hostaway webhook] Failed to send instant notification: {e}")

    try:
        service.create_task_manual(user_id, {
            "task_name": task_name,
            "description": description,
            "category": "Hostaway",
            "priority": priority,
            "due_date": today_str,
            "due_time": None,
            "checklist": [],
            "hostaway_created_at": now_str,
            "hostaway_last_notified_at": now_str,
        })
        logging.info(f"[hostaway webhook] Created task: {task_name} (priority={priority})")
    except Exception as e:
        logging.error(f"[hostaway webhook] Failed to create task: {e}")
        return {"status": "error", "note": "task creation failed, see logs"}

    return {"status": "ok", "task_created": True}


@app.get("/dev/token-usage")
async def dev_token_usage(user_id: str = Depends(get_current_user_id)):
    """Developer-only: not linked from main navigation. Now gated behind login like every other user-facing endpoint."""
    return token_tracker.get_usage_summary(user_id)