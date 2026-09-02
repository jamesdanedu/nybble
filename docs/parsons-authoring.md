# Authoring Parsons problems for the LCCS Python checklist

How the Python activities in `examples/python/` are built, and how to build the
rest of them. The file format itself is in [activity-format.md](activity-format.md);
this is the pedagogy and the house style that sit on top of it.

The aim is a student working the checklist top to bottom and arriving at each
new idea having already assembled the one underneath it.

---

## 1. Not every checklist item is a Parsons problem

A Parsons problem tests **order and indentation**. That makes it the right tool
for anything with control flow or a required sequence, and the wrong tool for
recall. The test: *scramble the lines — is there still exactly one sensible
order?* "Print a tab" is one line, so it isn't a Parsons problem.

| Parsons | MCQ (the `mcq` runner, in the same activity) |
| --- | --- |
| Loops, conditionals, functions, file handling, building a list, the accumulator pattern, input → process → output | `len()` / `upper()` / `strip()`, what `pass` does, operator precedence, `randint` vs `randrange`, slicing syntax, spotting an infinite loop |

So the unit of work is **one activity per checklist section**, mixing `parsons`
and `mcq` steps in the one file. `06-iteration.json` ends with a five-question
MCQ for exactly the items the eight Parsons problems could not reach.

## 2. The ladder inside each section

Steps go in rising order, and that order is the teaching:

| Rung | `maxIndent` | Distractors | What it asks |
| --- | --- | --- | --- |
| 1 | `0` | none | Order alone. A straight-line program, no blocks. |
| 2 | exactly as deep as the solution | none | Order and indentation, with no room to over-indent. |
| 3 | solution depth + 1 | 2–3 | Order, indentation, and telling right from nearly-right. |
| 4 | solution depth + 1 | 2–3 | All of the above, over a program that extends one the student already solved. |

Sections split into two kinds, and each skips a rung.

**Straight-line sections** — output, input, assignment, maths operations — have
no blocks at all, so `maxIndent` stays `0` throughout and rung 2 does not exist.
They run rung 1, then go straight to rung 3 and let the distractors do the
climbing.

**Sections with a body** — conditionals onwards — cannot be flat, so rung 1 does
not exist either. They start at rung 2 and get their gentleness from length:
`05-conditionals.json` opens with a five-line if/else, `06-iteration.json` with
a four-line loop and one indented line.

Give `maxIndent` headroom on the later rungs. Clamping it to the exact depth is
a scaffold — it quietly rules out the mistake of going a level too deep — so
take the scaffold away as the section goes on.

Set `partial: true` throughout. A student who has the shape right and one
indent wrong has learned most of it, and all-or-nothing marking hides that from
you as much as from them. Raise `distractorPenalty` from `0.5` to `1` across the
rungs.

## 3. Distractors are the lesson

The distractors carry more teaching than the correct lines do, so write them
from misconceptions you have actually seen, not from random mutation. Draw from
this catalogue and add to it as classes go on:

| Section | Distractor to use | The misconception |
| --- | --- | --- |
| Output | `print("Letters:" + len(word))` | `+` cannot join a string to a number |
| Output | `print(f"...")` with the `f` removed | the braces only mean something in an f-string |
| Input | `age = input("Age: ")` where arithmetic follows | `input()` always returns a string |
| Input | `word.upper` without the brackets | a method has to be called, not just named |
| Assignment | `total =+ 25` | reads as "assign positive 25" — runs, and is wrong |
| Assignment | `b = a` before `a` has been copied | a swap needs somewhere to put the first value |
| Maths | `radius * 2` where `radius ** 2` is meant | doubling is not squaring |
| Assignment / maths | `average = a + b / 2` | precedence, missing brackets |
| Conditionals | `if x = 5:` | assignment mistaken for comparison |
| Conditionals | a second `if` where `elif` belongs | independent tests vs one decision |
| Iteration | `total = 0` placed inside the loop | the accumulator resets every pass |
| Iteration | `for letter in range(word):` | `range()` is for numbers, not strings |
| Iteration | `break` where `continue` belongs | abandoning the loop vs abandoning one pass |
| Iteration | `range(1, 10)` for ten passes | the stop value is excluded |
| Lists | `scores = scores + item` | `+` concatenates lists; `append()` adds one item |
| Lists | `for i in range(names):` | needs `len(names)`, or just loop the list |
| Functions | a `print()` where a `return` belongs | showing a value vs handing it back |
| Functions | `return` inside the loop that should follow it | returning on the first pass |
| File handling | `f.close()` inside the read loop | closing before the reading is done |

Two rules the checker enforces, because both are invisible on screen:

- a distractor must never be word-for-word a solution line;
- no two solution lines should share text, or an arrangement that looks right
  can still be marked wrong (the marker matches ids, not text).

## 4. Every key has to run

`--dry-run` proves the file is structurally sound. It cannot tell you whether
the key, reassembled with its indentation, is Python that works — and that is
the failure a student finds by getting the answer *right*.

```bash
npm run check:parsons -- examples/python/06-iteration.json   # reassemble and run every key
npm run import:activities -- --dry-run examples/python/06-iteration.json
```

Give each step a behaviour check in its **key**, never its config, so it stays
out of the browser with everything else secret:

```jsonc
"check": {
  "stdin": "5\n3\n0\n",
  "stdout": "Enter a number (0 to stop): …Total: 8\n",
  "timeoutMs": 5000
}
```

Include the `input()` prompts in `stdout` — they are printed too. Don't
hand-write the expected output: run the program once and paste what it actually
produced, then read it to confirm that is what you meant. `check` is optional;
without a `stdout` the step is still compiled, just not run.

## 5. Is the key's order the only order?

A straight-line program can easily hold two lines that could be written either
way round — two setup values, or an assignment sitting beside a print that does
not use it. The marker cannot see that. It matches the key, so a student who
picks the other order loses marks for a program that works.

`--order` finds them empirically rather than by guessing: it swaps each adjacent
pair at the same indent, re-runs, and warns when the output is unchanged.

```bash
npm run check:parsons -- --order examples/python/*.json
```

It is off by default and warning-only, because the answer is usually to live
with it. Under `partial` marking one transposed pair costs a single position in
the longest common subsequence — about a tenth of the marks on a six-line
problem — and forcing every program into a strictly unique order means
interleaving prints between assignments in ways nobody writes by hand. Across
sections 01–06 it reports 28 such pairs, and all of them are setup lines.

What to do with a warning, in order of preference: make the second line actually
use the first (`each = sweets // children` before the print that reports it);
say the order in the instructions ("set both numbers up first"); or accept it.
What not to do is contort the program — students read this code.

## 6. Conventions

- **One file per section**, `examples/python/NN-name.json`, numbered in
  checklist order:

  | | | | |
  | --- | --- | --- | --- |
  | 01 output | 04 maths operations | 07 strings | 10 functions |
  | 02 input | 05 conditionals | 08 randomness | 11 file handling |
  | 03 assignment | 06 iteration | 09 lists and dictionaries | 12 time and date |

  Two checklist items sit under *Maths operations* but are really about
  assignment, so they are taught in 03: interchanging two variables, and the
  shorthand operators.

- **`topic`** is `"Programming — Python"` for all of them, so the activity bank
  groups the year's work together. **`title`** is `"Python — NN Section"`.
- **Step ids** are `p1…pn` for Parsons and `m1…` for MCQ, in ladder order.
  Ids are the marking key's handle on a line, so once students have attempted
  an activity, never renumber them.
- **`marks`** is the number of lines in the solution, and **`weight`** is 1 for
  every step, so a long problem is worth more than a short one within a section
  while sections stay comparable.
- Re-importing matches on `title` + `topic` and updates in place, so a file
  stays the editable source of truth. Use `--replace` when a step's lines
  change wholesale.

The final checklist section, *Programmer competencies*, is not activity
material — nothing there has a correct arrangement. It is assessed through the
coursework, not through the portal.
