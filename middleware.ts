import { NextResponse, type NextRequest } from 'next/server';

/**
 * TEMPORARY DIAGNOSTIC — remove once the production 500 is understood.
 *
 * Production returns 500 MIDDLEWARE_INVOCATION_FAILED on every path this
 * matcher covers, and Vercel surfaces only the error code, not the exception.
 * The same bundle initialises and returns 200 when run in @edge-runtime/vm,
 * so the fault does not reproduce off Vercel. This catches the throw and
 * renders it in the response instead, which makes the browser the log reader.
 *
 * `updateSession` is imported inside the try on purpose: a static import is
 * hoisted and evaluated before this function runs, so a failure while
 * initialising that module — or anything it pulls in — would escape the catch
 * and 500 exactly as it does now. Loading it here brings that inside.
 *
 * `next/server` is still imported at module scope and cannot be guarded. So:
 *
 *   - a readable error page  → the throw is in our chain, and it is named
 *   - a normal page          → the middleware runs fine now
 *   - still a bare 500       → nothing in our chain threw, and the fault is
 *                              outside it: the Vercel runtime itself, module
 *                              init of next/server, or a limit (memory) that
 *                              no try/catch can intercept
 *
 * Every outcome narrows it, which is the point.
 */
export async function middleware(request: NextRequest) {
  try {
    const { updateSession } = await import('./lib/supabase/middleware');
    const response = await updateSession(request);
    // Lets you confirm in devtools that the middleware ran, on a page that
    // renders normally and therefore says nothing on its own.
    response.headers.set('x-mw-diagnostic', 'ok');
    return response;
  } catch (err) {
    const e = err as Partial<Error> | undefined;
    const body = [
      'nybble middleware diagnostic',
      '',
      'The middleware threw. This page is the caught exception, not the site.',
      '',
      `path    : ${request.nextUrl.pathname}`,
      `name    : ${e?.name ?? typeof err}`,
      `message : ${e?.message ?? String(err)}`,
      '',
      'stack:',
      e?.stack ?? '(no stack)',
    ].join('\n');

    return new NextResponse(body, {
      // 200 so the platform renders this rather than replacing it with its
      // own error page, which is what hid the exception in the first place.
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-mw-diagnostic': 'threw',
      },
    });
  }
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  - _next/static, _next/image, favicon
     *  - /runners/** and the two static demo pages, which are plain files in
     *    public/ and must keep working at their existing URLs with no session
     *  - anything with a file extension (public/ assets generally)
     *
     * Written as a negative lookahead because Next's matcher does not support
     * "all paths except" any other way.
     */
    '/((?!_next/static|_next/image|favicon.ico|runners/|.*\\.[^/]+$).*)',
  ],
};
