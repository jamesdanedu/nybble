# Student Activity Portal — foundation

The engine, not the app. Everything here is the part that is expensive to change
later: the schema, the tenancy boundary, and the contract that lets new activity
types be added without touching the portal.

```
supabase/
  migrations/0001_init.sql        schema + RLS + guard triggers
  functions/score/
    index.ts                      the only code that reads answer keys
    mcq.ts                        MCQ scorer
    numbase.ts                    number base scorer (+ generator copy)
public/
  harness.html                    dev harness — try a runner with no backend
  runners/
    lib/runner-sdk.js             loaded inside a runner
    lib/runner-host.js            portal side of the protocol
    lib/runner.css                shared runner styling, light + dark
    lib/numbase-gen.js            seeded question generator
    mcq/index.html                MCQ runner
    numbase/index.html            binary/hex conversion runner
docs/runner-contract.md           the protocol spec
test/harness.test.mjs             end-to-end checks through a real browser
```

## Try it now

```bash
cd public && python3 -m http.server 8099
# open http://localhost:8099/harness.html
```

The harness mounts a runner in a sandboxed iframe exactly as the portal will,
shows every message crossing the boundary, marks the submission with a local
copy of the server scorer, and re-mounts in review mode. No database needed.

```bash
node test/harness.test.mjs     # 9 checks, drives a real Chromium
```

## The three ideas

**1. Activities are step sequences, not types.** An activity is an ordered list
of steps, each one a runner instance sharing the same `context`. A quiz is a
one-step activity. PRIMM is a five-step activity. Same code path.

**2. A runner is a plain HTML file.** It speaks `postMessage`, holds no key,
knows no student, and reaches no database. Adding one is a row in `runners` plus
a hosted file — no portal redeploy. Your existing tools become runners with
about twenty lines of glue.

**3. Nothing the browser says about marks is believed.** Answer keys live in
`activity_keys`, which has RLS enabled and **no policies** — only the service
role can read it. The scorer Edge Function marks and writes; a trigger strips
`auto_score`, `max_score` and `step_scores` from any student-originated update.
`clientScore` exists only for practice mode.

## Deploying

```bash
supabase link --project-ref <ref>
supabase db push
supabase functions deploy score
supabase secrets set PORTAL_ORIGIN=https://your-portal.vercel.app
```

Serve `public/runners/**` from the portal's own static hosting (Vercel
`/public` works as-is).

### First school and teacher

```sql
insert into schools (name, slug) values ('St Mary''s', 'stmarys');
-- create the auth user via the dashboard or admin API, then:
insert into profiles (id, school_id, role, username, display_name, must_change_password)
values ('<auth-user-uuid>', '<school-uuid>', 'teacher', 'josullivan', 'J. O''Sullivan', false);
```

Student logins are `username` + password, mapped internally to
`<username>@<school-slug>.portal.invalid`. Students never see that address.
Account creation and password resets go through a teacher-only Edge Function
using the service role — that function is not written yet.

## What is deliberately not here yet

- The Next.js portal itself (login, class management, assignment list, review queue)
- The account-admin Edge Function (create students, reset passwords, CSV import)
- `parsons`, `freetext` and `pyodide` runners
- The authoring UI — activities are seeded by SQL for now

## Known sharp edges

- **Generator drift.** `numbase-gen.js` and `numbase.ts` are the same algorithm
  in two languages. The scorer regenerates from the seed and compares against
  the questions the student submitted; a mismatch sets `needsReview` rather than
  mismarking. Change one, change both.
- **`current_school_id()` is one query per policy evaluation.** Fine at class
  scale. If it ever shows up in `pg_stat_statements`, move `school_id` into the
  JWT as a custom claim.
- **Late submissions are flagged, not zeroed.** `step_scores[step].late` is set
  and the teacher decides. That is a policy choice, change it if you disagree.
