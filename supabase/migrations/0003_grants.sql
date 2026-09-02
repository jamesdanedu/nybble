-- ============================================================================
-- Grant table privileges to `authenticated`.
--
-- 0001 enables row level security on all ten tables and writes policies for
-- them, but never grants a single privilege. That is not enough: RLS is a
-- filter applied ON TOP OF table privileges, not a substitute for one. With no
-- GRANT, Postgres refuses before a policy is ever consulted, and PostgREST
-- returns
--
--     permission denied for table profiles
--
-- which is what signing in actually hit — auth.getUser() succeeded, the cookie
-- was fine, and then the very first query died. The failure is invisible in the
-- app because getSession() discards the error and returns null, so a signed-in
-- user is simply shown the signed-out page.
--
-- Note the difference in symptom, because it is what makes this hard to spot:
-- an RLS policy that denies a row returns ZERO ROWS. A missing grant raises an
-- ERROR. We were looking for the former.
--
-- Granted per table rather than with a blanket GRANT ALL ON ALL TABLES, so that
-- two deliberate exclusions survive:
--
--   activity_keys  no grant at all. RLS on, no policies, by design — the answer
--                  keys are read only by the score function using the service
--                  role, which bypasses both. A blanket grant would hand every
--                  student the marking scheme, RLS or no RLS.
--   attempts       no DELETE. There is no delete policy on attempts, so the
--                  privilege would be dead weight; a student should not be able
--                  to erase their own submission.
--
-- `anon` gets nothing. The signed-out pages read no tables.
-- ============================================================================

grant usage on schema public to authenticated;

-- read-only for everyone signed in; policies narrow it to your own school
grant select on schools to authenticated;

-- staff policies are `for all`, so these need the write verbs too
grant select, insert, update, delete on profiles      to authenticated;
grant select, insert, update, delete on class_groups  to authenticated;
grant select, insert, update, delete on class_members to authenticated;
grant select, insert, update, delete on runners       to authenticated;
grant select, insert, update, delete on activities    to authenticated;
grant select, insert, update, delete on assignments   to authenticated;
grant select, insert, update, delete on reviews       to authenticated;

-- attempts has insert/select/update policies and no delete policy
grant select, insert, update on attempts to authenticated;

-- activity_keys is deliberately absent. Do not add it.
