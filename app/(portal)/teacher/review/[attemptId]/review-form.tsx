'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert, Button, Card, CardBody, Field, Input, Textarea } from '@/components/ui';
import { formatScore } from '@/lib/format';
import type { ActivityStep, StepScore } from '@/lib/types';
import { saveReview, unreleaseReview } from './actions';

export function ReviewForm({
  attemptId,
  steps,
  stepScores,
  autoScore,
  maxScore,
  existing,
}: {
  attemptId: string;
  steps: ActivityStep[];
  stepScores: Record<string, StepScore>;
  autoScore: number | null;
  maxScore: number | null;
  existing: {
    score: number | null;
    feedback: string | null;
    rubric: Record<string, { score?: number | null; comment?: string }> | null;
    released_at: string | null;
  } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Pre-fill with the auto-mark. Most reviews agree with it, and the teacher's
  // job is to override the ones that do not, not to retype the ones that match.
  const [score, setScore] = useState(
    existing?.score !== null && existing?.score !== undefined
      ? String(existing.score)
      : autoScore !== null
        ? String(autoScore)
        : '',
  );
  const [feedback, setFeedback] = useState(existing?.feedback ?? '');
  const [rubric, setRubric] = useState<Record<string, { score: string; comment: string }>>(() => {
    const initial: Record<string, { score: string; comment: string }> = {};
    for (const s of steps) {
      const r = existing?.rubric?.[s.id];
      initial[s.id] = {
        score: r?.score !== null && r?.score !== undefined ? String(r.score) : '',
        comment: r?.comment ?? '',
      };
    }
    return initial;
  });

  function submit(release: boolean) {
    start(async () => {
      setError(null);
      setSaved(null);
      const result = await saveReview({
        attemptId,
        score,
        feedback,
        rubric: Object.fromEntries(
          Object.entries(rubric).map(([id, v]) => [
            id,
            {
              score: v.score.trim() === '' ? null : Number(v.score),
              comment: v.comment,
            },
          ]),
        ),
        release,
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not save.');
        return;
      }
      setSaved(release ? 'Saved and released to the student.' : 'Saved. Not visible to the student yet.');
      router.refresh();
    });
  }

  const released = Boolean(existing?.released_at);

  return (
    <Card>
      <CardBody>
        <h2 className="mb-1 text-[19px] font-semibold">Your marking</h2>
        <p className="mb-4 text-[15px] text-muted">
          The auto-mark stays on the attempt whatever you write here. Nothing below reaches the
          student until you press Release.
        </p>

        {error && (
          <div className="mb-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        {saved && (
          <div className="mb-4">
            <Alert tone="success">{saved}</Alert>
          </div>
        )}

        <div className="grid gap-x-5 sm:grid-cols-2">
          <Field
            label="Mark"
            htmlFor="score"
            hint={
              maxScore !== null
                ? `Out of ${formatScore(maxScore)}. Auto-marked at ${formatScore(autoScore)}.`
                : 'Blank to leave it unmarked.'
            }
          >
            <Input
              id="score"
              inputMode="decimal"
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Feedback to the student"
          htmlFor="feedback"
          hint="They see this once you release."
        >
          <Textarea
            id="feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What went well, and the one thing to fix next time."
          />
        </Field>

        {steps.length > 0 && (
          <div className="mb-5">
            <p className="mb-2 text-[15px] font-semibold">Per step</p>
            <div className="grid gap-3">
              {steps.map((s, i) => {
                const auto = stepScores[s.id];
                return (
                  <div key={s.id} className="rounded-card border border-line p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">
                        {i + 1}. {s.title ?? s.id}
                      </span>
                      <span className="font-mono text-[13px] text-muted">{s.runner_id}</span>
                      <span className="ml-auto text-[14px] text-muted">
                        {auto && typeof auto.total === 'number'
                          ? `auto ${formatScore(auto.total)} / ${formatScore(auto.max)}`
                          : 'not auto-marked'}
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[7rem_1fr]">
                      <Input
                        aria-label={`Mark for step ${i + 1}`}
                        inputMode="decimal"
                        placeholder="mark"
                        value={rubric[s.id]?.score ?? ''}
                        onChange={(e) =>
                          setRubric((r) => ({
                            ...r,
                            [s.id]: { score: e.target.value, comment: r[s.id]?.comment ?? '' },
                          }))
                        }
                      />
                      <Input
                        aria-label={`Comment on step ${i + 1}`}
                        placeholder="Comment on this step"
                        value={rubric[s.id]?.comment ?? ''}
                        onChange={(e) =>
                          setRubric((r) => ({
                            ...r,
                            [s.id]: { score: r[s.id]?.score ?? '', comment: e.target.value },
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => submit(true)} disabled={pending}>
            {pending ? 'Saving…' : released ? 'Save and keep released' : 'Save and release'}
          </Button>
          <Button variant="secondary" onClick={() => submit(false)} disabled={pending}>
            Save without releasing
          </Button>
          {released && (
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await unreleaseReview(attemptId);
                  if (!result.ok) setError(result.error ?? 'Could not un-release.');
                  else {
                    setSaved('Pulled back — the student can no longer see the marking.');
                    router.refresh();
                  }
                })
              }
            >
              Pull it back
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
