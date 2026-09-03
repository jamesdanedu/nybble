-- ============================================================================
-- The Department of Education's list of post-primary schools, as a reference
-- table.
--
-- WHAT THIS IS NOT: a list of tenants. `schools` holds the schools actually
-- using Nybble — a handful, each with members, RLS scoped to them, and a slug
-- that forms their sign-in domain. `school_directory` holds every post-primary
-- school in the country, about 730 of them, none of which are tenants. Seeding
-- them INTO `schools` was the tempting shortcut and it is wrong twice over:
-- the sign-in picker would list 730 schools that cannot be signed in to, and
-- every one of them would need a slug — a permanent, unique, user-visible
-- identifier — minted for a school that never asked for one.
--
-- So the two tables meet at exactly one place: `schools.roll_number`, below.
--
-- WHY ROLL NUMBER IS THE KEY. School names are not unique and not stable.
-- "St Mary's Secondary School" is a dozen different schools; names also change
-- on amalgamation. The roll number is the Department's own identifier, unique
-- and stable across renames, so it is the primary key here and the join to
-- `schools`. Town and county exist to tell same-named schools apart on screen,
-- not to identify them — see lib/school-directory.ts, which qualifies a name
-- only as far as it has to.
--
-- The check on roll_number is deliberately loose. Post-primary roll numbers are
-- five digits and a letter (62630B), but this table is populated from a file
-- published by somebody else, and a strict pattern turns one unexpected row
-- into a failed import of all 730. The importer validates the shape and reports
-- what it rejects; the database only stops something obviously not an
-- identifier. Rejecting loudly in the tool beats rejecting silently in a
-- constraint.
-- ============================================================================

create table school_directory (
  roll_number  text primary key check (roll_number ~ '^[A-Z0-9]{4,12}$'),
  name         text not null check (length(name) between 2 and 200),
  -- The disambiguators. Nullable because the source file is not guaranteed to
  -- fill every cell, and a school with no town is still a real school.
  town         text,
  county       text,
  address      text,
  -- Provenance, so a stale directory can be recognised as stale rather than
  -- argued with. Both come from the importer, not from a default.
  enrolment    integer check (enrolment is null or enrolment >= 0),
  source_year  text,
  updated_at   timestamptz not null default now()
);

-- Search is "type part of a name, maybe part of a town". Both columns get an
-- index on their lower-cased form because that is what the query filters on.
create index school_directory_name_lower on school_directory (lower(name));
create index school_directory_town_lower on school_directory (lower(town));

-- ---------------------------------------------------------------------------
-- The join to the tenant table
-- ---------------------------------------------------------------------------
-- Nullable: every school row that exists today predates this and has no roll
-- number, and nothing may break because of that. Unique: two tenants claiming
-- the same official school is a mistake worth refusing at write time.
--
-- `on delete restrict` on the reference, so re-importing the directory can
-- never quietly cut a tenant loose from its official record. A directory row
-- that a tenant points at is not deletable, which is the correct answer — if
-- the Department really did retire that roll number, that is a decision for a
-- person, not for an importer.
alter table schools
  add column roll_number text unique references school_directory(roll_number)
    on delete restrict on update cascade;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
-- Published public information, so nothing here is secret. It is still not
-- readable by everyone, for the same reason 0004 gave about `schools`: "not
-- secret" is not a reason to publish a table. The only consumer is the admin
-- School page, where an admin links their school to its official record, so
-- admins are who can read it. Widen this when there is a screen that needs it —
-- a self-service "register your school" flow would need anonymous read, and
-- that flow does not exist yet.
alter table school_directory enable row level security;

create policy school_directory_read on school_directory for select
  using (is_admin());

grant select on school_directory to authenticated;

-- No insert/update/delete policy and no write grant, deliberately. The table is
-- written by scripts/import-schools.mjs holding the service role key, which
-- bypasses both. Nobody signed in should be able to edit the Department's list.
