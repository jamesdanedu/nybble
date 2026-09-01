import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaffSession } from '@/lib/session';
import { getClasses } from '@/lib/queries';
import { Badge, Card, CardBody, Empty, Page, PageHeader } from '@/components/ui';
import { NewClassForm } from './new-class-form';

export const metadata: Metadata = { title: 'Classes' };
export const dynamic = 'force-dynamic';

export default async function ClassesPage() {
  await requireStaffSession();
  const classes = await getClasses();

  return (
    <Page>
      <PageHeader
        title="Classes"
        subtitle="A class is a group you can set work to in one go."
        actions={<NewClassForm />}
      />

      {classes.length === 0 ? (
        <Empty title="No classes yet">
          Make a class, then paste in your list of names and the portal will create the accounts
          and print the passwords for you.
        </Empty>
      ) : (
        <div className="grid gap-3">
          {classes.map((g) => (
            <Link key={g.id} href={`/teacher/classes/${g.id}`} className="block">
              <Card className="transition hover:border-accent">
                <CardBody className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div>
                    <p className="text-[18px] font-semibold">{g.name}</p>
                    {g.year_label && <p className="text-[14px] text-muted">{g.year_label}</p>}
                  </div>
                  <Badge tone={g.member_count === 0 ? 'warn' : 'neutral'}>
                    {g.member_count === 0
                      ? 'No students yet'
                      : `${g.member_count} student${g.member_count === 1 ? '' : 's'}`}
                  </Badge>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
