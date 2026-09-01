/* Deployment checks — the things that only break once the site is really served.
 *
 * `/` is an app route (app/page.tsx) now, not a file in public/, so these run
 * against a built Next server rather than the static simulator:
 *
 *   npm run build && npx next start -p 8102
 *   BASE=http://127.0.0.1:8102 node test/deploy.test.mjs
 *
 * test/vercel-sim.py still covers the static half — the runners and the demo
 * pages — and remains the only way to test the cleanUrls behaviour it exists
 * for, but it cannot serve `/` and so cannot run this file end to end:
 *
 *   python3 test/vercel-sim.py            --port 8102   (production config)
 *   python3 test/vercel-sim.py --clean    --port 8101   (if cleanUrls came back)
 */
import { chromium } from 'playwright';
import assert from 'node:assert';
const B = process.env.BASE || 'http://127.0.0.1:8102';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage();
const errs = [];
p.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push(r.status()+' '+new URL(r.url()).pathname); });
p.on('pageerror', e => errs.push('PAGEERR ' + e));

// --- landing page
await p.goto(`${B}/`, { waitUntil:'networkidle' });
const cards = await p.$$eval('a[href^="/demo.html"]', a => a.map(x => x.getAttribute('href')));
assert.deepStrictEqual(cards, [
  '/demo.html?activity=numbase',
  '/demo.html?activity=parsons',
  '/demo.html?activity=mcq',
]);
// Signed out, `/` must be the public landing page, not a redirect to login —
// the demos are the point of it and they need no account.
assert.ok(await p.$('a[href="/login"]'), 'landing page should offer sign in');
console.log(`✓ landing page shows ${cards.length} demo links and a sign-in`);

// --- demo: numbase
await p.goto(`${B}/demo.html?activity=numbase`, { waitUntil:'networkidle' });
await p.waitForTimeout(1200);
let f = p.frames().find(x => /\/runners\/numbase/.test(x.url()));
assert.ok(f, 'runner frame missing');
await f.waitForSelector('.nb-prompt', { timeout: 8000 });
const n = await f.$$eval('.nb-prompt', e => e.length);
assert.strictEqual(n, 6, `expected 6 questions, got ${n}`);
console.log(`✓ numbase demo renders ${n} questions and mounts the runner`);

// answer all correctly via the same generator the runner used
const truth = await p.evaluate(() => {
  const s = DemoKit.SAMPLES.numbase;
  const seedNow = window.__seed;
  return NumbaseGen.generate(s.config, seedNow).map(q => ({ id:q.id, a: NumbaseGen.expected(q,false) }));
});
for (const t of truth) await f.fill(`input[data-q="${t.id}"]`, t.a);
await f.click('#submit');
await p.waitForSelector('.result h2', { timeout: 8000 });
const score = await p.textContent('.result h2');
assert.strictEqual(score.trim(), '6 / 6', `expected full marks, got ${score}`);
console.log(`✓ submit → marked → result banner: ${score.trim()}`);

// review re-mount
f = p.frames().find(x => /\/runners\/numbase/.test(x.url()));
await f.waitForSelector('.r-score', { timeout: 8000 });
const locked = await f.$$eval('input:not([disabled])', e => e.length);
assert.strictEqual(locked, 0, 'review inputs should be locked');
console.log('✓ review view re-mounted, inputs locked');

// try again with new numbers
await p.click('#again');
await p.waitForTimeout(1200);
f = p.frames().find(x => /\/runners\/numbase/.test(x.url()));
await f.waitForSelector('.nb-prompt', { timeout: 8000 });
console.log('✓ "try again with new numbers" re-seeds and remounts');

// --- demo: mcq
await p.goto(`${B}/demo.html?activity=mcq`, { waitUntil:'networkidle' });
await p.waitForTimeout(1200);
f = p.frames().find(x => /\/runners\/mcq/.test(x.url()));
await f.waitForSelector('.r-card', { timeout: 8000 });
console.log('✓ mcq demo renders');

// --- harness still works after the DemoKit refactor
await p.goto(`${B}/harness.html?runner=numbase`, { waitUntil:'networkidle' });
await p.waitForTimeout(1200);
const cap = await p.textContent('#capTag');
assert.ok(/selfSubmit/.test(cap), `harness did not mount: "${cap}"`);
console.log(`✓ harness still mounts after refactor (${cap})`);

if (errs.length) { console.log('\n✗ errors:\n  ' + errs.join('\n  ')); await b.close(); process.exit(1); }
await b.close();
console.log(`\nAll deployment checks passed against ${B}`);
