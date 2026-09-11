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

**Slices 1 and 2 of 5 are built and committed to `main`. NOTHING IS PUSHED and the
migration has NOT been applied.** Nothing is live and nobody has seen a line of it run.
17 commits, starting at `336fd6d`.

Design: `docs/superpowers/specs/2026-09-11-multi-user-workspace-sharing-design.md`
Plan (slice 1 only): `docs/superpowers/plans/2026-09-11-multi-user-slice-1-reads-and-gate.md`

### Two things must happen before this is deployed, in this order

1. **Run `docs/migrations/2026-09-11-multi-user-sharing.sql` in the Supabase SQL Editor**,
   then uncomment its verification block and read the three numbers back.
2. Only then push.

**The order is not a formality.** `tasks.assigned_to` is now written on every task insert,
and Supabase rejects a write containing an unknown column **wholesale** (PGRST204). Deploy
before the migration and every task-creation path fails at once — manual, all three AI
paths, and the Hostaway webhook. That is exactly what `category_name` did on 2026-09-01.

## What slice 1 built — the foundations

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
`services.update_task` never asked at all. It is now `access.py`, one place, and the
eventual tightening («αλλάζει μόνο τα δικά του») is an `if` inside one function.

**Only three tables become shared**: `workspaces`, `categories`, `tasks`. Settings, push
subscriptions, Google, Hostaway, token usage, agent history **and recurrence rules** all
stay strictly personal.

## What slice 2 built — a second person

**Invitations.** The owner presses Πρόσκληση and gets a link to send on WhatsApp. Single
use, seven days, revocable. **Only a hash of the link is stored** — same standard as the
Hostaway secret, because a leaked invites table would otherwise be a working set of keys
to every shared workspace. The link is `?invite=<token>`, a query parameter rather than a
path, because the app has no router and a path would need a Vercel rewrite that is right
locally and wrong in production.

**Every refusal names itself.** Unknown link, used, revoked, expired, or into an archived
workspace — five different sentences in Greek, five different HTTP statuses. 410 Gone for
the dead ones: the link existed, the colleague is not wrong to have tried, and a 404 would
send them hunting for a typo that is not there.

**Members panel**, collapsed inside each workspace in Settings. Who is in the room, remove
(owner only), leave (anyone but the owner), and the «Ειδοποιήσεις για όλη την ομάδα»
switch — the «υπεελεγχτικο προιστάμενο» toggle, off by default.

**Archiving replaced deleting.** The Settings button now archives, and the confirmation
changed with it: the old one promised tasks survive and become unfiled, which is true of a
delete and **wrong** about an archive, where nothing is unlinked at all. Half the change
would have put a lie on screen.

**A second read had to exist here too, for a reason that would have been invisible.** If
`get_workspaces` widens to include workspaces you were merely invited into, then a
colleague invited BEFORE they first open the app looks furnished — and gets no Business,
no Personal, no `default_workspace_id`, with every task they create unfiled forever. That
is the exact failure `ensure_account_workspaces` was written to prevent, returning through
a side door. It asks `get_owned_workspaces` now.

## Changed

Backend: `access.py` and `sharing.py` (new), `models.py`, `repository.py`, `services.py`,
`main.py`, one migration.
Frontend: `MembersPanel.jsx` (new), `api.js`, `App.jsx`, `WorkspacesView.jsx`, both locale
files.

## Baselines, as the commands printed them

```
466 passed in 4.21s                                    (backend, was 348)
ui-check: OK — 72 files, 49 tokens, 439 translation keys
all passed                                             (the 11 node test scripts)
✖ 12 problems (12 errors, 0 warnings)                  (npm run lint — the baseline, unchanged)
✓ built in 326ms                                       (vite build)
```

Verified before running the backend suite that no test reaches a real model —
`test_task_agent_categories` monkeypatches `generate_content`, `test_webhook_fanout`
monkeypatches `classify_message` — so it costs nothing to run.

**One thing worth knowing about this suite**: a forgotten stub is not an error, it is a
LIVE query against the real Supabase project. That is how a missing `get_owned_workspaces`
stub announced itself, and how one test in `test_sharing.py` was found making a real
network call that a `try/except` was swallowing — removing it dropped that file from 1.66s
to 0.64s, which is the evidence the call was real.

## What a person has actually SEEN

**Nothing.** Not one line has run against the real database or in a browser. The migration
has not been applied, the code has not been deployed, and no second account exists.

## What nobody has watched, and what would settle it

- **The migration applying.** Run it, uncomment the verification block: memberships and
  owners must both equal the current workspace count, and `assigned` and `archived` must
  both be 0.
- **That the owner's own app is unchanged.** The claim everything rests on, and only a
  browser settles it: tasks list, create, edit, complete, delete and restore exactly as
  before.
- **The PostgREST filter strings.** `visible_to`, `belongs_to` and the workspace read all
  build filter text that has only ever been asserted against a fake. The nested
  `and(user_id.eq.X,assigned_to.is.null)` in particular is syntax no test here can
  validate. **This is the sharpest open risk** and it is settled the first time the app
  lists tasks against the real database.
- **The whole invitation round trip**, which needs two real accounts: make a link, open it
  in another browser, sign up, land in the workspace, see the tasks.
- **That reminders still fire.** The scheduler reads a different function now.

## Next

**Slice 3: assignment.** `assigned_to` is a column, an index and a model field, and
nothing writes it yet — no picker, no initials on the card, no «Δικά μου / Όλα» filter,
and the agent's day view still reads the wide list. That is the slice that makes
«προιστάμενος στέλνει δουλειά στον υφιστάμενο» actually work.

Then slice 4 (notifications to the assignee, and `notify_all` actually changing who gets
pushed) and slice 5 (the Ιστορικό screen — the activity log is being WRITTEN already, by
invites, joins, removals and archiving; nothing reads it yet).

**Two small questions parked with a proposed answer, neither confirmed:**
- An **empty** workspace — no tasks, nobody else in it — should probably still be
  hard-deletable, since there is no work to protect and refusing to remove something
  created by mistake only annoys. `DELETE /workspaces/{id}` still exists and the UI no
  longer calls it, which is why this is worth deciding rather than leaving.
- A task assigned to you inside an **archived** workspace should probably NOT appear in
  the agent's «τι έχω σήμερα» — archived means "not live work".
