/* End-to-end check of the runner contract, driven through the harness.
 * Run:  node test/harness.test.mjs      (with the static server on :8099)
 */
import { chromium } from 'playwright';
import assert from 'node:assert';

const BASE = process.env.BASE || 'http://127.0.0.1:8102';
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

// Let the queued review re-mount land before capturing it.
await page.waitForFunction(() => /mode: review/.test(document.querySelector('#modePill').textContent),
  null, { timeout: 5000 });
await (await frame()).waitForSelector('.nb-expected, .r-score');
await page.screenshot({ path: 'test/shot-numbase-review.png', fullPage: true });

// --------------------------------------------------------------------------
// 6. freetext: shared context, context.prior, the length guard, manual marking
// --------------------------------------------------------------------------
await page.selectOption('#runner', 'freetext');
await page.waitForFunction(() => /mode: attempt/.test(document.querySelector('#modePill').textContent));
f = await frame();
await f.waitForSelector('.r-card');

// The snippet comes from context.code, not from config — that is what makes a
// PRIMM sequence be about one program rather than five unrelated ones.
const ftCode = await f.textContent('pre.r-code');
assert.ok(/runningTotal/.test(ftCode), `context.code did not render: "${ftCode}"`);

// context.prior: the earlier step's answer, quoted back. Without this the
// Make phase cannot confront a student with their own prediction.
const ftPrior = await f.textContent('.r-prior');
assert.ok(/I think it prints 8/.test(ftPrior), `context.prior did not render: "${ftPrior}"`);
console.log('✓ freetext: context.code and context.prior both render');

// The length guard must actually block, not just complain.
await f.fill('#answer', 'too short');
await f.click('#submit');
const guard = await f.$eval('#status', (el) => ({
  text: el.textContent, warn: el.classList.contains('warn'),
}));
assert.ok(guard.warn && /at least 40/.test(guard.text), `length guard did not fire: "${guard.text}"`);
const notScored = await page.textContent('#scorePill');
assert.ok(/score: —/.test(notScored), `submit went through under minChars: "${notScored}"`);
console.log('✓ freetext: minChars blocks submit rather than warning and sending');

// Autosave, through the host's 800 ms debounce.
const answer =
  'def largest(numbers):\n    biggest = numbers[0]\n    for n in numbers:\n' +
  '        if n > biggest:\n            biggest = n\n    return biggest\n\n' +
  'Starting at 0 breaks for a list of all-negative numbers, so start at the first item.';
await f.fill('#answer', answer);
await page.waitForFunction(() => !/state: —/.test(document.querySelector('#statePill').textContent),
  null, { timeout: 5000 });
console.log('✓ freetext: autosave reached the host');

// A hand-marked runner returns a null total on purpose. "with teacher" rather
// than "0 / 0" is the difference between a queue and a failed student.
await f.click('#submit');
await page.waitForFunction(() => /score: with teacher/.test(document.querySelector('#scorePill').textContent),
  null, { timeout: 5000 });
console.log('✓ freetext: manual scorer reports a null total as pending, not as zero');

// Review mode replays the answer read-only.
await page.waitForFunction(() => /mode: review/.test(document.querySelector('#modePill').textContent),
  null, { timeout: 5000 });
f = await frame();
await f.waitForSelector('.r-answer');
const replayed = await f.textContent('.r-answer');
assert.ok(/def largest/.test(replayed), `review did not replay the answer: "${replayed}"`);
const stillEditable = await f.$('#answer');
assert.strictEqual(stillEditable, null, 'review mode left the textarea editable');
console.log('✓ freetext: review replays the answer read-only');

await page.screenshot({ path: 'test/shot-freetext-review.png', fullPage: true });

// --------------------------------------------------------------------------
// 7. pyrun: real Python, teacher checks, and the runaway-loop abort
//
// The abort is not one test among several — the whole engine choice rests on
// it (docs/primm.md). If Skulpt ever stops honouring execLimit, a student's
// `while True:` freezes the frame for the rest of the lesson with no way back.
// --------------------------------------------------------------------------
await page.selectOption('#runner', 'pyrun');
await page.waitForFunction(() => /mode: attempt/.test(document.querySelector('#modePill').textContent));
f = await frame();
await f.waitForSelector('.py-editor', { timeout: 20000 });

const skLoaded = await f.evaluate(() => typeof Sk);
assert.strictEqual(skLoaded, 'object', 'Skulpt did not load inside the runner');

// The starter program adds everything, so exactly one of the three checks passes.
await f.click('#run');
await f.waitForSelector('.py-test.pass, .py-test.fail', { timeout: 30000 });
const firstOut = (await f.textContent('#out')).trim();
assert.strictEqual(firstOut, '8', `starter program should print 8, got "${firstOut}"`);
let marks = await f.$$eval('.py-test', (n) => n.map((x) => x.className));
assert.deepStrictEqual(marks, ['py-test pass', 'py-test fail', 'py-test fail'],
  `starter should pass 1 of 3, got ${JSON.stringify(marks)}`);
console.log('✓ pyrun runs real Python and marks the teacher\'s checks (1/3 on the starter)');

// A correct fix turns them all green.
await f.fill('.py-editor', [
  'def total(numbers):',
  '    runningTotal = 0',
  '    for n in numbers:',
  '        if n > 0:',
  '            runningTotal = runningTotal + n',
  '    return runningTotal',
  '',
  'print(total([3, 1, 4]))',
].join('\n'));
await f.click('#run');
await page.waitForTimeout(1500);
marks = await f.$$eval('.py-test', (n) => n.map((x) => x.className));
assert.deepStrictEqual(marks, ['py-test pass', 'py-test pass', 'py-test pass'],
  `a correct fix should pass 3 of 3, got ${JSON.stringify(marks)}`);
console.log('✓ pyrun: a correct change turns every check green');

// THE test. An endless loop must be stopped, and the frame must survive it.
await f.fill('.py-editor', 'while True:\n    pass');
const abortStart = Date.now();
await f.click('#run');
await f.waitForFunction(
  () => /ran too long/.test(document.querySelector('#out').textContent),
  null, { timeout: 20000 });
const abortMs = Date.now() - abortStart;
assert.ok(abortMs < 15000, `runaway loop took ${abortMs}ms to abort`);
console.log(`✓ pyrun stops an endless loop (${abortMs}ms) with a message a student can act on`);

// Still alive afterwards: the interpreter and the frame both survived.
await f.fill('.py-editor', 'print(6 * 7)');
await f.click('#run');
await f.waitForFunction(() => document.querySelector('#out').textContent.trim() === '42',
  null, { timeout: 20000 });
console.log('✓ pyrun survives the abort — the next program runs normally');

// requireRun: editing invalidates the last run, so submitting must be blocked.
await f.fill('.py-editor', 'print(1)');
await f.click('#submit');
const gate = await f.$eval('#status', (el) => ({ text: el.textContent, warn: el.classList.contains('warn') }));
assert.ok(gate.warn && /Press Run first/.test(gate.text), `requireRun did not block: "${gate.text}"`);
console.log('✓ pyrun: editing invalidates the run, and submit is blocked until it is run again');

// Submit, and check the mark comes back as a number rather than "with teacher":
// pyrun is scorer:'client', which the demo pages treat as practice mode.
await f.click('#run');
await page.waitForTimeout(1200);
await f.click('#submit');
await page.waitForFunction(() => /score: \d/.test(document.querySelector('#scorePill').textContent),
  null, { timeout: 10000 });
console.log('✓ pyrun submits a client score:', (await page.textContent('#scorePill')).trim());

// Review replays the submitted source, read-only.
await page.waitForFunction(() => /mode: review/.test(document.querySelector('#modePill').textContent),
  null, { timeout: 5000 });
f = await frame();
await f.waitForSelector('.py-editor');
const ro = await f.$eval('.py-editor', (el) => ({ readOnly: el.readOnly, value: el.value }));
assert.ok(ro.readOnly, 'review mode left the editor writable');
assert.ok(/print\(1\)/.test(ro.value), `review did not replay the source: "${ro.value}"`);
assert.strictEqual(await f.$('#run'), null, 'review mode still offers a Run button');
console.log('✓ pyrun: review replays the submitted program read-only');

await page.screenshot({ path: 'test/shot-pyrun-review.png', fullPage: true });

// --------------------------------------------------------------------------
// 8. Review mode with NO marks.
//
// The path an answered step now takes mid-attempt: the portal re-mounts it
// read-only so a student cannot rewrite a prediction after seeing the output,
// but it holds no marks for an earlier step and must not invent any. Every
// runner therefore has to render a response with `score: null` — a combination
// nothing exercised before this.
// --------------------------------------------------------------------------
for (const [runnerId, entryUrl, response, seen] of [
  ['mcq', '/runners/mcq/index.html',
    { answers: { q1: ['d'], q2: ['b'], q3: ['a', 'b', 'd'] } }, '.r-opt'],
  ['parsons', '/runners/parsons/index.html',
    { arrangement: [{ id: 'l1', indent: 0 }, { id: 'l2', indent: 1 }], unused: ['l3'] }, '.p-cols'],
]) {
  await page.evaluate(([url, resp, id]) => {
    if (window.slot) window.slot.destroy();
    document.getElementById('frame').innerHTML = '';
    window.slot = mountRunner(document.getElementById('frame'), {
      entryUrl: url,
      stepId: 'step1',
      config: DemoKit.SAMPLES[id].config,
      context: Object.assign({ seed: 1 }, DemoKit.SAMPLES[id].context || {}),
      mode: 'review',
      response: resp,
      score: null,
    });
  }, [entryUrl, response, runnerId]);

  f = await frame();
  await f.waitForSelector(seen, { timeout: 15000 });
  const marked = await f.$$eval('.r-score', (n) => n.length);
  assert.strictEqual(marked, 0, `${runnerId} showed a score banner when it was given none`);
  console.log(`✓ ${runnerId}: review with no marks renders the answer and invents no score`);
}




// --------------------------------------------------------------------------
if (consoleErrors.length) {
  console.log('\n✗ console errors:\n  ' + consoleErrors.join('\n  '));
  await browser.close();
  process.exit(1);
}

await page.selectOption('#runner', 'mcq');
await page.waitForFunction(() => /mode: attempt/.test(document.querySelector('#modePill').textContent));
await (await frame()).waitForSelector('.r-card');
await page.waitForTimeout(300);
await page.screenshot({ path: 'test/shot-mcq.png', fullPage: true });

await browser.close();
console.log('\nAll checks passed, no console errors.');
