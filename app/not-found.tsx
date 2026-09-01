import Link from 'next/link';

/**
 * 404. Deliberately gives a way onward rather than an apology: a student who
 * lands here mid-lesson needs a button, not an explanation.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-12 text-center">
      <p className="text-[22px] font-semibold">That page is not here</p>
      <p className="mt-2 text-[15px] text-muted">
        It may have been unassigned, or the link may be out of date.
      </p>
      <p className="mt-6">
        <Link
          href="/"
          className="inline-flex min-h-[40px] items-center rounded-lg border border-accent bg-accent px-4 text-[15px] font-semibold text-[color:var(--accent-ink)]"
        >
          Back to your work
        </Link>
      </p>
    </main>
  );
}
