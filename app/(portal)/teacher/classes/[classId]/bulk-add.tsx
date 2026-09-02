'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, CardBody, Field, Textarea } from '@/components/ui';
import { CredentialSlips } from '@/components/credential-slips';
import { parseRoster, assignUsernames } from '@/lib/roster';
import type { StudentCreateResult } from '@/app/api/admin/students/route';

/**
 * Paste a list of names, get accounts.
 *
 * The preview runs `parseRoster` + `assignUsernames` in the browser with the
 * usernames already in the school, and the server runs the SAME two functions
 * before it writes. So the usernames on screen are the usernames created, and a
 * teacher can spot "aoifemurphy2" before it is printed on a slip rather than
 * after.
 *
 * Passwords come back exactly once, in the response. They are not stored in
 * plain text anywhere, so if this page is closed before printing, the fix is a
 * reset — per student, or for the whole class — not a lookup.
 */
export function BulkAddStudents({
  classId,
  classLabel,
  takenUsernames,
}: {
  classId: string;
  classLabel: string;
  takenUsernames: string[];
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StudentCreateResult | null>(null);

  const taken = useMemo(() => new Set(takenUsernames), [takenUsernames]);
  const parsed = useMemo(() => parseRoster(text), [text]);
  const good = useMemo(() => parsed.filter((r) => !r.error), [parsed]);
  const preview = useMemo(() => assignUsernames(good, taken), [good, taken]);
  const problems = parsed.filter((r) => r.error);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, classId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Could not create the accounts.');
        setBusy(false);
        return;
      }
      setResult(body as StudentCreateResult);
      setText('');
      router.refresh();
    } catch {
      setError('Could not reach the server. Nothing was created — try again.');
    }
    setBusy(false);
  }

  /* --- the printable slips ---------------------------------------------- */
  if (result) {
    return (
      <Card>
        <CardBody>
          <CredentialSlips
            title={`${classLabel} — ${result.created.length} new account${
              result.created.length === 1 ? '' : 's'
            }`}
            intro="Cut along the dashed lines and give each student their own slip."
            credentials={result.created}
            skipped={result.skipped}
            onDone={() => setResult(null)}
          />
        </CardBody>
      </Card>
    );
  }

  /* --- the paste box ----------------------------------------------------- */
  return (
    <Card>
      <CardBody>
        <h3 className="mb-1 text-[18px] font-semibold">Add students</h3>
        <p className="mb-4 text-[15px] text-muted">
          Paste one name per line, or two columns (name, then username) from a spreadsheet or CSV.
          Accounts and passwords are generated for you.
        </p>

        {error && (
          <div className="mb-3">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        <Field label="Names" htmlFor="roster">
          <Textarea
            id="roster"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Aoife Ní Bhriain\nSeán Ó Ceallaigh\nJack Murphy'}
            spellCheck={false}
            className="min-h-[160px] font-mono text-[15px]"
          />
        </Field>

        {problems.length > 0 && (
          <div className="mb-3">
            <Alert tone="warn" title={`${problems.length} line${problems.length === 1 ? '' : 's'} will be skipped`}>
              <ul className="mt-1 list-disc pl-5">
                {problems.slice(0, 6).map((p) => (
                  <li key={p.line}>
                    Line {p.line}: {p.error}
                  </li>
                ))}
              </ul>
            </Alert>
          </div>
        )}

        {preview.length > 0 && (
          <div className="mb-4 rounded-card border border-line">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <p className="text-[14px] font-semibold">
                {preview.length} account{preview.length === 1 ? '' : 's'} will be created
              </p>
              <Badge>Preview</Badge>
            </div>
            <ul className="max-h-56 overflow-y-auto px-4 py-2 text-[15px]">
              {preview.map(({ row, username }) => (
                <li key={username} className="flex justify-between gap-4 py-0.5">
                  <span className="truncate">{row.displayName}</span>
                  <span className="font-mono text-muted">{username}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button onClick={submit} disabled={busy || preview.length === 0}>
          {busy
            ? 'Creating…'
            : preview.length === 0
              ? 'Create accounts'
              : `Create ${preview.length} account${preview.length === 1 ? '' : 's'}`}
        </Button>
      </CardBody>
    </Card>
  );
}
