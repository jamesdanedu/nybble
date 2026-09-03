import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque } from 'next/font/google';
import { ServiceWorker } from '@/components/service-worker';
import './globals.css';

/**
 * Display face. Self-hosted by next/font rather than a <link> to Google: the
 * portal has to work on a school network that may block third-party font hosts,
 * and a swap-in halfway through a lesson is a distraction.
 */
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Nybble',
    template: '%s · Nybble',
  },
  description:
    'Activity portal for Leaving Certificate Computer Science — quizzes, number base tests and Parsons problems.',
  // The manifest is a metadata route (app/manifest.ts); this is the <link> to
  // it, which Next does not emit on its own.
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  // iOS installs from Safari's Share sheet rather than an install prompt, and
  // reads these rather than the manifest.
  appleWebApp: {
    capable: true,
    title: 'Nybble',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matching light/dark so iOS Safari's chrome does not fight the page colour.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbf9' },
    { media: '(prefers-color-scheme: dark)', color: '#131417' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body className="min-h-screen bg-page text-ink antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
