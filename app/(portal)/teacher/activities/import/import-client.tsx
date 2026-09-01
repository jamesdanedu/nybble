'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Alert, Badge, Button, Card, CardBody, cx } from '@/components/ui';

/* ---------------------------------------------------------------------------
 * Import screen: choose file → validate + dry-run → read the plan → commit.
 *
 * The dry run is not optional and cannot be skipped. Import is the one action
 * in the whole portal that can quietly ruin a term's marking (a key in the
 * wrong half of a step, a solution line that does not exist, a `correct` array
 * that a language model left empty), and the validator catches all three — but
 * only if a human reads what it says.
 * ------------------------------------------------------------------------ */

interface Issue {
  path: string;
  message: string;
}
interface StepPlan {
  id: string;
  runner_id: string;
  action: 'create' | 'update' | 'unchanged' | 'kept';
  hasKey: boolean;
}
interface ActivityPlan {
  title: string;
  topic: string | null;
  action: 'create' | 'update';
  existingId: string | null;
  steps: StepPlan[];
  keyCount: number;
  notes: string[];
}
interface PlanResponse {
  stage: 'validate' | 'plan' | 'commit';
  ok: boolean;
  plan?: ActivityPlan[];
  errors?: (Issue | string)[];
  warnings?: (Issue | string)[];
  results?: { title: string; action: string; id?: string; error?: string }[];
}

const issueText = (i: Issue | string) =>
  typeof i === 'string' ? i : `${i.path ? i.path + ' — ' : ''}${i.message}`;

export function ImportClient() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [fileJson, setFileJson] = useState<unknown>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [committed, setCommitted] = useState<PlanResponse | null>(null);

  function reset() {
    setFileName(null);
    setFileJson(null);
    setPlan(null);
    setCommitted(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function onFile(file: File) {
    reset();
    setFileName(file.name);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      setFileJson(json);
      await run(json, 'dry-run', replace);
    } catch (e) {
      setError(
        `${file.name} is not valid JSON — ${e instanceof Error ? e.message : 'could not parse it'}.`,
      );
    }
  }

  async function run(json: unknown, mode: 'dry-run' | 'commit', doReplace: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/activities/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, file: json, replace: doReplace }),
      });
      const body = (await res.json()) as PlanResponse & { error?: string };
      if (!res.ok && body.error) {
        setError(body.error);
      } else if (mode === 'commit') {
        setCommitted(body);
        router.refresh();
      } else {
        setPlan(body);
      }
    } catch {
      setError('Could not reach the server. Nothing was imported.');
    }
    setBusy(false);
  }

  /* --- after committing -------------------------------------------------- */
  if (committed) {
    const failed = (committed.results ?? []).filter((r) => r.error);
    return (
      <Card>
        <CardBody>
          <Alert tone={failed.length ? 'error' : 'success'} title={failed.length ? 'Partly imported' : 'Imported'}>
            {failed.length === 0
              ? `${committed.results?.length ?? 0} activit${(committed.results?.length ?? 0) === 1 ? 'y is' : 'ies are'} in the bank, and the answer keys are in activity_keys where only the marker can read them.`
              : 'Some activities did not import. Fix the errors and run the same file again — importing is idempotent, so nothing will be duplicated.'}
          </Alert>
          <ul className="mt-4 grid gap-1.5 text-[15px]">
            {(committed.results ?? []).map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={r.error ? 'text-[color:var(--danger)]' : 'text-accent'}>
                  {r.error ? '✗' : '✓'}
                </span>
                <span className="font-semibold">{r.title}</span>
                <span className="text-muted">{r.action}</span>
                {r.error && <span className="text-[color:var(--danger)]">{r.error}</span>}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex gap-2">
            <Button onClick={reset} variant="secondary">
              Import another file
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const errors = plan?.errors ?? [];
  const warnings = plan?.warnings ?? [];
  const canCommit = plan?.ok && (plan.plan?.length ?? 0) > 0;

  return (
    <div className="grid gap-4">
      <Card>
        <CardBody>
          <label
            htmlFor="activity-file"
            className={cx(
              'flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed border-line px-6 py-10 text-center transition',
              'hover:border-accent',
            )}
          >
            <p className="text-[17px] font-semibold">
              {fileName ?? 'Choose an activity file'}
            </p>
            <p className="mt-1 text-[14.5px] text-muted">
              A <code className="font-mono">.json</code> file in the Nybble activity format.
              Nothing is written until you press Import.
            </p>
            <input
              ref={fileInput}
              id="activity-file"
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>

          <label className="mt-4 flex items-start gap-2 text-[15px]">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[color:var(--accent)]"
              checked={replace}
              onChange={(e) => {
                setReplace(e.target.checked);
                if (fileJson) void run(fileJson, 'dry-run', e.target.checked);
              }}
            />
            <span>
              <span className="font-semibold">Replace</span>
              <span className="block text-muted">
                Overwrite an existing activity&apos;s steps and keys wholesale. Without this, steps
                are merged by id and any step not in the file is left alone.
              </span>
            </span>
          </label>
        </CardBody>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}

      {busy && <Alert tone="info">Checking the file…</Alert>}

      {errors.length > 0 && (
        <Alert tone="error" title={`${errors.length} problem${errors.length === 1 ? '' : 's'} — nothing will be imported`}>
          <ul className="mt-1 grid gap-1">
            {errors.map((e, i) => (
              <li key={i} className="font-mono text-[13.5px] leading-snug">
                {issueText(e)}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {warnings.length > 0 && (
        <Alert tone="warn" title={`${warnings.length} thing${warnings.length === 1 ? '' : 's'} to look at`}>
          <ul className="mt-1 grid gap-1">
            {warnings.map((w, i) => (
              <li key={i} className="font-mono text-[13.5px] leading-snug">
                {issueText(w)}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {plan?.plan && plan.plan.length > 0 && (
        <Card>
          <CardBody>
            <h3 className="mb-1 text-[18px] font-semibold">What will happen</h3>
            <p className="mb-4 text-[15px] text-muted">
              Nothing has been written yet. Read this, then press Import.
            </p>

            <div className="grid gap-3">
              {plan.plan.map((a) => (
                <div key={a.title + (a.topic ?? '')} className="rounded-card border border-line">
                  <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
                    <Badge tone={a.action === 'create' ? 'accent' : 'warn'}>
                      {a.action === 'create' ? 'New' : 'Updates existing'}
                    </Badge>
                    <p className="text-[16px] font-semibold">{a.title}</p>
                    {a.topic && <span className="text-[14px] text-muted">{a.topic}</span>}
                    <span className="ml-auto text-[13.5px] text-muted">
                      {a.keyCount} answer key{a.keyCount === 1 ? '' : 's'} → activity_keys
                    </span>
                  </div>
                  <ul className="px-4 py-2">
                    {a.steps.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2 py-1 text-[15px]">
                        <span
                          className={cx(
                            'w-4 text-center font-mono',
                            s.action === 'create' && 'text-accent',
                            s.action === 'update' && 'text-[color:var(--warn)]',
                            (s.action === 'kept' || s.action === 'unchanged') && 'text-muted',
                          )}
                        >
                          {s.action === 'create' ? '+' : s.action === 'update' ? '~' : '='}
                        </span>
                        <span className="font-semibold">{s.id}</span>
                        <span className="font-mono text-[13.5px] text-muted">{s.runner_id}</span>
                        <span className="ml-auto text-[13.5px] text-muted">
                          {s.action === 'kept'
                            ? 'already in the database, left alone'
                            : s.hasKey
                              ? 'key stored separately'
                              : 'no key'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {a.notes.map((n, i) => (
                    <p key={i} className="border-t border-line px-4 py-2 text-[14px] text-[color:var(--warn)]">
                      {n}
                    </p>
                  ))}
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                disabled={!canCommit || busy}
                onClick={() => fileJson && run(fileJson, 'commit', replace)}
              >
                {busy ? 'Importing…' : 'Import'}
              </Button>
              <Button variant="quiet" onClick={reset}>
                Choose a different file
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
