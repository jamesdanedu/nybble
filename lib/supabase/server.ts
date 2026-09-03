import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

/**
 * Server-side Supabase client for Server Components, Server Actions and Route
 * Handlers. Anon key — RLS applies, exactly as it does in the browser.
 *
 * `cookies()` is async in Next 15, so this is async too. Create a NEW client
 * per request; never hoist one into a module-level constant, or one user's
 * session leaks into another's request.
 *
 * The setAll try/catch is not optional: Server Components are not allowed to
 * write cookies. Supabase calls setAll when it refreshes an expired token, and
 * in a Server Component that throws.
 *
 * There is still no middleware — it could not run on Vercel's edge runtime, see
 * README "Known sharp edges" — so this swallow is real: a token refreshed
 * during a page render is genuinely discarded. Two things now cover that gap
 * instead, and neither is a Server Component:
 *
 *   components/session-keepalive.tsx  a browser client on every signed-in page,
 *                                     refreshing before expiry while a tab is open
 *   app/auth/refresh/route.ts         a Route Handler, which MAY write cookies,
 *                                     that requireSession() hops through when a
 *                                     token has already expired
 *
 * So do not read this catch as "harmless". It is survivable only because of
 * those two.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component. The middleware already refreshed
          // the session, so there is nothing to recover here.
        }
      },
    },
  });
}
