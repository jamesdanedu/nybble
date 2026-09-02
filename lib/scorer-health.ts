import 'server-only';

import { env, serviceRoleKey } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/* ===========================================================================
 * Is the marking service actually working?
 *
 * A student who cannot submit sees one sentence, and the browser deliberately
 * hides the reason: a blocked CORS preflight is opaque to script, so "the
 * function is not deployed", "the gateway rejected the token" and "the wifi is
 * down" all arrive as the same rejected promise. Diagnosing that has meant a
 * teacher reading DevTools to someone who can read Deno logs.
 *
 * These checks run SERVER-SIDE, where there is no CORS and nothing is hidden.
 * The server calls the scorer exactly as the browser does, and reports the raw
 * status and body.
 *
 * Nothing here is a secret: every check reports the SHAPE of a key (its first
 * few characters and, for a JWT, its role claim) and never the key itself.
 * ======================================================================== */

export type Verdict = 'ok' | 'warn' | 'fail' | 'skip';

export interface Check {
  name: string;
  verdict: Verdict;
  /** One line: what is true. */
  summary: string;
  /** The evidence — raw status, headers, body. Shown verbatim, never parsed for display. */
  detail?: string;
  /** What to do about it, when there is something to do. */
  fix?: string;
}

/** Describe a key without disclosing it. */
function describeKey(key: string | undefined): { shape: string; role: string | null } {
  if (!key) return { shape: 'not set', role: null };
  if (key.startsWith('sb_publishable_')) return { shape: 'sb_publishable_… (new-style)', role: 'publishable' };
  if (key.startsWith('sb_secret_')) return { shape: 'sb_secret_… (new-style)', role: 'secret' };
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return { shape: 'eyJ… (legacy JWT)', role: typeof payload.role === 'string' ? payload.role : null };
    } catch {
      return { shape: 'eyJ… (unreadable JWT)', role: null };
    }
  }
  return { shape: `${key.slice(0, 4)}… (unrecognised)`, role: null };
}

/**
 * What a reply from the scorer URL actually means.
 *
 * Getting this wrong is how a health check makes things worse: an early draft
 * of this page reported a 404 as "the gateway refused your token", which is a
 * confident sentence pointing at the wrong thing. The status and the body
 * shape together are unambiguous, so classify once and let every check share
 * the answer.
 */
export type ScorerReply =
  | 'not-deployed'   // 404 — nothing is listening on this path
  | 'gateway-401'    // 401 with no `error` field: rejected before our code ran
  | 'function-401'   // 401 from our code: the caller is not a valid user
  | 'reached'        // our code ran and answered on its own terms
  | 'unexpected';

function classify(status: number, body: string): ScorerReply {
  if (status === 404 && !body.includes('"error"')) return 'not-deployed';
  if (status === 401) return body.includes('"error"') ? 'function-401' : 'gateway-401';
  if (body.includes('"error"') || status < 300) return 'reached';
  return 'unexpected';
}

const NOT_DEPLOYED_FIX =
  'The function is not deployed. Run `supabase functions deploy score`, or paste the output of ' +
  '`node scripts/bundle-score.mjs` into the dashboard editor and name it exactly `score`.';

// Starts with the action. The summary above it already says what is wrong, and
// a fix that re-states the diagnosis makes the reader hunt for the verb.
const GATEWAY_FIX =
  'Turn "Verify JWT" off on the score function. The function authorises callers itself — it checks ' +
  'the bearer token with auth.getUser() and matches the attempt to that user — so this costs a ' +
  'layer of defence in depth, not the authorisation itself.';

/** Read a response without letting a huge or non-JSON body wreck the page. */
async function readBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => '<could not read body>');
  const trimmed = text.trim();
  if (!trimmed) return '<empty body>';
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed;
}

export async function runScorerChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const url = env.scoreFunctionUrl;

  /* ---- 1. Configuration ------------------------------------------------ */
  const anon = describeKey(env.supabaseAnonKey);
  let service: { shape: string; role: string | null };
  try {
    service = describeKey(serviceRoleKey());
  } catch (e) {
    service = { shape: (e as Error).message, role: null };
  }
  const anonOk = anon.role === 'anon' || anon.role === 'publishable';
  const serviceOk = service.role === 'service_role' || service.role === 'secret';
  checks.push({
    name: 'Configuration',
    verdict: env.configured && anonOk && serviceOk ? 'ok' : 'fail',
    summary: env.configured
      ? 'Supabase URL and keys are set.'
      : 'Supabase is not configured — the portal has no database.',
    detail: [
      `NEXT_PUBLIC_SUPABASE_URL      ${env.supabaseUrl || 'not set'}`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY ${anon.shape}${anon.role ? `, role "${anon.role}"` : ''}`,
      `SUPABASE_SERVICE_ROLE_KEY     ${service.shape}${service.role ? `, role "${service.role}"` : ''}`,
      `scorer URL                    ${url}`,
    ].join('\n'),
    fix: serviceOk
      ? undefined
      : 'SUPABASE_SERVICE_ROLE_KEY must be the secret / service_role key, not the publishable one.',
  });

  /* ---- 2. Is the function deployed? ------------------------------------ */
  // OPTIONS is exempt from the gateway's JWT check, so this reaches the
  // function itself if it exists at all. A 404 here means "not deployed",
  // which in a browser is invisible: the 404 carries no CORS headers, so the
  // preflight fails and the POST is never sent.
  try {
    const res = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://portal.invalid',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type',
      },
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const allowHeaders = res.headers.get('access-control-allow-headers');
    const deployed = res.status !== 404;
    checks.push({
      name: 'Deployed',
      verdict: deployed && allowOrigin ? 'ok' : 'fail',
      summary: !deployed
        ? 'The score function is not deployed.'
        : allowOrigin
          ? 'The function answers preflight requests.'
          : 'The function answered, but sent no CORS headers — a browser will refuse to use it.',
      detail: [
        `OPTIONS ${url}`,
        `status ${res.status}`,
        `access-control-allow-origin  ${allowOrigin ?? '<none>'}`,
        `access-control-allow-headers ${allowHeaders ?? '<none>'}`,
      ].join('\n'),
      fix: !deployed ? NOT_DEPLOYED_FIX : undefined,
    });
  } catch (e) {
    checks.push({
      name: 'Deployed',
      verdict: 'fail',
      summary: 'Could not reach the scorer URL at all.',
      detail: `OPTIONS ${url}\n${(e as Error).message}`,
      fix: 'Check NEXT_PUBLIC_SUPABASE_URL, and that the Supabase project is not paused.',
    });
  }

  /* ---- 3. Does the gateway accept a token at all? ---------------------- */
  // The anon key is a valid token for this project. If the gateway rejects
  // even this, the problem is the gateway's JWT verification, not the caller.
  // A 401 whose body has `error` came from OUR code (which means the gateway
  // let it through and the function then declined the anon identity — the
  // correct outcome). A 401 whose body has `message` came from the gateway.
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.supabaseAnonKey}`,
      },
      body: JSON.stringify({}),
    });
    const body = await readBody(res);
    const kind = classify(res.status, body);
    checks.push({
      name: 'Gateway',
      verdict: kind === 'function-401' || kind === 'reached' ? 'ok' : 'fail',
      summary: {
        'function-401': 'The gateway passes tokens through to the function.',
        reached: 'The gateway passes tokens through to the function.',
        'gateway-401': 'The gateway rejected a valid project token before the function ran.',
        'not-deployed': 'Nothing is deployed at this path.',
        unexpected: `Unexpected reply (${res.status}).`,
      }[kind],
      detail: `POST ${url}\nAuthorization: Bearer <anon key>\n\nstatus ${res.status}\n${body}`,
      fix:
        kind === 'gateway-401'
          ? GATEWAY_FIX
          : kind === 'not-deployed'
            ? NOT_DEPLOYED_FIX
            : undefined,
    });
  } catch (e) {
    checks.push({
      name: 'Gateway',
      verdict: 'fail',
      summary: 'The request failed before a reply arrived.',
      detail: (e as Error).message,
    });
  }

  /* ---- 4. The real thing, with the real caller's token ----------------- */
  // The whole path a student takes, minus the student. A deliberately absent
  // attempt id means we can prove the call works without writing anything: if
  // the token is accepted, the function gets as far as looking the attempt up
  // and says "attempt not found", which is SUCCESS for this check.
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    checks.push({
      name: 'Signed-in call',
      verdict: 'skip',
      summary: 'No access token on this request, so the real path could not be tried.',
    });
  } else {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          attemptId: '00000000-0000-0000-0000-000000000000',
          stepId: 'health-check',
          response: {},
        }),
      });
      const body = await readBody(res);
      const kind = classify(res.status, body);
      // "attempt not found" is the SUCCESS signal: the token was accepted, the
      // function ran, and it got as far as looking up an id we know is absent.
      const worked = body.includes('attempt not found');
      checks.push({
        name: 'Signed-in call',
        verdict: worked ? 'ok' : 'fail',
        summary: worked
          ? 'Your token was accepted and the function ran. Submitting works.'
          : {
              'not-deployed': 'Nothing is deployed at this path.',
              'gateway-401': 'The gateway refused your token before the function ran.',
              'function-401': 'The function itself refused your token.',
              reached: `The function ran but replied ${res.status}.`,
              unexpected: `Unexpected reply (${res.status}).`,
            }[kind],
        detail:
          `POST ${url}\nAuthorization: Bearer <your access token>\n` +
          `body {"attemptId":"00000000-…-000000000000","stepId":"health-check","response":{}}\n\n` +
          `status ${res.status}\n${body}`,
        fix: worked
          ? undefined
          : kind === 'not-deployed'
            ? NOT_DEPLOYED_FIX
            : kind === 'gateway-401'
              ? GATEWAY_FIX
              : kind === 'function-401'
                ? 'The function refused your token. Check that the function belongs to this same Supabase project.'
                : undefined,
      });
    } catch (e) {
      checks.push({
        name: 'Signed-in call',
        verdict: 'fail',
        summary: 'The request failed before a reply arrived.',
        detail: (e as Error).message,
      });
    }
  }

  /* ---- 5. Can the scorer read an answer key? --------------------------- */
  // activity_keys has RLS on and no policies, so only the service role can read
  // it. If that grant is missing the scorer marks everything zero rather than
  // failing loudly — the worst kind of broken.
  try {
    const admin = createServiceClient();
    const { error } = await admin.from('activity_keys').select('activity_id').limit(1);
    checks.push({
      name: 'Answer keys',
      verdict: error ? 'fail' : 'ok',
      summary: error
        ? 'The service role cannot read activity_keys.'
        : 'The service role can read activity_keys.',
      detail: error ? error.message : 'select activity_id from activity_keys limit 1 — ok',
      fix: error
        ? 'Run supabase/migrations/0005_service_role_grants.sql. Without it the scorer cannot see the answers and would mark every submission zero.'
        : undefined,
    });
  } catch (e) {
    checks.push({
      name: 'Answer keys',
      verdict: 'fail',
      summary: 'Could not use the service role at all.',
      detail: (e as Error).message,
    });
  }

  return checks;
}
