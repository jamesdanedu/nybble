'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdminSession } from '@/lib/session';

/** Rename is always safe: the name is a label, nothing keys off it. */
export async function renameSchool(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdminSession();
  const name = String(formData.get('name') ?? '').trim();

  if (name.length < 2) return { ok: false, error: 'Give the school a name.' };
  if (name.length > 120) return { ok: false, error: 'That name is too long.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('schools')
    .update({ name })
    .eq('id', session.profile.school_id);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/teacher/school');
  return { ok: true };
}

/**
 * Link this school to its Department of Education record.
 *
 * The roll number is the join, and it is the only thing that has to be written.
 * The name is offered alongside because linking is usually the moment you find
 * out the official name differs from the one somebody typed at setup — but it
 * is a checkbox, not a consequence: a school that calls itself "St Mary's" on
 * screen should not be renamed to "St Marys Secondary School" behind the
 * admin's back.
 *
 * The unique constraint on schools.roll_number is what stops two tenants
 * claiming the same school, and the foreign key is what stops a roll number
 * that is not in the directory. Both are reported as themselves rather than as
 * a raw Postgres error, because "duplicate key value violates unique
 * constraint" is not an answer to "why did that not save".
 */
export async function linkSchoolRecord(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdminSession();
  const roll = String(formData.get('roll_number') ?? '').trim().toUpperCase();
  const adoptName = formData.get('adopt_name') === 'on';

  if (!/^[0-9]{5}[A-Z]$/.test(roll)) {
    return { ok: false, error: 'That is not a roll number. Pick a school from the list.' };
  }

  const supabase = await createClient();

  const patch: { roll_number: string; name?: string } = { roll_number: roll };
  if (adoptName) {
    const { data: entry } = await supabase
      .from('school_directory')
      .select('name')
      .eq('roll_number', roll)
      .maybeSingle();
    if (entry?.name) patch.name = entry.name;
  }

  const { error } = await supabase.from('schools').update(patch).eq('id', session.profile.school_id);

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'Another school on this deployment is already linked to that record.' };
    }
    if (error.code === '23503') {
      return {
        ok: false,
        error: 'That roll number is not in the directory. Import the current list and try again.',
      };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath('/teacher/school');
  return { ok: true };
}

/** Undo the link. Leaves the school's name alone — that is the admin's to set. */
export async function unlinkSchoolRecord(): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdminSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from('schools')
    .update({ roll_number: null })
    .eq('id', session.profile.school_id);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/teacher/school');
  return { ok: true };
}
