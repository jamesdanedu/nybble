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

/**
 * Always rendered per request, never prerendered.
 *
 * This page branches on the session, so it has to read cookies — but it only
 * reaches the code that reads them when Supabase is configured. With the env
 * vars absent at build time, `getSession()` returns at its `configured` guard
 * before touching `cookies()`, Next sees no dynamic API, and prerenders `/` as
 * a static file. That file then greets a signed-in user with a Sign in button
 * for the life of the deployment, because it physically cannot see their
 * cookies. Which of the two you get depends on whether the build machine had
 * the env vars — the front door should not be deciding that by accident.
 */
export const dynamic = 'force-dynamic';

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
    <main className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8 py-16">
      <div className="mb-1 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-[54px] font-extrabold leading-none tracking-[-0.035em]">
          Nybble
        </h1>
        <span className="rounded-full bg-accent px-4 py-1.5 font-mono text-[12.5px] font-semibold tracking-wider text-accent-ink">
          0100 1110
        </span>
      </div>
      <p className="mt-6 max-w-2xl font-display text-[26px] font-semibold leading-tight tracking-[-0.015em]">
        An activity portal for Leaving Certificate Computer Science.
      </p>
      <p className="mt-3.5 max-w-2xl text-base leading-relaxed text-muted [text-wrap:pretty]">
        Parsons problems, quizzes and number base tests — set to a class or an individual,
        marked automatically where it can be, reviewed by a teacher where it can&rsquo;t.
      </p>

      <div className="mt-8">
        <Link
          href="/login"
          className="inline-flex h-[52px] items-center rounded-full bg-accent px-8 text-base font-bold text-accent-ink hover:brightness-110"
        >
          Sign in
        </Link>
      </div>

      <h2 className="mt-14 text-xs font-bold uppercase tracking-[0.1em] text-muted">
        Try an activity
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {[
          { href: '/demo.html?activity=numbase', title: 'Binary & hex',    glyph: '0b',  tint: 'bg-accent-soft', pen: 'text-accent', chip: 'bg-accent',  blurb: 'Generated from a seed, so every student gets a different paper.' },
          { href: '/demo.html?activity=parsons', title: 'Parsons problem', glyph: '{ }', tint: 'bg-info-soft',   pen: 'text-info',   chip: 'bg-info',    blurb: 'Reorder the lines and set the indentation. Two lines do not belong.' },
          { href: '/demo.html?activity=mcq',     title: 'Multiple choice', glyph: 'A?',  tint: 'bg-warn-soft',   pen: 'text-warn',   chip: 'bg-warn',    blurb: 'Code in the stem, single or multiple answers, marked-up review.' },
        ].map((c) => (
          <a
            key={c.href}
            href={c.href}
            className={`block rounded-card p-6 transition hover:-translate-y-0.5 ${c.tint}`}
          >
            <span className={`flex h-11 w-11 items-center justify-center rounded-[14px] font-mono text-[15px] font-bold text-page ${c.chip}`}>
              {c.glyph}
            </span>
            <h3 className="mt-4 font-display text-[21px] font-bold tracking-[-0.02em]">{c.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed opacity-80">{c.blurb}</p>
            <div className={`mt-5 text-[14.5px] font-bold ${c.pen}`}>Open &rarr;</div>
          </a>
        ))}
      </div>
      <p className="mt-5 rounded-card bg-warn-soft p-6 text-[15px] leading-relaxed">
        <strong className="mb-1.5 block text-xs font-bold uppercase tracking-[0.1em] text-warn">Demo</strong>
        These are real activities, but marked in your browser and not saved — no sign-in needed.
        There is also a <a className="font-semibold text-warn underline" href="/harness.html">developer harness</a> that
        shows every message crossing the sandbox boundary.
      </p>

      <h2 className="mt-14 text-xs font-bold uppercase tracking-[0.1em] text-muted">
        What&rsquo;s built
      </h2>
      <ul className="mt-4 flex flex-col gap-2">
        {BUILT.map((row) => (
          <li
            key={row.text}
            className="flex flex-wrap items-center gap-3.5 rounded-2xl bg-surface px-5 py-3.5"
          >
            <span
              className={`rounded-full px-3 py-1 text-[12.5px] font-bold uppercase tracking-wider ${
                row.state === 'done' ? 'bg-accent-soft text-accent' : 'bg-raised text-muted'
              }`}
            >
              {row.state}
            </span>
            <span className="text-[15px]">{row.text}</span>
          </li>
        ))}
      </ul>

      <footer className="mt-14 text-[14.5px] text-muted">
        Source and protocol spec on{' '}
        <a className="text-accent" href="https://github.com/jamesdanedu/nybble">GitHub</a>. A nybble is
        four bits — half a byte, and one hex digit.
      </footer>
    </main>
  );
}
