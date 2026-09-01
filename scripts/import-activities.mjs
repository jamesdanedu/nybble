#!/usr/bin/env node
/* ===========================================================================
 * import-activities.mjs — the activity importer, on the command line.
 *
 *   node scripts/import-activities.mjs --dry-run week3.json
 *   node scripts/import-activities.mjs --school stmarys --owner josullivan week3.json
 *   node scripts/import-activities.mjs --replace week3.json other.json
 *
 * Same validator and same plan/commit code as the portal's Import screen
 * (lib/activity-import/*), so a file that dry-runs clean here imports clean
 * there. The only difference is who proves they are staff: the portal checks
 * the signed-in user's profile, the CLI assumes whoever holds the service role
 * key is entitled to use it.
 *
 * Needs, in the environment or in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY     (activity_keys has no RLS policies at all —
 *                                  nothing else can write it)
 * ======================================================================== */

import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

import { parseActivityFile } from '../lib/activity-import/schema.mjs';
import { planImport, commitImport } from '../lib/activity-import/plan.mjs';

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
const c = (code) => (s) => (useColour ? `\u001b[${code}m${s}\u001b[0m` : String(s));
const red = c('31'), green = c('32'), yellow = c('33'), dim = c('2'), bold = c('1');

const die = (msg) => {
  console.error(red('✗ ') + msg);
  process.exit(1);
};

function usage() {
  console.log(`
${bold('nybble activity importer')}

  node scripts/import-activities.mjs [options] <file.json> [more.json ...]

Options
  --dry-run          validate and show the plan, write nothing
  --replace          overwrite an existing activity's steps and keys wholesale
                     (default merges by step id and keeps steps not in the file)
  --school <slug>    school slug; defaults to NEXT_PUBLIC_SCHOOL_SLUG
  --owner <username> the teacher to own newly created activities; defaults to
                     the first teacher in the school
  --json             machine-readable output
  -h, --help         this
`);
}

function parseArgs(argv) {
  const opts = { files: [], dryRun: false, replace: false, school: null, owner: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--replace') opts.replace = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--school') opts.school = argv[++i];
    else if (a === '--owner') opts.owner = argv[++i];
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else if (a.startsWith('-')) die(`Unknown option ${a}. Try --help.`);
    else opts.files.push(a);
  }
  return opts;
}

/* --- main --------------------------------------------------------------- */
async function main() {
  loadEnvFiles();
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.files.length) { usage(); process.exit(1); }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // 1. Validate every file first. Validation needs no database at all, so
  //    --dry-run on a laptop with no credentials still catches the mistakes
  //    that matter most (a missing `correct`, a solution line that does not
  //    exist, an answer written into the public config).
  const parsedFiles = [];
  let hadErrors = false;

  for (const file of opts.files) {
    let raw;
    try {
      raw = JSON.parse(await readFile(file, 'utf8'));
    } catch (e) {
      console.error(`${red('✗')} ${bold(file)}: not valid JSON — ${e.message}`);
      hadErrors = true;
      continue;
    }
    const result = parseActivityFile(raw);
    parsedFiles.push({ file, result });

    console.log(`\n${bold(file)}`);
    for (const w of result.warnings) {
      console.log(`  ${yellow('!')} ${dim(w.path)} ${w.message}`);
    }
    for (const e of result.errors) {
      console.log(`  ${red('✗')} ${dim(e.path)} ${e.message}`);
    }
    if (result.ok) {
      const steps = result.activities.reduce((n, a) => n + a.steps.length, 0);
      const keys = result.activities.reduce((n, a) => n + Object.keys(a.keys).length, 0);
      console.log(
        `  ${green('✓')} ${result.activities.length} activit${result.activities.length === 1 ? 'y' : 'ies'}, ` +
          `${steps} step${steps === 1 ? '' : 's'}, ${keys} answer key${keys === 1 ? '' : 's'} split out`,
      );
    } else {
      hadErrors = true;
    }
  }

  if (hadErrors) {
    console.error(`\n${red('Nothing was imported.')} Fix the errors above and run again.`);
    process.exit(1);
  }

  if (!url || !key) {
    if (opts.dryRun) {
      console.log(
        `\n${yellow('!')} No NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, so the file was ` +
          'validated but not checked against the database (runner registry, existing activities).',
      );
      process.exit(0);
    }
    die('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to import.');
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // 2. Resolve the school and the owning teacher.
  const slug = opts.school || process.env.NEXT_PUBLIC_SCHOOL_SLUG;
  if (!slug) die('No school. Pass --school <slug> or set NEXT_PUBLIC_SCHOOL_SLUG.');

  const { data: school, error: schoolErr } = await db
    .from('schools').select('id, name, slug').eq('slug', slug).maybeSingle();
  if (schoolErr) die(`Could not read schools: ${schoolErr.message}`);
  if (!school) die(`No school with slug "${slug}".`);

  let ownerQuery = db
    .from('profiles').select('id, username, display_name, role')
    .eq('school_id', school.id).in('role', ['teacher', 'admin']).eq('archived', false);
  if (opts.owner) ownerQuery = ownerQuery.eq('username', opts.owner);
  const { data: owners, error: ownerErr } = await ownerQuery.order('created_at').limit(1);
  if (ownerErr) die(`Could not read profiles: ${ownerErr.message}`);
  if (!owners || !owners.length) {
    die(
      opts.owner
        ? `No teacher "${opts.owner}" in ${school.name}.`
        : `No teacher in ${school.name} to own the activities. Create one, or pass --owner.`,
    );
  }
  const owner = owners[0];

  console.log(
    `\n${dim('School')} ${school.name} ${dim(`(${school.slug})`)}   ` +
      `${dim('Owner')} ${owner.display_name} ${dim(`(${owner.username})`)}` +
      (opts.replace ? `   ${yellow('--replace')}` : ''),
  );

  // 3. Plan.
  const activities = parsedFiles.flatMap((p) => p.result.activities);
  const plan = await planImport(db, {
    schoolId: school.id,
    ownerId: owner.id,
    activities,
    replace: opts.replace,
  });

  if (opts.json) {
    console.log(JSON.stringify(
      { plan: plan.activities.map(({ _row, _keys, ...rest }) => rest), errors: plan.errors, warnings: plan.warnings },
      null, 2,
    ));
  } else {
    console.log('');
    for (const a of plan.activities) {
      const verb = a.action === 'create' ? green('create') : yellow('update');
      console.log(`  ${verb} ${bold(a.title)}${a.topic ? dim(`  · ${a.topic}`) : ''}`);
      for (const s of a.steps) {
        const mark =
          s.action === 'create' ? green('+') :
          s.action === 'update' ? yellow('~') :
          s.action === 'kept' ? dim('=') : dim('·');
        console.log(
          `      ${mark} ${s.id} ${dim(s.runner_id)}` +
            (s.hasKey ? dim('  key → activity_keys') : dim('  no key')),
        );
      }
      for (const n of a.notes) console.log(`      ${yellow('!')} ${n}`);
    }
    for (const w of plan.warnings) console.log(`  ${yellow('!')} ${w}`);
    for (const e of plan.errors) console.log(`  ${red('✗')} ${e}`);
  }

  if (plan.errors.length) {
    console.error(`\n${red('Nothing was imported.')}`);
    process.exit(1);
  }
  if (opts.dryRun) {
    console.log(`\n${dim('Dry run — nothing written. Drop --dry-run to import.')}`);
    return;
  }

  // 4. Commit.
  const { ok, results } = await commitImport(db, plan);
  console.log('');
  for (const r of results) {
    if (r.error) console.log(`  ${red('✗')} ${r.title}: ${r.error}`);
    else console.log(`  ${green('✓')} ${r.title} ${dim(r.action)} ${dim(r.id ?? '')}`);
  }
  if (!ok) process.exit(1);
  console.log(`\n${green('Done.')}`);
}

main().catch((e) => die(e && e.stack ? e.stack : String(e)));
