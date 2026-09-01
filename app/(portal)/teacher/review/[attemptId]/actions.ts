'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession, isStaff } from '@/lib/session';

/* ---------------------------------------------------------------------------
 * Saving and releasing a review.
 *
 * `reviews` is a separate table from `attempts` precisely so that a teacher's
 * mark and the auto-mark never overwrite each other: `attempts.auto_score` is
 * what the scorer produced and stays as it was, `reviews.score` is what the
 * teacher decided, and the student sees the teacher's number only once
 * `released_at` is set.
 *
 * All of this runs through the teacher's own session — `review_staff_all` and
 * `attempt_staff_update` are the real authorisation.
 * ------------------------------------------------------------------------ */

export interface ReviewInput {
  attemptId: string;
  score: string;
  feedback: string;
  /** step_id → per-step comment and mark. */
  rubric: Record<string, { score?: number | null; comment?: string }>;
  release: boolean;
}

export async function saveReview(input: ReviewInput): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session || !isStaff(session.profile)) return { ok: false, error: 'Teachers only.' };

  const supabase = await createClient();

  // school_id must come from the attempt, not from the caller's guess, so a
  // review can never be filed against another school's attempt. The staff
  // policy then requires it to equal current_school_id() anyway.
  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, school_id, status')
    .eq('id', input.attemptId)
    .maybeSingle();
  if (!attempt) return { ok: false, error: 'That attempt is not available to you.' };

  let score: number | null = null;
  const raw = input.score.trim();
  if (raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: 'The mark has to be a number of 0 or more, or blank.' };
    }
    score = n;
  }

  // Drop empty rubric entries so a blank comment box does not persist noise.
  const rubric: Record<string, { score?: number | null; comment?: string }> = {};
  for (const [stepId, entry] of Object.entries(input.rubric ?? {})) {
    const comment = (entry.comment ?? '').trim();
    const hasScore = entry.score !== null && entry.score !== undefined && !Number.isNaN(entry.score);
    if (comment || hasScore) {
      rubric[stepId] = {
        ...(hasScore ? { score: entry.score } : {}),
        ...(comment ? { comment } : {}),
      };
    }
  }

  const { error } = await supabase.from('reviews').upsert(
    {
      school_id: attempt.school_id as string,
      attempt_id: input.attemptId,
      reviewer_id: session.profile.id,
      score,
      feedback: input.feedback.trim() || null,
      rubric: Object.keys(rubric).length ? rubric : null,
      released_at: input.release ? new Date().toISOString() : null,
    },
    { onConflict: 'attempt_id' },
  );
  if (error) return { ok: false, error: error.message };

  // Releasing is also what moves the attempt out of the queue. Saving without
  // releasing leaves it in the queue, which is right — a half-written review is
  // not a finished one.
  if (input.release && attempt.status === 'submitted') {
    const { error: statusError } = await supabase
      .from('attempts')
      .update({ status: 'reviewed' })
      .eq('id', input.attemptId);
    if (statusError) {
      return {
        ok: false,
        error: `The review was saved and released, but the attempt is still showing as unmarked: ${statusError.message}`,
      };
    }
  }

  revalidatePath('/teacher/review');
  revalidatePath(`/teacher/review/${input.attemptId}`);
  return { ok: true };
}

/** Pull a released review back out of the student's view. */
export async function unreleaseReview(attemptId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session || !isStaff(session.profile)) return { ok: false, error: 'Teachers only.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('reviews')
    .update({ released_at: null })
    .eq('attempt_id', attemptId);
  if (error) return { ok: false, error: error.message };

  await supabase.from('attempts').update({ status: 'submitted' }).eq('id', attemptId);

  revalidatePath('/teacher/review');
  revalidatePath(`/teacher/review/${attemptId}`);
  return { ok: true };
}
