'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Button } from '@/components/ui';

/**
 * Cut-out slips: one card per student, with everything they need to sign in.
 *
 * The old design showed a three-column table. It printed as a wall of text a
 * teacher then had to read out loud, one row at a time, or cut up by hand with
 * a ruler. This prints as a grid of bordered cards with a dashed guillotine
 * line between them: run it through the paper cutter (or tear it), hand one to
 * each student, done. Nobody hears anybody else's password.
 *
 * Printing is done through a portal into <body> rather than by sprinkling
 * `no-print` around. The slips normally sit deep inside a class page, under a
 * roster and an "add students" form, and hiding those one by one is a game you
 * lose the next time somebody adds a section. A second copy of the sheet as a
 * direct child of <body>, with every OTHER child of <body> hidden while it is
 * open, means the printout is the slips and nothing else, whatever the page
 * around them grows into.
 *
 * Passwords are never stored in plain text, so this component is the only place
 * they exist. That is why the toolbar has three ways to get them out of the
 * browser — print, clipboard, CSV — and why the warning is loud.
 */

/**
 * How many slip sheets are open. Two can be — create a few accounts, then reset
 * the class — and the body class has to survive the first one closing.
 */
let openSheets = 0;

export interface Credential {
  displayName: string;
  username: string;
  password: string;
}

export function CredentialSlips({
  title,
  credentials,
  skipped = [],
  onDone,
  doneLabel = 'Done',
  intro,
}: {
  title: string;
  credentials: Credential[];
  skipped?: { displayName: string; reason: string }[];
  onDone?: () => void;
  doneLabel?: string;
  intro?: React.ReactNode;
}) {
  // The address a student types into the browser. Read from the page rather
  // than configured, so it is right on localhost, on a preview URL and on the
  // real domain without anyone having to remember to set it.
  const [origin, setOrigin] = useState('');
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.host);
    setMounted(true);
    openSheets += 1;
    document.body.classList.add('slips-open');
    return () => {
      openSheets -= 1;
      if (openSheets <= 0) document.body.classList.remove('slips-open');
    };
  }, []);

  function copy() {
    const tsv = credentials
      .map((c) => `${c.displayName}\t${c.username}\t${c.password}`)
      .join('\n');
    navigator.clipboard?.writeText(tsv).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      },
      () => setCopied(false),
    );
  }

  function downloadCsv() {
    const rows = [
      ['Name', 'Username', 'Password'],
      ...credentials.map((c) => [c.displayName, c.username, c.password]),
    ];
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    // A BOM so Excel opens fadas (Ní Bhriain, Ó Ceallaigh) as UTF-8 rather
    // than mojibake. This is a class list of Irish names; it matters.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugForFile(title)}-passwords.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const sheet = (
    <div className="slip-sheet">
      {credentials.map((c) => (
        <div key={c.username} className="slip">
          <p className="slip-name">{c.displayName}</p>
          <dl className="slip-rows">
            <dt>Website</dt>
            <dd className="slip-site">{origin || '…'}</dd>
            <dt>Username</dt>
            <dd className="slip-mono">{c.username}</dd>
            <dt>Password</dt>
            <dd className="slip-mono slip-password">{c.password}</dd>
          </dl>
          <p className="slip-foot">Choose your own password the first time you sign in.</p>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <div className="mb-4">
        <Alert tone="warn" title="Print or save this now">
          These passwords are shown once and are not stored anywhere. If you close this page
          without keeping them, the only way back is another reset.
        </Alert>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[18px] font-semibold">{title}</h3>
          {intro && <p className="mt-0.5 text-[14.5px] text-muted">{intro}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            Print slips
          </Button>
          <Button variant="secondary" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="secondary" onClick={downloadCsv}>
            Download CSV
          </Button>
          {onDone && (
            <Button variant="quiet" onClick={onDone}>
              {doneLabel}
            </Button>
          )}
        </div>
      </div>

      {sheet}

      {skipped.length > 0 && (
        <div className="mt-5">
          <Alert tone="error" title={`${skipped.length} not done`}>
            <ul className="mt-1 list-disc pl-5">
              {skipped.map((s, i) => (
                <li key={i}>
                  {s.displayName} — {s.reason}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      {mounted &&
        createPortal(
          <div className="slip-print-layer">
            <p className="slip-print-title">{title}</p>
            {sheet}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** RFC 4180: quote anything with a comma, quote or newline; double inner quotes. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function slugForFile(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'class'
  );
}
