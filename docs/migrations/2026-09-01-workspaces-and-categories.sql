-- Workspaces and user-defined categories — PART A of 2.
-- Design: docs/superpowers/specs/2026-08-31-workspaces-and-categories-design.md
-- Plan:   docs/superpowers/plans/2026-09-01-workspaces-slice-1-backend.md
-- Run in the Supabase SQL Editor.
--
-- THIS FILE CREATES AND COPIES. IT DROPS NOTHING.
-- tasks.category and recurrence_rules.category survive untouched, and the app
-- keeps reading them for the whole of Slice 1. Part B drops them, and must not
-- be run until a human has read the counts printed at the bottom of this file.

begin;

-- ---------------------------------------------------------------- workspaces
create table if not exists workspaces (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  color       text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists workspaces_user_id_idx on workspaces (user_id);

alter table workspaces enable row level security;

drop policy if exists "workspaces are owner-only" on workspaces;
create policy "workspaces are owner-only" on workspaces
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- categories
-- user_id is denormalised (it is reachable via workspace_id -> workspaces).
-- Deliberate: every RLS policy in this database is the literal expression
-- auth.uid() = user_id, and a policy that joins to a second table to decide is
-- both slower and a shape nobody here has reviewed.
--
-- unique (user_id, system_key): Postgres treats NULLs as distinct, so a user
-- may have any number of ordinary categories (system_key NULL) but only ever
-- one 'hostaway'. Two would split escalation in half.
create table if not exists categories (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  workspace_id  uuid not null references workspaces (id) on delete cascade,
  name          text not null,
  color         text,
  position      integer not null default 0,
  system_key    text,
  created_at    timestamptz not null default now(),
  unique (workspace_id, name),
  unique (user_id, system_key)
);

create index if not exists categories_workspace_id_idx on categories (workspace_id);
create index if not exists categories_user_id_idx on categories (user_id);

alter table categories enable row level security;

drop policy if exists "categories are owner-only" on categories;
create policy "categories are owner-only" on categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------- new columns
-- ON DELETE SET NULL on both, on purpose: deleting a container must never
-- delete work. A task whose workspace or category is removed becomes unfiled,
-- it does not disappear.
alter table tasks
  add column if not exists workspace_id uuid references workspaces (id) on delete set null,
  add column if not exists category_id  uuid references categories (id) on delete set null;

create index if not exists tasks_user_workspace_idx on tasks (user_id, workspace_id);

alter table recurrence_rules
  add column if not exists workspace_id uuid references workspaces (id) on delete set null,
  add column if not exists category_id  uuid references categories (id) on delete set null;

-- NULL means "Ola" (show every workspace), which is also the default for a
-- user who has never touched the switcher — so no backfill is needed.
alter table app_settings
  add column if not exists active_workspace_id uuid references workspaces (id) on delete set null;

-- ----------------------------------------------------------- seed, per user
-- auth.users, not profiles: auth.users is the authoritative list every other
-- table already references, and colleagues each have their own account and
-- their own Hostaway connection (see DATABASE_SCHEMA.md on hostaway_connections
-- — account_id is deliberately NOT unique because fifteen staff share one
-- Hostaway account). Seeding only the owner would leave their tasks orphaned.
insert into workspaces (user_id, name, color, position)
select u.id, 'Business', '#2563eb', 0 from auth.users u
on conflict (user_id, name) do nothing;

insert into workspaces (user_id, name, color, position)
select u.id, 'Personal', '#16a34a', 1 from auth.users u
on conflict (user_id, name) do nothing;

insert into categories (user_id, workspace_id, name, color, position, system_key)
select w.user_id, w.id, 'Hostaway', '#f59e0b', 0, 'hostaway'
from workspaces w
where w.name = 'Business'
on conflict (user_id, system_key) do nothing;

-- ------------------------------------------------------------- copy the data
-- Each statement guards on `workspace_id is null` so re-running this file is
-- harmless — it will not overwrite a placement the user has since changed.

update tasks t set workspace_id = w.id
from workspaces w
where w.user_id = t.user_id and w.name = 'Business'
  and t.category = 'Business' and t.workspace_id is null;

-- Hostaway is a provenance, not a category: it lands in the Business workspace
-- AND in the locked category, which is what escalation will key on from now on.
update tasks t set workspace_id = c.workspace_id, category_id = c.id
from categories c
where c.user_id = t.user_id and c.system_key = 'hostaway'
  and t.category = 'Hostaway' and t.workspace_id is null;

update tasks t set workspace_id = w.id
from workspaces w
where w.user_id = t.user_id and w.name = 'Personal'
  and t.category = 'Personal' and t.workspace_id is null;

-- category = 'Unknown' is deliberately left with workspace_id NULL. That IS
-- "Ataxinomita" (unfiled) — Unknown was never a category, it meant "the
-- classifier could not tell", and NULL says exactly that without inventing a
-- bucket.

-- recurrence_rules has no Hostaway rows: its CHECK constraint excluded that
-- category from the day the table was created.
update recurrence_rules r set workspace_id = w.id
from workspaces w
where w.user_id = r.user_id and w.name = 'Business'
  and r.category = 'Business' and r.workspace_id is null;

update recurrence_rules r set workspace_id = w.id
from workspaces w
where w.user_id = r.user_id and w.name = 'Personal'
  and r.category = 'Personal' and r.workspace_id is null;

commit;

-- ===========================================================================
-- STOP HERE. Read these four results before running Part B.
-- ===========================================================================

-- 1. Every task, by where it landed. The unfiled count must equal the number of
--    tasks whose old category was 'Unknown' — nothing else.
select coalesce(w.name, '(unfiled)') as workspace,
       t.category                    as old_category,
       count(*)                      as tasks
from tasks t
left join workspaces w on w.id = t.workspace_id
group by 1, 2
order by 1, 2;

-- 2. The arithmetic that must balance: total before = placed + unfiled,
--    and unfiled must equal was_unknown.
select count(*)                                        as tasks_total,
       count(*) filter (where workspace_id is not null) as placed,
       count(*) filter (where workspace_id is null)     as unfiled,
       count(*) filter (where category = 'Unknown')     as was_unknown
from tasks;

-- 3. Every Hostaway task must have got the locked category. The second number
--    must be ZERO — a non-zero here means guest tasks that escalation will
--    stop finding once Part B removes the old column.
select count(*) filter (where category_id is not null) as hostaway_with_category,
       count(*) filter (where category_id is null)     as hostaway_missing_category
from tasks
where category = 'Hostaway';

-- 4. One Business, one Personal and one locked Hostaway category per account.
select u.email,
       count(distinct w.id)                                          as workspaces,
       count(distinct c.id) filter (where c.system_key = 'hostaway') as hostaway_categories
from auth.users u
left join workspaces w on w.user_id = u.id
left join categories c on c.user_id = u.id
group by u.email
order by u.email;
