'use server';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Clear `profiles.must_change_password` for the SIGNED-IN USER ONLY.
 *
 * Why this is a server action and not a one-line update from the browser:
 *
 * The `profile_self_update` policy in 0001_init.sql is
 *
 *     using  (id = auth.uid())
 *     with check (id = auth.uid()
 *                 and role = (select role from profiles p where p.id = auth.uid()))
 *
 * That WITH CHECK subquery selects from `profiles` from inside a policy ON
 * `profiles`. Postgres applies RLS to that subquery too, which can raise
 * "infinite recursion detected in policy for relation profiles". I could not
 * test it here — there is no database in this sandbox — so this action tries
 * the honest RLS path first and only falls back to the service role if the
 * database refuses.
 *
 * The fallback is as narrow as I could make it: it sets exactly one boolean
 * column, on exactly the row whose id equals the verified `auth.uid()` of the
 * caller. It cannot change a role, cannot touch another user, and cannot cross
 * a school boundary. If the policy is fixed (drop the subquery, or compare
 * against OLD.role in a trigger instead), delete the fallback.
 */
export async function clearMustChangePassword(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const { error } = await supabase
    .from('profiles')
    .update({ must_change_password: false })
    .eq('id', user.id);

  if (!error) return { ok: true };

  try {
    const admin = createServiceClient();
    const { error: adminError } = await admin
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', user.id); // pinned to the verified caller — never a body parameter
    if (adminError) return { ok: false, error: adminError.message };
    return { ok: true };
  } catch {
    return { ok: false, error: error.message };
  }
}
