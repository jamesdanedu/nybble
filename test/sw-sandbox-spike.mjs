/* Can a service worker serve a sandboxed runner offline?
 *
 *   node test/sw-sandbox-spike.mjs
 *
 * Self-contained: builds its own fixture in a temp directory, serves it, and
 * needs nothing from the portal. It exists because the answer decided the whole
 * shape of the PWA work — see docs/pwa.md — and "we measured it once" is worth
 * very little a year later when a browser has moved on.
 *
 * It mounts the SAME document in three iframes, offline, with the subresource
 * already in the service worker's cache, and reports whether the subresource
 * arrives:
 *
 *   no sandbox                        expected: loaded
 *   allow-scripts                     expected: FAILED   ← what the portal uses
 *   allow-scripts allow-same-origin   expected: loaded   ← forbidden by the
 *                                                          runner contract
 *
 * The middle row is the finding: withholding `allow-same-origin` gives the
 * document an opaque origin, and an opaque-origin document is not controlled by
 * a service worker, so nothing it requests is ever offered to the cache. The
 * frame's own navigation is still served — that request belongs to the parent —
 * which is why the document runs at all and can report back.
 *
 * Exits non-zero if the three rows stop saying what docs/pwa.md says they say.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert';

const dir = await mkdtemp(path.join(tmpdir(), 'nybble-sw-spike-'));

await writeFile(
  path.join(dir, 'sw.js'),
  `const CACHE = 'spike';
self.addEventListener('install', (e) => e.waitUntil(
  caches.open(CACHE).then((c) => c.addAll(['/frame.html', '/sub.js'])).then(() => self.skipWaiting())
));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  // ignoreSearch so the cache-busting query below still matches.
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
`,
);

// The frame requests its subresource with a fresh query every time, so the HTTP
// cache can never be the one that answers. Only the service worker can.
await writeFile(
  path.join(dir, 'frame.html'),
  `<!doctype html><meta charset="utf-8"><body><script>
var s = document.createElement('script');
s.src = '/sub.js?bust=' + Math.random();
s.onload = function () { parent.postMessage('loaded', '*'); };
s.onerror = function () { parent.postMessage('FAILED', '*'); };
document.head.appendChild(s);
</script></body>`,
);
await writeFile(path.join(dir, 'sub.js'), '/* the subresource under test */\n');
await writeFile(
  path.join(dir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><body><script>
navigator.serviceWorker.register('/sw.js');
window.__mount = function (sandbox) {
  return new Promise(function (resolve) {
    var f = document.createElement('iframe');
    if (sandbox !== null) f.setAttribute('sandbox', sandbox);
    f.src = '/frame.html?x=' + Math.random();
    var t = setTimeout(function () { resolve('timeout'); }, 6000);
    window.addEventListener('message', function h(e) {
      if (e.source !== f.contentWindow) return;
      clearTimeout(t); window.removeEventListener('message', h); resolve(e.data);
    });
    document.body.appendChild(f);
  });
};
</script></body>`,
);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, 'http://x').pathname === '/' ? '/index.html' : new URL(req.url, 'http://x').pathname;
  try {
    const body = await readFile(path.join(dir, path.basename(name)));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] ?? 'text/plain' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(BASE);
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
  timeout: 15000,
});

const mount = (sandbox) => page.evaluate((s) => window.__mount(s), sandbox);

// Warm every variant while online, so an offline failure is never just a cold
// cache.
for (const s of [null, 'allow-scripts', 'allow-scripts allow-same-origin']) await mount(s);

await ctx.setOffline(true);
const rows = [
  ['no sandbox                     ', null, 'loaded'],
  ['allow-scripts  (the portal)    ', 'allow-scripts', 'FAILED'],
  ['allow-scripts allow-same-origin', 'allow-scripts allow-same-origin', 'loaded'],
];

console.log('offline, subresource already in the service worker cache:\n');
let bad = 0;
for (const [label, sandbox, expected] of rows) {
  const got = await mount(sandbox);
  const ok = got === expected;
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}  ${got}${ok ? '' : `   (expected ${expected})`}`);
}

await browser.close();
server.close();

assert.strictEqual(
  bad,
  0,
  '\nBrowser behaviour no longer matches docs/pwa.md. If the sandboxed row now ' +
    'loads, offline runners may have become possible and the documentation ' +
    'needs revisiting — check first that runner-host.js has not simply been ' +
    'given allow-same-origin, which would be a security regression, not a win.',
);
console.log('\nMatches docs/pwa.md: a sandboxed runner cannot be served offline.');
