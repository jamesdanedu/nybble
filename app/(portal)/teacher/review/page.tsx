import type { Metadata } from 'next';
import { requireStaffSession } from '@/lib/session';
import { getReviewQueue } from '@/lib/queries';
import { formatDateTime, formatScore, percent, relativeTime } from '@/lib/format';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  Empty,
  Page,
  PageHeader,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Review queue' };
export const dynamic = 'force-dynamic';

export default async function ReviewQueuePage() {
  await requireStaffSession();
  const queue = await getReviewQueue();

  return (
    <Page>
      <PageHeader
        title="Review queue"
        subtitle={
          queue.length === 0
            ? 'Nothing waiting.'
            : `${queue.length} attempt${queue.length === 1 ? '' : 's'} waiting, oldest first.`
        }
      />

      {queue.length === 0 ? (
        <Empty title="All caught up">
          Everything that has been handed up has been marked. Attempts appear here as soon as a
          student finishes the last step.
        </Empty>
      ) : (
        <div className="grid gap-2">
          {queue.map(({ attempt, student, assignment, review }) => {
            const pct = percent(attempt.auto_score, attempt.max_score);
            const needsHand = Object.values(attempt.step_scores ?? {}).some(
              (s) => s?.manual || s?.total === null,
            );
            return (
              <Card key={attempt.id}>
                <CardBody className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <p className="text-[17px] font-semibold">
                        {student?.display_name ?? 'Unknown student'}
                      </p>
                      {needsHand && <Badge tone="warn">Needs marking by hand</Badge>}
                      {Object.values(attempt.step_scores ?? {}).some((s) => s?.late) && (
                        <Badge tone="danger">Late</Badge>
                      )}
                      {review?.released_at && <Badge tone="accent">Released</Badge>}
                    </div>
                    <p className="text-[14.5px] text-muted">
                      {assignment?.activity.title ?? 'Unknown activity'}
                      {attempt.attempt_no > 1 && ` · attempt ${attempt.attempt_no}`}
                      {' · handed up '}
                      {formatDateTime(attempt.submitted_at)}{' '}
                      <span>({relativeTime(attempt.submitted_at)})</span>
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-[22px] font-semibold tabular-nums">
                      {formatScore(attempt.auto_score)}
                      <span className="text-[15px] font-normal text-muted">
                        {' '}
                        / {formatScore(attempt.max_score)}
                      </span>
                    </p>
                    <p className="text-[13px] text-muted">
                      {pct === null ? 'Not auto-marked' : `${pct}% auto`}
                    </p>
                  </div>

                  <ButtonLink href={`/teacher/review/${attempt.id}`} variant="primary">
                    Open
                  </ButtonLink>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}
