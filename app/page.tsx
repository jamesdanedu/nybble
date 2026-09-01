import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession, isStaff } from '@/lib/session';

/**
 * The front door.
 *
 * Signed in, you go straight to your work. Signed out, you get the public
 * landing page rather than a bare login form — the demos are the fastest way to
 * show a colleague what this is, and they need no account.
 *
 * This replaced the old static `public/index.html`, which claimed the same URL.
 * A static file and an app route are two answers to `/`, and Next only picks
 * one; the app wins, so the static page is gone and its content lives here.
 */

const BUILT: Array<{ state: 'done' | 'next' | 'later'; text: string }> = [
  { state: 'done',  text: 'Postgres schema, multi-tenant row level security, guard triggers' },
  { state: 'done',  text: 'Runner contract — new activity types without redeploying the portal' },
  { state: 'done',  text: 'MCQ, number base and Parsons runners' },
  { state: 'done',  text: 'Server-side scorer, the only code that reads an answer key' },
  { state: 'done',  text: 'Portal — login, classes, assignments, review queue, activity import' },
  { state: 'later', text: 'PRIMM step sequences, AI-assisted feedback' },
];

export default async function Home() {
  const session = await getSession();
  if (session) {
    if (session.profile.must_change_password) redirect('/change-password');
    redirect(isStaff(session.profile) ? '/teacher' : '/dashboard');
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-1 flex items-baseline gap-3">
        <h1 className="text-4xl font-bold tracking-tight">Nybble</h1>
        <span className="rounded-full border border-border px-3 py-0.5 font-mono text-xs text-muted">
          0100 1110
        </span>
      </div>
      <p className="max-w-lg text-lg text-muted">
        An activity portal for Leaving Certificate Computer Science.
      </p>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Parsons problems, quizzes and number base tests — set to a class or an individual,
        marked automatically where it can be, reviewed by a teacher where it can&rsquo;t.
      </p>

      <div className="mt-8">
        <Link
          href="/login"
          className="inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110"
        >
          Sign in
        </Link>
      </div>

      <h2 className="mt-12 text-xs font-semibold uppercase tracking-wider text-muted">
        Try an activity
      </h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          { href: '/demo.html?activity=numbase', title: 'Binary & hex', blurb: 'Generated from a seed, so every student gets a different paper.' },
          { href: '/demo.html?activity=parsons', title: 'Parsons problem', blurb: 'Reorder the lines and set the indentation. Two lines do not belong.' },
          { href: '/demo.html?activity=mcq',     title: 'Multiple choice', blurb: 'Code in the stem, single or multiple answers, marked-up review.' },
        ].map((c) => (
          <a
            key={c.href}
            href={c.href}
            className="block rounded-xl border border-border bg-surface p-5 transition hover:-translate-y-0.5 hover:border-accent"
          >
            <h3 className="font-semibold">{c.title}</h3>
            <p className="mt-1.5 text-sm text-muted">{c.blurb}</p>
            <div className="mt-3 text-sm font-semibold text-accent">Open →</div>
          </a>
        ))}
      </div>
      <p className="mt-4 rounded-xl border border-amber bg-amber-soft p-4 text-sm">
        <strong className="mb-1 block text-xs uppercase tracking-wide text-amber">Demo</strong>
        These are real activities, but marked in your browser and not saved — no sign-in needed.
        There is also a <a className="text-amber underline" href="/harness.html">developer harness</a> that
        shows every message crossing the sandbox boundary.
      </p>

      <h2 className="mt-12 text-xs font-semibold uppercase tracking-wider text-muted">
        What&rsquo;s built
      </h2>
      <ul className="mt-4">
        {BUILT.map((row) => (
          <li key={row.text} className="flex items-baseline gap-3 border-b border-border py-2.5 last:border-0">
            <span
              className={`w-14 shrink-0 font-mono text-xs ${
                row.state === 'done' ? 'text-accent' : 'text-muted'
              }`}
            >
              {row.state}
            </span>
            <span className="text-[15px]">{row.text}</span>
          </li>
        ))}
      </ul>

      <footer className="mt-14 border-t border-border pt-5 text-sm text-muted">
        Source and protocol spec on{' '}
        <a className="text-accent" href="https://github.com/jamesdanedu/nybble">GitHub</a>. A nybble is
        four bits — half a byte, and one hex digit.
      </footer>
    </main>
  );
}
