#!/usr/bin/env node
/* ===========================================================================
 * check-parsons.mjs — prove that every Parsons key is a program that runs.
 *
 *   node scripts/check-parsons.mjs examples/python/06-iteration.json
 *   node scripts/check-parsons.mjs --show examples/python/*.json
 *
 * The importer's --dry-run validates structure: ids exist, solutions point at
 * real lines, no answer leaks into the public config. What it cannot know is
 * whether the key's solution, once reassembled with its indentation, is valid
 * Python that does what the question claims. That is the mistake authors and
 * language models both make, and the student who assembles the "correct"
 * answer is the one who finds it.
 *
 * So this reassembles each solution and puts it through the real interpreter,
 * plus the four Parsons-specific traps no compiler can see:
 *
 *   - a solution deeper than config.maxIndent, which the runner clamps, so the
 *     answer cannot be expressed no matter what the student does;
 *   - a first line that is not at indent 0;
 *   - a distractor whose text matches a solution line, making two pool entries
 *     interchangeable on screen but not to the marker;
 *   - two solution lines with the same text, which makes the LCS marking
 *     ambiguous for an arrangement that looks right.
 *
 * Optional per-step behaviour check, in the key (never the config, so it stays
 * out of the browser):
 *
 *   "check": { "stdin": "5\n0\n", "stdout": "Total: 5\n", "timeoutMs": 5000 }
 *
 * With --order it goes further and proves the key's order is the only order
 * that produces that output, by swapping each adjacent pair and re-running.
 *
 * Exits non-zero if anything failed, so it can sit in CI beside --dry-run.
 * ======================================================================== */

import { readFile } from 'node:fs/promises';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const PYTHON = process.env.PYTHON || 'python3';
const DEFAULT_TIMEOUT_MS = 5000;

/* --- output, same conventions as the importer --------------------------- */
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (useColour ? `\u001b[${code}m${s}\u001b[0m` : String(s));
const red = c('31'), green = c('32'), yellow = c('33'), dim = c('2'), bold = c('1');

function usage() {
  console.log(`
${bold('nybble parsons checker')}

  node scripts/check-parsons.mjs [options] <file.json> [more.json ...]

Options
  --show        print the reassembled program for every step
  --order       also check that the key's order is the only order that works
                (swaps each adjacent pair and re-runs; slower, warnings only)
  -h, --help    this

Environment
  PYTHON        interpreter to use (default: python3)
`);
}

/* --- the reassembly ------------------------------------------------------
 * Exactly what the runner shows a student who gets it right: the solution
 * lines in order, each pushed out by indent x indentSize spaces.
 * ---------------------------------------------------------------------- */
function reassemble(config, solution) {
  const indentSize = Number(config.indentSize) || 4;
  const textById = new Map((config.lines || []).map((l) => [l.id, l.text]));
  const missing = solution.filter((s) => !textById.has(s.id)).map((s) => s.id);
  if (missing.length) {
    return { error: `solution references lines that are not in config.lines: ${missing.join(', ')}` };
  }
  const source = solution
    .map((s) => ' '.repeat(Number(s.indent || 0) * indentSize) + textById.get(s.id))
    .join('\n');
  return { source: source + '\n' };
}

/* --- the traps a compiler cannot see ------------------------------------ */
function staticChecks(config, key, solution) {
  const problems = [];
  const push = (level, msg) => problems.push({ level, msg });

  const maxIndent = config.maxIndent == null ? 5 : Number(config.maxIndent);
  const deepest = Math.max(...solution.map((s) => Number(s.indent || 0)));
  if (deepest > maxIndent) {
    push('error', `solution goes to indent ${deepest} but config.maxIndent is ${maxIndent}, `
      + 'so the runner clamps it and the student cannot express the answer');
  }
  if (Number(solution[0].indent || 0) !== 0) {
    push('error', 'the first solution line is indented; a program has to start at indent 0');
  }

  const textById = new Map((config.lines || []).map((l) => [l.id, l.text]));
  const norm = (id) => String(textById.get(id) ?? '').trim();
  const solutionIds = new Set(solution.map((s) => s.id));

  const solutionText = new Map();
  for (const s of solution) {
    const t = norm(s.id);
    if (solutionText.has(t)) {
      push('warn', `lines ${solutionText.get(t)} and ${s.id} are both "${t}" — an arrangement `
        + 'that looks right can still be marked wrong, because the marker matches ids');
    } else {
      solutionText.set(t, s.id);
    }
  }

  for (const line of config.lines || []) {
    if (solutionIds.has(line.id)) continue;
    const t = String(line.text ?? '').trim();
    if (solutionText.has(t)) {
      push('error', `distractor ${line.id} is word-for-word the solution line `
        + `${solutionText.get(t)} ("${t}"), so picking either looks identical on screen`);
    }
  }

  if (key.partial && key.marks === undefined) {
    push('warn', 'partial marking is on but no marks are set, so the step falls back to a default');
  }
  return problems;
}

/* --- the interpreter ----------------------------------------------------- */
const tail = (e) => String(e.stderr || e.message).trim().split('\n').slice(-3).join('\n');

function compile(source, dir, name) {
  const file = path.join(dir, `${name}.py`);
  writeFileSync(file, source, 'utf8');
  try {
    execFileSync(PYTHON, ['-m', 'py_compile', file], { stdio: 'pipe' });
  } catch (e) {
    return { error: `the solution is not valid Python:\n${dim(tail(e))}` };
  }
  return { file };
}

function execute(file, check) {
  try {
    return {
      stdout: execFileSync(PYTHON, [file], {
        input: check.stdin ?? '',
        timeout: Number(check.timeoutMs) || DEFAULT_TIMEOUT_MS,
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    };
  } catch (e) {
    if (e.code === 'ETIMEDOUT' || e.signal === 'SIGTERM') {
      return { error: 'the solution never finished — an unguarded infinite loop, '
        + 'or a check.stdin that runs out before the loop stops' };
    }
    return { error: `the solution raised at run time:\n${dim(tail(e))}` };
  }
}

/* --- is the key's order the only order? ----------------------------------
 * A straight-line program — and the early checklist sections are full of them
 * — can easily hold two lines that could be written either way round. The
 * marker does not know that: it matches the key, so a student who picks the
 * other order loses marks for a program that works.
 *
 * Rather than guess from the text, swap each adjacent pair sitting at the same
 * indent and run it. If the output is unchanged, the pair is interchangeable
 * and the author has to decide whether to live with it. Off by default because
 * a transposed pair costs only a little under partial marking, and forcing
 * every program into a strictly unique order distorts the code students read.
 * ---------------------------------------------------------------------- */
function interchangeableLines(config, solution, check, dir, name) {
  const problems = [];
  for (let i = 0; i < solution.length - 1; i++) {
    const a = solution[i], b = solution[i + 1];
    // Across a change of indent a swap is a different program, not the same
    // one written differently.
    if (Number(a.indent || 0) !== Number(b.indent || 0)) continue;

    const swapped = solution.slice();
    swapped[i] = b;
    swapped[i + 1] = a;
    const { source } = reassemble(config, swapped);
    const { file, error } = compile(source, dir, `${name}-swap${i}`);
    if (error) continue;                       // the swap breaks it, which is the point

    const out = execute(file, check);
    if (out.error || out.stdout !== check.stdout) continue;

    problems.push({ level: 'warn', msg: `lines ${a.id} and ${b.id} can be swapped and the `
      + 'program still produces the same output, so a student who writes them the other way '
      + 'round loses marks for an answer that works' });
  }
  return problems;
}

function behaviourChecks(config, key, solution, source, dir, name, checkOrder) {
  const { file, error } = compile(source, dir, name);
  if (error) return [{ level: 'error', msg: error }];

  const check = key.check;
  if (!check || check.stdout === undefined) return [];

  const out = execute(file, check);
  if (out.error) return [{ level: 'error', msg: out.error }];
  if (out.stdout !== check.stdout) {
    return [{ level: 'error', msg: 'output does not match check.stdout:\n'
      + `${dim('expected')} ${JSON.stringify(check.stdout)}\n`
      + `${dim('got     ')} ${JSON.stringify(out.stdout)}` }];
  }

  return checkOrder ? interchangeableLines(config, solution, check, dir, name) : [];
}

/* --- main ---------------------------------------------------------------- */
async function main() {
  const argv = process.argv.slice(2);
  const files = [];
  let show = false, checkOrder = false;
  for (const a of argv) {
    if (a === '--show') show = true;
    else if (a === '--order') checkOrder = true;
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else if (a.startsWith('-')) { console.error(red('✗ ') + `Unknown option ${a}. Try --help.`); process.exit(1); }
    else files.push(a);
  }
  if (!files.length) { usage(); process.exit(1); }

  try {
    execFileSync(PYTHON, ['--version'], { stdio: 'pipe' });
  } catch {
    console.error(red('✗ ') + `Cannot run ${bold(PYTHON)}. Set PYTHON to your interpreter.`);
    process.exit(1);
  }

  const dir = mkdtempSync(path.join(os.tmpdir(), 'nybble-parsons-'));
  let errors = 0, warnings = 0, checked = 0, ran = 0;

  try {
    for (const file of files) {
      let doc;
      try {
        doc = JSON.parse(await readFile(file, 'utf8'));
      } catch (e) {
        console.error(`${red('✗')} ${bold(file)}: not valid JSON — ${e.message}`);
        errors++;
        continue;
      }
      console.log(`\n${bold(file)}`);

      for (const activity of doc.activities || []) {
        for (const step of activity.steps || []) {
          if (step.runner_id !== 'parsons') continue;
          checked++;

          const label = `${activity.title} › ${step.id} ${dim(step.title || '')}`;
          const config = step.config || {};
          const key = step.key || {};
          const solution = key.solution;

          if (!Array.isArray(solution) || !solution.length) {
            console.log(`  ${red('✗')} ${label}\n      ${red('no key.solution — run the importer with --dry-run first')}`);
            errors++;
            continue;
          }

          const { source, error } = reassemble(config, solution);
          if (error) {
            console.log(`  ${red('✗')} ${label}\n      ${red(error)}`);
            errors++;
            continue;
          }

          const safeName = `${activity.title}-${step.id}`.replace(/[^\w-]+/g, '_');
          const problems = [
            ...staticChecks(config, key, solution),
            ...behaviourChecks(config, key, solution, source, dir, safeName, checkOrder),
          ];
          if (key.check && key.check.stdout !== undefined) ran++;

          const failed = problems.filter((p) => p.level === 'error');
          const warned = problems.filter((p) => p.level === 'warn');
          errors += failed.length;
          warnings += warned.length;

          const mark = failed.length ? red('✗') : warned.length ? yellow('!') : green('✓');
          const ranNote = key.check && key.check.stdout !== undefined ? dim(' · output checked') : '';
          console.log(`  ${mark} ${label}${ranNote}`);
          for (const p of problems) {
            const tag = p.level === 'error' ? red('error') : yellow('warn ');
            console.log(`      ${tag} ${p.msg.split('\n').join('\n            ')}`);
          }
          if (show) {
            console.log(source.replace(/^/gm, dim('      | ')));
          }
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const summary = `${checked} parsons step${checked === 1 ? '' : 's'} checked, `
    + `${ran} run against expected output, ${errors} error${errors === 1 ? '' : 's'}, `
    + `${warnings} warning${warnings === 1 ? '' : 's'}`;
  console.log(`\n${errors ? red('✗ ') : green('✓ ')}${summary}`);
  process.exit(errors ? 1 : 0);
}

main().catch((e) => {
  console.error(red('✗ ') + (e && e.stack ? e.stack : String(e)));
  process.exit(1);
});
