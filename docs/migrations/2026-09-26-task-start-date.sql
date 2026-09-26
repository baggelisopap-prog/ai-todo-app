-- A task can have a start date as well as a deadline — run in the Supabase SQL Editor.
--
-- RUN THIS BEFORE DEPLOYING THE CODE THAT READS AND WRITES THE COLUMN.
-- _task_to_supabase_fields sends every TaskRecord field on insert, and Supabase
-- rejects a write containing an unknown column WHOLESALE (PGRST204) — every new
-- task would fail. Migration first, deploy second. Old code ignores the column.
--
-- WHAT THE OWNER ASKED FOR, 2026-09-26: «η κάρτα να έχει και από — έως, τώρα
-- έχουμε μόνο το έως». Decided with him, in this order:
--   - a task with a start date shows on Today from that day until its deadline,
--     in its own group, so a three-day job is not first seen on its last day;
--   - it is set BY HAND ONLY. The extractor does not learn it and the agent only
--     READS it: «με παραδείγματα δικά μου μπορεί να περνάει, με άλλου;» — a test
--     built from one person's phrasing proves nothing about how others speak.
--
-- TEXT, like due_date: the house convention (docs/DATABASE_SCHEMA.md) is dates as
-- 'YYYY-MM-DD' text, and ISO dates compare correctly as text.
--
-- NO CHECK (start_date <= due_date), deliberately. The app keeps the order — a
-- form refuses an inverted range, and moving a deadline moves the start with it
-- (services.TaskService.update_task) — but one writer bypasses the service: the
-- Google Calendar pull sets due_date straight from an event the owner may have
-- dragged anywhere. A CHECK would make that sync fail on the task; without one,
-- the screens simply ignore a start that has ended up after the deadline.
alter table tasks
  add column if not exists start_date text;


-- ---------------------------------------------------------------------------
-- VERIFICATION — run AFTER the statement above. EXPECTED: with_start = 0.
-- ---------------------------------------------------------------------------

-- select count(*) as total, count(start_date) as with_start from tasks;
