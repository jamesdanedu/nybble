import type { Metadata } from 'next';
import Image from 'next/image';
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
      {/*
        The logo carries the wordmark and the tagline itself, so it replaces the
        text heading rather than sitting above a duplicate of it.

        The plate colour is not a token on purpose: logo.png has an opaque
        background baked in at exactly this value, so the plate and the image
        meet with no visible seam. Dropped straight onto --page it would read as
        a grey rectangle in light mode and a bright block in dark; on a plate it
        reads as deliberate in both. Re-export the logo with transparency and
        this wrapper can go.
      */}
      <div className="mb-7 flex justify-center">
        <div className="rounded-card bg-[#edf1f4] p-3">
          <Image
            src="/logo.png"
            alt="Nybble — school computer science activity portal"
            width={529}
            height={556}
            priority
            className="h-auto w-[180px]"
          />
        </div>
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
