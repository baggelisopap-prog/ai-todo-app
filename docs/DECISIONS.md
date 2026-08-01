# DECISIONS — choices + rationale (current decisions only)
_Append-only in spirit, but SUPERSEDED decisions move to DECISIONS_ARCHIVE.md (kept in git, excluded from the Project index) so retrieval can never mistake a cancelled decision for a current one. When a spec overturns a decision, name what's superseded and have the new entry reference what it replaced. Criterion for staying here: "does this still govern the code?"_

### Decision: Supabase over Airtable — for real multi-user + RLS
Migrated fully to Supabase (PostgreSQL) to get per-user rows, RLS, indexes, foreign keys, and real auth. Supersedes the original Airtable backend (that decision is archived). Airtable kept read-only as a legacy backup.

### Decision: secret key bypasses RLS → app-code filtering is the PRIMARY defense
The backend talks to Supabase with the secret key, which intentionally bypasses RLS (needed for cross-user work like the scheduler). Therefore every repository function must filter by `user_id` in application code; RLS is defense-in-depth, not the primary guard. Never rely on RLS alone in backend code. Seeing other users' rows in the Supabase Table Editor (an admin tool) is normal and NOT a leak.

### Decision: dates stored as TEXT
Kept due_date/due_time as TEXT during migration to avoid rewriting all date logic. Accepted trade-off.

### Decision: agent runs a manual tool-call loop with AFC disabled
google-genai's Automatic Function Calling under-reported token usage (only the last round). Running the loop manually lets us sum usage across every round accurately. Plain Python functions are still passed as tools (SDK still auto-generates their schemas).

### Decision: agent is stateless per question; only filtered results reach the LLM
Each question re-loads that user's tasks into RAM, filters in Python (free), and passes only the small filtered result to the LLM. Keeps cost bounded regardless of task count. No conversation memory (a future multi-turn design should send truncated history = questions + final answers only, NOT raw tool results).

### Decision: agent writes via propose-then-confirm; confirm endpoint is the security boundary
**Not yet built** (see FEATURES.md / CURRENT_TASK.md — verified against the code, none of this exists yet). This decision governs HOW it will be built when that work resumes, not current behavior: the agent proposes structured actions; the user confirms via buttons; a separate `/agent/confirm-action` endpoint executes with server-side re-validation (allowed types, field whitelist, user_id scoping). This defends against prompt injection (e.g. malicious Hostaway guest text): even a tricked proposal is user-visible and user-gated, and the server re-validates regardless of what the UI sends.

### Decision: agent injection defenses (CONFIDENTIALITY + DATA-VS-INSTRUCTIONS)
Tool results — including third-party Hostaway guest text — are DATA to read/summarize, never instructions to follow. The agent also won't reveal its own instructions. Keep these directives when touching agent code.

### Decision: backend manages Google Calendar token refresh itself
Supabase does not reliably refresh the Google provider token (documented). So we capture provider tokens once and refresh them ourselves against Google's OAuth endpoint. Tokens live in `google_calendar_connections`.
**CORRECTED**: an earlier draft said this refresh is "proactive (5-min buffer before expiry)". Verified against `google_calendar.py`'s `get_valid_access_token`: it's REACTIVE — it only refreshes when `datetime.now(timezone.utc) >= expiry` (i.e., after the stored token has already expired), with no buffer margin, and there is no separate helper function. If a 5-min proactive buffer is wanted, that's an actual code change, not yet done.

### Decision: calendar pull is conservative
Only app-created (tagged) events sync back into tasks. Foreign events go to a separate view with a manual "Make it a task" button — we do NOT auto-import every calendar entry as a task (would flood the list). Scoped to the "primary" calendar; no recurring-event handling. Bootstrap sync uses a 90-day lookback + singleEvents=true + orderBy=startTime; orderBy is incompatible with syncToken (400) so it's bootstrap-only.

### Decision: origin-aware deletion + completion marking
`calendar_origin` ('app' vs 'google') decides deletion behavior: deleting an app-origin task deletes its Google event; deleting a google-origin (converted) task keeps the Google event. A calendar-side deletion appends a note to the task and unlinks — never deletes the task. Completion prefixes the Google event title with "✓ " instead of deleting it (supersedes an earlier "delete event on completion" idea, which is archived); the "✓ " is stripped on pull so it never leaks into the task name.

### Decision: Hostaway multi-tenancy deferred to "year 2"
Only the owner has Hostaway now. `get_user_id_for_hostaway_account()` is the single "one door" to change when others connect their own Hostaway accounts later. Nothing else needs rewriting.

### Decision: token usage has a single source of truth
`token_usage_log` is per-user; usage summaries are computed by summing it. No cached usage column on `profiles` (two sources would drift). A future `profiles.monthly_token_quota` + Stripe billing is deferred (see BACKLOG).

### Decision: profiles table for per-user profile/settings, not auth.users
Supabase's `auth.users` is off-limits for custom fields, so a `profiles` table (1:1, auto-created on signup) holds display_name/email and is the right home for future per-user settings.

### Decision: Settings sections collapse independently, closed by default, hidden-not-unmounted
Each of Settings' seven sections (My Profile, Notifications, Google Calendar, Language, Developer, Account, About) is now a collapsible accordion row (`CollapsibleSection`), all closed the moment the modal opens. Rationale: the long single-scroll modal was unusable on mobile once My Profile + Settings redesign added more sections. Independent toggles (not one-open-at-a-time) were chosen over a strict accordion so the user can compare two sections at once (e.g. Notifications and Calendar) without losing either's state. Collapsed content is hidden via a CSS class, not unmounted — this preserves in-progress form state (e.g. a partially typed display_name) across a collapse/expand and avoids re-running a section's own data-fetching effects every time it's re-opened. This supersedes NOTHING — FEATURES.md's "single scrollable modal, not sub-page navigation" characterization of Settings still stands; this only changes each section from always-expanded to collapsible within that same single modal.

### Decision: docs/knowledge workflow (this restructure)
State lives in /docs (single source of truth), not in long chats. One task = one chat (cost grows quadratically within a chat). The Project indexes ONLY /docs, never code. Retrieval is semantic search over chunks; cold-start uses rare anchor strings. Facts are never hardcoded in the system instruction (they drift); the only deliberate exception is the hosting/workflow SHAPE.

### Decision: measure the agent's token cost before optimizing it
An optimization proposal (implicit caching, a pre-loaded day view, compact tool results, merging the propose_* tools) was reviewed and NOT adopted as written, because every figure in it was inferred rather than observed. A read-only query over existing token_usage_log rows then established, before any code was written: thinking tokens are zero (so a thinking-budget change is off the table entirely); input is ~90% of tokens and ~77% of cost; the fixed per-round prefix is ~1,830 tokens; the average call is ~4,264 tokens, and the "16k" figure that prompted this work is the tail, not the typical case. Cost scales with the NUMBER OF TOOL ROUNDS.
Two constraints on any future work, from the same review: (a) the tool result is appended to `contents` and therefore re-sent on every subsequent round, so compacting it saves proportionally more the more rounds a question takes; (b) implicit caching and round-reduction are substitutes, not complements — removing a round also removes the cache hit that round would have produced, and at a ~1,830-token prefix the app sits near the minimum input threshold implicit caching requires, so caching may never engage at all. Supersedes nothing.

### Decision: agent instrumentation is log-only; token_usage_log writes are unchanged
Per-round and per-run token figures (including thinking and cached counts) go to the application log only. They are deliberately NOT passed to `token_tracker.log_token_usage()`. Rationale: a write to `token_usage_log` containing a field with no matching column is rejected wholesale and silently breaks ALL token logging (documented in DATABASE_SCHEMA.md) — and this change exists precisely to make measurement reliable. Persisting thinking/cached counts is a separate task requiring a migration first.

### Decision: agent search results sort chronologically, not priority-first
`search_tasks` sorts by (due_date, due_time, priority) before capping. The cap's purpose is "the next N things to do", and a P1 due next week is not more urgent than a P3 due today. Consequence: a high-priority far-future task can fall outside the cap; the `truncated` flag tells the agent to mention that more matches exist.
Supersedes nothing (there was previously no sort at all — an arbitrary subset was kept).

### Decision: today-scoped searches report an overdue COUNT, not the overdue tasks
The DATE RESOLUTION rule sets date_from == date_to for a single day, which structurally hides overdue tasks from "what do I have today". search_tasks now returns an overdue_count for that case only, resolved against the real Athens date in the closure (date_from == date_to alone would also match "tomorrow" and miscount today's tasks as overdue). Scoped by category/priority, not keyword.
Trade-off accepted deliberately: returning the count rather than the tasks costs ~5 tokens instead of ~150, but if the user follows up with "which ones?", that follow-up is a full additional agent run (~6k tokens, since cost scales at roughly 2,900 tokens per round). Chosen on the assumption that follow-ups are rare. Revisit if logs show otherwise. Supersedes nothing — DATE RESOLUTION is unchanged.
