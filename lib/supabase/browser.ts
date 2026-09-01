'use client';

import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/lib/env';

/**
 * The browser Supabase client. Anon key only — every read and write it makes
 * is subject to RLS. It can never see activity_keys.
 *
 * createBrowserClient memoises internally per (url, key), so calling this on
 * every render is cheap and always returns the same client.
 */
export function createClient() {
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
