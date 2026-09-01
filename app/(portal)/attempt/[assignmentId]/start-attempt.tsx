'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert, Button } from '@/components/ui';
import { startAttempt } from './actions';

export function StartAttempt({ assignmentId, label }: { assignmentId: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      {error && (
        <div className="mb-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await startAttempt(assignmentId);
            if (result.ok) router.refresh();
            else setError(result.error ?? 'Could not start.');
          })
        }
      >
        {pending ? 'Opening…' : label}
      </Button>
    </div>
  );
}
