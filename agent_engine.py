"""
Read-only Q&A agent for answering natural-language questions about the
user's tasks (e.g. "what do I have today?", "show my business tasks this week").

Architecturally isolated from ai_engine.py/services.py: this module only
calls repository.py's existing read function to fetch tasks, and never
touches task creation/update/delete. It uses the google-genai SDK's
Automatic Function Calling (AFC) — plain Python functions are passed as
`tools`, and the SDK handles schema generation, invocation, and looping
until a final text answer is produced.

The system instruction and tool logic are shared with other provider
implementations via agent_tools.py — see that module's docstring.
"""
import os
import logging
import time
from dotenv import load_dotenv
from google import genai
from google.genai import types

import repository  # READ-ONLY reuse — call existing functions, do not modify this module
import agent_tools

try:
    import token_tracker
except ImportError:
    token_tracker = None

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    raise RuntimeError("GOOGLE_API_KEY not found — check your .env file")

client = genai.Client(api_key=api_key)

GEMINI_AGENT_MODEL = "gemini-3.1-flash-lite-preview"


def ask_agent(question: str) -> str:
    """
    Sends a natural-language question to the agent via Gemini 3.1 Flash-Lite.
    The SDK's Automatic Function Calling handles invoking search_tasks /
    get_task_details as many times as needed, then this returns the
    model's final text answer.

    Raises RuntimeError on any failure (API error after retries, or no
    usable response) so callers only need to handle one failure mode.
    """
    system_instruction = agent_tools.build_system_instruction()

    try:
        cached_tasks = repository.get_all_tasks_for_scheduler()
    except Exception as e:
        logging.error(f"[agent] Failed to fetch tasks: {e}")
        raise RuntimeError(f"Could not load task data: {e}")

    search_tasks, get_task_details = agent_tools.build_tool_functions(cached_tasks)

    max_retries = 3
    last_error = None

    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=GEMINI_AGENT_MODEL,
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
                if token_tracker:
                    try:
                        token_tracker.log_token_usage("agent_query", response.usage_metadata, model=GEMINI_AGENT_MODEL)
                    except TypeError:
                        token_tracker.log_token_usage("agent_query", response.usage_metadata)
                return response.text

            logging.warning(f"[agent] Attempt {attempt + 1}: empty response")
            last_error = "Empty response from model"

        except Exception as e:
            logging.error(f"[agent] Attempt {attempt + 1} failed: {e}")
            last_error = str(e)

        if attempt < max_retries - 1:
            time.sleep(2 ** attempt)

    raise RuntimeError(f"Agent query failed after {max_retries} attempts: {last_error}")
