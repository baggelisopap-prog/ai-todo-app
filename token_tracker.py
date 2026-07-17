"""
Token usage tracking for Gemini API calls. Logs each call's token counts to
the token_usage_log Airtable table and computes cost estimates + aggregate
summaries for the developer-only usage dashboard.
"""
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import repository

# Gemini 3.5 Flash pricing (standard/global tier, verified mid-2026).
# Re-check https://ai.google.dev/gemini-api/docs/pricing periodically —
# Google can change these rates.
GEMINI_INPUT_COST_PER_MILLION = 1.50   # USD per 1,000,000 input tokens
GEMINI_OUTPUT_COST_PER_MILLION = 9.00  # USD per 1,000,000 output tokens


def calculate_cost(prompt_tokens: int, output_tokens: int, thinking_tokens: int = 0) -> float:
    # Thinking/reasoning tokens are billed by Google at the same rate as
    # output tokens, so they're folded into the output side of the cost here.
    input_cost = (prompt_tokens / 1_000_000) * GEMINI_INPUT_COST_PER_MILLION
    output_cost = ((output_tokens + thinking_tokens) / 1_000_000) * GEMINI_OUTPUT_COST_PER_MILLION
    return round(input_cost + output_cost, 6)


def log_token_usage(call_type: str, usage_metadata) -> None:
    """
    Logs token usage from a Gemini API response — a full per-field breakdown
    (prompt / output / thinking / total) to the application log on every
    call, plus a persisted row in the token_usage_log Airtable table. Never
    raises — a logging failure must not break the actual AI call, whether
    that call already succeeded or is being logged as a failed/empty
    attempt. Call this after ANY generate_content() call, passing
    response.usage_metadata.
    """
    if usage_metadata is None:
        logging.warning(f"[token_tracker] No usage_metadata available for call_type={call_type}")
        return

    prompt_tokens = getattr(usage_metadata, 'prompt_token_count', 0) or 0
    output_tokens = getattr(usage_metadata, 'candidates_token_count', 0) or 0
    thinking_tokens = getattr(usage_metadata, 'thoughts_token_count', 0) or 0
    total_tokens = getattr(usage_metadata, 'total_token_count', 0) or (prompt_tokens + output_tokens + thinking_tokens)

    logging.info(
        f"[token_tracker] {call_type} usage breakdown — prompt={prompt_tokens}, "
        f"output={output_tokens}, thinking={thinking_tokens}, total={total_tokens}"
    )

    try:
        repository.save_token_usage_log(
            call_type=call_type,
            timestamp=datetime.now(ZoneInfo("Europe/Athens")).isoformat(),
            prompt_tokens=prompt_tokens,
            output_tokens=output_tokens,
            thinking_tokens=thinking_tokens,
            total_tokens=total_tokens,
        )
    except Exception as e:
        logging.error(f"[token_tracker] Failed to log token usage for {call_type}: {e}")


def get_usage_summary() -> dict:
    """
    Returns recent calls plus today/this-week aggregate totals (tokens + cost).
    """
    all_logs = repository.get_all_token_usage_logs()

    now = datetime.now(ZoneInfo("Europe/Athens"))
    today_str = now.strftime("%Y-%m-%d")
    week_start = now - timedelta(days=now.weekday())  # Monday of current week
    week_start_str = week_start.strftime("%Y-%m-%d")

    def in_today(log):
        return log["timestamp"].startswith(today_str)

    def in_this_week(log):
        return log["timestamp"][:10] >= week_start_str

    def summarize(logs):
        total_tokens = sum(l["total_tokens"] for l in logs)
        cost = sum(calculate_cost(l["prompt_tokens"], l["output_tokens"], l.get("thinking_tokens", 0)) for l in logs)
        return {
            "call_count": len(logs),
            "total_tokens": total_tokens,
            "estimated_cost_usd": round(cost, 4),
        }

    today_logs = [l for l in all_logs if in_today(l)]
    week_logs = [l for l in all_logs if in_this_week(l)]

    recent_calls = sorted(all_logs, key=lambda l: l["timestamp"], reverse=True)[:20]
    for call in recent_calls:
        call["estimated_cost_usd"] = calculate_cost(call["prompt_tokens"], call["output_tokens"], call.get("thinking_tokens", 0))

    return {
        "recent_calls": recent_calls,
        "today": summarize(today_logs),
        "this_week": summarize(week_logs),
    }
