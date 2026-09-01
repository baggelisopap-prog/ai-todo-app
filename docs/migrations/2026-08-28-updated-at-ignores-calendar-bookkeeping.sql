-- 2026-08-28 — updated_at stops counting the calendar's own bookkeeping as a change
--
-- THE BUG
-- repository.get_tasks_needing_calendar_push() decides what to push with
-- "updated_at > google_last_synced_at". repository.update_task_calendar_sync()
-- records a successful push by writing google_event_id + google_last_synced_at
-- onto the task row — and this trigger then stamped updated_at, because it
-- stamped it on EVERY update. Measured on live data: updated_at landed 0,043 -
-- 0,101 s AFTER google_last_synced_at, so the comparison was permanently true
-- and every eligible task re-entered the queue the instant it left it.
--
-- Observed cost: 21 tasks, all with a google_event_id, all synced seconds ago,
-- all still listed as "needing push" — re-pushed to Google on every ~2-minute
-- scheduler tick, roughly 15.000 pointless writes a day for zero change. It
-- never showed as a fault because every push SUCCEEDED; only the bookkeeping
-- was wrong. This is why nobody found it by watching for errors.
--
-- THE FIX
-- The trigger now asks whether anything OTHER than the calendar bookkeeping
-- actually changed. If not, it keeps the old stamp instead of writing a new
-- one. A real edit (name, date, time, priority, description, ...) still stamps
-- updated_at exactly as before, so a genuinely changed task is still pushed.
--
-- SCOPE, stated plainly:
--  * The function is SHARED with recurrence_rules (see 2026-08-15-recurring-
--    tasks.sql). That table has no google_* columns, and subtracting an absent
--    jsonb key is a no-op, so its only behaviour change is that an UPDATE which
--    writes identical values no longer bumps updated_at. Nothing reads
--    recurrence_rules.updated_at today.
--  * tasks.updated_at is read in exactly ONE place in the whole backend —
--    repository.py's push queue, the thing being fixed. Verified by grep.
--  * TG_OP is checked so the function stays correct if it is ever attached to
--    an INSERT trigger, where OLD is unassigned and to_jsonb(OLD) would raise.
--
-- Replaces, verbatim, this previous body (read out of the live database with
-- pg_get_functiondef before writing this file, not assumed):
--     BEGIN
--         NEW.updated_at = now();
--         RETURN NEW;
--     END;

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $function$
begin
  -- Only an UPDATE has an OLD row to compare against.
  if tg_op <> 'UPDATE' then
    new.updated_at = now();
    return new;
  end if;

  if to_jsonb(new) - 'updated_at' - 'google_event_id' - 'google_last_synced_at'
     is distinct from
     to_jsonb(old) - 'updated_at' - 'google_event_id' - 'google_last_synced_at'
  then
    new.updated_at = now();
  else
    -- Calendar bookkeeping only (or a no-op write): the task itself did not
    -- change, so it must not look like it did.
    new.updated_at = old.updated_at;
  end if;

  return new;
end;
$function$;

-- HOW THIS IS VERIFIED — and how it is NOT.
-- Running the statement above without an error proves only that it parsed.
--
-- A SQL self-test was written first and thrown away: inside one transaction
-- now() is frozen at transaction start, so every trigger-written updated_at
-- comes out identical and "did it advance?" reports a false FAIL. Worth
-- recording, because the obvious test for this fix is a broken test.
--
-- Verified from outside instead, against the live system:
--   1. BEFORE — repository.get_tasks_needing_calendar_push(owner) returned 21
--      tasks, every one of them already carrying a google_event_id and a
--      google_last_synced_at from seconds earlier.
--   2. AFTER the migration plus one scheduler tick — the same call must return
--      0. That is the whole bug, gone.
--   3. THEN edit one task in the app (change its time). It must reappear in
--      that queue, get pushed, and leave the queue again. This is the half
--      that proves the fix did not simply switch syncing off.
-- Step 3 is the one to insist on: step 2 alone is also what a broken push
-- queue would look like.
