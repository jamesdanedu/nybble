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
| `pyrun` runner | Run, Modify | still to do, and the bulk of the work |
| resubmission lock | Predict | still to do — scorer fix |
| pending-manual marks | results page | still to do — scoring fix |

With the first two in, a **four-step** PRIMM works today: Predict and Make on
`freetext`, Investigate on `mcq`, and Run as an authored "here is what it
prints" step, also on `freetext`. `examples/primm-total.json` is exactly that,
and imports clean. What `pyrun` adds is the student running and changing the
code themselves rather than being told what it did.

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

## The open question: which Python engine

**This is unresolved and gated on a spike.** The sandbox is what decides it.

The runner iframe is `allow-scripts allow-forms allow-popups` with **no
`allow-same-origin`** (`runner-host.js:31`). That is a deliberate, correct
choice — it is why a runner cannot reach the portal's Supabase session — and it
constrains the engine severely:

- **Opaque origin, so every storage API throws.** `localStorage`, IndexedDB,
  Cache Storage. Nothing persists across iframe loads except the browser's own
  HTTP cache.
- **No `SharedArrayBuffer`.** Cross-origin isolation needs `allow-same-origin`
  plus COEP. This removes Pyodide's interrupt buffer, which is the supported way
  to stop running code.
- **Web Workers from an opaque origin are uncertain** and vary by browser. This
  needs measuring, not assuming.

The consequence that matters pedagogically: with neither a worker nor a
`SharedArrayBuffer`, `while True:` freezes the iframe with no way out except the
host destroying it. In a room of fifteen-year-olds that happens in week one.

### The candidates

| | Skulpt | Pyodide |
|---|---|---|
| Size | ~1.5 MB, vendorable into `public/runners/lib/` | ~10 MB+, realistically CDN-only |
| Caching | irrelevant, it ships with the repo | none available — opaque origin |
| Stopping runaway code | `Sk.execLimit`, main thread | needs SAB or a worker |
| Python fidelity | a subset | real CPython |
| `test/harness.test.mjs` | runs offline under `test/vercel-sim.py` | needs network |

That last row is not a detail. Every other runner in this repo is tested
end-to-end against a local static server with no network access. An engine that
cannot be tested that way breaks the testing story for all of them.

### The spike

Before either runner is written, build a throwaway page — `public/spike.html`,
deleted afterwards — mounted through the **real** `runner-host.js` sandbox, not
a relaxed one. Load each engine and record:

1. **Cold load time** on a throttled connection, and again on reload, to see
   what the HTTP cache actually saves under an opaque origin.
2. **Does a runaway loop stop?** Run `while True: pass` and confirm the engine
   aborts it. For Skulpt that means `Sk.execLimit` firing; for Pyodide it means
   establishing whether a worker can even be constructed there.
3. **Does the iframe survive it?** After the abort, can the student edit and run
   again, or is the frame dead?
4. **LCCS coverage.** Run a page of representative Leaving Cert code — f-strings,
   list comprehensions, `input()`, dictionaries, `try/except`, string methods —
   and note what each engine refuses.

**Decision rule.** Skulpt wins unless (2) or (3) fails for it, or (4) shows it
refusing something on the LCCS course. Pyodide wins only if it clears (2) and (3)
inside the real sandbox — if it cannot stop a runaway loop there, it is
disqualified whatever its fidelity, because a frozen tab mid-class is worse than
an unsupported language feature.

Whichever wins, the runner id stays `pyrun` and the engine stays behind that one
HTML file, so switching later is a `runners` row and a file — not a portal
redeploy. That is the whole point of the contract.

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

## Two defects PRIMM will expose

Both are latent today because no shipped activity mixes step kinds.

### Predict is not locked

The portal hides its own Submit on an answered step
(`attempt-client.tsx`, `!answered.has(step.id)`), but a runner that declares
`selfSubmit` keeps its own button, and the scorer overwrites
`step_responses[stepId]` unconditionally. A student can walk back to Predict
after seeing the output and rewrite their prediction — which destroys the one
thing the sequence is built to produce.

`attempts.attempt_no` already exists, so retries were designed as whole-attempt,
not per-step. Fix: the scorer refuses to score a step that already has a
response, returning `409`. Behind a per-step `allowResubmit` flag if any existing
activity turns out to depend on the current behaviour.

### Hand-marked steps make the auto mark read as a fail

`score/index.ts:151` returns `{ total: null, max: step.weight }` for a manual
step. The completion sum then adds `0` to `auto_score` but adds the full weight
to `max_score`. A student who did everything right sees **5 / 15** until their
teacher gets to it — three weeks of marking, in a mark that looks like a fail.

Fix at the display layer, not by fiddling the numbers: carry a `pendingManual`
total so the results page can say *"5 / 10 so far — 5 marks with your teacher"*.
`attempt.auto_score` stays exactly what the scorer produced, which is the
property `reviews` was split from `attempts` to preserve.

## Order of work

1. ~~**`freetext` + `context.prior`.**~~ **Done.** A four-step PRIMM runs end to
   end; `examples/primm-total.json` is the worked example, and the runner is
   covered in `test/harness.test.mjs` alongside the others.
2. **The engine spike.** Throwaway, inside the real sandbox, against the decision
   rule above.
3. **`pyrun`**, plus harness coverage matching the existing runners in
   `test/harness.test.mjs`.
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
