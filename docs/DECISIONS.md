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
**SHIPPED** (Phase 1: complete/update/create; verified end-to-end logged-in against live Supabase data on 2026-08-01 — see FEATURES.md / PROJECT_STATUS.md). The agent proposes structured actions via `agent_tools.build_write_proposal_tools`; the user confirms individually via a card in the chat UI; a separate `POST /agent/confirm-action` endpoint executes with full server-side re-validation (allowed types, field whitelist, enum/date/time values, user_id scoping) — that endpoint is the actual security boundary, not the propose tools or the UI. This defends against prompt injection (e.g. malicious Hostaway guest text): even a tricked proposal is user-visible and user-gated, and the server re-validates regardless of what the UI sends. Phase 2 (delete + Google Calendar event operations) remains deferred — see BACKLOG.md.
**Updated**: a record_id for propose_complete_task/propose_update_task may now come from either a tool result OR the PRE-LOADED day view injected into the first turn (see "Day view is NARROW" below) — both are the same user-scoped `cached_tasks` read in the same request. The rule was never really "must go through search_tasks first", it was "never fabricate an id"; the day view is just a second legitimate source of real ones.

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

### Decision: one open-task predicate, changeable in exactly one place
`agent_tools.is_open_task(t, include_completed=False)` is now the only place "counts as an open task" (not rejected, approved, and not completed unless asked) is decided — the `search_tasks` main filter, the `overdue_count` computation, and the `no_matches_hint` lookup all route through it instead of each carrying its own inline copy of the same three-condition check. Rationale: the pending-approval policy is a product decision that is still open (see CURRENT_TASK.md) — when it changes, it must change in one function, not require re-auditing every place the three fields were checked inline. Supersedes nothing (there was previously no single predicate, just duplicated inline checks).

### Decision: the round ceiling degrades gracefully instead of raising
Previously, exhausting `MAX_TOOL_ROUNDS` raised a `RuntimeError` that surfaced to the user as a failure — meaning the single most expensive run (every round used) was also the one guaranteed to look broken. It now makes one additional tool-less call, explicitly told to answer NOW from whatever was already found, and returns that answer instead of an exception; only a still-empty final answer raises. This is logged as `outcome=max_rounds_recovered`, deliberately distinct from `outcome=ok` — the run still signals that something went wrong (too many rounds needed), the user just no longer pays for it with a 500. A partial, honest answer beats an exception. Paired with lowering `MAX_TOOL_ROUNDS` from 6 to 4: without this decision that change would only have surfaced the error more often; with it, the worst case gets cheaper and still answers.

### Decision: calendar arithmetic is resolved in Python, never computed by the model
Weekday names ("Τετάρτη", "Monday") and the "overdue" date bound are both calendar arithmetic — exactly the kind of thing a language model does unreliably. Rather than asking the model to compute "next Wednesday" or "yesterday" from a stated today-date, the actual dates are resolved once per request in Python (`agent_tools.build_time_context`) and handed to the model as a `[Next 7 days]` lookup table in the user turn; the model's job is to READ the answer, not calculate it. Supersedes nothing — this generalizes the existing single-clock-read design (previously only `today_iso` for the today/overdue checks) to also cover weekday resolution.

### Decision: the agent never invents search filters it was not given
Production logs showed the model adding category and priority filters to a question that contained neither, and inventing a 7-day window for a question with no time reference. Both returned plausible answers over silently narrowed data. Filters are therefore constrained explicitly in the system instruction, and an over-broad search is preferred to a narrowed one. Related: the [Next 7 days] map is a lookup table, never a search range. Supersedes nothing.

### Decision: the pre-loaded day view is NARROW — today + overdue only, not a week
Measured baseline: every agent question costs exactly 2 rounds (1 search + 1 answer) at ~3,350 tokens/round, and the round count is the entire cost driver. Pre-loading today's and overdue open tasks into the first turn removes that lookup round for day-scoped questions (~7,000 → ~3,600 tokens for reads, ~10,700 → ~7,100 for writes on today's tasks). A 7-day horizon was considered and rejected: measured cost is ~130–165 tokens per task, so a week-wide injection would cost ~2,000–2,500 tokens on EVERY single request to save ~3,350 on only the minority that actually ask about the coming week — the wrong trade in the opposite direction from what this whole effort is trying to achieve. Supersedes "today-scoped searches report an overdue COUNT, not the overdue tasks" (moved to DECISIONS_ARCHIVE.md) — the day view lists the actual (capped) overdue tasks at no extra round, making a count-only mechanism pointless; having both would also mean two mechanisms answering the same question, which is exactly the shape of bug the previous PR (invented search filters) had to fix.

### Decision: day-view overdue/pending sections are capped with an explicit overflow line
Overdue tasks accumulate without bound in a real to-do app (nothing removes them from "overdue" except completing or rescheduling them), so an uncapped section would improve the AVERAGE per-request cost while making the WORST case unbounded — the opposite of this PR's goal. `DAY_VIEW_OVERDUE_CAP` (10) and `DAY_VIEW_PENDING_CAP` (5) bound both sections; a "(+N more ...)" line tells the agent (and, via its answer, the user) that more exist rather than silently truncating. `TODAY` is deliberately NOT capped — a single day's tasks are bounded by nature. Supersedes nothing.

### Decision: tasks pending approval get their own day-view section instead of being made "open"
Tasks awaiting Inbox approval (mostly AI-extracted or Hostaway webhook tasks) are NOT "open" — `is_open_task()` correctly excludes them, and that meaning is unchanged. But a Hostaway task escalating today while completely invisible to "what do I have today?" is the worst failure mode for the actual business this app supports (a real Airbnb/short-let operation where those escalations matter). `is_pending_task(t)` is the single source of truth for this separate policy — not rejected, not completed, `approval_status` false — and the day view surfaces pending tasks due today or already late in their own PENDING APPROVAL section, explicitly NOT merged into OVERDUE/TODAY, with the system instruction telling the agent to describe them as awaiting approval and never propose a write on one. Supersedes nothing — this is a new, additive surface, not a change to what "open" means.
