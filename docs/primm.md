# PRIMM

**P**redict, **R**un, **I**nvestigate, **M**odify, **M**ake — Sue Sentance's
sequence for teaching programming by starting from someone else's working code
rather than a blank editor. Students predict what a snippet does, run it, are
made to confront the gap between the two, then change the code and finally write
their own.

This document is the plan for supporting it. It is a design record, not a
tutorial: it says what we are building, what we deliberately are not, and which
question is still open.

## Is this doable? Yes

Four of the five phases are straightforward, and the step machinery they run on
is already built. Only the two code-execution phases carry any real unknown, and
the unknown there is *which engine*, not *whether*.

| Phase | What it needs | Risk |
|---|---|---|
| Predict | `freetext` — a prompt and a textarea | none |
| Run | in-browser Python | the only open question |
| Investigate | `mcq` — already shipped | none |
| Modify | in-browser Python | same question |
| Make | `freetext`, hand-marked | none |

If the engine spike below goes badly in both directions, PRIMM still ships in a
degraded form: **Run** becomes an authored "here is what this prints" step, with
the output written into the activity file, and **Modify** becomes a hand-marked
`freetext` step where the student writes their changed version. Both keep the
pedagogy — the student still confronts their prediction, still changes working
code — and both lose the liveness that makes the phases worth automating. The
third option, relaxing the runner sandbox for this one runner, is a real
tradeoff and is deliberately not the first thing to reach for.

Nothing in the plan requires a schema change or a portal redeploy.

## PRIMM is not a runner

The tempting shape is one `primm` runner holding all five phases. We are not
doing that, for three reasons:

1. **The marks are per-phase.** Predict is hand-marked, Investigate is an MCQ,
   Modify is auto-marked. One runner means one `step_scores` entry, so the
   teacher's per-step rubric in `reviews.rubric` collapses into a single number
   and the review queue loses the thing it is for.
2. **Weights are per-phase too.** Run is worth nothing; Make is worth the most.
   `steps[].weight` already expresses that.
3. **We would be writing a scorer for a workflow, not for an activity type.**
   The MCQ scorer would end up duplicated inside it.

The architecture already assumes the sequence version, in more places than the
docs let on:

- `attempt-client.tsx:243` refuses to let a student skip to an unanswered step,
  with the comment "PRIMM's whole point is order".
- `attempt-client.tsx:295` hands every step the same `shared_context`.
- `components/step-review.tsx` replays a multi-step attempt one iframe at a
  time, having already reasoned about a five-step sequence on an iPad.
- `score/index.ts:150` routes any step whose runner is registered `manual`
  straight to the teacher review queue.
- `reviews.rubric` is already `step_id -> { score, comment }`.

So a PRIMM activity is an ordinary five-step activity. What is actually missing
is two runners, one addition to the runner contract, and two fixes to code that
works fine today only because no activity has more than one kind of step in it.

## What has to be built

| | | |
|---|---|---|
| `freetext` runner | Predict, Make | **shipped** |
| `context.prior` | Investigate, Make | **shipped** |
| engine decision | Run, Modify | **settled — Skulpt**, see below |
| `pyrun` runner | Run, Modify | **shipped** |
| resubmission lock | Predict | **shipped** |
| pending-manual marks | results page | **shipped** |

All five phases now work, and both defects below are fixed.
`examples/primm-total.json` is the whole sequence — Predict and Make on
`freetext`, Run and Modify on `pyrun`, Investigate on the `mcq` runner that
already existed — and it imports clean.

`docs/runner-contract.md:124` names these as `freetext` and `pyodide`. Keep
`freetext`; rename `pyodide` to `pyrun`, because the engine is an
implementation detail behind one HTML file and the runner id should not promise
a particular one (see **The open question** below).

## The contract addition: `context.prior`

Investigate is the phase where a student is shown that their prediction was
wrong. Right now it cannot be, because **a runner never sees another step's
response**. Each step is amnesiac.

So `init.context` gains one key:

```js
Runner.start({
  onInit({ context }) {
    context.code            // shared_context, as today
    context.seed            // as today
    context.prior           // NEW: { predict: <response>, run: <response> }
  }
});
```

Rules:

- **Responses only, never scores.** Scores are withheld until a teacher releases
  feedback (`step-review.tsx` passes `score: null` until `showScores`), and
  putting them in `context` would route around that.
- **Only steps already answered**, in step order. A step never sees ahead.
- **No new trust surface.** A student's own prior answers are already in their
  browser; this hands back what they typed. No key material is involved.

The change is small — `attempt-client.tsx` already holds `attempt.step_responses`
and `step-review.tsx` already receives `responses` — and it is general. Any
"reflect on what you did earlier" step benefits, not just PRIMM.

## The two runners

### `freetext`

A prompt, a textarea, a word or character guide, submit. Registered
`scorer: 'manual'`, so it lands in the review queue with the teacher's rubric
box beside it.

```jsonc
"config": {
  "prompt": "What do you think this program prints? Why?",
  "showContextCode": true,      // render context.code above the box
  "placeholder": "I think it will print…",
  "minChars": 20,
  "rows": 6
}
"key": {}                       // nothing to hide; a human marks it
```

In `review` mode it renders the submitted text read-only. Where
`config.showPrior` is set it also renders `context.prior[stepId]` — that is the
mechanism by which Investigate quotes the prediction back.

Cheap to build, and it unblocks activity authoring before the hard part lands.

### `pyrun`

An editor, a Run button, a captured stdout pane, and optionally a set of test
cases. Two configurations of the same runner:

```jsonc
// Run phase — read-only, weight 0, the student just has to execute it
"config": {
  "source": "@context.code",    // or inline
  "editable": false,
  "requireRun": true            // submitting means "I ran it"; response is the output
}

// Modify phase — editable, with tests
"config": {
  "source": "@context.code",
  "editable": true,
  "task": "Make total() skip negative numbers.",
  "tests": [ { "id": "t1", "call": "total([1,-2,3])", "expect": "4" } ],
  "showTests": true             // students see what they must satisfy
}
```

The engine is deliberately not named here.

## The engine: Skulpt

**Decided by spike, not by preference.** Both candidates were run inside the real
runner sandbox — mounted through the production `runner-host.js`, with nothing
relaxed — against the four criteria set out for this decision. Skulpt wins on
two of them, ties on one, and Pyodide is disqualified on the one that was always
going to be decisive.

### What the sandbox actually permits

Measured from inside the iframe rather than assumed. These constrain every
future runner, not just this one:

| | |
|---|---|
| `localStorage`, `indexedDB`, `caches` | all throw `SecurityError` |
| `SharedArrayBuffer` | absent; `crossOriginIsolated` false |
| Worker from a URL | refused — *"cannot be accessed from origin 'null'"* |
| Worker from a Blob URL, classic | **works** |
| Worker from a Blob URL, **module** | **fails**, even a trivial one |
| `fetch()` to the runner's own site | fails — the opaque origin makes it cross-origin |
| `fetch()` to an origin sending CORS headers | works |
| `<script src>` and classic `importScripts` | work; not subject to CORS |

The fourth and sixth rows are the ones that decided this. Note the sixth
carefully: **a runner that fetches anything from JavaScript needs CORS headers
on whatever serves it**, because the sandbox's opaque origin makes even a
same-site request cross-origin. Loading via `<script src>` sidesteps this
entirely, which is why Skulpt never hits it and Pyodide does.

(`location.origin` inside the frame reports the site's origin and is
misleading — the storage exceptions and the worker error are the authoritative
signal that the document origin is opaque.)

### The four criteria

| | Skulpt | Pyodide |
|---|---|---|
| **1. Size** (gzipped, measured) | **228 KB** | **6.03 MB** — 27× more |
| **1. Init cost** | 12 ms cold, 6 ms warm | ~2.0 s, and ~2.0 s again warm |
| **2. Stops a runaway loop** | **yes** — `TimeLimitError` at 3007 ms | **no** — froze until the 45 s timeout |
| **3. Frame survives the abort** | **yes** — ran `print(6*7)` → `42` next | **no** — frame never recovered |
| **4. LCCS coverage** | **14/14** | **14/14** |

Criterion 4 is the surprise, and it removes the only real argument for Pyodide.
The battery — f-strings, list comprehensions, dictionaries, string methods,
`try`/`except`, `while` accumulators, default arguments, `enumerate`/`zip`,
`sorted(key=…)`, classes, `//` and `%` and `round`, seeded `random`, list
methods, and `input()` — is the Leaving Cert Python surface, and both engines
ran it byte-identical with identical results. **The fidelity tradeoff everyone
assumes when choosing Skulpt does not bite at this level.** It would bite on
`numpy` or `matplotlib`; those are not on the course.

The size figures are transfer bytes, gzipped, measured from the files
themselves. Attempts to throttle the network at the browser did not reach the
sandboxed subframe, so rather than present fake measurements: at a contended
1.5 Mbps that is roughly 1.2 s of transfer for Skulpt against about 33 s for
Pyodide, and at a modest 4 Mbps about 0.5 s against 12 s. That is arithmetic on
measured sizes, not a stopwatch. The HTTP cache does spare the repeat download
— it is the only cache available, since every storage API throws — but
Pyodide's ~2 s is mostly wasm instantiation and unpacking the stdlib, and it is
paid on **every** mount, warm cache or not. That was measured: 2052 ms cold,
2007 ms warm.

### Why Pyodide could not be rescued

Pyodide fails criterion 2 on the main thread because stopping it needs an
interrupt buffer, which needs `SharedArrayBuffer`, which needs cross-origin
isolation, which needs the `allow-same-origin` this contract deliberately
withholds. The alternative is a worker, and that was pursued to the end:

1. A URL worker is refused outright from the opaque origin.
2. A **classic** Blob worker constructs and runs — but Pyodide rejects it
   itself: *"Classic web workers are not supported."*
3. So Pyodide needs a **module** worker — and a module Blob worker fails in this
   sandbox even with a trivial one-line body.

There is no fourth option. Pyodide cannot run in a worker here, and on the main
thread it cannot be stopped. Per the decision rule, a frozen tab mid-class is
worse than an unsupported language feature — and as criterion 4 shows, there is
no unsupported language feature to trade against it.

One more thing the spike settled: Pyodide **does not load at all** from
`public/` as this repo serves it today, failing with *"Failed to fetch
dynamically imported module: pyodide.asm.mjs"*. It needs CORS headers on its
asset origin before it will even start. It was given them for the rest of the
spike, so the results above are Pyodide at its best, not Pyodide handicapped.

### What this means for `pyrun` — and what was built

- **Vendor Skulpt into `public/runners/lib/`.** 228 KB in the repo, no CDN, no
  network at test time — `test/harness.test.mjs` keeps working offline against
  `test/vercel-sim.py`, the same as every other runner.
- **Load it with `<script src>`**, never `fetch`, so the CORS constraint above
  never applies.
- **Set `execLimit`** and surface `TimeLimitError` to the student as "your
  program ran too long — is there a loop that never ends?", which is a teaching
  moment rather than an error.
- The runner id stays `pyrun`. If the course ever needs real CPython, the engine
  is one HTML file behind the contract, and the sandbox facts above are what a
  future attempt has to solve.

All four were done. The abort is asserted in `test/harness.test.mjs` rather than
assumed: an endless loop is stopped in about three seconds and the next program
runs normally in the same frame. One thing the spike did not anticipate and the
build surfaced: because every check re-runs the student's source, a runaway
program would have cost the time limit again for each one, so the checks are
skipped when a run times out — the fix is obviously "stop the loop", and making
a student wait twelve seconds to be told so is just cruel.

## Marking: what the browser is allowed to be believed about

**Nothing it says about running code.** A student who can post a fabricated
`clientScore` can equally post fabricated stdout, and the scorer is Deno — it
cannot re-run Python to check. Comparing submitted output against an expected
string in the key looks like server-side marking and is not.

So:

- **Run** — `weight: 0`. The response is the captured output; there is nothing to
  mark. It exists to make the student execute the code before Investigate quotes
  their prediction back at them.
- **Investigate** — `mcq`, server-marked, entirely unaffected by any of this.
  Questions like "which line changes the value of `total`?" against
  `context.code`.
- **Modify** — `scorer: 'client'`, practice mode. The runner executes the
  teacher's test cases in the browser and returns `clientScore` for instant
  formative feedback. It carries no summative marks and the portal already
  ignores `clientScore` outside practice mode (`attempt-client.tsx`, `onSubmit`).
  This is not a compromise: PRIMM is a formative sequence, and instant feedback
  on "does my change work" is the point of the phase.
- **Make** — `scorer: 'manual'`. A teacher reads it. There is no honest
  alternative for open-ended code.

Held in reserve, not built now: **structural checks in the key** — marking the
submitted *source* rather than its output ("uses a `while` loop", "defines
`total`"). Source is the artefact the student actually hands up, so it is not
forgeable the way an output claim is. It is brittle, but it would work as a
partial-credit floor under a manual Make mark if hand-marking load becomes the
complaint.

## Two defects PRIMM exposed — both now fixed

Both are latent today because no shipped activity mixes step kinds.

### Predict was not locked

The portal hides its own Submit on an answered step
(`attempt-client.tsx`, `!answered.has(step.id)`), but a runner that declares
`selfSubmit` keeps its own button, and the scorer overwrites
`step_responses[stepId]` unconditionally. A student can walk back to Predict
after seeing the output and rewrite their prediction — which destroys the one
thing the sequence is built to produce.

`attempts.attempt_no` already exists, so retries were designed as whole-attempt,
not per-step.

**Fixed in two places, because one was not enough.** The scorer refuses to score
a step that already has a response, returning `409` — that is the half that
counts, since the portal is not a security boundary and a `selfSubmit` runner
keeps its own button whatever the portal draws. And the portal now re-mounts an
answered step in `review` mode rather than `attempt`, so every runner renders it
read-only using machinery it already had, and a second answer is never offered
in the first place. A step-level `allowResubmit: true` is the deliberate
exception.

That second half quietly created a combination nothing had exercised: a runner
asked to replay a response with `score: null`, because the portal holds no marks
for an earlier step and must not invent any. `test/harness.test.mjs` now checks
that mcq and parsons both render the answer and show no score banner.

### Hand-marked steps made the auto mark read as a fail

`score/index.ts:151` returns `{ total: null, max: step.weight }` for a manual
step. The completion sum then adds `0` to `auto_score` but adds the full weight
to `max_score`. A student who did everything right sees **5 / 15** until their
teacher gets to it — three weeks of marking, in a mark that looks like a fail.

**Fixed at the display layer, not by fiddling the numbers.** `splitMarks()` in
`lib/format.ts` separates the marks a machine awarded from the marks a person
still owes, and both the results page and the dashboard show *"Marked so far:
5 / 10"* with *"5 marks still with your teacher"* beside it. `attempt.auto_score`
stays exactly what the scorer produced, which is the property `reviews` was split
from `attempts` to preserve.

The dashboard mattered as much as the results page: that is the number a student
sees first, in a list of everything they have done, and a hand-marked activity
sitting there reading 5 / 15 looks like a fail for however long the marking
takes. A hand-marked step worth nothing — PRIMM's Run step — is not counted as
pending, because no mark is coming for it.

## Order of work

1. ~~**`freetext` + `context.prior`.**~~ **Done.** A four-step PRIMM runs end to
   end; `examples/primm-total.json` is the worked example, and the runner is
   covered in `test/harness.test.mjs` alongside the others.
2. ~~**The engine spike.**~~ **Done.** Skulpt, on the evidence above.
3. ~~**`pyrun`**, plus harness coverage.~~ **Done.** Seven checks in
   `test/harness.test.mjs`, including the runaway-loop abort and the frame
   surviving it — the property the engine choice rests on.
4. **The two defects.**
5. **An example activity** in `examples/`, the way `lccs-week1.json` works today,
   so the whole sequence is importable and testable by hand.

## The shape of the finished thing

```jsonc
{
  "title": "PRIMM — summing a list",
  "topic": "Programming",
  "shared_context": {
    "code": "def total(numbers):\n    runningTotal = 0\n    for n in numbers:\n        runningTotal = runningTotal + n\n    return runningTotal\n\nprint(total([3, 1, 4]))"
  },
  "steps": [
    { "id": "predict",     "runner_id": "freetext", "title": "Predict",     "weight": 2 },
    { "id": "run",         "runner_id": "pyrun",    "title": "Run",         "weight": 0 },
    { "id": "investigate", "runner_id": "mcq",      "title": "Investigate", "weight": 4 },
    { "id": "modify",      "runner_id": "pyrun",    "title": "Modify",      "weight": 4 },
    { "id": "make",        "runner_id": "freetext", "title": "Make",        "weight": 5 }
  ]
}
```

Five steps, one snippet, four runners — three of which the portal already knows
about. No schema change, no portal redeploy, no new code path. If this plan is
right, that is what it should look like.
