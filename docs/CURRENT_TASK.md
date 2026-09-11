ACTIVE TASK — Multi-user: two people, one workspace, one task
_Overwrite this whole file when a new task starts. Keep the "ACTIVE TASK —" first line exact (cold-start anchor)._

## What was asked

The owner, 2026-09-10:

> «θέλω να κάνουμε multy users. τι θέλω ένας χρήστης να μπορεί να προσκαλέσει έναν άλλο
> χρήστη και να δούν το ίδιο τασκ. και να στείλει ο ένας στον άλλο task σαν εργασία. η να
> προσθέσει σε αυτ'ων κάτι το φαντάζομαι κάτι σαν work flow προιστάμενος στέλνειο δουλεια
> (task) στον υφιστ'αμενο κτλ»

Two things that stack: **shared visibility** (two people, one task) and **assignment**
(this one is yours). This is the other half of the 2026-08-31 request — the half the
workspaces spec deliberately refused to design before the container existed.

## The decisions, and they were his

1. **Whole workspace, not per task** — «Για αρχή το ένα αλλά να μην μπορεί να πειράξει όλα
   τα task στο workspace απλά να μπορεί ο ένας να δίνει πρόσβασει στον άλλο. επίσης να
   υπάρχει και Logs ποιος έκανε τι εκεί μέσα»
2. He asked what the big apps do — «τι κάνουν μεγάλες εφαρμογές οπώς to do list trello
   κτλ?» — and the research **contradicted half of what had been proposed to him**.
   Neither Trello nor Todoist restricts editing inside a shared container. He then chose
   their shape, on one condition: «αν αρχίσουμε με 1 μετά μπορούμε να βάλουμε το 2 πάνω
   στο 1?»
3. **Notifications: the assignee, plus an owner who opts in** — «By deafault λέω μόνο του
   υπευθηνου αλλά να έχει ο ιδιοκτήτης (για έναν υπεελεγχτικο προιστάμενο) να το βάζει και
   αυτός»
4. **No Google Calendar in v1** — chosen after being shown the four open calendar defects
   in BACKLOG.md.
5. **Invitation by link, email later** — «το 1 για αρχη αλλα μετά 2 όμως»
6. **Assigned to me counts as mine** — «άν ένα τις ομάδας έχει γίνει ανάθεση σε εμένα τότε
   θα θεωρείτε ΕΓΩ?» Yes.
7. **Comments/chat are the next project** — «δεν γίνεται να έχουμε ένα chat? οπως ειναι
   discord viber to list trello?» He was shown that Trello and Todoist have per-task
   comments rather than a chat room, and parked it as the immediate next step.
8. **Work is never lost** — «να μην σβηνονται tasks». Given as a principle, not an answer
   to one question, and it turned workspace deletion into archiving — a change to how the
   app behaves TODAY, not only under sharing.

## Where this stands

**Slice 1 of 5 is built and committed to `main`. NOT pushed, and the migration has NOT
been applied.** Nothing is live. Seven commits, `336fd6d` through `1de22b1`.

Design: `docs/superpowers/specs/2026-09-11-multi-user-workspace-sharing-design.md`
Plan: `docs/superpowers/plans/2026-09-11-multi-user-slice-1-reads-and-gate.md`

### Two things must happen before this is deployed, in this order

1. **Run `docs/migrations/2026-09-11-multi-user-sharing.sql` in the Supabase SQL Editor**,
   then uncomment its verification block and read the three numbers back.
2. Only then push.

**The order is not a formality.** `tasks.assigned_to` is now written on every task insert,
and Supabase rejects a write containing an unknown column **wholesale** (PGRST204). Deploy
before the migration and every task-creation path fails at once — manual, all three AI
paths, and the Hostaway webhook. That is exactly what `category_name` did on 2026-09-01.

## What it does

**The finding that shaped everything.** `get_all_tasks` fed two different machines — the
screens and the scheduler tick — and nobody ever had to notice, because both halves wanted
the same rows. Widening it for sharing would have broken reminders three ways, two of them
silent: five members means five pushes; `notification_sent` is **one boolean on the task
row**, so whichever member the loop reached first would flip it and the rest would find
nothing (which phone rang would depend on the order the database returned profiles in);
and `mark_notification_sent` filtered on `user_id`, so a member who is not the row's owner
matched zero rows, raised nothing, and the task would have re-notified every two minutes
forever.

So the spine is **two reads, never one**:
- `visible_to` — what you may SEE. Screens, search, the API.
- `belongs_to` — what is YOURS. Anything that rings a phone.

**The write gate did not exist and had to be built.** It had been described to the owner as
already present; checking proved otherwise and he was told before he approved. The check
was copy-pasted into each query — 19 of the 29 statements touching `tasks` — and
`services.update_task` never asked at all. It is now `access.py`, one place, and his
eventual tightening («αλλάζει μόνο τα δικά του») is an `if` inside one function.

**Only three tables become shared**: `workspaces`, `categories`, `tasks`. Settings, push
subscriptions, Google, Hostaway, token usage, agent history **and recurrence rules** all
stay strictly personal.

## Changed

`access.py` (new, 145 lines). `models.py` (+51: `assigned_to`, `archived_at`,
`WorkspaceMember`). `repository.py` (+185: membership reads, `visible_to`, `belongs_to`,
`mark_notification_sent` fix). `services.py` (+28: the gate on three write paths, the tick
repointed). `main.py` (+22: the 403 handler). One migration, 228 lines.
**Zero frontend files** — `git diff --name-only f860456..HEAD -- frontend/` returns 0.

## Baselines, as the command printed them

```
392 passed in 4.44s
```

Baseline before this work was **348 passed in 4.70s**, run on 2026-09-11 before anything
changed. `PROJECT_STATUS.md` said 312; that was the 2026-09-03 figure and had gone stale
when the soft-delete and Inbox work added tests. Corrected there.

Verified before running that no test reaches a real model — `test_task_agent_categories`
monkeypatches `generate_content`, `test_webhook_fanout` monkeypatches `classify_message` —
so the suite costs nothing to run.

Frontend `npm run check` **was not run**: no frontend file changed.

## What a person has actually SEEN

**Nothing.** Not one line of this has run against the real database or in a browser. The
migration has not been applied, the code has not been deployed, and no second account
exists.

## What nobody has watched, and what would settle it

- **The migration applying.** Run it, uncomment the verification block: memberships and
  owners must both equal the current workspace count, and `assigned` and `archived` must
  both be 0.
- **That the owner's own app is unchanged.** This is the claim slice 1 rests on and only a
  browser settles it: after deploying, tasks list, create, edit, complete, delete and
  restore exactly as before. `test_a_user_who_belongs_to_nothing_is_queried_EXACTLY_as_before`
  is the test that pins it, but a passing test is not a person looking at the app.
- **That reminders still fire.** The scheduler now reads a different function. Nothing has
  watched a real reminder arrive since the change.
- **The 403.** A refused write returning «Δεν έχετε δικαίωμα να αλλάξετε αυτό το task.»
  has only been exercised by calling the handler directly, never through HTTP.
- **The `or` filters against real PostgREST.** Both `visible_to` and `belongs_to` build
  filter strings that have only ever been asserted against a fake. The nested
  `and(user_id.eq.X,assigned_to.is.null)` in particular is syntax no test can validate.
  **This is the sharpest open risk in slice 1** and it is settled the first time the app
  lists tasks against the real database.

## Next

Slice 2: invites and members — the first slice where a second person exists. Archiving,
removal and leaving land there too, because all three need membership to exist before they
can be tested against anything real.
