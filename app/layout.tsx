import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Nybble',
    template: '%s · Nybble',
  },
  description:
    'Activity portal for Leaving Certificate Computer Science — quizzes, number base tests and Parsons problems.',
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
    <html lang="en">
      <body className="min-h-screen bg-page text-ink antialiased">{children}</body>
    </html>
  );
}
