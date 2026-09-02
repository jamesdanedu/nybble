import type { Metadata } from 'next';
import Image from 'next/image';
import { env } from '@/lib/env';
import { resolveSchoolForLogin } from '@/lib/schools';
import { Alert, Card, CardBody } from '@/components/ui';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; school?: string }>;
}) {
  const params = await searchParams;

  // Which school a bare username belongs to. Read from the database rather than
  // from configuration: with one school in the deployment, that school IS the
  // answer, and an environment variable disagreeing with it is a mistake rather
  // than an intention. `?school=` still wins, and the env var remains the
  // fallback for a deployment with no service role key to look anything up with.
  //
  // The slug is not secret — the security boundary is RLS on school_id, not
  // knowledge of the slug.
  const school = await resolveSchoolForLogin(params.school);
  const schoolSlug = school.slug;

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
            <>
              {school.choices.length > 1 && (
                <div className="mb-5">
                  <p className="mb-2 text-[14px] text-muted">
                    {school.slug ? 'Signing in to' : 'Which school?'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {school.choices.map((c) => (
                      <a
                        key={c.id}
                        href={`/login?school=${encodeURIComponent(c.slug)}${
                          next !== '/' ? `&next=${encodeURIComponent(next)}` : ''
                        }`}
                        className={
                          c.slug === school.slug
                            ? 'inline-flex min-h-[44px] items-center rounded-full bg-accent px-4 text-[15px] font-semibold text-accent-ink'
                            : 'inline-flex min-h-[44px] items-center rounded-full border border-line px-4 text-[15px] text-ink hover:border-accent'
                        }
                      >
                        {c.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <LoginForm schoolSlug={schoolSlug} schoolLabel={school.label} next={next} />
            </>
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
