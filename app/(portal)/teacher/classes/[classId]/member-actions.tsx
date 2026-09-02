'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert, Button } from '@/components/ui';
import type { ResetResult } from '@/app/api/admin/students/reset/route';
import { addExistingStudents, removeStudent } from '../actions';

/**
 * Per-student actions. Both are destructive-ish, so both confirm inline rather
 * than with `window.confirm` — a native dialog on a projector is unreadable
 * from the back of the room.
 */
export function MemberActions({
  classId,
  profileId,
  displayName,
}: {
  classId: string;
  profileId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState<null | 'remove' | 'reset'>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState<{ username: string; password: string } | null>(
    null,
  );

  async function doReset() {
    setMessage(null);
    const res = await fetch('/api/admin/students/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId }),
    });
    const body = await res.json();
    if (!res.ok) {
      setMessage(body.error ?? 'Could not reset the password.');
      return;
    }
    const { reset } = body as ResetResult;
    setNewPassword({ username: reset[0].username, password: reset[0].password });
    setConfirming(null);
  }

  if (newPassword) {
    return (
      <div className="text-right">
        <p className="text-[13px] text-muted">
          New password for {displayName} ({newPassword.username})
        </p>
        <p className="font-mono text-[17px] font-semibold">{newPassword.password}</p>
        <button
          type="button"
          className="text-[13px] text-muted underline"
          onClick={() => setNewPassword(null)}
        >
          Hide
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {message && (
        <span className="text-[13.5px] text-[color:var(--danger)]">{message}</span>
      )}

      {confirming === 'remove' ? (
        <>
          <span className="text-[14px] text-muted">Remove from this class?</span>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await removeStudent(classId, profileId);
                if (!result.ok) setMessage(result.error ?? 'Could not remove.');
                setConfirming(null);
                router.refresh();
              })
            }
          >
            Remove
          </Button>
          <Button variant="quiet" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
        </>
      ) : confirming === 'reset' ? (
        <>
          <span className="text-[14px] text-muted">Give a new password?</span>
          <Button variant="secondary" onClick={doReset}>
            Reset
          </Button>
          <Button variant="quiet" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Button variant="quiet" onClick={() => setConfirming('reset')}>
            Reset password
          </Button>
          <Button variant="quiet" onClick={() => setConfirming('remove')}>
            Remove
          </Button>
        </>
      )}
    </div>
  );
}

export function AddExistingStudents({
  classId,
  candidates,
}: {
  classId: string;
  candidates: { id: string; display_name: string; username: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!candidates.length) return null;

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Add someone already on the system
      </Button>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-4">
      {error && (
        <div className="mb-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <p className="mb-2 text-[15px] font-semibold">
        Students in the school who are not in this class
      </p>
      <ul className="mb-3 max-h-64 overflow-y-auto">
        {candidates.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-3 py-1.5 text-[15px]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[color:var(--accent)]"
                checked={selected.has(c.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  setSelected(next);
                }}
              />
              <span>{c.display_name}</span>
              <span className="ml-auto font-mono text-[13.5px] text-muted">{c.username}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          disabled={pending || selected.size === 0}
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await addExistingStudents(classId, [...selected]);
              if (!result.ok) {
                setError(result.error ?? 'Could not add them.');
                return;
              }
              setSelected(new Set());
              setOpen(false);
              router.refresh();
            })
          }
        >
          {pending ? 'Adding…' : `Add ${selected.size || ''}`.trim()}
        </Button>
        <Button variant="quiet" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
