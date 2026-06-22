import os
import json
import logging
from typing import Optional
from dotenv import load_dotenv
from pyairtable import Api
from models import TaskRecord

# Set up module-level logging
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

class AirtableTaskRepository:
    """
    Repository layer for managing TaskRecord persistence in Airtable.
    Handles all translation between Pydantic models and Airtable's specific JSON structure.
    """

    def __init__(self):
        """
        Initializes the Airtable client and verifies environment configuration.
        Fails fast with a RuntimeError if required variables are missing.
        """
        token = os.getenv("AIRTABLE_TOKEN")
        base_id = os.getenv("AIRTABLE_BASE_ID")
        table_id = os.getenv("AIRTABLE_TABLE_ID")

        if not all([token, base_id, table_id]):
            raise RuntimeError(
                "Missing Airtable configuration. Ensure AIRTABLE_TOKEN, AIRTABLE_BASE_ID, "
                "and AIRTABLE_TABLE_ID are set in your .env file."
            )

        self.api = Api(token)
        self.table = self.api.table(base_id, table_id)
        logger.info(f"AirtableTaskRepository initialized (Base: {base_id}, Table: {table_id})")

    def _task_to_airtable_fields(self, task: TaskRecord) -> dict:
        """
        Translates a Pydantic TaskRecord into an Airtable-ready fields dictionary.
        Handles serialization of nested types (like lists to JSON strings).
        Strips server-generated metadata (record_id, created_time).
        """
        # Convert Pydantic object to dict
        fields = task.model_dump()
        
        # Remove server-generated fields that Airtable will reject if sent
        fields.pop("record_id", None)
        fields.pop("created_time", None)

        # Airtable expects lists to be JSON strings if storing in a Long Text field
        fields["checklist"] = json.dumps(fields.get("checklist", []), ensure_ascii=False)

        return fields

    def _airtable_to_task(self, airtable_record: dict) -> TaskRecord:
        """
        Translates a raw Airtable API response dictionary back into a Pydantic TaskRecord.
        Handles deserialization (JSON strings to lists) and extracts top-level metadata.
        """
        fields = airtable_record.get("fields", {})
        
        # Extract top-level metadata
        record_id = airtable_record.get("id")
        created_time = airtable_record.get("createdTime")

        # Parse checklist from JSON string back to a Python list
        raw_checklist = fields.get("checklist")
        if raw_checklist:
            try:
                checklist = json.loads(raw_checklist)
            except json.JSONDecodeError:
                logger.error(f"Failed to parse checklist JSON for record {record_id}: {raw_checklist}")
                checklist = []
        else:
            checklist = []

        # Normalize to new format; accept legacy list[str] and new list[dict] transparently
        normalized = []
        for item in checklist:
            if isinstance(item, str):
                normalized.append({"text": item, "done": False})
            elif isinstance(item, dict) and "text" in item:
                normalized.append({"text": item["text"], "done": item.get("done", False)})
        checklist = normalized

        # Enforce strict data integrity on immutable snapshot fields
        if "ai_suggested_category" not in fields:
            raise ValueError(
                f"Record {record_id} is missing ai_suggested_category. "
                "This is a data integrity issue — the field should never be empty."
            )
        if "ai_suggested_priority" not in fields:
            raise ValueError(
                f"Record {record_id} is missing ai_suggested_priority. "
                "This is a data integrity issue — the field should never be empty."
            )

        # Construct the Pydantic object, providing safe defaults for fields Airtable might omit
        return TaskRecord(
            task_name=fields.get("task_name", ""),
            description=fields.get("description", ""),
            category=fields.get("category", "Unknown"),
            priority=fields.get("priority", "P3"),
            due_date=fields.get("due_date", None),
            due_time=fields.get("due_time", None),
            checklist=checklist,
            approval_status=fields.get("approval_status", False),
            is_completed=fields.get("is_completed", False),
            is_rejected=fields.get("is_rejected", False),
            ai_suggested_category=fields["ai_suggested_category"],
            ai_suggested_priority=fields["ai_suggested_priority"],
            record_id=record_id,
            created_time=created_time
        )

    def save_task(self, task: TaskRecord) -> TaskRecord:
        """
        Creates a new task record in Airtable.
        Returns a new TaskRecord instance containing the server-generated record_id and created_time.
        """
        fields_dict = self._task_to_airtable_fields(task)
        
        # Execute the network call
        response = self.table.create(fields_dict)
        
        # Log success
        logger.info(f"Successfully saved new task to Airtable. Assigned ID: {response.get('id')}")
        
        # Return a fresh Pydantic model built from the server response
        return self._airtable_to_task(response)

    def get_all_tasks(self) -> list[TaskRecord]:
        """
        Retrieves all task records currently stored in Airtable.
        """
        records = self.table.all()
        logger.info(f"Retrieved {len(records)} tasks from Airtable.")
        return [self._airtable_to_task(record) for record in records]

    def get_task(self, record_id: str) -> Optional[TaskRecord]:
        """
        Retrieves a single task by its Airtable record_id.
        Returns None if the record does not exist.
        """
        try:
            record = self.table.get(record_id)
            return self._airtable_to_task(record)
        except Exception as e:
            # Catching a broad exception here because pyairtable's specific HTTP error classes 
            # can vary, and our requirement is strictly "return None if not found/failed".
            logger.warning(f"Failed to retrieve task with ID {record_id}: {e}")
            return None

    def update_task(self, record_id: str, updates: dict) -> TaskRecord:
        """
        Updates specific fields on an existing Airtable task.
        Applies data mapping (like JSON encoding) to the update dictionary before sending.
        Returns the fully updated TaskRecord.
        """
        # Work on a copy so we don't mutate the caller's dict
        mapped_updates = updates.copy()

        # Apply data mapping rules to the partial update dictionary
        if "checklist" in mapped_updates:
            serializable = [
                item if isinstance(item, dict) else item.model_dump()
                for item in mapped_updates["checklist"]
            ]
            mapped_updates["checklist"] = json.dumps(serializable, ensure_ascii=False)
            
        # Prevent accidental overwrites of read-only fields
        mapped_updates.pop("record_id", None)
        mapped_updates.pop("created_time", None)

        response = self.table.update(record_id, mapped_updates)
        
        logger.info(f"Successfully updated task in Airtable. ID: {record_id}")
        return self._airtable_to_task(response)