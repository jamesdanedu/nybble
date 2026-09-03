/* Where does a resumed attempt open?
 *
 * Run:  node test/resume.test.mjs
 *
 * The case that prompted this: a student worked through several Parsons steps
 * without submitting any of them, reloaded, and was dropped back on step 1 —
 * with their drafts sitting on later steps where nothing showed them. It reads
 * as lost work even though every keystroke was safely in step_state.
 */
import assert from 'node:assert';
import { resumeIndex } from '../lib/resume.mjs';

const steps = ['s1', 's2', 's3', 's4'].map((id) => ({ id }));
const set = (...ids) => Object.fromEntries(ids.map((id) => [id, {}]));

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { failures++; console.log(`✗ ${name}\n    ${e.message}`); }
}

check('a fresh attempt opens on the first step', () => {
  assert.strictEqual(resumeIndex(steps, {}, {}), 0);
});

check('drafts with no submissions resume at the furthest draft', () => {
  // The reported bug: this used to return 0.
  assert.strictEqual(resumeIndex(steps, {}, set('s1', 's2', 's3')), 2);
});

check('a draft on a later step wins over answered earlier ones', () => {
  assert.strictEqual(resumeIndex(steps, set('s1'), set('s1', 's2')), 1);
});

check('all answered so far, nothing drafted: the next unanswered step', () => {
  assert.strictEqual(resumeIndex(steps, set('s1', 's2'), {}), 2);
});

check('everything answered lands on the last step, ready to finish', () => {
  assert.strictEqual(resumeIndex(steps, set('s1', 's2', 's3', 's4'), {}), 3);
});

check('a draft on an already-answered step moves on rather than back', () => {
  // step_state is not cleared on submit, so the furthest touched step is very
  // often one that is also answered. Reopening it would show a read-only step
  // and look like the attempt was stuck.
  assert.strictEqual(resumeIndex(steps, set('s1', 's2'), set('s1', 's2')), 2);
});

check('a stale draft for a step that no longer exists is ignored', () => {
  assert.strictEqual(resumeIndex(steps, {}, set('removed-step')), 0);
});

check('gaps do not send the student backwards', () => {
  // s1 unanswered, s3 answered: land after s3 rather than reopening the gap.
  // The tab strip still lets them click back to s1.
  assert.strictEqual(resumeIndex(steps, set('s3'), {}), 3);
});

check('no steps at all does not throw', () => {
  assert.strictEqual(resumeIndex([], {}, {}), 0);
  assert.strictEqual(resumeIndex(undefined, {}, {}), 0);
});

check('null responses and state are treated as empty', () => {
  assert.strictEqual(resumeIndex(steps, null, null), 0);
});

if (failures) {
  console.log(`\n✗ ${failures} check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
