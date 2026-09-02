/* ---------------------------------------------------------------------------
 * Environment access, in one place.
 *
 * The NEXT_PUBLIC_ values must be referenced as literal `process.env.NEXT_PUBLIC_X`
 * expressions so Next can inline them into the client bundle at build time —
 * dynamic lookup (process.env[name]) does not work in the browser.
 * ------------------------------------------------------------------------ */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * The school this deployment belongs to. Students type a bare username and we
 * append `@<slug>.portal.invalid`. See lib/auth-identity.ts.
 */
const schoolSlug = process.env.NEXT_PUBLIC_SCHOOL_SLUG ?? '';

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  schoolSlug,
  /** URL of the score Edge Function. Derived, never configured separately. */
  scoreFunctionUrl: `${supabaseUrl}/functions/v1/score`,
  configured: Boolean(supabaseUrl && supabaseAnonKey),
};

/**
 * Server-only. Reading this from a Client Component is impossible (Next does
 * not inline non-NEXT_PUBLIC vars), but throw loudly anyway if it is missing so
 * the failure is "the admin route is not configured" rather than a 500 from
 * deep inside supabase-js.
 */
export function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Account admin and activity import ' +
        'need it; add it to the deployment environment (server-side only).',
    );
  }
  const wrong = wrongKeyKind(key);
  if (wrong) {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY is set to ${wrong}, not the service role key. ` +
        'Both keys are long strings from the same dashboard page, so they are ' +
        'easy to swap — and a publishable key does not fail loudly, it just ' +
        'returns no rows, because row-level security applies to it. Take the ' +
        'secret / service_role key from Project Settings → API Keys.',
    );
  }
  return key;
}

/**
 * Name the key we were given, if it is obviously the wrong one.
 *
 * This is a shape check, not an authorisation check — it cannot tell a valid
 * service key from a revoked one. It exists because pasting the publishable key
 * here is the single easiest mistake to make, and its symptom is silence:
 * every service-role query comes back with zero rows and the app reports
 * something misleading and distant, like "your profile has no school".
 */
function wrongKeyKind(key: string): string | null {
  if (key.startsWith('sb_publishable_')) return 'a publishable key';
  if (key === supabaseAnonKey) return 'the same value as the anon key';

  // Legacy keys are unsigned-readable JWTs carrying { "role": "anon" | "service_role" }.
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  let role: unknown;
  try {
    role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role;
  } catch {
    return null; // not a JWT we can read; let Supabase be the judge
  }
  if (typeof role === 'string' && role !== 'service_role') return `a "${role}" key`;
  return null;
}
