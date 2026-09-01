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

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('PORTAL_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
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

  let body: { attemptId?: string; stepId?: string; response?: Record<string, unknown> };
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
