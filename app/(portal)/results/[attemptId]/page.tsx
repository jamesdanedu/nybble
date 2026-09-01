import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireStudentOrStaff, isStaff } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { getAssignment, getRunnerEntryUrls } from '@/lib/queries';
import {
  feedbackVisible,
  formatDateTime,
  formatScore,
  percent,
} from '@/lib/format';
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  Page,
  PageHeader,
  Stat,
} from '@/components/ui';
import { StepReview } from '@/components/step-review';
import type { ActivityStep, Attempt, Review, StepScore } from '@/lib/types';

export const metadata: Metadata = { title: 'Results' };
export const dynamic = 'force-dynamic';

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const { profile } = await requireStudentOrStaff();
  const supabase = await createClient();

  // attempt_own_read / attempt_staff_read decide whether this returns a row.
  const { data: attemptRow } = await supabase
    .from('attempts')
    .select('*')
    .eq('id', attemptId)
    .maybeSingle();
  if (!attemptRow) notFound();
  const attempt = attemptRow as Attempt;

  const assignment = await getAssignment(attempt.assignment_id);
  if (!assignment) notFound();

  // review_student_read only returns released reviews to a student, so for a
  // student a row here always means "released". Staff see it either way, hence
  // the explicit released_at check below.
  const { data: reviewRow } = await supabase
    .from('reviews')
    .select('*')
    .eq('attempt_id', attempt.id)
    .maybeSingle();
  const review = (reviewRow as Review | null) ?? null;

  const viewingOwn = attempt.profile_id === profile.id;
  const staff = isStaff(profile);

  // Feedback rule: practice, or immediate, or a teacher pressed Release.
  // Staff looking at somebody else's attempt always see everything.
  const released = !!review?.released_at;
  const visible = (staff && !viewingOwn) || feedbackVisible(assignment, review);

  const steps = (Array.isArray(assignment.activity.steps) ? assignment.activity.steps : []) as ActivityStep[];
  const runnerUrls = await getRunnerEntryUrls();
  const scores = (attempt.step_scores ?? {}) as Record<string, StepScore>;

  const teacherScore = released ? review?.score ?? null : null;
  const shownScore = teacherScore ?? (visible ? attempt.auto_score : null);
  const shownMax = attempt.max_score ?? assignment.activity.max_score ?? null;
  const pct = percent(shownScore, shownMax);

  return (
    <Page>
      <PageHeader
        title={assignment.activity.title}
        subtitle={
          <>
            {assignment.activity.topic && <>{assignment.activity.topic} · </>}
            Attempt {attempt.attempt_no}
            {attempt.submitted_at && <> · handed up {formatDateTime(attempt.submitted_at)}</>}
          </>
        }
        back={{ href: '/dashboard', label: 'My work' }}
        actions={
          staff && !viewingOwn ? (
            <ButtonLink href={`/teacher/review/${attempt.id}`} variant="primary">
              Mark this
            </ButtonLink>
          ) : undefined
        }
      />

      {attempt.status === 'in_progress' && (
        <div className="mb-5">
          <Alert tone="warn" title="Not handed up yet">
            This attempt is still open.{' '}
            {viewingOwn && (
              <ButtonLink href={`/attempt/${assignment.id}`} variant="quiet">
                Go back to it
              </ButtonLink>
            )}
          </Alert>
        </div>
      )}

      {!visible && attempt.status !== 'in_progress' && (
        <div className="mb-5">
          <Alert tone="info" title="Marked, not released">
            Your work has been recorded. Your teacher will release the marks and feedback when the
            whole class has finished. You can still see what you sent below.
          </Alert>
        </div>
      )}

      {visible && shownScore !== null && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Stat
            label={teacherScore !== null ? 'Teacher mark' : 'Score'}
            value={
              <>
                {formatScore(shownScore)}
                {shownMax !== null && (
                  <span className="text-[17px] font-normal text-muted"> / {formatScore(shownMax)}</span>
                )}
              </>
            }
            sub={pct !== null ? `${pct}%` : undefined}
          />
          {teacherScore !== null && attempt.auto_score !== null && (
            <Stat label="Auto-marked" value={formatScore(attempt.auto_score)} sub="Before review" />
          )}
          <Stat
            label="Steps"
            value={`${Object.keys(attempt.step_responses ?? {}).length} / ${steps.length}`}
            sub="Answered"
          />
        </div>
      )}

      {released && review?.feedback && (
        <div className="mb-5">
          <Card>
            <CardBody>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-[17px] font-semibold">Your teacher wrote</h2>
                <Badge tone="accent">Released</Badge>
              </div>
              <p className="whitespace-pre-wrap text-[16px] leading-relaxed">{review.feedback}</p>
            </CardBody>
          </Card>
        </div>
      )}

      <Card>
        <CardBody>
          <StepReview
            steps={steps}
            runnerUrls={runnerUrls}
            sharedContext={(assignment.activity.shared_context ?? {}) as Record<string, unknown>}
            seed={attempt.seed}
            responses={(attempt.step_responses ?? {}) as Record<string, unknown>}
            scores={scores}
            showScores={visible}
            rubric={released ? review?.rubric ?? null : null}
          />
        </CardBody>
      </Card>

      {viewingOwn && assignment.mode === 'practice' && (
        <div className="mt-5">
          <ButtonLink href={`/attempt/${assignment.id}`} variant="primary">
            Try it again
          </ButtonLink>
        </div>
      )}
    </Page>
  );
}
