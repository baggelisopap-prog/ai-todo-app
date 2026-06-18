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
from fastapi import FastAPI, HTTPException, status, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from models import TaskRecord
from services import TaskService
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
    checklist: Optional[list[str]] = None

class HealthResponse(BaseModel):
    status: str
    service: str

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

# Audio upload constraints
MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_AUDIO_MIME_PREFIX = "audio/"

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