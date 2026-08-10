-- Hostaway threading — run 2026-08-10 by the owner in the Supabase SQL Editor.
-- Design: docs/superpowers/specs/2026-08-10-hostaway-threading-design.md
-- Plan:   docs/superpowers/plans/2026-08-10-hostaway-threading.md
--
-- Dates are TEXT, matching due_date / hostaway_created_at (DATABASE_SCHEMA.md).
-- hostaway_last_message_at holds HOSTAWAY's message date, never a server clock
-- read — that is what makes the 90-second burst window independent of when the
-- webhook arrived.
--
-- Verified after running: all five columns selectable, and the insert payload
-- built by _task_to_supabase_fields is a strict subset of the table's columns
-- (Supabase rejects a write with an unknown column wholesale, so that check is
-- the one that matters).

alter table tasks add column if not exists hostaway_conversation_id text;
alter table tasks add column if not exists hostaway_last_message_at  text;
alter table tasks add column if not exists hostaway_message_count    integer not null default 0;
alter table tasks add column if not exists hostaway_answered_at      text;
alter table tasks add column if not exists hostaway_thread           text;

-- Looked up on every inbound Hostaway message.
create index if not exists tasks_hostaway_conversation_id_idx
  on tasks (hostaway_conversation_id)
  where hostaway_conversation_id is not null;
