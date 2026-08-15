-- Recurring tasks — run in the Supabase SQL Editor.
-- Design: docs/superpowers/specs/2026-08-15-recurring-tasks-design.md
--
-- The rule lives here; its occurrences are ORDINARY rows in tasks, which is
-- what lets Upcoming, the calendar, reminders, the daily summary and the agent
-- handle them without a single change.

create table if not exists recurrence_rules (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,

  -- the task template, copied into every occurrence
  task_name             text not null,
  description           text not null default '',
  category              text not null default 'Unknown'
                          check (category in ('Business', 'Personal', 'Unknown')),
  priority              text not null default 'P3'
                          check (priority in ('P1', 'P2', 'P3')),
  due_time              text,
  checklist             jsonb not null default '[]'::jsonb,

  -- the rule itself. weekdays is ISO: 1 = Monday .. 7 = Sunday.
  -- month_day = -1 means "the last day of the month", which is a different
  -- request from "the 31st" and cannot be expressed as a number.
  freq                  text not null check (freq in ('weekly', 'monthly')),
  weekdays              integer[],
  month_day             integer,

  starts_on             text not null,
  ends_on               text,
  is_active             boolean not null default true,
  approval_status       boolean not null default true,

  -- inherited by each occurrence
  notify_enabled        boolean not null default false,
  calendar_sync_enabled boolean not null default false,

  grace_days            integer not null default 1,
  materialized_through  text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- An incoherent rule cannot be stored, so the generator never has to defend
  -- against one at four in the morning.
  --
  -- cardinality(), not array_length(): array_length('{}',1) is NULL, and a
  -- CHECK only rejects on an explicit FALSE, so the empty-weekday rule this
  -- constraint exists to forbid would have passed straight through.
  constraint recurrence_rules_shape check (
    (freq = 'weekly'  and weekdays is not null
                      and cardinality(weekdays) > 0
                      and weekdays <@ array[1,2,3,4,5,6,7])
    or
    (freq = 'monthly' and month_day is not null
                      and (month_day = -1 or (month_day >= 1 and month_day <= 31)))
  )
);

create index if not exists recurrence_rules_user_id_idx on recurrence_rules (user_id);

alter table recurrence_rules enable row level security;

drop policy if exists recurrence_rules_owner on recurrence_rules;
create policy recurrence_rules_owner
  on recurrence_rules
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The same updated_at trigger tasks already uses.
drop trigger if exists set_updated_at on recurrence_rules;
create trigger set_updated_at
  before update on recurrence_rules
  for each row execute function update_updated_at_column();

-- ---------------------------------------------------------------------------
-- tasks: which rule produced this row, which occurrence it is, and whether it
-- was forgotten.
-- ---------------------------------------------------------------------------

alter table tasks add column if not exists recurrence_rule_id uuid
  references recurrence_rules (id) on delete set null;
alter table tasks add column if not exists occurrence_date text;
alter table tasks add column if not exists missed_at timestamptz;

-- THE duplicate guard, deliberately in the database. The scheduler runs every
-- ~2 minutes and any crash, retry or overlapping tick must be harmless.
--
-- occurrence_date is NOT due_date: drag Monday's task to Tuesday and due_date
-- becomes Tuesday while the occurrence still IS Monday's. Keyed on due_date,
-- the next pass would see Monday missing and create it again — a duplicate
-- every time anything is rescheduled.
--
-- Ordinary tasks have both columns NULL, and Postgres treats NULLs as distinct
-- in a unique constraint, so they are untouched by this.
alter table tasks drop constraint if exists tasks_recurrence_occurrence_key;
alter table tasks add constraint tasks_recurrence_occurrence_key
  unique (recurrence_rule_id, occurrence_date);

create index if not exists tasks_recurrence_rule_id_idx
  on tasks (recurrence_rule_id) where recurrence_rule_id is not null;

-- ---------------------------------------------------------------------------
-- VERIFICATION — commented out deliberately. Uncomment and run this block
-- AFTER applying the migration above, to confirm it actually took.
-- Expected: three rows (missed_at timestamptz, occurrence_date text,
-- recurrence_rule_id uuid) and one constraint row. If any row is missing,
-- stop — every later task in this plan depends on this migration.
-- ---------------------------------------------------------------------------

-- select column_name, data_type
-- from information_schema.columns
-- where table_name = 'tasks'
--   and column_name in ('recurrence_rule_id', 'occurrence_date', 'missed_at')
-- order by column_name;

-- select conname from pg_constraint where conname = 'tasks_recurrence_occurrence_key';
