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
import time
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
Today is {today_str} (Europe/Athens timezone).

DATE RESOLUTION RULES:
- For a SINGLE specific day ("today", "tomorrow", a named weekday, a specific date), set BOTH date_from AND date_to to that SAME date. Leaving date_from empty when the user means one specific day is WRONG — it pulls in everything overdue from the past too.
- For a RANGE ("this week", "until the 2nd", "between X and Y"), set date_from and/or date_to to the actual bounds of that range.
- For "overdue" or "what's late" questions specifically, set date_to to today and leave date_from empty — that is the one case where an open lower bound is correct.

CATEGORY MATCHING:
- If the question mentions work, job, business, or professional matters (Greek: δουλειά, εργασία, επαγγελματικά) OR personal/home/family matters (Greek: προσωπικά, σπίτι, οικογένεια) — SET the category parameter accordingly, even if the wording is imperfect, informal, or slightly misspelled (e.g., "buisness" still means Business). Do not leave category empty out of caution when the concept is clearly present in the question. Only omit it when the question is genuinely category-agnostic.

KEYWORD SEARCHES ARE FUZZY, NOT LITERAL:
The keyword parameter does simple substring matching, which can miss real matches due to Greek word inflection (e.g., "ψώνια" won't literally match a task named "να ψωνίσω") or language mismatches between your search term and the task's actual wording. If a keyword-based search_tasks call returns zero or very few results but you suspect relevant tasks exist, retry search_tasks with the SAME date/category/priority filters but WITHOUT the keyword parameter, then read through the returned task names yourself and use your own judgment to identify which ones genuinely match what the user is asking about — don't rely solely on the tool's literal string match when your own semantic reading of the results would catch something the substring filter missed.

FILTER DISCIPLINE:
- Identify every constraint in the user's question (date/range, category, priority) and pass them together in your search_tasks call.
- If you make more than one search_tasks call for a single question (e.g., an initial filtered search, then the keyword-fallback broader search above), don't mix or confuse the two result sets — be clear about which one your final answer is actually drawing from.
- Your final answer must only describe tasks that are genuinely relevant to what the user asked — grounded in real search_tasks results (via the direct filter or the fuzzy fallback above), never invented.

UNDATED TASKS:
When search_tasks returns undated_matches_excluded > 0 for a date-filtered question, mention this briefly to the user (e.g., "there are also N tasks matching your other criteria but without a specific date set") so they know such tasks exist rather than assuming everything is covered by the date range.

RESULT LIMITS:
search_tasks caps results at 30 and truncates each description to 100 characters for efficiency. If the response's truncated field is true, mention that there are more matches than shown (total_matches tells you how many). Use get_task_details for a task's full, untruncated description when the user needs it.

THIS IS A SINGLE, SELF-CONTAINED QUESTION:
There is no conversation history — this question is answered independently, with no memory of anything asked in a previous, separate question. If the user's wording presupposes earlier context ("and the other one?", "what we discussed", "that thing from before"), you have no way to know what they mean. Say so plainly and ask them to restate the full question, rather than guessing.

IMPORTANT: Always respond in the SAME LANGUAGE the user asked their question in. If they ask in Greek, answer in Greek. If in English, answer in English.

Always use the search_tasks tool to look up real task data before answering — never invent or guess task information. If a question is about a specific task's details (like its checklist), first find it with search_tasks, then use get_task_details with its record_id for the full picture.

Keep answers concise, conversational, and formatted naturally for a chat message (not a bulleted report). If no tasks genuinely match — even after trying the keyword fallback above — say so plainly rather than apologizing excessively."""


MAX_SEARCH_RESULTS = 30
DESCRIPTION_TRUNCATE_LENGTH = 100


def ask_agent(question: str) -> str:
    """
    Sends a natural-language question to the agent. The SDK's Automatic
    Function Calling handles invoking search_tasks / get_task_details as
    many times as needed, then this returns the model's final text answer.

    Raises RuntimeError on any failure (API error after retries, or no
    usable response) so callers only need to handle one failure mode.
    """
    system_instruction = _build_agent_system_instruction()

    try:
        cached_tasks = repository.get_all_tasks_for_scheduler()
    except Exception as e:
        logging.error(f"[agent] Failed to fetch tasks: {e}")
        raise RuntimeError(f"Could not load task data: {e}")

    def search_tasks(
        date_from: str = None,
        date_to: str = None,
        category: Literal["Business", "Personal", "Unknown"] = None,
        priority: Literal["P1", "P2", "P3"] = None,
        keyword: str = None,
        include_completed: bool = False,
    ) -> dict:
        """Searches the user's tasks with optional filters. Use this to answer
        any question about what tasks exist, their dates, categories, or
        priorities. Call this first for almost any question before answering.

        Args:
            date_from: Earliest due_date to include, in YYYY-MM-DD format. Omit entirely for no lower bound.
            date_to: Latest due_date to include, in YYYY-MM-DD format. Omit entirely for no upper bound.
            category: Filter by category. Omit for all categories.
            priority: Filter by priority. Omit for all priorities.
            keyword: Free-text search matched (case-insensitive) against the task name and description. Omit for no keyword filter.
            include_completed: Whether to include tasks that are already marked completed. Defaults to False.

        Returns:
            A dict with:
            - tasks: list of matching tasks (capped at 30, descriptions truncated to 100 chars — use get_task_details for the full description of a specific task)
            - total_matches: the real total count before capping
            - truncated: true if total_matches exceeds what's in tasks
            - undated_matches_excluded: count of tasks that matched category/priority/keyword but were excluded ONLY because a date filter was applied and they have no due_date set. Mention this to the user if non-zero.
        """
        logging.info(f"[agent] search_tasks called: date_from={date_from}, date_to={date_to}, category={category}, priority={priority}, keyword={keyword}, include_completed={include_completed}")

        valid_categories = ["Business", "Personal", "Unknown"]
        if category and category not in valid_categories:
            raise ValueError(f"Invalid category '{category}'. Must be one of: {', '.join(valid_categories)}")

        valid_priorities = ["P1", "P2", "P3"]
        if priority and priority not in valid_priorities:
            raise ValueError(f"Invalid priority '{priority}'. Must be one of: {', '.join(valid_priorities)}")

        has_date_filter = bool(date_from or date_to)
        matching = []
        undated_excluded = 0

        for task in cached_tasks:
            if task.is_rejected:
                continue
            if not task.approval_status:
                continue
            if not include_completed and task.is_completed:
                continue

            matches_non_date_criteria = (
                (not category or task.category == category)
                and (not priority or task.priority == priority)
                and (not keyword or keyword.lower() in f"{task.task_name} {task.description or ''}".lower())
            )

            if has_date_filter and not task.due_date:
                if matches_non_date_criteria:
                    undated_excluded += 1
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

            matching.append(task)

        total_matches = len(matching)
        capped = matching[:MAX_SEARCH_RESULTS]

        results = []
        for task in capped:
            desc = task.description or ''
            if len(desc) > DESCRIPTION_TRUNCATE_LENGTH:
                desc = desc[:DESCRIPTION_TRUNCATE_LENGTH] + '...'
            results.append({
                "record_id": task.record_id,
                "task_name": task.task_name,
                "description": desc,
                "category": task.category,
                "priority": task.priority,
                "due_date": task.due_date,
                "due_time": task.due_time,
                "is_completed": task.is_completed,
            })

        logging.info(f"[agent] search_tasks returning {len(results)} of {total_matches} matches, undated_excluded={undated_excluded}")

        return {
            "tasks": results,
            "total_matches": total_matches,
            "truncated": total_matches > MAX_SEARCH_RESULTS,
            "undated_matches_excluded": undated_excluded,
        }

    def get_task_details(record_id: str) -> dict:
        """Gets full details of a single task by its record ID, including its
        checklist items and full (untruncated) description. Use this after
        search_tasks when the user wants more detail on a specific task.

        Args:
            record_id: The Airtable record ID of the task, as returned by search_tasks.

        Returns:
            A dict with all task fields including checklist (a list of {text, done} items), or an error message if not found.
        """
        logging.info(f"[agent] get_task_details called: record_id={record_id}")

        for task in cached_tasks:
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

    max_retries = 3
    last_error = None

    for attempt in range(max_retries):
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

            if response and response.text:
                try:
                    import token_tracker
                    token_tracker.log_token_usage("agent_query", response.usage_metadata)
                except ImportError:
                    pass  # token_tracker not yet present from a separate session; skip silently
                return response.text

            logging.warning(f"[agent] Attempt {attempt + 1}: empty response")
            last_error = "Empty response from model"

        except Exception as e:
            logging.error(f"[agent] Attempt {attempt + 1} failed: {e}")
            last_error = str(e)

        if attempt < max_retries - 1:
            time.sleep(2 ** attempt)

    raise RuntimeError(f"Agent query failed after {max_retries} attempts: {last_error}")
