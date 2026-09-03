# Leaving Certificate Computer Science — multiple-choice bank

Fourteen activity files, one per topic, ten questions each: **140 questions in
total**, every one with an explanation that students see on review.

| File | Activity topic | Covers |
|---|---|---|
| `01-character-sets.json` | Data Representation | ASCII, extended ASCII, Unicode, UTF-8, character arithmetic |
| `02-logic-gates.json` | Logic Gates | AND, OR, NOT, XOR, NAND, NOR, truth tables, the half adder |
| `03-computational-thinking.json` | Computational Thinking | decomposition, abstraction, pattern recognition, generalisation, evaluation |
| `04-algorithms.json` | Algorithms | linear and binary search, bubble/selection/insertion sort, growth rates |
| `05-computer-systems.json` | Computer Systems | von Neumann, fetch-decode-execute, registers, cache, buses, storage |
| `06-networks.json` | Networks | protocols, IP and MAC, DNS, packet switching, topologies, bandwidth and latency |
| `07-cybersecurity.json` | Cybersecurity | encryption, hashing, 2FA, malware, injection, GDPR |
| `08-python-fundamentals.json` | Programming | types, operators, strings, lists, dictionaries, loops, functions |
| `09-web-development.json` | Web Development | HTML/CSS/JS roles, the DOM, events, accessibility, client vs server (ALT 1) |
| `10-data-analytics.json` | Data Analytics | averages and outliers, CSV, chart choice, sampling bias, correlation (ALT 2) |
| `11-embedded-systems.json` | Embedded Systems | microcontrollers, sensors and actuators, ADC, interrupts, IoT risk (ALT 4) |
| `12-ethics-ai-society.json` | Computers and Society | machine learning, algorithmic bias, digital divide, e-waste, copyright |
| `13-design-and-testing.json` | Design and Testing | error types, test data, trace tables, validation vs verification, HCI |
| `14-modelling-and-simulation.json` | Modelling and Simulation | assumptions, deterministic vs stochastic, validation, chaos (ALT 3) |

`examples/binary-numbers-mcq.json` covers number systems and predates this set.

## Importing

Each file is a standalone activity, so import as many or as few as you like:

```bash
node scripts/import-activities.mjs --dry-run examples/mcq/*.json
node scripts/import-activities.mjs examples/mcq/03-computational-thinking.json
```

Re-importing updates an activity in place when its `title` and `topic` already
exist, so fixing a question and running the command again does not create a
duplicate.

## Conventions used here

Each file is one activity with a single `mcq` step worth 10 marks, 1 mark per
question.

- **`shuffleOptions` is on, `shuffleQuestions` is off.** Questions in a topic
  build on each other, so their order is deliberate; option order is not.
- **No explanation names an option by letter.** The runner shuffles options per
  attempt and never shows the letters, so "option b" would be meaningless to a
  student. Distractors are referred to by their content instead.
- **Correct answers are spread evenly across the four positions.** Shuffling
  already hides any pattern, but the file stays honest if a teacher turns
  shuffling off or prints the questions.
- **Every explanation says why the wrong answers are wrong**, not just why the
  right one is right — that is the part a student reads after losing the mark.

## Editing them

Answers live under `key`, which the importer splits out into `activity_keys` and
never sends to a browser. Never move `correct` or `explanation` into `config`:
the importer refuses the file rather than publishing the answers, which is the
behaviour you want, but it is easy to trip over when adding a question by hand.

Always `--dry-run` after editing. See `docs/activity-format.md` for the schema.
