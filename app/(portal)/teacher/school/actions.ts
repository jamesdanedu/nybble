'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdminSession } from '@/lib/session';
import { isValidSchoolSlug } from '@/lib/auth-identity';

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
 * Changing the slug is NOT safe once students exist.
 *
 * A student's Supabase account is `<username>@<slug>.portal.invalid`, and that
 * address lives in auth.users where this app cannot rewrite it. Change the slug
 * underneath them and every student login resolves to an address that does not
 * exist — with no error a teacher could interpret, just "does not match".
 *
 * So this refuses whenever the school has a student, and the count is taken
 * here rather than trusted from the page: the button being hidden is a
 * courtesy, not a control.
 */
export async function changeSchoolSlug(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdminSession();
  const slug = String(formData.get('slug') ?? '')
    .trim()
    .toLowerCase();

  if (!isValidSchoolSlug(slug)) {
    return {
      ok: false,
      error:
        'Use 3–32 characters: lowercase letters, numbers and dashes, starting and ending with a letter or number.',
    };
  }

  const supabase = await createClient();

  const { count, error: countError } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', session.profile.school_id)
    .eq('role', 'student');

  if (countError) return { ok: false, error: countError.message };
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `This school has ${count} student account${count === 1 ? '' : 's'}. Their sign-in addresses are built from the current slug, so changing it now would lock them all out.`,
    };
  }

  const { error } = await supabase
    .from('schools')
    .update({ slug })
    .eq('id', session.profile.school_id);

  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      return { ok: false, error: `Another school already uses "${slug}".` };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath('/teacher/school');
  return { ok: true };
}
