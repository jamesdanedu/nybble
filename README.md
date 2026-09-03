# Nybble

An activity portal for Leaving Certificate Computer Science — Parsons problems,
quizzes and number base tests, set to a class or an individual, marked
automatically where it can be and reviewed by a teacher where it can't.

*(A nybble is four bits — half a byte, and exactly one hex digit.)*

This repo is the engine, not the app. Everything here is the part that is
expensive to change later: the schema, the tenancy boundary, and the contract
that lets new activity types be added without touching the portal.

```
app/                              Next.js portal (App Router)
  page.tsx                        landing page — the deployed front door
lib/                              Supabase clients, session, activity importer
components/                       shared UI, incl. the runner iframe wrapper
scripts/import-activities.mjs     CLI importer (same code as the web one)
examples/lccs-week1.json          a real activity file to import
examples/primm-total.json         a four-step PRIMM sequence about one snippet
vercel.json                       headers only — Next owns the build now
supabase/
  config.toml                     keeps verify_jwt on for the scorer
  migrations/0001_init.sql        schema + RLS + guard triggers
  migrations/0002_profile_guard.sql  self-update guard as a trigger, not a subquery
  migrations/0003_grants.sql      table privileges for the authenticated role
  migrations/0004_school_admin.sql   per-school admin
  migrations/0005_service_role_grants.sql  what the service role may reach
  migrations/0006_freetext_runner.sql  registers the freetext runner
  migrations/0007_pyrun_runner.sql     registers the pyrun runner
  functions/score/
    index.ts                      the only code that reads answer keys
    mcq.ts                        MCQ scorer
    numbase.ts                    number base scorer (+ generator copy)
    parsons.ts                    Parsons scorer (order + indentation)
public/
  demo.html                       clean student-facing demo of one activity
  harness.html                    dev harness — same runners, with the message log
  runners/
    lib/runner-sdk.js             loaded inside a runner
    lib/runner-host.js            portal side of the protocol
    lib/runner.css                shared runner styling, light + dark
    lib/numbase-gen.js            seeded question generator
    lib/demo-kit.js               sample activities + client marking (demo pages ONLY)
    mcq/index.html                MCQ runner
    numbase/index.html            binary/hex conversion runner
    parsons/index.html            Parsons problem runner (drag, tap, keyboard)
    freetext/index.html           written answer, hand-marked (PRIMM Predict/Make)
    pyrun/index.html              Python in the browser (PRIMM Run/Modify)
    lib/skulpt/                   vendored Python engine — see its README
docs/runner-contract.md           the protocol spec
docs/activity-format.md           the activity file format you author against
docs/primm.md                     the plan for PRIMM step sequences
test/harness.test.mjs             end-to-end checks through a real browser
test/deploy.test.mjs              checks that survive real static hosting
test/vercel-sim.py                local stand-in for Vercel's static host
```

## Try it now

```bash
python3 test/vercel-sim.py          # serves public/ on :8102 the way Vercel does
# open http://127.0.0.1:8102/
```

`/demo.html?activity=numbase` is what a student would see: the activity, a score,
worked answers, and a "try again with new numbers" button. `/harness.html` is the
same runners with the developer chrome — editable config and every message
crossing the sandbox boundary. Neither needs a database.

Do not use `python3 -m http.server` for this. It redirects `/runners/mcq` to
`/runners/mcq/`, which Vercel does not, and that difference hides a whole class
of path bug — see the note in `test/vercel-sim.py`.

```bash
npm i -D playwright && npx playwright install chromium

python3 test/vercel-sim.py --port 8102 &          # production config
node test/harness.test.mjs                        # 23 runner-contract checks
node test/deploy.test.mjs                         # 7 deployment checks

python3 test/vercel-sim.py --clean --port 8101 &  # if cleanUrls ever comes back
BASE=http://127.0.0.1:8101 node test/deploy.test.mjs
```

(There is a `package.json` now — the portal is a Next.js app, so Vercel installs
and builds on every deploy. That was not true of the earlier static-only repo.)

## The three ideas

**1. Activities are step sequences, not types.** An activity is an ordered list
of steps, each one a runner instance sharing the same `context`. A quiz is a
one-step activity. PRIMM is a five-step activity — `examples/primm-total.json`
is a real one. Same code path.

**2. A runner is a plain HTML file.** It speaks `postMessage`, holds no key,
knows no student, and reaches no database. Adding one is a row in `runners` plus
a hosted file — no portal redeploy. Your existing tools become runners with
about twenty lines of glue.

**3. Nothing the browser says about marks is believed.** Answer keys live in
`activity_keys`, which has RLS enabled and **no policies** — only the service
role can read it. The scorer Edge Function marks and writes; a trigger strips
`auto_score`, `max_score` and `step_scores` from any student-originated update.
`clientScore` exists only for practice mode.

## Deploying the site (Vercel)

Import the repo at [vercel.com/new](https://vercel.com/new); Vercel detects
Next.js. Set the four environment variables from `.env.example` — only
`SUPABASE_SERVICE_ROLE_KEY` must stay server-side (do not prefix it with
`NEXT_PUBLIC_`).

`vercel.json` no longer sets `outputDirectory`. It did when this was a static
site; leaving it would have made Vercel publish `public/` and never run the
build. Next serves `public/` at the root anyway, so `/runners/**`, `/demo.html`
and `/harness.html` keep their URLs.

The signed-out `/` is the public landing page with the three demos — it works
before Supabase is configured at all, so you can deploy and look at it today.

Note that the security headers deliberately omit `X-Frame-Options`. The runners
*must* be embeddable in an iframe; that is how the portal loads them. Isolation
comes from the `sandbox` attribute the host sets, not from a framing header.

## Deploying the backend

```bash
supabase link --project-ref <ref>
supabase db push
supabase functions deploy score
supabase secrets set PORTAL_ORIGIN=https://nybble.vercel.app
```

Set only `PORTAL_ORIGIN`. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` are injected into every Edge Function automatically
and the `SUPABASE_` prefix is reserved — trying to set them fails.

`PORTAL_ORIGIN` accepts a comma-separated list, and every Vercel preview
deployment has its own hostname. Pin one origin and the scorer works in
production and nowhere else. Leave it unset to allow any origin, which is safe
here: the endpoint authorises by JWT, not by cookie, so a page that copied the
URL still has no token to send.

**Until `score` is deployed, students cannot submit.** The failure is
deliberately opaque to the browser — a missing function returns a 404 with no
CORS headers, and a blocked preflight is indistinguishable in script from the
network being down — so the portal can only say "the marking service did not
answer". Open the browser console on the attempt page: a CORS error there means
the deploy or `PORTAL_ORIGIN`, not the student's wifi.

### First school and teacher

```sql
insert into schools (name, slug) values ('St Mary''s', 'stmarys');
-- create the auth user via the dashboard or admin API, then:
insert into profiles (id, school_id, role, username, display_name, must_change_password)
values ('<auth-user-uuid>', '<school-uuid>', 'teacher', 'josullivan', 'J. O''Sullivan', false);
```

Student logins are `username` + password, mapped internally to
`<username>@<school-slug>.portal.invalid`. Students never see that address.

Account creation and password resets are teacher-only API routes
(`app/api/admin/students`) behind `requireStaff()`, which verifies the caller
with their own session before handing out a service-role client.

**Passwords are shown exactly once and are never stored in plain text.** Both
routes answer with a set of credentials that the class page renders as cut-out
slips — one card per student with the site address, username and password, laid
out to guillotine and hand round, plus Copy and Download CSV. If that sheet is
lost there is no lookup: reset one student from the button beside their name, or
the whole class from *Lost the passwords?* at the bottom of the class page.

## What is deliberately not here yet

- Uploading a CSV file (you can paste CSV text today, but not pick a file)
- Hidden test cases for `pyrun` — impossible by construction, since the tests
  run in the browser and a runner never sees the key (`docs/activity-format.md`)
- An authoring UI — activities are written as files and imported, by hand or
  with an LLM (`docs/activity-format.md`); there is no form for building one

## Known sharp edges

- **There is no middleware, so sessions do not refresh.** Every deployment
  returned 500 `MIDDLEWARE_INVOCATION_FAILED` on every matched path — including
  a build cut down to a single `next/server` import, which rules out anything
  this repo puts in the bundle. Removing `middleware.ts` is what got the site
  serving. Auth is unaffected: all fourteen protected pages call
  `requireSession()` and friends themselves. What is lost is the token refresh,
  because a Server Component cannot write cookies and the middleware was what
  wrote them. Harmless while Supabase is unconfigured — `updateSession` returned
  immediately anyway — but **fix this before there are real accounts**, or users
  will be signed out whenever an access token expires. `lib/supabase/middleware.ts`
  is kept intact and carries the snippet that wires it back. The likely routes
  are Next's `experimental.nodeMiddleware` (canary at 15.5.25) to move it off the
  edge runtime, or Vercel support — this project began life as a static site, so
  stale project settings are a plausible cause.
- **Runner subresources must use absolute paths.** `/runners/lib/...`, never
  `../lib/...`. Under `cleanUrls` a runner's document URL loses its trailing
  slash and relative paths silently resolve one directory too high, leaving a
  blank iframe and no error. `test/deploy.test.mjs --clean` guards this.
- **Generator drift.** `numbase-gen.js` and `numbase.ts` are the same algorithm
  in two languages. The scorer regenerates from the seed and compares against
  the questions the student submitted; a mismatch sets `needsReview` rather than
  mismarking. Change one, change both.
- **`current_school_id()` is one query per policy evaluation.** Fine at class
  scale. If it ever shows up in `pg_stat_statements`, move `school_id` into the
  JWT as a custom claim.
- **Legacy API keys.** `score/index.ts` reads `SUPABASE_ANON_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY`. Supabase has moved to publishable/secret keys and
  the legacy pair stops working at the end of 2026. The migration is not a
  find-and-replace: secret keys cannot travel on the `Authorization: Bearer`
  header, which is what supabase-js does by default. Do it deliberately, before
  there are students on the system.
- **Late submissions are flagged, not zeroed.** `step_scores[step].late` is set
  and the teacher decides. That is a policy choice, change it if you disagree.
