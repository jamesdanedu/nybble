// ============================================================================
// DO NOT PASTE THIS FILE INTO THE SUPABASE DASHBOARD EDITOR.
//
// The three relative imports below are resolved by the CLI, which uploads the
// whole folder. The dashboard editor holds ONE file, so those imports resolve
// to nothing, the module fails to load, and the function 500s on every request
// — including the CORS preflight, which makes a browser report it as a CORS
// error. Nothing appears in the Logs tab either, because the function is never
// invoked. It cost a class a week of submissions that silently went nowhere.
//
// Deploy with:      supabase functions deploy score
// Dashboard editor: paste `node scripts/bundle-score.mjs`, which inlines the
//                   three modules into one file with no relative imports.
// ============================================================================
// POST /functions/v1/score
//
// The only place answer keys are ever read. Called by the portal when a student
// submits a step. Everything the student's browser sent is treated as hostile:
// the caller's identity comes from their JWT, the attempt and assignment come
// from the database, and the marks come from the key — never from the payload.
//
//   body: { attemptId: uuid, stepId: string, response: object }
//
//   returns: { ok, status, stepScore?, attemptScore? }
//     stepScore is withheld unless the assignment releases feedback
//     immediately, so a student cannot use the response to farm the key.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as mcq from './mcq.ts';
import * as numbase from './numbase.ts';
import * as parsons from './parsons.ts';

// The portal calls this with a plain fetch carrying Content-Type, Authorization
// and `apikey`. Content-Type: application/json alone makes the request
// non-simple, so the browser sends a preflight first and every one of those
// header names has to appear here — `apikey` included. It did not, so the
// preflight failed and the POST was never sent. The browser reports that as a
// rejected promise, indistinguishable in the portal from the network being
// down, which is why it surfaced as "could not reach the marking service" on a
// perfectly healthy deployment. x-client-info is listed too, so that switching
// the portal to supabase-js `functions.invoke()` does not reintroduce this.
const ALLOW_HEADERS = 'authorization, content-type, apikey, x-client-info';

// PORTAL_ORIGIN may be a comma-separated list. Vercel gives every preview
// deployment its own hostname, so pinning one origin means the scorer works in
// production and fails everywhere else — with the same opaque error, because
// a blocked preflight never reaches the function's own logs. Unset means '*',
// which is safe here: this endpoint authorises by JWT, not by cookie, so a
// hostile page that copied the URL still has no token to send.
const ALLOWED_ORIGINS = (Deno.env.get('PORTAL_ORIGIN') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.length === 0
    ? '*'
    : ALLOWED_ORIGINS.includes(origin)
      ? origin // echo it, so several origins can be allowed at once
      : ALLOWED_ORIGINS[0]; // a mismatch: name the expected origin in the error
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    // The response varies by request Origin, so it must not be cached against
    // one origin and replayed for another.
    'Vary': 'Origin',
  };
}

/**
 * Marking for a runner registered `scorer = 'client'` — today, `pyrun`.
 *
 * Some things cannot be marked on this server. Whether a student's Python does
 * what it was asked to do is one of them: the scorer runs on Deno and there is
 * no Python here to run their code against. The runner does run it, in the
 * student's own browser, and reports how many of the teacher's checks passed.
 *
 * That report is not evidence. Anyone who can open dev tools can post any
 * number they like, so it is honoured under exactly one condition:
 *
 *   **practice mode, where nothing is at stake.** There the number is instant
 *   formative feedback on "did my change work", which is the whole point of
 *   PRIMM's Modify phase, and no mark is being awarded.
 *
 * Anywhere else the work is recorded and sent to a teacher, the same as any
 * other thing a machine cannot mark. The mode is read from the database, never
 * from the request, so a browser cannot talk its way into the first branch.
 *
 * The runner scores out of its own test marks; the attempt has to be scored out
 * of the step's weight, so the two are reconciled by proportion here rather than
 * letting a runner decide what a step is worth.
 */
function scoreFromClient(
  step: { weight?: number | null },
  mode: string,
  clientScore: unknown,
  clientMax: unknown,
) {
  const weight = typeof step.weight === 'number' ? step.weight : null;

  // A weight-0 step (PRIMM's Run: read it, run it, look at the output) has
  // nothing to mark. Sending it to a teacher would be a queue full of noise.
  if (weight === 0) {
    return { total: 0, max: 0, client: true, nothingToMark: true, perQuestion: {} };
  }

  const pending = { total: null, max: weight, manual: true, perQuestion: {} };
  if (mode !== 'practice') return pending;

  const got = typeof clientScore === 'number' && Number.isFinite(clientScore) ? clientScore : null;
  const outOf = typeof clientMax === 'number' && Number.isFinite(clientMax) ? clientMax : null;
  if (got === null || outOf === null || outOf <= 0 || weight === null) return pending;

  const fraction = Math.min(1, Math.max(0, got / outOf));
  return {
    total: Math.round(weight * fraction * 100) / 100,
    max: weight,
    client: true,
    // Carried into the teacher's review view so a number from a browser is
    // never mistaken for a number this server stands over.
    unverified: true,
    reported: { passed: got, outOf },
    perQuestion: {},
  };
}

Deno.serve(async (req) => {
  const CORS = corsFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  // 204 is a null-body status, and the Response constructor throws on ANY body
  // for those — even 'ok'. That throw happened on every preflight, so the
  // browser saw a 500 with no CORS headers, reported it as a CORS error, and
  // never sent the POST. The body here must be null.
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthenticated' }, 401);

  // Identify the caller with their own token (anon key + their JWT).
  const asUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userErr } = await asUser.auth.getUser();
  if (userErr || !user) return json({ error: 'unauthenticated' }, 401);

  // Service role for everything else — this is what can see activity_keys.
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  let body: {
    attemptId?: string;
    stepId?: string;
    response?: Record<string, unknown>;
    // Only meaningful for a runner registered `scorer = 'client'`, and only in
    // practice mode. Sent by the portal, produced by the student's browser,
    // and believed exactly as far as scoreFromClient() below allows.
    clientScore?: unknown;
    maxScore?: unknown;
  };
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const { attemptId, stepId, response } = body;
  if (!attemptId || !stepId || typeof response !== 'object' || response === null) {
    return json({ error: 'attemptId, stepId and response are required' }, 400);
  }

  // ---- Load the attempt and everything hanging off it -----------------------
  const { data: attempt, error: aErr } = await db
    .from('attempts')
    .select('id, school_id, assignment_id, profile_id, status, seed, step_responses, step_scores')
    .eq('id', attemptId)
    .single();
  if (aErr || !attempt) return json({ error: 'attempt not found' }, 404);
  if (attempt.profile_id !== user.id) return json({ error: 'forbidden' }, 403);
  if (attempt.status !== 'in_progress') return json({ error: 'attempt already submitted' }, 409);

  const { data: assignment } = await db
    .from('assignments')
    .select('id, activity_id, mode, open_at, due_at, release_feedback, time_limit_secs')
    .eq('id', attempt.assignment_id)
    .single();
  if (!assignment) return json({ error: 'assignment not found' }, 404);

  const now = Date.now();
  if (new Date(assignment.open_at).getTime() > now) {
    return json({ error: 'assignment is not open yet' }, 403);
  }

  const { data: activity } = await db
    .from('activities')
    .select('id, steps, max_score')
    .eq('id', assignment.activity_id)
    .single();
  if (!activity) return json({ error: 'activity not found' }, 404);

  const steps: any[] = Array.isArray(activity.steps) ? activity.steps : [];
  const step = steps.find((s) => s.id === stepId);
  if (!step) return json({ error: `unknown step '${stepId}'` }, 400);

  // A step is answered once.
  //
  // PRIMM is why this matters. The sequence works by making a student confront
  // the gap between what they predicted and what the program actually did, and
  // that collapses entirely if they can walk back to Predict after seeing the
  // output and quietly rewrite the prediction. The portal already re-mounts an
  // answered step read-only, but the portal is not a security boundary: a
  // runner that declares selfSubmit keeps its own button, and anyone with dev
  // tools can post whatever they like.
  //
  // `attempts.attempt_no` already exists, so a retry was designed as a whole
  // new attempt rather than a second go at one step. `allowResubmit` on the
  // step is the deliberate exception, for activities that want a scratchpad.
  const alreadyAnswered = (attempt.step_responses ?? {})[stepId] !== undefined;
  if (alreadyAnswered && step.allowResubmit !== true) {
    return json({ error: 'step already answered' }, 409);
  }

  const { data: runner } = await db
    .from('runners').select('id, scorer').eq('id', step.runner_id).single();

  const { data: keyRow } = await db
    .from('activity_keys').select('keys').eq('activity_id', activity.id).single();
  const stepKey = (keyRow?.keys ?? {})[stepId] ?? {};

  // ---- Mark ----------------------------------------------------------------
  let stepScore: any;
  switch (step.runner_id) {
    case 'mcq':
      stepScore = mcq.score(step.config ?? {}, stepKey, response as any);
      break;
    case 'numbase':
      stepScore = numbase.score(step.config ?? {}, attempt.seed, response as any);
      break;
    case 'parsons':
      stepScore = parsons.score(step.config ?? {}, stepKey, response as any);
      break;
    default:
      if (runner?.scorer === 'manual') {
        stepScore = { total: null, max: step.weight ?? null, manual: true, perQuestion: {} };
      } else if (runner?.scorer === 'client') {
        stepScore = scoreFromClient(step, assignment.mode, body.clientScore, body.maxScore);
      } else {
        return json({ error: `no server scorer registered for runner '${step.runner_id}'` }, 501);
      }
  }

  // Late submissions are recorded and flagged, never silently zeroed — that's a
  // judgement call for the teacher, not the database.
  const late = assignment.due_at ? new Date(assignment.due_at).getTime() < now : false;

  const stepResponses = { ...(attempt.step_responses ?? {}), [stepId]: response };
  const stepScores = {
    ...(attempt.step_scores ?? {}),
    [stepId]: { ...stepScore, late, scoredAt: new Date().toISOString() },
  };

  // ---- Complete the attempt if every step is in -----------------------------
  const allIn = steps.every((s) => stepResponses[s.id] !== undefined);
  const autoScore = allIn
    ? Object.values(stepScores).reduce(
        (sum: number, s: any) => sum + (typeof s.total === 'number' ? s.total : 0), 0)
    : null;
  const maxScore = allIn
    ? Object.values(stepScores).reduce(
        (sum: number, s: any) => sum + (typeof s.max === 'number' ? s.max : 0), 0)
    : null;

  const { error: upErr } = await db
    .from('attempts')
    .update({
      step_responses: stepResponses,
      step_scores: stepScores,
      ...(allIn
        ? { status: 'submitted', submitted_at: new Date().toISOString(),
            auto_score: autoScore, max_score: maxScore }
        : {}),
    })
    .eq('id', attempt.id);
  if (upErr) return json({ error: 'could not save attempt', detail: upErr.message }, 500);

  // ---- Decide what the student is allowed to see back ----------------------
  const showFeedback =
    assignment.mode === 'practice' || assignment.release_feedback === 'immediate';

  return json({
    ok: true,
    status: allIn ? 'submitted' : 'in_progress',
    late,
    ...(showFeedback
      ? { stepScore, attemptScore: allIn ? { total: autoScore, max: maxScore } : null }
      : { stepScore: { recorded: true } }),
  });
});
