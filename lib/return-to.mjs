/* ===========================================================================
 * return-to.mjs — where an auth redirect is allowed to send someone.
 *
 * Kept in its own dependency-free module so it can be tested directly. It used
 * to live inside app/auth/refresh/route.ts, which imports next/server and so
 * cannot be loaded outside a Next runtime — and this is precisely the logic
 * that most deserves a test.
 * ======================================================================== */

/**
 * The path to return to after refreshing a session, from a Referer header.
 *
 * Referer is used because a Server Component cannot tell the refresh route
 * which URL it was rendering — `requireSession()` redirects without knowing its
 * own path. Referer is also attacker-influenced, so this is deliberately
 * paranoid and returns '/' for anything it is not certain about.
 *
 * An open redirect on an auth route is a phishing primitive: a link that really
 * does go to the school's portal, really does sign the student in, and then
 * lands them somewhere else entirely.
 *
 * @param {string|null|undefined} referer  the Referer header, verbatim
 * @param {string} selfUrl                 the URL this request arrived at
 * @returns {string} a same-origin path with query, or '/'
 */
export function safeReturnTo(referer, selfUrl) {
  if (!referer) return '/';

  let url;
  let self;
  try {
    url = new URL(referer);
    self = new URL(selfUrl);
  } catch {
    return '/';
  }

  // Origin comparison, not a prefix test on the string. `origin` covers scheme,
  // host and port together, so `http://` against `https://`, a lookalike host
  // like nybble.example.evil.test, and the protocol-relative `//evil.example`
  // (which a bare startsWith('/') check waves straight through as if it were a
  // path) are all refused by the same line.
  if (url.origin !== self.origin) return '/';

  // Returning to an auth route is how a redirect loop gets built.
  if (url.pathname.startsWith('/auth/')) return '/';

  return url.pathname + url.search;
}
