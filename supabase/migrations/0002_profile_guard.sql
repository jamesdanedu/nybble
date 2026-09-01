-- ============================================================================
-- Replace the self-update policy's subquery with a trigger guard.
--
-- 0001 wrote:
--
--   create policy profile_self_update on profiles for update
--     using (id = auth.uid())
--     with check (id = auth.uid()
--                 and role = (select role from profiles p where p.id = auth.uid()));
--
-- The intent was right — stop a student promoting themselves to teacher — but
-- putting a subquery against `profiles` inside a policy on `profiles` is asking
-- for trouble. It reads as recursive even when it is not (the SELECT policies it
-- re-enters go through SECURITY DEFINER helpers, so it resolves), and its
-- correctness depends on the read policy staying that way forever. A trigger
-- says the same thing unambiguously, cannot recurse, and keeps working if the
-- read policies are ever rewritten.
-- ============================================================================

drop policy if exists profile_self_update on profiles;

create policy profile_self_update on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- A student may edit their own row, but not their role, school, username or
-- archived flag. Staff and the service role are unaffected.
create or replace function guard_profile_self_update() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  -- service_role bypasses; staff edits go through the staff policy
  if coalesce(claims ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if public.is_staff() then
    return new;
  end if;

  new.role      := old.role;
  new.school_id := old.school_id;
  new.username  := old.username;
  new.archived  := old.archived;
  return new;
end;
$$;

drop trigger if exists profiles_guard_self_update on profiles;
create trigger profiles_guard_self_update
  before update on profiles
  for each row execute function guard_profile_self_update();
