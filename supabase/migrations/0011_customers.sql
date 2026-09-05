-- ============================================================================
-- Customers: who is being sold to, who is paying, and who may look.
--
-- Phase 1 of docs/customers.md. Four additions, in dependency order:
--
--   1. school_directory gains the rest of the Department's columns — contact
--      details and classification — and a public view of the six an admin
--      needs, so that the base table can become operator-only.
--   2. operators: the cross-school role. One fact about a user, not a fourth
--      value of user_role: a profile belongs to a school and the operator
--      belongs to none.
--   3. prospects + touches: the pipeline, keyed by roll number, because the
--      universe of prospects IS the directory.
--   4. subscriptions: what a school is entitled to, one row per school per
--      year; school_licensed() computes the answer; two insert policies
--      consult it. Every school that exists today is backfilled as
--      complimentary, so deploying this changes nobody's behaviour.
--
-- What the operator can and cannot see is the point of the whole file, so it
-- is stated once here: schools, subscriptions, prospects, touches, and the
-- directory in full. NOT attempts, activities, or reviews — the vendor has no
-- business reading a student's work, and a policy that allowed it would be the
-- first thing a school's data-protection officer asked about. Usage figures
-- come through school_usage(), which returns counts and nothing else.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The rest of the Department's columns
-- ---------------------------------------------------------------------------
-- All nullable: the file is somebody else's and not every cell is filled. The
-- Y/N columns become booleans at import; anything that is neither stays null
-- rather than being guessed at.
alter table school_directory
  add column eircode      text,
  add column latitude     numeric(9,6),
  add column longitude    numeric(9,6),
  add column principal    text,
  add column email        text,
  add column phone        text,
  add column ethos        text,
  add column school_type  text,   -- Secondary, Vocational, Community, Comprehensive
  add column gender       text,   -- Girls, Boys, Mixed
  add column irish_medium text,   -- the Department's wording, verbatim
  add column deis         boolean,
  add column fee_paying   boolean,
  -- From the workbook's "Programme & Year" sheet. LC1 + LC2 is the size of the
  -- addressable class in every school in the country.
  add column ty           integer check (ty  is null or ty  >= 0),
  add column lc1          integer check (lc1 is null or lc1 >= 0),
  add column lc2          integer check (lc2 is null or lc2 >= 0);

-- ---------------------------------------------------------------------------
-- 2. The operator
-- ---------------------------------------------------------------------------
-- No insert policy and no insert grant, deliberately. A row is added in the
-- SQL editor, once, by a person:
--
--     insert into operators (user_id) values ('<auth-user-uuid>');
--
-- The operator is usually also the admin of a house tenant used for demos.
-- That is fine and expected: this table is a separate fact about the user,
-- and nothing here reads their profile.
create table operators (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create or replace function is_operator() returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.operators where user_id = auth.uid())
$$;

alter table operators enable row level security;

-- Your own row only, so a signed-in user can ask "am I an operator?" with a
-- plain select. Nobody else's: the list of operators is not for the app.
create policy operator_self_read on operators for select
  using (user_id = auth.uid());

grant select on operators to authenticated;

-- ---------------------------------------------------------------------------
-- 1b. Directory access, now that there is an operator
-- ---------------------------------------------------------------------------
-- Principal names are personal data even though the Department publishes
-- them, and the office email and phone are for the operator to use, not for
-- an admin to see while linking their school. So the base table becomes
-- operator-only, and admins read a view of the six columns they always had.
--
-- The view is a plain (security definer) view: it runs as its owner, so the
-- base table's policy does not apply inside it, and the WHERE clause is what
-- gates it instead — the same is_admin() the old policy used, plus the
-- operator. Grant on the view, not the table, is what an admin's session has.
-- A security_invoker view would have been the wrong tool here: it would apply
-- the base table's operator-only policy and show an admin nothing.
drop policy school_directory_read on school_directory;

create policy school_directory_operator_read on school_directory for select
  using (is_operator());

create view school_directory_public as
  select roll_number, name, town, county, enrolment, source_year
  from school_directory
  where is_admin() or is_operator();

grant select on school_directory_public to authenticated;
-- The table grant from 0009 stays: the operator reads the table directly, and
-- the policy above is what says who that is.

-- ---------------------------------------------------------------------------
-- 3. The pipeline
-- ---------------------------------------------------------------------------
-- `stage` covers the funnel BEFORE a tenant exists. Once a tenant exists the
-- truth is in subscriptions, and "customer", "trial" and "lapsed" are derived
-- from there rather than duplicated here. Two sources of the same fact drift.
create type prospect_stage as enum ('contacted', 'demo', 'declined', 'not_now');

create table prospects (
  roll_number     text primary key
                  references school_directory(roll_number) on update cascade,
  stage           prospect_stage not null,
  -- The person to talk to is the CS teacher, who is not in the Department's
  -- file. The principal's name is in the directory row already.
  contact_name    text,
  contact_email   text,
  contact_role    text,
  -- Honoured everywhere the list is read. A prospect who has said no is not
  -- emailed again because a filter forgot to check.
  do_not_contact  boolean not null default false,
  next_action_at  date,
  notes           text,
  updated_at      timestamptz not null default now()
);

create table touches (
  id           bigint generated always as identity primary key,
  roll_number  text not null
               references school_directory(roll_number) on update cascade,
  at           timestamptz not null default now(),
  channel      text not null check (channel in ('email', 'phone', 'visit', 'event', 'other')),
  note         text not null check (length(note) between 1 and 4000),
  logged_by    uuid not null default auth.uid() references auth.users(id)
);
create index on touches (roll_number, at desc);

create trigger prospects_touch before update on prospects
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Subscriptions
-- ---------------------------------------------------------------------------
-- One row per school per year. Renewal is a NEW row, not an edit, so the
-- history is the table. "Lapsed" is not a status: it is a school whose latest
-- period_end plus the grace period is in the past, computed by
-- school_licensed() below, so it can never be stale.
--
-- Amounts are stored as issued, in cents, and no tax is computed here —
-- whether VAT applies to software supplied to a school is an accountant's
-- question and the answer does not belong in a check constraint.
create type subscription_status as enum ('trial', 'active', 'complimentary', 'cancelled');

create table subscriptions (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references schools(id) on delete cascade,
  status        subscription_status not null,
  period_start  date not null,
  period_end    date,                         -- null only for 'complimentary'
  amount_cents  integer check (amount_cents is null or amount_cents >= 0),
  currency      text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  invoice_no    text unique,
  invoiced_on   date,
  paid_on       date,
  notes         text,
  created_at    timestamptz not null default now(),
  constraint complimentary_is_open_ended
    check ((status = 'complimentary') = (period_end is null)),
  constraint period_runs_forward
    check (period_end is null or period_end > period_start)
);
create index on subscriptions (school_id, period_end);

-- The grace period. 60 days, so nothing breaks on 1 September because a
-- purchase order is sitting on somebody's desk. lib/licensing.mjs carries the
-- same number for the banner; change one, change both.
--
-- Answers only for the caller's own school or for the operator. The function
-- is security definer so that a student's insert policy can consult it without
-- the student being able to read subscriptions, and that same property means
-- it must not answer for arbitrary schools.
create or replace function school_licensed(s uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select (s = public.current_school_id() or public.is_operator())
    and exists (
      select 1 from public.subscriptions
      where school_id = s
        and status <> 'cancelled'
        and period_start <= current_date
        and (period_end is null or period_end + interval '60 days' >= current_date)
    )
$$;

-- Every tenant that exists on the day this runs keeps working unchanged. The
-- decision to start charging any of them is a row the operator writes later,
-- not a side effect of deploying this file.
insert into subscriptions (school_id, status, period_start)
  select id, 'complimentary', created_at::date from schools;

-- ---------------------------------------------------------------------------
-- 4b. Enforcement
-- ---------------------------------------------------------------------------
-- Two insert policies gain a clause. Reads, reviews, results, sign-in and
-- password changes are untouched: a lapsed school's data is still its own,
-- and the worst outcome of a missed renewal is a student who cannot start a
-- quiz and a banner saying who to ask.

-- attempts: was `profile_id = auth.uid() and can_see_assignment(assignment_id)`.
alter policy attempt_own_insert on attempts
  with check (
    profile_id = auth.uid()
    and can_see_assignment(assignment_id)
    and school_licensed(school_id)
  );

-- assignments: the staff policy was `for all`. Split it so that only the
-- insert consults the licence — a teacher must still be able to close, edit
-- or delete an assignment after the subscription has lapsed.
drop policy assignment_staff_all on assignments;

create policy assignment_staff_read on assignments for select
  using (is_staff() and school_id = current_school_id());
create policy assignment_staff_insert on assignments for insert
  with check (is_staff() and school_id = current_school_id() and school_licensed(school_id));
create policy assignment_staff_update on assignments for update
  using (is_staff() and school_id = current_school_id())
  with check (is_staff() and school_id = current_school_id());
create policy assignment_staff_delete on assignments for delete
  using (is_staff() and school_id = current_school_id());

-- ---------------------------------------------------------------------------
-- 5. Who may read and write what
-- ---------------------------------------------------------------------------
alter table prospects     enable row level security;
alter table touches       enable row level security;
alter table subscriptions enable row level security;

-- The operator sees every school. school_read stays as it was for everyone
-- else.
create policy school_operator_read on schools for select
  using (is_operator());

create policy prospect_operator_all on prospects for all
  using (is_operator()) with check (is_operator());

create policy touch_operator_all on touches for all
  using (is_operator()) with check (is_operator());

create policy subscription_operator_all on subscriptions for all
  using (is_operator()) with check (is_operator());

-- A school's staff may read their own school's subscriptions — the banner has
-- to say when the period ends and the admin has to see what was invoiced.
-- Students learn only whether the school is licensed, via school_licensed().
create policy subscription_staff_read on subscriptions for select
  using (is_staff() and school_id = current_school_id());

grant select, insert, update, delete on prospects     to authenticated;
grant select, insert, update, delete on touches       to authenticated;
grant select, insert, update, delete on subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Usage, as counts
-- ---------------------------------------------------------------------------
-- The one window the operator has into a tenant's activity. Counts only, and
-- the function refuses anyone who is not an operator rather than returning
-- zeros, so a misconfigured caller is told rather than misled.
--
-- last_sign_in_at lives in auth.users, which nothing signed in can read; the
-- function is security definer so that it can, for this one aggregate.
create or replace function school_usage(s uuid)
  returns table (
    students     integer,
    staff        integer,
    active_30d   integer,
    attempts_30d integer,
    last_seen    timestamptz
  )
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_operator() then
    raise exception 'school_usage: operators only' using errcode = 'insufficient_privilege';
  end if;
  return query
    select
      (select count(*)::integer from public.profiles p
         where p.school_id = s and p.role = 'student' and not p.archived),
      (select count(*)::integer from public.profiles p
         where p.school_id = s and p.role in ('teacher', 'admin') and not p.archived),
      (select count(*)::integer from public.profiles p
         join auth.users u on u.id = p.id
         where p.school_id = s and u.last_sign_in_at >= now() - interval '30 days'),
      (select count(*)::integer from public.attempts a
         where a.school_id = s and a.started_at >= now() - interval '30 days'),
      (select max(u.last_sign_in_at) from public.profiles p
         join auth.users u on u.id = p.id
         where p.school_id = s);
end;
$$;

revoke execute on function school_usage(uuid) from public, anon;
grant  execute on function school_usage(uuid) to authenticated;
