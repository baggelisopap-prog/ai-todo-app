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
from fastapi import FastAPI, HTTPException, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from models import ChecklistItem, TaskRecord, PushSubscriptionRequest, AppSettings
from services import TaskService
from repository import save_push_subscription, get_app_settings, update_app_settings
import agent_engine
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
async def extract_and_save_tasks(request: ExtractRequest):
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
        saved_tasks = service.extract_and_save(request.text)
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
async def extract_voice(audio: UploadFile = File(...)):
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
async def extract_image(image: UploadFile = File(...), context: str = Form(None)):
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
async def list_tasks():
    """Retrieve all tasks from the database."""
    try:
        tasks = service.get_all_tasks()
        return TasksListResponse(tasks=tasks, count=len(tasks))
    except Exception as e:
        logger.exception("Failed to retrieve tasks")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to retrieve tasks: {str(e)}"
        )

@app.post("/tasks", response_model=TaskRecord, status_code=status.HTTP_201_CREATED)
async def create_task_manual(request: CreateTaskRequest):
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
        saved = service.create_task_manual(request.model_dump())
        return saved
    except Exception as e:
        logger.exception("Failed to create task manually")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create task: {str(e)}"
        )

@app.patch("/tasks/{record_id}", response_model=TaskRecord, status_code=status.HTTP_200_OK)
async def update_task(record_id: str, request: UpdateTaskRequest):
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
        updated_task = service.update_task(record_id, updates)
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
async def delete_task(record_id: str):
    """
    Permanently delete a task. Returns 204 No Content on success.
    This is a HARD delete — the record is gone from Airtable.
    For soft delete (preserves data for AI learning), use PATCH with is_rejected=true.
    """
    try:
        service.delete_task(record_id)
    except Exception as e:
        logger.exception(f"Failed to delete task {record_id}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete task: {str(e)}"
        )


@app.post("/push/subscribe", status_code=status.HTTP_201_CREATED)
async def subscribe_push(subscription: PushSubscriptionRequest):
    """
    Registers (or updates) a browser's push subscription so the backend
    can send it Web Push notifications even when the app is closed.
    """
    try:
        record = save_push_subscription(subscription)
        return {"status": "subscribed", "record_id": record.record_id}
    except Exception as e:
        logger.exception("Failed to save push subscription")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/push/send-test")
async def send_test_push():
    """
    Sends a real Web Push notification to every stored subscription.
    Proves the backend can push on demand — actual scheduling (e.g. a
    daily summary) is handled by a future session.
    """
    result = service.send_push_to_all(
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
async def get_settings():
    """Returns the current app-wide settings (notifications, send-all scope, daily summary)."""
    try:
        return get_app_settings()
    except Exception as e:
        logger.exception("Failed to load app settings")
        raise HTTPException(status_code=500, detail=f"Failed to load settings: {str(e)}")


@app.patch("/settings", response_model=AppSettings)
async def update_settings(payload: AppSettings):
    """Updates the notifications master toggle, send-all scope, and daily summary settings."""
    try:
        return update_app_settings(
            notifications_enabled=payload.notifications_enabled,
            send_all_enabled=payload.send_all_enabled,
            daily_summary_enabled=payload.daily_summary_enabled,
            daily_summary_mode=payload.daily_summary_mode,
            daily_summary_time=payload.daily_summary_time,
        )
    except Exception as e:
        logger.exception("Failed to update app settings")
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {str(e)}")


@app.post("/agent/query", response_model=AgentQueryResponse)
async def agent_query(request: AgentQueryRequest):
    """
    Answers a natural-language question about the user's tasks via the
    read-only AI agent in agent_engine.py. Isolated from the task
    extraction/CRUD system — only reads task data, never writes it.
    """
    if not request.question or not request.question.strip():
        raise HTTPException(status_code=422, detail="question cannot be empty")
    try:
        answer = agent_engine.ask_agent(request.question.strip())
        return AgentQueryResponse(answer=answer)
    except RuntimeError as e:
        logger.error(f"Agent query failed: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected error in /agent/query")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/dev/token-usage")
async def dev_token_usage():
    """Developer-only: not linked from main navigation, no auth (personal app)."""
    return token_tracker.get_usage_summary()