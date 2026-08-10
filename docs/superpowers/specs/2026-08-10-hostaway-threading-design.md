# Hostaway: message threading, a link to the conversation, and auto-complete on reply

**Date**: 2026-08-10 · **Status**: design approved, not implemented · **Requirement stated by the owner**: *«σε όλα αυτά θέλω zero fail, όχι 9/10»*

Three changes to the Hostaway path, all serving one redefinition:

> **A Hostaway task today means "a message arrived". It should mean "this conversation is waiting for me."**

1. Rapid-fire messages that are one thought stop producing three tasks.
2. A task links straight to its conversation in Hostaway.
3. Replying closes the task.

**The whole design turns on keeping the AI out of all three decisions.** Every branch below is a timestamp comparison, a null check or a row count. The AI keeps the job it already has — summarise and prioritise — and is never asked "is this the same topic?" or "did a human write this?", because those are judgements, and judgements are 9/10.

---

## 1. What was verified first, and what it changed

Nothing here was designed on an assumption. The Hostaway API was probed directly (read-only) before any of it, because this module has form: `get_reservation_details` has carried a docstring warning since day one saying its field names were guessed and never confirmed.

**Verified, with what it settles:**

| Finding | Consequence |
|---|---|
| `guestName`, `arrivalDate`, `departureDate` all exist on the Reservation object | The guesses were right. **Delete the warning in `get_reservation_details`** — free correction, unrelated to this feature |
| Every message carries `conversationId` | The grouping key exists. Threading does not need to be inferred |
| Owner's pasted inbox URL `…/messages/inbox/47342748` == a real `conversationId` | The deep link is `https://dashboard.hostaway.com/messages/inbox/{conversationId}`, confirmed against live data, not documentation |
| Messages carry `userId`, `communicationId`, `communicationEvent` | These are what separate a human reply from an automation — see below |

### 1.1 The trap that would have broken auto-complete silently

The owner's account has an automation whose `communicationEvent` is **`messageReceived`**:

> *"Hello Marion! We received your message and will reply shortly"*

It fires **automatically after every incoming guest message.**

The obvious implementation of feature 3 — *an outgoing message arrived, so complete the task* — would therefore have **auto-completed every task within seconds of creating it**, using the account's own auto-reply. No error, no log, tasks silently marked done. Exactly the shape of the `delete_calendar_event` bug (see PROJECT_STATUS.md, 2026-08-07): a success path that was never checked.

### 1.2 The signal that survives it

25 conversations scanned:

| | Count | `userId` |
|---|---|---|
| Guest messages (incoming) | 26 | — |
| Outgoing **with** `communicationId` (Hostaway automations) | 66 | `null` on **all 66** |
| Outgoing **without** `communicationId` | 24 | `990952` on **23** |

**The rule is `userId`.** Not `communicationId` — and the one row that disagrees is why. It is a **GuestArrive** message (a third-party ID-verification tool wired into the account): `communicationId` null *and* `userId` null. Had `communicationId` been chosen as the signal, GuestArrive would have passed as a human reply and closed tasks.

`userId` correctly excludes **both** kinds of automation — Hostaway's own and a third party's — with one field.

**Known limit, failing safe**: if the owner replies from the Airbnb or Booking app directly rather than through Hostaway, it is unknown whether `userId` is populated. If it is not, the task simply **stays open** and is closed by hand. The failure direction is "did not close", never "closed something unanswered".

### 1.3 The 90-second window is measured, not chosen

141 consecutive guest-message pairs across 120 conversations:

| Gap | Pairs |
|---|---|
| ≤ 1 min | **14** |
| 1–2 min | **0** |
| next pair | 2.2 min |

Every burst is under **42 seconds**. Then a gap with nothing in it. The pairs are unmistakable:

```
0.4 min   «καλησπέρα σας»               →  «Ηθελα να ρωτήσω αν η αυλή...»
0.2 min   «Kalimera sas»                →  «Avrio pia ine i pio grigori ora...»
0.1 min   «βρίσκεται κοντά στο κέντρο ;» →  «του νησιού»
0.2 min   «...να μας αλλάξετε...»       →  «Πετσέτες εννοώ συγγνώμη»
```

A greeting then the question. Half a sentence then its other half. A correction to the message just sent. **One thought, split across messages** — which is precisely today's noise, since each becomes its own task.

And the pair that sets the ceiling:

```
2.4 min   «den exv mpataria»  →  «δεν εχω νερο»
```

Two genuinely different problems, 2.4 minutes apart. **These must stay two tasks** — explicitly confirmed by the owner: *«εγω θελω να ειναι 2 διαφορετικα τασκ… απλά θελω να εξαλείψουμε τον πιθανό θόρυβο»*.

**90 seconds** sits in the empty band between the two, well above every burst and well below the earliest real second topic.

---

## 2. Schema

Four columns on `tasks` (migration run by hand in the Supabase SQL Editor, per ARCHITECTURE.md):

| Column | Type | Purpose |
|---|---|---|
| `hostaway_conversation_id` | TEXT | grouping key **and** deep link |
| `hostaway_last_message_at` | TEXT (ISO) | the 90-second comparison |
| `hostaway_message_count` | INTEGER | drives "3 μηνύματα" on the card |
| `hostaway_answered_at` | TEXT (ISO) | set when a human reply lands on a P1 — stops escalation without completing (§3.2) |

Index `hostaway_conversation_id` — it is looked up on every inbound message.

Dates stay TEXT, matching the convention already used for `due_date` and `hostaway_created_at` (see DATABASE_SCHEMA.md).

---

## 3. The flows

### 3.1 An incoming guest message

```
webhook (isIncoming = 1)  →  conversationId, body, date
   │
   ├─ open task with this conversationId
   │  AND (date − hostaway_last_message_at) ≤ 90s ?
   │
   ├─ YES → append the message to that task
   │        re-classify the WHOLE thread → new title + priority
   │        push ONLY if priority went up
   │        reset the escalation clock, bump the count
   │
   └─ NO  → create a new task, exactly as today
```

**`date` is Hostaway's, never the server's `now()`.** This is what makes the window independent of how the message reached us. Webhook or a future poll, seen instantly or five minutes late, three messages sent 40 seconds apart are 40 seconds apart. (Raised by the owner as a worry about the 2-minute scheduler; the scheduler does not fetch messages today — it runs escalations, reminders and calendar sync — but the rule holds regardless, and a batch-fed version of this function would be *cheaper*, not broken, so **it should take a list of messages, not one**.)

**Why re-classify the whole thread and not just the new message.** Because the messages being merged are exactly the ones that mean nothing alone: *«του νησιού»*, *«Πετσέτες εννοώ συγγνώμη»*. Classifying those in isolation produces garbage. With the thread, the third message turns `P3 «καλησπέρα»` into `P1 «κλειδιά — lockbox»`, and the title always reflects where the conversation *is*, not where it started.

**It costs almost nothing**, which is why this is affordable at all — the call count is *identical to today*, one per message:

| | Tokens |
|---|---|
| Classification instruction (fixed, every call) | **341** |
| «καλησπέρα σας» | 5 |
| «είμαι ο Κώστας από το άλλο μήνυμα» | 13 |
| «δεν βρίσκω τα κλειδιά, το lockbox δεν ανοίγει» | 23 |

3 calls today ≈ 1.065 tokens · 3 calls threaded ≈ 1.088 tokens · **+23 tokens (+2%) for the whole burst.** The guest's message is ~1.5% of a call; re-sending it twice is invisible.

**Deliberately rejected**: debouncing 90 seconds and making one call for the burst (3 calls → 1, ~700 tokens saved). It delays *every* notification by 90 seconds, including a first message that is already a P1 emergency. Instant push on a real problem is the entire point of this integration and is not for sale at 700 tokens.

### 3.2 An outgoing message

```
webhook (isIncoming = 0)
   │
   ├─ userId is null   → automation (Hostaway or GuestArrive) → IGNORE
   │
   └─ userId is set    → a human typed it
        │
        ├─ exactly ONE open task for this conversation
        │     ├─ P2 / P3 → complete ✓
        │     └─ P1      → set hostaway_answered_at; stop escalating; STAY OPEN
        │
        └─ TWO OR MORE  → touch nothing; notify that a reply went out
                          and N tasks are still open
```

**Why P1 does not auto-complete** — the owner's call, and the reasoning is his business, not the app's. *"I'm coming in 20 minutes"* is an answer, not a fixed problem. The alternative (close it, and trust the guest to write again if still stuck) is less machinery and was offered; it was rejected because the case it fails is the expensive one. So a P1 stops nagging but stays on the list until closed by hand.

**Why 2+ open tasks are left alone.** One reply, two open tasks, and the app cannot know which one it answered — that is a judgement, so it is not made. It notifies instead. This is rarer than it sounds: it needs two separate problems more than 90 seconds apart with no reply in between. **The notification should be an ordinary push, not an actionable one** — "you replied to Κώστας; 2 tasks still open" is enough to make the user open the app, and actionable notifications are machinery this feature does not otherwise need.

### 3.3 The deep link

A button on the expanded Hostaway task card:

```
https://dashboard.hostaway.com/messages/inbox/{hostaway_conversation_id}
```

Confirmed against a real URL. Nothing to derive, nothing to fail.

---

## 4. What is deliberately unchanged

One push per incoming message, exactly as today — **the task groups, the notification does not.** This was the owner's specific worry: *"if I read the first one and started fixing it, will I know a second arrived?"* Yes: the phone rings the same as today, the card carries an unread marker, the title changes because the thread was re-classified, and the escalation clock resets. What disappears is a second *row* for the same person about the same thing.

Also unchanged: `classify_message` and its model, escalation intervals, how a task is written, and the pre-approved status of Hostaway tasks.

---

## 5. Where this can still fail

Stated plainly, because "zero fail" was the requirement.

- **A greeting followed by silence, then the problem 5 minutes later** → two tasks, one of them useless. The window does not catch it. Same as today, not worse.
- **90 seconds is the one tuned number in the design.** It rests on 14 burst pairs and a single 2.4-minute counter-example. One constant, one line to change.
- **A reply sent from the Airbnb/Booking app** may carry no `userId` → the task stays open. Fails safe (§1.2).
- **Merging two things wrongly loses nothing** — both messages are in the task, and the re-classification covers both. Nothing is ever dropped; a message is never discarded on any path.
- **`hostaway_answered_at` is a new open-but-quiet state.** `agent_tools.is_open_task` will still count it as open, which is correct, but the day view and the agent will surface it without knowing it was answered. Acceptable; worth watching.

---

## 6. Before implementation

- Run the migration by hand (four columns + one index).
- Confirm the webhook actually fires for **outgoing** messages. Everything in §3.2 assumes it does; if it does not, the same logic runs from the 2-minute scheduler against `/conversations/{id}/messages`, which is slower but equally deterministic. **This is the one unverified assumption left in the design.**
- Backfill is not needed: existing Hostaway tasks simply have a null `hostaway_conversation_id` and behave exactly as they do today.
