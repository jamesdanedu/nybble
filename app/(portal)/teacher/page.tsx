import type { Metadata } from 'next';
import { requireStaffSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { getClasses, getReviewQueue } from '@/lib/queries';
import { formatDateTime, relativeTime } from '@/lib/format';
import {
  ButtonLink,
  Card,
  CardBody,
  Empty,
  Page,
  PageHeader,
  Section,
  Stat,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Teacher' };
export const dynamic = 'force-dynamic';

export default async function TeacherHome() {
  const { profile } = await requireStaffSession();
  const supabase = await createClient();

  const [classes, queue] = await Promise.all([getClasses(), getReviewQueue(5)]);

  const [{ count: activityCount }, { count: studentCount }, { data: recentAssignments }] =
    await Promise.all([
      supabase.from('activities').select('id', { count: 'exact', head: true }).eq('archived', false),
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'student')
        .eq('archived', false),
      supabase
        .from('assignments')
        .select('id, due_at, open_at, mode, activity:activities!inner ( title )')
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

  const nothingSetUp = (classes.length === 0 && (activityCount ?? 0) === 0);

  return (
    <Page>
      <PageHeader
        title={profile.display_name}
        subtitle="Everything you need before the bell."
        actions={
          <>
            <ButtonLink href="/teacher/assign" variant="primary">
              Set an activity
            </ButtonLink>
            <ButtonLink href="/teacher/review">Review queue</ButtonLink>
          </>
        }
      />

      {nothingSetUp ? (
        <Empty title="Let's get you set up">
          Two things to do, in this order: make a class and add your students, then import an
          activity file. After that you can set work.
          <span className="mt-5 block">
            <ButtonLink href="/teacher/classes" variant="primary">
              Make a class
            </ButtonLink>
          </span>
        </Empty>
      ) : (
        <>
          <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Waiting to be marked" value={queue.length >= 5 ? '5+' : queue.length} />
            <Stat label="Classes" value={classes.length} />
            <Stat label="Students" value={studentCount ?? 0} />
            <Stat label="Activities" value={activityCount ?? 0} />
          </div>

          <Section title="Oldest waiting to be marked">
            {queue.length === 0 ? (
              <Empty title="Nothing waiting">
                Everything that has been handed up is marked.
              </Empty>
            ) : (
              <div className="grid gap-2">
                {queue.map((row) => (
                  <Card key={row.attempt.id}>
                    <CardBody className="flex flex-wrap items-center justify-between gap-3 py-4">
                      <div className="min-w-0">
                        <p className="text-[16px] font-semibold">
                          {row.student?.display_name ?? 'Unknown student'}
                        </p>
                        <p className="text-[14px] text-muted">
                          {row.assignment?.activity.title ?? 'Unknown activity'} ·{' '}
                          handed up {relativeTime(row.attempt.submitted_at)}
                        </p>
                      </div>
                      <ButtonLink href={`/teacher/review/${row.attempt.id}`}>Mark</ButtonLink>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </Section>

          <Section title="Recently set">
            {!recentAssignments || recentAssignments.length === 0 ? (
              <Empty title="Nothing set yet">
                <span className="mt-4 block">
                  <ButtonLink href="/teacher/assign" variant="primary">
                    Set an activity
                  </ButtonLink>
                </span>
              </Empty>
            ) : (
              <div className="grid gap-2">
                {recentAssignments.map((a) => {
                  const activity = a.activity as unknown as { title: string } | null;
                  return (
                    <Card key={a.id as string}>
                      <CardBody className="flex flex-wrap items-center justify-between gap-3 py-4">
                        <p className="text-[16px] font-semibold">{activity?.title ?? 'Untitled'}</p>
                        <p className="text-[14px] text-muted">
                          {a.due_at ? `Due ${formatDateTime(a.due_at as string)}` : 'No due date'}
                        </p>
                      </CardBody>
                    </Card>
                  );
                })}
              </div>
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
