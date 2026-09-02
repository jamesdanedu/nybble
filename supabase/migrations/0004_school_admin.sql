-- ============================================================================
-- Let an admin edit their own school.
--
-- 0001 gave schools a read policy and nothing else, so the row could be seen
-- and never corrected: fixing a school's name or slug meant the SQL editor.
--
-- Scope is deliberately narrow. `school_read` is `id = current_school_id()`,
-- and this does not widen it — an admin edits THEIR school, not any school.
-- Creating schools stays out of the app: a new school has no members, so the
-- admin creating it would not be in it and could not then see it. That needs a
-- "new school plus its first admin" flow, which is a bigger design question
-- than a CRUD screen.
-- ============================================================================

-- Staff means teacher-or-admin elsewhere; school editing is admin-only, so it
-- needs its own predicate rather than reusing is_staff().
create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and not archived
  )
$$;

create policy school_admin_update on schools for update
  using (is_admin() and id = current_school_id())
  with check (is_admin() and id = current_school_id());

-- 0003 granted select only, which is all the read policy needed.
grant update on schools to authenticated;
