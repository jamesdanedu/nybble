-- ============================================================================
-- Register the `parsons` runner.
--
-- 0001 originally seeded two built-in runners, mcq and numbase. The commit that
-- added the Parsons runner appended a third row to that same INSERT — editing a
-- migration that had already run. Postgres does not care what a migration file
-- says after it has been applied, so every database created before that commit
-- has mcq and numbase and nothing else, while the file on disk claims all three.
--
-- The symptom is an import that refuses every step and writes nothing:
--
--     "Python — 06 Iteration" step "p1" uses runner "parsons", which is not
--     registered for this school. Add a row to `runners` first.
--
-- which is the importer doing its job. An unregistered runner_id would produce
-- an activity that renders a blank iframe and cannot be scored, so it blocks
-- rather than importing something broken.
--
-- Idempotent, so it is safe on a database created after that commit — which
-- already has the row from 0001 — as well as on one created before it. The
-- update is there because a row inserted by hand while working around this may
-- have the wrong entry_url or scorer, and a wrong entry_url fails the same way
-- from the student's side: a blank iframe, no error.
--
-- school_id stays null. That is what makes a runner built in and available to
-- every school, rather than to whichever school happened to run this.
--
-- To check this ran:
--
--     select id, entry_url, scorer, builtin, school_id from runners order by id;
-- ============================================================================

insert into runners (id, name, version, entry_url, scorer, builtin, school_id)
values ('parsons', 'Parsons Problem', '1.0.0', '/runners/parsons/index.html', 'server', true, null)
on conflict (id) do update
  set name      = excluded.name,
      entry_url = excluded.entry_url,
      scorer    = excluded.scorer,
      builtin   = excluded.builtin,
      school_id = excluded.school_id;
