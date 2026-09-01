'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { Alert, Button, Field, Input } from '@/components/ui';
import { clearMustChangePassword } from './actions';

const MIN_LENGTH = 8;

export function ChangePasswordForm({ forced, destination }: { forced: boolean; destination: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Make it at least ${MIN_LENGTH} characters. A short sentence works well.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      const msg = updateError.message.toLowerCase();
      setError(
        msg.includes('should be different')
          ? 'That is the password you already have. Pick a new one.'
          : msg.includes('weak') || msg.includes('short')
            ? 'That password is too easy to guess. Try a short sentence instead.'
            : 'Could not change the password. Try again, and tell your teacher if it keeps failing.',
      );
      setBusy(false);
      return;
    }

    // The auth password is changed at this point regardless of what happens
    // next, so a failure here must not send the student back to a form that
    // will reject their old password. Show the error and let them continue.
    const result = await clearMustChangePassword();
    if (!result.ok) {
      setError(
        'Your password was changed, but the portal could not clear the "must change password" ' +
          'flag, so it may ask again. Tell your teacher: ' + (result.error ?? ''),
      );
      setBusy(false);
      return;
    }

    router.refresh();
    router.replace(destination);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <Field
        label="New password"
        htmlFor="password"
        hint={`At least ${MIN_LENGTH} characters. Something you can remember and nobody else would guess.`}
      >
        <Input
          id="password"
          type={show ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          autoFocus
        />
      </Field>

      <Field label="Type it again" htmlFor="confirm">
        <Input
          id="confirm"
          type={show ? 'text' : 'password'}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </Field>

      <label className="mb-4 flex items-center gap-2 text-[15px] text-muted">
        <input
          type="checkbox"
          checked={show}
          onChange={(e) => setShow(e.target.checked)}
          className="h-4 w-4 accent-[color:var(--accent)]"
        />
        Show what I am typing
      </label>

      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Saving…' : forced ? 'Save and continue' : 'Change password'}
      </Button>
    </form>
  );
}
