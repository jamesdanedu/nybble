'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert, Button, Card, CardBody, Field, Input } from '@/components/ui';
import { createClassGroup } from './actions';

export function NewClassForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>New class</Button>
    );
  }

  return (
    <Card className="w-full">
      <CardBody>
        {error && (
          <div className="mb-3">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        <form
          action={(formData) =>
            start(async () => {
              setError(null);
              const result = await createClassGroup(formData);
              if (result.ok) {
                setOpen(false);
                router.refresh();
              } else {
                setError(result.error ?? 'Could not create the class.');
              }
            })
          }
        >
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Class name" htmlFor="name" hint="What you call it in the timetable.">
              <Input id="name" name="name" required autoFocus placeholder="5th Year CS" />
            </Field>
            <Field label="Year" htmlFor="year_label" hint="Optional.">
              <Input id="year_label" name="year_label" placeholder="2025–2027" />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create class'}
            </Button>
            <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
