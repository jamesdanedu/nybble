# The school directory

Every post-primary school in the country, as a reference table, so that a school
using Nybble can be tied to its real identity rather than to whatever somebody
typed into a name field at setup.

Source: **gov.ie → Department of Education → [Post-primary schools enrolment
figures](https://www.gov.ie/en/department-of-education/collections/post-primary-schools-enrolment-figures/)**.
Download the workbook for the academic year you want. The 2025/2026 file is 722
data rows on a sheet called *School Lists*, 28 columns wide, plus a *Programme &
Year* sheet with the same schools broken down by year group. All of it is read.

## Two tables, one join

| | |
|---|---|
| `schools` | the tenants — a handful, each with members, RLS scoped to them, and a slug that forms their sign-in domain |
| `school_directory` | every post-primary school in the country, 721 of them, none of them tenants |

They meet at exactly one column: `schools.roll_number`, a nullable unique
reference into the directory.

Seeding the 721 into `schools` was the tempting shortcut and it is wrong twice
over. The sign-in picker would list 721 schools that cannot be signed in to, and
every one of them would need a slug — a permanent, unique, user-visible
identifier — minted for a school that never asked for one.

**The roll number is the key, not the name.** School names are neither unique
nor stable: "Presentation Secondary School" is eleven different schools, and a
name changes on amalgamation. The roll number is the Department's own
identifier, unique and stable across renames.

## Importing

```bash
node scripts/import-schools.mjs --dry-run postprimaryschools.xlsx   # parse and report
node scripts/import-schools.mjs postprimaryschools.xlsx             # and write
```

The workbook is **not committed to this repo**: it is somebody else's data, it
is republished every year, and a 250 KB binary in git that nothing at runtime
reads is a liability rather than an asset. The parser is the part worth keeping.

`--dry-run` needs no dependencies at all — the database client is imported
lazily — so you can check that this year's file still parses in a fresh clone
before `npm i`.

Writing needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, in the
environment or `.env.local`. `school_directory` has no write policy, so nothing
else can write it.

The importer is re-runnable: rows are upserted on roll number, so next year's
file updates names, towns and enrolments in place and leaves every
`schools.roll_number` link pointing at the same row.

It refuses rather than half-importing. If more than 5% of rows are rejected,
that is a change in the file's shape and not a few bad rows, and a directory
silently missing a third of the country is worse than no directory.

### What it reads, and what it works out

Read directly: `Roll Number`, `Official School Name`, `Total <year>`, and —
since `0011_customers.sql` — the contact and classification columns:
`Principal Name`, `Email`, `Phone`, `Eircode`, `School Latitude`/`Longitude`,
`Ethos/Religion`, `Post Primary School Type`, `Irish Classification`, `School
Gender`, `DEIS (Y/N)` and `Fee Paying School (Y/N)`. A Y/N cell becomes a
boolean; a blank one becomes null, because "the Department left it blank" and
"the Department said no" are different facts. An email is lower-cased and kept
only if it has the shape of one.

From the *Programme & Year* sheet, joined on roll number: `TY`, `LC 1` and
`LC 2`. That sheet's header is on its second row, under a merged group header;
the parser finds the header by looking for the roll column rather than assuming
row one. The importer refuses a programme sheet that matches fewer than 90% of
the schools on the list — that is two sheets from different years, not a few
closed schools.

Worked out, because the file does not have the columns you would want:

- **Town.** There is no town column — there are four free-text address lines.
  Irish addresses run narrow to broad, so the town is the last line that is not
  the county, after dropping numeric county codes, Eircodes filed as an address
  line, "Ireland", and a first line that merely repeats the school's own name
  ("Blackrock College, Rock Road, Co. Dublin"). Every one of the 721 gets a town.
- **County.** There *is* a County column and it is filled for 76 of 722 rows, so
  it cannot be the primary source. `Local Authority` is filled for all but one
  and is clean controlled text, so the county is that with the council suffix
  stripped. The `(NR)` / `(SR)` ridings of Tipperary go too — an administrative
  distinction that means nothing to a teacher picking their school.

The 2025/2026 file yields 721 schools and one rejected row: the workbook's
totals line, which has a row count where the roll number goes and no name.

## Telling same-named schools apart

44 names in the 2025/2026 file are shared by more than one school, covering 138
of the 721. `lib/schools-ie/qualify.mjs` qualifies a label only as far as it has
to, in three tiers:

| | |
|---|---|
| `Blackrock College` | the name is unique — say nothing more |
| `Loreto Secondary School, Balbriggan` | the name repeats; add the town (or the county, where there is no town) |
| `Presentation Secondary School, Thurles (65240L)` | even that repeats; add the roll number |

Escalation is **per name, not across the board**. Qualifying everything would
put a town beside 567 names that never needed one — noise on 79% of the list to
fix 21% of it. And escalating only the rows still colliding means two of the
eleven Presentation Secondary Schools needing a roll number does not put a roll
number on the other nine.

Tier 3 is the guarantee, not the common case: against this file it is reached
exactly twice, by the two Presentation Secondary Schools whose addresses are
both in Thurles (65240L is in Ballingarry, but Thurles is its postal town). It
exists because "the current file does not need it" is not a property to build
on.

Ambiguity is decided **across the rows on screen**, which is deliberate: whether
"Loreto Secondary School" needs a town depends on what else is in the result
set. A search for *Loreto* shows eight and every one carries its town; a search
for *Balbriggan* shows one and it does not need to.

Names are compared with punctuation, case and spacing ignored, and with
`Saint` folded to `St`. Apostrophes are deleted rather than turned into a space
— both `St Mary's Secondary School` and `St Marys Secondary School` are in the
Department's own file, and splitting on the apostrophe gives `st mary s` against
`st marys`, which never collide. That one character is the difference between
nine identically-labelled schools and nine distinguishable ones.

## Using it

An admin links their school at **Teacher → School → Official record**: search by
name or town, pick the right one, and the roll number is written to
`schools.roll_number`. Linking also offers to adopt the Department's spelling of
the name, as a checkbox rather than a consequence — a school that calls itself
"St Mary's" on screen should not be silently renamed to "St Marys Secondary
School".

The admin School page reads `school_directory_public`, a view of the six
columns it needs, gated on `is_admin()` inside the view. The table itself is
operator-only since `0011`: it now carries the principal's name and the
school's contact details, which are for selling to the school, not for an admin
to see while linking it. Principal names are personal data even though the
Department publishes them. See `docs/customers.md`.

Widen the view's gate when a screen needs it — a self-service "register your
school" flow would need anonymous read, and that flow does not exist.

## Reading the .xlsx

`lib/schools-ie/xlsx.mjs` reads the workbook with no dependency: an .xlsx is a
zip of XML, and the parts needed here are a shared string table and one sheet of
`<c>` tags. Adding a spreadsheet library to a Next.js portal to read one file
once a year is a poor trade.

It does not do formulas, dates, styles, number formats, merged cells, ZIP64 or
encrypted workbooks. Every cell comes back as a trimmed string, because every
column wanted here is text or a plain integer. If a future file needs any of
that, reach for a library rather than growing this.

Sheets come back **named**, and the caller picks by name. Reading "the first
sheet" is not good enough and the real file proves it: the workbook opens on an
*Explanatory Note* tab and keeps the data on *School Lists*, which is
`sheet2.xml`.

## Tests

```bash
node test/schools-ie.test.mjs      # 24 checks, no browser, no database, no network
```

No committed spreadsheet either: the reader is exercised against a deflated
workbook the test builds byte by byte. Every awkward case in it is a row that is
actually in the 2025/2026 file — the totals row, the numeric county codes, the
address line that repeats the school name, the two Thurles schools, and the
seven-letter town names an over-eager Eircode pattern ate.
