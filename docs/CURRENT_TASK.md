ACTIVE TASK — Agent token-cost baseline (measure before optimizing)
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Goal
Establish why agent calls cost what they cost, from real per-round data, before committing to any optimization. A read-only query over existing token_usage_log rows already established: average call ~4,264 tokens, fixed per-round prefix ~1,830 tokens, cost grouping cleanly by round count (~1.8k / ~3.8k / ~5.9k / ~9.5k), thinking tokens zero, input ~90% of tokens. What is NOT yet known is which tools are called in each round and why some calls take four rounds. This task adds behaviour-neutral per-round instrumentation and fixes three confirmed correctness bugs.

## Status
Not started.

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
