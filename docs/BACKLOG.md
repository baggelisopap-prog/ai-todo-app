# BACKLOG — deferred, not started
_Ideas parked deliberately. Moving one into active work = write it into CURRENT_TASK.md._

- **Agent writes Phase 2**: delete tasks + Google Calendar event operations (higher risk than Phase 1's complete/update/create).
- **Billing / quota**: `profiles.monthly_token_quota` + Stripe; check summed `token_usage_log` vs quota before AI calls; "approaching limit" notices.
- **Monitoring**: Sentry (error tracking, free ≤5k errors/mo) + UptimeRobot (uptime, free 50 monitors/5-min — note: free tier is "non-commercial", flag given the Hostaway business use). Add a `/health` endpoint for UptimeRobot.
- **Admin dashboard** (owner-only): view ALL users' activity/usage; extend the Developer token dashboard, gated by owner user_id.
- **Agent multi-turn memory**: send truncated history = past questions + final answers only (NOT raw tool results) to bound token cost.
- **Android packaging**: TWA/Bubblewrap. Unblocked now that multi-user is done; the existing web-app OAuth client works for TWA. (PWA can't set native alarms or bypass silent mode — confirmed unsupported.)
- **Custom domain**: attach to Vercel (Settings→Domains) + optionally Render (api.subdomain); doesn't replace the servers.
- **Phone-call escalation (Twilio)**: no permanent free tier (~$1.15/mo number + per-min, charged only on answer). Deferred until after everything else. Viber Bot / WhatsApp calling evaluated and rejected.
- **Limit far-future calendar events**: birthdays pull decades out; cap the forward window.
- **Cleanup (cosmetic)**: remove leftover Airtable code/imports + `pyairtable` package + `AIRTABLE_TOKEN` env; delete the old Frankfurt Render service; dedupe any stray app_settings rows.
