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

/** For pages behind the gate. Middleware already bounced anonymous requests. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export async function requireStudentOrStaff(): Promise<Session> {
  const session = await requireSession();
  if (session.profile.must_change_password) redirect('/change-password');
  return session;
}

export function isStaff(profile: Profile): boolean {
  return profile.role === 'teacher' || profile.role === 'admin';
}

export async function requireStaffSession(): Promise<Session> {
  const session = await requireStudentOrStaff();
  if (!isStaff(session.profile)) redirect('/dashboard');
  return session;
}
