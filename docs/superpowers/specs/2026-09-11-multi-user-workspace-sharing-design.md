# Multi-user workspaces: the workspace stops being one person's and becomes a room with a door

**Date**: 2026-09-11
**Status**: design approved by the owner in chat, not implemented
**Scope**: this is the OTHER HALF of the request made on 2026-08-31, the half that
`docs/superpowers/specs/2026-08-31-workspaces-and-categories-design.md` deliberately
refused to design before the container existed. The container exists now, and
`workspaces.user_id` — the one thing that spec paid forward — is what lets this project
add tables BESIDE the schema instead of restructuring it.

## What is wanted

The owner's words: *"θέλω να κάνουμε multy users. τι θέλω ένας χρήστης να μπορεί να
προσκαλέσει έναν άλλο χρήστη και να δούν το ίδιο τασκ. και να στείλει ο ένας στον άλλο
task σαν εργασία. η να προσθέσει σε αυτ'ων κάτι το φαντάζομαι κάτι σαν work flow
προιστάμενος στέλνειο δουλεια (task) στον υφιστ'αμενο κτλ"*

Two things, not one, and they stack: **shared visibility** (two people, one task) and
**assignment** (this one is yours). Assignment is cheap once visibility exists; it is one
column and one dropdown. Visibility is the whole project.

Five decisions were the owner's, made in chat before any code:

1. **Share the whole workspace, not each task** — with the explicit condition that
   tightening to per-task rules later must not mean rebuilding. See decision 2.
2. **Notifications go to the assignee by default**, with a switch that lets the owner
   receive them too — his words, *"για έναν υπερελεγχτικό προιστάμενο"*.
3. **No Google Calendar for shared tasks in v1** — chosen after being shown that the
   calendar layer already carries four open defects in `docs/BACKLOG.md`.
4. **Invitation is a link the owner sends himself** (WhatsApp/Viber), with email
   invitations as a later phase — chosen after being shown Supabase's built-in mail
   limit of 2 messages/hour.
5. **Comments on a task are the next project, not this one** — he asked for "chat"; the
   distinction between Trello/Todoist-style per-task comments and a Discord-style room
   was put to him and he parked both.
6. **Work is never lost** — *"να μην σβηνονται tasks"*, given as a principle rather than
   an answer to one question, and applied to all three of the questions that had been
   parked. It is what turns workspace deletion into archiving. See decisions 8 and 9.

## The finding that shaped the whole design

**There is exactly one function that reads a user's tasks, and it feeds two completely
different machines.**

`AirtableTaskRepository.get_all_tasks(user_id)` — with `repository.get_tasks_for_user`
as a module-level delegate to the same shared instance — is called from 11 places. Those
11 places divide cleanly in two, and nobody has ever had to notice because until now both
halves wanted the same rows:

- **Screens and API**: `main.py:549` (the task list endpoint), `main.py:1342` (the agent's
  write boundary re-validating a proposal), `agent_engine.py:194` (the agent's cached
  task list), `services.py:546`.
- **The scheduler tick**: `services.py:1062`, which fetches once per user per tick and is
  then *"filtered multiple ways in Python"* — advance reminders, the daily summary,
  Hostaway escalation, and missed-occurrence closing all read that one list.

If `get_all_tasks` is simply widened to include shared tasks, the second half breaks in
three ways at once, and two of them are silent:

1. **Every member's tick would find every shared task**, so a reminder would be pushed
   once per member.
2. It would not even be a consistent five pushes. `tasks.notification_sent` is **one
   boolean on the task row**. Whichever member the scheduler loop reached first would
   flip it and the others would find nothing — so which phone rings would depend on the
   order `get_all_active_user_ids()` happened to return profiles in.
3. `mark_notification_sent(user_id, record_id)` filters `.eq("user_id", user_id)`. When
   the member processing the task is not the row's owner, that update **matches zero rows
   and raises nothing** — so `notification_sent` would never be set and the task would
   re-notify on every tick, forever.

This is why the design's spine is not "widen the read". It is:

> **Two reads, never one.**
> `visible_to(user)` — what you may SEE. Screens, search, the API, the agent's search tool.
> `belongs_to(user)` — what is YOURS. Anything that rings a phone, and the agent's day view.

Every one of the 11 call sites is classified into one of the two, on purpose, in writing,
in slice 1. A new call site that reads tasks must state which it is.

## Decisions, and why

### 1. Only three tables become shared. The rest stay strictly personal.

`repository.py` mentions `user_id` 226 times. Almost none of them are in scope, because
almost none of them are about tasks.

| Becomes shared | Stays personal |
|---|---|
| `workspaces` (a member can read it) | `app_settings`, `push_subscriptions` |
| `categories` (a member can read them) | `google_calendar_connections`, `google_calendar_events` |
| `tasks` (a member can read and write) | `hostaway_connections`, `token_usage_log` |
| | `agent_runs`, `agent_action_decisions`, `profiles` |
| | **`recurrence_rules`** |

`recurrence_rules` staying personal is a deliberate cut, not an oversight. A rule belongs
to whoever wrote it; the occurrences it generates are **ordinary tasks** in the workspace
and are therefore visible to every member through the normal path. That is the same
property the recurrence design leaned on originally, and it means this project does not
have to answer "who may edit a standing commitment somebody else made" in v1.

### 2. The write gate has to be BUILT — it does not exist today

This was assumed present when the approach was first described to the owner, and checking
proved otherwise. It was corrected to him in chat before approval.

There is no single place that answers "may this person write to this task". The check is
copy-pasted into each query: 29 statements touch `supabase.table("tasks")` in
`repository.py`, 19 of them carry their own `.eq("user_id", ...)`. `services.update_task`
does not look a task up and ask permission — it calls `repository.update_task(user_id,
record_id, updates)` and the filter rides along inside.

That works while "may I write" and "is it mine" are the same question. They stop being the
same question here, and 19 scattered copies of a rule is 19 chances to miss one.

**One function, and every write path goes through it.** In v1 it answers *"yes, if you can
see it"*, with one exception (decision 3). The owner's eventual tightening — *"βλέπει όλα,
αλλάζει μόνο τα δικά του"* — is then an `if` inside that one function plus a disabled
button, with no migration, because tasks written under the loose rule remain valid under
the strict one.

### 3. A member can edit everything in the workspace. Three things keep that honest.

This is the one decision that runs against the owner's first instinct — he opened with
*"να μην μπορεί να πειράξει όλα τα task στο workspace"*. It was put to him with evidence
and he chose this with his eyes open, on the condition in decision 2.

What the research found: **neither Trello nor Todoist restricts editing within a shared
container.** A Trello board member *"can edit all content on a board"*; everyone a Todoist
project is shared with *"will have full access to all the information"* and can add,
assign and complete. The only restriction either offers is at the container boundary —
Trello's `observer` is read-only over the *whole* board and is a paid feature; Todoist's
`guest` limits which *projects* you see, not what you may do inside one.

So the industry answer to "they shouldn't see that" is **put it in a different container**,
and the answer to "who broke this" is **an activity log**, not a lock. The owner had
already asked for the log unprompted.

Three things therefore carry the weight instead of per-task permissions:

- **Deleting is the owner's alone.** The one irreversible act stays with one person.
- **`workspace_activity` records who did what.** See the schema.
- **The team gets its own workspace.** Stated plainly because it is a change in the
  owner's habits, not in the code: his Hostaway tasks currently land in **Business**, so
  inviting a cleaner into Business would show her the guest messages. The team belongs in
  a workspace created for it.

### 4. The invitation is a link, because email is not available

`grep` for `smtplib|sendgrid|resend|mailgun|postmark|send_email` across the backend
returns nothing. The app has never sent an email; every notification is Web Push. The only
Supabase admin call in the codebase is `auth.admin.delete_user`.

Supabase's built-in mail server is documented as **2 messages per hour, best-effort, for
demonstration only**; production needs a custom SMTP provider, which needs a sending
domain — and "Custom domain" is already a parked prerequisite in `docs/BACKLOG.md`
blocking the email→task feature.

So: the owner presses **Πρόσκληση**, gets a link, and sends it himself on the channel his
colleagues already use. Zero new infrastructure.

**The link is a credential, and is stored like one.** `workspace_invites` holds a
**sha256 hash** of the token, never the token. The raw value is shown once, at creation,
and is unrecoverable afterwards. This follows the standard the project already set when it
Fernet-encrypted Hostaway client secrets so that *"a database dump must not be enough to
take over someone's business"* — a leaked invite table would otherwise be a set of working
keys to every shared workspace. Single use, 7-day expiry, revocable.

### 5. One notification moment, two recipients — not two deliveries

The assignee is notified. If the workspace owner has turned `notify_all` on, the owner is
notified **in the same pass, at the same instant**, and the single existing
`tasks.notification_sent` boolean covers both.

The alternative — treating the owner's copy as its own delivery — immediately needs a
`task_notifications(task_id, user_id, sent_at)` table, because one boolean cannot record
two independent deliveries, and without it the owner's phone would buzz on every
two-minute tick forever. Sending to two subscription sets at one moment costs a loop and
no new table.

Consequently `mark_notification_sent` **loses its `.eq("user_id", ...)`** and goes through
the write gate instead: the person whose tick processed the task is frequently not the row
owner, and the current filter would silently match nothing (see "The finding").

### 6. The agent's "mine" means owned OR assigned

`build_day_view` is injected into **every** agent question, always, never gated on
pattern-matching — a deliberate cost trade already documented in `agent_engine.py`. That
makes its size a permanent per-question bill, which is why the day view reads
`belongs_to`, not `visible_to`.

"What do I have today" therefore answers: tasks I created, plus tasks anyone assigned to
me, in any workspace. A task assigned to me **is** my work and is reported as such — the
owner confirmed this reading explicitly.

The consequence worth stating, because it is not obvious: **an unassigned task in a shared
workspace is in nobody's day view but its creator's.** Every member sees it on screen; the
agent treats it as unclaimed. That is the honest reading of "what do I have", not a gap.

A second agent scoped to team workspaces was raised by the owner as a later phase and is
not designed here.

### 7. RLS stays simple, because the frontend never reads the database

Checked: `supabase.*` appears in exactly five frontend files and every call is
authentication — `signUp`, `signInWithPassword`, `verifyOtp`, `signInWithOAuth`,
`getSession`, `onAuthStateChange`, `signOut`. There is not one table read. All data
reaches the client through the backend API, which uses the secret key and bypasses RLS
anyway.

The 2026-08-31 spec deliberately avoided RLS policies that join to a second table, on the
grounds that they are slower and a shape nobody had reviewed. That judgement holds and
nothing here overturns it: the new tables get the same flat owner-scoped policies, which
makes RLS **stricter** than the application. Stricter is safe for a defence-in-depth
layer; app-code filtering remains primary, exactly as `docs/DATABASE_SCHEMA.md` states.

### 8. A workspace is archived, never deleted

The owner's rule, given as a principle: *"να μην σβηνονται tasks"*.

It is already half-true, and the half that is missing is the dangerous one. Deleting a
workspace today is `ON DELETE SET NULL` on `tasks.workspace_id`, so the work genuinely
survives and becomes unfiled. What does not survive is everything that made it findable —
which workspace, which category, and, once this project ships, **who can see it**. A
member's visibility is derived from the workspace; remove the workspace and every task
returns to whoever created it. Maria keeps what she wrote and loses what was assigned to
her, while still being the person who has to do it. Nobody deleted anything and work was
lost anyway.

So `workspaces` gets `archived_at` (TIMESTAMPTZ, nullable) and deletion is replaced:

- An archived workspace leaves the switcher, "Όλα", and every member's lists, taking its
  tasks with it.
- **Nothing is unlinked.** `workspace_id`, `category_id` and `assigned_to` are untouched.
- Restoring is one write and brings back the organisation too, including who was
  responsible for what.

This is the same standing the project already gave `tasks.deleted_at` on 2026-09-04 —
permanent archive, nothing purges it, no time limit on restore, on the stated grounds that
"with no purge a cutoff would be code whose only job is to refuse something that works".

**`ON DELETE SET NULL` stays on the foreign keys.** Archiving means nothing reaches it
through the UI any more, but a constraint whose whole job is to guarantee work survives a
hard delete is exactly the kind of safety net you keep after you stop relying on it.

**Two settings must be repointed, per member.** `app_settings.active_workspace_id` and
`default_workspace_id` are per-user and point at workspaces. Archiving one has to clear
them for **every member who had it selected**, not just the owner — otherwise that person
is looking at a workspace that is not there, and worse, the extractor is handed the
category vocabulary of an archived workspace. `active_workspace_id` falls back to NULL
("Όλα"); `default_workspace_id` falls back to Business, which `ensure_account_workspaces`
guarantees every account has.

### 9. Removing a member unassigns their work. Leaving is allowed, behind a confirmation.

Removing a member sets `assigned_to = NULL` on that person's tasks **in that workspace
only**. The tasks stay where they are, become unclaimed, and are visible to the owner the
moment it happens. The alternative — leaving the name in place — keeps a departed person
attached to work nobody is going to do and nobody is watching for.

A member may also leave a workspace themselves, behind a confirmation. Same mechanic as
removal, different button. It earns its place the first time a workspace is shared with
somebody who is not an employee — an accountant, a partner, a spouse.

Both write to `workspace_activity`.

## Schema

### New table: `workspace_members`

`id` (UUID PK), `workspace_id` (FK → `workspaces` **ON DELETE CASCADE** — membership of a
deleted room is meaningless), `user_id` (FK → `auth.users` ON DELETE CASCADE), `role`
(TEXT CHECK in `owner`/`member`), `notify_all` (bool default **false**), `joined_at`
(TIMESTAMPTZ default now()). `UNIQUE (workspace_id, user_id)`, indexes on both columns.

**The owner gets a row here too**, created in the same code path that creates a workspace.
`workspaces.user_id` and this table are not two answers to one question — they answer two
different ones. `workspaces.user_id` is **who may administer it** (rename, delete, invite,
remove people, delete tasks). `workspace_members` is **who may see it**. The owner is in
both sets; nothing else is derived twice.

`notify_all` lives on the membership row rather than on `app_settings` because it is a
per-workspace opinion: an owner may want to watch the cleaning team and not the office.

### New table: `workspace_invites`

`id` (UUID PK), `workspace_id` (FK CASCADE), `invited_by` (FK → `auth.users`), `token_hash`
(TEXT UNIQUE — **sha256 of the token, never the token**), `email` (TEXT, nullable, unused
in v1 and present for the email phase), `role` (TEXT, default `member`), `expires_at`
(TIMESTAMPTZ), `accepted_at` / `accepted_by` (nullable), `revoked_at` (nullable),
`created_at`.

A link is usable only while `accepted_at IS NULL AND revoked_at IS NULL AND expires_at >
now()`. Accepting fills `accepted_at`/`accepted_by` and inserts the `workspace_members`
row in the same transaction.

**Accepting an invite you already hold is a no-op that reports success**, not an error —
a colleague who taps the WhatsApp link twice must not see a failure.

### New table: `workspace_activity`

`id` (UUID PK), `workspace_id` (FK CASCADE), `actor_user_id` (FK → `auth.users` **ON
DELETE SET NULL** — a departed colleague's history stays readable), `action` (TEXT:
`task_created`, `task_updated`, `task_completed`, `task_reopened`, `task_assigned`,
`task_deleted`, `member_joined`, `member_removed`, `invite_created`, `invite_revoked`),
`task_id` (UUID FK → `tasks` ON DELETE SET NULL, nullable), `task_name` (TEXT),
`details` (JSONB — what changed), `created_at` (TIMESTAMPTZ default now()). Index on
`(workspace_id, created_at desc)`.

**`task_name` is a snapshot, deliberately duplicated.** With `task_id` alone, deleting a
task turns its whole history into "somebody did something to something". The same
reasoning made `agent_action_decisions.record_id` a TEXT column rather than a UUID FK: a
log whose rows stop being readable when the subject disappears is not a log.

**No retention policy and no automatic cleanup** — permanent archive, same standing as
`agent_runs`. Rows are removed only by hand-run SQL if it ever proves necessary.

### `workspaces` — one new column

`archived_at` (TIMESTAMPTZ, nullable). NULL means live. Every read of workspaces,
categories and tasks excludes archived workspaces unless the caller explicitly asks for
them, which only the "Αρχειοθετημένα" screen does. See decision 8.

### `tasks` — one new column

`assigned_to` (UUID, FK → `auth.users` **ON DELETE SET NULL**, nullable), plus indexes on
`assigned_to` and `(workspace_id, assigned_to)`.

SET NULL, not CASCADE, for exactly the reason `workspace_id` and `category_id` are SET
NULL: deleting a person must never delete work. A task whose assignee's account is removed
becomes unassigned and stays in the workspace.

`tasks.user_id` **does not change meaning**. It remains "who created this row" and keeps
every one of its existing uses. This project adds a second axis; it does not redefine the
first.

## Backend changes

**The two reads (slice 1).**

- `get_all_tasks(user_id)` becomes `visible_to`: `user_id = me` **OR** `workspace_id IN
  (workspaces where I am a member)`. One preliminary query for the id list, then one
  `.or_()`. The 11 call sites keep the same call.
- A new narrow read is added for the phone-facing machinery: tasks assigned to me, plus
  unassigned tasks I own. `services.py:1062`'s per-tick fetch moves to it, which moves
  reminders, the daily summary, Hostaway escalation and missed-occurrence closing with it
  in one edit.
- Hostaway escalation is unaffected in substance: those tasks are created per connection
  owner and remain owned by them.

**The write gate (slice 1).** One function: given a user and a task, may this be written?
v1: yes if visible, except delete → owner only. Every write path in `services.py` routes
through it. `mark_notification_sent` loses its `user_id` filter and uses the gate.

**Workspaces and categories** become readable by members: `get_workspaces`,
`get_workspace`, `get_categories_for_workspace` widen the same way. Creating, renaming and
deleting stay owner-only.

**New endpoints.** Members (list, remove), invites (create → returns the raw token once,
accept, revoke, list pending), assignment (part of the existing `PATCH /tasks/{id}`, not a
new endpoint), activity (list per workspace, paged).

**Writing the log** happens in `services`, below both the UI path and the agent path —
the same placement argument the calendar-switch item in `docs/BACKLOG.md` makes: a rule
that lives above only one caller is a rule the other caller walks around.

## Frontend changes

A **Μέλη** panel in workspace management: the member list with roles, **Πρόσκληση**
(creates the link and offers a copy button, with the one-time-visibility stated on
screen), **Αφαίρεση**. An **Υπεύθυνος** picker inside the task editor, listing that task's
workspace members. The assignee's initials on the task card. A **Δικά μου / Όλα** filter.
An **Ιστορικό** screen per workspace. A `/invite/<token>` route that accepts the link,
sends an unauthenticated visitor through sign-up first and then completes the join.

**Αρχειοθέτηση** replaces the workspace Delete button, with a confirmation that says what
will happen in numbers — how many people lose access and how many tasks go with it — and
an **Αρχειοθετημένα** list with Restore. This is the only screen that reads archived
workspaces. A member sees neither button; archiving is the owner's, like deleting was.

## What this deliberately does not do

- **Google Calendar for shared tasks.** Owner's decision, given the four open calendar
  defects in `docs/BACKLOG.md`. Personal tasks sync exactly as they do today.
- **Comments or chat.** Next project. The activity log's shape does not preclude it;
  comments would be their own table, not a reuse of `workspace_activity`.
- **Email invitations.** Phase 2, blocked on the custom-domain item.
- **Read-only / observer roles.** `role` is a TEXT column with a CHECK, so a third value
  is additive when someone actually needs it.
- **A team-scoped agent.** Raised by the owner as a later phase.
- **Per-task permissions.** Decision 2 is what keeps this cheap to add later.
- **Cross-user token accounting.** An AI call is billed to whoever made it; nothing about
  sharing changes `token_usage_log`.

## Implementation order

Five slices. The app runs and its tests pass at the end of each.

1. **Tables, the two reads, the write gate.** Nothing visible changes. The tests must
   prove existing behaviour is byte-for-byte unchanged for a single-user account.
2. **Invites and members.** The first slice where a second person exists. Archiving
   lands here too, with removal and leaving — all three need membership to exist before
   they can be tested against anything real.
3. **Assignment** — `assigned_to`, the picker, and the agent's `belongs_to` rule.
4. **Notifications** — assignee delivery plus the owner's `notify_all`.
5. **Activity log** — writing it, and the screen that reads it.

## Verification

Evidence, not claims — the standing rule in `CLAUDE.md`.

- Backend: `./venv/Scripts/python.exe -m pytest tests/ -q`. Baseline **348 passed**, run
  on 2026-09-11 before any change (`348 passed in 4.70s`); the number goes up, never down.
  Verified beforehand that no test reaches a real model — `test_task_agent_categories`
  monkeypatches `generate_content` and `test_webhook_fanout` monkeypatches
  `classify_message` — so the suite costs nothing to run.
  (`PROJECT_STATUS.md` says 312; that was the 2026-09-03 figure and is stale, not wrong —
  the soft-delete and Inbox work added tests after it.)
- Frontend: `cd frontend && npm run check`. ESLint baseline **12**.

New tests, with the negative ones treated as the important ones:

- **A non-member cannot see, and cannot write.** The test that, if it is missing, is
  learned about from a customer.
- A member sees the workspace's tasks; a member cannot delete one; the owner can.
- `belongs_to` includes tasks assigned to me and excludes shared tasks that are not.
- **One task with five members produces exactly one reminder, to the assignee** — the
  regression guarding "The finding".
- `mark_notification_sent` succeeds when the caller is not the row's owner.
- An invite link dies on use, on expiry, and on revocation; accepting twice is a no-op.
- The activity log stays readable after its task is deleted.
- Archiving a workspace hides it and its tasks from every member, unlinks nothing, and
  restores complete — same `assigned_to`, same `category_id`.
- Archiving clears `active_workspace_id` and `default_workspace_id` **for a member who is
  not the owner**, and `default_workspace_id` lands on Business.
- Removing a member unassigns their tasks in that workspace and leaves their tasks in
  other workspaces alone.

**And a browser walkthrough the owner runs himself, with a second real account** — the one
thing no test proves is whether the thing is usable by two people at once.

## Open questions, parked

The three that were parked here on 2026-09-11 were all put to the owner the same day and
answered; they are decisions 8 and 9 now. What is left:

- **Whether an empty workspace can still be hard-deleted.** Decision 8 replaces deletion
  with archiving because archiving protects work — but a workspace with no tasks and no
  other members has no work to protect, and refusing to remove one created by mistake is
  the kind of rule that only ever annoys. Proposed: allow the hard delete in exactly that
  case, archive in every other. Not yet confirmed by the owner.
- **Whether an archived workspace's tasks should still reach the agent's `belongs_to`.**
  A task assigned to me in an archived workspace is still, literally, assigned to me.
  Proposed: no — archiving means "this is not live work", and the day view is about live
  work. Decide at slice 3, when `belongs_to` is written.
