ACTIVE TASK — Verify per-user Hostaway against a real second colleague
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Context
Hostaway is per-user on `main` as of 2026-08-14. Design: `docs/superpowers/specs/2026-08-13-hostaway-per-user-integration-design.md`. Plan: `docs/superpowers/plans/2026-08-13-hostaway-per-user-integration.md`. Migration `docs/migrations/2026-08-13-hostaway-connections.sql` already run by hand.

**102 unit tests pass.** Two things were also checked against reality rather than asserted: Hostaway's webhook write API answered a real `POST` and `DELETE` (200 both, new id at `result.id`), and the owner's own connection round-tripped — his row was written from `.env`, and the reply poller then read its credentials out of that row, polled two conversations and wrote nothing.

**None of that is the feature.** The feature is: fifteen colleagues share one Hostaway account, and one guest message should become one task each. That has never happened. Nobody but the owner has connected, so the fan-out loop has only ever run with a list of one.

The requirement remains «σε όλα αυτά θέλω zero fail, όχι 9/10», so what follows is meant to be *run*, not read.

## Before anything else
`HOSTAWAY_ENCRYPTION_KEY` must be set in Render's environment. Without it every Hostaway path raises — deliberately, rather than silently storing plaintext. **Confirm it is there before deploying**, not after.

## Gap 1 — The Settings screen has never been on a screen
Steps 1–4 of Task 9 are committed and the frontend builds, but Step 5 was never done. On a real screen, in both languages:
- [ ] The disconnected form appears, with Account ID and a masked API key field.
- [ ] A **wrong** API key shows the error toast and leaves you disconnected — nothing stored.
- [ ] A correct one flips to Connected, showing the account id.
- [ ] Both switches move, and **survive a reload** (they are optimistic; a reload is what proves the server agreed).
- [ ] Switch the app to English and read the whole screen again.

**Do not test Disconnect on the owner's account casually.** It removes webhook **34986** from the live Hostaway account — the production webhook every guest message arrives through. Reconnecting registers a *new* webhook with a new id, which works, but the id in the row and in these docs changes. Test disconnect on the colleague's connection instead.

## Gap 2 — The fan-out, which is the actual feature
- [ ] A colleague creates their own app profile and connects it to Hostaway account 147809 from Settings → Hostaway, using their own API key.
- [ ] Confirm `hostaway_connections` now holds **two rows with the same `account_id`** and different `user_id`s. (If this is rejected by the database, `account_id` picked up a unique constraint it must not have — see DATABASE_SCHEMA.md.)
- [ ] A guest writes. **Two tasks appear**, one in each account.
- [ ] Check the Render log for exactly **one** `[hostaway] Classification` cost for that message, not two. The whole point of one classification serving every colleague is that fifteen colleagues do not mean fifteen Gemini calls.
- [ ] **One** colleague replies to the guest in Hostaway. Within ~2 minutes **both** copies close (P3) or both record `hostaway_answered_at` and stop nagging (P1/P2) — each colleague's own poller sees the same reply.

## Gap 3 — The switches, checked where they cost money
- [ ] The colleague turns **Create tasks from messages** off. The next guest message produces a task for the owner and **not** for them.
- [ ] The colleague turns **Close the task when you reply** off. Their copy stays open after a reply; the owner's still closes.
- [ ] With every colleague's task switch off, confirm the log line `[hostaway webhook] No recipient for account ...` and **no Gemini call at all** for that message.

## How to resume
Read this file, then PROJECT_STATUS.md's "In progress" section. The plan file's "After the plan" section says the same thing in one line: until a real guest message has produced two tasks, this is 102 passing tests and a dry run.
