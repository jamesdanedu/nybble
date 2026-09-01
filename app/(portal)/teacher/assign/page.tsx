import type { Metadata } from 'next';
import { requireStaffSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { getActivities, getClasses, getStudents } from '@/lib/queries';
import { formatDateTime } from '@/lib/format';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  Empty,
  Page,
  PageHeader,
  Section,
} from '@/components/ui';
import { AssignForm } from './assign-form';

export const metadata: Metadata = { title: 'Assign' };
export const dynamic = 'force-dynamic';

export default async function AssignPage({
  searchParams,
}: {
  searchParams: Promise<{ activity?: string }>;
}) {
  await requireStaffSession();
  const params = await searchParams;

  const [activities, classes, students] = await Promise.all([
    getActivities(),
    getClasses(),
    getStudents(),
  ]);

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('assignments')
    .select(
      'id, mode, open_at, due_at, class_group_id, profile_id, activity:activities!inner ( title )',
    )
    .order('created_at', { ascending: false })
    .limit(25);

  const classNames = new Map(classes.map((c) => [c.id, c.name]));
  const studentNames = new Map(students.map((s) => [s.id, s.display_name]));

  if (activities.length === 0) {
    return (
      <Page>
        <PageHeader title="Set an activity" />
        <Empty
          title="No activities to set"
          action={
            <ButtonLink href="/teacher/activities/import" variant="primary">
              Import an activity file
            </ButtonLink>
          }
        >
          Import something into the bank first.
        </Empty>
      </Page>
    );
  }

  if (classes.length === 0 && students.length === 0) {
    return (
      <Page>
        <PageHeader title="Set an activity" />
        <Empty
          title="Nobody to set it to"
          action={
            <ButtonLink href="/teacher/classes" variant="primary">
              Make a class
            </ButtonLink>
          }
        >
          Make a class and add your students first.
        </Empty>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Set an activity"
        subtitle="Pick what, who, and when."
      />

      <AssignForm
        initialActivityId={params.activity}
        activities={activities.map((a) => ({
          id: a.id,
          label: a.title,
          sub: a.topic ?? undefined,
        }))}
        classes={classes.map((c) => ({
          id: c.id,
          label: c.name,
          sub: `${c.member_count} student${c.member_count === 1 ? '' : 's'}`,
        }))}
        students={students.map((s) => ({
          id: s.id,
          label: s.display_name,
          sub: s.username,
        }))}
      />

      <div className="mt-8">
        <Section title="Already set">
          {!existing || existing.length === 0 ? (
            <Empty title="Nothing set yet" />
          ) : (
            <div className="grid gap-2">
              {existing.map((a) => {
                const activity = a.activity as unknown as { title: string } | null;
                const who = a.class_group_id
                  ? (classNames.get(a.class_group_id as string) ?? 'A class')
                  : (studentNames.get(a.profile_id as string) ?? 'One student');
                return (
                  <Card key={a.id as string}>
                    <CardBody className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                      <div className="min-w-0">
                        <p className="text-[16px] font-semibold">{activity?.title ?? 'Untitled'}</p>
                        <p className="text-[14px] text-muted">
                          {who} ·{' '}
                          {a.due_at
                            ? `due ${formatDateTime(a.due_at as string)}`
                            : 'no due date'}
                        </p>
                      </div>
                      {a.mode === 'practice' && <Badge>Practice</Badge>}
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </Page>
  );
}
