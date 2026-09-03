# Skulpt 1.2.0 — vendored

Python-in-the-browser, used by the `pyrun` runner. MIT licensed; `LICENSE` is
the upstream copy. Source: <http://www.skulpt.org/>, <https://github.com/skulpt/skulpt>.

**Vendored rather than loaded from a CDN, deliberately.** Three reasons, all
measured by the engine spike written up in `docs/primm.md`:

1. A runner iframe has an **opaque origin**, so a `fetch()` from inside it is a
   cross-origin request even to this same site and needs CORS headers. Both
   files here load with `<script src>`, which CORS does not touch. That is a
   large part of why this engine was chosen over Pyodide.
2. `test/harness.test.mjs` runs against `test/vercel-sim.py` with no network.
   A CDN dependency would break the way every other runner in this repo is
   tested.
3. No storage API works inside the sandbox, so there is no caching layer beyond
   the browser's HTTP cache. Small matters.

228 KB gzipped for both files together.

## Upgrading

```bash
npm pack skulpt@<version>          # or npm i skulpt in a scratch directory
# copy dist/skulpt.min.js and dist/skulpt-stdlib.js here, plus LICENSE
node test/harness.test.mjs         # the pyrun checks cover the abort path
```

Check `Sk.execLimit` still aborts a runaway loop after any upgrade — that is
the property the whole engine choice rests on, and it is what
`test/harness.test.mjs` asserts.
