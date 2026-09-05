import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { qualifyLabels } from '@/lib/schools-ie/qualify.mjs';

/**
 * The Department of Education's post-primary list, for the admin who is linking
 * their school to its official record.
 *
 * Read with the SIGNED-IN user's client, not the service role, through the
 * `school_directory_public` view: six columns, gated on `is_admin()` inside the
 * view itself, so the database is what decides — and that is the right way
 * round for a screen only an admin can open. The base table holds the
 * Department's contact details as well and is operator-only; nothing an admin
 * can reach reads it. See supabase/migrations/0011_customers.sql. Contrast
 * lib/schools.ts, which reads `schools` with the service role because it serves
 * the sign-in page, where by definition nobody is signed in yet.
 */

/** The view, not the table. The table has columns an admin must not see. */
const DIRECTORY = 'school_directory_public';

export interface DirectorySchool {
  roll_number: string;
  name: string;
  town: string | null;
  county: string | null;
  enrolment: number | null;
  source_year: string | null;
}

/** A directory entry plus the label to show for it in this result set. */
export interface DirectoryMatch extends DirectorySchool {
  /**
   * The name, qualified as far as it has to be: bare when unique, with the town
   * when the name repeats, with the roll number when even that repeats. See
   * lib/schools-ie/qualify.mjs.
   */
  label: string;
}

const COLUMNS = 'roll_number, name, town, county, enrolment, source_year';

/**
 * Escape a user's text for a PostgREST `or=` filter.
 *
 * The filter is a comma-separated list in which commas and parentheses are
 * syntax, so a school called "St Mary's (Convent), Cork" typed into the box
 * would otherwise be read as more filter terms rather than as a search string.
 * Wrapping the pattern in double quotes makes PostgREST treat it as one value;
 * the backslash-escape stops an embedded quote from ending it early.
 */
function forOrFilter(term: string): string {
  return `"%${term.replace(/([\\"])/g, '\\$1')}%"`;
}

/**
 * Search the directory by school name or town.
 *
 * Returns [] for a query too short to be meaningful rather than the first 20
 * schools in the country — an empty box should not look like a search result.
 * The cap exists because this feeds a picker: past about 20 rows nobody is
 * reading, they are retyping.
 */
export async function searchDirectory(query: string, limit = 20): Promise<DirectoryMatch[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const supabase = await createClient();
  const pattern = forOrFilter(q);
  const { data, error } = await supabase
    .from(DIRECTORY)
    .select(COLUMNS)
    .or(`name.ilike.${pattern},town.ilike.${pattern}`)
    .order('name')
    .limit(limit);

  if (error) {
    // An empty directory and a failed query look identical on screen — "no
    // matches" — so the difference has to reach the deployment log.
    console.error('searchDirectory:', error.message);
    return [];
  }

  return withLabels((data ?? []) as DirectorySchool[]);
}

/** One entry by roll number, for showing what a school is currently linked to. */
export async function directoryEntry(roll: string | null): Promise<DirectoryMatch | null> {
  if (!roll) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(DIRECTORY)
    .select(COLUMNS)
    .eq('roll_number', roll)
    .maybeSingle();

  if (error) {
    console.error('directoryEntry:', error.message);
    return null;
  }
  return data ? withLabels([data as DirectorySchool])[0] : null;
}

/** Is the directory populated at all? Distinguishes "no matches" from "not imported". */
export async function directoryCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from(DIRECTORY)
    .select('roll_number', { count: 'exact', head: true });
  if (error) {
    console.error('directoryCount:', error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Attach a display label to each row.
 *
 * Qualification is decided across the rows given, which is deliberate: whether
 * "Loreto Secondary School" is ambiguous depends on what else is on screen. A
 * search for "Loreto" shows eight of them and every one carries its town; a
 * search for "Balbriggan" shows one and it does not need to.
 */
function withLabels(rows: DirectorySchool[]): DirectoryMatch[] {
  const labels = qualifyLabels(rows) as Map<string, string>;
  return rows.map((r) => ({ ...r, label: labels.get(r.roll_number) ?? r.name }));
}
