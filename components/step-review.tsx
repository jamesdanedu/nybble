'use client';

import { useMemo, useState } from 'react';
import { RunnerFrame } from '@/components/runner-frame';
import { Alert, Badge, cx } from '@/components/ui';
import { formatScore } from '@/lib/format';
import { priorResponses } from '@/lib/step-context';
import type { ActivityStep, StepScore } from '@/lib/types';

/**
 * The student's work, replayed through the runner in `review` mode.
 *
 * Every runner receives `response` and `score` at init and renders the answer
 * with the marking beside it — that is the third arm of the runner contract,
 * and it is why neither this component nor the results page needs to know
 * anything about MCQs, number bases or Parsons lines.
 *
 * One frame is mounted at a time, chosen by the step buttons, rather than all
 * of them at once. A five-step PRIMM sequence would otherwise open five
 * sandboxed iframes on an iPad.
 */
export function StepReview({
  steps,
  runnerUrls,
  sharedContext,
  seed,
  responses,
  scores,
  showScores,
  rubric,
}: {
  steps: ActivityStep[];
  runnerUrls: Record<string, string>;
  sharedContext: Record<string, unknown>;
  seed: number;
  responses: Record<string, unknown>;
  scores: Record<string, StepScore>;
  /** False until feedback is released — the frame is shown, the marks are not. */
  showScores: boolean;
  rubric?: Record<string, { score?: number | null; comment?: string }> | null;
}) {
  const [index, setIndex] = useState(0);
  const step = steps[index];

  // A replayed step sees the same `context.prior` the student saw when they
  // answered it, so a Make step still quotes their prediction back — for the
  // teacher marking it as much as for the student rereading it.
  const prior = useMemo(() => priorResponses(steps, index, responses), [steps, index, responses]);

  if (!step) return <Alert tone="info">This activity has no steps.</Alert>;

  const entryUrl = runnerUrls[step.runner_id];
  const score = scores[step.id];
  const answered = responses[step.id] !== undefined;
  const teacherNote = rubric?.[step.id];

  return (
    <div>
      {steps.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {steps.map((s, i) => {
            const sc = scores[s.id];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setIndex(i)}
                className={cx(
                  'inline-flex min-h-[36px] items-center gap-2 rounded-lg border px-3 text-[14px] font-semibold transition',
                  i === index
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-muted hover:text-ink',
                )}
              >
                <span className="tabular-nums">{i + 1}</span>
                <span className="max-w-[16ch] truncate">{s.title ?? s.runner_id}</span>
                {showScores && sc && typeof sc.total === 'number' && (
                  <span className="tabular-nums text-muted">
                    {formatScore(sc.total)}/{formatScore(sc.max)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-[18px] font-semibold">
          {step.title ?? `Step ${index + 1}`}
        </h3>
        {!answered && <Badge tone="warn">Not answered</Badge>}
        {showScores && score && typeof score.total === 'number' && (
          <Badge tone="accent">
            {formatScore(score.total)} / {formatScore(score.max)}
          </Badge>
        )}
        {showScores && score?.manual && <Badge>Marked by hand</Badge>}
        {score?.late && <Badge tone="warn">Late</Badge>}
      </div>

      {!entryUrl ? (
        <Alert tone="error">
          No runner registered for <code className="font-mono">{step.runner_id}</code>, so this step
          cannot be replayed.
        </Alert>
      ) : (
        <RunnerFrame
          key={`${step.id}-${showScores ? 'scored' : 'plain'}`}
          entryUrl={entryUrl}
          stepId={step.id}
          config={step.config ?? {}}
          context={{ ...sharedContext, seed, prior }}
          mode="review"
          response={responses[step.id] ?? null}
          // Withholding the score object is what actually stops a runner
          // rendering "correct answer: b" before the teacher has released it.
          score={showScores ? (score ?? null) : null}
          title={step.title ?? step.runner_id}
        />
      )}

      {teacherNote?.comment && (
        <div className="mt-3">
          <Alert tone="info" title="Your teacher wrote">
            {teacherNote.comment}
          </Alert>
        </div>
      )}
    </div>
  );
}
