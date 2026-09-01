import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireStaffSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { getAssignment, getRunnerEntryUrls } from '@/lib/queries';
import { formatDateTime, formatScore, percent } from '@/lib/format';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  Page,
  PageHeader,
  Stat,
} from '@/components/ui';
import { StepReview } from '@/components/step-review';
import type { ActivityStep, Attempt, Profile, Review, StepScore } from '@/lib/types';
import { ReviewForm } from './review-form';

export const metadata: Metadata = { title: 'Mark an attempt' };
export const dynamic = 'force-dynamic';

export default async function ReviewAttemptPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  await requireStaffSession();
  const supabase = await createClient();

  const { data: attemptRow } = await supabase
    .from('attempts')
    .select('*')
    .eq('id', attemptId)
    .maybeSingle();
  if (!attemptRow) notFound();
  const attempt = attemptRow as Attempt;

  const [assignment, runnerUrls] = await Promise.all([
    getAssignment(attempt.assignment_id),
    getRunnerEntryUrls(),
  ]);
  if (!assignment) notFound();

  const [{ data: studentRow }, { data: reviewRow }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', attempt.profile_id).maybeSingle(),
    supabase.from('reviews').select('*').eq('attempt_id', attempt.id).maybeSingle(),
  ]);
  const student = (studentRow as Profile | null) ?? null;
  const review = (reviewRow as Review | null) ?? null;

  const steps = (Array.isArray(assignment.activity.steps) ? assignment.activity.steps : []) as ActivityStep[];
  const stepScores = (attempt.step_scores ?? {}) as Record<string, StepScore>;
  const pct = percent(attempt.auto_score, attempt.max_score);
  const late = Object.values(stepScores).some((s) => s?.late);

  return (
    <Page wide>
      <PageHeader
        title={student?.display_name ?? 'Unknown student'}
        subtitle={
          <>
            {assignment.activity.title}
            {attempt.attempt_no > 1 && ` · attempt ${attempt.attempt_no}`}
            {attempt.submitted_at && ` · handed up ${formatDateTime(attempt.submitted_at)}`}
          </>
        }
        back={{ href: '/teacher/review', label: 'Review queue' }}
        actions={
          <ButtonLink href={`/results/${attempt.id}`} variant="quiet">
            See it as the student does
          </ButtonLink>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {late && <Badge tone="danger">Handed up late</Badge>}
        {review?.released_at ? (
          <Badge tone="accent">Released {formatDateTime(review.released_at)}</Badge>
        ) : (
          <Badge tone="warn">Not released</Badge>
        )}
        {assignment.mode === 'practice' && <Badge>Practice</Badge>}
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Auto-marked"
          value={
            <>
              {formatScore(attempt.auto_score)}
              <span className="text-[17px] font-normal text-muted">
                {' '}
                / {formatScore(attempt.max_score)}
              </span>
            </>
          }
          sub={pct === null ? 'Not scored' : `${pct}%`}
        />
        <Stat
          label="Your mark"
          value={review?.score !== null && review?.score !== undefined ? formatScore(review.score) : '—'}
          sub={review?.released_at ? 'Released' : 'Not released'}
        />
        <Stat
          label="Steps answered"
          value={`${Object.keys(attempt.step_responses ?? {}).length} / ${steps.length}`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <Card>
          <CardBody>
            <h2 className="mb-3 text-[19px] font-semibold">Their work</h2>
            {/* Rendered by the runner in `review` mode with the response and the
                marking — so this page needs to know nothing about MCQs, number
                bases or Parsons lines. */}
            <StepReview
              steps={steps}
              runnerUrls={runnerUrls}
              sharedContext={(assignment.activity.shared_context ?? {}) as Record<string, unknown>}
              seed={attempt.seed}
              responses={(attempt.step_responses ?? {}) as Record<string, unknown>}
              scores={stepScores}
              showScores
              rubric={review?.rubric ?? null}
            />
          </CardBody>
        </Card>

        <ReviewForm
          attemptId={attempt.id}
          steps={steps}
          stepScores={stepScores}
          autoScore={attempt.auto_score}
          maxScore={attempt.max_score}
          existing={
            review
              ? {
                  score: review.score,
                  feedback: review.feedback,
                  rubric: review.rubric,
                  released_at: review.released_at,
                }
              : null
          }
        />
      </div>
    </Page>
  );
}
