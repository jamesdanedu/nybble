import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '../env';

/** Paths that never need a session. Everything else is behind the gate. */
const PUBLIC_PREFIXES = ['/login', '/auth', '/api/public'];

/** Static assets that Next serves from public/ — the runners live here. */
function isStaticAsset(pathname: string) {
  return (
    pathname.startsWith('/runners/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/demo.html' ||
    pathname === '/harness.html' ||
    pathname === '/favicon.ico' ||
    /\.(?:html|js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?|map|txt|json)$/.test(pathname)
  );
}

/**
 * Session refresh + route gate.
 *
 * The order of operations here is the part people get wrong with @supabase/ssr:
 *
 *  1. Build a response object up front.
 *  2. Give the Supabase client a `setAll` that writes to BOTH the incoming
 *     request cookies (so anything later in this same request sees the fresh
 *     token) and the outgoing response (so the browser gets it).
 *  3. Call `getUser()` — not `getSession()`. getSession trusts whatever is in
 *     the cookie; getUser revalidates it against the auth server. Calling it
 *     is what actually triggers the refresh.
 *  4. Return the very response object whose cookies were mutated. If you
 *     build a fresh NextResponse after this point you throw the refreshed
 *     session away and the user is silently logged out a minute later.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!env.configured) {
    // No Supabase configured (e.g. a preview build). Let everything through
    // rather than bouncing every request to a login page that cannot work.
    return response;
  }

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic =
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/')) ||
    isStaticAsset(pathname);

  if (!user && !isPublic) {
    // A route handler called by fetch() wants a status code, not a redirect to
    // an HTML login page — a 307 there turns into a confusing JSON parse error
    // in the caller rather than "you are signed out".
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Come back to where they were trying to go once they are in.
    if (pathname !== '/') url.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === '/login/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
