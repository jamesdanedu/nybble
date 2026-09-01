/* ===========================================================================
 * plan.mjs — turn a validated activity file into a dry-run plan, then commit it.
 *
 * Shared by the browser importer (app/teacher/activities/import) and the CLI
 * (scripts/import-activities.mjs), so the two can never disagree about what an
 * import does.
 *
 * BOTH FUNCTIONS TAKE A SERVICE-ROLE CLIENT. They have to: `activity_keys` has
 * RLS enabled and no policies whatsoever, so a teacher's own session cannot
 * write it. The caller is responsible for having established that the human on
 * the other end is staff (lib/supabase/service.ts `requireStaff`) and for
 * passing a `schoolId` and `ownerId` that came from THAT person's profile —
 * never from the request body. The service role does not enforce tenancy, so
 * this is the only thing keeping an import inside one school.
 * ======================================================================== */

import { assertNoKeysInPublicSteps } from './schema.mjs';

/**
 * @typedef {import('./schema.mjs').ParsedActivity} ParsedActivity
 */

/**
 * @typedef {Object} StepPlan
 * @property {string} id
 * @property {string} runner_id
 * @property {'create'|'update'|'unchanged'|'kept'} action
 *           'kept' = present in the database, absent from the file, left alone
 * @property {boolean} hasKey
 */

/**
 * @typedef {Object} ActivityPlan
 * @property {string} title
 * @property {string|null} topic
 * @property {'create'|'update'} action
 * @property {string|null} existingId
 * @property {StepPlan[]} steps
 * @property {number} keyCount
 * @property {string[]} notes
 * @property {any} _row      the activities row to write (internal to commit)
 * @property {any} _keys     the activity_keys.keys object to write
 */

/**
 * @typedef {Object} ImportPlan
 * @property {ActivityPlan[]} activities
 * @property {string[]} errors     blocking — commit refuses while non-empty
 * @property {string[]} warnings
 * @property {boolean} replace
 */

const sortedKeys = (o) => Object.keys(o).sort();
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Build the dry-run plan. Reads the database; writes nothing.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db  service-role client
 * @param {{ schoolId: string, ownerId: string, activities: ParsedActivity[], replace?: boolean }} opts
 * @returns {Promise<ImportPlan>}
 */
export async function planImport(db, { schoolId, ownerId, activities, replace = false }) {
  /** @type {string[]} */ const errors = [];
  /** @type {string[]} */ const warnings = [];
  /** @type {ActivityPlan[]} */ const plans = [];

  // Every runner referenced must be registered — built-in (school_id null) or
  // registered to this school. An unregistered runner_id produces an activity
  // that renders a blank iframe and cannot be scored, so block on it.
  const { data: runnerRows, error: runnerErr } = await db
    .from('runners')
    .select('id, school_id, scorer')
    .or(`school_id.is.null,school_id.eq.${schoolId}`);
  if (runnerErr) {
    errors.push(`Could not read the runner registry: ${runnerErr.message}`);
  }
  const runners = new Map((runnerRows ?? []).map((r) => [r.id, r]));

  for (const a of activities) {
    /** @type {string[]} */ const notes = [];

    for (const s of a.steps) {
      if (!runners.has(s.runner_id)) {
        errors.push(
          `"${a.title}" step "${s.id}" uses runner "${s.runner_id}", which is not registered ` +
            'for this school. Add a row to `runners` first.',
        );
      } else if (runners.get(s.runner_id).scorer === 'manual' && a.keys[s.id]) {
        warnings.push(
          `"${a.title}" step "${s.id}" is a manual-marking runner but has a key; it will be stored and ignored.`,
        );
      }
    }

    // Identity for the upsert is (school_id, title, topic) — the pair the
    // format document promises. `topic` may be null, which needs .is() not .eq().
    let q = db
      .from('activities')
      .select('id, steps, title, topic, description, visibility, shared_context, max_score')
      .eq('school_id', schoolId)
      .eq('title', a.title);
    q = a.topic === null ? q.is('topic', null) : q.eq('topic', a.topic);
    const { data: existingRows, error: findErr } = await q;
    if (findErr) {
      errors.push(`Could not look up "${a.title}": ${findErr.message}`);
      continue;
    }
    const existing = existingRows && existingRows.length ? existingRows[0] : null;
    if (existingRows && existingRows.length > 1) {
      warnings.push(
        `${existingRows.length} activities already share the title "${a.title}" and that topic; ` +
          'updating the first one.',
      );
    }

    /** @type {StepPlan[]} */ const stepPlans = [];
    /** @type {any[]} */ let finalSteps;

    if (!existing || replace) {
      finalSteps = a.steps;
      for (const s of a.steps) {
        stepPlans.push({
          id: s.id,
          runner_id: s.runner_id,
          action: 'create',
          hasKey: Boolean(a.keys[s.id]),
        });
      }
      if (existing && replace) {
        const goneIds = (existing.steps ?? [])
          .map((s) => s.id)
          .filter((id) => !a.steps.some((s) => s.id === id));
        if (goneIds.length) {
          notes.push(`--replace removes step(s): ${goneIds.join(', ')} (and their keys).`);
        }
      }
    } else {
      // Merge by step id, preserving the existing order and appending new steps
      // at the end. A teacher who reordered steps in the portal keeps that order;
      // use --replace to impose the file's order.
      const byId = new Map(a.steps.map((s) => [s.id, s]));
      /** @type {any[]} */ const merged = [];
      for (const old of existing.steps ?? []) {
        const incoming = byId.get(old.id);
        if (incoming) {
          merged.push(incoming);
          stepPlans.push({
            id: incoming.id,
            runner_id: incoming.runner_id,
            action: sameJson(old, incoming) ? 'unchanged' : 'update',
            hasKey: Boolean(a.keys[incoming.id]),
          });
          byId.delete(old.id);
        } else {
          merged.push(old);
          stepPlans.push({
            id: old.id,
            runner_id: old.runner_id,
            action: 'kept',
            hasKey: false,
          });
        }
      }
      for (const s of a.steps) {
        if (!byId.has(s.id)) continue; // already merged above
        merged.push(s);
        stepPlans.push({
          id: s.id,
          runner_id: s.runner_id,
          action: 'create',
          hasKey: Boolean(a.keys[s.id]),
        });
      }
      finalSteps = merged;
    }

    // THE GUARANTEE. Throws rather than writing if a key ever leaked into the
    // half of the step that students can read.
    assertNoKeysInPublicSteps(finalSteps);

    plans.push({
      title: a.title,
      topic: a.topic,
      action: existing ? 'update' : 'create',
      existingId: existing ? existing.id : null,
      steps: stepPlans,
      keyCount: sortedKeys(a.keys).length,
      notes,
      _row: {
        school_id: schoolId,
        owner_id: ownerId,
        title: a.title,
        topic: a.topic,
        description: a.description,
        steps: finalSteps,
        shared_context: a.shared_context,
        max_score: a.max_score,
        visibility: a.visibility,
      },
      _keys: a.keys,
    });
  }

  return { activities: plans, errors, warnings, replace };
}

/**
 * Execute a plan. Writes `activities` then `activity_keys`, in that order,
 * per activity.
 *
 * There is no transaction: supabase-js speaks PostgREST, which has no
 * multi-statement transaction. If the keys write fails after the activity write
 * succeeded, the activity exists with stale or missing keys — which marks
 * students wrong rather than leaking answers, so it fails in the safe
 * direction. The error is reported per activity so the teacher can re-run;
 * the import is idempotent, so re-running is always safe.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db  service-role client
 * @param {ImportPlan} plan
 * @returns {Promise<{ ok: boolean, results: {title: string, action: string, id?: string, error?: string}[] }>}
 */
export async function commitImport(db, plan) {
  if (plan.errors.length) {
    return {
      ok: false,
      results: [{ title: '(all)', action: 'refused', error: plan.errors.join(' ') }],
    };
  }

  /** @type {{title: string, action: string, id?: string, error?: string}[]} */
  const results = [];
  let ok = true;

  for (const p of plan.activities) {
    // Re-assert immediately before the write, not just at plan time.
    try {
      assertNoKeysInPublicSteps(p._row.steps);
    } catch (e) {
      ok = false;
      results.push({ title: p.title, action: 'refused', error: String(e && e.message) });
      continue;
    }

    let activityId = p.existingId;
    if (activityId) {
      // owner_id is intentionally NOT updated — re-importing someone else's
      // file should not silently transfer ownership of the activity.
      const { school_id, owner_id, ...updatable } = p._row;
      const { error } = await db.from('activities').update(updatable).eq('id', activityId);
      if (error) {
        ok = false;
        results.push({ title: p.title, action: 'update', error: error.message });
        continue;
      }
    } else {
      const { data, error } = await db.from('activities').insert(p._row).select('id').single();
      if (error || !data) {
        ok = false;
        results.push({ title: p.title, action: 'create', error: error ? error.message : 'no row returned' });
        continue;
      }
      activityId = data.id;
    }

    // Keys. Merge into whatever is already stored unless --replace, so that
    // adding one step to an activity does not wipe the other steps' answers.
    /** @type {Record<string, unknown>} */ let keys = p._keys;
    if (!plan.replace && p.existingId) {
      const { data: existingKeys } = await db
        .from('activity_keys')
        .select('keys')
        .eq('activity_id', activityId)
        .maybeSingle();
      keys = { ...(existingKeys?.keys ?? {}), ...p._keys };
    }

    const { error: keyErr } = await db
      .from('activity_keys')
      .upsert({ activity_id: activityId, keys, updated_at: new Date().toISOString() },
              { onConflict: 'activity_id' });
    if (keyErr) {
      ok = false;
      results.push({ title: p.title, action: p.action, id: activityId, error: `keys: ${keyErr.message}` });
      continue;
    }

    results.push({ title: p.title, action: p.action, id: activityId });
  }

  return { ok, results };
}
