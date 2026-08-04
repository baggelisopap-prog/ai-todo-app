ACTIVE TASK — Verify agent day view + conversation memory in live use (via agent_runs)
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Goal
Two features are implemented but have never been verified through the real UI while logged in:
1. **The pre-loaded day view** — its 13-item acceptance checklist was written when the feature shipped, but got overwritten by later CURRENT_TASK.md tasks before it was ever run "manually, logged in" (only the lighter in-process `ask_agent()` method ran — see PROJECT_STATUS.md's correction).
2. **Bounded conversation memory** — implemented backend + frontend, never exercised live either.

Both are tracked together here because they touch the same request path (time header + day view + the current user turn), so testing them together is more efficient and a regression in one could otherwise be misread as a bug in the other.

What changed since the last attempt: every `ask_agent` run — success or failure — is now persisted to `agent_runs` (see DATABASE_SCHEMA.md), including the EXACT first-turn prompt text, every round's tool calls, and the same totals already in the console `[SUMMARY]` line. A question can be tagged `#label ` (e.g. `#dv3 τι έχω αυτή τη βδομάδα;`) to mark that run for lookup by `test_label` — the model never sees the tag. This means verification no longer means watching Render's ephemeral application log during the test: run the question, then query `agent_runs` for the row.

**2026-08-04 fix**: conversation memory had shipped reading/writing a table (`agent_messages`) that was created and then dropped before production use — every save and every history read was hitting PGRST205 (table not found), caught by the existing try/except, so answers kept returning 200 with `history=0` and memory was silently inert. Repointed onto `agent_runs` — one row already IS a question/answer pair, so the same table now serves both the debug archive and memory replay (see DECISIONS.md). `save_agent_message`/`get_recent_agent_messages` are deleted; `repository.get_recent_agent_runs` reads the same table `log_agent_run` writes. The frontend's 4th starter chip ("Add a task") was also removed — three read-only chips only, per DECISIONS.md. Committed and pushed (`476e6d0`).

**2026-08-04 smoke test** (in-process `ask_agent()`, owner account, tagged `#memtest1`/`#memtest2` — NOT the same as "manually, logged in" through the real UI, same caveat as the day-view correction above): two chained calls in one conversation. Call 1 (fresh conversation) logged `history=0`, no PGRST205. Call 2 ("τι σε ρώτησα πριν;") logged `history=2 messages replayed` and correctly answered "Με ρώτησες: «τι έχω σήμερα;»" — the read from `agent_runs` and the reference resolution both work end-to-end. This confirms the MECHANISM; it does not stand in for the M1–M8 checklist below (isolation, stale-state, refs-over-5, injection, UI lifecycle are all still unverified).

## Status
- **Day view**: implemented, NOT yet verified "manually, logged in" (checklist below).
- **Conversation memory**: implemented (backend + frontend), reads/writes `agent_runs` (repointed 2026-08-04 from the dropped `agent_messages` table — see above). Basic mechanism confirmed working by the 2026-08-04 smoke test above; the full M1–M8 checklist (UI-based) is still open.
- **agent_runs diagnostic logging**: implemented — `agent_tools.strip_test_label`/`system_instruction_sha`; `repository.log_agent_run` (explicit column whitelist, never raises) and `repository.get_recent_agent_runs` (memory read, same table); `agent_engine.ask_agent` accumulates a `run` dict throughout and writes it in a `finally` block so a raised exception still gets a row with its outcome + error. Confirmed working against real requests by the smoke test above (rows written, no errors); the day-view checklist below is still this feature's first exercise against every acceptance case.

## Files touched
`agent_tools.py`, `agent_engine.py`, `repository.py`, `main.py`, `frontend/src/components/AgentChatModal.jsx`, `frontend/src/locales/en.json`, `frontend/src/locales/el.json` (i18n).

## SQL to run
`agent_runs` table (see DATABASE_SCHEMA.md for columns/indexes) — **already run**. No new SQL needed. (`agent_messages` was created and dropped in an earlier attempt and never belongs in production — do not recreate it.)

## How to verify (reusable method)
Ask each question logged in through the real chat UI, prefixed with its tag (e.g. `#dv3 τι έχω αυτή τη βδομάδα;` or `#m1 πότε έχω φυσιοθεραπεία;`). The tag is stripped before the model sees it and never appears in the answer. Afterward, pull the row back out of `agent_runs` by `test_label` (`select * from agent_runs where test_label = 'dv3' order by created_at desc limit 1`) and read `first_turn_text`, `rounds_detail`, `history_messages`, `refs`, and `outcome` directly — no need to have been watching the log at the time.
**Day-view checks must be run in a FRESH conversation** — close and reopen the chat (or tap "New conversation") before each one, so `history_messages = 0` and the day view is the only thing under test; a day-view check run mid-conversation would have replayed history sitting in `contents` too, muddying which mechanism produced the answer.

## Acceptance — day view (tag `#dv1`..`#dv13`)
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

## Acceptance — conversation memory (tag `#m1`..`#m8`)
M1. "πότε έχω φυσιοθεραπεία;" then "βάλ' το στις 5" -> the agent asks which 5 (day or hour), then proposes an update card for the RIGHT task, with no redundant search round.
M2. A follow-up "και το άλλο;" resolves against the previous answer, not a random task.
M3. Ask a factual question, change the task in another tab, ask a follow-up -> the answer reflects the NEW state, not the remembered one.
M4. Close the modal with X, reopen -> empty chat, chips shown, no memory, no leftover cards.
M5. 5+ turns in one conversation -> logs show at most 8 replayed messages.
M6. A run touching more than 5 tasks -> refs stored as [], follow-up triggers a search.
M7. Two-account isolation: the test account never sees the owner's conversation.
M8. Injection text inside a remembered answer is treated as data, not instruction.

## Also pending (not this task)
- **`get_tasks_for_user` loads every task ever** — measured 109 rows fetched to use 8 open ones. Not a token cost (filtering is in Python) but unbounded DB egress + latency on every agent call.
- **Retry accounting gap:** if an attempt fails *after* the model generated, Google billed but `token_usage_log` never counted it. Also no overall request timeout (backoff up to 3s/round × 4 rounds).
- **`no_matches_hint` only fires when a date filter is present** — a keyword-only search that finds nothing gets no hint.
- Agent writes Phase 2 (delete + calendar ops) — see BACKLOG.md.
- Older diagnostics: rows where `thinking_tokens` and implied thinking disagree; whether four `agent_query` calls within 8 seconds on 2026-07-25 were manual tests or duplicate frontend requests.
