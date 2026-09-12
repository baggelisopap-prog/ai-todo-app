-- Lock the two frozen AI-snapshot columns — run in the Supabase SQL Editor.
--
-- SAFE TO RUN BEFORE OR AFTER ANY CODE DEPLOY. This adds no column and removes
-- none, so PGRST204 (Supabase rejecting a whole write for one unknown key) is
-- not in play either direction. It only forbids something no live code does.
--
--
-- WHAT THIS IS FOR
--
-- `ai_suggested_category` and `ai_suggested_priority` are a frozen record of
-- what the AI actually said when a task was created, kept for a future
-- learning loop. `_supabase_row_to_task` REFUSES to build a TaskRecord without
-- them — deliberately, since 2026-08: a snapshot that silently becomes a
-- default is a guess wearing the clothes of a measurement.
--
-- The table, however, has always allowed NULL in both. The CHECK constraints
-- look like they prevent it and do not: in Postgres a CHECK passes on NULL,
-- because NULL is "unknown" rather than a value that fails the test. So the
-- only thing standing between a null and the database was the discipline of
-- the application code.
--
--
-- WHY IT MATTERS MORE SINCE SHARING (2026-09-11)
--
-- Before: one bad row broke ONE person's list — its author's.
-- After:  every member of that workspace reads that row, so one bad row breaks
--         the list for the whole team. It is also a DELAYED failure: the write
--         succeeds quietly, and the breakage appears later, on somebody else's
--         phone, in a screen unrelated to whatever wrote it.
--
-- This migration converts that into an immediate, local refusal. The cost is
-- honest and worth stating: a future code path that forgets these columns will
-- have its INSERT REJECTED and its feature will not work. That is the same
-- shape as the `category_name` incident of 2026-09-01, which took down all four
-- task-creation paths at once.
--
-- The owner raised exactly this objection when the change was proposed:
--
--     «ναι αλλα να ξερουμε οτι εχουμε κανει αυτο το πραγμα γτ μετα αν γραψουμε
--      κωδικα που γραφει και δεν το ξερει κανενας και δεν περναει απο την βαση
--      αθορυβα τι κανουμε?»
--
-- A comment in a migration file nobody opens is not an answer to that.
-- `tests/test_task_insert_paths.py` is: it fails on a developer's machine the
-- moment a THIRD way to create a task appears, names the file and the function,
-- and says what the new path has to write. Proven to trip before it shipped.
--
--
-- PRECONDITION, VERIFIED BEFORE WRITING THIS FILE
--
-- Read-only count against the live database on 2026-09-12: 0 rows with either
-- column null, across all 398 tasks on both accounts. If that ever stops being
-- true, the ALTER below REFUSES rather than damaging anything — which is why
-- the count block runs first and must return 0.


-- ---------------------------------------------------------------- 1. CHECK
-- Must both be 0. If either is not, STOP: find those rows first
-- (they are unreadable by the app already) and decide what they should say.

select
  count(*) filter (where ai_suggested_category is null) as null_category,
  count(*) filter (where ai_suggested_priority is null) as null_priority,
  count(*)                                              as total_tasks
from tasks;


-- ---------------------------------------------------------------- 2. LOCK
-- Uncomment and run only after the block above returned 0 and 0.

-- alter table tasks alter column ai_suggested_category set not null;
-- alter table tasks alter column ai_suggested_priority set not null;


-- ---------------------------------------------------------------- 3. CONFIRM
-- Uncomment after the lock. Both rows must read is_nullable = 'NO'.

-- select column_name, is_nullable
-- from information_schema.columns
-- where table_name = 'tasks'
--   and column_name in ('ai_suggested_category', 'ai_suggested_priority')
-- order by column_name;
