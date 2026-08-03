ACTIVE TASK — Verify agent conversation memory in live use
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Goal
Bounded, server-reconstructed conversation memory for the Q&A/write agent — the last 4 question/answer pairs, replayed via a `conversation_id` the client only ever echoes back, never populates with content — is now implemented on both backend and frontend, along with starter suggestion chips in the empty chat state. None of it has been exercised through the real UI while logged in yet: verification so far is `py_compile`/`import main`, a standalone unit test of `agent_tools.build_history_contents`, an ESLint pass + `vite build` on the frontend, and reading the diff. This file exists to actually run it.

## Status
Implemented, not verified live.
- **Backend**: `repository.save_agent_message(user_id, conversation_id, role, content, refs=None)` / `get_recent_agent_messages(user_id, conversation_id, limit)` (never raises — returns `[]` on failure) against the new `agent_messages` table. `agent_tools.py`: `HISTORY_MAX_PAIRS` (4) / `HISTORY_MSG_MAX_CHARS` (500) / `HISTORY_MAX_REFS` (5), `build_history_contents(messages)`, a new CONVERSATION HISTORY system-instruction section (replacing the now-false SINGLE SELF-CONTAINED QUESTION one, which flatly denied any history existed), and a DATA VS INSTRUCTIONS directive widened to cover history. `agent_engine.ask_agent(question, user_id, conversation_id=None)` now mints/reuses `conversation_id`, replays history ahead of the current turn (time header + day view stay on the LATEST turn only — never on a replayed one), computes `refs` after the tool-calling loop from this run's `search_tasks`/`get_task_details` results (capped at 5; more than that stores `refs=[]`), persists both turns (each independently try/excepted), and returns `conversation_id`. `POST /agent/query` in `main.py` accepts/returns it.
- **Frontend**: `AgentChatModal.jsx` holds `conversationId` in state, sets it from every successful `askAgent` response, and resets it (+ `messages` + any un-confirmed proposal cards) both on close (✕) and on a new "New conversation" header button. Renders 4 starter suggestion chips (`agent.suggestion_today/week/overdue/add_task`, translated EN/EL) above the input while `messages` is empty; tapping one sends immediately. `api.js`'s `askAgent(question, conversationId)` sends `conversation_id` only when set.
- **Also inherited**: the day-view acceptance checklist (see PROJECT_STATUS.md → "In progress") was discovered to have never actually been run "manually, logged in" either — only the in-process method. It should be verified together with this task since both touch the same request path (time header + day view + the turn the model actually sees).

## Files touched
`repository.py`, `agent_tools.py`, `agent_engine.py`, `main.py`, `frontend/src/api.js`, `frontend/src/components/AgentChatModal.jsx`, `frontend/src/locales/en.json`, `frontend/src/locales/el.json`.

## SQL to run
The `agent_messages` table (`id`, `user_id` FK → auth.users ON DELETE CASCADE, `conversation_id` UUID — not a FK, `role`, `content`, `refs` JSONB, `created_at`; RLS enabled; indexes on `user_id` and `(user_id, conversation_id, created_at desc)` — see DATABASE_SCHEMA.md). **Already run** by the user before this spec started.

## Acceptance / verification (run every one of these manually, logged in)
1. "πότε έχω φυσιοθεραπεία;" then "βάλ' το στις 5" -> the agent asks which 5 (day or hour), then proposes an update card for the RIGHT task, without a redundant search round.
2. A follow-up "και το άλλο;" resolves against the previous answer, not a random task.
3. Ask a factual question, change the task in another tab, ask a follow-up -> the answer reflects the NEW state, not the remembered one.
4. Close the modal with X, reopen -> chat is empty, chips shown, no memory of the previous conversation, no leftover cards.
5. 5+ turns in one conversation -> logs show at most 8 replayed messages.
6. A run touching more than 5 tasks -> refs stored as [], follow-up triggers a search.
7. Token check in the logs: a follow-up costs roughly one round plus a few hundred tokens, not a doubled prompt.
8. Two-account isolation: the test account never sees the owner's conversation.
9. Injection text inside a remembered answer is treated as data, not instruction.
10. Greek question -> Greek answer, chips correct in both EN and EL.

## Also pending (not this task)
- **`get_tasks_for_user` loads every task ever** — measured 109 rows fetched to use 8 open ones. Not a token cost (filtering is in Python) but unbounded DB egress + latency on every agent call.
- **Retry accounting gap:** if an attempt fails *after* the model generated, Google billed but `token_usage_log` never counted it. Also no overall request timeout (backoff up to 3s/round × 4 rounds).
- **`no_matches_hint` only fires when a date filter is present** — a keyword-only search that finds nothing gets no hint.
- Agent writes Phase 2 (delete + calendar ops) — see BACKLOG.md.
- Older diagnostics: rows where `thinking_tokens` and implied thinking disagree; whether four `agent_query` calls within 8 seconds on 2026-07-25 were manual tests or duplicate frontend requests.
