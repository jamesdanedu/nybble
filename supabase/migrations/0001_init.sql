-- ============================================================================
-- Student Activity Portal — initial schema
-- Multi-tenant from day one: every table carries school_id, all RLS goes
-- through it. Answer keys live in a table with RLS enabled and NO policies,
-- so only the service role (Edge Functions) can ever read them.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type user_role      as enum ('student', 'teacher', 'admin');
create type activity_vis   as enum ('private', 'school', 'public');
create type assignment_mode as enum ('practice', 'graded');
create type feedback_rule  as enum ('immediate', 'on_review', 'manual');
create type attempt_status as enum ('in_progress', 'submitted', 'reviewed');
create type scorer_kind    as enum ('server', 'client', 'manual');

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- slug forms the synthetic email domain: <username>@<slug>.portal.invalid
  slug        text not null unique
              check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
  created_at  timestamptz not null default now()
);

create table profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  school_id            uuid not null references schools(id) on delete restrict,
  role                 user_role not null default 'student',
  username             text not null check (username ~ '^[a-z0-9._-]{3,40}$'),
  display_name         text not null,
  must_change_password boolean not null default true,
  archived             boolean not null default false,
  created_at           timestamptz not null default now(),
  unique (school_id, username)
);
create index on profiles (school_id, role);

-- ---------------------------------------------------------------------------
-- Class groups
-- ---------------------------------------------------------------------------
create table class_groups (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  name        text not null,                  -- '5th Year CS'
  year_label  text,                            -- '2025-2027'
  teacher_id  uuid references profiles(id) on delete set null,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on class_groups (school_id);

create table class_members (
  class_group_id uuid not null references class_groups(id) on delete cascade,
  profile_id     uuid not null references profiles(id) on delete cascade,
  added_at       timestamptz not null default now(),
  primary key (class_group_id, profile_id)
);
create index on class_members (profile_id);

-- ---------------------------------------------------------------------------
-- Runner registry — this is what makes activities pluggable post-build.
-- Registering a row here + hosting the HTML is all a new activity type needs.
-- ---------------------------------------------------------------------------
create table runners (
  id            text primary key
                check (id ~ '^[a-z0-9-]{2,40}$'),   -- 'mcq', 'numbase', 'parsons'
  name          text not null,
  version       text not null default '1.0.0',
  entry_url     text not null,                       -- /runners/mcq/index.html
  scorer        scorer_kind not null default 'server',
  config_schema jsonb,                               -- optional JSON Schema, for the authoring UI
  builtin       boolean not null default false,
  -- null school_id = available to every school (the built-ins)
  school_id     uuid references schools(id) on delete cascade,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Activities. steps[] is the PRIMM mechanism: an ordered list of runner
-- instances over shared context. A plain quiz is a one-step activity.
--   [{ "id":"predict", "runner_id":"freetext", "title":"Predict",
--      "weight":1, "config": { ... } }, ...]
-- config here is PUBLIC — it is sent to the browser. Keys go in activity_keys.
-- ---------------------------------------------------------------------------
create table activities (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  owner_id    uuid not null references profiles(id) on delete restrict,
  title       text not null,
  topic       text,                            -- 'Number Systems', 'Logic', ...
  description text,
  steps       jsonb not null default '[]'::jsonb
              check (jsonb_typeof(steps) = 'array'),
  shared_context jsonb not null default '{}'::jsonb,  -- e.g. the code snippet a PRIMM sequence is about
  max_score   numeric(8,2),
  visibility  activity_vis not null default 'private',
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on activities (school_id, topic);

-- Answer keys. RLS is ENABLED and there are deliberately NO POLICIES, so no
-- anon/authenticated request can read this table by any route. Only the
-- service role (used by the scorer Edge Function) bypasses RLS.
create table activity_keys (
  activity_id uuid primary key references activities(id) on delete cascade,
  -- { "<step_id>": { ...whatever that runner's scorer needs... } }
  keys        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Assignments — target exactly one of: a class group, or an individual.
-- ---------------------------------------------------------------------------
create table assignments (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references schools(id) on delete cascade,
  activity_id      uuid not null references activities(id) on delete restrict,
  class_group_id   uuid references class_groups(id) on delete cascade,
  profile_id       uuid references profiles(id) on delete cascade,
  assigned_by      uuid not null references profiles(id) on delete restrict,
  mode             assignment_mode not null default 'graded',
  open_at          timestamptz not null default now(),
  due_at           timestamptz,
  attempts_allowed int check (attempts_allowed is null or attempts_allowed > 0), -- null = unlimited
  time_limit_secs  int check (time_limit_secs is null or time_limit_secs > 0),
  release_feedback feedback_rule not null default 'on_review',
  created_at       timestamptz not null default now(),
  constraint one_target check (num_nonnulls(class_group_id, profile_id) = 1)
);
create index on assignments (school_id, activity_id);
create index on assignments (class_group_id);
create index on assignments (profile_id);

-- ---------------------------------------------------------------------------
-- Attempts
-- ---------------------------------------------------------------------------
create table attempts (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references schools(id) on delete cascade,
  assignment_id  uuid not null references assignments(id) on delete cascade,
  profile_id     uuid not null references profiles(id) on delete cascade,
  attempt_no     int not null default 1,
  status         attempt_status not null default 'in_progress',
  seed           int not null default (random() * 2147483000)::int, -- for generated question sets
  step_state     jsonb not null default '{}'::jsonb,  -- autosave: step_id -> opaque runner state
  step_responses jsonb not null default '{}'::jsonb,  -- step_id -> submitted response
  step_scores    jsonb not null default '{}'::jsonb,  -- step_id -> { score, max, detail } (server-written)
  auto_score     numeric(8,2),
  max_score      numeric(8,2),
  started_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  unique (assignment_id, profile_id, attempt_no)
);
create index on attempts (profile_id, status);
create index on attempts (assignment_id);

-- ---------------------------------------------------------------------------
-- Teacher review. Separate from the attempt so auto-marking and human marking
-- never overwrite each other, and so feedback can be withheld until released.
-- ---------------------------------------------------------------------------
create table reviews (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references schools(id) on delete cascade,
  attempt_id   uuid not null references attempts(id) on delete cascade,
  reviewer_id  uuid not null references profiles(id) on delete restrict,
  score        numeric(8,2),
  feedback     text,
  rubric       jsonb,                          -- step_id -> { score, comment }
  released_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (attempt_id)
);
create index on reviews (attempt_id);

-- ---------------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER so they bypass RLS on profiles and do
-- not recurse when called from a policy ON profiles.
-- ---------------------------------------------------------------------------
create or replace function current_school_id() returns uuid
  language sql stable security definer set search_path = '' as $$
  select school_id from public.profiles where id = auth.uid()
$$;

create or replace function is_staff() returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('teacher', 'admin') and not archived
  )
$$;

-- Is the current user a target of this assignment (individually or via class)?
create or replace function can_see_assignment(a_id uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assignments a
    where a.id = a_id
      and a.open_at <= now()
      and (
        a.profile_id = auth.uid()
        or exists (
          select 1 from public.class_members cm
          where cm.class_group_id = a.class_group_id
            and cm.profile_id = auth.uid()
        )
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table schools       enable row level security;
alter table profiles      enable row level security;
alter table class_groups  enable row level security;
alter table class_members enable row level security;
alter table runners       enable row level security;
alter table activities    enable row level security;
alter table activity_keys enable row level security;   -- no policies, by design
alter table assignments   enable row level security;
alter table attempts      enable row level security;
alter table reviews       enable row level security;

-- schools
create policy school_read on schools for select
  using (id = current_school_id());

-- profiles: see yourself; staff see everyone in their school
create policy profile_self_read on profiles for select
  using (id = auth.uid() or (is_staff() and school_id = current_school_id()));
create policy profile_self_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from profiles p where p.id = auth.uid()));
create policy profile_staff_write on profiles for all
  using (is_staff() and school_id = current_school_id())
  with check (is_staff() and school_id = current_school_id());

-- class groups: everyone in the school can read; staff write
create policy class_read on class_groups for select
  using (school_id = current_school_id());
create policy class_staff_write on class_groups for all
  using (is_staff() and school_id = current_school_id())
  with check (is_staff() and school_id = current_school_id());

create policy member_read on class_members for select
  using (
    profile_id = auth.uid()
    or exists (select 1 from class_groups g
               where g.id = class_group_id and is_staff() and g.school_id = current_school_id())
  );
create policy member_staff_write on class_members for all
  using (exists (select 1 from class_groups g
                 where g.id = class_group_id and is_staff() and g.school_id = current_school_id()))
  with check (exists (select 1 from class_groups g
                      where g.id = class_group_id and is_staff() and g.school_id = current_school_id()));

-- runners: readable by everyone in scope (needed to build the iframe URL)
create policy runner_read on runners for select
  using (school_id is null or school_id = current_school_id());
create policy runner_staff_write on runners for all
  using (is_staff() and school_id = current_school_id())
  with check (is_staff() and school_id = current_school_id());

-- activities: staff see the school's bank; students only see activities
-- reachable through an assignment aimed at them.
create policy activity_staff_read on activities for select
  using (is_staff() and school_id = current_school_id());
create policy activity_student_read on activities for select
  using (exists (select 1 from assignments a
                 where a.activity_id = activities.id and can_see_assignment(a.id)));
create policy activity_staff_write on activities for all
  using (is_staff() and school_id = current_school_id())
  with check (is_staff() and school_id = current_school_id());

-- assignments
create policy assignment_staff_all on assignments for all
  using (is_staff() and school_id = current_school_id())
  with check (is_staff() and school_id = current_school_id());
create policy assignment_student_read on assignments for select
  using (can_see_assignment(id));

-- attempts: a student reads and writes their own, and may only mutate one
-- that is still in progress. Staff read everything in the school.
create policy attempt_own_read on attempts for select
  using (profile_id = auth.uid());
create policy attempt_own_insert on attempts for insert
  with check (profile_id = auth.uid() and can_see_assignment(assignment_id));
create policy attempt_own_update on attempts for update
  using (profile_id = auth.uid() and status = 'in_progress')
  with check (profile_id = auth.uid());
create policy attempt_staff_read on attempts for select
  using (is_staff() and school_id = current_school_id());
create policy attempt_staff_update on attempts for update
  using (is_staff() and school_id = current_school_id())
  with check (is_staff() and school_id = current_school_id());

-- reviews: staff write; students read only once released
create policy review_staff_all on reviews for all
  using (is_staff() and school_id = current_school_id())
  with check (is_staff() and school_id = current_school_id());
create policy review_student_read on reviews for select
  using (
    released_at is not null
    and exists (select 1 from attempts t where t.id = attempt_id and t.profile_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- Students must never write their own score. Strip score columns from any
-- non-service-role update to attempts.
create or replace function protect_attempt_scores() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('request.jwt.claims', true) is not null
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role'
     and not public.is_staff()
  then
    new.auto_score  := old.auto_score;
    new.max_score   := old.max_score;
    new.step_scores := old.step_scores;
  end if;
  return new;
end;
$$;

create trigger attempts_protect_scores
  before update on attempts
  for each row execute function protect_attempt_scores();

-- Enforce attempts_allowed.
create or replace function enforce_attempt_limit() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  allowed int;
  used    int;
begin
  select attempts_allowed into allowed from public.assignments where id = new.assignment_id;
  if allowed is null then return new; end if;
  select count(*) into used from public.attempts
    where assignment_id = new.assignment_id and profile_id = new.profile_id;
  if used >= allowed then
    raise exception 'attempt limit of % reached for this assignment', allowed
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger attempts_limit
  before insert on attempts
  for each row execute function enforce_attempt_limit();

-- updated_at
create or replace function touch_updated_at() returns trigger
  language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

create trigger activities_touch    before update on activities
  for each row execute function touch_updated_at();
create trigger activity_keys_touch before update on activity_keys
  for each row execute function touch_updated_at();
create trigger reviews_touch       before update on reviews
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Built-in runners
-- ---------------------------------------------------------------------------
insert into runners (id, name, version, entry_url, scorer, builtin) values
  ('mcq',     'Multiple Choice',        '1.0.0', '/runners/mcq/index.html',     'server', true),
  ('numbase', 'Number Base Conversion', '1.0.0', '/runners/numbase/index.html', 'server', true),
  ('parsons', 'Parsons Problem',         '1.0.0', '/runners/parsons/index.html', 'server', true);
