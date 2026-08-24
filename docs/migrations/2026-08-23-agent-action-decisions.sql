-- What the agent proposed, and what the user decided about it — run in the
-- Supabase SQL Editor.
--
-- WHY THIS EXISTS. `agent_runs.proposed_actions` already records what the agent
-- PROPOSED. Nothing anywhere records what the user then DID about it:
--   * Confirm executes the write and leaves no trace it came from the agent —
--     the single exception is complete_task, which sets tasks.completed_source
--     = 'agent'. An agent-driven update or create is indistinguishable from a
--     hand edit the day after.
--   * Cancel never reaches the server at all. It is purely local state in
--     AgentChatModal.jsx: the card greys out and that is the end of it.
--
-- The second one is the loss worth fixing. "The AI proposed this and I refused
-- it" is the sharpest training signal this app can collect about the agent, and
-- it was being thrown away on the phone. It is the same signal `is_rejected`
-- preserves for the extractor's suggestions, and the same reason
-- ai_suggested_category / ai_suggested_priority are frozen on every task: the
-- machine's original guess has to survive the human's correction, or there is
-- nothing left to learn from.
--
-- Deliberately NOT a column on agent_runs: a run row is written once, when the
-- answer is produced, and the decision arrives later — sometimes much later,
-- sometimes never. One row per decision also means a proposal the user simply
-- walked away from is recorded by its ABSENCE, which is a third real state
-- ("never decided") and not the same fact as a cancellation.

create table if not exists agent_action_decisions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,

  -- The grouping key the client already echoes on every agent call. NOT a
  -- foreign key, for the same reason it is not one on agent_runs: conversations
  -- are not a table, just a key.
  conversation_id uuid,

  -- The proposal's own id, so a decision can be matched back to the exact card
  -- it belongs to when one answer carried several proposals.
  action_id       text,

  action_type     text not null check (action_type in ('complete_task', 'update_task', 'create_task')),

  -- TEXT, not uuid, ON PURPOSE. This column stores what the MODEL proposed, and
  -- a malformed or hallucinated record_id is precisely the failure worth
  -- keeping. A uuid column would reject that row and lose the one case anyone
  -- would want to study.
  record_id       text,

  task_name       text,
  fields          jsonb,

  decision        text not null check (decision in ('confirmed', 'cancelled')),

  created_at      timestamptz not null default now()
);

-- The history screen reads one user's decisions, newest first, and filters by
-- conversation when opening a single one.
create index if not exists agent_action_decisions_user_conversation_idx
  on agent_action_decisions (user_id, conversation_id, created_at desc);

alter table agent_action_decisions enable row level security;

-- Same shape as every other per-user table here: a user sees only their own
-- rows. The backend uses the service key and bypasses this; the policy is what
-- protects the rows if they are ever read with a user token.
drop policy if exists agent_action_decisions_owner on agent_action_decisions;
create policy agent_action_decisions_owner
  on agent_action_decisions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- VERIFICATION — commented out deliberately. Uncomment and run this block
-- AFTER applying the statements above, to confirm they actually took.
-- Expected: 10 rows, one per column, and rowsecurity = true.
-- ---------------------------------------------------------------------------

-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_name = 'agent_action_decisions'
-- order by ordinal_position;

-- select relname, relrowsecurity
-- from pg_class
-- where relname = 'agent_action_decisions';
