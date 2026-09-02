import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { env } from '@/lib/env';

export interface SchoolChoice {
  id: string;
  name: string;
  slug: string;
}

/**
 * The schools this deployment serves, for the sign-in screen.
 *
 * Read with the service role deliberately. `school_read` is
 * `id = current_school_id()`, which needs a signed-in user — and the whole point
 * here is to help someone who is not signed in yet. The alternative was a public
 * policy on `schools`, which would be a new anonymous-readable surface for the
 * sake of one screen. Slugs are not secret (the security boundary is RLS on
 * school_id, not knowledge of the slug), but "not secret" is not a reason to
 * publish a table.
 *
 * Returns [] rather than throwing when the service role key is absent, so a
 * half-configured deployment still renders a login form instead of a stack
 * trace. The caller falls back to NEXT_PUBLIC_SCHOOL_SLUG.
 */
export async function listSchools(): Promise<SchoolChoice[]> {
  if (!env.configured) return [];
  try {
    const admin = createServiceClient();
    const { data, error } = await admin
      .from('schools')
      .select('id, name, slug')
      .order('name');
    if (error) {
      // Not fatal — the login form still renders off the environment fallback —
      // but silence here is how a bad service key stays hidden until somebody
      // tries to add a student. Leave a trail in the deployment logs.
      console.error('listSchools: could not read schools with the admin key:', error.message);
      return [];
    }
    return (data ?? []) as SchoolChoice[];
  } catch (e) {
    // serviceRoleKey() throws when unset or obviously the wrong key.
    console.error('listSchools:', e instanceof Error ? e.message : e);
    return [];
  }
}

export interface ResolvedSchool {
  /** The slug to append to a bare username, or '' if we cannot tell. */
  slug: string;
  /** Human label for the sign-in screen, when we know it. */
  label: string;
  /** Offer a picker: more than one school and no explicit choice. */
  choices: SchoolChoice[];
  /** Where the slug came from, so the UI can explain itself. */
  source: 'query' | 'database' | 'environment' | 'none';
}

/**
 * Decide which school a bare username belongs to.
 *
 * Precedence, and the reasoning for it:
 *
 *   1. `?school=` — an explicit request beats everything.
 *   2. Exactly one school in the database — then that IS the answer, and an
 *      environment variable saying otherwise is a mistake rather than an
 *      intention. This is the case that used to go wrong: the deployment was
 *      built with one slug while the school row carried another, and nothing
 *      said so until a student could not sign in.
 *   3. Several schools — no default unless the environment names one of them;
 *      otherwise the caller shows a picker.
 *   4. Nothing readable — fall back to the environment variable, which is all a
 *      deployment without a service role key has.
 */
export async function resolveSchoolForLogin(requested?: string): Promise<ResolvedSchool> {
  const schools = await listSchools();
  const asked = (requested ?? '').trim().toLowerCase();

  if (asked) {
    const match = schools.find((s) => s.slug === asked);
    return { slug: asked, label: match?.name ?? asked, choices: [], source: 'query' };
  }

  if (schools.length === 1) {
    return { slug: schools[0].slug, label: schools[0].name, choices: [], source: 'database' };
  }

  if (schools.length > 1) {
    const named = env.schoolSlug ? schools.find((s) => s.slug === env.schoolSlug) : undefined;
    if (named) {
      return { slug: named.slug, label: named.name, choices: schools, source: 'environment' };
    }
    return { slug: '', label: '', choices: schools, source: 'none' };
  }

  const fallback = (env.schoolSlug ?? '').trim().toLowerCase();
  return {
    slug: fallback,
    label: fallback,
    choices: [],
    source: fallback ? 'environment' : 'none',
  };
}
