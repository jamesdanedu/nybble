# Selling Nybble to schools

The plan for offering Nybble to any post-primary school in the country for a
small annual fee, and keeping track of who has been asked, who is trying it,
who is paying, and who is due to renew.

**Status.** Phase 1 (section 4) is built: `0011_customers.sql`, the widened
importer, `requireOperatorSession()`, and `lib/licensing.mjs` with its test.
Phases 2 to 4 are still a plan. Section 2 lists the decisions a person has to
make; the schema below assumes the recommendations and none of them is hard to
change while there is no data in the tables.

To become the operator on a deployment, once 0011 has run:

```sql
insert into operators (user_id) values ('<your auth.users id>');
```

There is deliberately no screen for this.

## 1. Where things stand

The school list work in `docs/schools.md` was done for one reason — to tie a
tenant to a real school by roll number — and it does that. It is also, as it
happens, most of a customer list. Here is what exists and what does not.

| Exists | |
|---|---|
| `school_directory` | every post-primary school in the country, 721 rows, keyed by roll number. Was admin-only; since 0011 the table is operator-only and admins read a six-column view. |
| `schools` | the tenants. A handful. Each has a slug, and now a nullable `roll_number` into the directory. |
| `scripts/import-schools.mjs` | re-runnable, refuses a file whose shape has changed. Read 6 of the workbook's 28 columns before 0011; reads all of them and the second sheet now. |
| Teacher → School | an admin links their school to its official record. |
| Roles | `student`, `teacher`, `admin` — all three live *inside* one school. |

| Does not exist | |
|---|---|
| Any notion of a customer, a subscription, a price, an invoice, or a renewal date. | Nothing in the schema, nothing in the app. |
| A cross-school role. | Every policy is `school_id = current_school_id()`. Nobody signed in can see two schools. The service role can, and nothing puts a screen in front of it. |
| A way to create a school. | The README's "First school and teacher" is two `insert` statements in the SQL editor. `0004` says why: a new school has no members, so whoever creates it cannot then see it, and that "needs a 'new school plus its first admin' flow, which is a bigger design question than a CRUD screen". This document is that design question. |
| Any way to stop a school using the portal. | Once a tenant exists it exists for ever. |
| Email. | No transactional email provider is configured anywhere. |

### What the Department's workbook actually holds

The importer reads `Roll Number`, `Official School Name`, the four address
lines, `County`, `Local Authority`, and the total. The 2025/2026 file
(`Data on Individual Schools post primary to publish 010726.xlsx`, checked
against `--dry-run` while writing this: 721 schools, one rejected totals row)
also has, on the same *School Lists* sheet:

| Column | Filled | Why it matters for selling |
|---|---|---|
| `Principal Name`, `Email`, `Phone` | 721 / 720 / 720 | the school's front door. The email is the office address (`office@…`), not the principal's own. |
| `Post Primary School Type` | Secondary 378, Vocational 246, Community 83, Comprehensive 14 | ETB (vocational and community) schools buy through the ETB, not the school. Different sale. |
| `DEIS (Y/N)` | 232 yes | DEIS schools have separate grant lines; worth knowing before quoting. |
| `Fee Paying School (Y/N)` | 50 yes | |
| `Irish Classification` | 50 all-Irish, 23 partly | a Gaelcholáiste needs the runners in Irish before it is a real prospect. |
| `School Gender`, `Ethos/Religion` | | segmentation only |
| `Eircode`, `Latitude`, `Longitude` | | "schools within 40 km of here" for a visit list |

A third sheet, *Programme & Year*, gives per-school numbers for JC1–3, TY, LC1
and LC2. LC1 + LC2 is the size of the addressable class in every school in the
country. Its header row is the **second** row (the first is a merged group
header), which the parser now allows for.

**Personal data.** Principal names are personal data even though the
Department publishes them. The office email and phone are business contact
details. Both are usable for business-to-business contact under legitimate
interest, and neither may be shown to a school admin linking their record —
they are for the operator only, and there must be a do-not-contact flag that
is honoured everywhere the list is read.

## 2. Decisions before code

None of these can be made in the repo. Each has a recommendation so that
building can start the moment they are confirmed.

1. **Unit of sale: one school, one academic year, flat fee.** Not per student.
   Schools cannot forecast seats, per-seat needs counting and auditing, and a
   small flat fee is the kind of thing a principal approves without a board
   meeting. The year is 1 September to 31 August, whatever date they sign up.
   A school joining in March pays for the year ending that August, at the same
   price or pro rata — pick one and put it in the terms.

2. **Payment is by invoice, not by card.** Irish schools raise a purchase
   order and pay by EFT. A Stripe checkout page is the wrong front door for a
   school secretary. So the first version of billing is: the operator records
   a subscription, issues an invoice, and marks it paid when the money lands.
   Stripe Invoicing (which supports bank transfer) is a later option, not the
   foundation. Whether VAT applies to a supply of software to a school is an
   accountant's question; the schema below stores amounts as issued and does
   not compute tax.

3. **Trial: free until a date, then an invoice.** A trial is just a
   subscription row with `status = 'trial'` and an end date. Nothing else
   about the school is different during a trial.

4. **Lapsing is read-only, never lock-out.** A school whose subscription has
   ended keeps signing in and keeps seeing every result. Students cannot start
   new attempts and teachers cannot make new assignments. And that only starts
   after a grace period — 60 days, so nothing breaks on 1 September because a
   PO is sitting on someone's desk.

5. **The tenant is created by the operator, not by the school.** Sales are
   hand-to-hand for the foreseeable future, so the "register your school"
   self-service flow that `0009` mentions stays unbuilt. The operator creates
   the tenant from the directory entry and hands over one admin login.

6. **Paperwork.** Charging a school makes Nybble a data processor for student
   data under Article 28. A school's board will ask for: terms of service, a
   data processing agreement, a privacy notice that can be shown to parents,
   where the data lives (check the Supabase project's region — it should be in
   the EU), and what happens to the data when they stop paying (recommend:
   read-only for the grace period, deleted twelve months after lapse, with a
   warning email before). None of that is code, and all of it is needed before
   the first invoice.

## 3. The data model

One migration, `0011_customers.sql`. Four additions, in dependency order.

### 3.1 Widen `school_directory`

Add the columns above: `eircode`, `latitude`, `longitude`, `principal`,
`email`, `phone`, `ethos`, `school_type`, `gender`, `irish_medium`, `deis`,
`fee_paying`, and `ty`, `lc1`, `lc2` from the *Programme & Year* sheet. All
nullable — the file is somebody else's and not every cell is filled.

The importer grows to match: read the extra headers by name as it does now,
read the second sheet and join it on roll number, and reject a *Programme &
Year* sheet that does not join to the school list (a different year's file for
each sheet would do that).

Reading the directory stays admin-only for the columns the School page needs.
The contact columns are the operator's: the cleanest way is a view,
`school_directory_public`, with the six existing columns, which the admin
policy moves to, so that the base table's policy can become `is_operator()`
and no admin screen can ever read a principal's name by accident.

### 3.2 `operators` — the cross-school role

```sql
create table operators (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create or replace function is_operator() returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.operators where user_id = auth.uid())
$$;
```

Not a fourth value of `user_role`. A profile belongs to a school and the
operator belongs to none — or, in practice, the operator is also the admin of
a house tenant used for demos, and that is fine: `operators` is a separate
fact about a user, not a role within a school. There is no insert policy; a
row is added in the SQL editor, once, deliberately.

Operator read access is added to `schools`, `subscriptions`, `prospects`,
`touches`, and the widened `school_directory` as `or is_operator()`. It is
**not** added to `attempts`, `activities`, or `reviews`. The vendor has no
business reading a student's work, and a policy that lets them would be the
first thing a school's data-protection officer asks about. Usage numbers come
through one `security definer` function that returns counts and nothing else:

```sql
create or replace function school_usage(s uuid)
  returns table (students int, staff int, active_30d int, attempts_30d int, last_seen timestamptz)
  language sql stable security definer set search_path = '' as $$ ... $$;
-- revoke from public; grant execute to authenticated; the body checks is_operator().
```

### 3.3 `prospects` and `touches` — the pipeline

The universe of prospects *is* the directory, so the pipeline is keyed by roll
number and a school needs no row here until somebody does something.

```sql
create type prospect_stage as enum ('contacted', 'demo', 'declined', 'not_now');

create table prospects (
  roll_number     text primary key references school_directory(roll_number) on update cascade,
  stage           prospect_stage not null,
  -- The person to talk to is the CS teacher, who is not in the Department's file.
  contact_name    text,
  contact_email   text,
  contact_role    text,
  do_not_contact  boolean not null default false,
  next_action_at  date,
  notes           text,
  updated_at      timestamptz not null default now()
);

create table touches (
  id           bigint generated always as identity primary key,
  roll_number  text not null references school_directory(roll_number) on update cascade,
  at           timestamptz not null default now(),
  channel      text not null check (channel in ('email', 'phone', 'visit', 'event', 'other')),
  note         text not null,
  by           uuid not null references auth.users(id)
);
```

`stage` covers the part of the funnel *before* a tenant exists. Once a tenant
exists the truth is in `subscriptions`, and the operator console derives
"customer", "trial" and "lapsed" from there rather than duplicating them here.
Two sources of the same fact drift; this keeps one.

### 3.4 `subscriptions` — what a school is entitled to

```sql
create type subscription_status as enum ('trial', 'active', 'complimentary', 'cancelled');

create table subscriptions (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references schools(id) on delete cascade,
  status        subscription_status not null,
  period_start  date not null,
  period_end    date,                         -- null only for 'complimentary'
  amount_cents  integer check (amount_cents is null or amount_cents >= 0),
  currency      text not null default 'EUR',
  invoice_no    text unique,
  invoiced_on   date,
  paid_on       date,
  notes         text,
  created_at    timestamptz not null default now(),
  check (status <> 'complimentary' or period_end is null),
  check (status  = 'complimentary' or period_end is not null),
  check (period_end is null or period_end > period_start)
);
create index on subscriptions (school_id, period_end);
```

One row per school per year. Renewal is a new row, not an edit, so the history
is the table. "Lapsed" is not a status: it is a school whose latest
`period_end` plus grace is in the past, computed, so it can never be stale.

```sql
create or replace function school_licensed(s uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions
    where school_id = s
      and status <> 'cancelled'
      and period_start <= current_date
      and (period_end is null or period_end + interval '60 days' >= current_date)
  )
$$;
```

The migration backfills one `complimentary` row for every school that exists
on the day it runs. Every current tenant therefore keeps working unchanged,
and the choice to start charging them is a row the operator writes, not a side
effect of deploying.

### 3.5 Enforcement

Two policies gain a clause. Nothing else changes.

```sql
-- was: with check (profile_id = auth.uid() and can_see_assignment(assignment_id))
alter policy attempt_own_insert on attempts
  with check (profile_id = auth.uid() and can_see_assignment(assignment_id)
              and school_licensed(school_id));

-- assignments: split the staff `for all` into read/update/delete unchanged and
-- an insert that also requires school_licensed(school_id).
```

Reads, reviews, results, sign-in, password changes: untouched. The portal
layout reads the school's latest subscription and shows one banner: from 30
days before `period_end` ("Nybble's subscription for this school ends on …"),
and after the grace period ("read-only until renewed"). The banner names the
admin, because the teacher seeing it usually is not the person who pays.

## 4. What gets built, in order

### Phase 1 — schema, importer, operator gate (done)

- `0011_customers.sql` as above, plus `lib/types.ts` to match. Applied and
  exercised against a scratch Postgres while being written: an admin reads the
  view and not the table, a student's insert is refused one day past the grace
  period and allowed the day before, a teacher can still edit and delete
  assignments after a lapse, the operator reads every school and no attempt,
  and `school_usage()` refuses a non-operator.
- The importer reads the contact and classification columns and joins the
  *Programme & Year* sheet on roll number. Against the 2025/2026 file: 721
  schools, 720 with an email, 721 matched to their year-group row.
  `test/schools-ie.test.mjs` builds a three-sheet workbook with the offset
  header row.
- `requireOperatorSession()` and `isOperator()` in `lib/session.ts`, next to
  `requireAdminSession()`. Nothing uses them yet; phase 2 does.
- `lib/licensing.mjs` and `test/licensing.test.mjs`: the pure date logic —
  trial, grace, lapse, renewal overlap, complimentary — with no database. The
  last check reads the migration and fails if the grace period there ever
  differs from `GRACE_DAYS`.

### Phase 2 — the operator console, read-only

`app/(operator)/operator/…`, gated by `requireOperator()`, reading with the
signed-in user's client so RLS decides. Three pages:

- **`/operator`** — what needs doing: trials ending in 30 days, subscriptions
  ending in 60, invoices issued and unpaid past 30 days, prospects whose
  `next_action_at` has arrived. Totals: schools, paying schools, revenue this
  year.
- **`/operator/schools`** — all 721, with a status column (customer, trial,
  lapsed, prospect stage, untouched), filterable by county, type, DEIS,
  Irish-medium, status. CSV export of the current filter for a mail merge.
- **`/operator/schools/[roll]`** — the directory record, contact, touches,
  tenant if any, subscription history, usage from `school_usage()`.

Rough size: three to four days.

### Phase 3 — actions: pipeline, tenant creation, subscriptions

Server actions on the school page:

- Add a touch; set the stage; set the contact; set do-not-contact.
- **Create tenant.** The flow `0004` deferred. From the directory entry:
  insert into `schools` (name from the directory, `roll_number` linked, slug
  suggested from the name and editable, because it is permanent); insert a
  `trial` subscription; create the first admin as `auth.users` +
  `profiles` with `must_change_password`, and render the credentials once as
  a slip, exactly as `app/api/admin/students` does for students. This is a
  service-role operation — the fourth `lib/supabase/service.ts` warns against
  adding without a very good reason — behind `requireOperator()` verified with
  the caller's own session, the same shape as `requireStaff()`.
- Add a subscription; record invoice number and dates; mark paid.

And one change outside the console: **the login picker does not scale**. It
lists every tenant, which is right at three and wrong at thirty. Each school
gets its own address, `/login?school=<slug>`, in the onboarding email, and the
picker is replaced by a "which school?" text box past a handful of tenants.

Rough size: three to four days.

### Phase 4 — renewals

- A daily job. `pg_cron` in Supabase is simplest: nothing to deploy on Vercel
  and no secret route to protect. It has nothing to *do* to the database —
  lapsing is computed — so its only job is to queue reminders.
- A transactional email provider (Resend or Postmark; pick one, one env var).
  Reminders to the school's admin at 60 and 30 days before `period_end`, one
  at lapse, and a copy of each to the operator. Every send is a `touches` row
  with `channel = 'email'`, so the school's page shows it.
- Until the provider is configured, the `/operator` page lists the reminders
  due and the operator sends them by hand. That is the phase-2 behaviour and
  it should keep working; automation replaces the sending, not the list.

Rough size: two to three days.

### Later, if wanted

- Stripe Invoicing, with a webhook that sets `paid_on`. Fits the schema as-is.
- Self-service "register your school": needs anonymous read of the public
  directory view and an approval queue on the `/operator` page.
- Per-size pricing using LC1 + LC2 from the directory. The column will be
  there; the decision in section 2 says flat for now.

## 5. Things this plan deliberately does not do

- **Seed tenants from the directory.** `docs/schools.md` says why. A prospect
  is a directory row and maybe a `prospects` row; it becomes a tenant only
  when the operator creates one.
- **Put subscription state on `schools`.** A `licensed_until` column would be
  a cache of `subscriptions` and would be wrong the day someone forgets to
  update both. `school_licensed()` is one query and is called on inserts only.
- **Give the operator the service role by default.** The console reads through
  RLS with `is_operator()` policies and reaches for the service role in
  exactly one action: creating a tenant and its first login.
- **Block sign-in for a lapsed school.** A school's results are theirs. The
  worst outcome of a missed renewal is a student who cannot start a quiz and a
  banner saying who to ask.
