import type { Metadata } from 'next';
import { env } from '@/lib/env';
import { Alert, Card, CardBody } from '@/components/ui';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; school?: string }>;
}) {
  const params = await searchParams;

  // `?school=` lets one deployment serve more than one school without the
  // student having to type `username@slug`. The slug is not secret — the whole
  // security boundary is RLS on school_id, not knowledge of the slug.
  const schoolSlug = (params.school ?? env.schoolSlug ?? '').trim().toLowerCase();

  // Only ever redirect within this app: an open redirect on a login page is a
  // gift to a phisher.
  const rawNext = params.next ?? '';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-7 text-center">
        <p className="text-[30px] font-semibold tracking-tight">Nybble</p>
        <p className="mt-1 text-[15px] text-muted">
          Computer Science activities
        </p>
      </div>

      <Card>
        <CardBody>
          {!env.configured ? (
            <Alert tone="error" title="Not configured">
              NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from this
              deployment, so nobody can sign in. See <code className="font-mono">.env.example</code>.
            </Alert>
          ) : (
            <LoginForm schoolSlug={schoolSlug} schoolLabel={schoolSlug} next={next} />
          )}
        </CardBody>
      </Card>

      <p className="mt-6 text-center text-[14px] text-muted">
        Just looking?{' '}
        <a className="text-accent underline underline-offset-2" href="/demo.html">
          Try an activity without signing in
        </a>
        .
      </p>
    </main>
  );
}
