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
  return key;
}
