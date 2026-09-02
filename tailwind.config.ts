import type { Config } from 'tailwindcss';

/**
 * Colours are CSS custom properties defined in app/globals.css, so a single
 * utility class (`bg-surface`) is correct in both themes and there is no
 * `dark:` variant sprayed through every component.
 *
 * Dark mode follows the operating system. There is deliberately no manual
 * toggle: the runners inside the iframes use `prefers-color-scheme` and cannot
 * see a class on the portal's <html>, so a toggle would leave a light activity
 * sitting inside a dark page.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        page: 'var(--page)',
        surface: 'var(--surface)',
        raised: 'var(--raised)',
        line: 'var(--line)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        accent: 'var(--accent)',
        'accent-ink': 'var(--accent-ink)',
        'accent-soft': 'var(--accent-soft)',
        warn: 'var(--warn)',
        'warn-soft': 'var(--warn-soft)',
        danger: 'var(--danger)',
        'danger-soft': 'var(--danger-soft)',
        info: 'var(--info)',
        'info-soft': 'var(--info-soft)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)', 'var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        card: '22px',
      },
    },
  },
  plugins: [],
};

export default config;
