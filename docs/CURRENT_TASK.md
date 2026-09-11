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

**MIGRATION APPLIED AND PUSHED, 2026-09-11.** `f860456..a60d9bd`, 21 commits. Vercel and
Render deploy themselves from `main`, so slices 1, 2 and most of 3 are live in the
business.

Design: `docs/superpowers/specs/2026-09-11-multi-user-workspace-sharing-design.md`
Plan (slice 1 only): `docs/superpowers/plans/2026-09-11-multi-user-slice-1-reads-and-gate.md`

### The migration, verified by the owner reading the numbers back

Owner ran `docs/migrations/2026-09-11-multi-user-sharing.sql` in the Supabase SQL Editor
and read the verification block: **`workspaces` total 4, archived 0**; memberships and
owners both landed where they had to. Two accounts exist — `baggelisopap@gmail.com` with
340 tasks and 2 workspaces, and a second real account with 44 tasks and 2 workspaces —
so the backfill's 4 memberships / 4 owners is exactly right, two per account.

### The sharpest open risk is CLOSED, with real numbers

Every doc before this one said the same thing: the PostgREST filter strings had only ever
been asserted against a fake, and the nested `and(user_id.eq.X,assigned_to.is.null)` was
syntax no test here could validate. Once the migration was applied that became checkable,
and it was checked read-only against the live database, on the owner's own account:

```
membership ids      : 2
visible_to  (or)    : 340
belongs_to  (and)   : 340
old plain filter    : 340
workspaces (wide)   : 2
workspaces (owned)  : 2
categories          : 4
```

**340 = 340 = 340.** The widened read returns exactly what the old one did, not one row
more — which is the failure that would have been worse than an error, because it does not
announce itself. Every filter string parsed. Checked on the second account too (44 = 44).

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

## What slice 3 built — handing the work over

**The rule that carries it: you may only hand work to somebody who is in the room.**
Without it a task can carry an assignee who cannot see it, is never notified about it and
cannot complete it — handed over in appearance only, which is worse than not handed over
at all. An unfiled task gets its own separate refusal, because the problem there is not
that the person is missing from the room, it is that there is no room.

Clearing is checked first and always allowed: putting work back on the pile needs nobody's
permission. `"assigned_to" in updates` rather than a truth test, so an explicit null
survives and a rename never pays for a membership lookup.

**The agent became personal.** `build_day_view` is injected into EVERY question, so its
size is a permanent per-question bill — the wide list would have put four other people's
work on it forever. «Τι έχω σήμερα» now answers: what I created, plus what anyone assigned
to me. An unassigned task in a shared room is nobody's work until somebody takes it.

**The Υπεύθυνος picker** appears in the task sheet only when there is somebody to hand the
task to — a workspace with one member is every solo account, and a picker whose only
option is yourself asks a question with one answer.

### Not built in slice 3

- **The assignee's initials on the task card.** Nothing on a list shows who has a task;
  you have to open it.
- **The «Δικά μου / Όλα» filter.** There is no way to narrow a shared list to your own
  work on screen. The agent does it, the screen does not.

## Changed

Backend: `access.py` and `sharing.py` (new), `models.py`, `repository.py`, `services.py`,
`main.py`, one migration.
Frontend: `MembersPanel.jsx` (new), `api.js`, `App.jsx`, `WorkspacesView.jsx`, both locale
files.

## Baselines, as the commands printed them

```
478 passed in 4.19s                                    (backend, was 348)
ui-check: OK — 72 files, 49 tokens, 441 translation keys
all passed                                             (the 11 node test scripts)
✖ 12 problems (12 errors, 0 warnings)                  (npm run lint — the baseline, unchanged)
✓ built in 366ms                                       (vite build)
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

## The AI was checked after the change, and it is untouched

Run 2026-09-11, after the push. **The cheap check first, and it is the one that
settles it**: what the agent is handed was measured before and after the swap from
`get_tasks_for_user` to `get_owned_or_assigned_tasks` — **340 tasks both times, the same
ids, a 21-row day view both times, and byte-identical text**. The change moved which
function feeds it, not what it sees.

Then ten deliberately hard questions at the real model (89.462 tokens,
`gemini-3.1-flash-lite`, logged in `token_usage_log` and `agent_runs`). All ten returned
`outcome=ok`, no exceptions. Every checkable claim was then verified against the live
database and **every one was exactly right**:

| Asked | Answered | Verified |
|---|---|---|
| πόσα ληξιπρόθεσμα, ποιο το πιο παλιό | 9, Booking.com 26/8 | 9, Booking.com 26/8 |
| τι έχω για Οκτώβριο | κανένα | 0 |
| τι έχω για το Παρίσι | δεν βρέθηκε | 0 — nothing invented |
| πόσα Business / Personal ανοιχτά | 10 / 19 | 10 / 19 |
| κλείσε το task «end» | proposed 2 | exactly the overdue one and today's; the other 14 are future occurrences of a recurring task and were correctly left alone |
| «την Παρασκευή στις 11» | Friday 18/9 | correct — it was Friday 11/9 at 16:44, so today's 11:00 had passed |

One thing the probe found and the multi-user work did not cause: see "The agent picks a
target when you never gave it one" in BACKLOG.md.

## Next: the UX of workspaces, and the appearance generally

The owner's next session is about **how this looks and feels**, not about more plumbing.
What is functionally present but visually unfinished, in the order it will be noticed:

- **Nothing on a list says who holds a task.** You have to open a task to find out. The
  assignee is a column, a picker and an API field; there is no avatar, no initials, no
  badge anywhere on `TaskCard` / `TaskRow`.
- **No «Δικά μου / Όλα» filter.** In a shared workspace every member sees every task with
  no way to narrow to their own. The agent narrows (`belongs_to`); the screen does not.
  `FilterBar.jsx` is where the other filters live.
- **The members panel is a text list.** `MembersPanel.jsx` renders names, a Remove link
  and a switch — it works, and it is plainer than the rest of Settings. It has never been
  looked at by a person.
- **The invite link is a wall of characters** in a bordered box with a Copy button. No QR,
  no share sheet, no "send on WhatsApp" affordance, and the "shown once" warning is a
  sentence rather than something that looks urgent.
- **Archiving has no way back in the UI.** `POST /workspaces/{id}/restore` exists and
  works; there is no Αρχειοθετημένα screen to reach it from, so an archived workspace is
  currently unreachable for the owner without an API call.
- **No Ιστορικό screen**, though the log is already being written by every invite, join,
  removal, archive and handover. There is real content waiting for a screen.

**Nothing in that list is blocked on backend work.** Every endpoint it needs exists and is
live.

Two conventions any UI work here has to respect, both enforced by `npm run check`:
`node scripts/ui-check.mjs` fails the build for a CSS variable that is not defined in
`index.css` (it caught `--accent`, which does not exist — the token is `--brand-primary`),
and every user-facing string goes through `t('...')` with a key in **both** `el.json` and
`en.json`. ESLint baseline is **12** and must not go up.
