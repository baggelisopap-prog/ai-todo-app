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
import json
import os
import logging
import time
import uuid
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
MAX_TOOL_ROUNDS = 4

# A runaway tool result is the only real risk in agent_runs.rounds_detail —
# this is far above any real tool result (search_tasks caps at 30 rows).
TOOL_RESULT_LOG_MAX_CHARS = 20000


class _SummedUsage:
    """Container matching the attribute names token_tracker.log_token_usage()
    already expects, holding the SUM of usage across all manual loop rounds
    (rather than just the last round, which is what AFC's response.usage_metadata
    alone would have given us — that was the source of the undercounting)."""
    def __init__(self, prompt_tokens, output_tokens, total_tokens):
        self.prompt_token_count = prompt_tokens
        self.candidates_token_count = output_tokens
        self.total_token_count = total_tokens


def _serialize_tool_result(result) -> str:
    """Renders a tool's return value to a string for agent_runs.rounds_detail,
    truncated so one runaway result can't blow up the row."""
    try:
        text = json.dumps(result, ensure_ascii=False, default=str)
    except Exception:
        text = str(result)
    if len(text) > TOOL_RESULT_LOG_MAX_CHARS:
        text = text[:TOOL_RESULT_LOG_MAX_CHARS] + "…[truncated]"
    return text


def _finish_reason_of(response) -> str | None:
    """Best-effort extraction of the first candidate's finish_reason as a
    plain string, tolerant of SDK enum vs string differences."""
    if not response.candidates:
        return None
    fr = getattr(response.candidates[0], "finish_reason", None)
    if fr is None:
        return None
    return getattr(fr, "name", None) or str(fr)


def ask_agent(question: str, user_id: str, conversation_id: str = None) -> dict:
    """
    Sends a natural-language question to the agent via Gemini 3.1 Flash-Lite,
    with Automatic Function Calling DISABLED so we can manually run the
    tool-calling loop and accurately sum token usage across every round.

    Bounded, server-reconstructed conversation memory: the caller never
    sends history, only conversation_id. This function loads the last
    HISTORY_MAX_PAIRS runs itself (repository.get_recent_agent_runs, 4 runs
    = 8 replayed messages) and replays them ahead of the current turn purely
    so the model can resolve references like "it" — every limit (message
    count, per-message length, refs count) is enforced here and in
    agent_tools, never trusted from the client.

    A question may start with "#label " (agent_tools.strip_test_label) to tag
    a manual test run for later lookup in agent_runs; the model never sees
    this prefix. Every run — success or failure — is persisted as one
    diagnostic row in agent_runs (repository.log_agent_run), capturing the
    exact prompt text, per-round tool calls, and totals; this is developer
    tooling only and can never block or alter the response (see DECISIONS.md).

    Returns {"answer": str, "proposed_actions": list[dict], "conversation_id": str}
    — proposed_actions is populated when the agent calls one of the
    propose_* write tools (agent_tools.build_write_proposal_tools) in the
    course of answering. Those tools only ever record intent; nothing is
    written to the database here. Raises RuntimeError on any failure so
    callers only need to handle one failure mode.
    """
    run_start = time.perf_counter()
    raw_question = question
    question, test_label = agent_tools.strip_test_label(question)

    had_conversation_id = bool(conversation_id)
    if not conversation_id:
        conversation_id = str(uuid.uuid4())

    # agent_runs diagnostic accumulator (developer tooling — see agent_runs
    # in DATABASE_SCHEMA.md). Populated as the function proceeds; written in
    # the finally block below so a run that RAISES is still recorded.
    run = {
        "test_label": test_label,
        "raw_question": raw_question,
        "question": question,
        "conversation_id": conversation_id,
        "first_turn_text": None,
        "system_instruction_sha": None,
        "day_view_rows": None,
        "history_messages": 0,
        "rounds_detail": [],
        "rounds": 0,
        "model": GEMINI_AGENT_MODEL,
        "prompt_tokens": 0,
        "output_tokens": 0,
        "thinking_tokens": 0,
        "cached_tokens": 0,
        "total_tokens": 0,
        "outcome": None,
        "proposed_actions": [],
        "refs": [],
        "answer": None,
        "latency_ms": None,
        "error": None,
    }
    # Declared before the try block so the finally clause can always read
    # them, even if an exception is raised before the loop below runs.
    total_prompt_tokens = 0
    total_output_tokens = 0
    total_tokens_sum = 0
    total_thinking_tokens = 0
    total_cached_tokens = 0
    history = []

    try:
        # A history read must never block the answer — fall back to no history.
        # A brand-new conversation (no conversation_id passed in) has nothing
        # to load, so skip the query entirely rather than wasting a call.
        if had_conversation_id:
            try:
                history = repository.get_recent_agent_runs(
                    user_id, conversation_id, limit=agent_tools.HISTORY_MAX_PAIRS
                )
            except Exception as e:
                logging.error(f"[agent] Failed to load conversation history: {e}")
                history = []

        # One clock read for the entire request — see build_time_context's docstring.
        # Feeds the system instruction, search_tasks, and the header below, so a
        # request that straddles midnight can never see two different "today"s.
        today_iso, now_hhmm, time_header = agent_tools.build_time_context()
        # No arguments: the instruction is deliberately CONSTANT so that
        # system_instruction + tools form a byte-identical, cacheable prefix
        # across requests. today_iso/now_hhmm reach the model via time_header
        # and the day view instead — see build_system_instruction's docstring.
        # The user's own workspace and category names, APPENDED to the constant
        # instruction rather than interpolated into it — see
        # build_vocabulary_block for why that distinction is a budget line.
        system_instruction = agent_tools.build_system_instruction(
            agent_tools.build_vocabulary_block(
                repository.get_workspaces(user_id),
                repository.get_categories(user_id),
            )
        )
        run["system_instruction_sha"] = agent_tools.system_instruction_sha(system_instruction)

        try:
            cached_tasks = repository.get_tasks_for_user(user_id=user_id)
        except Exception as e:
            logging.error(f"[agent] Failed to fetch tasks: {e}")
            raise RuntimeError(f"Could not load task data: {e}")

        proposed_actions = []
        # Distinct tasks surfaced by search_tasks/get_task_details THIS run, keyed
        # by record_id — the day view is deliberately excluded (it's re-injected
        # fresh every request, so it never needs to be remembered). Turned into
        # this run's refs, stored on the agent_runs row (see _finish below).
        seen_tasks: dict[str, str] = {}
        # The filters the agent actually searched with, returned to the client and
        # shown under its answer. The agent was observed narrowing a search with a
        # category or date the user never mentioned and then reporting "you have
        # none" over it; the tool-level hints try to stop that, but a filter the
        # USER can see is the backstop, because only the user knows what they meant.
        searches_run: list[dict] = []

        # Every record_id this conversation has already surfaced, from the refs
        # stored on earlier runs. Arms the write tools' anaphora guard: on a
        # follow-up turn a proposal must target either one of these or a task the
        # user names in the current question — see _unjustified_target.
        conversation_refs = {
            r.get("record_id")
            for past_run in history
            for r in (past_run.get("refs") or [])
            if r.get("record_id")
        }

        search_tasks, get_task_details = agent_tools.build_tool_functions(cached_tasks)
        propose_complete_task, propose_update_task, propose_create_task = agent_tools.build_write_proposal_tools(
            proposed_actions, cached_tasks,
            question=question, conversation_refs=conversation_refs,
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

        # Pre-loaded so day-scope questions (today/overdue) resolve in ONE round instead
        # of two — injected ALWAYS, never gated on pattern-matching the question: a false
        # negative costs a whole round (~3,350 tokens), an unnecessary injection costs a
        # few hundred, and fragile Greek/English regexes are not worth maintaining.
        day_view = agent_tools.build_day_view(cached_tasks, today_iso, now_hhmm)
        day_view_row_count = len(day_view.splitlines()) - 1
        logging.info(f"[agent] day_view injected: {day_view_row_count} rows")
        run["day_view_rows"] = day_view_row_count

        # History is replayed FIRST, as the raw stored question/answer text — it
        # must never carry its own (now-stale) time header or day view. Those
        # attach ONLY to the current, last user turn below: two versions of
        # "today" in one prompt is exactly the hallucination surface this avoids.
        history_contents = agent_tools.build_history_contents(history)
        run["history_messages"] = len(history_contents)

        # Refs go ABOVE the day view deliberately: the measured failure was the
        # model resolving "it" to a day-view row, so what the conversation is
        # actually about must be read first — see build_conversation_refs_block.
        refs_block = agent_tools.build_conversation_refs_block(history)
        current_turn_text = (
            f"{time_header}\n\n"
            + (f"{refs_block}\n\n" if refs_block else "")
            + f"[PRE-LOADED — overdue and today's open tasks, already sorted, COMPLETE "
            f"for THESE TWO SCOPES ONLY:]\n{day_view}\n\n"
            f"Question: {question}"
        )
        run["first_turn_text"] = current_turn_text
        current_turn = types.Content(role="user", parts=[types.Part.from_text(text=current_turn_text)])
        contents = history_contents + [current_turn]

        def _log_run_summary(outcome: str, rounds_used: int):
            logging.info(
                f"[agent][SUMMARY] outcome={outcome} rounds={rounds_used} "
                f"history={len(history_contents)} "
                f"prompt={total_prompt_tokens} output={total_output_tokens} "
                f"thinking={total_thinking_tokens} cached={total_cached_tokens} "
                f"total={total_tokens_sum}"
            )

        def _finish(answer: str) -> dict:
            """
            Common tail for every successful exit: computes this run's refs from
            seen_tasks and records them onto `run` for the agent_runs row
            written in the `finally` block below — that single write is what
            persists both the diagnostic archive and this conversation's
            memory, replacing the old two-message save. Returns the result
            dict including conversation_id.
            """
            if len(seen_tasks) <= agent_tools.HISTORY_MAX_REFS:
                refs = [{"task_name": name, "record_id": rid} for rid, name in seen_tasks.items()]
            else:
                refs = []

            logging.info(f"[agent] history: {len(history_contents)} messages replayed, {len(refs)} refs stored")

            run["answer"] = answer
            run["refs"] = refs
            run["proposed_actions"] = proposed_actions

            return {
                "answer": answer,
                "proposed_actions": proposed_actions,
                "conversation_id": conversation_id,
                "searches": searches_run,
            }

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
                run["outcome"] = "api_failure"
                run["rounds"] = round_num + 1
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

            round_detail = {
                "round": round_num + 1,
                "prompt_tokens": round_prompt,
                "output_tokens": round_output,
                "thinking_tokens": round_thinking,
                "cached_tokens": round_cached,
                "total_tokens": round_total,
                "finish_reason": _finish_reason_of(response),
                "tool_calls": [],
            }
            run["rounds_detail"].append(round_detail)

            if not function_calls:
                if response.text:
                    if token_tracker:
                        summed = _SummedUsage(total_prompt_tokens, total_output_tokens, total_tokens_sum)
                        token_tracker.log_token_usage("agent_query", summed, model=GEMINI_AGENT_MODEL, user_id=user_id)
                    _log_run_summary("ok", round_num + 1)
                    run["outcome"] = "ok"
                    run["rounds"] = round_num + 1
                    return _finish(response.text)
                _log_run_summary("no_answer", round_num + 1)
                run["outcome"] = "no_answer"
                run["rounds"] = round_num + 1
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
                        result = func(**(fc.args or {}))
                    except Exception as e:
                        result = {"error": str(e)}
                function_response_parts.append(
                    types.Part.from_function_response(name=fc.name, response=result)
                )
                round_detail["tool_calls"].append({
                    "name": fc.name,
                    "args": dict(fc.args) if fc.args else {},
                    "result": _serialize_tool_result(result),
                })

                # Track distinct tasks surfaced by search/detail calls this run for refs —
                # NOT the day view, which is re-injected fresh every request (see seen_tasks above).
                if fc.name == "search_tasks" and isinstance(result, dict):
                    for t in result.get("tasks", []):
                        rid = t.get("record_id")
                        if rid:
                            seen_tasks[rid] = t.get("task_name")
                    # Only the filters actually passed — an omitted filter is not a
                    # constraint and listing it as one would be its own lie.
                    searches_run.append({
                        "filters": {k: v for k, v in (fc.args or {}).items() if v not in (None, "", False)},
                        "total_matches": result.get("total_matches", 0),
                    })
                elif fc.name == "get_task_details" and isinstance(result, dict) and result.get("record_id"):
                    seen_tasks[result["record_id"]] = result.get("task_name")

            contents.append(types.Content(role="user", parts=function_response_parts))

        # Graceful degradation: previously this was `raise RuntimeError(...)`, i.e. the
        # user saw an error after the most expensive possible run. One final tool-less
        # call forces an answer from whatever was already found instead.
        logging.warning(f"[agent] max rounds ({MAX_TOOL_ROUNDS}) hit — forcing tool-less answer")
        contents.append(types.Content(role="user", parts=[types.Part.from_text(
            text=("You have used all available tool calls. Answer NOW using only what you "
                  "have already found. If you found nothing, say so plainly and suggest "
                  "what the user could clarify (e.g. a specific date). Do not call tools.")
        )]))

        try:
            final = client.models.generate_content(
                model=GEMINI_AGENT_MODEL,
                contents=contents,
                config=types.GenerateContentConfig(system_instruction=system_instruction),
            )
        except Exception as e:
            run["outcome"] = "max_rounds"
            run["rounds"] = MAX_TOOL_ROUNDS + 1
            raise RuntimeError(f"Agent exceeded max rounds and final answer failed: {e}")

        final_um = final.usage_metadata
        run["rounds_detail"].append({
            "round": MAX_TOOL_ROUNDS + 1,
            "prompt_tokens": (final_um.prompt_token_count or 0) if final_um else 0,
            "output_tokens": (final_um.candidates_token_count or 0) if final_um else 0,
            "thinking_tokens": (getattr(final_um, "thoughts_token_count", 0) or 0) if final_um else 0,
            "cached_tokens": (getattr(final_um, "cached_content_token_count", 0) or 0) if final_um else 0,
            "total_tokens": (final_um.total_token_count or 0) if final_um else 0,
            "finish_reason": _finish_reason_of(final),
            "tool_calls": [],
        })

        if final.usage_metadata:
            total_prompt_tokens += final.usage_metadata.prompt_token_count or 0
            total_output_tokens += final.usage_metadata.candidates_token_count or 0
            total_tokens_sum += final.usage_metadata.total_token_count or 0

        if not final.text:
            run["outcome"] = "max_rounds"
            run["rounds"] = MAX_TOOL_ROUNDS + 1
            raise RuntimeError("Agent exceeded maximum tool-call rounds without a final answer")

        # Same token_tracker shape as the normal success path above — one call_type
        # ("agent_query"), one log_token_usage call per run, never two: this recovery
        # return is the only exit taken once the loop above is exhausted, so there is
        # no risk of double-logging the same run.
        if token_tracker:
            summed = _SummedUsage(total_prompt_tokens, total_output_tokens, total_tokens_sum)
            token_tracker.log_token_usage("agent_query", summed, model=GEMINI_AGENT_MODEL, user_id=user_id)

        logging.warning(
            f"[agent][SUMMARY] outcome=max_rounds_recovered rounds={MAX_TOOL_ROUNDS + 1} "
            f"history={len(history_contents)} "
            f"prompt={total_prompt_tokens} output={total_output_tokens} total={total_tokens_sum}"
        )
        run["outcome"] = "max_rounds_recovered"
        run["rounds"] = MAX_TOOL_ROUNDS + 1
        return _finish(final.text)
    except Exception as e:
        run["error"] = str(e)
        raise
    finally:
        run["latency_ms"] = int((time.perf_counter() - run_start) * 1000)
        run["prompt_tokens"] = total_prompt_tokens
        run["output_tokens"] = total_output_tokens
        run["thinking_tokens"] = total_thinking_tokens
        run["cached_tokens"] = total_cached_tokens
        run["total_tokens"] = total_tokens_sum
        try:
            repository.log_agent_run(user_id, run)
        except Exception as e:
            logging.warning(f"[agent] Failed to log agent run: {e}")
        logging.info(f"[agent] run logged: outcome={run['outcome']} rounds={run['rounds']}")
