import type { Metadata } from 'next';
import { requireStudentOrStaff } from '@/lib/session';
import { getStudentAssignments } from '@/lib/queries';
import {
  formatDateTime,
  feedbackVisible,
  formatScore,
  isOverdue,
  percent,
  relativeTime,
  STATUS_LABEL,
  STATUS_TONE,
  studentStatus,
} from '@/lib/format';
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  Empty,
  Page,
  PageHeader,
  Section,
} from '@/components/ui';

export const metadata: Metadata = { title: 'My work' };

// Assignments and attempts change while the page is open; never cache them.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { profile } = await requireStudentOrStaff();

  let rows;
  try {
    rows = await getStudentAssignments(profile.id);
  } catch (e) {
    return (
      <Page>
        <PageHeader title="My work" />
        <Alert tone="error" title="Could not load your work">
          {e instanceof Error ? e.message : 'Something went wrong.'} Refresh the page, and tell your
          teacher if it keeps happening.
        </Alert>
      </Page>
    );
  }

  const now = Date.now();

  // "To do" first and in due-date order, because that is the only question a
  // student actually has when they open this page.
  const todo = rows.filter((r) => !r.attempt || r.attempt.status === 'in_progress');
  const done = rows.filter((r) => r.attempt && r.attempt.status !== 'in_progress');

  return (
    <Page>
      <PageHeader
        title={`Hello, ${profile.display_name.split(' ')[0]}`}
        subtitle={
          rows.length === 0
            ? undefined
            : todo.length === 0
              ? 'Nothing outstanding. Everything below has been handed up.'
              : `${todo.length} thing${todo.length === 1 ? '' : 's'} to do.`
        }
      />

      {rows.length === 0 && (
        <Empty title="Nothing set yet">
          When your teacher sets an activity it will appear here. Assignments only show up once
          they are open.
        </Empty>
      )}

      {todo.length > 0 && (
        <Section title="To do">
          <div className="grid gap-3">
            {todo.map((row) => (
              <AssignmentCard key={row.assignment.id} row={row} now={now} />
            ))}
          </div>
        </Section>
      )}

      {done.length > 0 && (
        <Section title="Handed up">
          <div className="grid gap-3">
            {done.map((row) => (
              <AssignmentCard key={row.assignment.id} row={row} now={now} />
            ))}
          </div>
        </Section>
      )}
    </Page>
  );
}

function AssignmentCard({
  row,
  now,
}: {
  row: Awaited<ReturnType<typeof getStudentAssignments>>[number];
  now: number;
}) {
  const { assignment, attempt, attemptCount, review } = row;
  const visible = feedbackVisible(assignment, review);
  const status = studentStatus(attempt, visible && attempt?.status !== 'in_progress');
  const overdue = isOverdue(assignment.due_at, now) && status !== 'marked' && status !== 'submitted';

  const stepCount = Array.isArray(assignment.activity.steps) ? assignment.activity.steps.length : 0;
  const answered = attempt ? Object.keys(attempt.step_responses ?? {}).length : 0;

  const outOfAttempts =
    assignment.attempts_allowed !== null &&
    attemptCount >= assignment.attempts_allowed &&
    (!attempt || attempt.status !== 'in_progress');

  // The score only appears once the student is allowed to see it. The number
  // itself is in attempts.auto_score, which their own RLS policy lets them
  // select — withholding it is a UI decision, and is noted in the README of
  // this feature. Never show a teacher score before released_at.
  const showScore = visible && attempt && attempt.status !== 'in_progress';
  const teacherScore = review?.released_at ? review.score : null;
  const shownScore = teacherScore ?? (showScore ? attempt.auto_score : null);
  const shownMax = attempt?.max_score ?? assignment.activity.max_score ?? null;
  const pct = percent(shownScore, shownMax);

  return (
    <Card>
      <CardBody className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
            {assignment.mode === 'practice' && <Badge>Practice</Badge>}
            {overdue && <Badge tone="danger">Overdue</Badge>}
          </div>

          <h3 className="text-[19px] font-semibold leading-snug">{assignment.activity.title}</h3>
          {assignment.activity.topic && (
            <p className="text-[14px] text-muted">{assignment.activity.topic}</p>
          )}

          <p className="mt-2 text-[14.5px] text-muted">
            {stepCount > 1 && (
              <>
                {status === 'in_progress'
                  ? `Step ${Math.min(answered + 1, stepCount)} of ${stepCount}`
                  : `${stepCount} steps`}
                {' · '}
              </>
            )}
            {assignment.due_at ? (
              <>
                Due {formatDateTime(assignment.due_at)}{' '}
                <span className="text-muted">({relativeTime(assignment.due_at, now)})</span>
              </>
            ) : (
              'No due date'
            )}
            {assignment.attempts_allowed !== null && (
              <> · Attempt {Math.min(attemptCount || 1, assignment.attempts_allowed)} of {assignment.attempts_allowed}</>
            )}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {shownScore !== null && shownScore !== undefined && (
            <div className="text-right">
              <p className="text-[26px] font-semibold leading-none tabular-nums">
                {formatScore(shownScore)}
                {shownMax !== null && (
                  <span className="text-[17px] font-normal text-muted"> / {formatScore(shownMax)}</span>
                )}
              </p>
              {pct !== null && <p className="text-[13.5px] text-muted">{pct}%</p>}
            </div>
          )}

          {status === 'not_started' && !outOfAttempts && (
            <ButtonLink href={`/attempt/${assignment.id}`} variant="primary">
              Start
            </ButtonLink>
          )}
          {status === 'in_progress' && (
            <ButtonLink href={`/attempt/${assignment.id}`} variant="primary">
              Continue
            </ButtonLink>
          )}
          {(status === 'submitted' || status === 'marked') && attempt && (
            <ButtonLink href={`/results/${attempt.id}`}>
              {visible ? 'See feedback' : 'See what you sent'}
            </ButtonLink>
          )}
          {outOfAttempts && status !== 'marked' && (
            <p className="text-[13.5px] text-muted">No attempts left</p>
          )}
        </div>
      </CardBody>

      {status === 'submitted' && !visible && (
        <div className="border-t border-line px-5 py-3 text-[14px] text-muted sm:px-6">
          Marked, but your teacher has not released the feedback yet.
        </div>
      )}
    </Card>
  );
}
