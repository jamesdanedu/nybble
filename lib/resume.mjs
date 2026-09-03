/* ===========================================================================
 * resume.mjs — which step a returning student should land on.
 *
 * Pure, and separate from the component, because the rule is fiddly enough to
 * be worth testing and has nothing to do with React.
 * ======================================================================== */

/**
 * The step to open when an attempt is resumed.
 *
 * The old rule was "the first step with no response", which sounds right and is
 * wrong in the case that actually happens: a student works through four steps
 * without submitting any of them, closes the laptop, comes back — and is put
 * back on step 1, with their drafts sitting on steps 2, 3 and 4 where they
 * cannot see them. It looks exactly like the work was lost.
 *
 * So drafts count as progress. `step_state` is written continuously by the
 * autosave, and its keys are the steps the student has actually touched.
 *
 * The rule:
 *
 *   nothing touched          step 1
 *   furthest step is a draft resume there — it is where they were working
 *   furthest step is answered move on to the next unanswered step after it
 *   everything answered      the last step, ready to finish
 *
 * Earlier unanswered steps stay reachable by clicking back; the tab strip only
 * blocks skipping FORWARD past something unanswered, which is what keeps a
 * PRIMM sequence in order.
 *
 * @param {{id: string}[]} steps            the activity's steps, in order
 * @param {Record<string, unknown>} responses  attempt.step_responses
 * @param {Record<string, unknown>} state      attempt.step_state
 * @returns {number} an index into `steps`
 */
export function resumeIndex(steps, responses, state) {
  if (!Array.isArray(steps) || steps.length === 0) return 0;

  const done = new Set(Object.keys(responses ?? {}));
  const drafted = new Set(Object.keys(state ?? {}));

  let furthest = -1;
  steps.forEach((s, i) => {
    if (done.has(s.id) || drafted.has(s.id)) furthest = i;
  });

  if (furthest === -1) return 0;

  // A draft with no response: this is the step they were in the middle of.
  if (!done.has(steps[furthest].id)) return furthest;

  // Answered, so the next thing to do is whatever follows it.
  const next = steps.findIndex((s, i) => i > furthest && !done.has(s.id));
  return next === -1 ? steps.length - 1 : next;
}
