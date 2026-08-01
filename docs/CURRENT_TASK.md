ACTIVE TASK — Manual verification of agent writes Phase 1
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Goal
Phase 1 (propose-then-confirm agent writes: complete/update/create) is fully implemented on both backend and frontend. What's left is a human clicking through the real app, logged in, to confirm it actually works end-to-end against the live Supabase database — Claude Code verified everything short of that (see Status).

## Status
Implemented and committed:
- `agent_tools.py`: `build_write_proposal_tools(proposed_actions, available_tasks)` → `propose_complete_task` / `propose_update_task` / `propose_create_task` (validate + record intent, never execute). `AGENT_WRITABLE_FIELDS` whitelist. System instruction extended with a WRITE ACTIONS section.
- `agent_engine.py`: `ask_agent(question, user_id)` now returns `{answer, proposed_actions}`; the propose_* tools are registered alongside the read tools in the same tool-calling loop.
- `main.py`: `/agent/query` returns `{answer, proposed_actions}`; new `POST /agent/confirm-action` executes one action with full server-side re-validation (allowed types, `AGENT_WRITABLE_FIELDS`, enum/date/time values) and user_id scoping inherited from `TaskService`.
- `services.py`: `create_task_manual(user_id, fields, approval_status=True)` — new param, defaults `True` (unchanged behavior for `POST /tasks`); `/agent/confirm-action` passes `False` so agent-created tasks land in the Inbox.
- Frontend: `AgentChatModal.jsx` renders one confirmation card per proposed action, individually confirmed; `confirmAgentAction(action)` + updated `askAgent()` in `api.js`; task list updates via the same state-merge `App.jsx` already uses after a normal task edit/create (no extra fetch). i18n keys added to both `en.json`/`el.json`.

Verified by Claude Code (no login available in this environment): syntax-checked all edited Python files, imported `main.py` successfully against the real Supabase-backed repository, `eslint` clean, `vite build` succeeds, both dev servers start, `/health` returns 200, `/agent/query` and `/agent/confirm-action` both correctly return 401 without a bearer token, and the OpenAPI schema's `ConfirmActionRequest`/`AgentQueryResponse`/`ProposedAction` shapes match the spec exactly.

NOT verified: an actual logged-in run through the UI against real data. That's this task.

## Files touched
`agent_tools.py`, `agent_engine.py`, `main.py`, `services.py`, `frontend/src/api.js`, `frontend/src/components/AgentChatModal.jsx`, `frontend/src/App.jsx`, `frontend/src/locales/en.json`, `frontend/src/locales/el.json`.

## SQL to run
None.

## Acceptance / verification (do these, logged in, in the real app)
- "ολοκλήρωσε το task X" → card appears (no immediate change) → Confirm → task actually marked completed, card replaces with a done line, task list updates without a manual refresh.
- "άλλαξε την ώρα του X σε 15:00" → card → Confirm → task's due_time actually updated.
- "φτιάξε νέο task 'αγορά γάλα' για αύριο" → card explicitly says it's going to the Inbox → Confirm → task appears in Inbox (not directly in Today/Upcoming), `approval_status=false`.
- Cancel on any card → nothing changes server-side, card just greys out locally.
- Sending several write requests in one message → multiple cards appear under the same reply; confirming/cancelling one has no effect on the others.
- A read-only question ("τι έχω σήμερα;") → answer renders with NO cards at all.
- Reload the page (or close/reopen the chat) after a proposal appears but before confirming it → the card is gone, nothing was written (ephemeral by design).
- Try clicking Confirm twice fast on the same card → only one write happens.
- Two-account isolation still holds (an agent action can never touch the other account's tasks).

## Also pending (not this task)
None.
