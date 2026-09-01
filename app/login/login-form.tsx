'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { loginErrorMessage, resolveLoginEmail } from '@/lib/auth-identity';
import { Alert, Button, Field, Input } from '@/components/ui';

/**
 * Username + password login.
 *
 * Sign-in happens in the BROWSER, not in a server action. That is on purpose:
 * @supabase/ssr's browser client writes the session cookies itself, the
 * middleware picks them up on the very next request, and there is no round trip
 * where a server action has to hand cookies back. It is also the fastest path,
 * which matters when thirty people log in at 09:03 on a Monday.
 *
 * The synthetic email (`<username>@<slug>.portal.invalid`) is constructed here
 * and never shown. Errors are rewritten by loginErrorMessage() so a raw
 * Supabase message cannot leak it back into the UI either.
 */
export function LoginForm({ schoolSlug, schoolLabel, next }: {
  schoolSlug: string;
  schoolLabel: string;
  next: string;
}) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const resolved = resolveLoginEmail(identifier, schoolSlug);
    if (!resolved.ok) {
      setError(resolved.message);
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: resolved.email,
        password,
      });
      if (signInError) {
        setError(loginErrorMessage(signInError.message));
        setBusy(false);
        return;
      }
      // router.refresh() makes the Server Components re-run with the new
      // cookies before we navigate, so the destination is not rendered against
      // a stale (signed-out) session.
      router.refresh();
      router.replace(next || '/');
    } catch (err) {
      setError(loginErrorMessage(err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <Field
        label="Username"
        htmlFor="identifier"
        hint={schoolLabel ? `Signing in to ${schoolLabel}.` : undefined}
      >
        <Input
          id="identifier"
          name="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          required
          autoFocus
          placeholder="e.g. aoifemurphy"
        />
      </Field>

      <Field label="Password" htmlFor="password">
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            enterKeyHint="go"
            required
            className="pr-20"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[14px] font-semibold text-muted hover:text-accent"
            aria-pressed={showPassword}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </Field>

      <Button type="submit" disabled={busy} className="mt-2 w-full">
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>

      <p className="mt-5 text-center text-[14px] text-muted">
        Forgotten your password? Your teacher can reset it — there is no email to send.
      </p>
    </form>
  );
}
