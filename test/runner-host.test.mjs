/* runner-host.js — does a draft survive the frame being torn down?
 *
 * Run:  node test/runner-host.test.mjs
 *
 * No browser. The host helper touches a small, well-defined slice of the DOM —
 * createElement, a contentWindow to compare message sources against, and
 * addEventListener on the window — so that slice is stubbed here and the real
 * file is evaluated against it. That keeps this in the set of suites that need
 * nothing installed, next to check-parsons and schools-ie.
 *
 * The case that matters is the last one. `destroy()` used to be a bare
 * clearTimeout, which threw away whatever was inside the 800 ms debounce
 * window. Every step change unmounts the frame, so a student who dragged a
 * Parsons line and moved on within 800 ms lost that line, silently, every
 * time. Nothing logged it and nothing showed it: the next screen simply had
 * less work on it than the student had done.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(import.meta.dirname, '..', 'public', 'runners', 'lib', 'runner-host.js');
const SOURCE = readFileSync(SRC, 'utf8');

// Read the channel name out of the file rather than repeating it here. Hard-coding
// it means a rename makes every message silently ignored and every check pass for
// the wrong reason — which is exactly what happened while writing this.
const CHANNEL = /var CHANNEL\s*=\s*'([^']+)'/.exec(SOURCE)?.[1];
assert.ok(CHANNEL, 'could not find the CHANNEL constant in runner-host.js');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`✗ ${name}\n    ${e.message}`);
  }
}

/* --- the smallest DOM the host actually uses ---------------------------- */

function makeEnv({ visibilityState = 'visible' } = {}) {
  const listeners = new Map();
  const contentWindow = { postMessage() {} };

  const element = () => ({
    style: { cssText: '' },
    setAttribute() {},
    appendChild() {},
    removeChild() {},
    parentNode: null,
    contentWindow,
  });

  const win = {
    document: { createElement: element, get visibilityState() { return win.__visibility; } },
    __visibility: visibilityState,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    setTimeout,
    clearTimeout,
  };

  /** Deliver a message as if it came from the sandboxed frame. */
  win.__emit = (type, payload) => {
    for (const fn of listeners.get('message') ?? []) {
      fn({ source: contentWindow, data: { channel: CHANNEL, type, ...payload } });
    }
  };
  win.__fire = (type) => {
    for (const fn of listeners.get(type) ?? []) fn();
  };
  win.__listenerCount = (type) => listeners.get(type)?.size ?? 0;
  /** Deliver a message from some OTHER window — an ad frame, a second runner. */
  win.__emitFrom = (source, type, payload) => {
    for (const fn of listeners.get('message') ?? []) {
      fn({ source, data: { channel: CHANNEL, type, ...payload } });
    }
  };

  // Evaluate the real file with `window` and `document` bound to the stub.
  // The file refers to both by bare name, so both have to be parameters.
  const factory = new Function(
    'window',
    'document',
    `${SOURCE}\nreturn window.mountRunner;`,
  );
  const mountRunner = factory(win, win.document);

  const container = element();
  return { win, mountRunner, container };
}

function mount(env, opts = {}) {
  const saved = [];
  const slot = env.mountRunner(env.container, {
    entryUrl: '/runners/parsons/index.html',
    stepId: 'step-2',
    config: {},
    onState: (s) => saved.push(s),
    ...opts,
  });
  env.win.__emit('ready', { capabilities: {} });
  return { slot, saved };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/* --- the checks --------------------------------------------------------- */

check('a state message is debounced, not written straight through', () => {
  const env = makeEnv();
  const { saved } = mount(env);
  env.win.__emit('state', { state: { lines: ['a'] } });
  assert.strictEqual(saved.length, 0, 'wrote before the debounce elapsed');
});

await (async () => {
  const env = makeEnv();
  const { saved } = mount(env);
  env.win.__emit('state', { state: { lines: ['a'] } });
  env.win.__emit('state', { state: { lines: ['a', 'b'] } });
  await tick(900);
  check('rapid edits collapse to one write, carrying the LAST value', () => {
    assert.strictEqual(saved.length, 1, `expected 1 write, got ${saved.length}`);
    assert.deepStrictEqual(saved[0], { lines: ['a', 'b'] });
  });
})();

check('submitting flushes the draft first, so a stale one cannot land after it', () => {
  const env = makeEnv();
  const submitted = [];
  const { saved } = mount(env, { onSubmit: (p) => submitted.push(p) });
  env.win.__emit('state', { state: { lines: ['a'] } });
  env.win.__emit('submit', { response: { lines: ['a'] }, clientScore: null, maxScore: null });
  assert.deepStrictEqual(saved, [{ lines: ['a'] }], 'the pending draft was not flushed on submit');
  assert.strictEqual(submitted.length, 1);
});

check('destroy() hands over the pending draft instead of dropping it', () => {
  // The regression. A student drags a line and clicks Next within the debounce
  // window: the frame is destroyed, and that drag must not vanish with it.
  const env = makeEnv();
  const { slot, saved } = mount(env);
  env.win.__emit('state', { state: { lines: ['age = 17'] } });
  slot.destroy();
  assert.deepStrictEqual(
    saved,
    [{ lines: ['age = 17'] }],
    'destroy() threw away work that was inside the debounce window',
  );
});

check('destroy() with nothing pending writes nothing', () => {
  const env = makeEnv();
  const { slot, saved } = mount(env);
  slot.destroy();
  assert.deepStrictEqual(saved, [], 'destroy() invented a write with no draft outstanding');
});

check('destroy() unhooks both listeners it added', () => {
  const env = makeEnv();
  const { slot } = mount(env);
  assert.strictEqual(env.win.__listenerCount('message'), 1);
  assert.strictEqual(env.win.__listenerCount('visibilitychange'), 1);
  slot.destroy();
  assert.strictEqual(env.win.__listenerCount('message'), 0, 'message listener leaked');
  assert.strictEqual(env.win.__listenerCount('visibilitychange'), 0, 'visibilitychange listener leaked');
});

check('hiding the tab flushes the draft — the closed-lid case', () => {
  const env = makeEnv();
  const { saved } = mount(env);
  env.win.__emit('state', { state: { lines: ['x'] } });
  env.win.__visibility = 'hidden';
  env.win.__fire('visibilitychange');
  assert.deepStrictEqual(saved, [{ lines: ['x'] }]);
});

check('merely becoming visible again does not write', () => {
  const env = makeEnv();
  const { saved } = mount(env);
  env.win.__emit('state', { state: { lines: ['x'] } });
  env.win.__fire('visibilitychange'); // still 'visible'
  assert.deepStrictEqual(saved, [], 'flushed on the wrong visibility state');
});

check('a state message from a different window is ignored', () => {
  // The peer is authenticated by window identity, not by origin — a sandboxed
  // frame has an opaque origin, so an origin string proves nothing. A second
  // frame on the page must not be able to write into this step's draft.
  const env = makeEnv();
  const { saved } = mount(env);
  env.win.__emitFrom({ postMessage() {} }, 'state', { state: { injected: true } });
  assert.strictEqual(saved.length, 0, 'accepted a draft from a window that is not the runner');
});

if (failures) {
  console.log(`\n✗ ${failures} check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
