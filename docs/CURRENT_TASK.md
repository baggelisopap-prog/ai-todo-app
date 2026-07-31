ACTIVE TASK — Agent writes Phase 1 (propose-then-confirm for complete/update/create)
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Goal
Give the agent the ability to complete / update / create tasks through the propose-then-confirm flow. Agent proposes; user confirms via buttons; a separate endpoint executes with server-side re-validation + user_id scoping.

## Status
Spec written in the previous (pre-restructure) chat; NOT yet confirmed shipped or tested in the new project. Resume by re-issuing the spec to Claude Code, deploying, and running the manual tests.

## Files touched (expected)
- `agent_tools.py`: add `build_write_proposal_tools(proposed_actions, available_tasks)` → `propose_complete_task` / `propose_update_task` / `propose_create_task` (validate + record intent, never execute). Extend the system instruction so the agent proposes and never claims an action is done.
- `agent_engine.py`: `ask_agent` returns `{answer, proposed_actions}` (was a bare string); collect proposals; register the propose tools alongside the read tools.
- `main.py`: `/agent/query` returns `{answer, proposed_actions}`; new `/agent/confirm-action` executes one action with re-validation (allowed types; field whitelist {due_date,due_time,priority,category,task_name,description}; user_id scoping).
- `repository.py`: reuse existing `update_task` / `create_task_manual` (already user-scoped).
- Frontend: confirmation cards (Confirm/Cancel) under the agent reply; `confirmAgentAction(action)` in api.js; refresh tasks on success. i18n: agent.confirm / agent.cancel / agent.action_done.

## SQL to run
None.

## Acceptance / verification
- "ολοκλήρωσε το task X" → card appears (no immediate change) → Confirm → task completed.
- "άλλαξε την ώρα του X σε 15:00" → card → Confirm → time updated.
- "φτιάξε νέο task 'αγορά γάλα' για αύριο" → card → Confirm → task created.
- Cancel → nothing changes. Read queries ("τι έχω σήμερα;") still work. 2-account isolation holds.

## Also pending (not this task)
None. (Corrected: the Full Settings redesign — My Profile + sections + delete-account — was previously listed here as pending; verified against the code that it's actually shipped: `GET/PATCH /profile` + `DELETE /account` exist and `SettingsModal.jsx` has all the described sections. See PROJECT_STATUS.md.)
