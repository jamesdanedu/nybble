/* End-to-end check of the runner contract, driven through the harness.
 * Run:  node test/harness.test.mjs      (with the static server on :8099)
 */
import { chromium } from 'playwright';
import assert from 'node:assert';

const BASE = 'http://localhost:8099';
const results = [];
function check(name, fn) { results.push({ name, fn }); }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/favicon\.ico/.test(m.location()?.url ?? '')) return;   // harness has no favicon
  consoleErrors.push(m.text());
});

await page.goto(`${BASE}/harness.html`);
await page.waitForFunction(() => document.querySelector('#frame iframe'));

const frame = async () => {
  const el = await page.$('#frame iframe');
  return await el.contentFrame();
};

// --------------------------------------------------------------------------
// 1. MCQ: handshake, render, autosave, submit, review
// --------------------------------------------------------------------------
let f = await frame();
await f.waitForSelector('.r-card');

const qCount = await f.$$eval('.r-card', (n) => n.length);
assert.strictEqual(qCount, 3, `MCQ should render 3 questions, got ${qCount}`);

const capText = await page.textContent('#capTag');
assert.ok(/selfSubmit/.test(capText), `capabilities not received: "${capText}"`);
console.log('✓ MCQ handshake + render (3 questions, caps advertised)');

// Answer: q1 -> d (correct), q2 -> b (wrong), q3 -> a,b,d (correct, 2 marks)
await f.click('input[name="q1"][value="d"]');
await f.click('input[name="q2"][value="b"]');
await f.click('input[name="q3"][value="a"]');
await f.click('input[name="q3"][value="b"]');
await f.click('input[name="q3"][value="d"]');

await page.waitForFunction(() => !/state: —/.test(document.querySelector('#statePill').textContent),
  null, { timeout: 4000 });
console.log('✓ MCQ autosave reached the host (debounced state message)');

const status = await f.textContent('#status');
assert.strictEqual(status.trim(), '3 of 3 answered', `progress wrong: "${status}"`);

await f.click('#submit');
await page.waitForFunction(() => /score: \d/.test(document.querySelector('#scorePill').textContent),
  null, { timeout: 5000 });
const mcqScore = await page.textContent('#scorePill');
assert.strictEqual(mcqScore, 'score: 3 / 4', `MCQ score wrong: "${mcqScore}"`);
console.log(`✓ MCQ scored server-side: ${mcqScore} (q1 ✓, q2 ✗, q3 ✓ 2/2)`);

// Review mode should re-mount and mark up the answers.
await page.waitForFunction(() => /mode: review/.test(document.querySelector('#modePill').textContent),
  null, { timeout: 5000 });
f = await frame();
await f.waitForSelector('.r-opt.correct');
const correctMarks = await f.$$eval('.r-opt.correct', (n) => n.length);
const wrongMarks = await f.$$eval('.r-opt.wrong', (n) => n.length);
assert.strictEqual(correctMarks, 5, `expected 5 key options highlighted, got ${correctMarks}`);
assert.strictEqual(wrongMarks, 1, `expected 1 wrong selection highlighted, got ${wrongMarks}`);
const explains = await f.$$eval('.r-explain', (n) => n.length);
assert.strictEqual(explains, 3, `expected 3 explanations, got ${explains}`);
const disabled = await f.$$eval('input:not([disabled])', (n) => n.length);
assert.strictEqual(disabled, 0, 'review mode must disable every input');
console.log('✓ MCQ review mode: key highlighted, explanations shown, inputs locked');

// --------------------------------------------------------------------------
// 2. numbase: seeded generation is deterministic
// --------------------------------------------------------------------------
await page.selectOption('#runner', 'numbase');
await page.waitForFunction(() => /mode: attempt/.test(document.querySelector('#modePill').textContent));
f = await frame();
await f.waitForSelector('.nb-prompt');

const promptsA = await f.$$eval('.nb-prompt', (n) => n.map((x) => x.textContent));
assert.strictEqual(promptsA.length, 6, `expected 6 generated questions, got ${promptsA.length}`);

await page.click('#resetBtn');
await page.waitForTimeout(400);
f = await frame();
await f.waitForSelector('.nb-prompt');
const promptsB = await f.$$eval('.nb-prompt', (n) => n.map((x) => x.textContent));
assert.deepStrictEqual(promptsA, promptsB, 'same seed must regenerate the same questions');
console.log(`✓ numbase deterministic from seed: [${promptsA.join(', ')}]`);

// Different seed must give a different set.
await page.fill('#seed', '777');
await page.click('#mount');
await page.waitForTimeout(400);
f = await frame();
await f.waitForSelector('.nb-prompt');
const promptsC = await f.$$eval('.nb-prompt', (n) => n.map((x) => x.textContent));
assert.notDeepStrictEqual(promptsA, promptsC, 'a different seed should give different questions');
console.log(`✓ numbase seed 777 gives a different set: [${promptsC.join(', ')}]`);

// --------------------------------------------------------------------------
// 3. numbase: answer everything correctly, expect full marks
// --------------------------------------------------------------------------
const truth = await page.evaluate(() => {
  const cfg = JSON.parse(document.querySelector('#config').value);
  const qs = NumbaseGen.generate(cfg, Number(document.querySelector('#seed').value));
  return qs.map((q) => ({ id: q.id, expected: NumbaseGen.expected(q, false) }));
});
for (const t of truth) {
  await f.fill(`input[data-q="${t.id}"]`, t.expected);
}
await f.click('#submit');
await page.waitForFunction(() => /score: \d/.test(document.querySelector('#scorePill').textContent),
  null, { timeout: 5000 });
const nbScore = await page.textContent('#scorePill');
assert.strictEqual(nbScore, 'score: 6 / 6', `numbase full marks expected, got "${nbScore}"`);
console.log(`✓ numbase all-correct scores full marks: ${nbScore}`);

// --------------------------------------------------------------------------
// 4. Answer normalisation: 0x / lowercase / leading zeros all accepted
// --------------------------------------------------------------------------
const norm = await page.evaluate(() => {
  const q = { toBase: 16, value: 15 };
  const bin = { toBase: 2, value: 10 };
  return {
    hexPrefixed: NumbaseGen.isCorrect(q, '0x0f'),
    hexLower:    NumbaseGen.isCorrect(q, 'f'),
    hexPadded:   NumbaseGen.isCorrect(q, '000F'),
    binPadded:   NumbaseGen.isCorrect(bin, '00001010'),
    binSpaced:   NumbaseGen.isCorrect(bin, '1010 '),
    rejectJunk:  NumbaseGen.isCorrect(q, 'ZZ'),
    rejectEmpty: NumbaseGen.isCorrect(q, '')
  };
});
assert.ok(norm.hexPrefixed && norm.hexLower && norm.hexPadded, 'hex normalisation failed');
assert.ok(norm.binPadded && norm.binSpaced, 'binary normalisation failed');
assert.ok(!norm.rejectJunk && !norm.rejectEmpty, 'invalid answers must be rejected');
console.log('✓ answer normalisation: 0x prefix, case, padding, whitespace; junk rejected');

// --------------------------------------------------------------------------
// 5. Sandbox: the runner must not be able to reach the host document
// --------------------------------------------------------------------------
const isolated = await f.evaluate(() => {
  try { return window.parent.document === undefined; }
  catch (e) { return true; }   // SecurityError is the expected outcome
});
assert.ok(isolated, 'runner iframe is NOT isolated from the host document');
console.log('✓ sandbox holds: runner cannot touch the host document');

// --------------------------------------------------------------------------
if (consoleErrors.length) {
  console.log('\n✗ console errors:\n  ' + consoleErrors.join('\n  '));
  await browser.close();
  process.exit(1);
}

// Let the queued review re-mount land before capturing it.
await page.waitForFunction(() => /mode: review/.test(document.querySelector('#modePill').textContent),
  null, { timeout: 5000 });
await (await frame()).waitForSelector('.nb-expected, .r-score');
await page.screenshot({ path: 'test/shot-numbase-review.png', fullPage: true });

await page.selectOption('#runner', 'mcq');
await page.waitForFunction(() => /mode: attempt/.test(document.querySelector('#modePill').textContent));
await (await frame()).waitForSelector('.r-card');
await page.waitForTimeout(300);
await page.screenshot({ path: 'test/shot-mcq.png', fullPage: true });

await browser.close();
console.log('\nAll checks passed, no console errors.');
