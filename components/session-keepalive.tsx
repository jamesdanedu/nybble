'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { env } from '@/lib/env';

/**
 * Keep the signed-in session rolling over while a tab is open.
 *
 * `createBrowserClient` starts a timer that refreshes the access token shortly
 * before it expires and writes the new one back to the cookie — but only while
 * a client exists. Before this component, one was created on exactly three
 * pages: login, change-password, and the attempt screen. A student reading
 * their results, or a teacher working through the review queue, had nothing
 * refreshing anything, and an hour in the access token simply expired.
 *
 * Mounted in the portal layout, so every signed-in page has one. It renders
 * nothing; the point is the client's existence, not its output.
 *
 * This is the half of the job that can be done in the browser. It cannot help
 * a student who closes the laptop and comes back tomorrow, because no timer
 * runs while the tab is shut and the expired token is read on the server before
 * any of this executes — that case is /auth/refresh's, via requireSession().
 * The two together are what the middleware used to do alone.
 */
export function SessionKeepalive() {
  const router = useRouter();

  useEffect(() => {
    if (!env.configured) return;
    const supabase = createClient();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      // Deliberately narrow. TOKEN_REFRESHED needs nothing from React — the
      // client has already written the cookie, and the next server render will
      // read it. Calling router.refresh() on every refresh would re-render the
      // server tree under a student mid-activity for no benefit.
      //
      // SIGNED_OUT is different: the cookie is gone, so the page on screen is
      // showing work behind a session that no longer exists. Re-rendering lets
      // requireSession() do its job and send them to /login, which on a shared
      // school device is the difference between the next student seeing the
      // previous one's dashboard and not.
      if (event === 'SIGNED_OUT') router.refresh();
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return null;
}
