-- Per-user Hostaway connections — run in the Supabase SQL Editor.
-- Design: docs/superpowers/specs/2026-08-13-hostaway-per-user-integration-design.md
--
-- account_id is deliberately NOT unique. The owner's Hostaway account (147809)
-- has FIFTEEN staff users on it, and three different people were observed
-- replying to guests across 40 recent conversations. Colleagues each get their
-- own app profile and each connect that SAME Hostaway account, so a unique
-- constraint here would lock out the second colleague. It is indexed instead:
-- every inbound webhook looks a connection up by this column.
--
-- user_id IS unique: one app user connects Hostaway once.
--
-- client_secret_encrypted holds Fernet ciphertext, never the raw secret. A
-- Hostaway secret is full API access to a property management system — guest
-- names, emails, phones, reservations — so a database dump must not be enough
-- to take over someone's business.

create table if not exists hostaway_connections (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null unique references auth.users (id) on delete cascade,
  account_id              text not null,
  client_secret_encrypted text not null,
  webhook_id              integer,
  tasks_enabled           boolean not null default true,
  auto_close_enabled      boolean not null default true,
  connected_at            timestamptz not null default now()
);

-- The webhook arrives carrying accountId and nothing else identifying, on every
-- guest message. This is that lookup.
create index if not exists hostaway_connections_account_id_idx
  on hostaway_connections (account_id);

alter table hostaway_connections enable row level security;

-- Same shape as every other per-user table here: a user sees and edits only
-- their own row. The backend uses the service key and bypasses this; the policy
-- is what protects the row if it is ever read with a user token.
drop policy if exists hostaway_connections_owner on hostaway_connections;
create policy hostaway_connections_owner
  on hostaway_connections
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
