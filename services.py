import logging
from typing import Optional
from models import SingleTask, TaskList, TaskRecord
from ai_engine import extract_tasks, extract_tasks_from_audio, extract_tasks_from_image
from repository import AirtableTaskRepository

logger = logging.getLogger(__name__)

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