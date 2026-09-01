'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession, isStaff } from '@/lib/session';

/**
 * Class management. All of it goes through the teacher's own session, so
 * `class_staff_write` and `member_staff_write` are what actually authorise it —
 * these actions add a friendly error message, not a security boundary.
 */

async function staffOrThrow() {
  const session = await getSession();
  if (!session || !isStaff(session.profile)) {
    throw new Error('Teachers only.');
  }
  return session;
}

export async function createClassGroup(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await staffOrThrow();
  const name = String(formData.get('name') ?? '').trim();
  const yearLabel = String(formData.get('year_label') ?? '').trim();

  if (!name) return { ok: false, error: 'Give the class a name, e.g. "5th Year CS".' };

  const supabase = await createClient();
  const { error } = await supabase.from('class_groups').insert({
    school_id: session.profile.school_id,
    name,
    year_label: yearLabel || null,
    teacher_id: session.profile.id,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/teacher/classes');
  return { ok: true };
}

export async function renameClassGroup(
  classId: string,
  name: string,
  yearLabel: string,
): Promise<{ ok: boolean; error?: string }> {
  await staffOrThrow();
  if (!name.trim()) return { ok: false, error: 'A class needs a name.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('class_groups')
    .update({ name: name.trim(), year_label: yearLabel.trim() || null })
    .eq('id', classId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/teacher/classes');
  revalidatePath(`/teacher/classes/${classId}`);
  return { ok: true };
}

/**
 * Archive rather than delete. `class_groups` cascades to `class_members` and to
 * `assignments`, which cascades to `attempts` — deleting a class would silently
 * destroy every piece of work ever handed up through it.
 */
export async function archiveClassGroup(classId: string): Promise<{ ok: boolean; error?: string }> {
  await staffOrThrow();
  const supabase = await createClient();
  const { error } = await supabase.from('class_groups').update({ archived: true }).eq('id', classId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/teacher/classes');
  return { ok: true };
}

export async function addExistingStudents(
  classId: string,
  profileIds: string[],
): Promise<{ ok: boolean; error?: string; added: number }> {
  await staffOrThrow();
  if (!profileIds.length) return { ok: true, added: 0 };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from('class_members')
    .upsert(
      profileIds.map((profile_id) => ({ class_group_id: classId, profile_id })),
      { onConflict: 'class_group_id,profile_id', ignoreDuplicates: true, count: 'exact' },
    );
  if (error) return { ok: false, error: error.message, added: 0 };

  revalidatePath(`/teacher/classes/${classId}`);
  return { ok: true, added: count ?? profileIds.length };
}

/**
 * Take a student out of a class. Their profile and their work stay: removing
 * them from `class_members` only stops future class assignments reaching them.
 */
export async function removeStudent(
  classId: string,
  profileId: string,
): Promise<{ ok: boolean; error?: string }> {
  await staffOrThrow();
  const supabase = await createClient();
  const { error } = await supabase
    .from('class_members')
    .delete()
    .eq('class_group_id', classId)
    .eq('profile_id', profileId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/teacher/classes/${classId}`);
  return { ok: true };
}
