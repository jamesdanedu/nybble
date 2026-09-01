'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert, Button, Card, CardBody, Field, Input, Select, cx } from '@/components/ui';
import { createAssignment } from './actions';

interface Option {
  id: string;
  label: string;
  sub?: string;
}

/**
 * Local wall-clock ("2026-09-08T16:30") → ISO with a real offset.
 *
 * Done in the browser deliberately. The value from a `datetime-local` input has
 * no zone, and `new Date()` on a Vercel server (UTC) would read it an hour out
 * for half the school year. The browser is the only place that knows what the
 * teacher meant.
 */
function localToIso(value: string): string {
  if (!value) return '';
  const d = new Date(value); // parsed in the browser's own zone — correct here
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** `now` and `now + n days`, as `datetime-local` values in the browser's zone. */
function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function AssignForm({
  activities,
  classes,
  students,
  initialActivityId,
}: {
  activities: Option[];
  classes: Option[];
  students: Option[];
  initialActivityId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [activityId, setActivityId] = useState(initialActivityId ?? activities[0]?.id ?? '');
  const [targetKind, setTargetKind] = useState<'class' | 'student'>(
    classes.length ? 'class' : 'student',
  );
  const [targetId, setTargetId] = useState(classes[0]?.id ?? students[0]?.id ?? '');
  const [openAt, setOpenAt] = useState(() => localInputValue(new Date()));
  const [dueAt, setDueAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(23, 59, 0, 0);
    return localInputValue(d);
  });
  const [mode, setMode] = useState('graded');
  const [attemptsAllowed, setAttemptsAllowed] = useState('1');
  const [timeLimitMins, setTimeLimitMins] = useState('');
  const [releaseFeedback, setReleaseFeedback] = useState('on_review');

  const targets = targetKind === 'class' ? classes : students;

  function submit() {
    start(async () => {
      setError(null);
      const result = await createAssignment({
        activityId,
        target: { kind: targetKind, id: targetId },
        openAt: localToIso(openAt),
        dueAt: localToIso(dueAt),
        mode,
        attemptsAllowed,
        timeLimitMins,
        releaseFeedback,
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not set the activity.');
        return;
      }
      setDone(true);
      router.refresh();
    });
  }

  if (done) {
    return (
      <Card>
        <CardBody>
          <Alert tone="success" title="Set">
            {targetKind === 'class'
              ? 'The class will see it on their dashboard as soon as it opens.'
              : 'They will see it on their dashboard as soon as it opens.'}
          </Alert>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => setDone(false)}>
              Set another
            </Button>
            <Button variant="quiet" onClick={() => router.push('/teacher')}>
              Back to overview
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        {error && (
          <div className="mb-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        <Field label="Activity" htmlFor="activity">
          <Select
            id="activity"
            value={activityId}
            onChange={(e) => setActivityId(e.target.value)}
            required
          >
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
                {a.sub ? ` — ${a.sub}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Who gets it" hint="A class, or one student on their own.">
          <div className="mb-2 flex gap-1.5">
            {(['class', 'student'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  setTargetKind(kind);
                  setTargetId((kind === 'class' ? classes[0]?.id : students[0]?.id) ?? '');
                }}
                className={cx(
                  'min-h-[40px] rounded-lg border px-4 text-[15px] font-semibold transition',
                  targetKind === kind
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-muted hover:text-ink',
                )}
              >
                {kind === 'class' ? 'A class' : 'One student'}
              </button>
            ))}
          </div>
          <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
            {targets.length === 0 && <option value="">Nothing to choose from</option>}
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
                {t.sub ? ` — ${t.sub}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-x-5 sm:grid-cols-2">
          <Field label="Opens" htmlFor="openAt" hint="Students cannot see it before this.">
            <Input
              id="openAt"
              type="datetime-local"
              value={openAt}
              onChange={(e) => setOpenAt(e.target.value)}
            />
          </Field>
          <Field label="Due" htmlFor="dueAt" hint="Blank for no deadline. Late work is flagged, not zeroed.">
            <Input
              id="dueAt"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-x-5 sm:grid-cols-2">
          <Field label="Mode" htmlFor="mode" hint="Practice shows the mark straight away and does not count.">
            <Select id="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="graded">Graded</option>
              <option value="practice">Practice</option>
            </Select>
          </Field>
          <Field
            label="Attempts allowed"
            htmlFor="attempts"
            hint="Blank for unlimited."
          >
            <Input
              id="attempts"
              inputMode="numeric"
              value={attemptsAllowed}
              onChange={(e) => setAttemptsAllowed(e.target.value)}
              placeholder="1"
            />
          </Field>
        </div>

        <div className="grid gap-x-5 sm:grid-cols-2">
          <Field
            label="Time limit (minutes)"
            htmlFor="timelimit"
            hint="Blank for none. Runners that manage their own timer ignore this."
          >
            <Input
              id="timelimit"
              inputMode="numeric"
              value={timeLimitMins}
              onChange={(e) => setTimeLimitMins(e.target.value)}
              placeholder="none"
            />
          </Field>
          <Field
            label="When students see feedback"
            htmlFor="feedback"
            hint="Marks are always recorded; this only decides when the student sees them."
          >
            <Select
              id="feedback"
              value={releaseFeedback}
              onChange={(e) => setReleaseFeedback(e.target.value)}
            >
              <option value="on_review">When I release it</option>
              <option value="immediate">Straight away</option>
              <option value="manual">Only after I mark it by hand</option>
            </Select>
          </Field>
        </div>

        {mode === 'practice' && releaseFeedback !== 'immediate' && (
          <div className="mb-4">
            <Alert tone="info">
              Practice mode always shows feedback straight away, whatever the release rule says.
            </Alert>
          </div>
        )}

        <Button onClick={submit} disabled={pending || !activityId || !targetId}>
          {pending ? 'Setting…' : 'Set this activity'}
        </Button>
      </CardBody>
    </Card>
  );
}
