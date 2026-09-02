# Runner contract (`sap-runner-v1`)

A **runner** is a single self-contained HTML page that presents one step of an
activity and hands a response back to the portal. It never talks to the
database, never sees the student's identity, and never holds an answer key.

That constraint is what makes activities pluggable: registering a row in
`runners` and hosting an HTML file is all a new activity type needs. No portal
redeploy, no schema change.

## Anatomy of a runner

```html
<!doctype html>
<meta charset="utf-8">
<title>My Activity</title>
<script src="../lib/runner-sdk.js"></script>
<div id="app"></div>
<script>
Runner.start({
  capabilities: { selfSubmit: true, autoScore: true },

  onInit({ stepId, config, state, context, mode, response, score }) {
    // config  — public settings the teacher authored (never the key)
    // state   — whatever you last passed to saveState(), for resuming
    // context — activity.shared_context, e.g. the code snippet a PRIMM
    //           sequence is about; identical across every step. Plus
    //           `seed` (see below) and `prior`, the responses to the
    //           steps before this one.
    // mode    — 'attempt' | 'review' | 'preview'
    // response/score — populated in review mode so you can render the
    //           student's answer with the marking alongside it
    render(config, state, mode);
  },

  onRequestSubmit() {
    return { response: collectAnswers(), clientScore: 3, maxScore: 5 };
  }
});
</script>
```

## Messages

### Host → runner

| type | payload | when |
|---|---|---|
| `init` | `stepId, config, state, context, mode, response, score` | once, after `ready` |
| `requestSubmit` | — | the portal's own Submit button was pressed |
| `setMode` | `mode` | e.g. attempt → review after marking |

### Runner → host

| type | payload | when |
|---|---|---|
| `ready` | `capabilities` | as soon as the SDK loads |
| `state` | `state` | freely, on every change — the host debounces (800 ms) |
| `submit` | `response, clientScore, maxScore` | the student finished this step |
| `resize` | `height` | automatic, via `ResizeObserver` |
| `log` | `level, message` | diagnostics into the portal console |

## Capabilities

Declared by the runner in `ready`, used by the portal to decide what chrome to
draw around the iframe.

- `selfSubmit` — the runner has its own submit button; the portal hides its own.
- `autoScore` — the runner can produce a `clientScore`. Advisory only (below).
- `timed` — the runner manages its own timer; the portal will not impose one.

## Trust model

The iframe is sandboxed with `allow-scripts allow-forms allow-popups` and
deliberately **not** `allow-same-origin`, so a runner cannot reach the portal's
session, cookies, or Supabase client. Its origin is opaque, which means neither
side can authenticate the other by origin string. Both sides therefore
authenticate by **window identity**:

- the runner only accepts messages where `event.source === window.parent`
- the host only accepts messages where `event.source === iframe.contentWindow`

### What the sandbox permits

Measured from inside a real runner frame, not assumed. Withholding
`allow-same-origin` gives the document an **opaque origin**, and that has
consequences well beyond the session isolation it is there for:

| | |
|---|---|
| `localStorage`, `indexedDB`, `caches` | all throw `SecurityError` |
| `SharedArrayBuffer` | absent (`crossOriginIsolated` is false) |
| Worker from a URL | refused — *"cannot be accessed from origin 'null'"* |
| Worker from a Blob URL, classic | works |
| Worker from a Blob URL, **module** | fails, even with a trivial body |
| `fetch()` to the runner's own site | **fails** — see below |
| `fetch()` to an origin sending CORS headers | works |
| `<script src>`, classic `importScripts` | work; not subject to CORS |

Two of these bite in practice:

- **A runner cannot cache anything across loads.** The browser's HTTP cache is
  the only one available. Do not write a runner that assumes otherwise.
- **A `fetch()` from a runner is always a cross-origin request, even to the
  runner's own site**, because the requesting origin is opaque rather than the
  site's. It therefore needs CORS headers on whatever serves it. Loading with
  `<script src>` avoids this entirely, and is the reason a runner should ship
  its dependencies as scripts rather than fetch them.

`location.origin` inside the frame reports the site's origin and is misleading;
the storage exceptions are the honest signal.

These were established by the engine spike in `docs/primm.md`, which is also
where the reasoning lives for why they ruled one candidate out.

### Scores from a runner are advisory

Everything inside the iframe is under the student's control — they can open dev
tools and post any message they like. So:

- `config` sent to a runner contains **public settings only**. Answer keys live
  in `activity_keys`, a table with RLS enabled and no policies, readable only by
  the service role.
- `clientScore` is used **only** where `assignments.mode = 'practice'`, for
  instant formative feedback.
- Anything graded is scored by the `score` Edge Function, which loads the key
  with the service role and writes `attempts.step_scores` / `auto_score`. A
  database trigger strips those columns from any student-originated update.

## Generated question sets

`attempts.seed` is a stable per-attempt integer. A runner that generates its own
questions (the number base one does) must derive them from that seed via
`Runner.rng(seed)`, so the server can regenerate the identical set at marking
time without storing every question. Same seed in, same questions out.

## Registering a runner

```sql
insert into runners (id, name, version, entry_url, scorer, school_id)
values ('parsons', 'Parsons Problem', '1.0.0',
        '/runners/parsons/index.html', 'server', '<school-uuid>');
```

`scorer` is one of:

- `server` — a case exists in the scorer Edge Function for this runner id
- `client` — trust `clientScore` (practice-only runners)
- `manual` — no auto-marking; goes straight to the teacher review queue

## Steps and PRIMM

An activity is an ordered list of steps, each a runner instance:

```json
{
  "shared_context": { "code": "def total(xs):\n    t = 0\n    ..." },
  "steps": [
    { "id": "predict",     "runner_id": "freetext", "title": "Predict",     "weight": 1 },
    { "id": "run",         "runner_id": "pyodide",  "title": "Run",         "weight": 0 },
    { "id": "investigate", "runner_id": "mcq",      "title": "Investigate", "weight": 2 },
    { "id": "modify",      "runner_id": "pyodide",  "title": "Modify",      "weight": 3 },
    { "id": "make",        "runner_id": "freetext", "title": "Make",        "weight": 4 }
  ]
}
```

Every step receives the same `context`, so the whole sequence is about one
snippet. A plain quiz is just a one-step activity — there is no separate code
path for it.

## `context.prior`

A step also receives the responses to the steps **before** it, keyed by step id:

```js
onInit({ context }) {
  context.code    // shared_context, the same for every step
  context.seed    // this attempt's seed
  context.prior   // { predict: { text: "I think it prints 6" } }
}
```

Without this, PRIMM does not work. Its whole mechanism is the student being
made to confront the gap between what they predicted and what actually
happened, and that requires the later step to be able to quote the earlier one
back at them. Every step used to be amnesiac.

Three rules:

- **Responses only, never scores.** A score may be withheld until a teacher
  releases feedback; putting one in `context` would route around that.
- **Earlier steps only.** A step never sees ahead of itself — the same rule the
  portal's step buttons enforce for navigation.
- **Answered steps only.** An unanswered earlier step is absent rather than
  present-and-empty, so a runner can tell "not done" from "left blank".

`prior` is populated identically in `review` mode, so a replayed step shows the
teacher what the student saw.

This adds no trust surface. These are the student's own answers, already in
their own browser, and nothing a runner does with them is believed by the
scorer. The shape is built by `priorResponses()` in `lib/step-context.ts`,
which both the attempt player and the review page call — one place, so the two
cannot drift.
