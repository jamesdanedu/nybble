import type { Metadata } from 'next';
import { requireStaffSession } from '@/lib/session';
import { runScorerChecks, type Verdict } from '@/lib/scorer-health';
import { Alert, Card, CardBody, Page, PageHeader, Section } from '@/components/ui';

export const metadata: Metadata = { title: 'Diagnostics' };
export const dynamic = 'force-dynamic';

/**
 * Why this page exists.
 *
 * When a student cannot submit, the browser refuses to say why: a blocked CORS
 * preflight is opaque to script, so "not deployed", "token rejected" and "no
 * wifi" are the same rejected promise. Diagnosing that meant a teacher reading
 * DevTools aloud to someone who could read Deno logs.
 *
 * These checks make the same calls from the server, where nothing is hidden,
 * and print the raw status and body. Staff-only, and it discloses no keys —
 * only their shape and role claim.
 */
const TONE: Record<Verdict, { label: string; className: string }> = {
  ok: { label: 'OK', className: 'bg-accent-soft text-accent' },
  warn: { label: 'Check', className: 'bg-[color:var(--warn-soft)] text-[color:var(--warn)]' },
  fail: { label: 'Broken', className: 'bg-[color:var(--danger-soft)] text-[color:var(--danger)]' },
  skip: { label: 'Skipped', className: 'bg-raised text-muted' },
};

export default async function DiagnosticsPage() {
  await requireStaffSession();
  const checks = await runScorerChecks();

  const broken = checks.filter((c) => c.verdict === 'fail');
  const firstFix = checks.find((c) => c.verdict !== 'ok' && c.fix)?.fix;

  // One cause usually breaks several checks at once — an undeployed function
  // fails all three scorer probes. Printing its fix four times (banner plus
  // each card) buries the one thing to do in repetition, so say it once and
  // point at it after that.
  const shown = new Set<string>(firstFix ? [firstFix] : []);

  return (
    <Page>
      <PageHeader
        title="Diagnostics"
        subtitle="Whether a student could submit an activity right now, checked from the server."
        back={{ href: '/teacher', label: 'Overview' }}
      />

      <div className="mb-5">
        {broken.length === 0 ? (
          <Alert tone="success" title="Marking is working">
            Every check passed. If a student still cannot submit, it is their connection or their
            sign-in rather than the setup.
          </Alert>
        ) : (
          <Alert tone="error" title={`${broken.length} thing${broken.length === 1 ? '' : 's'} to fix`}>
            {firstFix ? (
              <>
                Start here: {firstFix}
              </>
            ) : (
              'The failing checks below say what went wrong.'
            )}
          </Alert>
        )}
      </div>

      <Section title="Checks">
        <div className="grid gap-3">
          {checks.map((c) => {
            const tone = TONE[c.verdict];
            return (
              <Card key={c.name}>
                <CardBody>
                  <div className="mb-1 flex flex-wrap items-center gap-3">
                    <h3 className="text-[17px] font-semibold">{c.name}</h3>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold uppercase tracking-wide ${tone.className}`}
                    >
                      {tone.label}
                    </span>
                  </div>
                  <p className="text-[15px]">{c.summary}</p>

                  {c.fix &&
                    (() => {
                      const repeat = shown.has(c.fix!);
                      shown.add(c.fix!);
                      return (
                        <p className="mt-2 text-[14.5px] text-muted">
                          <span className="font-semibold text-ink">Fix: </span>
                          {repeat ? 'Same cause as above.' : c.fix}
                        </p>
                      );
                    })()}

                  {/* The evidence, verbatim. This is the thing that was
                      impossible to see from a browser. */}
                  {c.detail && (
                    <pre className="mt-3 overflow-x-auto rounded-card border border-line bg-raised p-3 text-[13px] leading-relaxed">
                      {c.detail}
                    </pre>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      </Section>

      <p className="mt-5 text-[14px] text-muted">
        Nothing on this page discloses a key — only whether one is set, its first few characters
        and the role it claims. Reload to run the checks again.
      </p>
    </Page>
  );
}
