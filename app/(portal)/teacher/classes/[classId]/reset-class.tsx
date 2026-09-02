'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, CardBody } from '@/components/ui';
import { CredentialSlips } from '@/components/credential-slips';
import type { ResetResult } from '@/app/api/admin/students/reset/route';

/**
 * Reset every password in the class and reprint the slips.
 *
 * This is the answer to "the sheet went missing" and to "half the class was
 * out the day we set these up". It is destructive — every existing password in
 * the class stops working the moment it runs — so it confirms inline, with the
 * count spelled out, before it does anything.
 */
export function ResetClassPasswords({
  classId,
  classLabel,
  studentCount,
}: {
  classId: string;
  classLabel: string;
  studentCount: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResetResult | null>(null);

  if (studentCount === 0) return null;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/students/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Could not reset the passwords.');
        setBusy(false);
        return;
      }
      setResult(body as ResetResult);
      setConfirming(false);
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    }
    setBusy(false);
  }

  if (result) {
    return (
      <Card>
        <CardBody>
          <CredentialSlips
            title={`${classLabel} — ${result.reset.length} new password${
              result.reset.length === 1 ? '' : 's'
            }`}
            intro="Cut along the dashed lines and give each student their own slip. Their old passwords no longer work."
            credentials={result.reset}
            skipped={result.skipped}
            onDone={() => setResult(null)}
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <h3 className="mb-1 text-[18px] font-semibold">Lost the passwords?</h3>
        <p className="mb-4 text-[15px] text-muted">
          Give everyone in this class a brand new password and print a fresh set of slips. Use
          this when the sheet has gone astray, not when one student has forgotten — there is a
          Reset password button beside each name for that.
        </p>

        {error && (
          <div className="mb-3">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        {confirming ? (
          <>
            <div className="mb-3">
              <Alert tone="warn" title={`This changes ${studentCount} password${studentCount === 1 ? '' : 's'}`}>
                Every student in {classLabel} will be signed out and will need the new slip to get
                back in. There is no undo.
              </Alert>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" disabled={busy} onClick={run}>
                {busy ? 'Resetting…' : `Reset all ${studentCount}`}
              </Button>
              <Button variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Reset all passwords in this class
          </Button>
        )}
      </CardBody>
    </Card>
  );
}
