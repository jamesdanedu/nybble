import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession, isStaff } from '@/lib/session';
import { Alert, Card, CardBody } from '@/components/ui';
import { ChangePasswordForm } from './change-password-form';

export const metadata: Metadata = { title: 'Change your password' };

export default async function ChangePasswordPage() {
  const { profile } = await requireSession();
  const forced = profile.must_change_password;
  const destination = isStaff(profile) ? '/teacher' : '/dashboard';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-6">
        <p className="text-[26px] font-semibold tracking-tight">
          {forced ? 'Choose your own password' : 'Change your password'}
        </p>
        <p className="mt-1 text-[15px] text-muted">Signed in as {profile.display_name}.</p>
      </div>

      {forced && (
        <div className="mb-4">
          <Alert tone="warn">
            You are using the password your teacher gave you. Pick your own before you carry on —
            it takes ten seconds and it means nobody else can submit work as you.
          </Alert>
        </div>
      )}

      <Card>
        <CardBody>
          <ChangePasswordForm forced={forced} destination={destination} />
        </CardBody>
      </Card>

      {!forced && (
        <p className="mt-5 text-center text-[14px] text-muted">
          <Link href={destination} className="text-accent underline underline-offset-2">
            Back
          </Link>
        </p>
      )}
    </main>
  );
}
