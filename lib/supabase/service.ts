import 'server-only';

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, serviceRoleKey } from '@/lib/env';
import { createClient as createServerClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';

/**
 * A service-role client. This BYPASSES RLS COMPLETELY.
 *
 * `import 'server-only'` makes it a build error to pull this module into a
 * Client Component, so the key can never reach a browser bundle.
 *
 * There are exactly three legitimate users of it in this codebase:
 *
 *   1. Account admin — creating auth users and resetting passwords needs the
 *      admin API, which the anon key cannot reach.
 *   2. The activity importer — `activity_keys` has RLS enabled and no policies
 *      at all (by design), so not even a teacher can insert into it.
 *   3. Clearing `profiles.must_change_password` for the caller's own row, as a
 *      fallback when the self-update policy refuses it. See app/change-password.
 *
 * Every one of those is behind `requireStaff()` (or, for 3, the caller's own
 * id). Do not add a fourth without a very good reason.
 */
export function createServiceClient(): SupabaseClient {
  return createSupabaseClient(env.supabaseUrl, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface StaffContext {
  profile: Profile;
  /** The service client, already created — every staff-only route needs it. */
  admin: SupabaseClient;
}

export class NotStaffError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = 'NotStaffError';
    this.status = status;
  }
}

/**
 * The single gate in front of every service-role operation.
 *
 * The check is made with the CALLER'S OWN session (anon key, RLS on), so a
 * forged request cannot talk its way past it: `profile_self_read` only ever
 * returns the row belonging to auth.uid(). Only after the row comes back with
 * role teacher/admin — which is what the SQL function `is_staff()` tests — do
 * we hand out a service-role client.
 *
 * Everything written afterwards MUST be pinned to `profile.school_id`, because
 * the service role does not enforce the tenancy boundary for us.
 */
export async function requireStaff(): Promise<StaffContext> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotStaffError('Not signed in.', 401);

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single<Profile>();

  if (error || !profile) throw new NotStaffError('No profile for this account.', 403);
  if (profile.archived) throw new NotStaffError('This account is archived.', 403);
  if (profile.role !== 'teacher' && profile.role !== 'admin') {
    throw new NotStaffError('Teachers only.', 403);
  }

  return { profile, admin: createServiceClient() };
}
