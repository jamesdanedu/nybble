'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * The last line of defence. Anything that throws in a Server Component — a
 * dropped database connection, an RLS policy refusing a read the UI assumed —
 * lands here rather than on a white screen.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-12">
      <p className="text-[22px] font-semibold">Something went wrong</p>
      <p className="mt-2 text-[15px] text-muted">
        Nothing you had already submitted is lost. Try again — and if it keeps happening, tell your
        teacher{error.digest ? ` and quote ${error.digest}` : ''}.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={reset}
          className="inline-flex min-h-[40px] items-center rounded-lg border border-accent bg-accent px-4 text-[15px] font-semibold text-[color:var(--accent-ink)]"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex min-h-[40px] items-center rounded-lg border border-line px-4 text-[15px] font-semibold"
        >
          Back to your work
        </Link>
      </div>
    </main>
  );
}
