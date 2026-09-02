'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { renameSchool } from './actions';

function useAction(run: (fd: FormData) => Promise<{ ok: boolean; error?: string }>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDone(false);
    setBusy(true);
    const result = await run(new FormData(e.currentTarget));
    setBusy(false);
    if (result.ok) {
      setDone(true);
      router.refresh();
    } else {
      setError(result.error ?? 'That did not work.');
    }
  }

  return { onSubmit, error, done, busy };
}

export function RenameSchoolForm({ name }: { name: string }) {
  const { onSubmit, error, done, busy } = useAction(renameSchool);

  return (
    <form onSubmit={onSubmit}>
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {done && (
        <div className="mb-4">
          <Alert tone="success">Saved.</Alert>
        </div>
      )}
      <Field label="School name" htmlFor="name" hint="Shown in the header and on printed slips.">
        <Input id="name" name="name" defaultValue={name} required maxLength={120} />
      </Field>
      <Button type="submit" disabled={busy} className="mt-3">
        {busy ? 'Saving…' : 'Save name'}
      </Button>
    </form>
  );
}
