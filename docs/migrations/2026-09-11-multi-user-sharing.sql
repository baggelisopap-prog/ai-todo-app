-- Multi-user workspace sharing — run in the Supabase SQL Editor.
--
-- RUN THIS BEFORE DEPLOYING THE CODE THAT READS THESE TABLES.
-- Supabase rejects a write containing an unknown column WHOLESALE (PGRST204),
-- which is how `category_name` took down ALL task creation on 2026-09-01 — the
-- manual path, all three AI extraction paths and the Hostaway webhook at once.
--
-- The other direction is safe and the window can be as long as you like:
-- _supabase_row_to_task reads named keys off the row (row.get("due_date"), …)
-- and never splats it into TaskRecord(**row), so running old code simply gets
-- columns back from `select *` that it ignores.
--
-- WHAT THIS IS FOR: workspaces.user_id was added on 2026-09-01 specifically so
-- that sharing would become a table BESIDE this schema rather than a
-- restructuring of it. This is that table, plus the two it needs.
--
-- tasks.user_id DOES NOT CHANGE MEANING. It stays "who created this row" and
-- keeps every one of its existing uses. Sharing adds a second axis; it does
-- not redefine the first. Nothing in this migration rewrites existing data
-- except the membership backfill at the bottom, which only inserts.
--
-- Design: docs/superpowers/specs/2026-09-11-multi-user-workspace-sharing-design.md


-- ------------------------------------------------------- workspace_members
-- Who may SEE a workspace.
--
-- workspaces.user_id remains WHO MAY ADMINISTER it — rename, archive, invite,
-- remove people, delete tasks. These are two different questions, not two
-- answers to one: the owner is in both sets and nothing else is derived twice.
-- is_workspace_owner() therefore asks `workspaces`, never the role column
-- here; the role column exists so that "who is in this room" has one answer in
-- one table.
--
-- notify_all lives here rather than on app_settings because it is a
-- PER-WORKSPACE opinion — an owner may want the cleaning team's reminders and
-- not the office's. Default false: the owner who wants the team's
-- notifications has to ask for them, or every shared workspace is noisy on
-- day one.
create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  notify_all boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists workspace_members_user_id_idx on workspace_members (user_id);
create index if not exists workspace_members_workspace_id_idx on workspace_members (workspace_id);

alter table workspace_members enable row level security;

-- Flat and self-scoped, exactly like every other policy in this database.
--
-- The backend uses the secret key and bypasses RLS, and the frontend reads no
-- tables at all — verified 2026-09-11: every supabase.* call in frontend/src is
-- authentication (signUp, signInWithPassword, verifyOtp, signInWithOAuth,
-- getSession, onAuthStateChange, signOut) and there is not one table read. So
-- this policy being STRICTER than the application is correct for a
-- defence-in-depth layer, and the joining policy that would be needed to match
-- the app is exactly the shape the 2026-09-01 migration declined to introduce.
drop policy if exists "workspace_members are self-only" on workspace_members;
create policy "workspace_members are self-only" on workspace_members
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ------------------------------------------------------- workspace_invites
-- token_hash, NOT token.
--
-- The link is a bearer credential: whoever holds it gets in. Storing it raw
-- would make a database dump a working set of keys to every shared workspace —
-- the same reasoning that made hostaway_connections store a Fernet ciphertext
-- instead of the client secret, because "a database dump must not be enough to
-- take over someone's business". The raw token is shown once, at creation, and
-- is unrecoverable afterwards.
--
-- `email` is nullable and UNUSED today. It exists for the email-invitation
-- phase, which is blocked on a custom domain (see BACKLOG.md) because
-- Supabase's built-in mail server is 2 messages/hour and documented as
-- demonstration-only.
--
-- A link is usable only while accepted_at is null AND revoked_at is null AND
-- expires_at > now(). Three separate columns because they are three different
-- facts: used, withdrawn, and timed out.
create table if not exists workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  invited_by uuid references auth.users (id) on delete set null,
  token_hash text not null unique,
  email text,
  role text not null default 'member' check (role in ('owner', 'member')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workspace_invites_workspace_id_idx on workspace_invites (workspace_id);

alter table workspace_invites enable row level security;

drop policy if exists "workspace_invites are inviter-only" on workspace_invites;
create policy "workspace_invites are inviter-only" on workspace_invites
  for all using (auth.uid() = invited_by) with check (auth.uid() = invited_by);


-- ------------------------------------------------------ workspace_activity
-- Who did what, in a room more than one person can reach.
--
-- This is what carries the weight instead of per-task permissions. A member
-- may change and complete anything in the workspace (the shape Trello and
-- Todoist both settled on); what keeps that honest is that deleting is the
-- owner's alone, that the team gets its own workspace, and that this table
-- records the rest.
--
-- actor_user_id and task_id are both ON DELETE SET NULL: a departed
-- colleague's history stays readable, and so does the history of a task that
-- is gone.
--
-- task_name is a DELIBERATE DUPLICATE of the task's own name. With task_id
-- alone, deleting a task turns its whole history into "somebody did something
-- to something". Same reasoning that made agent_action_decisions.record_id a
-- TEXT column rather than a uuid FK: a log whose rows stop being readable when
-- their subject disappears is not a log.
--
-- `action` is TEXT with no CHECK, unlike `role` above. The vocabulary will
-- grow (comments, archiving, invites) and a CHECK constraint on a log's verb
-- column means a migration every time something new becomes worth recording.
--
-- No retention policy and nothing purges it — permanent archive, the same
-- standing as agent_runs. Rows are removed only by hand-run SQL.
create table if not exists workspace_activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  task_id uuid references tasks (id) on delete set null,
  task_name text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workspace_activity_ws_created_idx
  on workspace_activity (workspace_id, created_at desc);

alter table workspace_activity enable row level security;

drop policy if exists "workspace_activity is actor-only" on workspace_activity;
create policy "workspace_activity is actor-only" on workspace_activity
  for all using (auth.uid() = actor_user_id) with check (auth.uid() = actor_user_id);


-- -------------------------------------------------------------- new columns
-- WHO IS RESPONSIBLE, as distinct from user_id, which stays "who created this
-- row". NULL means nobody has taken it — a real state, not an unset one: an
-- unassigned task in a shared workspace is visible to every member and in
-- nobody's day view but its creator's.
--
-- SET NULL, not CASCADE, for the same reason workspace_id and category_id are
-- SET NULL: deleting a PERSON must never delete work. A task whose assignee's
-- account is removed becomes unassigned and stays in the workspace.
alter table tasks
  add column if not exists assigned_to uuid references auth.users (id) on delete set null;

create index if not exists tasks_assigned_to_idx on tasks (assigned_to);
create index if not exists tasks_ws_assigned_idx on tasks (workspace_id, assigned_to);

-- Archiving replaces deletion for workspaces. The owner's rule: work is never
-- lost.
--
-- Deleting a workspace already preserved its TASKS — ON DELETE SET NULL on
-- tasks.workspace_id, decided 2026-09-01, "deleting a container must never
-- delete work". What it destroyed was everything that made them findable:
-- which workspace, which category, and — once visibility is derived from
-- membership — WHO CAN SEE THEM. A colleague keeps what she wrote and loses
-- what was assigned to her, while still being the person who has to do it.
-- Nobody deletes anything and work is lost anyway.
--
-- NULL means live. Same standing as tasks.deleted_at (2026-09-04): permanent,
-- nothing purges it, no time limit on restore.
alter table workspaces
  add column if not exists archived_at timestamptz;


-- --------------------------------------------------------------- backfill
-- Every existing workspace gets its owner as a member.
--
-- Without this an owner would not be a member of their own workspace, and
-- get_member_workspace_ids would return [] for an account that has been using
-- workspaces since 2026-09-01 — which is harmless today (get_all_tasks falls
-- back to the plain user_id filter) but stops being harmless the moment
-- anything reads membership to decide what a person may reach.
--
-- ON CONFLICT DO NOTHING makes re-running the whole file harmless.
insert into workspace_members (workspace_id, user_id, role)
select id, user_id, 'owner' from workspaces
on conflict (workspace_id, user_id) do nothing;


-- ---------------------------------------------------------------------------
-- VERIFICATION — commented out deliberately. Uncomment and run this block
-- AFTER applying the statements above, to confirm they actually took.
--
-- Query 1 must return memberships = owners = your current workspace count.
--   Anything less means the backfill did not reach every workspace.
-- Query 2 must show assigned = 0 — a new column must not have touched a row —
--   and total equal to your current task count.
-- Query 3 must show archived = 0, for the same reason.
--
-- Query 2 and 3 also prove the columns exist at all: they name assigned_to and
-- archived_at, so Postgres would raise "column does not exist" rather than
-- return a number if the ALTERs had not applied.
--
-- APPLIED: not yet. Fill in the date and the numbers read back, the way
-- 2026-09-04-task-soft-delete.sql does, so the file records what was seen
-- rather than what was expected.
-- ---------------------------------------------------------------------------

-- select count(*) as memberships,
--        count(*) filter (where role = 'owner') as owners
-- from workspace_members;

-- select count(*) as total, count(assigned_to) as assigned from tasks;

-- select count(*) as total, count(archived_at) as archived from workspaces;
