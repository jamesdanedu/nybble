import type { Assignment, Attempt, Review, StepScore, StudentStatus } from '@/lib/types';

/* ---------------------------------------------------------------------------
 * Dates are formatted with an explicit locale AND an explicit time zone.
 *
 * Both are required, not cosmetic. A Server Component renders on a machine in
 * UTC and the browser re-renders in Europe/Dublin; without pinning both, every
 * date in the app is a hydration mismatch, and around 01:00 on the last Sunday
 * in March it is also wrong. This is a school in Ireland, so Europe/Dublin is
 * the right answer — change TZ here if that ever stops being true.
 * ------------------------------------------------------------------------ */
const TZ = 'Europe/Dublin';
const LOCALE = 'en-IE';

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/** `datetime-local` input value for an ISO timestamp, in the school's zone. */
export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * "in 3 days" / "2 hours ago". Coarse on purpose: a student needs to know
 * whether something is due today, not to the minute.
 */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const diffMs = new Date(iso).getTime() - now;
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
  if (abs < HOUR) return rtf.format(Math.round(diffMs / MIN), 'minute');
  if (abs < DAY) return rtf.format(Math.round(diffMs / HOUR), 'hour');
  if (abs < 30 * DAY) return rtf.format(Math.round(diffMs / DAY), 'day');
  return rtf.format(Math.round(diffMs / (30 * DAY)), 'month');
}

export function isOverdue(dueAt: string | null | undefined, now = Date.now()): boolean {
  return !!dueAt && new Date(dueAt).getTime() < now;
}

/* --- score display ------------------------------------------------------ */

/** 7.5 → "7.5", 8.00 → "8". Numeric(8,2) comes back from PostgREST as a string. */
export function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatScore(score: number | string | null | undefined): string {
  const n = num(score);
  if (n === null) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

export function percent(score: number | string | null | undefined, max: number | string | null | undefined): number | null {
  const s = num(score);
  const m = num(max);
  if (s === null || m === null || m === 0) return null;
  return Math.round((s / m) * 100);
}

/* --- marks still with a human -------------------------------------------- */

/** What a machine has marked so far, and what is still waiting on a person. */
export interface MarkSplit {
  /** Marks already awarded automatically. Null until the attempt is complete. */
  awarded: number | null;
  /** What `awarded` is out of. Excludes anything a human still has to mark. */
  autoMax: number;
  /** Marks waiting on a teacher. */
  pendingMax: number;
  /** How many steps those marks are spread across. */
  pendingSteps: number;
}

/**
 * Separate the marks a machine awarded from the marks a person still owes.
 *
 * Without this, an activity that mixes auto- and hand-marked steps reads as a
 * fail until it is reviewed. The scorer records `{ total: null, max: weight }`
 * for a hand-marked step, and the attempt's `auto_score` sums only the numbers
 * while `max_score` sums every maximum — so a student who did everything right
 * sees 5 / 15 for however long the marking takes, which is three weeks in
 * February and looks exactly like failing.
 *
 * The numbers in the database are correct and are deliberately left alone:
 * `auto_score` is what the scorer produced, and `reviews` is a separate table
 * precisely so the two never overwrite each other. This is a display split.
 *
 * A hand-marked step worth nothing (PRIMM's Run step: read it, run it, look at
 * the output) is not counted as pending — there is no mark coming for it, and
 * saying "1 step with your teacher, 0 marks" would be noise.
 */
export function splitMarks(
  autoScore: number | null,
  stepScores: Record<string, StepScore> | null | undefined,
): MarkSplit {
  let autoMax = 0;
  let pendingMax = 0;
  let pendingSteps = 0;

  for (const score of Object.values(stepScores ?? {})) {
    const max = typeof score?.max === 'number' ? score.max : 0;
    const waitingOnAHuman = score?.manual === true || score?.total === null;
    if (waitingOnAHuman) {
      if (max > 0) {
        pendingMax += max;
        pendingSteps += 1;
      }
    } else {
      autoMax += max;
    }
  }

  return { awarded: autoScore, autoMax, pendingMax, pendingSteps };
}

/** "3 marks" / "1 mark" — used either side of the split above. */
export function markCount(n: number): string {
  return `${formatScore(n)} mark${n === 1 ? '' : 's'}`;
}

/* --- status ------------------------------------------------------------- */

/**
 * The status a student sees for one assignment. `marked` means a number they
 * are actually allowed to look at exists — either the auto-score with feedback
 * released, or a teacher review that has been released.
 */
export function studentStatus(
  attempt: Pick<Attempt, 'status' | 'auto_score'> | null | undefined,
  released: boolean,
): StudentStatus {
  if (!attempt) return 'not_started';
  if (attempt.status === 'in_progress') return 'in_progress';
  if (released) return 'marked';
  return attempt.status === 'reviewed' ? 'marked' : 'submitted';
}

export const STATUS_LABEL: Record<StudentStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  submitted: 'Submitted',
  marked: 'Marked',
};

export const STATUS_TONE: Record<StudentStatus, 'neutral' | 'accent' | 'warn'> = {
  not_started: 'neutral',
  in_progress: 'warn',
  submitted: 'neutral',
  marked: 'accent',
};

/**
 * May this student see per-step marks and explanations for this attempt?
 *
 * Three ways in, and they mirror what the score Edge Function is prepared to
 * hand back:
 *   - practice mode: formative, always visible
 *   - release_feedback = 'immediate': visible as soon as it is marked
 *   - a review row exists with released_at set: the teacher pressed Release
 *
 * `release_feedback = 'on_review'` and `'manual'` both mean "not until a human
 * says so", which is the released_at case.
 */
export function feedbackVisible(
  assignment: Pick<Assignment, 'mode' | 'release_feedback'>,
  review: Pick<Review, 'released_at'> | null | undefined,
): boolean {
  if (assignment.mode === 'practice') return true;
  if (assignment.release_feedback === 'immediate') return true;
  return !!review?.released_at;
}
