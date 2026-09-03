-- ============================================================================
-- Autosave one step's draft, atomically.
--
-- The portal used to autosave by reading `step_state`, merging one key into it
-- in the browser, and writing the whole object back:
--
--     select step_state from attempts where id = ?      -- read
--     ... { ...current, [stepId]: state }               -- merge, in JS
--     update attempts set step_state = ? where id = ?   -- write it all back
--
-- That is a read-modify-write across a network round trip, and the object it
-- rewrites holds EVERY step's draft. Two saves that overlap both read the same
-- `before` value, and whichever writes second silently drops the other one's
-- key. The window is small but it opens exactly where the work is: moving
-- between steps, where one step's flush is still in flight as the next step's
-- first save begins. The symptom is a whole step's draft gone with nothing
-- logged anywhere — which is the worst shape a bug can have in a table holding
-- schoolwork.
--
-- Doing the merge in the database removes the window rather than narrowing it.
-- `||` on jsonb merges at the top level, the row is locked for the duration of
-- the update, and concurrent calls for different steps now both survive.
--
-- SECURITY INVOKER (the default, stated here because it is the point): row
-- level security still applies, so `attempt_own_update` — profile_id = auth.uid()
-- AND status = 'in_progress' — decides whether the write happens, exactly as it
-- did for the direct update. This function grants nobody anything they did not
-- already have; it only makes the write atomic. The attempts_protect_scores
-- trigger still runs too, so score columns remain untouchable from here.
--
-- Returns the number of rows written, so a caller can tell "saved" from "RLS
-- refused it" — a submitted attempt silently accepting drafts, or silently
-- discarding them, is the kind of thing that should be visible.
-- ============================================================================

create or replace function save_step_state(
  p_attempt uuid,
  p_step    text,
  p_state   jsonb
) returns integer
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  written integer;
begin
  if p_step is null or p_step = '' then
    raise exception 'save_step_state: step id is required';
  end if;

  update public.attempts
     set step_state = coalesce(step_state, '{}'::jsonb) || jsonb_build_object(p_step, p_state)
   where id = p_attempt;

  get diagnostics written = row_count;
  return written;
end;
$$;

grant execute on function save_step_state(uuid, text, jsonb) to authenticated;
