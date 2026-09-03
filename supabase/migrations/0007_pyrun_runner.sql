-- ============================================================================
-- Register the `pyrun` runner.
--
-- Python in the browser, carrying PRIMM's Run and Modify phases. The engine is
-- Skulpt, vendored at /runners/lib/skulpt/ and chosen by the spike written up
-- in docs/primm.md — the short version being that Pyodide cannot be stopped
-- inside the runner sandbox, and a frozen tab mid-class is worse than an
-- unsupported language feature.
--
-- `scorer = 'client'` is the interesting part, and it is narrower than it
-- sounds. Whether a student's Python does what it was asked cannot be decided
-- in the scorer Edge Function: that runs on Deno, and there is no Python there
-- to run their code against. The runner does run it, in the student's own
-- browser, and reports how many of the teacher's checks passed.
--
-- That report is honoured under one condition only — practice mode, where
-- nothing is at stake and the number is instant formative feedback on "did my
-- change work". Anywhere else the work is recorded and queued for a teacher,
-- exactly like any other thing a machine cannot mark. The Edge Function reads
-- the assignment's mode from the database, never from the request, so a browser
-- cannot talk its way into being believed. See scoreFromClient() there.
--
-- A step given `weight: 0` (PRIMM's Run: read it, run it, look at the output)
-- records 0/0 rather than queueing, because there is genuinely nothing to mark.
--
-- Idempotent, like 0006.
-- ============================================================================

insert into runners (id, name, version, entry_url, scorer, builtin)
values ('pyrun', 'Run Python', '1.0.0', '/runners/pyrun/index.html', 'client', true)
on conflict (id) do update
  set name      = excluded.name,
      version   = excluded.version,
      entry_url = excluded.entry_url,
      scorer    = excluded.scorer,
      builtin   = excluded.builtin;
