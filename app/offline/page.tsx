import type { Metadata } from 'next';

/**
 * The one page the service worker keeps, and the only thing a student sees when
 * the network is gone. Precached by public/sw.js and served under whatever URL
 * they were reaching for, so "Try again" is a plain reload of that page.
 *
 * Nothing here may read cookies or query the database: it has to render at
 * build time, and the worker fetches it at install with no session in play.
 *
 * The tone matters. A student mid-attempt needs to know two things — their
 * saved answers are safe, and there is nothing they can do to fix this from
 * here — in that order. Everything up to their last "Saved" was written to the
 * database as they typed, and an unsent submission is refused rather than lost,
 * so reconnecting and pressing Submit again is genuinely all that is needed.
 */
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Offline',
};

export default function Offline() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-12 text-center">
      <p className="text-[22px] font-semibold">You are offline</p>
      <p className="mt-2 text-[15px] text-muted">
        Nybble needs a connection to load an activity and to send an answer.
      </p>
      <p className="mt-4 rounded-card bg-accent-soft p-5 text-[15px] leading-relaxed text-ink">
        Work you had already done is saved. Reconnect, reload, and carry on from where you left
        off.
      </p>
      <p className="mt-6">
        {/* A plain link, not next/link: there is no router to work with here,
            and a full navigation is exactly the retry we want. */}
        <a
          href=""
          className="inline-flex min-h-[40px] items-center rounded-lg border border-accent bg-accent px-4 text-[15px] font-semibold text-[color:var(--accent-ink)]"
        >
          Try again
        </a>
      </p>
      <p className="mt-8 text-[13.5px] text-muted">
        Still offline on the school network? Tell your teacher — it is not something you can fix
        from this screen.
      </p>
    </main>
  );
}
