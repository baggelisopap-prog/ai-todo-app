-- A completion by somebody else becomes a handover — run in the Supabase SQL Editor.
--
-- RUN THIS BEFORE DEPLOYING THE CODE THAT WRITES THESE COLUMNS.
-- repository.update_task and _task_to_supabase_fields send their dicts straight
-- to Supabase, and Supabase rejects a write containing an unknown column
-- WHOLESALE (PGRST204) — the shape that took down manual creation, all three AI
-- extraction paths and the Hostaway webhook simultaneously on 2026-09-01.
-- Deploy first and every task write in the app fails. Migration first, deploy
-- second.
--
-- The other direction is safe and the window can be as long as you like:
-- _supabase_row_to_task reads named keys off the row and never splats it into
-- TaskRecord(**row), so running old code simply gets two extra columns back
-- from `select *` and ignores them.
--
-- WHAT THIS IS FOR. On 2026-09-11 a member was allowed to edit anything in a
-- shared workspace, and the reason that was safe was written down: deleting
-- stays with the owner, the team gets its own room, and workspace_activity
-- records who did what. The third one was never delivered for the act that
-- ends a task. The owner closed a colleague's task on 2026-09-17 and no screen
-- in the app — and no column in this table — could say that he had.
--
-- So: the row learns WHO, and a completion stops being final for the other
-- party until they have seen it.


-- ------------------------------------------------------------- completed_by
-- Who closed it. DISTINCT FROM completed_source, which has been answering a
-- different question since 2026-08-13: what KIND of thing closed this — ui,
-- agent, hostaway_reply. That was enough while a task had one person.
--
-- NULL means no human pressed anything. The Hostaway reply poller writes its
-- completion through its own repository call and a missed occurrence closes
-- itself, so both leave this empty — and so does every task completed before
-- today. That is deliberate and load-bearing: the app reads NULL as "there is
-- nobody to hand this back to", which is what stops several hundred finished
-- tasks from reappearing on somebody's list the moment this ships. There is no
-- backfill, and there must not be one.
--
-- ON DELETE SET NULL, like assigned_to and workspace_id: removing a person must
-- never remove work. The history of who closed it is worth less than the task.
alter table tasks
  add column if not exists completed_by uuid references auth.users (id) on delete set null;


-- ------------------------------------------------------- completion_seen_by
-- Who has since pressed OK on that completion.
--
-- AN ARRAY RATHER THAN A BOOLEAN, and the reason is a bug this codebase has
-- already paid for. Two people can be owed the same handover — I create a task,
-- hand it to Maria, Nikos closes it, and both Maria and I are owed the news
-- independently. tasks.notification_sent is a single boolean and that is
-- exactly how reminders broke when sharing arrived: whichever member got there
-- first flipped it and the others found nothing (see repository.get_all_tasks).
-- One flag here would do the same thing to the handover.
--
-- NOT NULL DEFAULT '{}' rather than nullable: the browser calls .includes() on
-- this value, and a null crossing the wire would be a TypeError on every
-- completed task in the database. The app defends against null anyway, because
-- defending in one place only is how the 2026-09-11 assignment bug survived a
-- day, but the column should not be the thing producing it.
--
-- Postgres 11+ adds a column with a constant default without rewriting the
-- table, so this does not lock anything for any length of time.
alter table tasks
  add column if not exists completion_seen_by uuid[] not null default '{}';


-- No index on either. Every task read is "give me this user's rows" followed by
-- filtering in Python (repository.get_all_tasks), and the handover decision is
-- made in the browser on a list it already has. An index here would cost writes
-- and buy nothing at this size.


-- ---------------------------------------------------------------------------
-- VERIFICATION — commented out deliberately. Uncomment and run this block
-- AFTER applying the statements above, to confirm they actually took.
--
-- Query 2 is the one that matters and it proves both things at once: it names
-- both columns, so Postgres would raise "column does not exist" rather than
-- return numbers if either ALTER had not applied.
--
-- EXPECTED: closed_by_a_person = 0 and acknowledged = 0. Both must be zero —
-- a new column must not have touched a single existing row, and every task
-- finished before today must keep behaving exactly as it does now. `total` and
-- `completed` should match your current counts.
--
-- APPLIED 2026-09-18 by the owner. Read back from the live database the same
-- day, by selecting both new columns (PostgREST raises "column does not exist"
-- rather than returning rows, so a successful read IS the column existing):
--
--   total                    459
--   completed                376
--   closed_by_a_person         0   <- required
--   acknowledged               0   <- required
--   completion_seen_by NULL    0   <- required; the NOT NULL DEFAULT took
--
-- Nothing existing was touched, which is the whole test: all 376 tasks already
-- finished carry a NULL completed_by and therefore stay gone from every list.
--
-- Read back at the same time, about the OTHER half of this change: 219 of those
-- 376 completed tasks carry a completed_at. Those 219 are the rows whose History
-- date becomes correct once TaskRecord stops dropping the column; the remaining
-- 157 were completed before 2026-08-13, legitimately have no timestamp, and
-- keep showing their creation date under the flag that says so.
-- ---------------------------------------------------------------------------

-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_name = 'tasks'
--   and column_name in ('completed_by', 'completion_seen_by');

-- select count(*)                                            as total,
--        count(*) filter (where is_completed)                as completed,
--        count(completed_by)                                 as closed_by_a_person,
--        count(*) filter (where completion_seen_by <> '{}')  as acknowledged
-- from tasks;
