-- ============================================================================
-- Register the `freetext` runner.
--
-- A prompt and a box, hand-marked. It carries PRIMM's Predict and Make phases,
-- which is why it is the first of the two runners that sequence needs — see
-- docs/primm.md.
--
-- `scorer = 'manual'` is the whole point of it. The scorer Edge Function has no
-- case for this runner id and must not grow one: written English cannot be
-- marked by comparing strings, so every submission goes to the teacher review
-- queue with `{ total: null, max: step.weight, manual: true }` and waits for a
-- human. `activity_keys` gets an empty object for these steps; there is nothing
-- to hide because there is no answer to hide.
--
-- Idempotent: this runs against databases that already have the row (a school
-- that registered it by hand before this migration shipped), so it updates in
-- place rather than failing the whole migration on a primary key clash.
-- ============================================================================

insert into runners (id, name, version, entry_url, scorer, builtin)
values ('freetext', 'Written Answer', '1.0.0', '/runners/freetext/index.html', 'manual', true)
on conflict (id) do update
  set name      = excluded.name,
      version   = excluded.version,
      entry_url = excluded.entry_url,
      scorer    = excluded.scorer,
      builtin   = excluded.builtin;
