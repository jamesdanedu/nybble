/* PWA checks — the manifest, the service worker, and the limit it must respect.
 *
 * Runs against a BUILT server, because the worker only registers in production
 * (see components/service-worker.tsx) and `/manifest.webmanifest` and
 * `/offline` are app routes:
 *
 *   npm run build && npx next start -p 8102
 *   BASE=http://127.0.0.1:8102 node test/pwa.test.mjs
 *
 * The last check is the important one and it asserts a NEGATIVE: that a
 * sandboxed runner still cannot be served offline. That is not a bug being
 * enshrined, it is the measurement docs/pwa.md is built on — if a browser ever
 * changes it, or if someone adds `allow-same-origin` to runner-host.js, this
 * check fails and the documentation stops being a lie in one direction or the
 * other.
 */
import { chromium } from 'playwright';
import assert from 'node:assert';

const B = process.env.BASE || 'http://127.0.0.1:8102';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext();
const page = await ctx.newPage();

// --- manifest -------------------------------------------------------------
const manifest = await (await ctx.request.get(`${B}/manifest.webmanifest`)).json();
assert.strictEqual(manifest.display, 'standalone', 'manifest must ask for standalone display');
assert.strictEqual(manifest.start_url, '/dashboard');
assert.ok(
  manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'),
  'manifest needs a 512 maskable icon or Android will letterbox it',
);
for (const icon of manifest.icons) {
  const res = await ctx.request.get(`${B}${icon.src}`);
  assert.strictEqual(res.status(), 200, `manifest icon ${icon.src} is not served`);
}
console.log(`✓ manifest served, ${manifest.icons.length} icons all reachable`);

// --- the <link rel="manifest"> and the iOS meta ---------------------------
await page.goto(`${B}/`, { waitUntil: 'networkidle' });
assert.strictEqual(
  await page.getAttribute('link[rel="manifest"]', 'href'),
  '/manifest.webmanifest',
  'the manifest is not linked from the document',
);
assert.ok(
  await page.$('link[rel="apple-touch-icon"]'),
  'iOS installs from the Share sheet and needs an apple-touch-icon',
);
console.log('✓ manifest and apple-touch-icon linked from the page');

// --- the worker registers and takes control -------------------------------
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
  timeout: 20000,
});
console.log('✓ service worker registered and controlling');

// Give the precache a moment to settle before pulling the plug.
await page.waitForFunction(
  async () => (await caches.open('nybble-shell-v1')).match('/offline').then(Boolean),
  null,
  { timeout: 20000 },
);
console.log('✓ /offline precached');

// --- offline: a navigation gets the offline page, not a browser error -----
await ctx.setOffline(true);
await page.goto(`${B}/dashboard`, { waitUntil: 'domcontentloaded' });
assert.match(
  await page.textContent('body'),
  /You are offline/,
  'offline navigation did not fall back to /offline',
);
console.log('✓ offline navigation falls back to the offline page');

// --- offline: nothing belonging to a student was cached -------------------
//
// The tenancy check, not a tidiness one. School devices are shared, so a page
// outliving a sign-out is a page the next student can read. Anything cached
// that is not build output, an icon or the offline notice is a bug.
const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  const out = {};
  for (const name of names) {
    const c = await caches.open(name);
    out[name] = (await c.keys()).map((r) => new URL(r.url).pathname);
  }
  return out;
});
assert.deepStrictEqual(
  Object.keys(cached).sort(),
  ['nybble-shell-v1', 'nybble-static-v1'],
  'unexpected cache names — every cache the worker leaves behind must be one it prunes',
);
for (const p of cached['nybble-shell-v1']) {
  assert.ok(
    p === '/offline' || p.startsWith('/icons/'),
    `${p} is in the shell cache, which may hold only the offline page and icons`,
  );
}
for (const p of cached['nybble-static-v1']) {
  assert.ok(
    p.startsWith('/_next/static/'),
    `${p} is in the static cache, which may hold only content-hashed build output`,
  );
}
const all = Object.values(cached).flat();
assert.ok(
  !all.some((p) => p.startsWith('/runners/')),
  'runner assets are cached, which buys nothing — see the check below',
);
console.log(
  `✓ caches hold only shell + build output ` +
    `(${cached['nybble-shell-v1'].length} shell, ${cached['nybble-static-v1'].length} static, no /runners/)`,
);

// --- a runner does not, and cannot, come back offline ---------------------
//
// The user-visible half of the finding in docs/pwa.md. The mechanism behind it
// — that a sandboxed frame is not controlled by the worker at all — is measured
// separately by test/sw-sandbox-spike.mjs, which is where to look if this ever
// starts passing for a surprising reason.
//
// Guards against the tempting "fix" of precaching /runners/: a runner cannot be
// served into an opaque-origin frame no matter what the cache holds, so adding
// it would spend a megabyte of a student's quota to change nothing.
await ctx.setOffline(false);
await page.goto(`${B}/harness.html?runner=mcq`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.mountRunner === 'function', null, {
  timeout: 10000,
});
await ctx.setOffline(true);

const mounted = await page.evaluate(() => {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    setTimeout(() => resolve('never became ready'), 6000);
    window.mountRunner(host, {
      // Cache-busted, so the HTTP cache cannot quietly answer for the network
      // and make an online result look like an offline one.
      entryUrl: '/runners/mcq/index.html?probe=' + Math.random(),
      stepId: 'probe',
      config: { questions: [{ id: 'q1', stem: 'x?', options: [{ id: 'a', text: 'a' }] }] },
      state: null,
      context: {},
      mode: 'attempt',
      title: 'probe',
      onReady: () => resolve('ready'),
    });
  });
});
assert.notStrictEqual(
  mounted,
  'ready',
  'A runner mounted while offline. If runner-host.js gained allow-same-origin ' +
    'to achieve that, it is a security regression — read docs/pwa.md.',
);
console.log(`✓ runners still do not work offline, as documented (${mounted})`);

await browser.close();
console.log(`\nAll PWA checks passed against ${B}`);
