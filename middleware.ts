import type { NextRequest } from 'next/server';
// Imported by relative path, not the `@/` alias. Vercel's deploy-time Edge
// Function check reports `@/lib/supabase/middleware` as an unsupported
// module and rejects the deployment, even though the build inlines it fine.
import { updateSession } from './lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
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
