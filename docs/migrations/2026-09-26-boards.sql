-- Boards: a kanban view of tasks the user picks — run in the Supabase SQL Editor.
--
-- RUN AFTER 2026-09-26-task-cancellation.sql (a board's «Ακυρώθηκε» column is
-- that migration's dropped_at) and BEFORE deploying the code that reads these
-- tables. Old code never touches them, so the order against a deploy only
-- matters one way: code first would answer every /boards request with an error.
--
-- WHAT THE OWNER ASKED FOR, 2026-09-26, in his own order of decisions:
--   - a board is its own part of the app, and HE chooses what goes on it
--     («στέλνω εγώ» — not a filter that fills it by itself);
--   - a card IS the task: it keeps its deadline, reminders, assignee, and still
--     shows on Today — one thing seen in two places;
--   - each board has its own columns, starting as Να γίνει / Σε εξέλιξη /
--     Έγινε / Ακυρώθηκε, renamed and rearranged freely — except that the last
--     two cannot be deleted, because they change the task itself;
--   - boards are personal for now; shared boards come later;
--   - who did what, and when, is recorded from day one.
--
-- FOUR TABLES, and the split is the design:
--   boards          the board, owned by one person
--   board_columns   its columns; `kind` says which one means done / called off
--   board_cards     which task sits on which board, in which column
--   board_activity  the board's diary


-- ------------------------------------------------------------------- boards
create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists boards_user_id_idx on boards (user_id);
alter table boards enable row level security;
drop policy if exists "boards are their owner's" on boards;
create policy "boards are their owner's" on boards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ------------------------------------------------------------ board_columns
-- `kind`: 'open' for every column the user shapes freely, and exactly one
-- 'done' and one 'dropped' per board. Those two are what make a column
-- change the task: a card placed in 'done' IS a completed task, in 'dropped'
-- a called-off one — the board never keeps its own second opinion about that.
--
-- user_id is denormalised (reachable through board_id) for the reason every
-- table here gives: the RLS policy stays the literal `auth.uid() = user_id`.
create table if not exists board_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind text not null default 'open' check (kind in ('open', 'done', 'dropped')),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists board_columns_board_id_idx on board_columns (board_id);
-- One of each ending per board, enforced where it cannot be argued with.
create unique index if not exists board_columns_one_done
  on board_columns (board_id) where kind = 'done';
create unique index if not exists board_columns_one_dropped
  on board_columns (board_id) where kind = 'dropped';
alter table board_columns enable row level security;
drop policy if exists "board columns are their owner's" on board_columns;
create policy "board columns are their owner's" on board_columns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- -------------------------------------------------------------- board_cards
-- A LINK TABLE rather than columns on tasks, and the reason is sharing: a task
-- in a shared workspace is seen by several people, and each of them may put it
-- on a board of their own. Columns on the task would let a colleague's «send
-- to board» silently move it off yours.
--
-- UNIQUE (task_id, user_id): one board per task PER PERSON — the owner's
-- choice («μία εργασία σε έναν πίνακα τη φορά»). Sending it to another board
-- moves it.
--
-- column_id is only meaningful for 'open' columns. A completed task is shown in
-- the board's 'done' column BECAUSE it is completed, whatever this says; when it
-- is reopened it returns to the open column recorded here. NULL means the first
-- open column. ON DELETE SET NULL: deleting a column must not take cards with it.
--
-- task_id ON DELETE CASCADE: tasks are soft-deleted and survive, so this only
-- fires for the one hard delete left — regenerating a recurrence's future days.
create table if not exists board_cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards (id) on delete cascade,
  task_id uuid not null references tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  column_id uuid references board_columns (id) on delete set null,
  position double precision not null default 0,
  added_at timestamptz not null default now(),
  unique (task_id, user_id)
);
create index if not exists board_cards_board_id_idx on board_cards (board_id);
create index if not exists board_cards_task_id_idx on board_cards (task_id);
alter table board_cards enable row level security;
drop policy if exists "board cards are their owner's" on board_cards;
create policy "board cards are their owner's" on board_cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ----------------------------------------------------------- board_activity
-- Who did what, and when — including what happened to a card from OUTSIDE the
-- board: a colleague completing the task in their list, the agent closing it,
-- a Hostaway reply closing it. That is why actor_user_id is nullable and
-- actor_kind exists: 'user' | 'agent' (a person, through the agent) |
-- 'hostaway' (nobody pressed anything).
--
-- task_name is a deliberate duplicate, as in workspace_activity: without it a
-- deleted task turns its history into "somebody did something to something".
-- `action` has no CHECK, for the same reason as there: the vocabulary grows.
-- No retention policy — a permanent diary, like agent_runs.
create table if not exists board_activity (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_kind text not null default 'user',
  action text not null,
  task_id uuid references tasks (id) on delete set null,
  task_name text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists board_activity_board_created_idx
  on board_activity (board_id, created_at desc);
alter table board_activity enable row level security;
drop policy if exists "board activity is its owner's" on board_activity;
create policy "board activity is its owner's" on board_activity
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- VERIFICATION — run AFTER the statements above. Every table must exist and be
-- empty; the two partial unique indexes must be there.
--
-- EXPECTED: four rows of 0, and two index names.
-- ---------------------------------------------------------------------------

-- select 'boards' as t, count(*) from boards
-- union all select 'board_columns', count(*) from board_columns
-- union all select 'board_cards', count(*) from board_cards
-- union all select 'board_activity', count(*) from board_activity;

-- select indexname from pg_indexes
-- where tablename = 'board_columns' and indexname like 'board_columns_one_%';
