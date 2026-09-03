import type { ActivityStep } from '@/lib/types';

/**
 * The responses to the steps BEFORE `index`, keyed by step id — what a runner
 * receives as `context.prior`, alongside `config` and `state`.
 *
 * PRIMM is the reason it exists. Make has to be able to quote the student's own
 * Predict answer back at them, and until this every step was amnesiac: a runner
 * could see the shared code snippet but never what the student had already said
 * about it.
 *
 * Three rules, all deliberate:
 *
 *   - **Responses only, never scores.** A score may be withheld until a teacher
 *     releases feedback (`step-review.tsx` passes `score: null` until then), and
 *     putting one in `context` would route around that.
 *   - **Earlier steps only.** A step never sees ahead of itself — the same rule
 *     the step buttons enforce for navigation, and the reason Predict cannot be
 *     answered by reading Investigate.
 *   - **Answered steps only.** An unanswered earlier step is absent rather than
 *     present-and-empty, so a runner can tell "not done" from "left blank".
 *
 * This adds no trust surface: these are the student's own answers, already in
 * their own browser. No key material passes through here, and nothing a runner
 * does with them is believed by the scorer.
 */
export function priorResponses(
  steps: ActivityStep[],
  index: number,
  responses: Record<string, unknown>,
): Record<string, unknown> {
  const prior: Record<string, unknown> = {};
  for (let i = 0; i < index; i++) {
    const step = steps[i];
    if (step && responses[step.id] !== undefined) prior[step.id] = responses[step.id];
  }
  return prior;
}
