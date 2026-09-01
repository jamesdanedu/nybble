// MCQ scorer. The key lives in activity_keys and is only ever read here.
//
// key shape:
//   { "q1": { "correct": ["b"], "marks": 1, "explanation": "...",
//             "partial": true } }
//
// `partial` (multi-answer only): award marks pro-rata for correct selections
// minus incorrect ones, floored at zero. Default is all-or-nothing.

export interface StepScore {
  total: number;
  max: number;
  perQuestion: Record<string, {
    correct: boolean; awarded: number; marks: number;
    chosen: string[]; correctIds: string[]; explanation?: string;
  }>;
}

export function score(
  config: Record<string, any>,
  key: Record<string, any>,
  response: Record<string, any>,
): StepScore {
  const questions: any[] = config?.questions ?? [];
  const answers: Record<string, string[]> = response?.answers ?? {};
  const perQuestion: StepScore['perQuestion'] = {};
  let total = 0, max = 0;

  for (const q of questions) {
    const k = key?.[q.id] ?? {};
    const marks: number = k.marks ?? q.marks ?? 1;
    max += marks;

    const correctIds: string[] = Array.isArray(k.correct) ? k.correct : [];
    const chosen: string[] = Array.isArray(answers[q.id]) ? answers[q.id] : [];

    const hits = chosen.filter((c) => correctIds.includes(c)).length;
    const misses = chosen.filter((c) => !correctIds.includes(c)).length;
    const exact = hits === correctIds.length && misses === 0 && correctIds.length > 0;

    let awarded = 0;
    if (exact) {
      awarded = marks;
    } else if (k.partial && q.multiple && correctIds.length > 0) {
      awarded = Math.max(0, Math.round(((hits - misses) / correctIds.length) * marks * 100) / 100);
    }
    total += awarded;

    perQuestion[q.id] = {
      correct: exact,
      awarded,
      marks,
      chosen,
      correctIds,
      explanation: k.explanation,
    };
  }

  return { total, max, perQuestion };
}
