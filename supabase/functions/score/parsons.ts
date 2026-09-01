// Parsons problem scorer. The key lives in activity_keys and is only ever read
// here — the runner is told nothing but `config.lines`, so it cannot know which
// lines are distractors or what the correct order is.
//
// ⚠ NOT YET WIRED INTO THE DISPATCH. Add exactly one import and one case to
// supabase/functions/score/index.ts:
//
//     import * as parsons from './parsons.ts';
//     ...
//     case 'parsons':
//       stepScore = parsons.score(step.config ?? {}, stepKey, response as any);
//       break;
//
// key shape (see docs/activity-format.md):
//   {
//     "solution": [{ "id": "l1", "indent": 0 }, ...],
//     "distractors": ["d1", "d2"],   // advisory: the importer validates against it
//     "marks": 5,
//     "partial": true,
//     "distractorPenalty": 0.5,
//     "explanation": "..."
//   }
//
// response shape:
//   { "arrangement": [{ "id": "l1", "indent": 0 }, ...], "unused": ["d1"] }

/**
 * How the marks split between getting the lines in the right order and getting
 * the indentation right. A judgement call, not a law — LCCS students lose more
 * marks to indentation than to ordering, so raising INDENT_WEIGHT is
 * defensible. They must sum to 1.
 */
const ORDER_WEIGHT = 0.7;
const INDENT_WEIGHT = 0.3;

export interface SolutionLine {
  id: string;
  indent: number;
}

export interface ParsonsKey {
  solution?: SolutionLine[];
  distractors?: string[];
  marks?: number;
  partial?: boolean;
  distractorPenalty?: number;
  explanation?: string;
}

export interface ParsonsResponse {
  arrangement?: { id: string; indent?: number }[];
  unused?: string[];
}

export interface ParsonsLineScore {
  id: string;
  indent: number;
  /** Not part of any correct solution. */
  distractor: boolean;
  /** Landed in the longest common subsequence — i.e. correctly ordered. */
  inSequence: boolean;
  /** Only meaningful when inSequence. */
  indentOk: boolean;
  /** What the key wanted, or null for a distractor. */
  expectedIndent: number | null;
}

export interface StepScore {
  total: number;
  max: number;
  exact: boolean;
  orderScore: number;
  indentScore: number;
  /** Ids used that belong in no correct solution. */
  distractorsUsed: string[];
  /** Solution ids the student never placed. */
  missing: string[];
  /** Parallel to response.arrangement, so the runner can mark it up in place. */
  perLine: ParsonsLineScore[];
  /** The key's arrangement, shown in review mode. */
  solution: SolutionLine[];
  explanation?: string;
}

/**
 * Longest common subsequence, returning the matched INDEX PAIRS rather than
 * just a length — the pairs are what tell us which of the student's lines are
 * correctly ordered, and which solution line each of them corresponds to (so
 * the indent can be compared against the right one).
 *
 * LCS rather than a position-by-position comparison because one missing line at
 * the top should not zero every line below it.
 *
 * dp[i][j] = LCS length of a[i..] and b[j..]; the walk forward from (0,0)
 * reconstructs one optimal alignment. O(n·m) on inputs of a dozen lines.
 */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * @param config  the PUBLIC step config — only used to bound indents
 * @param key     the secret key from activity_keys
 * @param response what the runner submitted
 */
export function score(
  config: Record<string, any>,
  key: ParsonsKey,
  response: ParsonsResponse,
): StepScore {
  const maxIndent = Number.isFinite(config?.maxIndent) ? Number(config.maxIndent) : 12;
  const clamp = (n: unknown) =>
    Math.max(0, Math.min(maxIndent, Math.round(Number(n) || 0)));

  const solution: SolutionLine[] = (Array.isArray(key?.solution) ? key.solution : [])
    .filter((s) => s && s.id != null)
    .map((s) => ({ id: String(s.id), indent: clamp(s.indent) }));

  const arrangement = (Array.isArray(response?.arrangement) ? response.arrangement : [])
    .filter((a) => a && a.id != null)
    .map((a) => ({ id: String(a.id), indent: clamp(a.indent) }));

  const marks = typeof key?.marks === 'number' ? key.marks : solution.length;
  const partial = key?.partial === true;
  const penalty = typeof key?.distractorPenalty === 'number' ? key.distractorPenalty : 0;

  const solIds = solution.map((s) => s.id);
  const givenIds = arrangement.map((a) => a.id);
  const inSolution = new Set(solIds);

  // 1. Order — how much of the solution survives as a subsequence of what the
  //    student built.
  const pairs = lcsPairs(givenIds, solIds);
  const orderScore = solIds.length ? pairs.length / solIds.length : 0;

  // 2. Indentation — of the lines that landed in that common subsequence, the
  //    fraction whose indent matches the solution's.
  let indentMatches = 0;
  const solutionIndexOf = new Map<number, number>();   // arrangement idx -> solution idx
  for (const [gi, si] of pairs) {
    solutionIndexOf.set(gi, si);
    if (arrangement[gi].indent === solution[si].indent) indentMatches++;
  }
  const indentScore = pairs.length ? indentMatches / pairs.length : 0;

  // A distractor is anything used that the solution does not contain, whether
  // or not the author remembered to list it in `distractors`.
  const distractorsUsed = givenIds.filter((id) => !inSolution.has(id));
  const usedIds = new Set(givenIds);
  const missing = solIds.filter((id) => !usedIds.has(id));

  const exact = givenIds.length === solIds.length &&
    arrangement.every((a, i) => a.id === solution[i].id && a.indent === solution[i].indent) &&
    solIds.length > 0;

  // 3. Combine, 4. dock the distractors, 5. floor at zero. Full marks only on
  //    an exact match of both order and indentation.
  let total: number;
  if (exact) {
    total = marks;
  } else if (!partial) {
    total = 0;                                   // all-or-nothing unless partial
  } else {
    const raw = marks * (ORDER_WEIGHT * orderScore + INDENT_WEIGHT * indentScore);
    total = Math.max(0, raw - penalty * distractorsUsed.length);
  }

  const perLine: ParsonsLineScore[] = arrangement.map((a, i) => {
    const si = solutionIndexOf.get(i);
    const distractor = !inSolution.has(a.id);
    const keyLine = solution.find((s) => s.id === a.id);
    return {
      id: a.id,
      indent: a.indent,
      distractor,
      inSequence: si !== undefined,
      indentOk: si !== undefined && arrangement[i].indent === solution[si].indent,
      expectedIndent: distractor ? null : (keyLine ? keyLine.indent : null),
    };
  });

  return {
    total: round2(total),
    max: marks,
    exact,
    orderScore: round2(orderScore),
    indentScore: round2(indentScore),
    distractorsUsed,
    missing,
    perLine,
    solution,
    explanation: key?.explanation,
  };
}
