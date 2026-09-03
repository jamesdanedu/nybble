'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { linkSchoolRecord, renameSchool, unlinkSchoolRecord } from './actions';

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

/**
 * Claim one directory entry as this school's official record.
 *
 * A form per result rather than a radio group and one submit, because the list
 * is a search result: it is replaced on the next keystroke-and-enter, and a
 * selection that does not survive that is a selection nobody made. One button
 * per row means the click IS the choice.
 */
export function LinkRecordButton({
  roll,
  officialName,
  differentName,
}: {
  roll: string;
  /** The Department's name for the school — NOT the qualified search label. */
  officialName: string;
  differentName: boolean;
}) {
  const { onSubmit, error, busy } = useAction(linkSchoolRecord);

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="roll_number" value={roll} />
      {/*
        Only offered where it would actually change something. A checkbox that
        says "also use the official name" beside a school already called that is
        a decision about nothing.
      */}
      {differentName && (
        <label className="flex items-center gap-2 text-[14px] text-muted">
          <input type="checkbox" name="adopt_name" defaultChecked className="h-4 w-4" />
          Use “{officialName}” as the school name too
        </label>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Linking…' : 'Link'}
      </Button>
      {error && <span className="text-[14px] text-danger">{error}</span>}
    </form>
  );
}

/** Break the link. Deliberately plain — it changes one nullable column. */
export function UnlinkRecordButton() {
  const { onSubmit, error, busy } = useAction(() => unlinkSchoolRecord());

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-3">
      <Button type="submit" variant="quiet" disabled={busy}>
        {busy ? 'Unlinking…' : 'Unlink'}
      </Button>
      {error && <span className="text-[14px] text-danger">{error}</span>}
    </form>
  );
}
