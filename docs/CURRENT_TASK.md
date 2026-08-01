ACTIVE TASK — Agent token-cost baseline (measure before optimizing)
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Goal
Establish why agent calls cost what they cost, from real per-round data, before committing to any optimization. A read-only query over existing token_usage_log rows already established: average call ~4,264 tokens, fixed per-round prefix ~1,830 tokens, cost grouping cleanly by round count (~1.8k / ~3.8k / ~5.9k / ~9.5k), thinking tokens zero, input ~90% of tokens. What is NOT yet known is which tools are called in each round and why some calls take four rounds. This task adds behaviour-neutral per-round instrumentation and fixes three confirmed correctness bugs.

## Status
Implemented, awaiting baseline measurement. `agent_engine.py` now logs a `[agent][round N]` line per round (prompt/output/thinking/cached/total tokens + which tools were called) and a `[agent][SUMMARY]` line on every exit path (`ok`/`no_answer`/`max_rounds`/`api_failure`). Log-only — `token_usage_log` writes via `token_tracker.log_token_usage()` are byte-for-byte unchanged.

The three confirmed correctness bugs are also fixed (ship regardless of any later token-optimization work): (1) `fc.args` is now guarded with `or {}` — Gemini sends `None` for a no-argument function call, and `**None` was raising a TypeError that cost a wasted round; (2) `search_tasks`'s `priority` param is now `Literal["P1","P2","P3"]` instead of a bare `str`, so an invalid value is now rejected by the tool schema itself instead of costing a wasted round on `raise ValueError`; (3) `search_tasks` now sorts matches chronologically (due_date, due_time, priority) before applying the 30-result cap, so the cap keeps the soonest matches instead of an arbitrary subset. Also fixed: stale "Airtable record ID" wording in `get_task_details`'s docstring and `GET_TASK_DETAILS_SCHEMA` — replaced with "The task's record ID" (this project runs on Supabase; those docstrings are sent to the model on every round).

**Also done**: "what do I have today?" now also reports how many OPEN tasks are already overdue (count only, tasks themselves not fetched/listed). `search_tasks` resolves the real Athens date once per request (`today_iso`, since `date_from == date_to` alone also matches "tomorrow") and returns `overdue_count` — always present, 0 when not applicable, non-zero only when the query is single-day AND that day is today; scoped by category/priority, not keyword. A new OVERDUE TASKS system-instruction section (after UNDATED TASKS) tells the agent to mention the number without listing the tasks, and to re-query with an open `date_from`/`date_to=today` if the user asks "which ones?". DATE RESOLUTION itself is unchanged.

## Files touched
agent_engine.py (instrumentation), agent_tools.py (bug fixes).

## SQL to run
None. (Diagnostics are read-only queries run by the user; no migrations.)

## Acceptance / verification
- Render logs show one "[agent][round N]" line per round including the tools called, and one "[agent][SUMMARY]" line per run — including runs that fail.
- Nothing written to token_usage_log changes.
- Baseline recorded for: a repeated read question (x3), one write request, one question with many results.
- Open question the logs must answer: some calls cost ~1,830 tokens, i.e. a single round with NO tool call, despite the system instruction saying "always use the search_tasks tool before answering". Determine whether the agent is answering without searching (an accuracy problem, not a cost one) or these are clarification replies.

## Also pending (not this task)
Optimization branch selection (compact tool results vs pre-loaded day view), the is_open_task() predicate refactor, and the pending-approval product decision. All gated on the baseline. Two diagnostics still open: reconciling old rows where thinking_tokens and implied thinking disagree, and confirming whether four agent_query calls within 8 seconds on 2026-07-25 were manual tests or the frontend firing duplicate requests.
