/* Is a school licensed today?
 *
 * Run:  node test/licensing.test.mjs
 *
 * No database. lib/licensing.mjs is the portal's description of what
 * school_licensed() in supabase/migrations/0011_customers.sql enforces, and
 * the last check here reads that migration to make sure the two agree on the
 * grace period — the one number that, if it drifted, would have a banner
 * saying "read-only from Monday" while the database still accepted work, or
 * the reverse.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { GRACE_DAYS, licence } from '../lib/licensing.mjs';

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { failures++; console.log(`✗ ${name}\n    ${e.message}`); }
}

const TODAY = '2026-09-05';
const row = (status, period_start, period_end = null) => ({ status, period_start, period_end });

check('no subscriptions at all: none, not licensed', () => {
  const v = licence([], TODAY);
  assert.strictEqual(v.state, 'none');
  assert.strictEqual(v.licensed, false);
  assert.strictEqual(v.next, null);
});

check('complimentary is open-ended and never counts down', () => {
  const v = licence([row('complimentary', '2025-01-01')], TODAY);
  assert.strictEqual(v.state, 'complimentary');
  assert.strictEqual(v.licensed, true);
  assert.strictEqual(v.endsOn, null);
  assert.strictEqual(v.daysLeft, null);
});

check('an active period covering today reports the days left', () => {
  const v = licence([row('active', '2025-09-01', '2026-08-31')], '2026-08-01');
  assert.strictEqual(v.state, 'active');
  assert.strictEqual(v.licensed, true);
  assert.strictEqual(v.endsOn, '2026-08-31');
  assert.strictEqual(v.daysLeft, 30);
  assert.strictEqual(v.graceEndsOn, '2026-10-30');
});

check('a trial is reported as a trial, not as active', () => {
  assert.strictEqual(licence([row('trial', '2026-09-01', '2026-12-20')], TODAY).state, 'trial');
});

check('the last day of the period is still licensed', () => {
  const v = licence([row('active', '2025-09-01', '2026-09-05')], TODAY);
  assert.strictEqual(v.state, 'active');
  assert.strictEqual(v.daysLeft, 0);
});

check('the day after the period ends is grace: still licensed, days left negative', () => {
  const v = licence([row('active', '2025-09-01', '2026-09-04')], TODAY);
  assert.strictEqual(v.state, 'grace');
  assert.strictEqual(v.licensed, true);
  assert.strictEqual(v.daysLeft, -1);
  assert.strictEqual(v.endsOn, '2026-09-04');
});

check('exactly GRACE_DAYS after the end is the last licensed day', () => {
  // Mirrors the SQL: period_end + interval '60 days' >= current_date.
  const v = licence([row('active', '2025-09-01', '2026-07-07')], TODAY); // 60 days before 5 Sept
  assert.strictEqual(v.state, 'grace');
  assert.strictEqual(v.licensed, true);
  assert.strictEqual(v.graceEndsOn, TODAY);
});

check('one day past the grace period is lapsed', () => {
  const v = licence([row('active', '2025-09-01', '2026-07-06')], TODAY);
  assert.strictEqual(v.state, 'lapsed');
  assert.strictEqual(v.licensed, false);
  assert.strictEqual(v.endsOn, '2026-07-06');
});

check('a cancelled row licenses nothing, even if its dates cover today', () => {
  const v = licence([row('cancelled', '2025-09-01', '2027-08-31')], TODAY);
  assert.strictEqual(v.state, 'none');
  assert.strictEqual(v.licensed, false);
});

check('a period that has not started yet does not license, but is reported as next', () => {
  const v = licence([row('active', '2026-10-01', '2027-08-31')], TODAY);
  assert.strictEqual(v.state, 'none');
  assert.strictEqual(v.licensed, false);
  assert.strictEqual(v.next, '2026-10-01');
});

check('a period starting today counts', () => {
  assert.strictEqual(licence([row('active', TODAY, '2027-08-31')], TODAY).state, 'active');
});

check('a renewal already in the book: this year decides, next year is `next`', () => {
  const v = licence(
    [row('active', '2025-09-01', '2026-09-15'), row('active', '2026-09-16', '2027-08-31')],
    TODAY,
  );
  assert.strictEqual(v.state, 'active');
  assert.strictEqual(v.daysLeft, 10);
  assert.strictEqual(v.next, '2026-09-16');
});

check('overlapping periods: the one that runs longest decides', () => {
  const v = licence(
    [row('trial', '2026-09-01', '2026-09-30'), row('active', '2026-09-01', '2027-08-31')],
    TODAY,
  );
  assert.strictEqual(v.state, 'active');
  assert.strictEqual(v.endsOn, '2027-08-31');
});

check('an open-ended row beats a dated one that also covers today', () => {
  const v = licence(
    [row('complimentary', '2025-01-01'), row('active', '2026-09-01', '2027-08-31')],
    TODAY,
  );
  assert.strictEqual(v.state, 'complimentary');
});

check('after a lapse, the most recent ending is the one reported', () => {
  const v = licence(
    [row('active', '2023-09-01', '2024-08-31'), row('active', '2024-09-01', '2025-08-31')],
    TODAY,
  );
  assert.strictEqual(v.state, 'lapsed');
  assert.strictEqual(v.endsOn, '2025-08-31');
});

check('a malformed today is refused rather than silently unlicensed', () => {
  assert.throws(() => licence([], 'yesterday'), /YYYY-MM-DD/);
});

check('the grace period matches the SQL that enforces it', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0011_customers.sql', import.meta.url), 'utf8');
  const m = /period_end \+ interval '(\d+) days'/.exec(sql);
  assert.ok(m, 'school_licensed() no longer adds an interval to period_end — update this test and lib/licensing.mjs together');
  assert.strictEqual(Number(m[1]), GRACE_DAYS);
});

if (failures) {
  console.log(`\n✗ ${failures} check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
