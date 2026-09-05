/* ===========================================================================
 * licensing.mjs — is a school licensed today, and for how much longer?
 *
 * The same question `school_licensed()` answers in SQL (see
 * supabase/migrations/0011_customers.sql), asked from the portal so that a
 * banner can say "ends on the 31st" or "read-only until renewed" without a
 * second round trip. The SQL is what actually stops an insert; this only
 * describes. Keep the two in step — the test checks that GRACE_DAYS here
 * matches the interval in the migration, so a change to one without the other
 * fails loudly rather than drifting.
 *
 * Pure, no database: rows in, a verdict out. Dates are 'YYYY-MM-DD' strings
 * as PostgREST returns a `date` column, and "today" is a date string too,
 * because the question is about calendar days, not instants, and a school in
 * Dublin renewing on the 31st should not lapse an hour early because the
 * server is in Frankfurt.
 * ======================================================================== */

/** Days after period_end during which a school is still licensed. */
export const GRACE_DAYS = 60;

/** A calendar date as a whole number of days, so subtraction means days. */
function dayOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

function isoOf(day) {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

/** Today, as 'YYYY-MM-DD' in UTC. Pass an explicit date to `licence` in tests. */
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The licence state of a school, from its subscription rows.
 *
 *   state      one of
 *                'complimentary'  open-ended, never expires
 *                'active'         a paid period covers today
 *                'trial'          a trial period covers today
 *                'grace'          the latest period has ended, within GRACE_DAYS
 *                'lapsed'         ended longer ago than that
 *                'none'           no subscription has ever started
 *   licensed   whether an insert would be allowed — true for the first four
 *   endsOn     period_end of the row that decided the answer, or null when
 *              open-ended or none
 *   graceEndsOn the last licensed day, or null
 *   daysLeft   days until endsOn (negative once past it), or null
 *   next       period_start of a later row already recorded — a renewal in
 *              the book — or null
 *
 * Cancelled rows are ignored entirely. Rows that have not started yet do not
 * license anything, but the earliest of them is reported as `next` so a banner
 * can say "renewed from 1 September" rather than counting down to nothing.
 */
export function licence(subscriptions, today = todayIso()) {
  const now = dayOf(today);
  if (now === null) throw new Error(`licence: today must be YYYY-MM-DD, got ${today}`);

  const rows = (subscriptions ?? [])
    .filter((s) => s && s.status !== 'cancelled')
    .map((s) => ({
      status: s.status,
      start: dayOf(s.period_start),
      end: s.period_end == null ? null : dayOf(s.period_end),
    }))
    .filter((s) => s.start !== null);

  const started = rows.filter((s) => s.start <= now);
  const future = rows.filter((s) => s.start > now).sort((a, b) => a.start - b.start);
  const next = future.length ? isoOf(future[0].start) : null;

  const covering = started.filter((s) => s.end === null || s.end >= now);
  if (covering.length) {
    // Open-ended wins outright; otherwise the row that runs longest.
    const open = covering.find((s) => s.end === null);
    if (open) {
      return { state: 'complimentary', licensed: true, endsOn: null, graceEndsOn: null, daysLeft: null, next };
    }
    const best = covering.reduce((a, b) => (b.end > a.end ? b : a));
    return {
      state: best.status === 'trial' ? 'trial' : 'active',
      licensed: true,
      endsOn: isoOf(best.end),
      graceEndsOn: isoOf(best.end + GRACE_DAYS),
      daysLeft: best.end - now,
      next,
    };
  }

  const ended = started.filter((s) => s.end !== null);
  if (!ended.length) {
    return { state: 'none', licensed: false, endsOn: null, graceEndsOn: null, daysLeft: null, next };
  }
  const latest = ended.reduce((a, b) => (b.end > a.end ? b : a));
  const inGrace = latest.end + GRACE_DAYS >= now;
  return {
    state: inGrace ? 'grace' : 'lapsed',
    licensed: inGrace,
    endsOn: isoOf(latest.end),
    graceEndsOn: isoOf(latest.end + GRACE_DAYS),
    daysLeft: latest.end - now,
    next,
  };
}
