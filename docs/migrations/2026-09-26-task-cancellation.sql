-- A task can be called off, with a reason — run in the Supabase SQL Editor.
--
-- RUN THIS BEFORE DEPLOYING THE CODE THAT READS AND WRITES THESE COLUMNS.
-- _task_to_supabase_fields sends every TaskRecord field on insert, and Supabase
-- rejects a write containing an unknown column WHOLESALE (PGRST204) — the shape
-- that took down every task-creation path at once on 2026-09-01. Deploy first
-- and every new task fails. Migration first, deploy second.
--
-- The other direction is safe for as long as you like: old code reads named
-- keys off the row and simply ignores three extra columns.
--
-- WHAT THIS IS FOR. Until now a task ended one of three ways — completed,
-- deleted, or (a recurring day) missed. The owner asked for a fourth, decided
-- 2026-09-26 while designing boards: «Ακυρώθηκε — δεν έγινε το τασκ για χ ψ
-- λόγο». Not done, on purpose, and here is why. It is not a deletion: a
-- deletion says "this should never have existed", a cancellation says "it
-- existed, we decided not to do it". Without it, a task nobody will do either
-- stays open forever or is deleted and the reason is lost.
--
-- WHY NEW COLUMNS AND NOT cancelled_at. That name is taken, and by a different
-- fact: since 2026-08-16 cancelled_at means "the user DELETED this one
-- recurrence occurrence" — History shows it as «Διαγράφηκε», and Restore clears
-- it. Reusing it would make a cancelled task read as deleted in History and
-- come back through the Restore button. Hence "dropped": the owner's word in
-- the app stays «Ακύρωση»; the column name only has to not collide.
--
-- Not is_rejected either, for the reason every column beside it gives: that one
-- means "the user turned down the AI's suggestion".


-- When it was called off. NULL means it was not. Written by the server clock,
-- never the browser's, like completed_at.
alter table tasks
  add column if not exists dropped_at timestamptz;

-- Who called it off. ON DELETE SET NULL like completed_by and assigned_to:
-- removing a person must never remove work, or its history.
alter table tasks
  add column if not exists dropped_by uuid references auth.users (id) on delete set null;

-- Why — optional, the owner's decision: a required reason would be one more
-- thing to type on a phone for every cancellation. Capped so a paste cannot put
-- a novel into a column that is shown on a card.
alter table tasks
  add column if not exists drop_reason text;

alter table tasks
  drop constraint if exists tasks_drop_reason_length;
alter table tasks
  add constraint tasks_drop_reason_length check (drop_reason is null or char_length(drop_reason) <= 500);


-- No index. Every task read is "this user's rows" filtered in Python, exactly as
-- for completed_by.


-- ---------------------------------------------------------------------------
-- VERIFICATION — run AFTER the statements above. It names all three columns, so
-- Postgres raises "column does not exist" rather than returning numbers if any
-- ALTER did not apply.
--
-- EXPECTED: dropped = 0, with_reason = 0, dropped_by_someone = 0. A new column
-- must not have touched a single existing row. `total` should match your count.
-- ---------------------------------------------------------------------------

-- select count(*)            as total,
--        count(dropped_at)   as dropped,
--        count(drop_reason)  as with_reason,
--        count(dropped_by)   as dropped_by_someone
-- from tasks;
