/* /auth/refresh — where is it allowed to send you afterwards?
 *
 * Run:  node test/auth-refresh.test.mjs
 *
 * The return path comes from the Referer header, because a Server Component
 * cannot tell the route which URL it was rendering. Referer is attacker-
 * influenced, so every case that must NOT be honoured is pinned here. An open
 * redirect on an auth route is a phishing primitive: a link that really does
 * go to the school's portal, really does sign you in, and then lands you on
 * someone else's page.
 */
import assert from 'node:assert';
import { safeReturnTo } from '../lib/return-to.mjs';

const HERE = 'https://nybble.example/auth/refresh';
const req = (referer) => safeReturnTo(referer, HERE);

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { failures++; console.log(`✗ ${name}\n    ${e.message}`); }
}

check('a same-origin page is returned to, path and query intact', () => {
  assert.strictEqual((req('https://nybble.example/results/abc?x=1')), '/results/abc?x=1');
});

check('another origin is refused', () => {
  assert.strictEqual((req('https://evil.example/steal')), '/');
});

check('a protocol-relative URL is refused', () => {
  // The one a bare startsWith('/') check waves straight through: to a browser
  // //evil.example is an absolute URL on another host.
  assert.strictEqual((req('//evil.example/steal')), '/');
});

check('a lookalike host is refused', () => {
  assert.strictEqual((req('https://nybble.example.evil.test/x')), '/');
});

check('a different scheme on the same host is refused', () => {
  assert.strictEqual((req('http://nybble.example/dashboard')), '/');
});

check('no Referer at all lands on the front door', () => {
  assert.strictEqual((req(null)), '/');
});

check('an unparseable Referer lands on the front door', () => {
  assert.strictEqual((req('not a url')), '/');
});

check('an auth route is never the destination', () => {
  // Returning to /auth/refresh is how a redirect loop gets built.
  assert.strictEqual((req('https://nybble.example/auth/refresh')), '/');
  assert.strictEqual((req('https://nybble.example/auth/signout')), '/');
});

if (failures) {
  console.log(`\n✗ ${failures} check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
