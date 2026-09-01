import { NextResponse } from 'next/server';

/**
 * PROBE — not the real middleware. Revert once this question is answered.
 *
 * The question: can this project run *any* middleware on Vercel's edge runtime?
 *
 * Production and every preview return 500 MIDDLEWARE_INVOCATION_FAILED on all
 * matched paths. A diagnostic build that wrapped the entire handler — including
 * a dynamic import of the Supabase chain, so module init was inside the guard —
 * still returned a bare 500 rather than the caught exception. Nothing in our
 * chain throws; the handler is not reaching our code.
 *
 * So this reduces the middleware to the smallest thing that can exist: one
 * import, no session, no Supabase, no env, no matcher exclusions to get wrong.
 *
 *   - this works  -> middleware is viable here, and the fault is something the
 *                    real middleware pulls in. Bisect from here.
 *   - this 500s   -> no middleware of any shape runs on this deployment. The
 *                    fault is the platform or the Next version, not our code,
 *                    and the fix is `experimental.nodeMiddleware` (needs a Next
 *                    canary) or Vercel support.
 *
 * Note the auth gate is gone while this is deployed. That costs nothing today,
 * because Supabase is not configured and `updateSession` returns immediately
 * anyway — but it must not stay past this experiment.
 */
export function middleware() {
  return NextResponse.next({ headers: { 'x-mw-probe': 'ran' } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|runners/|.*\\.[^/]+$).*)'],
};
