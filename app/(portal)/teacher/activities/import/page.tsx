import type { Metadata } from 'next';
import { requireStaffSession } from '@/lib/session';
import { Alert, Page, PageHeader } from '@/components/ui';
import { ImportClient } from './import-client';

export const metadata: Metadata = { title: 'Import activities' };

export default async function ImportPage() {
  await requireStaffSession();

  return (
    <Page>
      <PageHeader
        title="Import activities"
        subtitle="Upload a Nybble activity file. It is checked and shown to you before anything is written."
        back={{ href: '/teacher/activities', label: 'Activities' }}
      />

      <div className="mb-4">
        <Alert tone="info" title="Where the answers go">
          Every step in the file has a public <code className="font-mono">config</code> and a secret{' '}
          <code className="font-mono">key</code>. The importer separates them: the config is stored
          on the activity and sent to students&apos; browsers, the key is stored in{' '}
          <code className="font-mono">activity_keys</code>, which only the marking function can
          read. Anything the file puts in the wrong half is rejected rather than published.
        </Alert>
      </div>

      <ImportClient />

      <div className="mt-8 text-[14.5px] text-muted">
        <p className="mb-2">
          The same importer runs on the command line, which is easier for a folder of files:
        </p>
        <pre className="overflow-x-auto rounded-card border border-line bg-raised p-4 font-mono text-[13.5px]">
{`node scripts/import-activities.mjs --dry-run week3.json
node scripts/import-activities.mjs week3.json`}
        </pre>
        <p className="mt-2">
          The format is documented in <code className="font-mono">docs/activity-format.md</code>.
        </p>
      </div>
    </Page>
  );
}
