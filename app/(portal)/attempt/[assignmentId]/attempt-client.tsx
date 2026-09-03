'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { env } from '@/lib/env';
import { Alert, Badge, Button, cx } from '@/components/ui';
import {
  RunnerFrame,
  type RunnerCapabilities,
  type RunnerSlot,
  type RunnerSubmitPayload,
} from '@/components/runner-frame';
import type { ActivityStep, Assignment, Attempt, StepScore } from '@/lib/types';
import { formatScore } from '@/lib/format';
import { priorResponses } from '@/lib/step-context';

interface Props {
  assignment: Pick<Assignment, 'id' | 'mode' | 'due_at' | 'release_feedback' | 'time_limit_secs'>;
  activityTitle: string;
  sharedContext: Record<string, unknown>;
  steps: ActivityStep[];
  /** runner id → entry_url, read from the `runners` registry on the server. */
  runnerUrls: Record<string, string>;
  attempt: Pick<Attempt, 'id' | 'seed' | 'step_state' | 'step_responses'>;
}

type ScoreResponse = {
  ok?: boolean;
  status?: 'in_progress' | 'submitted';
  late?: boolean;
  stepScore?: StepScore | { recorded: true };
  attemptScore?: { total: number | null; max: number | null } | null;
  error?: string;
};

export function AttemptClient({
  assignment,
  activityTitle,
  sharedContext,
  steps,
  runnerUrls,
  attempt,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // Seeded from the server, then added to as the student submits, so a step
  // mounted later in this same page session can see what the earlier ones
  // answered. That is what `context.prior` below is built from.
  const [responses, setResponses] = useState<Record<string, unknown>>(
    () => ({ ...((attempt.step_responses as Record<string, unknown>) ?? {}) }),
  );
  const answered = useMemo(() => new Set(Object.keys(responses)), [responses]);
  // Start on the first step with no response — a resumed attempt lands exactly
  // where the student left off.
  const [index, setIndex] = useState(() => {
    const done = new Set(Object.keys(attempt.step_responses ?? {}));
    const first = steps.findIndex((s) => !done.has(s.id));
    return first === -1 ? Math.max(steps.length - 1, 0) : first;
  });

  const [capabilities, setCapabilities] = useState<RunnerCapabilities>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [practiceScore, setPracticeScore] = useState<StepScore | null>(null);

  const slotRef = useRef<RunnerSlot | null>(null);
  const step = steps[index];
  const entryUrl = step ? runnerUrls[step.runner_id] : undefined;

  /* --- autosave --------------------------------------------------------- */

  /**
   * runner-host.js already debounces `state` messages at 800 ms, so this fires
   * at most once per 800 ms per step and we persist whatever it hands us
   * verbatim. Do NOT add a second debounce here — that would double the delay
   * between the last keystroke and the write, which is exactly the window in
   * which a student closes the lid.
   *
   * Only `step_state` is written. `step_scores`, `auto_score` and `max_score`
   * are stripped from any student update by the attempts_protect_scores
   * trigger, so there is no point (and no danger) in sending them.
   */
  const onState = useCallback(
    async (state: unknown) => {
      if (!step) return;
      setSaveState('saving');
      const { data: current } = await supabase
        .from('attempts')
        .select('step_state')
        .eq('id', attempt.id)
        .maybeSingle();

      const merged = { ...((current?.step_state as Record<string, unknown>) ?? {}), [step.id]: state };
      const { error: saveError } = await supabase
        .from('attempts')
        .update({ step_state: merged })
        .eq('id', attempt.id);

      setSaveState(saveError ? 'failed' : 'saved');
    },
    [supabase, attempt.id, step],
  );

  /* --- submit ----------------------------------------------------------- */

  /**
   * Everything that counts is scored by the `score` Edge Function, with the
   * student's own JWT. The browser never sees an answer key and never writes a
   * mark: the function reads `activity_keys` with the service role and a
   * database trigger strips score columns from any student-originated update.
   *
   * `clientScore` is sent ONLY in practice mode, and only reaches a runner
   * registered `scorer = 'client'` (today, `pyrun`). Whether a student's Python
   * passes the teacher's checks cannot be decided on the server — there is no
   * Python there — so in practice mode, where nothing is at stake, the runner's
   * own report becomes instant formative feedback. The Edge Function reads the
   * assignment's mode from the database rather than from this request, so
   * omitting the guard here would not have let a browser award itself marks;
   * it is here so the portal never sends what cannot be used.
   */
  const onSubmit = useCallback(
    async (payload: RunnerSubmitPayload) => {
      if (!step) return;
      setBusy(true);
      setError(null);
      setPracticeScore(null);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setError('Your session expired. Open the page again — your work is saved.');
          setBusy(false);
          return;
        }

        const res = await fetch(env.scoreFunctionUrl, {
          method: 'POST',
          headers: {
            // Two DIFFERENT credentials, and the call needs both.
            //
            //   Authorization  WHO is asking — the student's own access token.
            //                  The function reads their id out of it.
            //   apikey         WHICH PROJECT is asking. The gateway checks
            //                  this before the function runs; a user token
            //                  does not satisfy it, because it is not an API
            //                  key.
            //
            // This header was removed once, on the reasoning that an Edge
            // Function authenticates from the bearer token alone. That is true
            // of the older gateway and false of the current one, which answers
            //
            //   No credential matched any of the accepted auth mode(s):
            //   "publishable", "secret"
            //
            // when no API key reaches it. Note what that message names: the
            // NEW key formats only. A legacy `eyJ...` anon key does not
            // satisfy it either, so NEXT_PUBLIC_SUPABASE_ANON_KEY has to be
            // the `sb_publishable_...` key. PostgREST accepts both formats,
            // which is exactly why the database can keep working while every
            // submission fails.
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: env.supabaseAnonKey,
          },
          body: JSON.stringify({
            attemptId: attempt.id,
            stepId: step.id,
            response: payload.response ?? {},
            ...(assignment.mode === 'practice'
              ? { clientScore: payload.clientScore, maxScore: payload.maxScore }
              : {}),
          }),
        });

        const body = (await res.json().catch(() => ({}))) as ScoreResponse;

        if (!res.ok) {
          // TWO different services answer on this URL, and they do not agree on
          // how to report a failure. Our own code always replies { error }. The
          // Supabase gateway rejects a bad token BEFORE the function runs and
          // replies { message } or { msg }. Reading only `error` turned every
          // gateway rejection into "check the connection" — wrong, and nothing
          // a student or a teacher could act on.
          const detail =
            (body as Record<string, unknown>).error ??
            (body as Record<string, unknown>).message ??
            (body as Record<string, unknown>).msg ??
            null;
          console.error(`[nybble] scorer returned ${res.status} from ${env.scoreFunctionUrl}`, body);
          setError(
            body.error === 'attempt already submitted'
              ? 'This attempt has already been handed up.'
              : body.error === 'step already answered'
                ? 'You have already answered this step, and the first answer is the one that counts.'
                : res.status === 401
                  ? `The marking service would not accept your sign-in${
                      detail ? ` (${String(detail)})` : ''
                    }. Sign out and back in; if it keeps happening, tell your teacher.`
                  : detail
                    ? `Could not save your answer: ${String(detail)}`
                    : `Could not save your answer (error ${res.status}). Your work is saved — press Submit again, and tell your teacher if it keeps happening.`,
          );
          setBusy(false);
          return;
        }

        setResponses((prev) => ({ ...prev, [step.id]: payload.response ?? {} }));

        // Practice mode and `release_feedback: immediate` get the mark back
        // straight away; everything else gets `{ recorded: true }`.
        const stepScore = body.stepScore as StepScore | undefined;
        const gotMarks = stepScore && typeof stepScore.total === 'number';

        if (body.status === 'submitted') {
          router.refresh();
          router.replace(`/results/${attempt.id}`);
          return;
        }

        if (gotMarks) {
          setPracticeScore(stepScore!);
          // Leave the student on the step so they can read the feedback, and
          // give them an explicit "Next step" button.
        } else {
          setIndex((i) => Math.min(i + 1, steps.length - 1));
        }
        setBusy(false);
      } catch (e) {
        // A fetch that REJECTS, rather than returning !ok, means the browser
        // never got a usable response at all. Two very different causes arrive
        // here identically, because a blocked preflight is deliberately opaque
        // to script: the student really is offline, or the scorer's CORS
        // headers turned the request away (not deployed, wrong PORTAL_ORIGIN,
        // a header missing from Access-Control-Allow-Headers). The old message
        // guessed "check the connection", which sent a student chasing a
        // problem that was never theirs.
        console.error(
          `[nybble] submit failed: no usable response from ${env.scoreFunctionUrl}. ` +
            'If the browser console shows a CORS error above this line, the score ' +
            'Edge Function is either not deployed (`supabase functions deploy score`) ' +
            `or PORTAL_ORIGIN does not include this page's origin (${
              typeof window === 'undefined' ? '?' : window.location.origin
            }).`,
          e,
        );
        setError(
          typeof navigator !== 'undefined' && navigator.onLine === false
            ? 'You appear to be offline. Your answers are saved — reconnect and press Submit again.'
            : 'The marking service did not answer. Your answers are saved, so nothing is lost. Press Submit again, and tell your teacher if it keeps happening.',
        );
        setBusy(false);
      }
    },
    [supabase, attempt.id, step, steps.length, router],
  );

  // Rules and rationale live in lib/step-context.ts — the same helper feeds
  // the review page, so the two can never drift apart on what a runner sees.
  const prior = useMemo(() => priorResponses(steps, index, responses), [steps, index, responses]);

  const goNext = useCallback(() => {
    setPracticeScore(null);
    setIndex((i) => {
      const nextUnanswered = steps.findIndex((s, si) => si > i && !answered.has(s.id));
      return nextUnanswered === -1 ? Math.min(i + 1, steps.length - 1) : nextUnanswered;
    });
  }, [steps, answered]);

  if (!step) {
    return <Alert tone="error">This activity has no steps. Tell your teacher.</Alert>;
  }
  if (!entryUrl) {
    return (
      <Alert tone="error" title="This step cannot be shown">
        No runner is registered for <code className="font-mono">{step.runner_id}</code>. Your
        teacher needs to register it before this activity will work.
      </Alert>
    );
  }

  const allAnswered = steps.every((s) => answered.has(s.id));

  // An answered step is re-mounted in `review` mode rather than `attempt`, so
  // every runner renders it read-only using machinery it already has. Hiding
  // the portal's own Submit was never enough on its own: a runner that declares
  // selfSubmit draws its own button, and a student walking back to Predict
  // after seeing the output could rewrite the prediction the whole sequence is
  // built on. The scorer refuses a second answer as well — this is the half
  // that stops it being offered.
  const answeredHere = answered.has(step.id);

  return (
    <div>
      {steps.length > 1 && (
        <ol className="mb-4 flex flex-wrap gap-1.5" aria-label="Steps">
          {steps.map((s, i) => {
            const done = answered.has(s.id);
            const current = i === index;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  // Answered steps can be revisited; unanswered ones ahead
                  // cannot be skipped to, because PRIMM's whole point is order.
                  disabled={!done && i > index}
                  onClick={() => {
                    setPracticeScore(null);
                    setIndex(i);
                  }}
                  className={cx(
                    'inline-flex min-h-[36px] items-center gap-2 rounded-lg border px-3 text-[14px] font-semibold transition',
                    current
                      ? 'border-accent bg-accent-soft text-accent'
                      : done
                        ? 'border-line text-muted hover:text-ink'
                        : 'border-line text-muted opacity-60',
                  )}
                >
                  <span className="tabular-nums">{i + 1}</span>
                  <span className="max-w-[14ch] truncate">{s.title ?? s.runner_id}</span>
                  {done && <span aria-label="answered">✓</span>}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[19px] font-semibold">
            {step.title ?? (steps.length > 1 ? `Step ${index + 1}` : activityTitle)}
          </h2>
          {assignment.mode === 'practice' && <Badge>Practice</Badge>}
        </div>
        <p
          className="text-[13.5px] text-muted"
          aria-live="polite"
          title="Your work is saved automatically as you go"
        >
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Saved'}
          {saveState === 'failed' && 'Could not save — check the connection'}
        </p>
      </div>

      {error && (
        <div className="mb-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <RunnerFrame
        key={step.id}
        entryUrl={entryUrl}
        stepId={step.id}
        config={step.config ?? {}}
        // Every step gets the same shared context — that is the PRIMM
        // mechanism. `seed` rides along so generated question sets and
        // shuffles are reproducible for this attempt.
        context={{ ...sharedContext, seed: attempt.seed, prior }}
        state={(attempt.step_state ?? {})[step.id] ?? null}
        mode={answeredHere ? 'review' : 'attempt'}
        response={answeredHere ? (responses[step.id] ?? null) : null}
        // Only ever the mark the server just handed back for THIS submission,
        // and only where it releases one. Revisiting an older step shows the
        // answer with no marking, because the portal holds no marks for it.
        score={answeredHere ? practiceScore : null}
        title={step.title ?? activityTitle}
        onState={onState}
        onSubmit={onSubmit}
        onReady={setCapabilities}
        registerSlot={(slot) => {
          slotRef.current = slot;
        }}
      />

      {practiceScore && (
        <div className="mt-4">
          <Alert tone="success" title={`${formatScore(practiceScore.total)} / ${formatScore(practiceScore.max)}`}>
            Answer recorded.
            {index < steps.length - 1 && ' Move on when you are ready.'}
          </Alert>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/* The runner declares selfSubmit when it draws its own button; drawing
            a second one beside it is how you get students pressing the wrong one. */}
        {!capabilities.selfSubmit && !answered.has(step.id) && (
          <Button onClick={() => slotRef.current?.requestSubmit()} disabled={busy}>
            {busy ? 'Sending…' : index === steps.length - 1 ? 'Submit and finish' : 'Submit this step'}
          </Button>
        )}

        {practiceScore && index < steps.length - 1 && (
          <Button onClick={goNext} disabled={busy}>
            Next step
          </Button>
        )}

        {answered.has(step.id) && !practiceScore && index < steps.length - 1 && (
          <Button onClick={goNext} variant="secondary">
            Next step
          </Button>
        )}

        {allAnswered && (
          <Button variant="secondary" onClick={() => router.push(`/results/${attempt.id}`)}>
            See what you sent
          </Button>
        )}

        <p className="text-[13.5px] text-muted">
          {answered.size} of {steps.length} step{steps.length === 1 ? '' : 's'} answered.
        </p>
      </div>
    </div>
  );
}
