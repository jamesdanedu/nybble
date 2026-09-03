import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
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

/**
 * What the portal does, in the present tense.
 *
 * This replaced a done/next/later build checklist. That list was scaffolding —
 * it tracked the order things got built in, which mattered while they were
 * being built and matters to nobody arriving at the front door now. A teacher
 * reading this has one question, "what would this do for me", and a roadmap
 * answers a different one. Anything genuinely unbuilt belongs in the README,
 * where the audience is someone deciding whether to contribute.
 */
const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: 'Set work to a class or one student',
    body: 'Assignments carry a due date and an attempt limit. A student sees only what is set to them, enforced in the database rather than in the page that draws the list.',
  },
  {
    title: 'Marked before the student leaves the page',
    body: 'Multiple choice, number bases and Parsons problems are marked server-side, by the one piece of code that is allowed to read an answer key. The browser never sees it.',
  },
  {
    title: 'A review queue for everything a machine cannot mark',
    body: 'Written answers and open-ended code land in front of the teacher with a mark box per step, the student\u2019s work replayed beside it, and marks released when you choose.',
  },
  {
    title: 'Five kinds of activity, and a contract for the sixth',
    body: 'Multiple choice, binary and hex, Parsons problems, written answers, and real Python running in the browser. A new type is an HTML file and a database row \u2014 no portal redeploy.',
  },
  {
    title: 'PRIMM sequences, start to finish',
    body: 'Predict, Run, Investigate, Modify, Make as one five-step activity. Each phase is weighted and marked in the way that suits it, and Investigate quotes the student\u2019s own prediction back at them.',
  },
  {
    title: 'Installable on a phone or Chromebook',
    body: 'Add it to the home screen and it opens like an app. Activities still need a connection: an install a teacher believes works offline is worse than no install at all.',
  },
];

/**
 * TEMPORARY DIAGNOSTIC — delete once the sign-in problem is understood.
 *
 * Reports why getSession() came back null, which is otherwise silent: the page
 * simply renders signed-out and says nothing about whether the cookie was
 * missing, the token was rejected, or the profile row could not be read.
 *
 * Reachable only at /?debug=1, and it reports cookie NAMES, never values — a
 * session token pasted into a bug report is a session someone else can use.
 */
async function diagnose() {
  const jar = await cookies();
  const sbCookies = jar
    .getAll()
    .map((c) => c.name)
    .filter((n) => n.startsWith('sb-'));

  const lines: string[] = [
    `env.configured        ${env.configured}`,
    `supabase url set      ${env.supabaseUrl ? 'yes' : 'NO'}`,
    `anon key set          ${env.supabaseAnonKey ? 'yes' : 'NO'}`,
    `school slug           ${env.schoolSlug || '(unset)'}`,
    `sb-* cookies seen     ${sbCookies.length ? sbCookies.join(', ') : 'NONE — the server received no session cookie'}`,
  ];

  if (!env.configured) {
    lines.push('stopped               env not configured, so no lookup was attempted');
    return lines;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      lines.push(`auth.getUser()        REJECTED — ${error.message}`);
      return lines;
    }
    if (!data.user) {
      lines.push('auth.getUser()        returned no user (token absent or expired)');
      return lines;
    }
    lines.push(`auth.getUser()        ok — ${data.user.id}`);

    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle();
    if (pErr) {
      lines.push(`profiles lookup       ERROR — ${pErr.message}`);
    } else if (!profile) {
      lines.push('profiles lookup       no row visible to this user (missing row, or RLS denied it)');
    } else {
      lines.push(
        `profiles lookup       ok — role=${profile.role} archived=${profile.archived} must_change_password=${profile.must_change_password}`,
      );
    }
  } catch (err) {
    lines.push(`threw                 ${err instanceof Error ? err.message : String(err)}`);
  }
  return lines;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ debug?: string }>;
}) {
  const debug = (await searchParams).debug === '1';
  const session = await getSession();
  if (session) {
    if (session.profile.must_change_password) redirect('/change-password');
    redirect(isStaff(session.profile) ? '/teacher' : '/dashboard');
  }

  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8 py-16">
      {debug && (
        <pre className="mb-8 overflow-x-auto rounded-card bg-raised p-5 font-mono text-[13px] leading-relaxed text-ink">
          {(await diagnose()).join('\n')}
        </pre>
      )}
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
        Quizzes, number bases, Parsons problems, written answers and Python in the browser —
        set to a class or an individual, marked automatically where it can be, reviewed by a
        teacher where it can&rsquo;t.
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
        What it does
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-card bg-surface p-6">
            <h3 className="font-display text-[19px] font-bold tracking-[-0.02em]">{f.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted [text-wrap:pretty]">{f.body}</p>
          </div>
        ))}
      </div>

      <footer className="mt-14 text-[14.5px] text-muted">
        Source and protocol spec on{' '}
        <a className="text-accent" href="https://github.com/jamesdanedu/nybble">GitHub</a>. A nybble is
        four bits — half a byte, and one hex digit.
      </footer>
    </main>
  );
}
