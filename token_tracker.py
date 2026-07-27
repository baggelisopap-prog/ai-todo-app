"""
Token usage tracking for Gemini API calls. Logs each call's token counts to
the token_usage_log Airtable table and computes cost estimates + aggregate
summaries for the developer-only usage dashboard.
"""
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import repository

# Per-model Gemini pricing (standard/global tier, verified mid-2026).
# Re-check https://ai.google.dev/gemini-api/docs/pricing periodically —
# Google can change these rates. Keyed by the exact model string passed to
# generate_content(), so each call is costed at the rate it actually billed.
PRICING = {
    "gemini-3.5-flash": {"input": 1.50, "output": 9.00},
    "gemini-3.1-flash-lite-preview": {"input": 0.25, "output": 1.50},
}
DEFAULT_MODEL = "gemini-3.5-flash"


def calculate_cost(prompt_tokens: int, output_tokens: int, thinking_tokens: int = 0, model: str = DEFAULT_MODEL) -> float:
    # Thinking/reasoning tokens are billed by Google at the same rate as
    # output tokens, so they're folded into the output side of the cost here.
    rates = PRICING.get(model, PRICING[DEFAULT_MODEL])
    input_cost = (prompt_tokens / 1_000_000) * rates["input"]
    output_cost = ((output_tokens + thinking_tokens) / 1_000_000) * rates["output"]
    return round(input_cost + output_cost, 6)


def log_token_usage(call_type: str, usage_metadata, model: str = DEFAULT_MODEL, user_id: str = None) -> None:
    """
    Logs token usage from a Gemini API response — a full per-field breakdown
    (prompt / output / thinking / total) to the application log on every
    call, plus a persisted row in the token_usage_log Supabase table, owned
    by user_id. Never raises — a logging failure must not break the actual
    AI call, whether that call already succeeded or is being logged as a
    failed/empty attempt. Call this after ANY generate_content() call,
    passing response.usage_metadata and the exact model string that was
    used, so cost is calculated at the rate that call actually billed.
    """
    if usage_metadata is None:
        logging.warning(f"[token_tracker] No usage_metadata available for call_type={call_type}")
        return

    prompt_tokens = getattr(usage_metadata, 'prompt_token_count', 0) or 0
    output_tokens = getattr(usage_metadata, 'candidates_token_count', 0) or 0
    thinking_tokens = getattr(usage_metadata, 'thoughts_token_count', 0) or 0
    total_tokens = getattr(usage_metadata, 'total_token_count', 0) or (prompt_tokens + output_tokens + thinking_tokens)

    logging.info(
        f"[token_tracker] {call_type} ({model}) usage breakdown — prompt={prompt_tokens}, "
        f"output={output_tokens}, thinking={thinking_tokens}, total={total_tokens}"
    )

    try:
        repository.save_token_usage_log(
            user_id=user_id,
            call_type=call_type,
            timestamp=datetime.now(ZoneInfo("Europe/Athens")).isoformat(),
            prompt_tokens=prompt_tokens,
            output_tokens=output_tokens,
            thinking_tokens=thinking_tokens,
            total_tokens=total_tokens,
            model=model,
        )
    except Exception as e:
        logging.error(f"[token_tracker] Failed to log token usage for {call_type}: {e}")


def get_usage_summary(user_id: str) -> dict:
    """
    Returns recent calls plus today/this-week aggregate totals (tokens + cost)
    for user_id, using each logged row's own model for accurate per-call
    cost calculation.
    """
    all_logs = repository.get_all_token_usage_logs(user_id=user_id)

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
        cost = sum(
            calculate_cost(l["prompt_tokens"], l["output_tokens"], l.get("thinking_tokens", 0), l.get("model", DEFAULT_MODEL))
            for l in logs
        )
        return {
            "call_count": len(logs),
            "total_tokens": total_tokens,
            "estimated_cost_usd": round(cost, 4),
        }

    today_logs = [l for l in all_logs if in_today(l)]
    week_logs = [l for l in all_logs if in_this_week(l)]

    recent_calls = sorted(all_logs, key=lambda l: l["timestamp"], reverse=True)[:20]
    for call in recent_calls:
        call["estimated_cost_usd"] = calculate_cost(
            call["prompt_tokens"], call["output_tokens"], call.get("thinking_tokens", 0), call.get("model", DEFAULT_MODEL)
        )

    return {
        "recent_calls": recent_calls,
        "today": summarize(today_logs),
        "this_week": summarize(week_logs),
    }
