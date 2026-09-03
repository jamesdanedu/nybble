/* ---------------------------------------------------------------------------
 * Hand-written types that mirror supabase/migrations/0001_init.sql.
 *
 * They are hand-written rather than generated because there is no database
 * reachable from CI. If you ever run `supabase gen types typescript`, replace
 * this file wholesale — but keep the shapes below in sync with the migration
 * until you do, because everything in lib/queries.ts is typed against them.
 * ------------------------------------------------------------------------ */

export type UserRole = 'student' | 'teacher' | 'admin';
export type ActivityVis = 'private' | 'school' | 'public';
export type AssignmentMode = 'practice' | 'graded';
export type FeedbackRule = 'immediate' | 'on_review' | 'manual';
export type AttemptStatus = 'in_progress' | 'submitted' | 'reviewed';
export type ScorerKind = 'server' | 'client' | 'manual';

export interface School {
  id: string;
  name: string;
  slug: string;
  /**
   * The Department of Education roll number, once an admin has linked this
   * school to its entry in `school_directory`. Null until they do, and null
   * for every school that existed before 0009 added the column.
   */
  roll_number: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  school_id: string;
  role: UserRole;
  username: string;
  display_name: string;
  must_change_password: boolean;
  archived: boolean;
  created_at: string;
}

export interface ClassGroup {
  id: string;
  school_id: string;
  name: string;
  year_label: string | null;
  teacher_id: string | null;
  archived: boolean;
  created_at: string;
}

export interface ClassMember {
  class_group_id: string;
  profile_id: string;
  added_at: string;
}

export interface Runner {
  id: string;
  name: string;
  version: string;
  entry_url: string;
  scorer: ScorerKind;
  config_schema: unknown | null;
  builtin: boolean;
  school_id: string | null;
  created_at: string;
}

/**
 * One step of an activity as it is stored in `activities.steps`.
 *
 * NOTE THE ABSENCE OF `key`. The authoring file format (docs/activity-format.md)
 * carries a `key` alongside `config` for each step; the importer strips it out
 * and writes it to `activity_keys`. If a `key` ever appears in this type, the
 * split has been broken and answer keys are being shipped to browsers.
 */
export interface ActivityStep {
  id: string;
  runner_id: string;
  title?: string;
  weight?: number;
  config: Record<string, unknown>;
}

export interface Activity {
  id: string;
  school_id: string;
  owner_id: string;
  title: string;
  topic: string | null;
  description: string | null;
  steps: ActivityStep[];
  shared_context: Record<string, unknown>;
  max_score: number | null;
  visibility: ActivityVis;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Assignment {
  id: string;
  school_id: string;
  activity_id: string;
  class_group_id: string | null;
  profile_id: string | null;
  assigned_by: string;
  mode: AssignmentMode;
  open_at: string;
  due_at: string | null;
  attempts_allowed: number | null;
  time_limit_secs: number | null;
  release_feedback: FeedbackRule;
  created_at: string;
}

/** What the scorer writes into attempts.step_scores[stepId]. */
export interface StepScore {
  total: number | null;
  max: number | null;
  manual?: boolean;
  /** Marked from the runner's own report, in practice mode only. */
  client?: boolean;
  /**
   * The mark came from the student's browser and this server did not check it.
   * Always shown to a teacher alongside the number — see `scoreFromClient` in
   * the score Edge Function for why such a number is allowed to exist at all.
   */
  unverified?: boolean;
  /** A weight-0 step, such as PRIMM's Run: recorded, nothing to mark. */
  nothingToMark?: boolean;
  late?: boolean;
  scoredAt?: string;
  perQuestion?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface Attempt {
  id: string;
  school_id: string;
  assignment_id: string;
  profile_id: string;
  attempt_no: number;
  status: AttemptStatus;
  seed: number;
  step_state: Record<string, unknown>;
  step_responses: Record<string, unknown>;
  step_scores: Record<string, StepScore>;
  auto_score: number | null;
  max_score: number | null;
  started_at: string;
  submitted_at: string | null;
}

export interface Review {
  id: string;
  school_id: string;
  attempt_id: string;
  reviewer_id: string;
  score: number | null;
  feedback: string | null;
  rubric: Record<string, { score?: number | null; comment?: string }> | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Derived, UI-facing status for one assignment as it appears to a student. */
export type StudentStatus =
  | 'not_started'
  | 'in_progress'
  | 'submitted'
  | 'marked';
