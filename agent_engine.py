"""
Read-only Q&A agent for answering natural-language questions about the
user's tasks (e.g. "what do I have today?", "show my business tasks this week").

Architecturally isolated from ai_engine.py/services.py: this module only
calls repository.py's existing read function to fetch tasks, and never
touches task creation/update/delete. It runs its own manual tool-calling
loop against the google-genai SDK rather than the SDK's Automatic
Function Calling (AFC): AFC's own usage_metadata reporting was found to
undercount total token usage by roughly half in real-world testing
against Google AI Studio's own dashboard, because the final response's
usage_metadata only reflects the LAST internal AFC round, not the
cumulative total across every round. Running the loop manually lets us
sum usage_metadata after every round ourselves. Plain Python functions
are still passed as `tools`, so the SDK still auto-generates their JSON
schema — only the auto-execute/auto-loop behavior is disabled.

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
MAX_TOOL_ROUNDS = 6


class _SummedUsage:
    """Container matching the attribute names token_tracker.log_token_usage()
    already expects, holding the SUM of usage across all manual loop rounds
    (rather than just the last round, which is what AFC's response.usage_metadata
    alone would have given us — that was the source of the undercounting)."""
    def __init__(self, prompt_tokens, output_tokens, total_tokens):
        self.prompt_token_count = prompt_tokens
        self.candidates_token_count = output_tokens
        self.total_token_count = total_tokens


def ask_agent(question: str, user_id: str) -> dict:
    """
    Sends a natural-language question to the agent via Gemini 3.1 Flash-Lite,
    with Automatic Function Calling DISABLED so we can manually run the
    tool-calling loop and accurately sum token usage across every round.

    Returns {"answer": str, "proposed_actions": list[dict]} — proposed_actions
    is populated when the agent calls one of the propose_* write tools
    (agent_tools.build_write_proposal_tools) in the course of answering.
    Those tools only ever record intent; nothing is written to the database
    here. Raises RuntimeError on any failure so callers only need to handle
    one failure mode.
    """
    system_instruction = agent_tools.build_system_instruction()

    try:
        cached_tasks = repository.get_tasks_for_user(user_id=user_id)
    except Exception as e:
        logging.error(f"[agent] Failed to fetch tasks: {e}")
        raise RuntimeError(f"Could not load task data: {e}")

    proposed_actions = []

    search_tasks, get_task_details = agent_tools.build_tool_functions(cached_tasks)
    propose_complete_task, propose_update_task, propose_create_task = agent_tools.build_write_proposal_tools(
        proposed_actions, cached_tasks
    )
    all_tools = [
        search_tasks, get_task_details,
        propose_complete_task, propose_update_task, propose_create_task,
    ]
    tool_functions = {
        "search_tasks": search_tasks,
        "get_task_details": get_task_details,
        "propose_complete_task": propose_complete_task,
        "propose_update_task": propose_update_task,
        "propose_create_task": propose_create_task,
    }

    contents = [
        types.Content(role="user", parts=[types.Part.from_text(text=question)])
    ]

    total_prompt_tokens = 0
    total_output_tokens = 0
    total_tokens_sum = 0
    total_thinking_tokens = 0
    total_cached_tokens = 0

    def _log_run_summary(outcome: str, rounds_used: int):
        logging.info(
            f"[agent][SUMMARY] outcome={outcome} rounds={rounds_used} "
            f"prompt={total_prompt_tokens} output={total_output_tokens} "
            f"thinking={total_thinking_tokens} cached={total_cached_tokens} "
            f"total={total_tokens_sum}"
        )

    for round_num in range(MAX_TOOL_ROUNDS):
        response = None
        last_error = None
        max_retries = 3

        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model=GEMINI_AGENT_MODEL,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        tools=all_tools,
                        automatic_function_calling=types.AutomaticFunctionCallingConfig(
                            disable=True,
                        ),
                    ),
                )
                break
            except Exception as e:
                logging.error(f"[agent] Round {round_num + 1}, attempt {attempt + 1} failed: {e}")
                last_error = str(e)
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)

        if response is None:
            _log_run_summary("api_failure", round_num + 1)
            raise RuntimeError(f"Agent query failed after {max_retries} attempts: {last_error}")

        round_prompt = round_output = round_total = 0
        round_thinking = round_cached = 0
        if response.usage_metadata:
            um = response.usage_metadata
            round_prompt = um.prompt_token_count or 0
            round_output = um.candidates_token_count or 0
            round_total = um.total_token_count or 0
            # getattr: these attributes may be absent on some SDK versions
            round_thinking = getattr(um, "thoughts_token_count", 0) or 0
            round_cached = getattr(um, "cached_content_token_count", 0) or 0
            total_prompt_tokens += round_prompt
            total_output_tokens += round_output
            total_tokens_sum += round_total
            total_thinking_tokens += round_thinking
            total_cached_tokens += round_cached

        function_calls = response.function_calls
        called_tools = [fc.name for fc in function_calls] if function_calls else []
        logging.info(
            f"[agent][round {round_num + 1}] prompt={round_prompt} "
            f"output={round_output} thinking={round_thinking} "
            f"cached={round_cached} total={round_total} tools={called_tools}"
        )

        if not function_calls:
            if response.text:
                if token_tracker:
                    summed = _SummedUsage(total_prompt_tokens, total_output_tokens, total_tokens_sum)
                    token_tracker.log_token_usage("agent_query", summed, model=GEMINI_AGENT_MODEL, user_id=user_id)
                _log_run_summary("ok", round_num + 1)
                return {"answer": response.text, "proposed_actions": proposed_actions}
            _log_run_summary("no_answer", round_num + 1)
            raise RuntimeError("Agent produced no answer")

        # Append the model's turn (containing the function call(s)) to the conversation
        contents.append(response.candidates[0].content)

        # Execute each requested function, collect results as function_response parts
        function_response_parts = []
        for fc in function_calls:
            func = tool_functions.get(fc.name)
            if func is None:
                result = {"error": f"Unknown function: {fc.name}"}
            else:
                try:
                    result = func(**fc.args)
                except Exception as e:
                    result = {"error": str(e)}
            function_response_parts.append(
                types.Part.from_function_response(name=fc.name, response=result)
            )

        contents.append(types.Content(role="user", parts=function_response_parts))

    _log_run_summary("max_rounds", MAX_TOOL_ROUNDS)
    raise RuntimeError("Agent exceeded maximum tool-call rounds without a final answer")
