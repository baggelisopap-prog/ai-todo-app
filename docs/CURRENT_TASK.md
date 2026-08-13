ACTIVE TASK — Verify Hostaway threading against real traffic
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## Context
Hostaway message threading, the conversation deep link, and auto-complete on a human reply are **implemented and committed on `main`** (2026-08-10). Design: `docs/superpowers/specs/2026-08-10-hostaway-threading-design.md`. Plan: `docs/superpowers/plans/2026-08-10-hostaway-threading.md`. Migration already run by hand.

**34 unit tests pass**, and the real measured data is what they assert against — the burst pairs, the 2.4-minute two-problem pair, the `messageReceived` auto-reply payload, the GuestArrive payload. But unit tests exercise the *decisions*, not the *wiring*. Nothing below has been seen against a real Hostaway delivery. This is the same gap shape as Gaps 0–3 in the previous version of this file, and the reason that list got long is that it was never closed.

The requirement was stated as **«σε όλα αυτά θέλω zero fail, όχι 9/10»**, so a checklist that is not actually run is worth very little here.

## Gap A — CLOSED (2026-08-12). Hostaway does not deliver outgoing messages.
Answered by the owner hitting it live: replied to a guest, nothing happened. Full evidence in PROJECT_STATUS.md. Short version — `message.received` is the only message event Hostaway's unified webhooks offer, `hostaway_answered_at` was null on all 15 Hostaway tasks ever written (so the outgoing path had never run once), and the replies were sitting in the API the whole time.

**The trigger moved, the decisions did not.** `TaskService._check_hostaway_replies` runs on the existing ~2-minute cron: one `GET /v1/conversations/{id}/messages` per conversation that has an open task, then `hostaway_threading.find_unanswered_human_reply` — `is_human_reply` plus two rules polling needs and a webhook did not:
1. the reply must be **newer than the guest message the task is about** (conversation 44234683 had a human reply from the previous day that would have closed a brand-new task);
2. it must not be one **already recorded**, or an answered P1 — which stays open by design — gets rewritten every two minutes forever.

`hostaway_answered_at` now stores **Hostaway's date for the reply**, not `now()`, so both comparisons are one clock against itself. Safe to change: the column was null on every row that had ever existed, and its only two readers (`services.py`'s escalation skip, `TaskDetailSheet.jsx`) test it for truthiness.

**A second bug this exposed, now fixed**: the webhook's ignored-event branch returned with NO log line, so `[hostaway webhook] Outgoing message:` — the line this gap was supposed to be settled by — could never have distinguished "Hostaway never called" from "Hostaway called with an event name we don't match". Every delivery now logs its event before any filtering.

## Gap A2 — CLOSED (2026-08-13). Seen running on Render, both ways.
Deployed as `cd5187e` and watched against the `tasks` table, polling every 30 s:

| task | conversation | reply | result |
|---|---|---|---|
| `f6fa2735` | 49446134 | 15:11:29, sent hours earlier | closed on the FIRST tick after deploy — a reply that predated the feature was still found |
| `4c2bb5f7` | 49446111 | 15:41:21, sent during the watch | closed within ~2 minutes of being sent — the live path |

The second row is the one that matters: at 18:16 Athens that conversation had no human reply and the dry run correctly left it alone; the reply arrived at 18:41 and the task was closed by 18:42. Detection and restraint, on the same task, half an hour apart.

**Still unobserved** (small, but do not claim them): the escalation NOT firing in the same tick as a discovery (`test_the_answered_task_does_not_also_escalate_this_tick` covers the mechanism, nothing has watched it live), the two-open-tasks ambiguity push, and a P1 or P2 reply being recorded without completing — every live case so far has been a P3.

## Gap A3 — the staged rollout is deliberately incomplete
`HOSTAWAY_REPLY_AUTOCOMPLETE_PRIORITIES = {"P3"}` in `services.py`. The owner asked for the least urgent priority only, until auto-completion has been watched for a while («για αρχή, μην χάσω κανένα τασκ»). A P1 or P2 reply currently records `hostaway_answered_at` and stops the escalation, and the task stays on the list.

**Next step, when P3 has been trusted for a while**: add `"P2"` to that set. That is the entire change — both reply paths read it, and `test_adding_p2_to_the_set_is_the_only_change_needed` asserts it. P1 is not a candidate: replying to "I can't find the keys" is an answer, not a fix (design §3.2).

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
