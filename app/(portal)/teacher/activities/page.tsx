import type { Metadata } from 'next';
import { requireStaffSession } from '@/lib/session';
import { getActivities, getRunners } from '@/lib/queries';
import { formatDate } from '@/lib/format';
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
import type { ActivityStep } from '@/lib/types';

export const metadata: Metadata = { title: 'Activities' };
export const dynamic = 'force-dynamic';

export default async function ActivitiesPage() {
  await requireStaffSession();
  const [activities, runners] = await Promise.all([getActivities(), getRunners()]);

  // Group by topic — that is how a teacher thinks about the bank.
  const byTopic = new Map<string, typeof activities>();
  for (const a of activities) {
    const key = a.topic ?? 'No topic';
    byTopic.set(key, [...(byTopic.get(key) ?? []), a]);
  }

  return (
    <Page wide>
      <PageHeader
        title="Activities"
        subtitle="The bank for your school. Import a file to add to it."
        actions={
          <ButtonLink href="/teacher/activities/import" variant="primary">
            Import
          </ButtonLink>
        }
      />

      {activities.length === 0 ? (
        <Empty
          title="No activities yet"
          action={
            <ButtonLink href="/teacher/activities/import" variant="primary">
              Import an activity file
            </ButtonLink>
          }
        >
          Activities are written as JSON files and imported. The format is in
          <code className="mx-1 font-mono">docs/activity-format.md</code>, and it is deliberately
          simple enough to paste into a language model and get valid files back.
        </Empty>
      ) : (
        [...byTopic.entries()].map(([topic, list]) => (
          <Section key={topic} title={topic}>
            <div className="grid gap-2">
              {list.map((a) => {
                const steps = (Array.isArray(a.steps) ? a.steps : []) as ActivityStep[];
                return (
                  <Card key={a.id}>
                    <CardBody className="flex flex-wrap items-start justify-between gap-4 py-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-[17px] font-semibold">{a.title}</p>
                        {a.description && (
                          <p className="mt-0.5 line-clamp-2 text-[14.5px] text-muted">
                            {a.description}
                          </p>
                        )}
                        <p className="mt-1.5 flex flex-wrap gap-1.5">
                          {steps.map((s) => (
                            <span
                              key={s.id}
                              className="rounded border border-line px-1.5 py-0.5 font-mono text-[12.5px] text-muted"
                            >
                              {s.runner_id}
                            </span>
                          ))}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <Badge tone={a.visibility === 'private' ? 'neutral' : 'accent'}>
                          {a.visibility}
                        </Badge>
                        <p className="text-[13px] text-muted">
                          Updated {formatDate(a.updated_at)}
                        </p>
                        <ButtonLink href={`/teacher/assign?activity=${a.id}`}>Set this</ButtonLink>
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          </Section>
        ))
      )}

      <Section title="Registered runners">
        <Card>
          <div className="divide-y divide-[color:var(--line)]">
            {runners.map((r) => (
              <div key={r.id as string} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="font-mono text-[15px] font-semibold">{r.id as string}</span>
                <span className="text-[15px]">{r.name as string}</span>
                <span className="text-[13.5px] text-muted">v{r.version as string}</span>
                <span className="ml-auto font-mono text-[13px] text-muted">
                  {r.entry_url as string}
                </span>
                <Badge tone={r.scorer === 'manual' ? 'warn' : 'neutral'}>
                  {r.scorer as string}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
        <p className="mt-2 text-[14px] text-muted">
          A step whose <code className="font-mono">runner_id</code> is not on this list will not
          render. Adding a runner is one row in <code className="font-mono">runners</code> plus a
          hosted HTML file — no portal redeploy.
        </p>
      </Section>
    </Page>
  );
}
