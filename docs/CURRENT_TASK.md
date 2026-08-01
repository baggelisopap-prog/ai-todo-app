ACTIVE TASK — Verify the agent day view against real traffic
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Goal
The pre-loaded day view (`agent_tools.build_day_view`) is deployed: overdue + today's open tasks (plus anything pending approval due today/late) are now injected into the first user turn of every agent request, so day-scoped questions resolve in one round instead of two. Measured baseline said this should take reads from ~7,000 to ~3,600 tokens and writes on today's tasks from ~10,700 to ~7,100. It has NOT yet been run against real traffic. This is the single biggest change yet to what the model sees before it decides whether to call a tool at all, and it creates a genuinely new hallucination surface: the day view's data is real, so a wrong-scope answer built from it will look completely plausible. That's the main risk this task exists to catch.

## Status
Implemented, not yet verified live. `agent_tools.py`: `is_pending_task()`, `build_day_view()`, `DAY_VIEW_DESC_LENGTH`/`DAY_VIEW_OVERDUE_CAP`/`DAY_VIEW_PENDING_CAP`, a new PRE-LOADED DAY VIEW system-instruction section, the record_id rule widened to accept day-view ids, `overdue_count` removed entirely (computation, result key, docstring, and its old OVERDUE TASKS instruction section). `agent_engine.py`: the first user turn now carries `time_header + day_view + question`; a `[agent] day_view injected: N rows` log line records size every request. Also fixed while implementing (not explicitly requested, but real bugs this PR's own reasoning exposed): `build_tool_functions`'s now-dead `today_iso` parameter was removed cleanly rather than left unused; the closing catch-all "Always use search_tasks... before answering" line was scoped to exclude what the day view already covers (it directly contradicted the new "do NOT call search_tasks for today/overdue" instruction — the same self-contradiction shape a previous PR fixed for `overdue_count`); DATA VS INSTRUCTIONS was widened to explicitly cover the day view, not just tool results, since task descriptions now reach the model in the first turn before any tool call.

Verified statically: `py_compile`/`import main` pass; a synthetic local smoke test of `build_day_view` confirmed correct overdue/today/pending bucketing, chronological + priority sort, passed/upcoming computation, cap + overflow-line behavior, and the "(none)"/"(none)" empty case. NOT verified: real model behavior — whether it actually honors the "day view is complete for these two scopes only, everything else needs search_tasks" boundary.

## Files touched
`agent_tools.py`, `agent_engine.py` only.

## SQL to run
None.

## Acceptance / verification (run every one of these manually, logged in)
1. "τι έχω σήμερα;" → 1 round, NO search_tasks call, correct passed/upcoming.
2. "τι έχω σήμερα και τι είναι εκπρόθεσμο;" → 1 round, no duplicate listing.
3. "τι έχω αυτή τη βδομάδα;" → MUST call search_tasks. Main new hallucination surface — the day view's data is real, so a wrong-scope answer will look entirely plausible.
4. "τι έχω αύριο;" → MUST call search_tasks.
5. "βρες τι έχω την Τετάρτη" → next Wednesday, search_tasks called, no invented filters.
6. "τι είναι εκπρόθεσμο;" → answered from the day view, tasks due today NOT included.
7. "τα επαγγελματικά μου" → search_tasks, category=Business, no date filter.
8. A user with zero today and zero overdue → day view shows (none) twice, model says so and does NOT call search_tasks.
9. "σημείωσε το <today's task> ως ολοκληρωμένο" → 2 rounds (no lookup), card appears, phrased as pending confirmation, not past tense.
10. "σημείωσε το <already completed task> ως ολοκληρωμένο" → not in the day view, so search_tasks(include_completed=True) is called and the model says it's already done. The extra round is CORRECT here.
11. Two-account isolation — cached_tasks was already user-scoped, but this changes what enters the prompt; verify explicitly with the test account.
12. Greek question → Greek answer.
13. A task whose description contains prompt-injection text → ignored as an instruction, reported as text. Matters more now: that description reaches the model in the FIRST user turn, before any tool result.

## Also pending (not this task)
Optimization branch selection beyond the day view (compact tool results for non-day-view scopes) is still open, gated on this verification. The pending-approval product decision (whether `is_open_task`'s policy itself should change) remains open — `is_pending_task()` documents the current split without deciding it. Agent writes Phase 2 (delete + calendar ops) — see BACKLOG.md. Two older diagnostics still open: reconciling old rows where thinking_tokens and implied thinking disagree, and confirming whether four agent_query calls within 8 seconds on 2026-07-25 were manual tests or duplicate frontend requests.
