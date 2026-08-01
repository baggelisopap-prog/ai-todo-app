# BACKLOG — deferred, not started
_Ideas parked deliberately. Moving one into active work = write it into CURRENT_TASK.md._

- **Agent writes Phase 2**: delete tasks + Google Calendar event operations (higher risk than Phase 1's complete/update/create).
- **Agent day view (Phase 3)**: pre-loaded overdue+today in the first user turn, overdue capped at 10 with a +N overflow line, separate PENDING APPROVAL section; supersedes `overdue_count`. Gated on the PR A measurement.
- **Billing / quota**: `profiles.monthly_token_quota` + Stripe; check summed `token_usage_log` vs quota before AI calls; "approaching limit" notices.
- **Monitoring**: Sentry (error tracking, free ≤5k errors/mo) + UptimeRobot (uptime, free 50 monitors/5-min — note: free tier is "non-commercial", flag given the Hostaway business use). Add a `/health` endpoint for UptimeRobot.
- **Admin dashboard** (owner-only): view ALL users' activity/usage; extend the Developer token dashboard, gated by owner user_id. **Prerequisite when this starts**: `/dev/token-usage` is currently auth-gated only — it is self-scoped (`get_usage_summary(user_id)` uses the caller's own bearer-token user_id), so there is no cross-user leak today, and the "Developer" section is hidden by a FRONTEND-only owner check in `SettingsModal.jsx`. The moment this endpoint (or a new admin endpoint) returns other users' rows, a SERVER-SIDE owner check becomes mandatory — frontend hiding is not a security boundary.
- **Agent multi-turn memory**: send truncated history = past questions + final answers only (NOT raw tool results) to bound token cost.
- **Android packaging**: TWA/Bubblewrap. Unblocked now that multi-user is done; the existing web-app OAuth client works for TWA. (PWA can't set native alarms or bypass silent mode — confirmed unsupported.)
- **Custom domain**: attach to Vercel (Settings→Domains) + optionally Render (api.subdomain); doesn't replace the servers.
- **Phone-call escalation (Twilio)**: no permanent free tier (~$1.15/mo number + per-min, charged only on answer). Deferred until after everything else. Viber Bot / WhatsApp calling evaluated and rejected.
- **Limit far-future calendar events**: birthdays pull decades out; cap the forward window.
- **Cleanup (cosmetic)**: remove leftover Airtable code/imports + `pyairtable` package + `AIRTABLE_TOKEN` env; delete the old Frankfurt Render service; dedupe any stray app_settings rows; fix stale docstrings in `main.py` — `delete_task` still says "the record is gone from Airtable" and `run_scheduler` still says "this app has no auth system", both untrue since the Supabase + auth migration.
