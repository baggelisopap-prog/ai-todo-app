# DECISIONS_ARCHIVE — superseded decisions (reference only)
_Kept in git, EXCLUDED from the Project knowledge index so retrieval can never surface a cancelled decision as current. Do not act on anything here; it is history._

### Superseded: the workspace switcher's shape is a function of how many workspaces there are
Shipped and superseded the same day, 2026-09-12. `switcherShape()` chose between a row of chips (two to five workspaces) and a single menu (six and up), with the thresholds tested rather than guessed, because the owner's instruction was about users in general: «αναλογα με τον αριθμο να γινεται γτ δεν ξερω ο καθε χρηστης ποσα θα εχει».

It answered "chips or a menu?" — and hours later the owner chose a shape with **no row at all**: the room moved into the app bar's title as a picker (see DECISIONS.md, "the workspace is a FILTER"). With no row, there is no shape to choose, so the function and its six checks were deleted rather than left looking current. What survived is `needsFind()`, the find-box threshold, which was the part that was really about the number.

The original reasoning, kept because the thresholds may be wanted again if a row ever returns:

> the workspace switcher's shape is a function of how many workspaces there are
> A row of chips was the owner's own choice — one tap, current position always visible, ~40px on every screen. It stays the default. But "always visible" is only true while they FIT: past five the row scrolls sideways and the selected chip can sit off the right edge, so the one control whose whole job is showing where you are starts hiding it.
>
> He refused to have this tuned to his own account: «αναλογα με τον αριθμο να γινεται γτ δεν ξερω ο καθε χρηστης ποσα θα εχει». So it is `switcherShape()` in `utils/taskFilters.js`, a tested rule with the thresholds written down and the arithmetic behind them in the comment: under two → nothing at all (a control that cannot do anything, still costing height on every screen of every user who never organises); two to five → chips, plus `scrollIntoView` on the selected one, because the active workspace is restored from `app_settings` and the app can open already filtered by a chip nobody can see; six and up → one menu; past eight options → a find box, folding Greek accents through the same `foldForSearch` the task search uses.
>
> **Rejected: one hierarchical «Ακίνητα › Κήπος» picker replacing both the chips and the category menu.** It is the better answer to «φίλτρο μέσα στο φίλτρο» and it reverses a decision he made deliberately, so it was not smuggled in as part of an approved slice — it is the open question of slice 3, to be discussed rather than proposed finished.
>
>
### Superseded: Airtable as the backend/database
Original backend used Airtable (base id `appltfhiUjBTEsd9w`). Superseded by the Supabase migration (see DECISIONS.md "Supabase over Airtable"). Airtable remains only as a read-only legacy backup.

### Superseded: delete the Google Calendar event when a task is completed
An early calendar design deleted the linked Google event on task completion. Superseded by "completion prefixes the event title with ✓ " (see DECISIONS.md "origin-aware deletion + completion marking"), so completed tasks stay visible on the calendar as done.

### Superseded: send_push_to_all for notifications
Pre-multi-user, notifications used a `send_push_to_all` that hit every device. Superseded by `send_push_to_user(user_id, ...)` during Phase D1 to prevent cross-user notification leakage.

### Superseded: today-scoped searches report an overdue COUNT, not the overdue tasks
`search_tasks` returned an `overdue_count` (number only, tasks never fetched) for single-day searches matching today, scoped by category/priority but not keyword — a deliberate cost trade-off assuming follow-up "which ones?" questions were rare. Superseded by the pre-loaded day view (see DECISIONS.md "the pre-loaded day view is NARROW"), which lists the actual overdue tasks (capped, with an overflow line) at no extra round — making a count-only mechanism both redundant and a second source of truth for the same question, the exact bug shape a prior PR (invented search filters) had to fix elsewhere.
