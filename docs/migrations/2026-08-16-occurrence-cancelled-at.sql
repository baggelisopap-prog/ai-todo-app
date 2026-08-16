-- A deleted recurrence occurrence stays deleted — run in the Supabase SQL Editor.
-- Design: docs/superpowers/specs/2026-08-15-recurring-tasks-design.md
--
-- The generator skips any occurrence_date that already exists, in ANY state, so
-- the fix is simply that deleting an occurrence must leave the row behind. Hard
-- deleting it removes the date, and the next tick recreates the task within two
-- minutes — which is why the Delete button currently looks broken while Reject
-- does not.
--
-- cancelled_at is its own column and NOT a reuse of is_rejected, for the same
-- reason missed_at is: is_rejected means "the user rejected the AI's suggestion"
-- and is kept to feed the learning loop. An occurrence was never an AI
-- suggestion. It is also a different fact from missed_at — cancelled is "I
-- decided not to", missed is "the day passed" — and keeping them apart is what
-- lets a later streak view report them separately.

alter table tasks add column if not exists cancelled_at timestamptz;

-- ---------------------------------------------------------------------------
-- VERIFICATION — commented out deliberately. Uncomment and run this block
-- AFTER applying the statement above, to confirm it actually took.
-- Expected: one row, cancelled_at = timestamp with time zone.
-- ---------------------------------------------------------------------------

-- select column_name, data_type
-- from information_schema.columns
-- where table_name = 'tasks' and column_name = 'cancelled_at';
