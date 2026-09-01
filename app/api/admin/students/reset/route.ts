import { NextResponse, type NextRequest } from 'next/server';
import { NotStaffError, requireStaff } from '@/lib/supabase/service';
import { generatePassword } from '@/lib/auth-identity';

/* ===========================================================================
 * POST /api/admin/students/reset — give one student a new password.
 *
 * There is no "forgotten password" email, because there is no email: the
 * address is synthetic and unroutable by design. A teacher resetting it and
 * reading the new one out is the whole recovery story.
 *
 * Same three guards as the bulk create route: caller verified through their own
 * session, target checked to be in the caller's school, and the new password
 * returned once and never stored.
 * ======================================================================== */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let profile, admin;
  try {
    ({ profile, admin } = await requireStaff());
  } catch (e) {
    const err = e as NotStaffError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 403 });
  }

  let body: { profileId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 });
  }
  if (!body.profileId) {
    return NextResponse.json({ error: 'profileId is required.' }, { status: 400 });
  }

  const { data: target } = await admin
    .from('profiles')
    .select('id, school_id, role, username, display_name')
    .eq('id', body.profileId)
    .maybeSingle();

  if (!target || target.school_id !== profile.school_id) {
    return NextResponse.json({ error: 'That is not one of your students.' }, { status: 403 });
  }
  // A teacher may reset a student. Resetting another teacher's password is an
  // admin job and is deliberately not offered here.
  if (target.role !== 'student' && profile.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only an admin can reset a teacher password.' },
      { status: 403 },
    );
  }

  const password = generatePassword();
  const { error: updateError } = await admin.auth.admin.updateUserById(target.id as string, {
    password,
  });
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Force them to choose their own again at next sign-in.
  await admin.from('profiles').update({ must_change_password: true }).eq('id', target.id);

  return NextResponse.json({
    username: target.username,
    displayName: target.display_name,
    password,
  });
}
