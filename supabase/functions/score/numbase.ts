// ⚠ KEEP IN SYNC with public/runners/lib/numbase-gen.js
// The scorer regenerates the question set from the attempt seed and compares it
// against what the student was shown. If they differ, the step is flagged
// `needs_review` instead of being mismarked — so drift here surfaces loudly.

export interface NumbaseQuestion {
  id: string;
  kind: string;
  label: string;
  fromBase: number;
  toBase: number;
  fromName: string;
  toName: string;
  prompt: string;
  value: number;
  marks: number;
}

function mulberry32(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS: Record<string, { from: number; to: number; label: string }> = {
  dec2bin: { from: 10, to: 2,  label: 'Decimal → Binary' },
  bin2dec: { from: 2,  to: 10, label: 'Binary → Decimal' },
  dec2hex: { from: 10, to: 16, label: 'Decimal → Hex' },
  hex2dec: { from: 16, to: 10, label: 'Hex → Decimal' },
  bin2hex: { from: 2,  to: 16, label: 'Binary → Hex' },
  hex2bin: { from: 16, to: 2,  label: 'Hex → Binary' },
};

const BASE_NAME: Record<number, string> = { 2: 'binary', 10: 'decimal', 16: 'hexadecimal' };

export function show(value: number, base: number, padBinary: boolean): string {
  let s = value.toString(base).toUpperCase();
  if (base === 2 && padBinary) {
    const width = Math.ceil(Math.max(s.length, 4) / 4) * 4;
    while (s.length < width) s = '0' + s;
  }
  return s;
}

export function normalise(answer: unknown, base: number): string {
  let s = String(answer ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (base === 16) s = s.replace(/^0X/, '').replace(/^#/, '');
  if (base === 2)  s = s.replace(/^0B/, '');
  return s.replace(/^0+(?=.)/, '');
}

const VALID: Record<number, RegExp> = { 2: /^[01]+$/, 10: /^\d+$/, 16: /^[0-9A-F]+$/ };

export function isWellFormed(answer: unknown, base: number): boolean {
  const s = normalise(answer, base);
  return s.length > 0 && VALID[base].test(s);
}

export function generate(config: Record<string, any>, seed: number): NumbaseQuestion[] {
  const cfg = config ?? {};
  let kinds: string[] = (cfg.conversions?.length ? cfg.conversions : null)
    ?.filter((k: string) => KINDS[k]) ?? ['dec2bin', 'bin2dec', 'dec2hex', 'hex2dec'];
  if (!kinds.length) kinds = ['dec2bin'];

  const count = Math.max(1, Math.min(100, cfg.count ?? 10));
  const min = Math.max(0, cfg.minValue ?? 1);
  const max = Math.max(min, cfg.maxValue ?? 255);
  const pad = cfg.padBinary !== false;

  const rnd = mulberry32(seed);
  const out: NumbaseQuestion[] = [];
  const seen = new Set<string>();
  let guard = 0;

  while (out.length < count && guard++ < count * 60) {
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    const value = min + Math.floor(rnd() * (max - min + 1));
    const key = `${kind}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const spec = KINDS[kind];
    out.push({
      id: `n${out.length}`,
      kind,
      label: spec.label,
      fromBase: spec.from,
      toBase: spec.to,
      fromName: BASE_NAME[spec.from],
      toName: BASE_NAME[spec.to],
      prompt: show(value, spec.from, pad),
      value,
      marks: cfg.marksPerQuestion ?? 1,
    });
  }
  return out;
}

export function expected(q: NumbaseQuestion): string {
  return show(q.value, q.toBase, false);
}

export interface StepScore {
  total: number;
  max: number;
  needsReview?: boolean;
  note?: string;
  elapsedSecs?: number;
  perQuestion: Record<string, {
    correct: boolean; awarded: number; marks: number;
    given: string; expected: string;
  }>;
}

/**
 * @param config  the PUBLIC step config (question generation is fully described by it)
 * @param seed    attempts.seed
 * @param response what the runner submitted
 */
export function score(
  config: Record<string, any>,
  seed: number,
  response: Record<string, any>,
): StepScore {
  const questions = generate(config, seed);
  const answers: Record<string, string> = response?.answers ?? {};
  const perQuestion: StepScore['perQuestion'] = {};
  let total = 0, max = 0;

  // Integrity check: did the student see the set this seed produces?
  const shown = Array.isArray(response?.questions) ? response.questions : null;
  let mismatch = false;
  if (shown) {
    mismatch = shown.length !== questions.length || shown.some((s: any, i: number) =>
      s?.id !== questions[i].id || s?.value !== questions[i].value || s?.kind !== questions[i].kind);
  }

  for (const q of questions) {
    const marks = q.marks ?? 1;
    max += marks;
    const given = String(answers[q.id] ?? '');
    const exp = expected(q);
    const correct = isWellFormed(given, q.toBase) &&
                    normalise(given, q.toBase) === normalise(exp, q.toBase);
    const awarded = correct ? marks : 0;
    total += awarded;
    perQuestion[q.id] = { correct, awarded, marks, given, expected: exp };
  }

  return {
    total, max, perQuestion,
    elapsedSecs: typeof response?.elapsedSecs === 'number' ? response.elapsedSecs : undefined,
    ...(mismatch
      ? { needsReview: true, note: 'Submitted question set does not match the seed — generator drift or tampering. Marked provisionally.' }
      : {}),
  };
}
