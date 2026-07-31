# ARCHITECTURE — stack, files, deployment, constants
_Single source of truth for the technical shape. Verify against real code when Claude Code bootstraps this; the code wins on any discrepancy._

## Stack
- **Backend**: FastAPI (Python) + Supabase (PostgreSQL) + Google Gemini. Fully migrated OFF Airtable (Airtable kept only as a read-only legacy backup).
- **Frontend**: React + Vite + Tailwind CSS + react-i18next (i18n: English + Greek, both fully translated) + @supabase/supabase-js.
  **CORRECTED**: an earlier draft said "Greek default + English". Verified against `frontend/src/i18n.js`: the default/fallback language is `en`; Greek (`el`) is a full, complete translation the user switches to manually via Settings → Language, and the choice persists in `localStorage` (`app_language`). There is no server-side or browser-locale-based Greek default.

## Deployment shape
- **Backend** hosted on **Render**, **Oregon region** (moved from Frankfurt earlier due to a Gemini geo-block).
- **Frontend** hosted on **Vercel**: `https://ai-todo-app-mauve.vercel.app`.
- **GitHub**: `github.com/baggelisopap-prog/ai-todo-app` — PUBLIC, auto-deploys on push (Render + Vercel).
- **Scheduler**: an external cron (cron-job.org) hits the run-scheduler endpoint every ~2 minutes; the secret lives in Render env (never in docs). The scheduler drives reminders, daily summary, Hostaway escalations, and Google Calendar sync.
- Migrations: run manually by the user as SQL in the Supabase SQL Editor (Claude Code never runs SQL).

## Key constants
- **Supabase project URL**: `https://slhnfzkwuvjrzgdtajle.supabase.co`. Uses NEW-format keys: publishable (`sb_publishable_...`) on the frontend, secret (`sb_secret_...`) on the backend. The secret key BYPASSES RLS by design (see DECISIONS.md).
- **Owner user_id** (owner-only gating + Hostaway "one door"): `fdedc7be-964b-4e75-b4a0-bd16cb6b05e7`.
- **Test account user_id** (used in isolation tests): `6ad6e85d-37c3-4a60-ae54-cf53a3f4e652`.
- **Gemini models**: agent Q&A uses `gemini-3.1-flash-lite-preview`; extraction + Hostaway classification use `gemini-3.5-flash`. (Verify exact strings in code.)
- **Legacy Airtable base id** (read-only backup only): `appltfhiUjBTEsd9w`.
- `requirements.txt` is UTF-16LE with BOM — preserve encoding; don't edit in plain Notepad. The `websockets==16.0` pin was removed (dependency conflict: google-genai needs <17, supabase/realtime needs <16 → pip resolves 15.0.1).

## Backend files and responsibilities
- **main.py** — all FastAPI endpoints; `get_current_user_id` auth dependency (verifies the bearer token via `supabase.auth.get_user(token)`). Endpoint areas: tasks CRUD (`/tasks` GET/POST, `/tasks/{id}` PATCH/DELETE), extract (`/extract`, `/extract-voice`, `/extract-image`), agent (`/agent/query` only — see below), settings (`/settings` GET/PATCH), calendar (`/calendar/connect`, `/status`, `/disconnect`, `/test`, `/events`, `/events/{id}/convert`, `/events/{id}/dismiss`), profile/account (`/profile` GET/PATCH, `/account` DELETE), Hostaway webhook (`/webhooks/hostaway`), scheduler (`/notifications/run-scheduler`), dev (`/dev/token-usage`), `/health`.
  **CORRECTED**: an earlier draft listed `/agent/confirm-action` alongside `/agent/query`. Verified: it does not exist anywhere in `main.py`, `agent_engine.py`, or `agent_tools.py` — the propose-then-confirm agent-write flow described in FEATURES.md is not implemented yet (see FEATURES.md's "AI agent (write)" section, corrected to say so explicitly). `/agent/query` currently returns only `{answer}`, not `{answer, proposed_actions}`.
- **repository.py** — ALL Supabase CRUD. Every function is scoped by `user_id` (except `get_all_tasks_for_scheduler`-style enumerations used by the per-user scheduler loop, which are intentionally global). App-code `user_id` filtering is the PRIMARY security boundary because the secret key bypasses RLS.
- **services.py** — TaskService; push sending (`send_push_to_user(user_id, ...)`); `run_notification_scheduler()` which loops every active user via `get_all_active_user_ids()`; Hostaway escalations; `sync_google_calendar_for_user(user_id)`.
- **agent_engine.py** — read-only Q&A AI agent (write capability is designed but NOT implemented — see FEATURES.md correction). Manual tool-call loop against google-genai with Automatic Function Calling DISABLED (so token usage can be summed across every round — AFC undercounted). `ask_agent(question, user_id) -> str` loads that user's tasks into RAM, exposes tools, returns a bare answer string.
  **CORRECTED**: an earlier draft said this returns `{answer, proposed_actions}` and called it a "read/write" agent — verified against the code, it's read-only today; that return shape belongs to the not-yet-built Phase 1 write feature.
- **agent_tools.py** — shared system instruction builder + read-tool factory (`search_tasks`, `get_task_details`) + Greek→Latin transliteration for fuzzy keyword matching. Holds the CONFIDENTIALITY, DATA-VS-INSTRUCTIONS, TIME AWARENESS, and DATE RESOLUTION directives.
  **CORRECTED**: an earlier draft also credited this file with a write-proposal tool factory (`build_write_proposal_tools` → propose_complete/update/create) — verified: not present in the code yet (planned for the Phase 1 agent-write task).
- **ai_engine.py** — Gemini extraction from text/voice/image into structured task data.
- **hostaway_integration.py** — Hostaway webhook AI classification, OAuth callback, enrichment, and `get_user_id_for_hostaway_account()` (the "one door": currently hardcoded to the owner user_id; the ONLY function to change when multiple users connect their own Hostaway later).
- **google_calendar.py** — per-user Google token management (`get_valid_access_token`), `sync_task_to_google_calendar`, `pull_calendar_changes`, `test_calendar_connection`, `delete_calendar_event`, `mark_event_completed`.
  **CORRECTED**: an earlier draft described `get_valid_access_token` as doing a "proactive 5-min-buffer refresh via `_refresh_access_token`". Verified against the actual code: there is no separate `_refresh_access_token` helper, and the refresh is REACTIVE, not proactive — it only refreshes when `datetime.now(timezone.utc) >= expiry` (i.e. after the token has already expired), with no buffer margin. Same correction applies to DECISIONS.md and PROJECT_STATUS.md.
- **token_tracker.py** — per-user, per-model cost logging (`log_token_usage(..., user_id)`, `get_usage_summary(user_id)`).
- **migrate_to_supabase.py** — one-off Airtable→Supabase migration script (reads raw Airtable REST API). Historical; kept for reference.

## Frontend shape
- Views: Inbox / Today / Upcoming / Calendar (Monthly + Weekly) / Browse, plus the agent chat and Settings modal.
- `api.js` wraps all backend calls with an authenticated fetch (bearer token from the Supabase session).
- `App.jsx` holds the Supabase session via `onAuthStateChange`; also captures the Google `provider_token`/`provider_refresh_token` after the calendar-connect OAuth flow (flagged via sessionStorage) and posts them to the backend.
- Today shows today's Google events inline; Calendar grid shows events as titled chips; a day-detail popup shows tasks + events; events are read-only in-app and tap-to-open in Google Calendar.
