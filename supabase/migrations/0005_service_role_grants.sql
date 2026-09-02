-- ============================================================================
-- Grant table privileges to `service_role`.
--
-- 0003 fixed the missing grants for `authenticated` and stopped there. It never
-- mentioned `service_role`, on the assumption that Supabase's default
-- privileges had already covered it. They had not — creating a student failed
-- with
--
--     permission denied for table schools
--
-- from a client holding the service key. Same lesson as 0003, one role over: a
-- missing GRANT is an ERROR, an RLS denial is ZERO ROWS. The service role
-- bypasses RLS, but nothing lets it bypass table privileges.
--
-- Blanket rather than per-table, and that is deliberate. 0003 withheld
-- `activity_keys` from `authenticated` so that no signed-in user could read the
-- marking scheme, and withheld DELETE on `attempts` so no student could erase a
-- submission. Neither exclusion means anything for `service_role`: it is the
-- key that only server code holds, it already bypasses every policy, and the
-- score function READS activity_keys with it. Withholding privileges from it is
-- not a security boundary — it is just a broken deployment. The boundary that
-- protects the answer keys is that no user-facing role can reach them, which
-- 0003 still enforces.
--
-- To check this ran, and to see what any role can actually do:
--
--     select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--     where table_schema = 'public' and grantee in ('service_role', 'authenticated')
--     order by grantee, table_name, privilege_type;
-- ============================================================================

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- Tables added by a later migration should not have to remember this.
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
