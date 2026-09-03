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
  | 'platform-401'   // 401, no body at all: refused above the function, reason unstated
  | 'gateway-401'    // 401 with { message }: the gateway said why
  | 'function-401'   // 401 with { error }: our code declined the caller
  | 'reached'        // our code ran and answered on its own terms
  | 'unexpected';

function classify(status: number, body: string): ScorerReply {
  const ours = body.includes('"error"');
  if (status === 404 && !ours) return 'not-deployed';
  if (status === 401) {
    if (ours) return 'function-401';
    // A 401 that says NOTHING is a different animal from one that says
    // "Invalid JWT". The gateway's own JWT rejection is chatty; an empty body
    // means something above the function refused without explaining, and the
    // "Verify JWT" toggle is not necessarily the thing that did it.
    const silent = body === '<empty body>' || !body.includes('"');
    return silent ? 'platform-401' : 'gateway-401';
  }
  if (ours || status < 300) return 'reached';
  return 'unexpected';
}

const NOT_DEPLOYED_FIX =
  'The function is not deployed. Run `supabase functions deploy score`, or paste the output of ' +
  '`node scripts/bundle-score.mjs` into the dashboard editor and name it exactly `score`.';

// Starts with the action. The summary above it already says what is wrong, and
// a fix that re-states the diagnosis makes the reader hunt for the verb.
//
// It also has to survive being read by someone who has ALREADY done the
// obvious thing. An earlier version said only "turn Verify JWT off", which was
// useless advice to send to someone looking at a toggle that was already off —
// exactly the confidently-wrong sentence this page exists to replace. So name
// the toggle, and say what it means if it is already off.
const GATEWAY_FIX =
  'Check "Verify JWT with legacy secret" on the score function (Settings). If it is ON, turn it ' +
  'off: the function authorises callers itself — it checks the bearer token with auth.getUser() ' +
  'and matches the attempt to that user — so this costs a layer of defence in depth, not the ' +
  'authorisation itself. If it is already OFF, nothing above the function should be rejecting ' +
  'anything, so compare this check with the signed-in call below: if both fail the refusal is ' +
  'coming from the platform, and the function\u2019s Logs tab in the dashboard will show whether ' +
  'the request reached it at all.';

// The gateway says this, verbatim, when it accepts only the new API key
// formats and is handed a legacy one — or none at all. It is worth matching on
// because the remedy is specific and nothing else in this file implies it.
const NEW_KEYS_ONLY = 'accepted auth mode';

// Supabase's `functions new` template reads `name` from the body and answers
// `Hello <name>!`. Deployed under the name `score` it answers 200 to
// everything, so every submission looks like a success and nothing is written —
// which is exactly how a class can submit for a week and record nothing. Worth
// matching by name because the remedy is specific and the symptom is silent.
const TEMPLATE_FN = /"Hello\s|"message"\s*:\s*"Hello/;

const TEMPLATE_FIX =
  'A DIFFERENT function is deployed under the name `score` — that reply is Supabase\u2019s ' +
  '"Hello World" template, not this scorer. It answers 200 to everything, so the portal thinks ' +
  'every submission succeeded while nothing is written: attempts stay in_progress with an empty ' +
  'step_responses. Replace it: run `supabase functions deploy score` from the repo, or paste the ' +
  'output of `node scripts/bundle-score.mjs` into the dashboard editor for the function named ' +
  'exactly `score`.';

const NEW_KEYS_FIX =
  'This project\u2019s function gateway accepts only the NEW API key formats. Take the ' +
  'publishable key (sb_publishable_\u2026) and the secret key (sb_secret_\u2026) from Project ' +
  'Settings \u2192 API Keys, set them as NEXT_PUBLIC_SUPABASE_ANON_KEY and ' +
  'SUPABASE_SERVICE_ROLE_KEY in Vercel, and redeploy. A legacy eyJ\u2026 key keeps working for ' +
  'the database, which is why everything except submitting looks fine.';

// A 5xx on OPTIONS is not a CORS problem, and calling it one sends the reader
// to edit headers in a function that never got as far as running. Our handler
// answers OPTIONS on its first line, so if that 500s the module threw while
// loading and NOTHING in it has executed.
const BOOT_ERROR_FIX =
  'The function is deployed but crashing as it starts, before any of its code runs \u2014 our ' +
  'handler answers OPTIONS on its first line, so a 500 here means the module never loaded. Open ' +
  'the function\u2019s Logs tab in the Supabase dashboard: a boot failure is printed there verbatim ' +
  'and names the line. The usual cause is the remote import at the top of index.ts: an Edge ' +
  'Runtime that cannot resolve `jsr:@supabase/supabase-js@2` fails exactly like this, and ' +
  'swapping it for `https://esm.sh/@supabase/supabase-js@2` is the fix. A partial paste into the ' +
  'dashboard editor looks the same \u2014 compare the end of the file against ' +
  '`node scripts/bundle-score.mjs`.';

const PLATFORM_401_FIX =
  'The refusal carried no message, so it did not come from the function (which always answers ' +
  'with { error }) nor from the gateway\u2019s JWT check (which answers with { message }). Open ' +
  'the function\u2019s Logs tab in the Supabase dashboard: if no invocation is recorded, the ' +
  'request was stopped before it arrived, and the response headers above name what stopped it.';

/**
 * Headers worth showing on a refusal. When something upstream of the function
 * says no without explaining, these are usually the only evidence of who did.
 */
const TELLING_HEADERS = [
  'content-type',
  'www-authenticate',
  'server',
  'x-sb-error-code',
  'x-sb-edge-region',
  'sb-gateway-version',
  'x-served-by',
];

function describeHeaders(res: Response): string {
  const lines = TELLING_HEADERS.map((h) => [h, res.headers.get(h)] as const)
    .filter(([, v]) => v)
    .map(([h, v]) => `${h}: ${v}`);
  return lines.length ? lines.join('\n') : '<no identifying headers>';
}

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
  const legacyKeys = anon.role === 'anon' || service.role === 'service_role';
  checks.push({
    name: 'Configuration',
    verdict: !env.configured || !anonOk || !serviceOk ? 'fail' : legacyKeys ? 'warn' : 'ok',
    summary: !env.configured
      ? 'Supabase is not configured — the portal has no database.'
      : legacyKeys
        ? 'Keys are set, but at least one is a legacy JWT key.'
        : 'Supabase URL and keys are set.',
    detail: [
      `NEXT_PUBLIC_SUPABASE_URL      ${env.supabaseUrl || 'not set'}`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY ${anon.shape}${anon.role ? `, role "${anon.role}"` : ''}`,
      `SUPABASE_SERVICE_ROLE_KEY     ${service.shape}${service.role ? `, role "${service.role}"` : ''}`,
      `scorer URL                    ${url}`,
    ].join('\n'),
    fix: !serviceOk
      ? 'SUPABASE_SERVICE_ROLE_KEY must be the secret / service_role key, not the publishable one.'
      : legacyKeys
        ? 'Legacy keys still work for the database, but a project whose function gateway has moved ' +
          'to the new key system will refuse them — and only submitting breaks, which makes it look ' +
          'like a scorer fault. If the checks below fail, replace them with the sb_publishable_… and ' +
          'sb_secret_… keys from Project Settings → API Keys.'
        : undefined,
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
    // Distinguished from "no CORS headers" deliberately. Both leave allowOrigin
    // empty, and the advice for each is the opposite of the other's.
    const crashed = res.status >= 500;
    checks.push({
      name: 'Deployed',
      verdict: deployed && !crashed && allowOrigin ? 'ok' : 'fail',
      summary: !deployed
        ? 'The score function is not deployed.'
        : crashed
          ? 'The function is deployed but crashes before it can answer.'
          : allowOrigin
            ? 'The function answers preflight requests.'
            : 'The function answered, but sent no CORS headers — a browser will refuse to use it.',
      detail: [
        `OPTIONS ${url}`,
        `status ${res.status}`,
        `access-control-allow-origin  ${allowOrigin ?? '<none>'}`,
        `access-control-allow-headers ${allowHeaders ?? '<none>'}`,
      ].join('\n'),
      fix: !deployed ? NOT_DEPLOYED_FIX : crashed ? BOOT_ERROR_FIX : undefined,
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
        apikey: env.supabaseAnonKey,
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
        'platform-401': 'Something above the function refused, without saying why.',
        'not-deployed': 'Nothing is deployed at this path.',
        unexpected: `Unexpected reply (${res.status}).`,
      }[kind],
      detail:
        `POST ${url}\nAuthorization: Bearer <anon key>\n\n` +
        `status ${res.status}\n${describeHeaders(res)}\n\n${body}`,
      fix: TEMPLATE_FN.test(body)
        ? TEMPLATE_FIX
        : body.includes(NEW_KEYS_ONLY)
          ? NEW_KEYS_FIX
          : kind === 'gateway-401'
          ? GATEWAY_FIX
          : kind === 'platform-401'
            ? PLATFORM_401_FIX
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
          apikey: env.supabaseAnonKey,
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
              'platform-401': 'Something above the function refused your token, without saying why.',
              'function-401': 'The function itself refused your token.',
              reached: TEMPLATE_FN.test(body)
                ? 'A different function is deployed under the name `score`.'
                : `The function ran but replied ${res.status}.`,
              unexpected: `Unexpected reply (${res.status}).`,
            }[kind],
        detail:
          `POST ${url}\nAuthorization: Bearer <your access token>\n` +
          `body {"attemptId":"00000000-…-000000000000","stepId":"health-check","response":{}}\n\n` +
          `status ${res.status}\n${describeHeaders(res)}\n\n${body}`,
        fix: worked
          ? undefined
          : TEMPLATE_FN.test(body)
            ? TEMPLATE_FIX
            : body.includes(NEW_KEYS_ONLY)
              ? NEW_KEYS_FIX
            : kind === 'not-deployed'
              ? NOT_DEPLOYED_FIX
              : kind === 'gateway-401'
                ? GATEWAY_FIX
                : kind === 'platform-401'
                  ? PLATFORM_401_FIX
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
