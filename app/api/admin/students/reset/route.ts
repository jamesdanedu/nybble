import { NextResponse, type NextRequest } from 'next/server';
import { NotStaffError, requireStaff } from '@/lib/supabase/service';
import { generatePassword } from '@/lib/auth-identity';

/* ===========================================================================
 * POST /api/admin/students/reset — give new passwords out.
 *
 * There is no "forgotten password" email, because there is no email: the
 * address is synthetic and unroutable by design. A teacher resetting it and
 * handing the new one over is the whole recovery story.
 *
 * Two shapes, one set of guards:
 *
 *   { profileId }  one student
 *   { classId }    every student in that class, in one go
 *
 * The class form exists because the realistic failure is not "one student
 * forgot" — it is "the sheet of passwords went in the bin and nobody can sign
 * in". Resetting thirty accounts one at a time, reading a code off the screen
 * each time, is the sort of chore that ends with a class set of passwords
 * being changed to the same word.
 *
 * The same three guards as the bulk create route apply either way: caller
 * verified through their own session, every target checked to be in the
 * caller's school, and the new passwords returned once and never stored.
 * ======================================================================== */

export const dynamic = 'force-dynamic';

export interface ResetCredential {
  displayName: string;
  username: string;
  password: string;
}
export interface ResetResult {
  reset: ResetCredential[];
  /** Names we could not reset, with the reason. Empty in the single case. */
  skipped: { displayName: string; reason: string }[];
}

interface TargetRow {
  id: string;
  school_id: string;
  role: string;
  username: string;
  display_name: string;
}

export async function POST(request: NextRequest) {
  let profile, admin;
  try {
    ({ profile, admin } = await requireStaff());
  } catch (e) {
    const err = e as NotStaffError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 403 });
  }

  let body: { profileId?: string; classId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 });
  }
  if (!body.profileId && !body.classId) {
    return NextResponse.json({ error: 'profileId or classId is required.' }, { status: 400 });
  }

  const columns = 'id, school_id, role, username, display_name';
  let targets: TargetRow[] = [];

  if (body.classId) {
    // The class itself has to be ours before its membership means anything.
    const { data: group } = await admin
      .from('class_groups')
      .select('id, school_id, name')
      .eq('id', body.classId)
      .maybeSingle();
    if (!group || group.school_id !== profile.school_id) {
      return NextResponse.json({ error: 'That is not one of your classes.' }, { status: 403 });
    }

    const { data: memberRows } = await admin
      .from('class_members')
      .select('profile_id')
      .eq('class_group_id', body.classId);
    const ids = (memberRows ?? []).map((m) => m.profile_id as string);
    if (!ids.length) {
      return NextResponse.json({ error: 'That class has no students in it.' }, { status: 400 });
    }

    const { data } = await admin
      .from('profiles')
      .select(columns)
      .in('id', ids)
      .eq('school_id', profile.school_id) // belt and braces; the service role has no RLS
      .eq('role', 'student') // a teacher in a class is never swept up by a class reset
      .eq('archived', false)
      .order('display_name');
    targets = (data ?? []) as TargetRow[];
    if (!targets.length) {
      return NextResponse.json({ error: 'That class has no active students.' }, { status: 400 });
    }
  } else {
    const { data: target } = await admin
      .from('profiles')
      .select(columns)
      .eq('id', body.profileId as string)
      .maybeSingle<TargetRow>();

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
    targets = [target];
  }

  const reset: ResetCredential[] = [];
  const skipped: { displayName: string; reason: string }[] = [];

  for (const target of targets) {
    const password = generatePassword();
    const { error: updateError } = await admin.auth.admin.updateUserById(target.id, { password });
    if (updateError) {
      // One failure does not sink the batch: the rest still get usable slips,
      // and the teacher is told exactly who to chase.
      skipped.push({ displayName: target.display_name, reason: updateError.message });
      continue;
    }
    // Force them to choose their own again at next sign-in.
    await admin.from('profiles').update({ must_change_password: true }).eq('id', target.id);
    reset.push({
      displayName: target.display_name,
      username: target.username,
      password,
    });
  }

  if (!reset.length) {
    return NextResponse.json(
      { error: skipped[0]?.reason ?? 'Could not reset any passwords.' },
      { status: 500 },
    );
  }

  const result: ResetResult = { reset, skipped };
  return NextResponse.json(result);
}
