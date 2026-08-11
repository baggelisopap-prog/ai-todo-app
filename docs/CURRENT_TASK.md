ACTIVE TASK — Verify Hostaway threading against real traffic
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Context
Hostaway message threading, the conversation deep link, and auto-complete on a human reply are **implemented and committed on `main`** (2026-08-10). Design: `docs/superpowers/specs/2026-08-10-hostaway-threading-design.md`. Plan: `docs/superpowers/plans/2026-08-10-hostaway-threading.md`. Migration already run by hand.

**34 unit tests pass**, and the real measured data is what they assert against — the burst pairs, the 2.4-minute two-problem pair, the `messageReceived` auto-reply payload, the GuestArrive payload. But unit tests exercise the *decisions*, not the *wiring*. Nothing below has been seen against a real Hostaway delivery. This is the same gap shape as Gaps 0–3 in the previous version of this file, and the reason that list got long is that it was never closed.

The requirement was stated as **«σε όλα αυτά θέλω zero fail, όχι 9/10»**, so a checklist that is not actually run is worth very little here.

## Gap A — does the webhook even fire for outgoing messages? (blocks half the feature)
**The one unverified assumption in the whole design.** `_handle_outgoing_hostaway_message` — the P2/P3 completion and the P1 silencing — only runs if Hostaway POSTs outgoing messages to `/webhooks/hostaway`. The account's webhook (id 34986) is subscribed to `message.received` and nothing else; no `message.sent` appears in the event vocabulary of any of the four registered webhooks, and the API exposes no catalogue of available events, so this cannot be settled from the API.

**To verify**: reply to any guest through the Hostaway inbox, then search Render's logs for `[hostaway webhook] Outgoing message:`. That line is new — the branch used to return silently, which is exactly why nobody could ever answer this question.
- **Line appears** → the feature works as designed. Record it in PROJECT_STATUS.md and delete this gap.
- **No line** → move the trigger, not the logic: on each scheduler tick, for every open Hostaway task with a `hostaway_conversation_id`, fetch `GET /v1/conversations/{id}/messages` and apply `hostaway_threading.is_human_reply` to the newest one. The decision functions are unchanged.

**Write the answer down either way.** An unrecorded "we checked once" is how this file grew its last four gaps.

## VERIFIED against the deployed endpoint (2026-08-11)
Synthetic Hostaway payloads POSTed to the live `/webhooks/hostaway`, then the resulting rows read straight out of `tasks`. Two fake conversations (`99990001`, `99990002`), three tasks created and since deleted.

| Behaviour | Result |
|---|---|
| 3 messages inside 70 s | **ONE** task, `hostaway_message_count=3`, all three in `hostaway_thread` |
| Priority through the burst | **P3 → P1** as the real problem landed |
| Summary after the burst | the KEYS problem, not «καλησπέρα» |
| A different problem 5 minutes later | **a second task** (P2, wifi) — two problems stay two tasks |
| A human reply with TWO tasks open | neither touched (`is_completed=False`, `hostaway_answered_at=None` on both), reported instead |
| A human reply on a P3 | **completed**, `hostaway_answered_at` set |
| An automation (`userId: null`) | ignored — **the auto-reply cannot close a task** |

That last row was Gap B, the dangerous one, and it is closed in production.

**One bug found by this pass and fixed (`469b127`)**: `_append_to_hostaway_thread` rebuilt the description from the summary and thread only, so the **Property/Dates block disappeared on the second message** of every conversation. The unit tests asserted the messages survive an append; nothing asserted the reservation context did. Both paths now render through `_render_hostaway_description`.

**Not covered by this pass**: a P1 reply leaving the task open was never isolated (the P1 task shared its conversation with the wifi task, so the reply correctly hit the ambiguous branch instead). Worth one clean run.

## Gap B — the link, and the sheet
Open a threaded task, tap the Hostaway link, confirm it opens the right conversation. Check the message count renders and that EN and EL both read correctly. Never seen rendered.

## How to verify anything here
The diagnostics are Render's application log (`[hostaway webhook]` lines — the append line reports the task, the message count and the priority transition) and the `tasks` table itself (`hostaway_conversation_id`, `hostaway_message_count`, `hostaway_last_message_at`, `hostaway_answered_at`, `hostaway_thread`). There is deliberately no `agent_runs` row — none of this is agent work.

## Known limits, already accepted (do not re-litigate)
- **A greeting followed by silence, then the problem 5 minutes later** → two tasks, one useless. The window does not catch it. Same as today, not worse.
- **A reply sent from the Airbnb/Booking app** may carry no `userId` → the task stays open and is closed by hand. Fails safe.
- **90 seconds is the one tuned number**, resting on 14 burst pairs and a single 2.4-minute counter-example. One constant in `hostaway_threading.py`.

## Still open from before (unchanged, none of it touched by this work)
- **Day view + conversation memory were never verified through the real logged-in UI** (`#dv1`..`#dv13`, `#m1`..`#m8`; checklists preserved in PROJECT_STATUS.md).
- **The per-task agent's new ✨ panel has never been seen rendered**, and UNDO / delete-confirm / Save-after-agent-edit / approve-on-edit have never been clicked. The Save-after-edit one matters most.
- **The SearchTrace UI has never been seen running**; `relaxed_matches` has never fired live; an English question is still answered in Greek (the fix is `task_agent.answer_language`'s approach — decide in code, state it as a fact).
- **The two Calendar UI changes have never been seen running.**
- **`get_tasks_for_user` loads every task ever** — 124 rows in ~930 ms to use 5, on every agent request. Note the new `get_open_tasks_for_conversation` deliberately does NOT follow that pattern; it queries.
- Orphaned Google Calendar events from the silent-delete era; retry accounting gap; `_SummedUsage` has no `thoughts_token_count`; the contamination guard's cheaper variant; the 26-case suite not re-run since that guard landed.
