import type { Metadata } from 'next';
import { requireAdminSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { directoryCount, directoryEntry, searchDirectory } from '@/lib/school-directory';
import { normaliseName } from '@/lib/schools-ie/qualify.mjs';
import { Alert, Card, CardBody, Empty, Input, Page, PageHeader, Section, Stat } from '@/components/ui';
import { LinkRecordButton, RenameSchoolForm, UnlinkRecordButton } from './school-forms';

export const metadata: Metadata = { title: 'School' };
export const dynamic = 'force-dynamic';

/**
 * The school record, for an admin.
 *
 * Deliberately does not show the slug. It is plumbing — it exists to build
 * `<username>@<slug>.portal.invalid` for accounts that have no real address —
 * and a teacher has no decision to make about it. It is also immutable in
 * practice once a single student exists, because their sign-in address is fixed
 * in auth.users where this app cannot rewrite it. Showing a field that cannot
 * be changed and should not be thought about is worse than not showing it.
 *
 * The roll number is the opposite case and that is why it is here: it is the
 * Department of Education's identifier for this school, it is stable across
 * renames, and it is the one field that ties a tenant to a real school in the
 * real world. See supabase/migrations/0009_school_directory.sql.
 */
export default async function SchoolPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireAdminSession();
  const supabase = await createClient();
  const query = ((await searchParams).q ?? '').trim();

  const [{ count: students }, { count: staff }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', session.profile.school_id)
      .eq('role', 'student'),
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', session.profile.school_id)
      .in('role', ['teacher', 'admin']),
  ]);

  const school = session.school;
  const linked = await directoryEntry(school?.roll_number ?? null);

  // Only searched when asked, and the count is only needed to tell "no school
  // matches that" apart from "nobody has run the importer yet" — two identical
  // empty screens with completely different fixes.
  const results = query ? await searchDirectory(query) : [];
  const total = query && results.length === 0 ? await directoryCount() : -1;

  return (
    <Page>
      <PageHeader title="School" subtitle="Admin only. Teachers do not see this page." />

      {!school ? (
        <Alert tone="error" title="No school record">
          Your profile points at a school that could not be read.
        </Alert>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <Stat label="Students" value={students ?? 0} />
            <Stat label="Teachers and admins" value={staff ?? 0} />
          </div>

          <Section title="Name">
            <Card>
              <CardBody>
                <RenameSchoolForm name={school.name} />
              </CardBody>
            </Card>
          </Section>

          <Section title="Official record">
            <Card>
              <CardBody>
                {linked ? (
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="font-display text-[19px] font-bold tracking-[-0.02em]">
                        {linked.name}
                      </p>
                      <p className="mt-1 text-[15px] text-muted">
                        {[linked.town, linked.county].filter(Boolean).join(', ')}
                      </p>
                      <p className="mt-2 font-mono text-[13px] text-muted">
                        Roll number {linked.roll_number}
                        {linked.enrolment !== null && ` · ${linked.enrolment} enrolled`}
                        {linked.source_year && ` · ${linked.source_year} figures`}
                      </p>
                    </div>
                    <UnlinkRecordButton />
                  </div>
                ) : (
                  <>
                    <p className="mb-4 text-[15px] leading-relaxed text-muted [text-wrap:pretty]">
                      Link this school to its entry in the Department of Education&rsquo;s list of
                      post-primary schools. That records the roll number, which identifies the
                      school even when its name changes and tells same-named schools apart.
                    </p>
                    {/*
                      A plain GET form. The results are a server render of the
                      query string, so the search survives a reload, can be
                      linked to, and needs no client state to hold a selection
                      that only matters until the next search anyway.
                    */}
                    <form method="get" className="flex flex-wrap gap-3">
                      <Input
                        name="q"
                        defaultValue={query}
                        placeholder="School name or town — e.g. Presentation, or Tralee"
                        aria-label="Search the school directory"
                        className="min-w-[16rem] flex-1"
                      />
                      <button
                        type="submit"
                        className="inline-flex h-11 items-center rounded-full bg-accent px-6 text-[15px] font-bold text-accent-ink"
                      >
                        Search
                      </button>
                    </form>

                    {query && results.length === 0 && (
                      <div className="mt-5">
                        {total === 0 ? (
                          <Alert tone="warn" title="The directory is empty">
                            Nobody has imported the Department&rsquo;s list on this deployment yet.
                            Run <code className="font-mono">node scripts/import-schools.mjs</code>{' '}
                            against the enrolment workbook from gov.ie — see{' '}
                            <code className="font-mono">docs/schools.md</code>.
                          </Alert>
                        ) : (
                          <Empty title={`No school matches “${query}”.`}>
                            Try part of the name, or the town.
                          </Empty>
                        )}
                      </div>
                    )}

                    {results.length > 0 && (
                      <ul className="mt-5 flex flex-col gap-2">
                        {results.map((r) => (
                          <li
                            key={r.roll_number}
                            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-surface px-5 py-3.5"
                          >
                            <div>
                              <p className="text-[15px] font-semibold">{r.label}</p>
                              <p className="mt-0.5 font-mono text-[13px] text-muted">
                                {r.roll_number}
                                {r.county && ` · ${r.county}`}
                                {r.enrolment !== null && ` · ${r.enrolment} enrolled`}
                              </p>
                            </div>
                            <LinkRecordButton
                              roll={r.roll_number}
                              officialName={r.name}
                              differentName={normaliseName(r.name) !== normaliseName(school.name)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </CardBody>
            </Card>
          </Section>
        </>
      )}
    </Page>
  );
}
