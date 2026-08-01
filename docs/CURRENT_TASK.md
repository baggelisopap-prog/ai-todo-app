ACTIVE TASK — Agent cost/correctness PR A: measure the result (no day view yet)
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Goal
PR A shipped correctness fixes and failure-mode handling for the read agent, using the round-by-round data the earlier instrumentation surfaced (the entire cost driver is the NUMBER OF TOOL ROUNDS, and the worst-observed profile — a mis-resolved weekday — was ending in a RuntimeError shown to the user). The "pre-loaded day view" optimization is deliberately NOT in this PR; it's gated on measuring PR A's actual effect first (see BACKLOG.md's Phase 3 entry).

## Status
Implemented, awaiting post-deploy measurement (same "deploy, then collect [agent][round N]/[agent][SUMMARY] lines" pattern as the earlier baseline). `agent_engine.py` and `agent_tools.py` only — no migration, no schema change, no `main.py`/frontend change, no change to what's written to `token_usage_log`.

What shipped:
1. **`is_open_task(t, include_completed=False)`** (`agent_tools.py`) — single source of truth for "counts as an open task". Replaced the inline `is_rejected`/`approval_status`/`is_completed` triplet everywhere it was duplicated (the `search_tasks` main filter, the `overdue_count` loop); grep confirms no inline copy remains outside it.
2. **One clock read per request** — `build_time_context()` resolves `(today_iso, now_hhmm, header)` once; `build_system_instruction` and `build_tool_functions` both now take these as parameters instead of each calling `datetime.now(ZoneInfo("Europe/Athens"))` independently (2 separate clock reads before → exactly 1 now). `header` (a `[Now: ...]` / `[Next 7 days: ...]` block) is prepended to the FIRST USER TURN, not the system instruction.
3. **Weekday resolution rule** — a bare weekday name means the upcoming occurrence, read off the `[Next 7 days]` map, never computed by the model.
4. **Overdue redefined as strictly BEFORE today** — both the DATE RESOLUTION wording and the OVERDUE TASKS re-query wording now say `date_to` = the day before today (tasks due today are not overdue). The `overdue_count` computation itself was checked and was already strictly-before (`due_date >= today_iso: continue` keeps only `< today_iso`) — no bug there; only the system-instruction wording was contradictory and is now fixed in both places.
5. **`no_matches_hint`** — a zero-result date-filtered search now returns the nearest dates that DO have open tasks, and the system instruction tells the agent to use that instead of blindly retrying adjacent dates (the single most expensive observed failure pattern).
6. **Graceful degradation at the round ceiling** (`agent_engine.py`) — hitting `MAX_TOOL_ROUNDS` no longer raises immediately; one final tool-less call forces an answer from whatever was found, logged as `outcome=max_rounds_recovered`. Only a still-empty final answer still raises. `token_tracker.log_token_usage()` is called on this path too, same shape as the normal success path, exactly once (the given spec's code sample omitted this call; added it per the explicit instruction that this path must log usage the same way the success path does and never skip it — flagged for visibility, not a silent deviation).
7. **`MAX_TOOL_ROUNDS` lowered 6 → 4** — safe only because of (6); without graceful degradation this would have just surfaced the error more often.

## Files touched
`agent_engine.py`, `agent_tools.py` only.

## SQL to run
None.

## Acceptance / verification
- `is_open_task()` is the only place the open-task rule exists (grep-verified).
- Exactly one `datetime.now(ZoneInfo("Europe/Athens"))` in the whole agent path (grep-verified).
- `python -m py_compile` and `import main` both pass; nothing written to `token_usage_log` changed shape.
- Still needs real traffic: does `no_matches_hint` actually fire and get used sensibly, does `max_rounds_recovered` show up (and how often), does the weekday/overdue wording fix actually change model behavior on the two failure profiles that motivated this PR.

## Also pending (not this task)
Gated on measuring PR A's real effect: the "pre-loaded day view" (Phase 3 — see BACKLOG.md, supersedes `overdue_count` if it ships) and the pending-approval product decision (whether `is_open_task`'s policy itself should change, now that it's a single, easy-to-change place). Optimization branch selection (compact tool results vs day view) is still open. Two older diagnostics still open: reconciling old rows where thinking_tokens and implied thinking disagree, and confirming whether four agent_query calls within 8 seconds on 2026-07-25 were manual tests or duplicate frontend requests.
