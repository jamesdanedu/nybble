import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import type { Profile, School } from '@/lib/types';

export interface Session {
  userId: string;
  profile: Profile;
  school: School | null;
}

/**
 * The signed-in user's profile, or null.
 *
 * Always `getUser()`, never `getSession()`: getSession reads the cookie and
 * believes it, which is fine in the browser but not on a server where the
 * cookie is attacker-controlled input. getUser revalidates with the auth server.
 */
export async function getSession(): Promise<Session | null> {
  // Before the Supabase env vars are set there is no session to have, and
  // constructing a client throws. The public pages — landing, demos — and a
  // login screen that can explain itself must still render, so treat
  // "not configured" as "signed out" rather than letting it 500.
  if (!env.configured) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // profile_self_read lets you see your own row, so this needs no elevation.
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle<Profile>();
  if (!profile) return null;

  // school_read is `id = current_school_id()`, so this returns the one school
  // this user belongs to, or nothing.
  const { data: school } = await supabase
    .from('schools')
    .select('*')
    .eq('id', profile.school_id)
    .maybeSingle<School>();

  return { userId: user.id, profile, school: school ?? null };
}

/**
 * Short-lived marker saying "we already tried to refresh and it failed".
 *
 * Set by /auth/refresh, read here. It is the loop guard: without it, a session
 * whose refresh token is genuinely dead would bounce between this function and
 * the refresh route for ever. Exported so the route and the guard cannot drift
 * apart on a string literal.
 */
export const REFRESH_GUARD_COOKIE = 'nybble-refresh-tried';

/** Does the browser hold a Supabase auth cookie at all? */
async function hasAuthCookie(): Promise<boolean> {
  const jar = await cookies();
  // @supabase/ssr writes `sb-<ref>-auth-token`, and splits it into
  // `.0`, `.1`, … when it outgrows one cookie. Match the family, not one name.
  return jar.getAll().some((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));
}

/**
 * For pages behind the gate.
 *
 * There is no middleware on this deployment — every version of it returned 500
 * MIDDLEWARE_INVOCATION_FAILED, see README "Known sharp edges" — so nothing
 * bounces anonymous requests before a page renders, and every protected page
 * calls this itself.
 *
 * The refresh hop is the other half of what the middleware used to do. A
 * Server Component cannot write cookies, so when an access token has expired
 * this function has no way to roll it over: `getSession()` comes back null and
 * the honest-looking answer, /login, would sign out a student whose refresh
 * token is perfectly good. So instead: if the browser is carrying a Supabase
 * cookie, hand the request to /auth/refresh, which is a Route Handler and IS
 * allowed to write, and let it come back here with a fresh token.
 *
 * Three distinct cases, deliberately kept apart:
 *
 *   no auth cookie      never signed in, or signed out → /login, no hop
 *   guard cookie set    the hop already ran and failed → /login, no loop
 *   otherwise           an expiry worth trying to recover → /auth/refresh
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (session) return session;

  const jar = await cookies();
  if (jar.get(REFRESH_GUARD_COOKIE) || !(await hasAuthCookie())) redirect('/login');
  redirect('/auth/refresh');
}

export async function requireStudentOrStaff(): Promise<Session> {
  const session = await requireSession();
  if (session.profile.must_change_password) redirect('/change-password');
  return session;
}

export function isStaff(profile: Profile): boolean {
  return profile.role === 'teacher' || profile.role === 'admin';
}

/** Admin only. Editing the school record is not a teacher's job. */
export function isAdmin(profile: Profile): boolean {
  return profile.role === 'admin';
}

export async function requireAdminSession(): Promise<Session> {
  const session = await requireStaffSession();
  if (!isAdmin(session.profile)) redirect('/teacher');
  return session;
}

export async function requireStaffSession(): Promise<Session> {
  const session = await requireStudentOrStaff();
  if (!isStaff(session.profile)) redirect('/dashboard');
  return session;
}

/**
 * Is this user an operator — the one role that sees every school?
 *
 * A separate question from `profile.role`, and deliberately so: the operator
 * is a row in `operators`, not a fourth value of user_role, because a profile
 * belongs to a school and the operator belongs to none. In practice the
 * operator is also the admin of a house tenant used for demos, which is why
 * this still needs a session with a profile. See
 * supabase/migrations/0011_customers.sql.
 *
 * `operator_self_read` lets a user see their own row and nobody else's, so
 * this is a plain select with the caller's own client and no elevation.
 */
export async function isOperator(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('operators')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

/** Operator only. Anyone else is bounced to wherever their role lives. */
export async function requireOperatorSession(): Promise<Session> {
  const session = await requireStudentOrStaff();
  if (!(await isOperator(session.userId))) {
    redirect(isStaff(session.profile) ? '/teacher' : '/dashboard');
  }
  return session;
}
