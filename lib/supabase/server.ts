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
 * in a Server Component that throws. Swallowing it is safe *because* the
 * middleware (lib/supabase/middleware.ts) refreshes the session on every
 * request and writes the refreshed cookies there, where writing is legal.
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
