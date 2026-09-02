import type { Metadata } from 'next';
import { requireAdminSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { Alert, Card, CardBody, Page, PageHeader, Section, Stat } from '@/components/ui';
import { RenameSchoolForm } from './school-forms';

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
 */
export default async function SchoolPage() {
  const session = await requireAdminSession();
  const supabase = await createClient();

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
        </>
      )}
    </Page>
  );
}
