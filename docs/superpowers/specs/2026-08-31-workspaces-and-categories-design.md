# Workspaces and user-defined categories: the category stops being a word and becomes a row

**Date**: 2026-08-31
**Status**: design approved by the owner in chat, not implemented
**Scope decision**: this is HALF of what the owner asked for on 2026-08-31. The other
half — sending a task to another person — is a **separate project, deliberately not
designed here**. See "What this deliberately does not do" and "The one thing paid
forward".

## What is wanted

The owner's words: *"θέλω να μπορεί ο χρήστης μέσα από την εφαρμογή να δημιουργήσει
workspace και μέσα στα workspace custom κατηγορίες. πχ workspace business, μέσα
categories γραφείο, μετοχές, crypto; workspace personal, categories σπίτι, κήπος."*

Two levels of grouping, both created and named by the user, replacing a fixed list of
four English words nobody chose.

## The finding that shaped the whole design

The app has exactly four categories today, and they are locked in three places at once:
a CHECK constraint in the database (`supabase_schema.sql:14` and `:22`), Pydantic
`Literal` types in `models.py:18`, `:72`, `:156`, and — the one that is easy to miss —
**the prompt that tells the AI how to classify** (`ai_engine.py:43`).

The four words are `Business`, `Personal`, `Unknown`, `Hostaway`. Reading where each one
is actually produced and consumed, **only two of them are categories at all**:

| Word | What it actually is |
|---|---|
| `Business`, `Personal` | Top-level areas of life. In the owner's own example these are **workspaces**, not categories. |
| `Hostaway` | Not a category — a **provenance**. It is written by the webhook (`main.py:1327`), never by a human, and it means "this arrived from a guest message". |
| `Unknown` | Not a category — it means "the classifier could not tell". |

This reframing is load-bearing, because it turns the migration of the owner's live data
from a guess into a mapping that is obviously correct:

- `Business` → workspace **Business**
- `Hostaway` → workspace **Business**, category **Hostaway** (protected, see below)
- `Personal` → workspace **Personal**
- `Unknown` → no workspace, no category

If instead all four had been treated as peers and turned into four categories under one
workspace, the owner would have had to reorganise his own data by hand on day one, and
the two-level structure he asked for would not exist until he built it himself.

### Naming collision avoided

`Unknown` tasks land in a bucket the UI calls **"Αταξινόμητα" (Unfiled)**, *not*
"Inbox". `InboxView.jsx` already exists and means something else entirely — tasks
awaiting approval (`!task.approval_status`). Reusing the word would put two unrelated
meanings on one label in a UI the owner reads every morning.

## Decisions, and why

### 1. The task points at a category by id, not by name

`tasks.category_id` is a foreign key to a `categories` row, not a text column holding
`'γραφείο'`.

The cheaper option was real and was considered: drop the CHECK constraint, let the
existing `category` TEXT column hold any word the user invents, and keep `categories` as
a lookup table for colours only. That touches far less code and leaves the Hostaway path
completely untouched.

It was rejected because **renaming is not a hypothetical**. A user who creates
`γραφείο` will rename it to `Γραφείο Αθήνας`. With names-as-text, every task created
before that rename silently keeps the old word and drops out of the category — the
failure is invisible at the moment it happens and is discovered weeks later with no way
to tell which tasks were affected. This codebase has been bitten by exactly this shape
of bug repeatedly (see DECISIONS.md on one value carrying two facts, with the failure
case silently losing). An id makes rename free and delete recoverable.

### 2. Deleting a container never deletes work

Both `tasks.workspace_id` and `tasks.category_id` are `ON DELETE SET NULL`.

Delete a category and its tasks become Unfiled. Delete a workspace and its categories go
with it (`ON DELETE CASCADE` from category to workspace is correct — a category has no
meaning outside its workspace) but its **tasks survive** and become Unfiled. The user
must never lose work as a side effect of tidying up.

### 3. `Hostaway` becomes a system category, marked by `system_key`

`categories.system_key` is NULL for everything the user creates, and `'hostaway'` on
exactly one row. That row cannot be renamed or deleted from the UI.

This exists so the escalation logic has **one** thing to change. Today
`get_active_hostaway_tasks` (`repository.py:570`) finds guest-message tasks by testing
`t.category == "Hostaway"`. It becomes a test against the category whose `system_key` is
`'hostaway'`. The webhook (`main.py:1327`) writes that category's id instead of the word.

The alternative — keying escalation on `hostaway_conversation_id IS NOT NULL`, which is
also set on every such task — was rejected because that column is written as
`str(conversation_id) if conversation_id else None`. It can legitimately be NULL, and a
NULL there would silently drop a P1 guest task out of escalation. The `system_key` flag
cannot be NULL by accident.

### 4. The old `category` column is dropped in a SECOND migration, not the first

The first migration adds the new columns and copies the data across. It does **not**
drop `tasks.category`.

The owner then reads the row counts himself — how many tasks existed before, how many
are in each workspace after — and only then runs a second three-line file that drops the
column. Two files because a migration that "succeeded quietly" is not evidence that it
succeeded, and this project's standing rule is output before claims. A dropped column
cannot be un-dropped.

### 5. The workspace switcher filters what you LOOK AT, never what the system DOES

The owner asked for "everything together by default, with the option to see only one
workspace". Implemented as a single switcher whose first and default entry is **"Όλα"**,
rather than as a settings toggle plus a switcher — one mechanism instead of two, and
"all" is then a normal position rather than a mode.

**Reminders, calendar sync, the daily summary, the Hostaway webhook and escalation all
ignore the switcher entirely.** A reminder the user set must ring whatever they happen
to be looking at; anything else means the app silently loses an alarm. This is a safety
property, not a preference, and it is written down here so a later "make it consistent"
refactor does not quietly break it.

### 6. The AI answers with a name; code turns the name into an id

Both the extractor (`ai_engine.py`) and the chat agent (`agent_tools.py`) will be given
the user's own workspace and category names in their prompt, and both will return a
**name**. Models handle UUIDs badly — they truncate them, transpose them, and invent
plausible-looking ones. Resolution from name to id happens in Python.

If the model returns a name that does not exist, the task is filed as **Unfiled**. No
category is auto-created from a model's output; a hallucinated category is worse than no
category, because it looks deliberate.

## Schema

### New table: `workspaces`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `user_id` | uuid NOT NULL | FK → `auth.users` ON DELETE CASCADE. The owner. |
| `name` | text NOT NULL | |
| `color` | text | for the switcher and the task chip |
| `position` | integer NOT NULL default 0 | display order |
| `created_at` | timestamptz default now() | |

`UNIQUE (user_id, name)`. RLS enabled, owner-only policy (`auth.uid() = user_id`), index
on `user_id` — the same shape as every other table here.

### New table: `categories`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid NOT NULL | FK → `auth.users` ON DELETE CASCADE |
| `workspace_id` | uuid NOT NULL | FK → `workspaces` **ON DELETE CASCADE** |
| `name` | text NOT NULL | |
| `color` | text | |
| `position` | integer NOT NULL default 0 | |
| `system_key` | text NULL | `'hostaway'` on exactly one row; NULL otherwise |
| `created_at` | timestamptz default now() | |

`UNIQUE (workspace_id, name)` — no two identical names inside one workspace.
`UNIQUE (user_id, system_key)` — a user cannot end up with two Hostaway categories, which
would split escalation in half. RLS enabled, owner-only, index on `workspace_id`.

`user_id` is carried on `categories` even though it is reachable through
`workspace_id` → `workspaces.user_id`. It is denormalised deliberately: the RLS policy on
every other table in this database is the literal expression `auth.uid() = user_id`, and
a policy that has to join to a second table to decide is both slower and a new shape
nobody here has reviewed.

### `tasks` — two new columns

- `workspace_id` uuid NULL, FK → `workspaces` **ON DELETE SET NULL**
- `category_id` uuid NULL, FK → `categories` **ON DELETE SET NULL**
- Index on `(user_id, workspace_id)`.

`tasks.category` (TEXT) survives the first migration and is dropped by the second.

`tasks.ai_suggested_category` is **not touched by this project at all**. It is a frozen
archive of what the classifier proposed in the old vocabulary (`Field(frozen=True)`,
`models.py:72`) and it feeds the learning signal. Rewriting it would be inventing history.
A future project may add an `ai_suggested_category_id` beside it; this one does not.

### `recurrence_rules` — same two columns

`workspace_id` and `category_id`, both `ON DELETE SET NULL`, plus the drop of its own
`category` column and its CHECK constraint in the second migration. Its CHECK deliberately
excluded `Hostaway`; the equivalent rule under the new schema is that a recurrence rule
may not point at a category whose `system_key` is set — enforced in the service layer,
because a CHECK cannot see another table.

### `app_settings` — one new column

`active_workspace_id` uuid NULL, FK → `workspaces` ON DELETE SET NULL. **NULL means
"Όλα"**, which is also the default for a user who has never touched the switcher, so no
backfill is needed.

## The migration, step by step

Run in the Supabase SQL Editor, as every migration here is.

1. Create `workspaces` and `categories` with their policies and indexes.
2. Add the new columns to `tasks`, `recurrence_rules`, `app_settings`.
3. For **each distinct `user_id` in `tasks`**, create a `Business` and a `Personal`
   workspace, and a `Hostaway` category (`system_key = 'hostaway'`) inside Business.
   Per-user, not just for the owner — colleagues already have their own profiles and
   their own Hostaway connections (see DATABASE_SCHEMA.md on `hostaway_connections`).
4. Set `workspace_id` / `category_id` on every task by the mapping in the table above.
5. Same for `recurrence_rules` (which has no `Hostaway` rows by construction).
6. **Stop.** Print the counts: tasks before, tasks per workspace after, tasks left
   unfiled, Hostaway tasks that did and did not get the system category.

The second migration file, run only after the owner has read those numbers, drops
`tasks.category`, `recurrence_rules.category` and their CHECK constraints.

## Backend changes

**New endpoints** (`main.py`), all scoped by `user_id` through the existing
`get_current_user_id` dependency:

- `GET /workspaces` — the user's workspaces with their categories nested (one round
  trip; the frontend needs both together on every load)
- `POST /workspaces`, `PATCH /workspaces/{id}`, `DELETE /workspaces/{id}`
- `POST /categories`, `PATCH /categories/{id}`, `DELETE /categories/{id}`

**Guards, each with a test:** renaming or deleting a category with `system_key` set →
422. Creating a category in a workspace that is not yours → 404. A duplicate name inside
one workspace → 409.

**Changed:**

- `GET /tasks` accepts an optional `workspace_id` filter.
- `main.py:967`'s `valid_categories = {"Business", ...}` set becomes a lookup against the
  user's own categories.
- `repository.get_active_hostaway_tasks` keys on the system category (see Decision 3).
- `main.py:1327`'s webhook task creation writes `workspace_id` + `category_id` from the
  system category instead of `"category": "Hostaway"`.
- `models.py` — the three `Literal[...]` category fields become optional ids.
- `task_agent.py:96` `VALID_CATEGORIES` and `:124`'s `Literal` — same treatment.

## AI and agent changes

**Extractor** (`ai_engine.py:43`): the hardcoded line listing three categories is
replaced by the user's own workspaces and their categories, rendered into the prompt.
The model returns a name; `services` resolves it.

**Chat agent** (`agent_tools.py`): the category `Literal` appears at `:436`, `:888`,
`:972` and inside the JSON tool schema at `:1028`, with the runtime whitelist at `:467`.
The `Literal` becomes `str`, and the user's category names go into the tool
*description* instead — which works because `build_tool_functions(cached_tasks)` already
builds the tools **per call**, not once at import. This is the single fact that keeps the
agent from being a rewrite; it was checked before this design was written.

`agent_engine_explain.py` carries the same declarations but is **not imported by
anything** (verified 2026-08-31 — `main.py:30-32` imports `agent_engine`,
`agent_history`, `agent_tools`). It is a Greek-annotated teaching mirror. It should be
updated to match or explicitly stamped as describing the pre-workspaces version; it must
not be edited under the impression that it is live.

## Frontend changes

- **`WorkspaceProvider`** — one source of truth for workspaces and categories, modelled on
  the existing `RecurrenceProvider`, which is the pattern that already solved
  "many components need the same list and a shared editor modal" in this codebase.
- **Workspace switcher** in `AppBar`, "Όλα" first and default, its choice persisted to
  `app_settings.active_workspace_id`.
- **Management screen** in `SettingsModal` — create, rename, recolour, reorder, delete,
  for both levels. Modelled on `RecurrencesView`.
- **Category display becomes data, not code.** Today the four words are hardcoded into
  `taskDisplay.js:12` and `:20`, `FilterBar.jsx:12,15`, `BrowseView.jsx:29,55`,
  `CalendarView.jsx:1147`, `RecurrenceForm.jsx:37` and `AgentChatModal.jsx:26`. All seven
  read from the provider instead.
- Category colours move from CSS custom properties (`--category-hostaway` and friends) to
  the per-category `color` value.

## What this deliberately does not do

**No members, no invitations, no assignment, no permissions.** Sending a task to another
person is the owner's other request from the same conversation and is a separate project
with its own unanswered questions — whose phone rings, whose calendar the event lands on,
what the agent sees when asked "what do I have today", and what happens to the roughly
180 mentions of `user_id` in `repository.py` (182 by a plain grep on 2026-08-31), most of
them owner-scoping filters that currently assume one person per row.

### The one thing paid forward

`workspaces.user_id` — an owner column on a table that today has exactly one person per
workspace. It costs one column now, and it means the sharing project adds a
`workspace_members` table **beside** this schema rather than restructuring it. That is the
whole reason workspaces and categories are being built together in one project instead of
categories alone: a category built without a workspace above it would have to be migrated
a second time when sharing arrives.

## Implementation order

Five slices. The app runs, and its tests pass, at the end of each.

1. **Tables, migration, backend.** Nothing visible changes. New columns are populated and
   served; the UI still reads the old ones.
2. **Frontend.** Switcher, management screen, filters and colours from the provider.
3. **AI and agent** learn the user's categories.
4. **Recurrence rules.**
5. **The second migration** drops the old columns, after the owner has read the counts.

## Verification

Evidence, not claims — the standing rule in CLAUDE.md.

- Backend: `./venv/Scripts/python.exe -m pytest tests/ -q`. Baseline is **209 passing**
  as of 2026-08-17; the number must go up, never down.
- Frontend: `cd frontend && npm run check`. ESLint baseline is **12** as of 2026-08-25.
- New tests: the four guards above; the name→id resolution including the miss that files
  a task as Unfiled; `get_active_hostaway_tasks` finding tasks through `system_key`; and a
  migration test that a task whose category is deleted keeps existing with
  `category_id IS NULL`.
- **A browser walkthrough the owner runs himself**, because the one thing no test can
  prove is that his real data came through intact: every task he had before is still
  there, the Business/Personal split matches what he expects, and a live Hostaway guest
  message still creates a task that escalates.

## Open question, parked

Whether a task may belong to a category in a workspace *other* than its own. The answer
here is **no** — `category_id` must resolve to a category whose `workspace_id` matches
the task's, enforced in the service layer. Recorded because it is the kind of invariant
that is obvious now and mysterious in six months.
