'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession, isStaff } from '@/lib/session';
import type { AssignmentMode, FeedbackRule } from '@/lib/types';

const MODES: AssignmentMode[] = ['practice', 'graded'];
const RULES: FeedbackRule[] = ['immediate', 'on_review', 'manual'];

export interface AssignInput {
  activityId: string;
  target: { kind: 'class'; id: string } | { kind: 'student'; id: string };
  /** From a <input type="datetime-local">, i.e. wall-clock with no zone. */
  openAt: string;
  dueAt: string;
  mode: string;
  attemptsAllowed: string;
  timeLimitMins: string;
  releaseFeedback: string;
}

/**
 * `datetime-local` gives "2026-09-08T16:30" with no zone. `new Date(...)` on
 * the SERVER would read that as UTC, which is an hour out in Irish summer time
 * and would open assignments at the wrong moment. Interpreting it correctly
 * needs the school's zone, so the value is converted in the browser (where the
 * zone is known) and arrives here as a full ISO string. Anything that is not
 * parseable is rejected rather than guessed at.
 */
function parseIso(value: string, field: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`${field} is not a valid date.`);
  return d.toISOString();
}

export async function createAssignment(
  input: AssignInput,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const session = await getSession();
  if (!session || !isStaff(session.profile)) {
    return { ok: false, error: 'Teachers only.' };
  }
  const supabase = await createClient();

  if (!input.activityId) return { ok: false, error: 'Pick an activity.' };
  if (!input.target?.id) return { ok: false, error: 'Pick a class or a student.' };

  const mode = MODES.includes(input.mode as AssignmentMode)
    ? (input.mode as AssignmentMode)
    : 'graded';
  const releaseFeedback = RULES.includes(input.releaseFeedback as FeedbackRule)
    ? (input.releaseFeedback as FeedbackRule)
    : 'on_review';

  let openAt: string | null;
  let dueAt: string | null;
  try {
    openAt = parseIso(input.openAt, 'The open date');
    dueAt = parseIso(input.dueAt, 'The due date');
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (openAt && dueAt && new Date(dueAt) <= new Date(openAt)) {
    return { ok: false, error: 'The due date has to be after the open date.' };
  }

  const attempts = input.attemptsAllowed.trim();
  let attemptsAllowed: number | null = null;
  if (attempts) {
    const n = Number(attempts);
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, error: 'Attempts allowed must be a whole number of 1 or more, or blank for unlimited.' };
    }
    attemptsAllowed = n;
  }

  const mins = input.timeLimitMins.trim();
  let timeLimitSecs: number | null = null;
  if (mins) {
    const n = Number(mins);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, error: 'The time limit must be a positive number of minutes, or blank.' };
    }
    timeLimitSecs = Math.round(n * 60);
  }

  // `one_target` in the schema is num_nonnulls(class_group_id, profile_id) = 1,
  // so exactly one of these is set. Doing it here rather than relying on the
  // constraint gives a sentence instead of a Postgres error string.
  const { data, error } = await supabase
    .from('assignments')
    .insert({
      school_id: session.profile.school_id,
      activity_id: input.activityId,
      class_group_id: input.target.kind === 'class' ? input.target.id : null,
      profile_id: input.target.kind === 'student' ? input.target.id : null,
      assigned_by: session.profile.id,
      mode,
      open_at: openAt ?? new Date().toISOString(),
      due_at: dueAt,
      attempts_allowed: attemptsAllowed,
      time_limit_secs: timeLimitSecs,
      release_feedback: releaseFeedback,
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/teacher');
  revalidatePath('/teacher/assign');
  return { ok: true, id: data.id as string };
}

export async function deleteAssignment(id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session || !isStaff(session.profile)) return { ok: false, error: 'Teachers only.' };

  // Deleting an assignment cascades to its attempts. Only allow it while
  // nobody has started, so a mis-set assignment can be withdrawn but a term's
  // work cannot be deleted by accident.
  const supabase = await createClient();
  const { count } = await supabase
    .from('attempts')
    .select('id', { count: 'exact', head: true })
    .eq('assignment_id', id);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} student${count === 1 ? ' has' : 's have'} already started this. It cannot be withdrawn without deleting their work.`,
    };
  }

  const { error } = await supabase.from('assignments').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/teacher/assign');
  return { ok: true };
}
