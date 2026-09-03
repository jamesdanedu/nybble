import type { MetadataRoute } from 'next';

/**
 * Served at /manifest.webmanifest by Next's metadata route convention.
 *
 * `display: 'standalone'` is the point of the exercise: installed on a phone or
 * a Chromebook, Nybble opens without browser chrome, which is one less row of
 * distractions during a lesson and one less address bar for a student to
 * navigate away from.
 *
 * What it does NOT claim is offline support. See public/sw.js and docs/pwa.md —
 * activities cannot run without the network, so nothing here should suggest
 * otherwise.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nybble — Computer Science activities',
    short_name: 'Nybble',
    description:
      'Activity portal for Leaving Certificate Computer Science — quizzes, number base tests and Parsons problems.',
    // Not '/': signed in, the front door only redirects, and a redirect is a
    // poor thing to launch into. Signed out, /dashboard bounces to /login,
    // which is where that student needed to be anyway.
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    // Matching app/layout.tsx, so the installed shell does not flash a colour
    // the page never uses. Both are the light-mode values: a manifest has one
    // background_color and cannot follow the system theme.
    background_color: '#fbfbf9',
    theme_color: '#fbfbf9',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Same art. It is drawn full-bleed with the bits inside the middle 80%,
      // so Android's circular mask has nothing to cut off — see
      // scripts/make-icons.mjs.
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
