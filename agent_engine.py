"""
Read-only Q&A agent for answering natural-language questions about the
user's tasks (e.g. "what do I have today?", "show my business tasks this week").

Architecturally isolated from ai_engine.py/services.py: this module only
calls repository.py's existing read function to fetch tasks, and never
touches task creation/update/delete. It uses the google-genai SDK's
Automatic Function Calling (AFC) — plain Python functions are passed as
`tools`, and the SDK handles schema generation, invocation, and looping
until a final text answer is produced.
"""
import os
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Literal
from dotenv import load_dotenv
from google import genai
from google.genai import types

import repository  # READ-ONLY reuse — call existing functions, do not modify this module

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    raise RuntimeError("GOOGLE_API_KEY not found — check your .env file")

client = genai.Client(api_key=api_key)


def _build_agent_system_instruction() -> str:
    """Mirrors the date-injection pattern already used in ai_engine.py's
    _build_system_instruction(), adapted for the agent's Q&A purpose."""
    athens_now = datetime.now(ZoneInfo("Europe/Athens"))
    today_str = athens_now.strftime("%A, %Y-%m-%d")
    return f"""You are a helpful assistant that answers questions about the user's personal to-do list.
Today is {today_str} (Europe/Athens timezone). Use this to resolve relative dates like "today", "tomorrow", "this week", "until the 2nd of the month", etc. into actual YYYY-MM-DD dates when calling tools.

IMPORTANT: Always respond in the SAME LANGUAGE the user asked their question in. If they ask in Greek, answer in Greek. If in English, answer in English.

Always use the search_tasks tool to look up real task data before answering — never invent or guess task information. If a question is about a specific task's details (like its checklist), first find it with search_tasks, then use get_task_details with its record_id for the full picture.

Keep answers concise, conversational, and formatted naturally for a chat message (not a bulleted report). If no tasks match, say so plainly rather than apologizing excessively."""


def search_tasks(
    date_from: str = None,
    date_to: str = None,
    category: Literal["Business", "Personal", "Unknown"] = None,
    priority: Literal["P1", "P2", "P3"] = None,
    keyword: str = None,
    include_completed: bool = False,
) -> list[dict]:
    """Searches the user's tasks with optional filters. Use this to answer
    any question about what tasks exist, their dates, categories, or
    priorities. Call this first for almost any question before answering.

    Args:
        date_from: Earliest due_date to include, in YYYY-MM-DD format. Omit entirely (do not pass) for no lower bound.
        date_to: Latest due_date to include, in YYYY-MM-DD format. Omit entirely for no upper bound.
        category: Filter by category. Omit for all categories.
        priority: Filter by priority. Omit for all priorities.
        keyword: Free-text search matched (case-insensitive) against the task name and description. Omit for no keyword filter.
        include_completed: Whether to include tasks that are already marked completed. Defaults to False (most questions are about upcoming/pending work).

    Returns:
        A list of matching tasks. Each task is a dict with: record_id, task_name, description, category, priority, due_date, due_time, is_completed.
    """
    logging.info(f"[agent] search_tasks called: date_from={date_from}, date_to={date_to}, category={category}, priority={priority}, keyword={keyword}, include_completed={include_completed}")

    # Defensive validation (Level 2) — belt-and-suspenders backup to the
    # Literal type constraint (Level 1) above. If this ever fires, the SDK's
    # Automatic Function Calling catches the exception, converts it to an
    # error response, and sends it back to the model, which can retry with
    # a corrected value in the same function-calling loop.
    valid_categories = ["Business", "Personal", "Unknown"]
    if category and category not in valid_categories:
        raise ValueError(f"Invalid category '{category}'. Must be one of: {', '.join(valid_categories)}")

    valid_priorities = ["P1", "P2", "P3"]
    if priority and priority not in valid_priorities:
        raise ValueError(f"Invalid priority '{priority}'. Must be one of: {', '.join(valid_priorities)}")

    all_tasks = repository.get_all_tasks_for_scheduler()

    results = []
    for task in all_tasks:
        if task.is_rejected:
            continue
        if not task.approval_status:
            continue  # exclude pending Inbox items from agent answers
        if not include_completed and task.is_completed:
            continue
        if date_from and (not task.due_date or task.due_date < date_from):
            continue
        if date_to and (not task.due_date or task.due_date > date_to):
            continue
        if category and task.category != category:
            continue
        if priority and task.priority != priority:
            continue
        if keyword:
            haystack = f"{task.task_name} {task.description or ''}".lower()
            if keyword.lower() not in haystack:
                continue
        results.append({
            "record_id": task.record_id,
            "task_name": task.task_name,
            "description": task.description,
            "category": task.category,
            "priority": task.priority,
            "due_date": task.due_date,
            "due_time": task.due_time,
            "is_completed": task.is_completed,
        })

    logging.info(f"[agent] search_tasks returning {len(results)} results")
    return results


def get_task_details(record_id: str) -> dict:
    """Gets full details of a single task by its record ID, including its
    checklist items. Use this after search_tasks when the user wants more
    detail on a specific task (e.g., "what's on the shopping list task").

    Args:
        record_id: The Airtable record ID of the task, as returned by search_tasks.

    Returns:
        A dict with all task fields including checklist (a list of {text, done} items), or an error message if not found.
    """
    logging.info(f"[agent] get_task_details called: record_id={record_id}")

    all_tasks = repository.get_all_tasks_for_scheduler()
    for task in all_tasks:
        if task.record_id == record_id:
            return {
                "record_id": task.record_id,
                "task_name": task.task_name,
                "description": task.description,
                "category": task.category,
                "priority": task.priority,
                "due_date": task.due_date,
                "due_time": task.due_time,
                "is_completed": task.is_completed,
                "checklist": [{"text": item.text, "done": item.done} for item in (task.checklist or [])],
            }
    return {"error": "Task not found"}


def ask_agent(question: str) -> str:
    """
    Sends a natural-language question to the agent. The SDK's Automatic
    Function Calling handles invoking search_tasks / get_task_details as
    many times as needed, then this returns the model's final text answer.
    """
    system_instruction = _build_agent_system_instruction()

    try:
        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=question,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                tools=[search_tasks, get_task_details],
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    maximum_remote_calls=6,
                ),
            ),
        )
    except Exception as e:
        logging.error(f"[agent] Gemini call failed: {e}")
        raise RuntimeError(f"Agent query failed: {e}")

    if not response or not response.text:
        return "Δεν μπόρεσα να βρω απάντηση. Δοκίμασε να διατυπώσεις διαφορετικά την ερώτησή σου."

    return response.text
