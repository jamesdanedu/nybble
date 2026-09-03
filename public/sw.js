/* ---------------------------------------------------------------------------
 * Nybble service worker.
 *
 * READ THIS BEFORE ADDING A CACHE RULE. Two constraints shape everything here,
 * and both are the opposite of what a PWA tutorial will tell you.
 *
 * 1. THIS WORKER CANNOT MAKE ACTIVITIES WORK OFFLINE, and must not pretend to.
 *
 *    Runners are mounted in an iframe sandboxed WITHOUT `allow-same-origin`
 *    (runner-host.js). That gives the runner document an opaque origin, and an
 *    opaque-origin document is not controlled by a service worker. Measured in
 *    Chromium, offline, with every runner asset precached:
 *
 *      not sandboxed                     subresources served from cache
 *      sandbox="allow-scripts"           subresources FAIL
 *      sandbox="allow-scripts
 *               allow-same-origin"       subresources served from cache
 *
 *    The navigation INTO the frame is ours to serve; everything the frame then
 *    asks for — runner.css, runner-sdk.js, the ~950 KB of Skulpt — goes to the
 *    network and fails. The only sandbox that fixes it is the one the runner
 *    contract forbids, because it would hand every runner the portal's Supabase
 *    session. So `/runners/` is skipped entirely below, deliberately: caching it
 *    would cost a megabyte of a student's storage quota and buy nothing.
 *    `test/sw-sandbox-spike.mjs` re-runs the measurement; docs/pwa.md explains it.
 *
 * 2. SCHOOL DEVICES ARE SHARED, so nothing belonging to a student is cached.
 *
 *    No HTML from the portal is stored — not the dashboard, not an attempt, not
 *    even /login. The caches hold build output, icons and an offline notice, and
 *    that is all, so signing out cannot leave the next student holding the
 *    previous one's page. Documents are network-first: a stale assignment list
 *    would be worse than no assignment list.
 *
 * Together those mean this worker buys a home-screen icon, no browser chrome,
 * and a fast warm start — not working through a dropout. That is the honest
 * scope, and it is the one documented for teachers.
 * ------------------------------------------------------------------------ */

/**
 * Bump either name to retire what it holds: `activate` deletes every cache not
 * named here, and that is the whole update mechanism.
 *
 * They are separate because they age differently. SHELL is a fixed, tiny list
 * refetched on install. STATIC fills up at runtime with content-hashed build
 * output whose URLs change on every deploy, so it needs the cap below.
 */
const SHELL = 'nybble-shell-v1';
const STATIC = 'nybble-static-v1';
const KEEP = [SHELL, STATIC];

const OFFLINE_URL = '/offline';

/**
 * Fetched at install. Deliberately tiny: the offline notice, and the icons the
 * app switcher needs. Build output is not listed because its URLs are
 * content-hashed and unknown until something asks for them.
 */
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];

/**
 * How many hashed assets STATIC may hold before the oldest are dropped.
 *
 * Without a cap this cache would grow by a full set of chunks on every deploy
 * and never shrink — the worker's own version rarely changes, so `activate`
 * would not clear it for months. Roughly 80 entries covers a couple of builds'
 * worth of chunks, CSS and fonts, which is all a warm start can use.
 */
const STATIC_MAX = 80;

/**
 * Requests this worker never touches, leaving the browser to behave exactly as
 * it would with no worker installed.
 *
 *   /runners/   See (1). Skipped for subresources AND for the frame's own
 *               navigation: serving the offline notice into the activity box
 *               would render a full-height page inside a small frame. Failing
 *               instead lets RunnerFrame show the message it already has for a
 *               runner that will not load.
 *   /api/, /auth/
 *               Portal routes that read or mutate server state. Never replayed,
 *               never answered from a cache.
 */
function skip(url) {
  return (
    url.pathname.startsWith('/runners/') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/')
  );
}

/**
 * Which cache, if any, may answer a request cache-first — and therefore which
 * one a fresh response is stored in. Every path has exactly one home, so an
 * icon never ends up in both and the trim below can never evict something the
 * offline page depends on.
 */
function cacheFor(url) {
  if (url.pathname.startsWith('/_next/static/')) return STATIC; // content-hashed
  if (url.pathname.startsWith('/icons/')) return SHELL; // fixed, tiny, never trimmed
  return null;
}

/** Drop oldest-first back to the cap. `keys()` is in insertion order. */
async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, keys.length - STATIC_MAX)) await cache.delete(key);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then(async (cache) => {
      // One failure must not fail the whole install: a deploy where /offline is
      // briefly unavailable should still get a working worker, just without the
      // fallback until the next update.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {
            // eslint-disable-next-line no-console
            console.warn(`[sw] could not precache ${url}`);
          }),
        ),
      );
    }),
  );
  // Note: NO skipWaiting(). A new worker taking over mid-attempt could swap
  // assets under a page a student is working in. It activates when their tabs
  // close, which for a lesson-length session is soon enough.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // server actions, sign-out, the scorer

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase, and anything else
  if (skip(url)) return;

  const name = cacheFor(url);
  if (name) {
    event.respondWith(
      caches.open(name).then((cache) =>
        cache.match(request).then(
          (hit) =>
            hit ||
            fetch(request).then((res) => {
              // Only a complete, same-origin success is worth keeping. Caching
              // an error or an opaque response here would serve it for the life
              // of the deployment.
              if (res.ok && res.type === 'basic') {
                const copy = res.clone();
                cache.put(request, copy).then(() => (name === STATIC ? trim(cache) : undefined));
              }
              return res;
            }),
        ),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL);
        // Served under the URL the student was actually reaching for, so the
        // page's "Try again" is a plain reload that lands them where they meant
        // to go rather than back at the front door.
        return (
          (await cache.match(OFFLINE_URL)) ||
          new Response('You are offline.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        );
      }),
    );
  }

  // Everything else — portal data, images, anything unlisted — falls through to
  // the network untouched.
});
