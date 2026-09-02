import type { Metadata } from 'next';
import { requireAdminSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { Alert, Card, CardBody, Page, PageHeader, Section, Stat } from '@/components/ui';
import { RenameSchoolForm, ChangeSlugForm } from './school-forms';

export const metadata: Metadata = { title: 'School' };
export const dynamic = 'force-dynamic';

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
  const slugMismatch = Boolean(school && env.schoolSlug && env.schoolSlug !== school.slug);

  return (
    <Page>
      <PageHeader title="School" subtitle="Admin only. Teachers do not see this page." />

      {!school ? (
        <Alert tone="error" title="No school record">
          Your profile points at a school that could not be read.
        </Alert>
      ) : (
        <>
          {slugMismatch && (
            <div className="mb-6">
              <Alert tone="warn" title="Slug does not match the deployment">
                This school&rsquo;s slug is <code className="font-mono">{school.slug}</code>, but the
                site was built with <code className="font-mono">NEXT_PUBLIC_SCHOOL_SLUG={env.schoolSlug}</code>.
                A student typing a bare username would be sent to{' '}
                <code className="font-mono">@{env.schoolSlug}.portal.invalid</code>, which is not
                where their account lives. Make the two agree — change the slug below if no students
                exist yet, otherwise change the environment variable and redeploy.
              </Alert>
            </div>
          )}

          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Stat label="Students" value={students ?? 0} />
            <Stat label="Teachers and admins" value={staff ?? 0} />
            <Stat
              label="Sign-in domain"
              value={<span className="font-mono text-[17px]">@{school.slug}</span>}
              sub=".portal.invalid"
            />
          </div>

          <Section title="Name">
            <Card>
              <CardBody>
                <RenameSchoolForm name={school.name} />
              </CardBody>
            </Card>
          </Section>

          <Section title="Slug">
            <Card>
              <CardBody>
                <ChangeSlugForm slug={school.slug} studentCount={students ?? 0} />
              </CardBody>
            </Card>
          </Section>
        </>
      )}
    </Page>
  );
}
