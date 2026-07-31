PROJECT STATUS SNAPSHOT —
_Last updated: 2026-08-01. This is the cold-start entry point: read this first for "where are we"._

## What this project is
AI-powered personal to-do app. Captures tasks (text/voice/image), auto-categorizes and prioritizes them with Gemini, sends push reminders, syncs two-way with Google Calendar, has an AI agent that answers questions about your tasks (read-only for now — proposing task changes is designed but not yet built, see below). Backs a real Airbnb/Hostaway short-let business (Hostaway guest messages become tasks automatically). Multi-user and production-deployed.

## Shipped and live ✅
- **Supabase migration complete** (moved fully off Airtable): schema, data migration (71 tasks + settings + subs + token logs), backend rewrite, auth, multi-user isolation.
- **Auth**: email/password with 6-digit OTP email verification + Google OAuth; password-confirm field + show/hide toggle. Live in production (Google sign-in works on mobile).
- **Multi-user data isolation (Phase D1)**: every table has `user_id` + RLS + index + ON DELETE CASCADE; every repository fn + endpoint threads user_id; scheduler loops per-user; agent filters per-user; verified with a real 2-account test (test account sees only its own data).
- **Per-user AI token usage tracking** (token_usage_log is per-user; Developer dashboard sums it, owner-gated).
- **Google Calendar Phase 1** (per-user OAuth connect + backend-managed token refresh) and **Phase 2** (two-way sync via the existing scheduler): push tasks→Google, pull app-created events back; foreign (non-app) events stored separately with a "Make it a task" flow; events shown in Today + Monthly/Weekly calendar grid (as titled chips) + day-detail popup; per-task calendar toggle + global "sync all" + "show events" toggle; origin-aware deletion; completion marks the Google event with a "✓ " title prefix; tapping an event opens it in Google Calendar. (Corrected: there is no "Last synced" status UI and token refresh is reactive-at-expiry, not a proactive 5-min-buffer refresh — verified against the code; see DATABASE_SCHEMA.md/ARCHITECTURE.md corrections.)
- **Full Settings redesign** (My Profile + organized sections + delete-account): **shipped**, not pending. `GET/PATCH /profile` and `DELETE /account` exist in `main.py`; `SettingsModal.jsx` has all sections (My Profile, Notifications, Google Calendar, Language EN/EL, owner-gated Developer, Account with sign-out + confirm-gated delete, About). Verified against the running code. Each section is now independently collapsible (shared `CollapsibleSection` component), all closed by default when the modal opens, collapsed content hidden-not-unmounted so in-progress edits survive a collapse.

## In progress / most recent 🚧
- **Agent write capabilities Phase 1** (propose-then-confirm for complete/update/create tasks): spec written (propose_* tools that record intent, `/agent/confirm-action` endpoint that executes with server-side re-validation + user_id scoping, confirmation-button cards in the chat UI). Verified against the code: NOT implemented at all yet — no propose tools, no confirm-action endpoint, `ask_agent` still returns a bare string. This is the CURRENT_TASK to resume.

## Next / not started
See BACKLOG.md. Nearest: finish + test agent writes Phase 1; then agent writes Phase 2 (delete + calendar ops), monitoring, admin dashboard, Android packaging.

## How to resume
Cold-start search returns this file + CURRENT_TASK.md. Read CURRENT_TASK.md for the active piece. For any concrete fact (schema, endpoint, env var), search the specific doc; never guess.
