# DATABASE_SCHEMA — Supabase (PostgreSQL) tables
_Conventions: dates stored as TEXT (avoids rewriting date logic); checklist as JSONB `[{text,done}]`; every table has `user_id` + RLS policy (`auth.uid() = user_id`) + an index on `user_id` + `ON DELETE CASCADE` to `auth.users`. The backend uses the SECRET key which bypasses RLS — so app-code filtering is primary; RLS is defense-in-depth. Verify columns against real `repository.py` queries; code wins._

### Table: tasks — per-user, RLS enabled, the core table
Columns: `id` (UUID PK), `task_name` (TEXT), `description` (TEXT), `category` (TEXT CHECK in Business/Personal/Unknown/Hostaway), `priority` (TEXT CHECK in P1/P2/P3), `due_date` (TEXT), `due_time` (TEXT), `checklist` (JSONB, array of `{text, done}`; `_supabase_row_to_task`'s read-side normalization and `_checklist_to_jsonb`'s write-side conversion together handle both the old flat string-list format and the new object format — corrected: there is no function literally named `normalize_checklist()`), `approval_status` (bool), `is_completed` (bool), `is_rejected` (bool), `created_time` (TEXT/legacy), `ai_suggested_category` (TEXT), `ai_suggested_priority` (TEXT), `notify_enabled` (bool), `notification_sent` (bool), `hostaway_created_at` (TEXT/timestamp), `hostaway_last_notified_at`, `google_event_id` (TEXT, links to a Google Calendar event), `google_last_synced_at` (TIMESTAMPTZ), `calendar_sync_enabled` (bool, default false — per-task calendar toggle), `calendar_origin` (TEXT 'app' or 'google' — whether the task originated in-app or was converted from a Google event), `updated_at` (TIMESTAMPTZ, auto-updated by trigger `set_updated_at` → `update_updated_at_column()`), `user_id` (UUID FK → auth.users ON DELETE CASCADE), `created_at` (TIMESTAMPTZ default now()).

### Table: app_settings — per-user singleton (oldest row is the canonical one)
Columns include: `notifications_enabled`, `send_all_enabled`, `daily_summary_enabled`, `daily_summary_mode`, `daily_summary_time`, `daily_summary_last_sent_date`, `calendar_sync_all_enabled` (bool, global "sync all tasks to calendar"), `calendar_show_events` (bool default true, controls event DISPLAY everywhere), `name`, `user_id`. Reads take the oldest row per user (`order created_at asc limit 1`); updates upsert that row. (Historical: duplicate rows were deduped by keeping the oldest.)

### Table: push_subscriptions — per-user Web Push endpoints
Columns: `endpoint`, `p256dh`, `auth`, `user_id`, plus id/created_at. Used by `send_push_to_user`.

### Table: token_usage_log — per-user, per-call AI cost log (single source of truth for usage)
Columns: `call_type`, `timestamp`, `prompt_tokens`, `output_tokens`, `thinking_tokens`, `total_tokens`, `model`, `user_id`. Usage summaries are computed by summing this table (no cached usage column anywhere — avoids a second source of truth). NOTE historical bug: a missing `model` column once broke ALL logging (a write with an unknown field is rejected wholesale) — keep the schema and the write in sync.

### Table: profiles — per-user profile, 1:1 with auth.users
Columns: `id` (UUID PK, FK → auth.users ON DELETE CASCADE), `email` (TEXT), `display_name` (TEXT), `created_at`. Auto-created on signup by trigger `on_auth_user_created` → `handle_new_user()` (pulls `raw_user_meta_data->>'full_name'` for Google signups). Owner row backfilled. This is the correct place for future per-user settings (e.g. a `preferred_language` or `monthly_token_quota` column) — NOT auth.users.

### Table: google_calendar_connections — per-user Google OAuth + sync state, user_id UNIQUE
Columns actually read/written by `repository.py`/`google_calendar.py`: `user_id` (UUID, UNIQUE, FK → auth.users ON DELETE CASCADE), `access_token`, `refresh_token`, `token_expiry` (TIMESTAMPTZ), `calendar_sync_token` (TEXT, Google incremental sync token; set to NULL to force a fresh full bootstrap), plus id/connected_at. Backend refreshes the Google token itself (Supabase doesn't reliably refresh the provider token).
**CORRECTED**: an earlier draft of this doc also listed `last_sync_at`/`last_sync_status`/`last_sync_error` columns and a "Last synced" status line in Settings. Verified against the code (`google_calendar.py`, `repository.py`, `SettingsModal.jsx`): none of these are read, written, or displayed anywhere — there is no last-sync tracking or UI today. Removed from this doc; if this is wanted, it needs a real spec (new columns + write-them-somewhere + UI).

### Table: google_calendar_events — per-user store of foreign (non-app) Google events
Columns: `user_id`, `google_event_id` (TEXT), `title`, `description`, `start_date` (TEXT), `start_time` (TEXT, null for all-day), `is_all_day` (bool), `converted_to_task_id` (UUID FK → tasks ON DELETE SET NULL), `dismissed` (bool default false — soft-hide), `html_link` (TEXT, opens the event in Google Calendar), `last_synced_at` (TIMESTAMPTZ), with `UNIQUE(user_id, google_event_id)` (which also creates an implicit index). These are events NOT created by the app; shown in a separate view, never auto-turned into tasks.

### Triggers / functions
- `update_updated_at_column()` + trigger `set_updated_at` on `tasks` (auto-sets `updated_at` on every UPDATE — the calendar push logic compares `updated_at` vs `google_last_synced_at`).
- `handle_new_user()` + trigger `on_auth_user_created` on `auth.users` (auto-creates a `profiles` row).

### Indexes
`user_id` index on tasks, push_subscriptions, app_settings, token_usage_log; `user_id` index on google_calendar_connections and google_calendar_events; implicit unique index from `UNIQUE(user_id, google_event_id)`.
