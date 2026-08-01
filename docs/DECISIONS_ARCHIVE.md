# DECISIONS_ARCHIVE — superseded decisions (reference only)
_Kept in git, EXCLUDED from the Project knowledge index so retrieval can never surface a cancelled decision as current. Do not act on anything here; it is history._

### Superseded: Airtable as the backend/database
Original backend used Airtable (base id `appltfhiUjBTEsd9w`). Superseded by the Supabase migration (see DECISIONS.md "Supabase over Airtable"). Airtable remains only as a read-only legacy backup.

### Superseded: delete the Google Calendar event when a task is completed
An early calendar design deleted the linked Google event on task completion. Superseded by "completion prefixes the event title with ✓ " (see DECISIONS.md "origin-aware deletion + completion marking"), so completed tasks stay visible on the calendar as done.

### Superseded: send_push_to_all for notifications
Pre-multi-user, notifications used a `send_push_to_all` that hit every device. Superseded by `send_push_to_user(user_id, ...)` during Phase D1 to prevent cross-user notification leakage.

### Superseded: today-scoped searches report an overdue COUNT, not the overdue tasks
`search_tasks` returned an `overdue_count` (number only, tasks never fetched) for single-day searches matching today, scoped by category/priority but not keyword — a deliberate cost trade-off assuming follow-up "which ones?" questions were rare. Superseded by the pre-loaded day view (see DECISIONS.md "the pre-loaded day view is NARROW"), which lists the actual overdue tasks (capped, with an overflow line) at no extra round — making a count-only mechanism both redundant and a second source of truth for the same question, the exact bug shape a prior PR (invented search filters) had to fix elsewhere.
