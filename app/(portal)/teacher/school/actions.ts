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
