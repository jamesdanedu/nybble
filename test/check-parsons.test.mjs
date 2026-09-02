/* scripts/check-parsons.mjs — does it actually catch the things it claims to?
 *
 * Run:  node test/check-parsons.test.mjs
 *
 * No browser and no database: the checker is a subprocess, the activity files
 * are written to a temp directory, and every case asserts on the exit code and
 * on the message a teacher would read. A checker that silently passes broken
 * keys is worse than no checker, so each trap gets a fixture that must fail.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';

const CHECKER = path.join(import.meta.dirname, '..', 'scripts', 'check-parsons.mjs');
const dir = mkdtempSync(path.join(os.tmpdir(), 'nybble-checker-test-'));
let failures = 0;

/** One parsons step, wrapped in the smallest activity file that validates. */
function file(name, { lines, solution, distractors = [], maxIndent = 3, check }) {
  const p = path.join(dir, `${name}.json`);
  writeFileSync(p, JSON.stringify({
    nybble: 1,
    activities: [{
      title: name,
      topic: 'test',
      steps: [{
        id: 's1',
        runner_id: 'parsons',
        title: name,
        config: { language: 'python', indentSize: 4, maxIndent, lines },
        key: { solution, distractors, marks: solution.length, partial: true, check },
      }],
    }],
  }), 'utf8');
  return p;
}

function run(p, flags = []) {
  const r = spawnSync(process.execPath, [CHECKER, ...flags, p], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function expect(name, p, { code, contains, flags = [], absent }) {
  const { code: got, out } = run(p, flags);
  try {
    assert.strictEqual(got, code, `expected exit ${code}, got ${got}\n${out}`);
    if (contains) assert.ok(out.includes(contains), `expected output to mention "${contains}"\n${out}`);
    if (absent) assert.ok(!out.includes(absent), `expected output NOT to mention "${absent}"\n${out}`);
    console.log(`✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`✗ ${name}\n    ${e.message.split('\n').join('\n    ')}`);
  }
}

/* The shape every fixture below is a deliberate corruption of. */
const GOOD_LINES = [
  { id: 'a', text: 'total = 0' },
  { id: 'b', text: 'for n in range(1, 4):' },
  { id: 'c', text: 'total = total + n' },
  { id: 'd', text: 'print(total)' },
];
const GOOD_SOLUTION = [
  { id: 'a', indent: 0 },
  { id: 'b', indent: 0 },
  { id: 'c', indent: 1 },
  { id: 'd', indent: 0 },
];

// --------------------------------------------------------------------------
expect('a sound key passes, and its output is checked',
  file('good', { lines: GOOD_LINES, solution: GOOD_SOLUTION, check: { stdout: '6\n' } }),
  { code: 0, contains: 'output checked' });

expect('an indent that does not compile is caught',
  // 'total = total + n' left at indent 0, so the for has an empty body.
  file('bad-indent', {
    lines: GOOD_LINES,
    solution: GOOD_SOLUTION.map((s) => (s.id === 'c' ? { id: 'c', indent: 0 } : s)),
  }),
  { code: 1, contains: 'not valid Python' });

expect('a solution deeper than maxIndent is caught',
  file('unreachable-indent', { lines: GOOD_LINES, solution: GOOD_SOLUTION, maxIndent: 0 }),
  { code: 1, contains: 'maxIndent' });

expect('a first line that is indented is caught',
  file('bad-start', {
    lines: GOOD_LINES,
    solution: [{ id: 'a', indent: 1 }, ...GOOD_SOLUTION.slice(1)],
  }),
  { code: 1, contains: 'has to start at indent 0' });

expect('a distractor identical to a solution line is caught',
  file('twin-distractor', {
    lines: [...GOOD_LINES, { id: 'x', text: 'print(total)' }],
    solution: GOOD_SOLUTION,
    distractors: ['x'],
  }),
  { code: 1, contains: 'word-for-word' });

expect('output that does not match the claim is caught',
  file('wrong-output', {
    lines: GOOD_LINES, solution: GOOD_SOLUTION, check: { stdout: '7\n' },
  }),
  { code: 1, contains: 'does not match check.stdout' });

expect('a run-time error is caught, not just a syntax error',
  file('runtime-error', {
    lines: [
      { id: 'a', text: 'total = "0"' },
      { id: 'b', text: 'print(total + 1)' },
    ],
    solution: [{ id: 'a', indent: 0 }, { id: 'b', indent: 0 }],
    check: { stdout: '1\n' },
  }),
  { code: 1, contains: 'raised at run time' });

expect('a loop that never ends is caught rather than hanging the run',
  file('runaway', {
    lines: [
      { id: 'a', text: 'while True:' },
      { id: 'b', text: 'x = 1' },
    ],
    solution: [{ id: 'a', indent: 0 }, { id: 'b', indent: 1 }],
    check: { stdout: '', timeoutMs: 1500 },
  }),
  { code: 1, contains: 'never finished' });

expect('two solution lines with the same text warn but do not fail',
  file('ambiguous', {
    lines: [
      { id: 'a', text: 'print("go")' },
      { id: 'b', text: 'print("go")' },
    ],
    solution: [{ id: 'a', indent: 0 }, { id: 'b', indent: 0 }],
    check: { stdout: 'go\ngo\n' },
  }),
  { code: 0, contains: 'marker matches ids' });

/* --order: two lines that could be written either way round. Both of these are
 * plain assignments the other does not depend on, so the swap still runs and
 * still prints the same thing — which is exactly what the marker cannot see. */
const INTERCHANGEABLE = {
  lines: [
    { id: 'a', text: 'width = 3' },
    { id: 'b', text: 'height = 4' },
    { id: 'c', text: 'print(width * height)' },
  ],
  solution: [{ id: 'a', indent: 0 }, { id: 'b', indent: 0 }, { id: 'c', indent: 0 }],
  check: { stdout: '12\n' },
};

expect('--order spots two lines that could be written either way round',
  file('either-way', INTERCHANGEABLE),
  { flags: ['--order'], code: 0, contains: 'can be swapped' });

expect('without --order the same file says nothing about it',
  file('either-way-quiet', INTERCHANGEABLE),
  { code: 0, absent: 'can be swapped' });

expect('--order stays quiet when the order really is forced',
  // Each line needs the one above it, so no swap survives.
  file('forced-order', {
    lines: [
      { id: 'a', text: 'message = "Hello"' },
      { id: 'b', text: 'message = message + ", world"' },
      { id: 'c', text: 'print(message)' },
    ],
    solution: [{ id: 'a', indent: 0 }, { id: 'b', indent: 0 }, { id: 'c', indent: 0 }],
    check: { stdout: 'Hello, world\n' },
  }),
  { flags: ['--order'], code: 0, absent: 'can be swapped' });

// --------------------------------------------------------------------------
expect('the real Iteration activity is sound',
  path.join(import.meta.dirname, '..', 'examples', 'python', '06-iteration.json'),
  { code: 0, contains: '0 errors, 0 warnings' });

rmSync(dir, { recursive: true, force: true });
if (failures) {
  console.log(`\n✗ ${failures} check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
