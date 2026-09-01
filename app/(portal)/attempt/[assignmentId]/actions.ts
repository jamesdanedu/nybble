'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/session';

/**
 * Open a new attempt.
 *
 * Nothing here is trusted to the client beyond the assignment id: `profile_id`
 * comes from the verified session and `school_id` from that profile, and the
 * `attempt_own_insert` policy re-checks both against `can_see_assignment()`.
 *
 * `attempt_no` is computed here rather than defaulted, because the table has a
 * UNIQUE (assignment_id, profile_id, attempt_no). Two clicks on Start in quick
 * succession will therefore collide on the second insert rather than quietly
 * creating two attempt 1s — which is the behaviour we want; the second click
 * reports "already started" and the page reloads onto the existing attempt.
 */
export async function startAttempt(
  assignmentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Your session has expired. Sign in again.' };

  const supabase = await createClient();

  // Visible to me? The policy would refuse the insert anyway, but a clear
  // message beats a constraint violation.
  const { data: assignment } = await supabase
    .from('assignments')
    .select('id, open_at, attempts_allowed')
    .eq('id', assignmentId)
    .maybeSingle();
  if (!assignment) {
    return { ok: false, error: 'That assignment is not available to you.' };
  }
  if (new Date(assignment.open_at).getTime() > Date.now()) {
    return { ok: false, error: 'This assignment is not open yet.' };
  }

  const { data: existing } = await supabase
    .from('attempts')
    .select('id, attempt_no, status')
    .eq('assignment_id', assignmentId)
    .eq('profile_id', session.profile.id)
    .order('attempt_no', { ascending: false });

  const open = (existing ?? []).find((a) => a.status === 'in_progress');
  if (open) {
    revalidatePath(`/attempt/${assignmentId}`);
    return { ok: true }; // already have one — just carry on with it
  }

  const nextNo = ((existing ?? [])[0]?.attempt_no ?? 0) + 1;

  const { error } = await supabase.from('attempts').insert({
    school_id: session.profile.school_id,
    assignment_id: assignmentId,
    profile_id: session.profile.id,
    attempt_no: nextNo,
  });

  if (error) {
    // enforce_attempt_limit() raises with errcode check_violation.
    if (/attempt limit/i.test(error.message)) {
      return {
        ok: false,
        error:
          assignment.attempts_allowed === 1
            ? 'You have already had your one attempt at this.'
            : `You have used all ${assignment.attempts_allowed} attempts at this.`,
      };
    }
    if (error.code === '23505') {
      // Unique violation — a double click. The other insert won; use it.
      revalidatePath(`/attempt/${assignmentId}`);
      return { ok: true };
    }
    return { ok: false, error: `Could not start: ${error.message}` };
  }

  revalidatePath(`/attempt/${assignmentId}`);
  return { ok: true };
}
