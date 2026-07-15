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

# Import schemas from models.py
from models import SingleTask, TaskList

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
def _build_system_instruction() -> str:
    """Builds the shared system instruction with the current Athens date injected."""
    athens_now = datetime.now(ZoneInfo("Europe/Athens"))
    today_str = athens_now.strftime("%A, %Y-%m-%d")
    return f"""You are a task extraction system.
Today is {today_str} (Europe/Athens timezone).

IMPORTANT: Always respond in the SAME LANGUAGE as the user input. If the user writes in Greek, all task_name and description fields must be in Greek. If the user writes in English, respond in English. Never translate.

When extracting tasks:
- due_date must be YYYY-MM-DD format (resolve "tomorrow", "Friday", etc. to actual dates). If no date is mentioned, set to null. Never invent dates.
- due_time must be HH:MM 24-hour format. If no time is mentioned, set to null. Never invent times.
- category: Business (work), Personal (life), Unknown (unclear).
- priority: P1 (urgent), P2 (normal), P3 (low).
- checklist: each item must be an object with 'text' (string) and 'done' (boolean, always false for new tasks). Example: [{{"text": "item 1", "done": false}}, {{"text": "item 2", "done": false}}]."""


# ==========================================
# EXTRACTION ENGINE
# ==========================================
def extract_tasks(raw_input: str) -> Optional[TaskList]:
    """
    Extracts structured task data from unstructured text.

    Note: Setting temperature=0.0 forces the model to be greedy (low-variance),
    but it is NOT strictly deterministic. Identical inputs can still theoretically
    yield different raw text. Our structural guarantees come entirely from the
    Pydantic validation layer below.
    """
    logging.info(f"Processing raw input: '{raw_input}'")

    system_instruction = _build_system_instruction()

    max_retries = 3
    response_text = None

    # 1. API Call with Exponential Backoff
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model="gemini-3.5-flash",
                contents=raw_input,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    response_mime_type="application/json",
                    response_schema=TaskList,
                   
                )
            )

            # Guard the response: Model can occasionally return None/empty
            if not response or not response.text:
                logging.warning(f"Attempt {attempt + 1}: Received empty response from model.")
                # Don't wait on the final attempt
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                continue

            response_text = response.text
            break # Success, exit the retry loop

        # Widened catch to gracefully handle both SDK API errors AND raw transport/network drops.
        except (errors.APIError, ConnectionError, TimeoutError) as e:
            logging.error(f"Attempt {attempt + 1} API/Network Error: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                logging.error("Max retries reached. API extraction failed.")
                return None

    # If the loop finished without ever getting text
    if not response_text:
        return None

    # Parse and Validate with Pydantic
    try:
        # Note - The SDK populates `response.parsed` automatically,
        # but we deliberately re-parse manually here to cleanly catch and handle Pydantic ValidationErrors.
        parsed_data = TaskList.model_validate_json(response_text)
        logging.info("Successfully extracted and validated tasks.")
        return parsed_data

    except ValidationError as e:
        # Handle structural/sanity failures without crashing the app
        logging.error(f"Pydantic Validation Error: The AI output violated our schema rules.")
        logging.error(f"Validation Details: {e}")
        logging.error(f"Raw Model Output was: {response_text}")
        return None
    except Exception as e:
        logging.error(f"Unexpected error during parsing: {e}")
        return None


def extract_tasks_from_audio(audio_bytes: bytes, mime_type: str) -> Optional[TaskList]:
    """
    Extracts structured task data from an audio recording via Gemini multimodal input.
    Audio is sent inline and never stored to disk.
    """
    logging.info(f"Processing audio input: {len(audio_bytes)} bytes, type={mime_type}")

    system_instruction = _build_system_instruction()

    max_retries = 3
    response_text = None

    # 1. API Call with Exponential Backoff
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
                    
                )
            )

            # Guard the response: Model can occasionally return None/empty
            if not response or not response.text:
                logging.warning(f"Attempt {attempt + 1}: Received empty response from model.")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                continue

            response_text = response.text
            break  # Success, exit the retry loop

        # Widened catch to gracefully handle both SDK API errors AND raw transport/network drops.
        except (errors.APIError, ConnectionError, TimeoutError) as e:
            logging.error(f"Attempt {attempt + 1} API/Network Error: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                logging.error("Max retries reached. Audio API extraction failed.")
                return None

    # If the loop finished without ever getting text
    if not response_text:
        return None

    # Parse and Validate with Pydantic
    try:
        parsed_data = TaskList.model_validate_json(response_text)
        logging.info("Successfully extracted and validated tasks from audio.")
        return parsed_data

    except ValidationError as e:
        logging.error(f"Pydantic Validation Error: The AI audio output violated our schema rules.")
        logging.error(f"Validation Details: {e}")
        logging.error(f"Raw Model Output was: {response_text}")
        return None
    except Exception as e:
        logging.error(f"Unexpected error during audio parsing: {e}")
        return None


def extract_tasks_from_image(image_bytes: bytes, mime_type: str, additional_context: str = None) -> Optional[TaskList]:
    """
    Extracts structured task data from an image via Gemini multimodal input.
    Image is sent inline and never stored to disk.
    """
    logging.info(f"Processing image input: {len(image_bytes)} bytes, type={mime_type}")

    system_instruction = _build_system_instruction()

    parts = [
        {"inline_data": {"mime_type": mime_type, "data": image_bytes}},
        {"text": "Look at this image and extract all tasks mentioned. Handwritten notes, receipts, screenshots, whiteboards, and typed text all qualify. If the image contains multiple distinct action items, return them as separate tasks."},
    ]
    if additional_context and additional_context.strip():
        parts.append({"text": f"Additional context from the user (use this to help interpret the image, e.g. dates/times not visible in the image itself): {additional_context.strip()}"})

    max_retries = 3
    response_text = None

    # 1. API Call with Exponential Backoff
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
                )
            )

            # Guard the response: Model can occasionally return None/empty
            if not response or not response.text:
                logging.warning(f"Attempt {attempt + 1}: Received empty response from model.")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                continue

            response_text = response.text
            break  # Success, exit the retry loop

        # Widened catch to gracefully handle both SDK API errors AND raw transport/network drops.
        except (errors.APIError, ConnectionError, TimeoutError) as e:
            logging.error(f"Attempt {attempt + 1} API/Network Error: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                logging.error("Max retries reached. Image API extraction failed.")
                return None

    # If the loop finished without ever getting text
    if not response_text:
        return None

    # Parse and Validate with Pydantic
    try:
        parsed_data = TaskList.model_validate_json(response_text)
        logging.info("Successfully extracted and validated tasks from image.")
        return parsed_data

    except ValidationError as e:
        logging.error(f"Pydantic Validation Error: The AI image output violated our schema rules.")
        logging.error(f"Validation Details: {e}")
        logging.error(f"Raw Model Output was: {response_text}")
        return None
    except Exception as e:
        logging.error(f"Unexpected error during image parsing: {e}")
        return None
