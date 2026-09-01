/* ===========================================================================
 * schema.mjs — validate and split an activity file.
 *
 * THIS IS THE SECURITY-CRITICAL PART OF THE IMPORT FEATURE. Read the whole
 * file before changing anything in it.
 *
 * An activity file (docs/activity-format.md) carries, for every step, BOTH:
 *
 *     "config": { ... }    public — sent verbatim to the browser, inside the
 *                          sandboxed runner iframe
 *     "key":    { ... }    secret — the answers, explanations, distractor lists
 *
 * The database keeps them in two different tables with two very different
 * security postures:
 *
 *     activities.steps[]   readable by any student the activity is assigned to
 *     activity_keys.keys   RLS enabled, NO POLICIES AT ALL — only the service
 *                          role can read it, which in practice means only the
 *                          `score` Edge Function
 *
 * So the single most important thing this module does is `splitStep()`: it
 * builds the stored step out of an ALLOW-LIST of fields (id, runner_id, title,
 * weight, config) rather than by deleting `key` from a copy of the input.
 *
 * Allow-list, not deny-list, deliberately. A deny-list (`delete step.key`)
 * fails open: the day someone writes `"answer"` or `"keys"` or `"solution"` at
 * the top level of a step instead of under `key`, a deny-list ships it to every
 * student and nothing complains. The allow-list fails closed — an unrecognised
 * field is dropped, and reported as a warning so the author finds out.
 *
 * The same reasoning applies inside `config`: this module refuses to import a
 * step whose `config` contains a field that is known to be a key field for that
 * runner (`correct`, `solution`, `distractors`, `explanation`). That is a
 * belt-and-braces check against an author — or a language model writing a file
 * for one — putting the answers in the wrong half of the step.
 *
 * This module is plain ESM JavaScript with JSDoc types, not TypeScript, for one
 * reason: `scripts/import-activities.mjs` is a plain Node CLI with no build
 * step and imports it directly, so the browser importer and the CLI importer
 * cannot drift apart. There is exactly one implementation of the split.
 * ======================================================================== */

/**
 * @typedef {Object} ImportIssue
 * @property {string} path   dotted path into the file, e.g. "activities[0].steps[1].key"
 * @property {string} message
 */

/**
 * @typedef {Object} ParsedStep
 * @property {string} id
 * @property {string} runner_id
 * @property {string} [title]
 * @property {number} [weight]
 * @property {Record<string, unknown>} config   PUBLIC. Goes into activities.steps.
 */

/**
 * @typedef {Object} ParsedActivity
 * @property {string} title
 * @property {string|null} topic
 * @property {string|null} description
 * @property {'private'|'school'|'public'} visibility
 * @property {Record<string, unknown>} shared_context
 * @property {ParsedStep[]} steps                 PUBLIC half
 * @property {Record<string, Record<string, unknown>>} keys   SECRET half, step_id -> key
 * @property {number|null} max_score
 */

/**
 * @typedef {Object} ParseResult
 * @property {boolean} ok
 * @property {ImportIssue[]} errors
 * @property {ImportIssue[]} warnings
 * @property {ParsedActivity[]} activities
 */

export const FORMAT_VERSION = 1;

const VISIBILITIES = ['private', 'school', 'public'];
const STEP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const RUNNER_ID_RE = /^[a-z0-9-]{2,40}$/;

/** Fields of a step that are allowed to reach `activities.steps`. */
const STEP_PUBLIC_FIELDS = ['id', 'runner_id', 'title', 'weight', 'config'];

/** Fields of a step that we know about but that must NOT be stored publicly. */
const STEP_SECRET_FIELDS = ['key'];

/**
 * Field names that only ever belong in a `key`. If one of these turns up inside
 * a `config`, the file is wrong and we refuse it rather than quietly publishing
 * the answers. Checked one level deep and inside arrays of objects, which is
 * where every realistic mistake lands (`config.questions[0].correct`).
 */
const KEY_SMELLS = ['correct', 'solution', 'distractors', 'answer', 'answers', 'explanation'];

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/* ---------------------------------------------------------------------------
 * The split. Everything else in this file is validation around it.
 * ------------------------------------------------------------------------ */

/**
 * Build the PUBLIC step (for `activities.steps`) and the SECRET key (for
 * `activity_keys.keys[stepId]`) out of one raw step from the file.
 *
 * @param {Record<string, unknown>} raw
 * @returns {{ step: ParsedStep, key: Record<string, unknown>, dropped: string[] }}
 */
export function splitStep(raw) {
  // ALLOW-LIST. Never `const step = {...raw}; delete step.key;`.
  /** @type {any} */
  const step = {
    id: String(raw.id),
    runner_id: String(raw.runner_id),
    config: isObject(raw.config) ? raw.config : {},
  };
  if (typeof raw.title === 'string' && raw.title.trim()) step.title = raw.title.trim();
  if (typeof raw.weight === 'number' && Number.isFinite(raw.weight)) step.weight = raw.weight;

  const key = isObject(raw.key) ? raw.key : {};

  // Anything the author wrote that we neither publish nor treat as a key is
  // dropped on the floor. Report it so a typo (`keys:` for `key:`) is visible
  // rather than silently discarded — a silently discarded key means an
  // activity that marks everyone zero.
  const dropped = Object.keys(raw).filter(
    (k) => !STEP_PUBLIC_FIELDS.includes(k) && !STEP_SECRET_FIELDS.includes(k),
  );

  return { step, key, dropped };
}

/**
 * Look for key-shaped fields hiding inside a public config.
 * @param {unknown} config
 * @returns {string[]} dotted paths, relative to `config`
 */
function findKeySmells(config) {
  /** @type {string[]} */
  const found = [];
  /** @param {unknown} node @param {string} path @param {number} depth */
  const walk = (node, path, depth) => {
    if (depth > 4) return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
      return;
    }
    if (!isObject(node)) return;
    for (const [k, v] of Object.entries(node)) {
      const here = path ? `${path}.${k}` : k;
      if (KEY_SMELLS.includes(k)) found.push(here);
      walk(v, here, depth + 1);
    }
  };
  walk(config, '', 0);
  return found;
}

/* ---------------------------------------------------------------------------
 * Per-runner validation. Adding a runner means adding a case here; a runner
 * with no case validates structurally only, which is deliberate — the whole
 * point of the runner registry is that new types do not need a portal change.
 * ------------------------------------------------------------------------ */

const CONVERSIONS = ['dec2bin', 'bin2dec', 'dec2hex', 'hex2dec', 'bin2hex', 'hex2bin'];

/**
 * @param {string} runnerId
 * @param {Record<string, unknown>} config
 * @param {Record<string, unknown>} key
 * @param {string} path
 * @param {ImportIssue[]} errors
 * @param {ImportIssue[]} warnings
 */
function validateRunnerStep(runnerId, config, key, path, errors, warnings) {
  const err = (p, m) => errors.push({ path: p, message: m });
  const warn = (p, m) => warnings.push({ path: p, message: m });

  if (runnerId === 'mcq') {
    const questions = /** @type {any[]} */ (config.questions);
    if (!Array.isArray(questions) || questions.length === 0) {
      err(`${path}.config.questions`, 'mcq needs a non-empty questions array.');
      return;
    }
    const seenQ = new Set();
    questions.forEach((q, qi) => {
      const qp = `${path}.config.questions[${qi}]`;
      if (!q || typeof q.id !== 'string' || !q.id) {
        err(`${qp}.id`, 'Every question needs a string id.');
        return;
      }
      if (seenQ.has(q.id)) err(`${qp}.id`, `Duplicate question id "${q.id}".`);
      seenQ.add(q.id);
      if (typeof q.stem !== 'string' || !q.stem.trim()) {
        err(`${qp}.stem`, 'Every question needs a stem.');
      }
      const options = q.options;
      if (!Array.isArray(options) || options.length < 2) {
        err(`${qp}.options`, 'A question needs at least two options.');
        return;
      }
      const seenO = new Set();
      options.forEach((o, oi) => {
        if (!o || typeof o.id !== 'string' || !o.id) {
          err(`${qp}.options[${oi}].id`, 'Every option needs a string id.');
          return;
        }
        if (seenO.has(o.id)) err(`${qp}.options[${oi}].id`, `Duplicate option id "${o.id}".`);
        seenO.add(o.id);
        if (typeof o.text !== 'string' || !o.text.length) {
          err(`${qp}.options[${oi}].text`, 'Every option needs text.');
        }
      });

      // The key half.
      const k = /** @type {any} */ (key)[q.id];
      if (!isObject(k)) {
        err(`${path}.key.${q.id}`, `No answer key for question "${q.id}".`);
        return;
      }
      const correct = k.correct;
      if (!Array.isArray(correct) || correct.length === 0) {
        // This is the single most common mistake in generated files.
        err(`${path}.key.${q.id}.correct`, 'correct must be a non-empty array of option ids.');
        return;
      }
      correct.forEach((id) => {
        if (!seenO.has(id)) {
          err(`${path}.key.${q.id}.correct`, `Option id "${id}" is not in this question's options.`);
        }
      });
      if (!q.multiple && correct.length > 1) {
        err(
          `${path}.key.${q.id}.correct`,
          'More than one correct answer for a single-answer question. Set "multiple": true.',
        );
      }
      if (k.marks !== undefined && (typeof k.marks !== 'number' || k.marks < 0)) {
        err(`${path}.key.${q.id}.marks`, 'marks must be a non-negative number.');
      }
      if (typeof k.explanation !== 'string' || !k.explanation.trim()) {
        warn(`${path}.key.${q.id}.explanation`, 'No explanation — students see nothing useful on review.');
      }
    });
    // Keys for questions that no longer exist are dead weight, and usually mean
    // a question id was renamed on one side only.
    Object.keys(key).forEach((kid) => {
      if (!seenQ.has(kid)) warn(`${path}.key.${kid}`, `Key for unknown question id "${kid}".`);
    });
    return;
  }

  if (runnerId === 'numbase') {
    const count = config.count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      err(`${path}.config.count`, 'count must be a positive integer.');
    }
    const conversions = config.conversions;
    if (!Array.isArray(conversions) || conversions.length === 0) {
      err(`${path}.config.conversions`, 'conversions must be a non-empty array.');
    } else {
      conversions.forEach((c, i) => {
        if (!CONVERSIONS.includes(/** @type {string} */ (c))) {
          err(
            `${path}.config.conversions[${i}]`,
            `Unknown conversion "${c}". Known: ${CONVERSIONS.join(', ')}.`,
          );
        }
      });
    }
    const min = config.minValue;
    const max = config.maxValue;
    if (typeof min === 'number' && typeof max === 'number' && min >= max) {
      err(`${path}.config`, 'minValue must be less than maxValue.');
    }
    if (Object.keys(key).length > 0) {
      // numbase questions are regenerated from attempts.seed at marking time.
      warn(`${path}.key`, 'numbase is generated and has no key; this one is ignored.');
    }
    return;
  }

  if (runnerId === 'parsons') {
    const lines = /** @type {any[]} */ (config.lines);
    if (!Array.isArray(lines) || lines.length === 0) {
      err(`${path}.config.lines`, 'parsons needs a non-empty lines array.');
      return;
    }
    const lineIds = new Set();
    lines.forEach((l, i) => {
      if (!l || typeof l.id !== 'string' || !l.id) {
        err(`${path}.config.lines[${i}].id`, 'Every line needs a string id.');
        return;
      }
      if (lineIds.has(l.id)) err(`${path}.config.lines[${i}].id`, `Duplicate line id "${l.id}".`);
      lineIds.add(l.id);
      if (typeof l.text !== 'string') {
        err(`${path}.config.lines[${i}].text`, 'Every line needs text.');
      }
    });

    const solution = /** @type {any[]} */ (key.solution);
    if (!Array.isArray(solution) || solution.length === 0) {
      err(`${path}.key.solution`, 'parsons needs a non-empty solution array in the key.');
      return;
    }
    const solutionIds = new Set();
    solution.forEach((s, i) => {
      const sp = `${path}.key.solution[${i}]`;
      if (!s || typeof s.id !== 'string') {
        err(`${sp}.id`, 'Every solution entry needs an id.');
        return;
      }
      if (!lineIds.has(s.id)) err(`${sp}.id`, `Solution references "${s.id}", which is not in config.lines.`);
      if (solutionIds.has(s.id)) err(`${sp}.id`, `Line "${s.id}" appears twice in the solution.`);
      solutionIds.add(s.id);
      if (s.indent !== undefined && (typeof s.indent !== 'number' || s.indent < 0)) {
        err(`${sp}.indent`, 'indent must be a non-negative number.');
      }
    });

    const declared = key.distractors;
    if (declared !== undefined) {
      if (!Array.isArray(declared)) {
        err(`${path}.key.distractors`, 'distractors must be an array of line ids.');
      } else {
        declared.forEach((id, i) => {
          if (!lineIds.has(id)) {
            err(`${path}.key.distractors[${i}]`, `"${id}" is not in config.lines.`);
          } else if (solutionIds.has(/** @type {string} */ (id))) {
            err(`${path}.key.distractors[${i}]`, `"${id}" is in the solution and cannot be a distractor.`);
          }
        });
        // Any line not in the solution IS a distractor whether declared or not.
        // Flag undeclared ones so an accidental omission from `solution` shows up.
        const undeclared = [...lineIds].filter(
          (id) => !solutionIds.has(id) && !declared.includes(id),
        );
        if (undeclared.length) {
          warn(
            `${path}.key.distractors`,
            `Not in the solution and not declared as distractors, so they will act as distractors: ${undeclared.join(', ')}.`,
          );
        }
      }
    }
    if (key.marks !== undefined && (typeof key.marks !== 'number' || key.marks < 0)) {
      err(`${path}.key.marks`, 'marks must be a non-negative number.');
    }
    if (key.distractorPenalty !== undefined && typeof key.distractorPenalty !== 'number') {
      err(`${path}.key.distractorPenalty`, 'distractorPenalty must be a number.');
    }
    return;
  }

  // Unknown runner: structural checks only. It may well be a school-registered
  // runner this build has never heard of, which is the point of the registry.
  warn(
    `${path}.runner_id`,
    `No import-time validation for runner "${runnerId}". Its config and key are stored as written.`,
  );
}

/* ---------------------------------------------------------------------------
 * Top level
 * ------------------------------------------------------------------------ */

/**
 * Validate an activity file and split every step into its public and secret
 * halves. Does not touch the database.
 *
 * @param {unknown} raw   parsed JSON
 * @returns {ParseResult}
 */
export function parseActivityFile(raw) {
  /** @type {ImportIssue[]} */ const errors = [];
  /** @type {ImportIssue[]} */ const warnings = [];
  /** @type {ParsedActivity[]} */ const activities = [];
  const err = (p, m) => errors.push({ path: p, message: m });
  const warn = (p, m) => warnings.push({ path: p, message: m });

  if (!isObject(raw)) {
    err('', 'The file must contain a JSON object.');
    return { ok: false, errors, warnings, activities };
  }
  if (raw.nybble !== FORMAT_VERSION) {
    err(
      'nybble',
      `Expected "nybble": ${FORMAT_VERSION}. Found ${JSON.stringify(raw.nybble)}. ` +
        'This importer only understands format version 1.',
    );
    return { ok: false, errors, warnings, activities };
  }
  const list = raw.activities;
  if (!Array.isArray(list) || list.length === 0) {
    err('activities', 'The file needs a non-empty "activities" array.');
    return { ok: false, errors, warnings, activities };
  }

  /** Titles seen in THIS file — a duplicate would upsert onto itself twice. */
  const seenTitles = new Set();

  list.forEach((a, ai) => {
    const path = `activities[${ai}]`;
    if (!isObject(a)) {
      err(path, 'Each activity must be an object.');
      return;
    }
    const title = typeof a.title === 'string' ? a.title.trim() : '';
    if (!title) {
      err(`${path}.title`, 'An activity needs a title — it is half the identity used for upserts.');
      return;
    }
    const topic = typeof a.topic === 'string' && a.topic.trim() ? a.topic.trim() : null;

    const identity = `${title} ${topic ?? ''}`;
    if (seenTitles.has(identity)) {
      err(
        `${path}.title`,
        `Two activities in this file share the title "${title}" and topic ${JSON.stringify(topic)}. ` +
          'Upserts match on that pair, so one would overwrite the other.',
      );
    }
    seenTitles.add(identity);

    let visibility = 'private';
    if (a.visibility !== undefined) {
      if (typeof a.visibility !== 'string' || !VISIBILITIES.includes(a.visibility)) {
        err(`${path}.visibility`, `visibility must be one of ${VISIBILITIES.join(', ')}.`);
      } else {
        visibility = a.visibility;
      }
    }

    if (a.shared_context !== undefined && !isObject(a.shared_context)) {
      err(`${path}.shared_context`, 'shared_context must be an object.');
    }

    const rawSteps = a.steps;
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
      err(`${path}.steps`, 'An activity needs at least one step.');
      return;
    }

    /** @type {ParsedStep[]} */ const steps = [];
    /** @type {Record<string, Record<string, unknown>>} */ const keys = {};
    const seenStepIds = new Set();

    rawSteps.forEach((s, si) => {
      const sp = `${path}.steps[${si}]`;
      if (!isObject(s)) {
        err(sp, 'Each step must be an object.');
        return;
      }
      if (typeof s.id !== 'string' || !STEP_ID_RE.test(s.id)) {
        err(`${sp}.id`, 'A step needs an id of letters, numbers, dashes or underscores.');
        return;
      }
      if (seenStepIds.has(s.id)) {
        err(`${sp}.id`, `Duplicate step id "${s.id}" within this activity.`);
        return;
      }
      seenStepIds.add(s.id);

      if (typeof s.runner_id !== 'string' || !RUNNER_ID_RE.test(s.runner_id)) {
        err(`${sp}.runner_id`, 'A step needs a runner_id like "mcq" or "parsons".');
        return;
      }
      if (s.config !== undefined && !isObject(s.config)) {
        err(`${sp}.config`, 'config must be an object.');
        return;
      }
      if (s.key !== undefined && !isObject(s.key)) {
        err(`${sp}.key`, 'key must be an object.');
        return;
      }
      if (s.weight !== undefined && (typeof s.weight !== 'number' || s.weight < 0)) {
        err(`${sp}.weight`, 'weight must be a non-negative number.');
      }

      const { step, key, dropped } = splitStep(s);

      if (dropped.length) {
        warn(
          sp,
          `Unrecognised field(s) dropped: ${dropped.join(', ')}. ` +
            'Answers belong under "key"; everything a student may see belongs under "config".',
        );
      }

      // Refuse to publish a config that looks like it contains answers.
      const smells = findKeySmells(step.config);
      if (smells.length) {
        err(
          `${sp}.config`,
          `Looks like answer data in the PUBLIC half: ${smells.join(', ')}. ` +
            'Anything under config is sent to the student\'s browser. Move it under "key".',
        );
      }

      validateRunnerStep(step.runner_id, step.config, key, sp, errors, warnings);

      steps.push(step);
      if (Object.keys(key).length) keys[step.id] = key;
    });

    let maxScore = null;
    if (a.max_score !== undefined && a.max_score !== null) {
      if (typeof a.max_score !== 'number' || a.max_score < 0) {
        err(`${path}.max_score`, 'max_score must be a non-negative number.');
      } else {
        maxScore = a.max_score;
      }
    }

    activities.push({
      title,
      topic,
      description:
        typeof a.description === 'string' && a.description.trim() ? a.description.trim() : null,
      visibility: /** @type {'private'|'school'|'public'} */ (visibility),
      shared_context: isObject(a.shared_context) ? a.shared_context : {},
      steps,
      keys,
      max_score: maxScore,
    });
  });

  return { ok: errors.length === 0, errors, warnings, activities };
}

/**
 * Last line of defence, called immediately before the write.
 *
 * If this ever throws, the split above has a hole in it and answers were about
 * to be written to a table students can read. Cheap, and it means a future edit
 * to splitStep() cannot quietly break the guarantee.
 *
 * @param {ParsedStep[]} steps
 */
export function assertNoKeysInPublicSteps(steps) {
  for (const step of steps) {
    for (const field of Object.keys(step)) {
      if (!STEP_PUBLIC_FIELDS.includes(field)) {
        throw new Error(
          `Refusing to write step "${step.id}": unexpected field "${field}" in the public half.`,
        );
      }
    }
    const smells = findKeySmells(step.config);
    if (smells.length) {
      throw new Error(
        `Refusing to write step "${step.id}": answer-shaped fields in public config (${smells.join(', ')}).`,
      );
    }
  }
}
