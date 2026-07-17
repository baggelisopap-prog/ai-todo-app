"""
Shared tool logic and system instruction used by BOTH agent provider
implementations. agent_engine.py (Gemini) uses these today; a future
agent_engine_deepseek.py (Session 2) will import the same functions,
keeping both providers behaviorally identical — same filtering rules,
same system instruction — with only the provider-specific calling
mechanics (Gemini's Automatic Function Calling vs a manual tool-calling
loop) differing between the two agent_engine*.py files.
"""
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

MAX_SEARCH_RESULTS = 30
DESCRIPTION_TRUNCATE_LENGTH = 100


def build_system_instruction() -> str:
    """Builds the agent's system instruction with the current Athens date
    injected, identical content regardless of which model provider is used."""
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
The keyword parameter does simple substring matching, which can miss real matches due to Greek word inflection (e.g., "ψώνια" won't literally match a task named "να ψωνίσω") or language mismatches between your search term and the task's actual wording. If a keyword-based search_tasks call returns zero or very few results but you suspect relevant tasks exist, retry search_tasks with the SAME date/category/priority filters but WITHOUT the keyword parameter, then read through the returned task names yourself and use your own judgment to identify which ones genuinely match what the user is asking about.

FILTER DISCIPLINE:
- Identify every constraint in the user's question (date/range, category, priority) and pass them together in your search_tasks call.
- If you make more than one search_tasks call for a single question, don't mix or confuse the two result sets — be clear about which one your final answer is actually drawing from.
- Your final answer must only describe tasks that are genuinely relevant to what the user asked — grounded in real search_tasks results, never invented.

UNDATED TASKS:
When search_tasks returns undated_matches_excluded > 0 for a date-filtered question, mention this briefly to the user so they know such tasks exist rather than assuming everything is covered by the date range.

RESULT LIMITS:
search_tasks caps results at 30 and truncates each description to 100 characters for efficiency. If the response's truncated field is true, mention that there are more matches than shown. Use get_task_details for a task's full, untruncated description.

THIS IS A SINGLE, SELF-CONTAINED QUESTION:
There is no conversation history — this question is answered independently. If the user's wording presupposes earlier context ("and the other one?", "what we discussed"), you have no way to know what they mean. Say so plainly and ask them to restate the full question, rather than guessing.

IMPORTANT: Always respond in the SAME LANGUAGE the user asked their question in.

Always use the search_tasks tool to look up real task data before answering — never invent or guess task information. If a question is about a specific task's details, first find it with search_tasks, then use get_task_details with its record_id.

Keep answers concise, conversational, and formatted naturally for a chat message. If no tasks genuinely match, say so plainly."""


def build_tool_functions(cached_tasks):
    """
    Returns (search_tasks, get_task_details) as closures over cached_tasks.
    Call this once per ask_agent() invocation with a freshly-fetched task
    list — both provider implementations use this same factory, ensuring
    identical per-request caching and filtering behavior regardless of
    which model answers.
    """

    def search_tasks(
        date_from: str = None,
        date_to: str = None,
        category: str = None,
        priority: str = None,
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
            A dict with tasks (capped at 30, descriptions truncated to 100 chars), total_matches, truncated, and undated_matches_excluded.
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

    return search_tasks, get_task_details


# JSON schemas for providers that need explicit tool definitions rather
# than automatic introspection (Gemini's Automatic Function Calling
# introspects the Python functions above directly and does NOT need
# these; a future OpenAI-compatible provider like DeepSeek, added in
# Session 2, will use these).
SEARCH_TASKS_SCHEMA = {
    "type": "function",
    "function": {
        "name": "search_tasks",
        "description": "Searches the user's tasks with optional filters. Use this to answer any question about what tasks exist, their dates, categories, or priorities. Call this first for almost any question before answering.",
        "parameters": {
            "type": "object",
            "properties": {
                "date_from": {"type": "string", "description": "Earliest due_date to include, in YYYY-MM-DD format. Omit entirely for no lower bound."},
                "date_to": {"type": "string", "description": "Latest due_date to include, in YYYY-MM-DD format. Omit entirely for no upper bound."},
                "category": {"type": "string", "enum": ["Business", "Personal", "Unknown"], "description": "Filter by category. Omit for all categories."},
                "priority": {"type": "string", "enum": ["P1", "P2", "P3"], "description": "Filter by priority. Omit for all priorities."},
                "keyword": {"type": "string", "description": "Free-text search matched (case-insensitive) against the task name and description. Omit for no keyword filter."},
                "include_completed": {"type": "boolean", "description": "Whether to include tasks that are already marked completed. Defaults to False."},
            },
            "required": [],
        },
    },
}

GET_TASK_DETAILS_SCHEMA = {
    "type": "function",
    "function": {
        "name": "get_task_details",
        "description": "Gets full details of a single task by its record ID, including its checklist items and full (untruncated) description. Use this after search_tasks when the user wants more detail on a specific task.",
        "parameters": {
            "type": "object",
            "properties": {
                "record_id": {"type": "string", "description": "The Airtable record ID of the task, as returned by search_tasks."},
            },
            "required": ["record_id"],
        },
    },
}
