/* Parsons problem: the runner driven through the harness, and the real
 * server scorer exercised directly.
 *
 * Run:  cd /root/nybble
 *       (setsid python3 test/vercel-sim.py --port 8103 &)
 *       node test/parsons.test.mjs
 *
 * The scoring assertions import supabase/functions/score/parsons.ts straight
 * into Node (type stripping, no build step) so the numbers below are the ones
 * a real submission would get, not a re-implementation of them.
 */
import { chromium } from 'playwright';
import assert from 'node:assert';
import * as parsons from '../supabase/functions/score/parsons.ts';

const BASE = process.env.BASE || 'http://127.0.0.1:8103';

// The sample the harness mounts, mirrored from demo-kit.js so the expected
// numbers below can be read next to the key they come from.
const KEY = {
  solution: [
    { id: 'l1', indent: 0 },   // def total(numbers):
    { id: 'l2', indent: 1 },   //     runningTotal = 0
    { id: 'l3', indent: 1 },   //     for n in numbers:
    { id: 'l4', indent: 2 },   //         runningTotal = runningTotal + n
    { id: 'l5', indent: 1 },   //     return runningTotal
  ],
  distractors: ['d1', 'd2'],
  marks: 5,
  partial: true,
  distractorPenalty: 0.5,
  explanation: 'The accumulator has to be initialised before the loop, and the return has to be outside it.',
};
const CFG = { indentSize: 4, maxIndent: 5 };
const CORRECT = KEY.solution.map((s) => [s.id, s.indent]);

const sc = (arrangement, unused = [], key = KEY) =>
  parsons.score(CFG, key, {
    arrangement: arrangement.map(([id, indent]) => ({ id, indent })),
    unused,
  });

// ===========================================================================
// A. The scorer, on its own
// ===========================================================================

// Exact match — full marks, and `exact` set so the runner can say so.
{
  const r = sc(CORRECT);
  assert.strictEqual(r.total, 5, `exact arrangement should score 5, got ${r.total}`);
  assert.strictEqual(r.max, 5);
  assert.strictEqual(r.exact, true);
  assert.deepStrictEqual(r.distractorsUsed, []);
  assert.deepStrictEqual(r.missing, []);
  assert.strictEqual(r.perLine.length, 5);
  assert.ok(r.perLine.every((p) => p.inSequence && p.indentOk && !p.distractor),
    'every line should be marked in-sequence and correctly indented');
  console.log('✓ scorer: exact arrangement → 5/5, exact:true');
}

// One indent wrong: order 5/5, indents 4/5 → 5 × (0.7 + 0.3×0.8) = 4.7
{
  const near = CORRECT.map(([id, ind]) => (id === 'l4' ? [id, 1] : [id, ind]));
  const r = sc(near);
  assert.strictEqual(r.orderScore, 1);
  assert.strictEqual(r.indentScore, 0.8);
  assert.strictEqual(r.total, 4.7, `one wrong indent should score 4.7, got ${r.total}`);
  assert.strictEqual(r.exact, false);
  const l4 = r.perLine.find((p) => p.id === 'l4');
  assert.ok(l4.inSequence && !l4.indentOk, 'l4 is in order but wrongly indented');
  assert.strictEqual(l4.expectedIndent, 2, 'review needs the indent the key wanted');
  console.log('✓ scorer: one indent level out → 4.7/5, flagged on that line only');
}

// Two lines swapped: LCS is 4 of 5, indents all correct
// → 5 × (0.7×0.8 + 0.3×1) = 4.3
{
  const swapped = [['l1', 0], ['l3', 1], ['l2', 1], ['l4', 2], ['l5', 1]];
  const r = sc(swapped);
  assert.strictEqual(r.orderScore, 0.8, `LCS should be 4/5, got ${r.orderScore}`);
  assert.strictEqual(r.indentScore, 1);
  assert.strictEqual(r.total, 4.3, `a swap should score 4.3, got ${r.total}`);
  assert.strictEqual(r.perLine.filter((p) => !p.inSequence).length, 1,
    'exactly one line falls outside the common subsequence');
  console.log('✓ scorer: two lines swapped → 4.3/5 (LCS keeps the rest)');
}

// A missing line must not zero everything under it — that is the whole reason
// for LCS over a positional comparison.
{
  const dropped = CORRECT.filter(([id]) => id !== 'l2');
  const r = sc(dropped, ['l2', 'd1', 'd2']);
  assert.strictEqual(r.orderScore, 0.8);
  assert.strictEqual(r.indentScore, 1);
  assert.strictEqual(r.total, 4.3);
  assert.deepStrictEqual(r.missing, ['l2']);
  console.log('✓ scorer: a dropped line costs its own share only → 4.3/5');
}

// A distractor costs exactly distractorPenalty, on top of an otherwise perfect
// program: 5 − 0.5 = 4.5, and `exact` is false because the extra line is there.
{
  const withD = [...CORRECT, ['d1', 1]];
  const r = sc(withD, ['d2']);
  assert.strictEqual(r.orderScore, 1);
  assert.strictEqual(r.indentScore, 1);
  assert.strictEqual(r.total, 4.5, `one distractor should cost 0.5, got ${r.total}`);
  assert.strictEqual(r.exact, false);
  assert.deepStrictEqual(r.distractorsUsed, ['d1']);
  const d = r.perLine.find((p) => p.id === 'd1');
  assert.ok(d.distractor && !d.inSequence && d.expectedIndent === null);
  const both = sc([...CORRECT, ['d1', 1], ['d2', 1]], []);
  assert.strictEqual(both.total, 4, 'two distractors should cost 1.0');
  console.log('✓ scorer: distractors cost 0.5 each → 4.5/5 and 4/5');
}

// Penalties floor at zero rather than going negative.
{
  const harsh = { ...KEY, distractorPenalty: 3 };
  const r = sc([['l1', 0], ['d1', 0], ['d2', 0]], [], harsh);
  assert.strictEqual(r.total, 0, `penalties must floor at 0, got ${r.total}`);
  console.log('✓ scorer: distractor penalties floor at 0');
}

// Without `partial`, anything short of an exact match is worth nothing.
{
  const strict = { ...KEY, partial: false };
  assert.strictEqual(sc(CORRECT, [], strict).total, 5);
  const near = CORRECT.map(([id, ind]) => (id === 'l4' ? [id, 1] : [id, ind]));
  assert.strictEqual(sc(near, [], strict).total, 0,
    'all-or-nothing must not award partial credit');
  console.log('✓ scorer: partial:false is all-or-nothing');
}

// Empty and junk submissions are scored, not thrown at.
{
  assert.strictEqual(sc([]).total, 0);
  assert.strictEqual(parsons.score(CFG, KEY, {}).total, 0);
  assert.strictEqual(parsons.score(CFG, {}, { arrangement: [{ id: 'l1', indent: 0 }] }).max, 0);
  const clamped = sc([['l1', 99]]);
  assert.strictEqual(clamped.perLine[0].indent, 5, 'indent must clamp to config.maxIndent');
  console.log('✓ scorer: empty / malformed / out-of-range input is handled');
}

// ===========================================================================
// B. The runner, driven through the harness
// ===========================================================================
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/favicon\.ico/.test(m.location()?.url ?? '')) return;
  consoleErrors.push(m.text());
});

await page.goto(`${BASE}/harness.html`);

// The harness's runner picker is a static list; add the option rather than
// editing harness.html, which another agent owns.
await page.evaluate(() => {
  const sel = document.getElementById('runner');
  const o = document.createElement('option');
  o.value = 'parsons';
  o.textContent = 'parsons — Parsons Problem';
  sel.appendChild(o);
});

// Record the raw protocol traffic so the response shape can be asserted
// exactly as it goes over postMessage.
await page.evaluate(() => {
  window.__msgs = { state: [], submit: [] };
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.channel !== 'sap-runner-v1') return;
    if (d.type === 'state') window.__msgs.state.push(d.state);
    if (d.type === 'submit') window.__msgs.submit.push(d);
  });
});

await page.selectOption('#runner', 'parsons');
await page.waitForFunction(() => /mode: attempt/.test(document.getElementById('modePill').textContent));

const frame = async () => (await (await page.$('#frame iframe')).contentFrame());
const poolIds = (f) => f.$$eval('#list-pool .p-line', (n) => n.map((x) => x.dataset.id));
const solIds = (f) => f.$$eval('#list-solution .p-line', (n) => n.map((x) => x.dataset.id));
const solIndents = (f) => f.$$eval('#list-solution .p-line',
  (n) => n.map((x) => x.querySelectorAll('.p-guide').length));

async function remount() {
  await page.click('#resetBtn');
  await page.waitForFunction(() => /mode: attempt/.test(document.getElementById('modePill').textContent));
  const f = await frame();
  await f.waitForSelector('#list-pool .p-line');
  return f;
}

let f = await frame();
await f.waitForSelector('#list-pool .p-line');

// --------------------------------------------------------------------------
// 1. Every line renders in the pool, shuffled deterministically, none marked
// --------------------------------------------------------------------------
const poolA = await poolIds(f);
assert.strictEqual(poolA.length, 7, `pool should hold all 7 lines, got ${poolA.length}`);
assert.deepStrictEqual([...poolA].sort(), ['d1', 'd2', 'l1', 'l2', 'l3', 'l4', 'l5'],
  'every configured line must appear exactly once');
assert.deepStrictEqual(await solIds(f), [], 'the program starts empty');

// Nothing in the DOM may hint at which lines are distractors.
const leak = await f.evaluate(() =>
  /distractor|solution|answer/i.test(document.getElementById('list-pool').innerHTML));
assert.ok(!leak, 'the pool markup must not label distractors');
console.log(`✓ pool renders all 7 lines with no distractor tell: [${poolA.join(' ')}]`);

const f2 = await remount();
assert.deepStrictEqual(await poolIds(f2), poolA, 'the same seed must reshuffle identically');
await page.fill('#seed', '4242');
await page.click('#mount');
await page.waitForTimeout(300);
f = await frame();
await f.waitForSelector('#list-pool .p-line');
const poolC = await poolIds(f);
assert.notDeepStrictEqual(poolC, poolA, 'a different seed should shuffle differently');
await page.fill('#seed', '20260901');
f = await remount();
console.log(`✓ pool shuffle is seed-stable, and seed 4242 differs: [${poolC.join(' ')}]`);

// --------------------------------------------------------------------------
// 2. Click to move a line, keyboard to move another, Tab to indent
// --------------------------------------------------------------------------
await f.click('#list-pool .p-line[data-id="l1"] [data-act="add"]');
await f.waitForSelector('#list-solution .p-line[data-id="l1"]');
assert.deepStrictEqual(await solIds(f), ['l1'], 'clicking → should move the line across');
assert.strictEqual((await poolIds(f)).length, 6);
console.log('✓ click moves a line into the program');

// Click-to-select then click-to-place: pick l2 up, drop it into the program.
await f.click('#list-pool .p-line[data-id="l2"] .p-text');
assert.strictEqual(
  await f.getAttribute('#list-pool .p-line[data-id="l2"]', 'aria-selected'), 'true',
  'a tapped line must report itself as selected');
await f.click('#list-solution .p-slot[data-index="1"]');
await f.waitForSelector('#list-solution .p-line[data-id="l2"]');
assert.deepStrictEqual(await solIds(f), ['l1', 'l2'], 'tap-to-place should land at the chosen slot');
assert.strictEqual(
  await f.getAttribute('#list-solution .p-line[data-id="l2"]', 'aria-selected'), 'false',
  'the line is put down once placed');
console.log('✓ click-to-select then click-to-place works without any drag');

// Keyboard: → moves a pool line into the program, Enter picks it up, Tab indents.
await f.locator('#list-pool .p-line[data-id="l3"]').press('ArrowRight');
await f.waitForSelector('#list-solution .p-line[data-id="l3"]');
assert.deepStrictEqual(await solIds(f), ['l1', 'l2', 'l3']);
console.log('✓ keyboard: ArrowRight moves a line into the program');

await f.locator('#list-solution .p-line[data-id="l3"]').press('Enter');
assert.strictEqual(
  await f.getAttribute('#list-solution .p-line[data-id="l3"]', 'aria-selected'), 'true',
  'Enter must pick the line up (aria-selected, not the deprecated aria-grabbed)');
await f.locator('#list-solution .p-line[data-id="l3"]').press('Tab');
assert.deepStrictEqual(await solIndents(f), [0, 0, 1],
  'Tab should indent the held line by one level');
const lbl = await f.getAttribute('#list-solution .p-line[data-id="l3"]', 'aria-label');
assert.ok(/indent level 1/.test(lbl), `indent must be in the accessible name: "${lbl}"`);
const spoken = await f.textContent('#live');
assert.ok(/indent level 1/.test(spoken), `the live region should narrate the move: "${spoken}"`);
console.log('✓ keyboard: Enter picks up, Tab indents, and the move is announced');

await f.locator('#list-solution .p-line[data-id="l3"]').press('Shift+Tab');
assert.deepStrictEqual(await solIndents(f), [0, 0, 0], 'Shift+Tab should outdent');

// Tab must NOT be swallowed once the line is put down — otherwise the list is
// a keyboard trap.
await f.locator('#list-solution .p-line[data-id="l3"]').press('Escape');
assert.strictEqual(
  await f.getAttribute('#list-solution .p-line[data-id="l3"]', 'aria-selected'), 'false');
await f.locator('#list-solution .p-line[data-id="l3"]').press('Tab');
assert.deepStrictEqual(await solIndents(f), [0, 0, 0],
  'Tab on a line that is not held must move focus, not indent (no keyboard trap)');
console.log('✓ keyboard: Escape puts the line down and frees Tab — no keyboard trap');

// Arrow keys reorder a held line; Backspace sends one back to the pool.
await f.locator('#list-solution .p-line[data-id="l3"]').press('Enter');
await f.locator('#list-solution .p-line[data-id="l3"]').press('ArrowUp');
assert.deepStrictEqual(await solIds(f), ['l1', 'l3', 'l2'], 'ArrowUp should move a held line up');
await f.locator('#list-solution .p-line[data-id="l3"]').press('ArrowDown');
assert.deepStrictEqual(await solIds(f), ['l1', 'l2', 'l3']);
await f.locator('#list-solution .p-line[data-id="l3"]').press('Backspace');
assert.deepStrictEqual(await solIds(f), ['l1', 'l2'], 'Backspace should return a line to the pool');
assert.ok((await poolIds(f)).includes('l3'));
console.log('✓ keyboard: arrows reorder a held line, Backspace returns it to the pool');

// --------------------------------------------------------------------------
// 3. Autosave carries the real arrangement, not a placeholder
// --------------------------------------------------------------------------
await page.waitForFunction(() => window.__msgs.state.length > 0, null, { timeout: 4000 });
const lastState = await page.evaluate(() => window.__msgs.state[window.__msgs.state.length - 1]);
assert.deepStrictEqual(Object.keys(lastState).sort(), ['arrangement', 'unused']);
assert.deepStrictEqual(lastState.arrangement, [{ id: 'l1', indent: 0 }, { id: 'l2', indent: 0 }],
  `autosaved arrangement is wrong: ${JSON.stringify(lastState.arrangement)}`);
assert.strictEqual(lastState.arrangement.length + lastState.unused.length, 7,
  'every line must be accounted for in the saved state');
await page.waitForFunction(() => !/state: —/.test(document.getElementById('statePill').textContent),
  null, { timeout: 4000 });
console.log('✓ state autosaves { arrangement, unused } with real values');

// --------------------------------------------------------------------------
// 4. Native drag and drop, including drag-right to set the indent
// --------------------------------------------------------------------------
f = await remount();
await f.dragAndDrop('#list-pool .p-line[data-id="l1"]', '#list-solution',
  { targetPosition: { x: 70, y: 20 } });
await f.waitForSelector('#list-solution .p-line[data-id="l1"]');
assert.deepStrictEqual(await solIndents(f), [2],
  'dropping two indent widths in from the margin should set indent 2');
await f.dragAndDrop('#list-solution .p-line[data-id="l1"]', '#list-solution',
  { targetPosition: { x: 8, y: 20 } });
assert.deepStrictEqual(await solIndents(f), [0], 'dragging left should outdent');
await f.dragAndDrop('#list-solution .p-line[data-id="l1"]', '#list-pool');
assert.deepStrictEqual(await solIds(f), [], 'dragging back to the pool should remove the line');
assert.strictEqual((await poolIds(f)).length, 7);
console.log('✓ drag and drop moves lines, and the drop position sets the indent');

// --------------------------------------------------------------------------
// 5. Build the correct program and submit — exact response shape, full marks
// --------------------------------------------------------------------------
async function build(f, spec) {
  for (const [id] of spec) {
    if (!(await f.$(`#list-solution .p-line[data-id="${id}"]`))) {
      await f.click(`#list-pool .p-line[data-id="${id}"] [data-act="add"]`);
      await f.waitForSelector(`#list-solution .p-line[data-id="${id}"]`);
    }
  }
  for (const [id, indent] of spec) {
    for (let i = 0; i < indent; i++) {
      await f.click(`#list-solution .p-line[data-id="${id}"] [data-act="in"]`);
    }
  }
}

f = await remount();
await build(f, CORRECT);
assert.deepStrictEqual(await solIds(f), ['l1', 'l2', 'l3', 'l4', 'l5']);
assert.deepStrictEqual(await solIndents(f), [0, 1, 1, 2, 1],
  'indent buttons should produce the key indents');

await f.click('#submit');
await page.waitForFunction(() => /score: \d/.test(document.getElementById('scorePill').textContent),
  null, { timeout: 5000 });

const sub = await page.evaluate(() => window.__msgs.submit[window.__msgs.submit.length - 1]);
assert.deepStrictEqual(Object.keys(sub.response).sort(), ['arrangement', 'unused'],
  `the response must be exactly { arrangement, unused }, got ${Object.keys(sub.response)}`);
assert.deepStrictEqual(sub.response.arrangement,
  CORRECT.map(([id, indent]) => ({ id, indent })));
assert.deepStrictEqual([...sub.response.unused].sort(), ['d1', 'd2']);
assert.ok(sub.response.arrangement.every((a) =>
  Object.keys(a).sort().join(',') === 'id,indent'), 'each entry is exactly { id, indent }');
console.log('✓ submit sends exactly { arrangement: [{id,indent}], unused: [id] }');

assert.strictEqual(await page.textContent('#scorePill'), 'score: 5 / 5');
// The same response through the real server scorer must agree.
assert.strictEqual(parsons.score(CFG, KEY, sub.response).total, 5);
console.log('✓ correct arrangement scores 5 / 5 in the harness and in parsons.ts');

// --------------------------------------------------------------------------
// 6. Review mode: read-only, marked up from the score payload
// --------------------------------------------------------------------------
await page.waitForFunction(() => /mode: review/.test(document.getElementById('modePill').textContent),
  null, { timeout: 5000 });
f = await frame();
await f.waitForSelector('.p-line.ok');
assert.strictEqual(await f.$$eval('.p-line.ok', (n) => n.length), 5,
  'all five lines should be marked correct');
assert.strictEqual(await f.$$eval('[draggable="true"]', (n) => n.length), 0,
  'review mode must not leave anything draggable');
assert.strictEqual(await f.$$eval('.p-btn', (n) => n.length), 0,
  'review mode must not render the edit buttons');
assert.strictEqual(await f.$$eval('#submit', (n) => n.length), 0,
  'review mode must not render a submit button');
assert.strictEqual(await f.getAttribute('#list-solution', 'aria-disabled'), 'true');
const keyText = await f.textContent('.p-key pre');
assert.strictEqual(keyText,
  'def total(numbers):\n    runningTotal = 0\n    for n in numbers:\n' +
  '        runningTotal = runningTotal + n\n    return runningTotal',
  `the worked solution is wrong:\n${keyText}`);
assert.ok(/accumulator has to be initialised/.test(await f.textContent('.r-explain')),
  'the explanation from the key must be shown');
console.log('✓ review mode: read-only, every line marked, worked solution + explanation shown');

// --------------------------------------------------------------------------
// 7. A distractor costs marks, and review says which one
// --------------------------------------------------------------------------
f = await remount();
await build(f, [...CORRECT, ['d1', 1]]);
assert.deepStrictEqual(await solIds(f), ['l1', 'l2', 'l3', 'l4', 'l5', 'd1']);
await f.click('#submit');
await page.waitForFunction(() => /score: 4\.5/.test(document.getElementById('scorePill').textContent),
  null, { timeout: 5000 });
assert.strictEqual(await page.textContent('#scorePill'), 'score: 4.5 / 5',
  'using one distractor should cost exactly distractorPenalty');
console.log('✓ one distractor drops an otherwise perfect answer to 4.5 / 5');

await page.waitForFunction(() => /mode: review/.test(document.getElementById('modePill').textContent),
  null, { timeout: 5000 });
f = await frame();
await f.waitForSelector('.p-line.no');
assert.strictEqual(await f.$$eval('#list-solution .p-line.no', (n) => n.length), 1);
assert.strictEqual(
  await f.getAttribute('#list-solution .p-line.no', 'data-id'), 'd1',
  'the distractor is the line flagged');
assert.ok(/Distractors used/.test(await f.textContent('#app')),
  'review should name the distractors that were used');
console.log('✓ review flags the distractor by name');

// --------------------------------------------------------------------------
// 8. A near miss keeps partial credit
// --------------------------------------------------------------------------
f = await remount();
await build(f, CORRECT.map(([id, ind]) => (id === 'l4' ? [id, 1] : [id, ind])));
assert.deepStrictEqual(await solIndents(f), [0, 1, 1, 1, 1]);
await f.click('#submit');
await page.waitForFunction(() => /score: 4\.7/.test(document.getElementById('scorePill').textContent),
  null, { timeout: 5000 });
assert.strictEqual(await page.textContent('#scorePill'), 'score: 4.7 / 5');
await page.waitForFunction(() => /mode: review/.test(document.getElementById('modePill').textContent),
  null, { timeout: 5000 });
f = await frame();
await f.waitForSelector('.p-line.indent-off');
assert.strictEqual(
  await f.getAttribute('.p-line.indent-off', 'data-id'), 'l4',
  'only the wrongly indented line should be flagged');
console.log('✓ near miss (one indent out) keeps 4.7 / 5 and flags just that line');

// --------------------------------------------------------------------------
// 9. Sandbox still holds
// --------------------------------------------------------------------------
const isolated = await f.evaluate(() => {
  try { return window.parent.document === undefined; } catch (e) { return true; }
});
assert.ok(isolated, 'runner iframe is NOT isolated from the host document');
console.log('✓ sandbox holds: the runner cannot reach the host document');

// --------------------------------------------------------------------------
if (consoleErrors.length) {
  console.log('\n✗ console errors:\n  ' + consoleErrors.join('\n  '));
  await browser.close();
  process.exit(1);
}

await page.screenshot({ path: 'test/shot-parsons-review.png', fullPage: true });
f = await remount();
await build(f, [['l1', 0], ['l2', 1]]);
await page.waitForTimeout(200);
await page.screenshot({ path: 'test/shot-parsons.png', fullPage: true });

await browser.close();
console.log('\nAll checks passed, no console errors.');
