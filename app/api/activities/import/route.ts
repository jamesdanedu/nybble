import { NextResponse, type NextRequest } from 'next/server';
import { NotStaffError, requireStaff } from '@/lib/supabase/service';
// Plain ESM JavaScript, shared verbatim with scripts/import-activities.mjs so
// the browser importer and the CLI importer cannot drift apart. TypeScript
// picks up the JSDoc types in those files.
import { parseActivityFile } from '@/lib/activity-import/schema.mjs';
import { planImport, commitImport } from '@/lib/activity-import/plan.mjs';

/* ===========================================================================
 * POST /api/activities/import
 *
 *   { mode: 'dry-run' | 'commit', file: <parsed activity file>, replace?: bool }
 *
 * The service role is unavoidable here: `activity_keys` has RLS enabled and NO
 * POLICIES, so even a teacher's own session cannot write an answer key. That is
 * the point of the table. So the guard is the same as everywhere else the
 * service role appears — `requireStaff()` verifies the caller through their own
 * anon-key session first, and `school_id` and `owner_id` are taken from that
 * verified profile, never from the request.
 *
 * The key-splitting itself happens in lib/activity-import/schema.mjs and is
 * re-asserted immediately before every write in plan.mjs. Read the comment at
 * the top of schema.mjs before touching any of it.
 * ======================================================================== */

export const dynamic = 'force-dynamic';

// A class set of MCQs with explanations is comfortably under this; a file
// bigger than it is a mistake, not an activity.
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  let profile, admin;
  try {
    ({ profile, admin } = await requireStaff());
  } catch (e) {
    const err = e as NotStaffError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 403 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is too big (2 MB limit).' }, { status: 413 });
  }

  let body: { mode?: string; file?: unknown; replace?: boolean };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'The request body was not valid JSON.' }, { status: 400 });
  }

  const parsed = parseActivityFile(body.file);
  if (!parsed.ok) {
    return NextResponse.json(
      { stage: 'validate', ok: false, errors: parsed.errors, warnings: parsed.warnings },
      { status: 200 }, // a validation failure is an answer, not an HTTP error
    );
  }

  let plan;
  try {
    plan = await planImport(admin, {
      schoolId: profile.school_id,
      ownerId: profile.id,
      activities: parsed.activities,
      replace: Boolean(body.replace),
    });
  } catch (e) {
    // assertNoKeysInPublicSteps throws here if the split ever failed.
    return NextResponse.json(
      { stage: 'plan', ok: false, errors: [{ path: '', message: String((e as Error).message) }] },
      { status: 500 },
    );
  }

  // Strip the internal payload before it goes over the wire. `_keys` is the
  // answer keys; sending them to the browser would undo the entire point of
  // the split, even though the caller is a teacher.
  const publicPlan = plan.activities.map(
    ({ _row, _keys, ...rest }: Record<string, unknown>) => rest,
  );

  if (body.mode !== 'commit') {
    return NextResponse.json({
      stage: 'plan',
      ok: plan.errors.length === 0,
      plan: publicPlan,
      errors: plan.errors,
      warnings: [...parsed.warnings.map((w: { path: string; message: string }) =>
        `${w.path}: ${w.message}`), ...plan.warnings],
    });
  }

  const { ok, results } = await commitImport(admin, plan);
  return NextResponse.json({ stage: 'commit', ok, results });
}
