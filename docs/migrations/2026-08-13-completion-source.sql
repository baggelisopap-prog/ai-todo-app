-- What closed this task, and when — run in the Supabase SQL Editor.
--
-- RUN THIS BEFORE DEPLOYING THE CODE THAT WRITES THESE COLUMNS.
-- repository.update_task sends its dict straight to Supabase with no
-- whitelist, and Supabase rejects a write containing an unknown column
-- WHOLESALE. Deploy first and every task completion in the app fails — the
-- same shape as the missing `model` column that once broke all token logging
-- (DATABASE_SCHEMA.md). Migration first, deploy second.
--
-- Why this exists: on 2026-08-13 a Hostaway task completed itself six seconds
-- after it was created. Ruling out the reply poller took half an hour and
-- ended at "a write shaped like the UI's" — a guess, because nothing anywhere
-- recorded what had done it. Now the row says so.
--
-- completed_source values written today:
--   'ui'             — services.update_task's default, the generic PATCH path
--   'agent'          — /agent/confirm-action complete_task
--   'hostaway_reply' — services.hostaway_completion_fields(), written by both
--                      the scheduler's reply check and the webhook's outgoing
--                      handler
--
-- Both columns are cleared when a task is re-opened: a task that is open
-- again must not keep claiming it was closed, or by whom.
--
-- Existing rows keep NULL. That is honest — nothing recorded who closed them,
-- and backfilling a guess is exactly the habit this column exists to end.

alter table tasks add column if not exists completed_at     timestamptz;
alter table tasks add column if not exists completed_source text;
