#!/usr/bin/env node
/* ===========================================================================
 * bundle-score.mjs — flatten supabase/functions/score/ into one file.
 *
 * The Supabase CLI deploys the whole folder and relative imports just work, so
 * this is not needed for `supabase functions deploy score`. It exists for the
 * dashboard's in-browser editor, where four files with `./mcq.ts` imports is a
 * fiddly thing to reproduce by hand and an easy thing to get half-right.
 *
 * GENERATED, NEVER EDITED. That is the whole point: a hand-made single-file
 * copy of a scorer is a second implementation that silently stops matching the
 * first, and the symptom would be marks that differ depending on how the
 * function happened to be deployed. Run this and paste the output instead.
 *
 *     node scripts/bundle-score.mjs > score.bundled.ts
 *
 * Each module becomes a namespace object built by an IIFE, so `mcq.score(...)`
 * at the call sites keeps working untouched. This is only safe because the
 * three scorers import nothing — not even each other — which the script
 * verifies rather than assumes.
 * ======================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(import.meta.dirname, '..', 'supabase', 'functions', 'score');
const MODULES = ['mcq', 'numbase', 'parsons'];

const read = (name) => fs.readFileSync(path.join(DIR, `${name}.ts`), 'utf8');

function namespaceFor(name) {
  const src = read(name);

  // The wrapping trick only holds if the module is self-contained.
  const imports = src.match(/^\s*import\s.+$/gm);
  if (imports) {
    throw new Error(
      `${name}.ts has imports, which this bundler cannot hoist:\n  ${imports.join('\n  ')}\n` +
        'Either inline the dependency or deploy with the Supabase CLI instead.',
    );
  }

  // Only functions can go in the returned object; interfaces are types and
  // disappear at runtime, so they stay inside the closure as declarations.
  const fns = [...src.matchAll(/^export\s+function\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  if (!fns.length) throw new Error(`${name}.ts exports no functions — nothing to bundle.`);

  const body = src.replace(/^export\s+/gm, '');
  return `// ---- ${name}.ts ${'-'.repeat(Math.max(0, 66 - name.length))}\nconst ${name} = (() => {\n${body}\n  return { ${fns.join(', ')} };\n})();\n`;
}

const index = read('index');

// Keep the remote import at the top, where Deno needs it; drop the three
// relative ones, whose modules are about to be defined inline.
const remoteImports = [...index.matchAll(/^import\s.+from\s+'(?!\.)[^']+';$/gm)].map((m) => m[0]);
const body = index.replace(/^import\s.+$/gm, '').replace(/^\n{3,}/gm, '\n\n');

const out = [
  '// ============================================================================',
  '// GENERATED FILE — do not edit.',
  '//',
  '// Built from supabase/functions/score/{index,mcq,numbase,parsons}.ts by',
  '// scripts/bundle-score.mjs, for pasting into the Supabase dashboard editor.',
  '// Edit those files and re-run the script; never patch this copy, or the',
  '// dashboard and the CLI will start marking the same answer differently.',
  '// ============================================================================',
  '',
  ...remoteImports,
  '',
  ...MODULES.map(namespaceFor),
  body.trimStart(),
].join('\n');

process.stdout.write(out);
