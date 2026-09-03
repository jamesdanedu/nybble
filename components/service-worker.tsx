'use client';

import { useEffect } from 'react';

/**
 * Registers public/sw.js. Renders nothing.
 *
 * Development is deliberately excluded. A worker holding `/_next/static/` will
 * fight the dev server's hot reload, and the resulting "my change did nothing"
 * is a nasty half-hour. `next build && next start` is how to see it working
 * locally — the same way the deploy will run it.
 *
 * Registration failure is logged and otherwise ignored: the portal works
 * perfectly well without a worker, and a school proxy serving sw.js with the
 * wrong content type should not take the site down with it.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    // After load, not during: registration competes for bandwidth with the
    // page a student is waiting on, and the first visit is the one that has
    // nothing cached yet.
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[nybble] service worker registration failed', err);
      });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
