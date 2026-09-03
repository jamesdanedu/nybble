import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { REFRESH_GUARD_COOKIE } from '@/lib/session';
import { env } from '@/lib/env';
import { safeReturnTo } from '@/lib/return-to.mjs';

/**
 * Roll an expired access token over, and WRITE the result.
 *
 * This exists because middleware does not. Every deployment of `middleware.ts`
 * returned 500 MIDDLEWARE_INVOCATION_FAILED on this project — including one cut
 * down to a single `next/server` import, which rules out anything this repo
 * puts in the bundle (see README, "Known sharp edges", and commit 7194665).
 * Removing it got the site serving and cost the token refresh, because the
 * middleware was the only thing writing a refreshed session.
 *
 * A Route Handler can do that job. The reason is narrow and worth stating: a
 * Server Component may READ cookies but never write them, so when supabase-js
 * refreshes a token during a page render its `setAll` throws and the new token
 * is dropped on the floor. A Route Handler is allowed to write, and it runs on
 * the Node runtime rather than the edge, which is where the middleware failed.
 *
 * Why the drop matters more than it looks: Supabase ROTATES refresh tokens. A
 * refresh that is not persisted leaves the browser holding the previous one,
 * and once the reuse window closes that token is dead — so a session that
 * merely needed refreshing gets destroyed instead. That is the mechanism behind
 * "signed out mid-lesson for no reason".
 *
 * GET is correct here, unlike sign-out. This is idempotent, it is only ever
 * reached by a redirect from `requireSession()`, and the worst a hostile
 * <img src> can achieve is refreshing a session that its owner wanted anyway.
 */
export async function GET(request: NextRequest) {
  // Constructing a client without the env vars throws, and this route is
  // reachable by anyone typing the URL. An unconfigured deployment should send
  // them to the login page that can explain itself, not a 500.
  if (!env.configured) {
    return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
  }

  const supabase = await createClient();

  // getUser(), not getSession(): it revalidates against the auth server, and
  // revalidating is what performs the refresh. The cookie write then happens
  // inside this handler, where it is legal.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const returnTo = safeReturnTo(request.headers.get('referer'), request.url);
  const target = new URL(returnTo, request.url);
  const response = NextResponse.redirect(target, { status: 303 });

  if (user) {
    // Refreshed. Clear the guard so the next expiry can hop again.
    response.cookies.set(REFRESH_GUARD_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  }

  // The refresh token is gone or rejected — this is a real sign-out, not a
  // recoverable expiry. Set the guard before bouncing so that `requireSession`
  // sends the next request straight to /login instead of back here: without
  // it, a dead session and a redirect that keeps retrying it is an infinite
  // loop, which is a far worse failure than being asked to sign in.
  const login = new URL('/login', request.url);
  if (returnTo !== '/') login.searchParams.set('next', returnTo);
  const bounce = NextResponse.redirect(login, { status: 303 });
  bounce.cookies.set(REFRESH_GUARD_COOKIE, '1', {
    path: '/',
    maxAge: 30, // seconds: long enough to break a loop, short enough to forget
    httpOnly: true,
    sameSite: 'lax',
  });
  return bounce;
}
