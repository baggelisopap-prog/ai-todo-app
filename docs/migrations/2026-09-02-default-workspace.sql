-- The default workspace — the one the extractor speaks for when nothing is selected.
-- Design: docs/superpowers/specs/2026-08-31-workspaces-and-categories-design.md
-- Plan:   docs/superpowers/plans/2026-09-02-workspaces-slice-3-ai-and-filters.md
-- Run in the Supabase SQL Editor. Adds one nullable column. Drops nothing.
--
-- Distinct from active_workspace_id, which already exists and means "where the
-- user is looking right now". This one means "whose vocabulary the extractor
-- should be given when they are looking at everything" — a question the
-- switcher cannot answer, because "Ola" is not a workspace and the model must
-- never be asked to guess between several. A model offered fifteen category
-- names across three workspaces makes mistakes a model offered five from one
-- does not.

alter table app_settings
  add column if not exists default_workspace_id uuid
    references workspaces (id) on delete set null;

-- Seed it to Business where that exists, so the extractor has a vocabulary from
-- the very first request rather than filing everything unfiled until someone
-- happens to visit Settings. Only ever fills a NULL; re-running is harmless.
update app_settings s
   set default_workspace_id = w.id
  from workspaces w
 where w.user_id = s.user_id
   and w.name = 'Business'
   and s.default_workspace_id is null;

-- ===========================================================================
-- Read this back before trusting it.
-- ===========================================================================
-- Every account should show a default workspace. A NULL here is not fatal —
-- it means tasks added from "Ola" stay unfiled — but it is worth knowing.
select u.email,
       w.name as default_workspace
from app_settings s
join auth.users u on u.id = s.user_id
left join workspaces w on w.id = s.default_workspace_id
order by u.email;
