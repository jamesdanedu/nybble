import { NextResponse, type NextRequest } from 'next/server';
import { NotStaffError, requireStaff } from '@/lib/supabase/service';
import { generatePassword, syntheticEmail } from '@/lib/auth-identity';
import { assignUsernames, parseRoster } from '@/lib/roster';

/* ===========================================================================
 * POST /api/admin/students — create student accounts in bulk.
 *
 * This is one of only three places that touch the service role, and the only
 * one a student could conceivably reach, so read the guards carefully:
 *
 *   1. `requireStaff()` verifies the CALLER with their own session and the anon
 *      key. RLS on `profiles` means it can only ever return the caller's own
 *      row, so the role it reports cannot be spoofed by the request body.
 *   2. `school_id` comes from that verified profile. It is never read from the
 *      body — otherwise a teacher in one school could create accounts in
 *      another, which is the exact boundary the whole schema is built around.
 *   3. `role` is hard-coded to 'student'. There is deliberately no way to mint
 *      a teacher from here.
 *
 * The generated passwords are returned exactly once, in this response, and are
 * never stored anywhere in plain text. `must_change_password` is true, so the
 * first thing each student does is replace it.
 * ======================================================================== */

export const dynamic = 'force-dynamic';

interface Body {
  /** Raw pasted names/CSV. Parsed server-side with the same parser the UI used. */
  text?: string;
  /** Optional class to drop everyone into as they are created. */
  classId?: string | null;
}

export interface CreatedStudent {
  displayName: string;
  username: string;
  password: string;
}
export interface StudentCreateResult {
  created: CreatedStudent[];
  skipped: { displayName: string; reason: string }[];
}

export async function POST(request: NextRequest) {
  let profile, admin;
  try {
    ({ profile, admin } = await requireStaff());
  } catch (e) {
    const err = e as NotStaffError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 });
  }

  const rows = parseRoster(body.text ?? '').filter((r) => !r.error);
  if (!rows.length) {
    return NextResponse.json({ error: 'No usable names in that list.' }, { status: 400 });
  }
  if (rows.length > 200) {
    return NextResponse.json(
      { error: 'That is more than 200 names. Do it in two goes.' },
      { status: 400 },
    );
  }

  // The school's slug forms the synthetic email domain.
  if (!profile.school_id) {
    return NextResponse.json(
      { error: 'Your profile has no school. Ask an admin to set one before adding students.' },
      { status: 500 },
    );
  }
  const { data: school, error: schoolError } = await admin
    .from('schools')
    .select('id, slug')
    .eq('id', profile.school_id)
    .maybeSingle();
  if (schoolError || !school) {
    // Reaching here means the SERVICE-ROLE client could not read a school the
    // caller's own session can already see — the portal header is showing its
    // name. That is not a data problem, it is a key problem: a publishable or
    // anon key in SUPABASE_SERVICE_ROLE_KEY is subject to row-level security,
    // so it reads nothing and says nothing. Say so, rather than blaming the
    // profile.
    return NextResponse.json(
      {
        error:
          'The server could not read your school with its admin key. ' +
          'Check SUPABASE_SERVICE_ROLE_KEY in the deployment environment — it ' +
          'must be the secret / service_role key, not the publishable one.' +
          (schoolError ? ` (${schoolError.message})` : ''),
      },
      { status: 500 },
    );
  }

  // If a class was named, it must belong to the caller's school. The service
  // role would happily write across the boundary, so check it here.
  let classId: string | null = null;
  if (body.classId) {
    const { data: group } = await admin
      .from('class_groups')
      .select('id, school_id')
      .eq('id', body.classId)
      .maybeSingle();
    if (!group || group.school_id !== profile.school_id) {
      return NextResponse.json({ error: 'That class is not one of yours.' }, { status: 403 });
    }
    classId = group.id as string;
  }

  const { data: existing } = await admin
    .from('profiles')
    .select('username')
    .eq('school_id', profile.school_id);
  const taken = new Set((existing ?? []).map((p) => p.username as string));

  const assigned = assignUsernames(rows, taken);

  const created: CreatedStudent[] = [];
  const skipped: { displayName: string; reason: string }[] = [];
  const newProfileIds: string[] = [];

  for (const { row, username } of assigned) {
    const password = generatePassword();
    const email = syntheticEmail(username, school.slug as string);

    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      // No mailbox exists behind a .invalid address, so confirming by email is
      // impossible; confirm here or the account can never sign in.
      email_confirm: true,
      user_metadata: { display_name: row.displayName },
    });

    if (authError || !authUser?.user) {
      skipped.push({
        displayName: row.displayName,
        reason: authError?.message ?? 'Could not create the sign-in account.',
      });
      continue;
    }

    const { error: profileError } = await admin.from('profiles').insert({
      id: authUser.user.id,
      school_id: profile.school_id,
      role: 'student',
      username,
      display_name: row.displayName,
      must_change_password: true,
    });

    if (profileError) {
      // Roll the auth user back rather than leaving an account that can sign in
      // but has no profile — that user would hit an empty portal and no policy
      // would ever match them.
      await admin.auth.admin.deleteUser(authUser.user.id).catch(() => {});
      skipped.push({ displayName: row.displayName, reason: profileError.message });
      continue;
    }

    newProfileIds.push(authUser.user.id);
    created.push({ displayName: row.displayName, username, password });
  }

  if (classId && newProfileIds.length) {
    await admin.from('class_members').upsert(
      newProfileIds.map((profile_id) => ({ class_group_id: classId, profile_id })),
      { onConflict: 'class_group_id,profile_id', ignoreDuplicates: true },
    );
  }

  const result: StudentCreateResult = { created, skipped };
  return NextResponse.json(result);
}
