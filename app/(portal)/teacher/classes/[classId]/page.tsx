import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireStaffSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { getClassWithMembers, getStudents } from '@/lib/queries';
import { Card, CardBody, Empty, Page, PageHeader, Section } from '@/components/ui';
import { BulkAddStudents } from './bulk-add';
import { AddExistingStudents, MemberActions } from './member-actions';
import { ResetClassPasswords } from './reset-class';

export const metadata: Metadata = { title: 'Class' };
export const dynamic = 'force-dynamic';

export default async function ClassPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  await requireStaffSession();

  const data = await getClassWithMembers(classId);
  if (!data) notFound();
  const { group, members } = data;

  const allStudents = await getStudents();
  const memberIds = new Set(members.map((m) => m.id));
  const candidates = allStudents
    .filter((s) => !memberIds.has(s.id))
    .map((s) => ({ id: s.id, display_name: s.display_name, username: s.username }));

  // Every username in the school, so the "add students" preview can show the
  // exact username each new account will get, collisions and all.
  const supabase = await createClient();
  const { data: allProfiles } = await supabase.from('profiles').select('username');
  const takenUsernames = (allProfiles ?? []).map((p) => p.username as string);

  return (
    <Page>
      <PageHeader
        title={group.name}
        subtitle={
          <>
            {group.year_label && <>{group.year_label} · </>}
            {members.length} student{members.length === 1 ? '' : 's'}
          </>
        }
        back={{ href: '/teacher/classes', label: 'Classes' }}
      />

      <Section title="Students">
        {members.length === 0 ? (
          <Empty title="Nobody in this class yet">
            Paste your class list below and the portal will create the accounts.
          </Empty>
        ) : (
          <Card>
            <div className="divide-y divide-[color:var(--line)]">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold">{m.display_name}</p>
                    {/* The username, never the synthetic email. Students sign in
                        with this and nothing else. */}
                    <p className="font-mono text-[13.5px] text-muted">
                      {m.username}
                      {m.must_change_password && (
                        <span className="ml-2 font-sans not-italic text-[13px] text-[color:var(--warn)]">
                          has not signed in yet
                        </span>
                      )}
                    </p>
                  </div>
                  <MemberActions
                    classId={group.id}
                    profileId={m.id}
                    displayName={m.display_name}
                  />
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="mt-3">
          <AddExistingStudents classId={group.id} candidates={candidates} />
        </div>
      </Section>

      <Section title="Create new accounts">
        <BulkAddStudents
          classId={group.id}
          classLabel={group.name}
          takenUsernames={takenUsernames}
        />
      </Section>

      {members.length > 0 && (
        <Section title="Passwords">
          <ResetClassPasswords
            classId={group.id}
            classLabel={group.name}
            studentCount={members.length}
          />
        </Section>
      )}
    </Page>
  );
}
