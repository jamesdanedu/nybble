# Activity file format

An activity file is JSON. One file can carry many activities. Import it in the
portal (Teacher → Activities → Import) or with `scripts/import-activities.mjs`.

This is the authoring format, and it is the only place an answer key is written
by hand. **The importer splits every `key` out of the file and writes it to
`activity_keys`** — a table with RLS enabled and no policies, readable only by
the service role. What stays in `activities.steps` is the `config`, which is
what gets sent to the browser. Nothing you put under `key` ever reaches a
student; anything you put under `config` does. That split is the whole reason
this format exists rather than a form.

```jsonc
{
  "nybble": 1,                       // format version
  "activities": [
    {
      "title": "Number systems — week 3",
      "topic": "Number Systems",     // free text; groups the activity bank
      "description": "Binary and hex conversion practice.",
      "visibility": "school",        // private | school | public
      "shared_context": {},          // handed to every step (a code snippet, say)
      "steps": [
        {
          "id": "q1",                // unique within the activity, stable
          "runner_id": "mcq",
          "title": "Quick check",
          "weight": 1,
          "config": { /* public — sent to the browser */ },
          "key":    { /* secret — stored in activity_keys */ }
        }
      ]
    }
  ]
}
```

Re-importing a file whose activity `title` and `topic` already exist updates
that activity in place rather than creating a duplicate. Pass `--replace` to
overwrite steps and keys wholesale.

---

## `mcq`

```jsonc
"config": {
  "title": "Data representation",
  "instructions": "Choose the best answer.",
  "shuffleQuestions": false,
  "shuffleOptions": true,
  "requireAll": true,
  "questions": [
    {
      "id": "q1",
      "stem": "How many values fit in 8 bits?",
      "code": "x = 0b1010",            // optional, rendered as a code block
      "image": "https://…",            // optional
      "multiple": false,               // checkboxes instead of radios
      "marks": 1,
      "options": [
        { "id": "a", "text": "128" },
        { "id": "b", "text": "256" },
        { "id": "c", "text": "True", "code": true }   // render in monospace
      ]
    }
  ]
}

"key": {
  "q1": {
    "correct": ["b"],
    "marks": 1,
    "partial": false,                  // multi-answer only, see below
    "explanation": "2^8 = 256 values, 0–255."
  }
}
```

`partial` applies only to `multiple: true` questions: marks are awarded
pro-rata as `(hits − misses) / correctCount`, floored at zero. Without it,
multi-answer questions are all-or-nothing.

---

## `numbase`

Questions are generated, so there is **no key** — the marker regenerates the
same set from `attempts.seed` and derives the answers.

```jsonc
"config": {
  "title": "Binary & hex — weekly test",
  "count": 10,
  "conversions": ["dec2bin", "bin2dec", "dec2hex", "hex2dec", "bin2hex", "hex2bin"],
  "minValue": 1,
  "maxValue": 255,
  "padBinary": true,
  "marksPerQuestion": 1,
  "timeLimitSecs": 300,
  "showPlaceValues": true
}

"key": {}
```

---

## `parsons`

The student is given the lines of a program in scrambled order and has to
restore both the **order** and the **indentation**. The pool may contain
**distractors** — lines that belong in no correct solution.

The runner is told only that a pool of lines exists. It is never told which
lines are distractors, nor the correct order: both live in the key.

```jsonc
"config": {
  "title": "Sum a list",
  "instructions": "Drag the lines into order and set the indentation.",
  "language": "python",
  "indentSize": 4,
  "maxIndent": 5,
  "lines": [
    { "id": "l1", "text": "def total(numbers):" },
    { "id": "l2", "text": "runningTotal = 0" },
    { "id": "l3", "text": "for n in numbers:" },
    { "id": "l4", "text": "runningTotal = runningTotal + n" },
    { "id": "l5", "text": "return runningTotal" },
    { "id": "d1", "text": "return n" },
    { "id": "d2", "text": "runningTotal = runningTotal + numbers" }
  ]
}

"key": {
  "solution": [
    { "id": "l1", "indent": 0 },
    { "id": "l2", "indent": 1 },
    { "id": "l3", "indent": 1 },
    { "id": "l4", "indent": 2 },
    { "id": "l5", "indent": 1 }
  ],
  "distractors": ["d1", "d2"],
  "marks": 5,
  "partial": true,
  "distractorPenalty": 0.5,        // marks lost per distractor used
  "explanation": "The accumulator has to be initialised before the loop, and the return has to be outside it."
}
```

Line ids that appear in `config.lines` but not in `solution` are distractors
whether or not they are listed in `distractors`; the list exists so the importer
can validate that you meant it. The importer rejects a file where `solution`
references an id that is not in `lines`.

The runner shuffles the pool using `attempts.seed`, so a resumed attempt shows
the same starting arrangement, and two students get different ones.

### Response

```jsonc
{
  "arrangement": [ { "id": "l1", "indent": 0 }, { "id": "l3", "indent": 1 } ],
  "unused": ["l2", "d1", "d2"]
}
```

### Marking

All-or-nothing unless `partial` is set. With `partial`:

1. **Order** — longest common subsequence between the ids the student used (in
   their order) and the solution ids. `orderScore = lcs / solutionLength`.
   LCS rather than position-by-position, because one missing line at the top
   should not zero every line below it.
2. **Indentation** — of the lines that landed in that common subsequence, the
   fraction whose indent matches the solution. `indentScore`.
3. **Combine** — `marks × (0.7 × orderScore + 0.3 × indentScore)`.
4. **Distractors** — subtract `distractorPenalty` for each distractor used.
5. Floor at zero, and award full marks only on an exact match of both order and
   indentation.

The 70/30 split is a judgement call, not a law. It is in `parsons.ts` as a
constant if you disagree — LCCS students lose more marks to indentation than
to ordering, so weighting it higher is defensible.

---

## `freetext`

A prompt and a box. Registered `scorer: 'manual'`, so there is **no key** — every
submission goes to the teacher review queue and waits for a human. It carries
PRIMM's Predict and Make phases.

```jsonc
"config": {
  "title": "Make",
  "prompt": "Write a function of your own that finds the largest number in a list.",
  "instructions": "Your teacher marks this one by hand.",
  "showContextCode": true,      // render shared_context.code above the box
  "placeholder": "def largest(numbers):",
  "rows": 8,
  "minChars": 40,               // blocks submit below this; 0 = just non-empty
  "maxChars": 0,                // 0 = no limit; otherwise stops typing past it
  "showPrior": {                // quote an earlier step back at the student
    "stepId": "predict",
    "label": "What you predicted",
    "field": "text"
  }
}

"key": {}                       // nothing to hide: a human decides the mark
```

### `showPrior`

This is the PRIMM mechanism. A Make step can show what the student wrote at
Predict, so they are made to compare the two rather than quietly forgetting
what they guessed. It reads `context.prior` — see `docs/runner-contract.md`.

`stepId` must name a step **earlier in the same activity**; the importer rejects
a forward reference, a self-reference and an id that does not exist, because all
three fail silently in front of a student otherwise. `field` is the key of that
step's response to display, and defaults to `text` — which is what another
`freetext` step returns. If the named step has no response yet, the block is
simply not drawn.

### Response

```jsonc
{ "text": "def largest(numbers):\n    …" }
```

### Marking

None, here. The scorer records `{ total: null, max: <step weight>, manual: true }`
and the attempt shows up in Teacher → Review, where the per-step rubric box takes
the mark and the comment. Two consequences worth knowing when you set weights:

- A `weight: 0` step (PRIMM's Run) costs the teacher nothing and contributes
  nothing — it exists to make the student look at something.
- Until a teacher marks it, a hand-marked step contributes 0 to the attempt's
  auto-score while still counting toward the maximum, so an activity that mixes
  hand- and auto-marked steps reads low until it is reviewed.

---

## Writing these with an LLM

The schema is deliberately flat and boring so you can paste this document into a
prompt and get valid files back. A prompt that works:

> Produce a Nybble activity file (format below) with 8 MCQ questions on
> two's complement for Leaving Certificate Computer Science, Higher Level.
> Every question needs an `explanation`. Return JSON only.

Always run the importer's `--dry-run` on generated files. It validates ids,
checks every `solution` line exists, catches duplicate option ids, and flags
questions whose `correct` array is empty — which is the mistake language models
make most often here.
