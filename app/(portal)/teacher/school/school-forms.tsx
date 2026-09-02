'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { renameSchool, changeSchoolSlug } from './actions';

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

export function ChangeSlugForm({ slug, studentCount }: { slug: string; studentCount: number }) {
  const { onSubmit, error, done, busy } = useAction(changeSchoolSlug);
  const locked = studentCount > 0;

  if (locked) {
    return (
      <Alert tone="warn" title="The slug is locked">
        This school has {studentCount} student account{studentCount === 1 ? '' : 's'}. Every one of
        them signs in as <code className="font-mono">username@{slug}.portal.invalid</code>, and that
        address is fixed when the account is made. Changing the slug now would lock them all out
        with nothing but a &ldquo;does not match&rdquo; message to go on.
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {done && (
        <div className="mb-4">
          <Alert tone="success">Saved. Update NEXT_PUBLIC_SCHOOL_SLUG to match, then redeploy.</Alert>
        </div>
      )}
      <Field
        label="Slug"
        htmlFor="slug"
        hint="Lowercase letters, numbers and dashes. Students never see it, but it forms their sign-in address."
      >
        <Input id="slug" name="slug" defaultValue={slug} required pattern="[a-z0-9][a-z0-9-]{1,30}[a-z0-9]" />
      </Field>
      <p className="mt-2 text-[14px] text-muted">
        Editable only because no student accounts exist yet. Once the first one is created this
        locks, so get it right now.
      </p>
      <Button type="submit" disabled={busy} className="mt-3">
        {busy ? 'Saving…' : 'Save slug'}
      </Button>
    </form>
  );
}
