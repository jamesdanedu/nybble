#!/usr/bin/env node
/* ===========================================================================
 * import-schools.mjs — load the Department's post-primary list into
 * `school_directory`.
 *
 *   node scripts/import-schools.mjs --dry-run postprimaryschools.xlsx
 *   node scripts/import-schools.mjs postprimaryschools.xlsx
 *
 * Get the file from gov.ie → Department of Education → "Post-primary schools
 * enrolment figures", the workbook for the academic year you want. It is not
 * committed to this repo: it is somebody else's data, republished every year,
 * and a 250 KB binary in git that nothing at runtime reads is a liability
 * rather than an asset. The parser is the part worth keeping.
 *
 * Needs, in the environment or in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY     (school_directory has no write policy at all —
 *                                  nothing else can write it)
 *
 * Re-runnable. Rows are upserted on roll number, so next year's file updates
 * names, towns and enrolments in place and leaves every `schools.roll_number`
 * link pointing at the same row.
 *
 * Since 0011 the whole workbook is read, not six columns of it: contact
 * details, classification, and the year-group numbers from the second sheet.
 * The contact columns are operator-only in the database; see
 * supabase/migrations/0011_customers.sql and docs/customers.md.
 * ======================================================================== */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { parseSchoolsWorkbook, parseSchoolRows } from '../lib/schools-ie/parse.mjs';
import { qualifyLabels } from '../lib/schools-ie/qualify.mjs';

/* --- tiny .env loader; no dependency, no surprises ---------------------- */
function loadEnvFiles() {
  for (const name of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
}

/* --- output ------------------------------------------------------------- */
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (useColour ? `[${code}m${s}[0m` : String(s));
const red = c('31'), green = c('32'), yellow = c('33'), dim = c('2'), bold = c('1');

const die = (msg) => {
  console.error(red('✗ ') + msg);
  process.exit(1);
};

function usage() {
  console.log(`
${bold('nybble school directory importer')}

  node scripts/import-schools.mjs [options] <postprimaryschools.xlsx>

Reads the Department of Education's post-primary enrolment workbook and loads
it into the school_directory table. Accepts .xlsx (what gov.ie publishes) or a
.csv export of the same sheet.

Options
  --dry-run          parse, check and report; write nothing
  --json             machine-readable output
  --limit <n>        sample rows to show in the report (default 8)
  -h, --help         this
`);
}

function parseArgs(argv) {
  const opts = { file: null, dryRun: false, json: false, limit: 8 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--limit') opts.limit = Number(argv[++i]) || 8;
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else if (a.startsWith('-')) die(`Unknown option ${a}. Try --help.`);
    else if (opts.file) die('Give one workbook, not several.');
    else opts.file = a;
  }
  return opts;
}

/* --- csv ---------------------------------------------------------------- */

/** RFC4180-ish: quoted fields, doubled quotes, embedded newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field.trim()); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field.trim()); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field.trim()); rows.push(row); }
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  for (const r of rows) while (r.length < width) r.push('');
  return rows;
}

/* --- main --------------------------------------------------------------- */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file) { usage(); process.exit(1); }
  if (!existsSync(opts.file)) die(`No such file: ${opts.file}`);

  const buf = readFileSync(opts.file);
  const result = /\.csv$/i.test(opts.file)
    ? parseSchoolRows(parseCsv(buf.toString('utf8')), path.basename(opts.file))
    : parseSchoolsWorkbook(buf);

  const { schools, rejected, sheet, sourceYear, programme } = result;
  const labels = qualifyLabels(schools);
  const qualified = [...labels.values()].filter((l) => /,\s/.test(l)).length;
  const byRoll = [...labels.values()].filter((l) => /\([0-9]{5}[A-Z]\)$/.test(l)).length;
  const noTown = schools.filter((s) => !s.town).length;
  const withEmail = schools.filter((s) => s.email).length;
  const withPhone = schools.filter((s) => s.phone).length;

  if (opts.json) {
    console.log(JSON.stringify({ sheet, sourceYear, programme: programme ?? null, schools, rejected }, null, 2));
  } else {
    console.log(`\n${bold('Parsed')} ${opts.file}`);
    console.log(`  sheet            ${sheet}`);
    console.log(`  academic year    ${sourceYear || dim('(not stated in the file)')}`);
    console.log(`  schools          ${green(schools.length)}`);
    console.log(`  rejected rows    ${rejected.length ? yellow(rejected.length) : '0'}`);
    for (const r of rejected) {
      console.log(dim(`      line ${r.line} ${r.roll || '(no roll)'} — ${r.reason}`));
    }
    console.log(`  without a town   ${noTown ? yellow(noTown) : '0'}`);
    console.log(`\n${bold('Contact')}`);
    console.log(`  with an email    ${withEmail}`);
    console.log(`  with a phone     ${withPhone}`);
    console.log(`\n${bold('Year groups')}`);
    if (programme) {
      console.log(`  matched          ${programme.matched} of ${schools.length}`);
      console.log(`  unmatched rows   ${programme.unmatched ? yellow(programme.unmatched) : '0'}`);
    } else {
      console.log(`  ${yellow('no Programme & Year sheet')} — TY/LC1/LC2 will be null`);
    }
    console.log(`\n${bold('Names')}`);
    console.log(`  unique labels    ${new Set(labels.values()).size} of ${labels.size}`);
    console.log(`  needed a place   ${qualified}`);
    console.log(`  needed a roll    ${byRoll}`);
    console.log(`\n${bold('Sample')}`);
    for (const s of schools.slice(0, opts.limit)) {
      const lc = s.lc1 !== null || s.lc2 !== null ? dim(` · LC ${(s.lc1 ?? 0) + (s.lc2 ?? 0)}`) : '';
      console.log(`  ${s.roll_number}  ${labels.get(s.roll_number)}${s.county ? dim(` — ${s.county}`) : ''}${lc}`);
    }
  }

  // A parse that produced no schools, or that threw away a large slice of the
  // file, is a shape change rather than a few bad rows. Refuse it: a directory
  // silently missing a third of the country is worse than no directory.
  if (schools.length === 0) die('No schools parsed. Is this the right workbook?');
  const lost = rejected.length / (schools.length + rejected.length);
  if (lost > 0.05) {
    die(
      `${rejected.length} of ${schools.length + rejected.length} rows were rejected ` +
        `(${Math.round(lost * 100)}%). That is a change in the file's shape, not a few bad rows — ` +
        'read the report above before importing.',
    );
  }
  if (new Set(labels.values()).size !== labels.size) {
    die('Two schools ended up with the same label. That is a bug in qualifyLabels, not in the file.');
  }
  // The second sheet is optional, but a second sheet that names schools the
  // first does not know is two sheets from different files, and the year-group
  // numbers would then be somebody else's.
  if (programme && programme.matched < schools.length * 0.9) {
    die(
      `The Programme & Year sheet matched only ${programme.matched} of ${schools.length} schools. ` +
        'Either it is from a different year or its shape has changed — read the report above before importing.',
    );
  }

  if (opts.dryRun) {
    // stderr, so that `--json --dry-run` leaves stdout as one JSON document.
    console.error(`\n${yellow('Dry run')} — nothing written.\n`);
    return;
  }

  loadEnvFiles();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) die('NEXT_PUBLIC_SUPABASE_URL is not set (environment or .env.local).');
  if (!key) {
    die(
      'SUPABASE_SERVICE_ROLE_KEY is not set. school_directory has no write policy, ' +
        'so nothing else can write it.',
    );
  }

  // Imported here rather than at the top of the file so that --dry-run needs no
  // dependencies at all. Parsing and checking a workbook is then something you
  // can do in a fresh clone before `npm i`, which is exactly when you most want
  // to know whether this year's file still parses.
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Chunked because a single 721-row upsert is a large request body, and a
  // failure in one says nothing about which row was at fault.
  const stamp = new Date().toISOString();
  const rows = schools.map((s) => ({ ...s, source_year: sourceYear || null, updated_at: stamp }));
  const size = 200;
  let written = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await db.from('school_directory').upsert(chunk, { onConflict: 'roll_number' });
    if (error) die(`Writing rows ${i + 1}–${i + chunk.length}: ${error.message}`);
    written += chunk.length;
    process.stdout.write(dim(`\r  written ${written}/${rows.length}`));
  }
  process.stdout.write('\n');

  const { count } = await db
    .from('school_directory')
    .select('roll_number', { count: 'exact', head: true });
  console.log(`\n${green('✓')} school_directory now holds ${count ?? '?'} schools.\n`);
}

main().catch((e) => die(e instanceof Error ? e.stack || e.message : String(e)));
