import { createClient } from '@/lib/supabase/server';
import type {
  Activity,
  Assignment,
  Attempt,
  ClassGroup,
  Profile,
  Review,
} from '@/lib/types';

/* ---------------------------------------------------------------------------
 * Reads that more than one page needs. Everything here goes through the
 * request-scoped anon client, so RLS applies exactly as it would in a browser.
 *
 * Where a query duplicates something a policy already enforces, that is
 * deliberate: `assignment_staff_all` lets a teacher SELECT every assignment in
 * their school, which is right for the teacher screens and wrong for "My work".
 * The filters below narrow to what the page actually means, and the policy stays
 * as the backstop.
 * ------------------------------------------------------------------------ */

export type AssignmentWithActivity = Assignment & {
  activity: Pick<
    Activity,
    'id' | 'title' | 'topic' | 'description' | 'steps' | 'shared_context' | 'max_score'
  >;
};

export interface StudentAssignmentRow {
  assignment: AssignmentWithActivity;
  /** The most recent attempt, or null if they have never opened it. */
  attempt: Attempt | null;
  attemptCount: number;
  review: Review | null;
}

const ASSIGNMENT_SELECT = `
  id, school_id, activity_id, class_group_id, profile_id, assigned_by, mode,
  open_at, due_at, attempts_allowed, time_limit_secs, release_feedback, created_at,
  activity:activities!inner ( id, title, topic, description, steps, shared_context, max_score )
`;

/** Class group ids this profile belongs to. */
export async function myClassGroupIds(profileId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('class_members')
    .select('class_group_id')
    .eq('profile_id', profileId);
  return (data ?? []).map((r) => r.class_group_id as string);
}

/**
 * Everything on a student's dashboard, in three round trips.
 *
 * The visibility rule is duplicated from `can_see_assignment()`: aimed at me
 * individually, or at a class I am in, and already open. Duplicated because a
 * teacher's own "My work" page must not show them the whole school's
 * assignments, which their RLS policy would happily allow.
 */
export async function getStudentAssignments(profileId: string): Promise<StudentAssignmentRow[]> {
  const supabase = await createClient();
  const classIds = await myClassGroupIds(profileId);

  let q = supabase
    .from('assignments')
    .select(ASSIGNMENT_SELECT)
    .lte('open_at', new Date().toISOString());

  q = classIds.length
    ? q.or(`profile_id.eq.${profileId},class_group_id.in.(${classIds.join(',')})`)
    : q.eq('profile_id', profileId);

  const { data: assignments, error } = await q.order('due_at', {
    ascending: true,
    nullsFirst: false,
  });
  if (error) throw new Error(`Could not load your assignments: ${error.message}`);

  const rows = (assignments ?? []) as unknown as AssignmentWithActivity[];
  if (!rows.length) return [];

  const ids = rows.map((a) => a.id);

  const { data: attempts } = await supabase
    .from('attempts')
    .select('*')
    .eq('profile_id', profileId)
    .in('assignment_id', ids)
    .order('attempt_no', { ascending: false });

  const byAssignment = new Map<string, Attempt[]>();
  for (const a of (attempts ?? []) as Attempt[]) {
    const list = byAssignment.get(a.assignment_id) ?? [];
    list.push(a);
    byAssignment.set(a.assignment_id, list);
  }

  // `review_student_read` only returns rows with released_at set, so a student
  // physically cannot see an unreleased review. A teacher looking at their own
  // "My work" would see more, which is harmless.
  const attemptIds = (attempts ?? []).map((a) => a.id);
  let reviews: Review[] = [];
  if (attemptIds.length) {
    const { data } = await supabase.from('reviews').select('*').in('attempt_id', attemptIds);
    reviews = (data ?? []) as Review[];
  }
  const reviewByAttempt = new Map(reviews.map((r) => [r.attempt_id, r]));

  return rows.map((assignment) => {
    const list = byAssignment.get(assignment.id) ?? [];
    const latest = list[0] ?? null;
    return {
      assignment,
      attempt: latest,
      attemptCount: list.length,
      review: latest ? (reviewByAttempt.get(latest.id) ?? null) : null,
    };
  });
}

/** One assignment the current user is allowed to see, with its activity. */
export async function getAssignment(assignmentId: string): Promise<AssignmentWithActivity | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('assignments')
    .select(ASSIGNMENT_SELECT)
    .eq('id', assignmentId)
    .maybeSingle();
  return (data as unknown as AssignmentWithActivity) ?? null;
}

/** Runner entry URLs, keyed by runner id. Needed to build every iframe src. */
export async function getRunnerEntryUrls(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from('runners').select('id, entry_url, scorer');
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[r.id as string] = r.entry_url as string;
  return map;
}

export async function getRunners() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('runners')
    .select('id, name, version, entry_url, scorer, builtin, school_id')
    .order('name');
  return data ?? [];
}

/* --- teacher-side reads ------------------------------------------------- */

export async function getClasses(): Promise<(ClassGroup & { member_count: number })[]> {
  const supabase = await createClient();
  const { data: groups } = await supabase
    .from('class_groups')
    .select('*')
    .eq('archived', false)
    .order('name');

  const list = (groups ?? []) as ClassGroup[];
  if (!list.length) return [];

  // One extra round trip rather than a PostgREST aggregate, because the count
  // needs to respect `member_read` and an embedded count does not report
  // rows a policy filtered out.
  const { data: members } = await supabase
    .from('class_members')
    .select('class_group_id')
    .in('class_group_id', list.map((g) => g.id));

  const counts = new Map<string, number>();
  for (const m of members ?? []) {
    counts.set(m.class_group_id as string, (counts.get(m.class_group_id as string) ?? 0) + 1);
  }
  return list.map((g) => ({ ...g, member_count: counts.get(g.id) ?? 0 }));
}

export async function getClassWithMembers(classId: string) {
  const supabase = await createClient();
  const { data: group } = await supabase
    .from('class_groups')
    .select('*')
    .eq('id', classId)
    .maybeSingle<ClassGroup>();
  if (!group) return null;

  const { data: memberRows } = await supabase
    .from('class_members')
    .select('profile_id, added_at')
    .eq('class_group_id', classId);

  const ids = (memberRows ?? []).map((m) => m.profile_id as string);
  let members: Profile[] = [];
  if (ids.length) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .in('id', ids)
      .order('display_name');
    members = (data ?? []) as Profile[];
  }
  return { group, members };
}

export async function getActivities(): Promise<Activity[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('activities')
    .select('*')
    .eq('archived', false)
    .order('topic', { ascending: true, nullsFirst: false })
    .order('title');
  return (data ?? []) as Activity[];
}

/** Students in the school, for the individual-assignment picker. */
export async function getStudents(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'student')
    .eq('archived', false)
    .order('display_name');
  return (data ?? []) as Profile[];
}

export interface ReviewQueueRow {
  attempt: Attempt;
  student: Profile | null;
  assignment: AssignmentWithActivity | null;
  review: Review | null;
}

/**
 * The review queue: submitted attempts, oldest first, because the student who
 * has been waiting longest should be marked first.
 */
export async function getReviewQueue(limit = 100): Promise<ReviewQueueRow[]> {
  const supabase = await createClient();
  const { data: attempts } = await supabase
    .from('attempts')
    .select('*')
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  const list = (attempts ?? []) as Attempt[];
  if (!list.length) return [];

  const [{ data: students }, { data: assignments }, { data: reviews }] = await Promise.all([
    supabase.from('profiles').select('*').in('id', [...new Set(list.map((a) => a.profile_id))]),
    supabase
      .from('assignments')
      .select(ASSIGNMENT_SELECT)
      .in('id', [...new Set(list.map((a) => a.assignment_id))]),
    supabase.from('reviews').select('*').in('attempt_id', list.map((a) => a.id)),
  ]);

  const studentById = new Map((students ?? []).map((p) => [p.id as string, p as Profile]));
  const assignmentById = new Map(
    ((assignments ?? []) as unknown as AssignmentWithActivity[]).map((a) => [a.id, a]),
  );
  const reviewByAttempt = new Map(
    ((reviews ?? []) as Review[]).map((r) => [r.attempt_id, r]),
  );

  return list.map((attempt) => ({
    attempt,
    student: studentById.get(attempt.profile_id) ?? null,
    assignment: assignmentById.get(attempt.assignment_id) ?? null,
    review: reviewByAttempt.get(attempt.id) ?? null,
  }));
}
