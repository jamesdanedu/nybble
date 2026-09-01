import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireStudentOrStaff } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { getAssignment, getRunnerEntryUrls } from '@/lib/queries';
import { formatDateTime, isOverdue, relativeTime } from '@/lib/format';
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  Page,
  PageHeader,
} from '@/components/ui';
import type { ActivityStep, Attempt } from '@/lib/types';
import { AttemptClient } from './attempt-client';
import { StartAttempt } from './start-attempt';

export const metadata: Metadata = { title: 'Activity' };
export const dynamic = 'force-dynamic';

export default async function AttemptPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const { profile } = await requireStudentOrStaff();

  const assignment = await getAssignment(assignmentId);
  if (!assignment) notFound();

  const supabase = await createClient();
  const { data: attemptRows } = await supabase
    .from('attempts')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('profile_id', profile.id)
    .order('attempt_no', { ascending: false });

  const attempts = (attemptRows ?? []) as Attempt[];
  const open = attempts.find((a) => a.status === 'in_progress') ?? null;
  const steps = (Array.isArray(assignment.activity.steps) ? assignment.activity.steps : []) as ActivityStep[];

  const notOpenYet = new Date(assignment.open_at).getTime() > Date.now();
  const overdue = isOverdue(assignment.due_at);
  const attemptsUsed = attempts.length;
  const outOfAttempts =
    assignment.attempts_allowed !== null && attemptsUsed >= assignment.attempts_allowed;

  /* --- in progress: hand over to the runner ------------------------------ */
  if (open && !notOpenYet) {
    const runnerUrls = await getRunnerEntryUrls();
    return (
      <Page>
        <PageHeader
          title={assignment.activity.title}
          subtitle={
            <>
              {assignment.activity.topic && <>{assignment.activity.topic} · </>}
              {assignment.due_at
                ? `Due ${formatDateTime(assignment.due_at)}`
                : 'No due date'}
              {overdue && ' · handed up late'}
            </>
          }
          back={{ href: '/dashboard', label: 'My work' }}
        />
        <AttemptClient
          assignment={{
            id: assignment.id,
            mode: assignment.mode,
            due_at: assignment.due_at,
            release_feedback: assignment.release_feedback,
            time_limit_secs: assignment.time_limit_secs,
          }}
          activityTitle={assignment.activity.title}
          sharedContext={(assignment.activity.shared_context ?? {}) as Record<string, unknown>}
          steps={steps}
          runnerUrls={runnerUrls}
          attempt={{
            id: open.id,
            seed: open.seed,
            step_state: open.step_state ?? {},
            step_responses: open.step_responses ?? {},
          }}
        />
      </Page>
    );
  }

  /* --- the start screen -------------------------------------------------- */
  const lastFinished = attempts.find((a) => a.status !== 'in_progress') ?? null;

  return (
    <Page>
      <PageHeader
        title={assignment.activity.title}
        subtitle={assignment.activity.topic ?? undefined}
        back={{ href: '/dashboard', label: 'My work' }}
      />

      <Card>
        <CardBody>
          <div className="mb-4 flex flex-wrap gap-2">
            {assignment.mode === 'practice' ? (
              <Badge>Practice — does not count</Badge>
            ) : (
              <Badge tone="accent">Graded</Badge>
            )}
            {overdue && <Badge tone="danger">Past the due date</Badge>}
            {steps.length > 1 && <Badge>{steps.length} steps</Badge>}
          </div>

          {assignment.activity.description && (
            <p className="mb-4 text-[16px] leading-relaxed">{assignment.activity.description}</p>
          )}

          <dl className="mb-5 grid gap-x-8 gap-y-2 text-[15px] sm:grid-cols-2">
            <div className="flex justify-between gap-4 border-b border-line py-1.5">
              <dt className="text-muted">Due</dt>
              <dd className="text-right">
                {assignment.due_at ? (
                  <>
                    {formatDateTime(assignment.due_at)}{' '}
                    <span className="text-muted">({relativeTime(assignment.due_at)})</span>
                  </>
                ) : (
                  'No due date'
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-line py-1.5">
              <dt className="text-muted">Attempts</dt>
              <dd className="text-right">
                {assignment.attempts_allowed === null
                  ? 'As many as you like'
                  : `${attemptsUsed} of ${assignment.attempts_allowed} used`}
              </dd>
            </div>
            {assignment.time_limit_secs && (
              <div className="flex justify-between gap-4 border-b border-line py-1.5">
                <dt className="text-muted">Time limit</dt>
                <dd className="text-right">{Math.round(assignment.time_limit_secs / 60)} minutes</dd>
              </div>
            )}
            <div className="flex justify-between gap-4 border-b border-line py-1.5">
              <dt className="text-muted">Feedback</dt>
              <dd className="text-right">
                {assignment.mode === 'practice' || assignment.release_feedback === 'immediate'
                  ? 'Straight away'
                  : 'When your teacher releases it'}
              </dd>
            </div>
          </dl>

          {steps.length > 1 && (
            <ol className="mb-5 grid gap-1.5">
              {steps.map((s, i) => (
                <li key={s.id} className="flex items-center gap-3 rounded-lg bg-raised px-3 py-2 text-[15px]">
                  <span className="tabular-nums text-muted">{i + 1}</span>
                  <span className="font-semibold">{s.title ?? s.runner_id}</span>
                  <span className="ml-auto font-mono text-[13px] text-muted">{s.runner_id}</span>
                </li>
              ))}
            </ol>
          )}

          {notOpenYet ? (
            <Alert tone="warn" title="Not open yet">
              This opens {formatDateTime(assignment.open_at)}.
            </Alert>
          ) : outOfAttempts ? (
            <div className="flex flex-wrap items-center gap-3">
              <Alert tone="info">
                {assignment.attempts_allowed === 1
                  ? 'You have had your attempt at this one.'
                  : `You have used all ${assignment.attempts_allowed} attempts.`}
              </Alert>
              {lastFinished && (
                <ButtonLink href={`/results/${lastFinished.id}`}>See what you sent</ButtonLink>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <StartAttempt
                assignmentId={assignment.id}
                label={attemptsUsed > 0 ? 'Start another attempt' : 'Start'}
              />
              {lastFinished && (
                <ButtonLink href={`/results/${lastFinished.id}`} variant="quiet">
                  See your last attempt
                </ButtonLink>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </Page>
  );
}
