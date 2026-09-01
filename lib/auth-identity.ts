/* ---------------------------------------------------------------------------
 * The username → synthetic email mapping.
 *
 * This is the one genuinely unusual thing about auth in this app, so it lives
 * on its own and is used from exactly one place on the client (the login form)
 * and one on the server (account admin).
 *
 * Students have no email address. Supabase Auth insists on one, so every
 * profile maps to a synthetic address:
 *
 *     <username>@<school-slug>.portal.invalid
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so nothing can ever
 * be delivered to it and nobody can register it. `schools.slug` is constrained
 * to ^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$ and `profiles.username` to
 * ^[a-z0-9._-]{3,40}$, which is exactly the character set that is safe in the
 * local part of an address, so the join can never produce something malformed.
 *
 * A STUDENT MUST NEVER SEE THE SYNTHETIC ADDRESS. It is an implementation
 * detail of Supabase Auth, it looks like a broken email to a fourteen-year-old,
 * and displaying it invites someone to try emailing it. Errors coming back from
 * signInWithPassword mention the email, which is why loginErrorMessage() below
 * rewrites them rather than passing them through.
 * ------------------------------------------------------------------------ */

export const SYNTHETIC_EMAIL_DOMAIN_SUFFIX = '.portal.invalid';

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

export function isValidSchoolSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** `josullivan` + `stmarys` → `josullivan@stmarys.portal.invalid` */
export function syntheticEmail(username: string, schoolSlug: string): string {
  return `${username}@${schoolSlug}${SYNTHETIC_EMAIL_DOMAIN_SUFFIX}`;
}

/** True for an address this portal minted. Used to hide it in the UI. */
export function isSyntheticEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith(SYNTHETIC_EMAIL_DOMAIN_SUFFIX);
}

export interface ResolvedLogin {
  ok: true;
  email: string;
  username: string;
  schoolSlug: string;
}
export interface UnresolvedLogin {
  ok: false;
  message: string;
}

/**
 * Turn what someone typed into the box into the address we sign in with.
 *
 * Accepted forms:
 *   `josullivan`              → uses the deployment's default school slug
 *   `josullivan@stmarys`      → explicit school, for a multi-school deployment
 *   `me@example.com`          → passed through untouched, so a teacher whose
 *                               auth user was created with a real address in
 *                               the Supabase dashboard can still get in
 *
 * The third case is why we test for a dot in the domain: a real email domain
 * always has one, a school slug never may (the slug regex forbids `.`).
 */
export function resolveLoginEmail(
  raw: string,
  defaultSchoolSlug: string,
): ResolvedLogin | UnresolvedLogin {
  const input = raw.trim().toLowerCase();
  if (!input) return { ok: false, message: 'Enter your username.' };

  const at = input.lastIndexOf('@');
  if (at > 0) {
    const local = input.slice(0, at);
    const domain = input.slice(at + 1);

    // A real email address — a teacher account made in the Supabase dashboard.
    if (domain.includes('.')) {
      return { ok: true, email: input, username: local, schoolSlug: '' };
    }

    // username@school-slug
    if (!isValidUsername(local)) {
      return { ok: false, message: 'That username has characters we cannot use.' };
    }
    if (!isValidSchoolSlug(domain)) {
      return { ok: false, message: 'We do not recognise that school code.' };
    }
    return { ok: true, email: syntheticEmail(local, domain), username: local, schoolSlug: domain };
  }

  if (!defaultSchoolSlug) {
    return {
      ok: false,
      message:
        'This portal has not been told which school it belongs to. Ask your teacher — ' +
        'NEXT_PUBLIC_SCHOOL_SLUG is missing.',
    };
  }
  if (!isValidUsername(input)) {
    return {
      ok: false,
      message: 'Usernames are letters, numbers, dots, dashes and underscores only.',
    };
  }
  return {
    ok: true,
    email: syntheticEmail(input, defaultSchoolSlug),
    username: input,
    schoolSlug: defaultSchoolSlug,
  };
}

/**
 * Rewrite a Supabase auth error into something a student can act on — and,
 * critically, one that does not leak the synthetic address back at them.
 */
export function loginErrorMessage(raw: string | null | undefined): string {
  const m = (raw ?? '').toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'That username and password do not match. Check for a stray capital letter, then try again.';
  }
  if (m.includes('email not confirmed')) {
    return 'This account has not been activated yet. Ask your teacher to re-create it.';
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many tries. Wait a minute and go again.';
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'Could not reach the server. Check the internet connection and try again.';
  }
  return 'Could not sign you in. Try again, and tell your teacher if it keeps happening.';
}

/* ---------------------------------------------------------------------------
 * Username generation, used by the bulk "add students" flow.
 * ------------------------------------------------------------------------ */

/**
 * `Aoife Ní Bhriain` → `aoifenibhriain`. Fadas and apostrophes are stripped,
 * not transliterated to something odd, because the username regex has no room
 * for them and a student has to be able to type it from memory on a Monday.
 */
export function usernameFromName(displayName: string): string {
  const base = displayName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining accents (fadas etc.)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);
  // The regex demands at least 3 characters.
  return base.length >= 3 ? base : (base + 'student').slice(0, 40);
}

/**
 * Make `candidate` unique against a set of usernames already in use,
 * by appending 2, 3, 4… (never 1 — `aoifemurphy` and `aoifemurphy2` reads
 * better on a printed slip than `aoifemurphy1` and `aoifemurphy2`).
 */
export function uniqueUsername(candidate: string, taken: Set<string>): string {
  if (!taken.has(candidate)) return candidate;
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const trimmed = candidate.slice(0, 40 - suffix.length) + suffix;
    if (!taken.has(trimmed)) return trimmed;
  }
  throw new Error(`Could not find a free username based on "${candidate}".`);
}

/* Words chosen to be unambiguous when read aloud and typed by a 15-year-old:
   no homophones, no letters that look like digits, nothing embarrassing. */
const WORDS = [
  'amber', 'anchor', 'badger', 'basil', 'beacon', 'bramble', 'bridge', 'cedar',
  'cobalt', 'comet', 'copper', 'cotton', 'crystal', 'damson', 'delta', 'ember',
  'falcon', 'fennel', 'garnet', 'granite', 'harbour', 'hazel', 'heron', 'indigo',
  'ivory', 'juniper', 'kestrel', 'lantern', 'linen', 'maple', 'marble', 'meadow',
  'mosaic', 'nectar', 'nutmeg', 'onyx', 'orchid', 'otter', 'pebble', 'pewter',
  'poplar', 'quartz', 'quiver', 'ribbon', 'saffron', 'sable', 'shamrock', 'sorrel',
  'sparrow', 'spruce', 'tangent', 'teal', 'thistle', 'timber', 'topaz', 'tundra',
  'velvet', 'walnut', 'willow', 'zephyr',
];

/**
 * A password a teacher can read off a printed slip without ambiguity:
 * `maple-otter-3184`. Roughly 60 × 60 × 9000 ≈ 32M combinations — plenty for a
 * one-time password that must be changed at first login, and far better than
 * anything a teacher would choose by hand for thirty students at once.
 *
 * Uses crypto.getRandomValues (available in Node 20 and in Edge/browser).
 */
export function generatePassword(): string {
  const buf = new Uint32Array(3);
  crypto.getRandomValues(buf);
  const a = WORDS[buf[0] % WORDS.length];
  const b = WORDS[buf[1] % WORDS.length];
  const n = 1000 + (buf[2] % 9000);
  return `${a}-${b}-${n}`;
}
