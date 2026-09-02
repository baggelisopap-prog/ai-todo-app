import os
import time
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from google import genai
from google.genai import types, errors
from pydantic import ValidationError
from typing import Optional

import repository

# Import schemas from models.py
from models import TaskList
import token_tracker

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")

# Fail fast and loud if the API key is missing
if not api_key:
    raise RuntimeError("GOOGLE_API_KEY not found — check your .env file")

client = genai.Client(api_key=api_key)

# ==========================================
# SHARED PROMPT BUILDER
# ==========================================
def build_extraction_instruction(user_id: str, workspace_id=None) -> str:
    """
    The extraction instruction, with THIS workspace's category names appended.

    Scoped to ONE workspace on purpose. A model offered fifteen names across
    three workspaces makes mistakes a model offered five from one does not —
    and it is never asked to pick the workspace itself, because there is
    exactly one right answer available to us in code (the one the user is
    standing in, or their default) and none available to it.

    The old `category` line below is untouched: tasks.category is still the
    live column and is dropped only in a later slice, so the model still has
    to fill it.
    """
    base = _build_system_instruction()

    categories = repository.get_categories_for_workspace(user_id, workspace_id)
    if categories:
        names = ", ".join(c.name for c in categories)
        return base + (
            "\n- category_name: the user's own category for this task, EXACTLY one of: "
            f"{names}. Copy the name exactly as written above. If none of them fits, "
            "leave it out entirely — never invent a category name."
        )

    # Said explicitly rather than rendered as an empty list: an empty line reads
    # to a model like a malformed instruction, while "there are none" is one it
    # can obey.
    return base + (
        "\n- category_name: this user has no categories yet. Always leave it out."
    )


def _build_system_instruction() -> str:
    """Builds the shared system instruction with the current Athens date injected."""
    athens_now = datetime.now(ZoneInfo("Europe/Athens"))
    today_str = athens_now.strftime("%A, %Y-%m-%d")
    now_hhmm = athens_now.strftime("%H:%M")
    return f"""You are a task extraction system.
Today is {today_str} and the time right now is {now_hhmm} (Europe/Athens timezone).

IMPORTANT: Always respond in the SAME LANGUAGE as the user input. If the user writes in Greek, all task_name and description fields must be in Greek. If the user writes in English, respond in English. Never translate.

When extracting tasks:
- due_date must be YYYY-MM-DD format (resolve "tomorrow", "Friday", etc. to actual dates). If no date is mentioned, set to null. Never invent dates.
- due_time must be HH:MM 24-hour format. If no time is mentioned, set to null. Never invent times.
- A bare hour ("at 7", "στις 7") is ambiguous between morning and evening. Decide which the person MEANT, from the task itself and from the time right now: waking up or a gym session at 7 is 07:00; a meeting, dinner or drinks at 7 is 19:00. When the task gives no clue, prefer the reading closest to the current time of day — someone speaking in the evening about "7" usually means 19:00.
- Then place it on a day: today if that time is still ahead, otherwise TOMORROW at the same hour. Do NOT switch to the other half of the day to stay within today. Always set due_date when a time is given, and never produce a due_date + due_time already in the past.
- category: Business (work), Personal (life), Unknown (unclear).
- priority: P1 (urgent), P2 (normal), P3 (low).
- checklist: each item must be an object with 'text' (string) and 'done' (boolean, always false for new tasks). Example: [{{"text": "item 1", "done": false}}, {{"text": "item 2", "done": false}}]."""


# ==========================================
# EXTRACTION ENGINE
# ==========================================
def extract_tasks(raw_input: str, user_id: str, workspace_id=None) -> Optional[TaskList]:
    """
    Extracts structured task data from unstructured text.

    Note: Setting temperature=0.0 forces the model to be greedy (low-variance),
    but it is NOT strictly deterministic. Identical inputs can still theoretically
    yield different raw text. Our structural guarantees come entirely from the
    Pydantic validation layer below.
    """
    logging.info(f"Processing raw input: '{raw_input}'")

    system_instruction = build_extraction_instruction(user_id, workspace_id)

    max_retries = 3

    # Single retry budget covers API-level failures (429/5xx/network) AND
    # Pydantic validation failures — a model that returned malformed JSON is
    # a transient model-output problem, not a separate class of failure, so
    # it shares the same 3 attempts rather than getting its own retry budget.
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model="gemini-3.5-flash",
                contents=raw_input,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    response_mime_type="application/json",
                    response_schema=TaskList,
                    temperature=0.0,
                    # Structured extraction doesn't need reasoning — confirmed via SDK
                    # that gemini-3.5-flash has thinking on by default (observed ~200
                    # thinking tokens on a trivial prompt); thinking_budget=0 disables it.
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                )
            )

            # Guard the response: Model can occasionally return None/empty
            if not response or not response.text:
                logging.warning(f"Attempt {attempt + 1}: Received empty response from model.")
                if response is not None:
                    token_tracker.log_token_usage("extract_text_empty_attempt", response.usage_metadata, user_id=user_id)
                # Don't wait on the final attempt
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                continue

            response_text = response.text
            token_tracker.log_token_usage("extract_text", response.usage_metadata, user_id=user_id)

            # Parse and Validate with Pydantic
            try:
                # Note - The SDK populates `response.parsed` automatically,
                # but we deliberately re-parse manually here to cleanly catch and handle Pydantic ValidationErrors.
                parsed_data = TaskList.model_validate_json(response_text)
                logging.info("Successfully extracted and validated tasks.")
                return parsed_data
            except ValidationError as e:
                # A validation failure means the model's output didn't match
                # our schema this time — retry the call within the same
                # budget rather than failing outright, since another attempt
                # often produces conforming output.
                logging.error(f"Attempt {attempt + 1}: Pydantic Validation Error: The AI output violated our schema rules.")
                logging.error(f"Validation Details: {e}")
                logging.error(f"Raw Model Output was: {response_text}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                return None
            except Exception as e:
                # Deliberately broad: guards against any non-Pydantic surprise
                # in parsing (e.g. a malformed response object) that we don't
                # want to crash the caller for. Anything caught here is
                # unexpected enough that retrying wouldn't help.
                logging.error(f"Unexpected error during parsing: {e}")
                return None

        except errors.ClientError as e:
            # 4xx errors are the caller's/request's fault (bad request, payload
            # too large, invalid mime type, etc.) and won't succeed on retry —
            # EXCEPT 429 (rate limit), which is transient like a 5xx.
            if e.code == 429:
                logging.error(f"Attempt {attempt + 1}: Rate limited (429): {e}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                logging.error("Max retries reached after repeated rate limiting.")
                return None
            logging.error(f"Non-retryable client error ({e.code}): {e}")
            return None

        except errors.ServerError as e:
            logging.error(f"Attempt {attempt + 1} Server Error ({e.code}): {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            logging.error("Max retries reached. API extraction failed.")
            return None

        except (ConnectionError, TimeoutError) as e:
            logging.error(f"Attempt {attempt + 1} Network Error: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            logging.error("Max retries reached. API extraction failed.")
            return None

    return None


def extract_tasks_from_audio(audio_bytes: bytes, mime_type: str, user_id: str, workspace_id=None) -> Optional[TaskList]:
    """
    Extracts structured task data from an audio recording via Gemini multimodal input.
    Audio is sent inline and never stored to disk.
    """
    logging.info(f"Processing audio input: {len(audio_bytes)} bytes, type={mime_type}")

    system_instruction = build_extraction_instruction(user_id, workspace_id)

    max_retries = 3

    # Single retry budget covers API-level failures (429/5xx/network) AND
    # Pydantic validation failures — see extract_tasks for the reasoning.
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model="gemini-3.5-flash",
                contents=[{
                    "role": "user",
                    "parts": [
                        {"inline_data": {"mime_type": mime_type, "data": audio_bytes}},
                        {"text": "Listen to this audio recording and extract all tasks mentioned."},
                    ],
                }],
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    response_mime_type="application/json",
                    response_schema=TaskList,
                    temperature=0.0,
                    # Structured extraction doesn't need reasoning — see extract_tasks
                    # for the confirmed default-thinking-enabled finding.
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                )
            )

            # Guard the response: Model can occasionally return None/empty
            if not response or not response.text:
                logging.warning(f"Attempt {attempt + 1}: Received empty response from model.")
                if response is not None:
                    token_tracker.log_token_usage("extract_voice_empty_attempt", response.usage_metadata, user_id=user_id)
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                continue

            response_text = response.text
            token_tracker.log_token_usage("extract_voice", response.usage_metadata, user_id=user_id)

            # Parse and Validate with Pydantic
            try:
                parsed_data = TaskList.model_validate_json(response_text)
                logging.info("Successfully extracted and validated tasks from audio.")
                return parsed_data
            except ValidationError as e:
                logging.error(f"Attempt {attempt + 1}: Pydantic Validation Error: The AI audio output violated our schema rules.")
                logging.error(f"Validation Details: {e}")
                logging.error(f"Raw Model Output was: {response_text}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                return None
            except Exception as e:
                logging.error(f"Unexpected error during audio parsing: {e}")
                return None

        except errors.ClientError as e:
            # 4xx errors are the caller's/request's fault and won't succeed on
            # retry — EXCEPT 429 (rate limit), which is transient like a 5xx.
            if e.code == 429:
                logging.error(f"Attempt {attempt + 1}: Rate limited (429): {e}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                logging.error("Max retries reached after repeated rate limiting.")
                return None
            logging.error(f"Non-retryable client error ({e.code}): {e}")
            return None

        except errors.ServerError as e:
            logging.error(f"Attempt {attempt + 1} Server Error ({e.code}): {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            logging.error("Max retries reached. Audio API extraction failed.")
            return None

        except (ConnectionError, TimeoutError) as e:
            logging.error(f"Attempt {attempt + 1} Network Error: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            logging.error("Max retries reached. Audio API extraction failed.")
            return None

    return None


def extract_tasks_from_image(image_bytes: bytes, mime_type: str, user_id: str, additional_context: str = None, workspace_id=None) -> Optional[TaskList]:
    """
    Extracts structured task data from an image via Gemini multimodal input.
    Image is sent inline and never stored to disk.
    """
    logging.info(f"Processing image input: {len(image_bytes)} bytes, type={mime_type}")

    system_instruction = build_extraction_instruction(user_id, workspace_id)

    parts = [
        {"inline_data": {"mime_type": mime_type, "data": image_bytes}},
        {"text": "Look at this image and extract all tasks mentioned. Handwritten notes, receipts, screenshots, whiteboards, and typed text all qualify. If the image contains multiple distinct action items, return them as separate tasks."},
    ]
    if additional_context and additional_context.strip():
        parts.append({"text": f"Additional context from the user (use this to help interpret the image, e.g. dates/times not visible in the image itself): {additional_context.strip()}"})

    max_retries = 3

    # Single retry budget covers API-level failures (429/5xx/network) AND
    # Pydantic validation failures — see extract_tasks for the reasoning.
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model="gemini-3.5-flash",
                contents=[{
                    "role": "user",
                    "parts": parts,
                }],
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    response_mime_type="application/json",
                    response_schema=TaskList,
                    temperature=0.0,
                    # Structured extraction doesn't need reasoning — see extract_tasks
                    # for the confirmed default-thinking-enabled finding.
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                )
            )

            # Guard the response: Model can occasionally return None/empty
            if not response or not response.text:
                logging.warning(f"Attempt {attempt + 1}: Received empty response from model.")
                if response is not None:
                    token_tracker.log_token_usage("extract_image_empty_attempt", response.usage_metadata, user_id=user_id)
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                continue

            response_text = response.text
            token_tracker.log_token_usage("extract_image", response.usage_metadata, user_id=user_id)

            # Parse and Validate with Pydantic
            try:
                parsed_data = TaskList.model_validate_json(response_text)
                logging.info("Successfully extracted and validated tasks from image.")
                return parsed_data
            except ValidationError as e:
                logging.error(f"Attempt {attempt + 1}: Pydantic Validation Error: The AI image output violated our schema rules.")
                logging.error(f"Validation Details: {e}")
                logging.error(f"Raw Model Output was: {response_text}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                return None
            except Exception as e:
                logging.error(f"Unexpected error during image parsing: {e}")
                return None

        except errors.ClientError as e:
            # 4xx errors are the caller's/request's fault and won't succeed on
            # retry — EXCEPT 429 (rate limit), which is transient like a 5xx.
            if e.code == 429:
                logging.error(f"Attempt {attempt + 1}: Rate limited (429): {e}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                logging.error("Max retries reached after repeated rate limiting.")
                return None
            logging.error(f"Non-retryable client error ({e.code}): {e}")
            return None

        except errors.ServerError as e:
            logging.error(f"Attempt {attempt + 1} Server Error ({e.code}): {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            logging.error("Max retries reached. Image API extraction failed.")
            return None

        except (ConnectionError, TimeoutError) as e:
            logging.error(f"Attempt {attempt + 1} Network Error: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            logging.error("Max retries reached. Image API extraction failed.")
            return None

    return None
