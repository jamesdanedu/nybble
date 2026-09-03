/* ---------------------------------------------------------------------------
 * Regenerate the PWA icons in public/icons/.
 *
 *   node scripts/make-icons.mjs
 *
 * The icons are committed, so this only needs running when the art changes.
 * It is here so that "how was this PNG made" has an answer in the repo rather
 * than in someone's Downloads folder.
 *
 * public/logo.png is deliberately NOT the source. That file is a wordmark on a
 * near-white plate: the lettering is unreadable at 48 px, and Android would
 * either letterbox the white plate or crop straight through the word. An app
 * icon has to survive a circular mask at one sixth of this size, so it gets art
 * of its own — four bits, which is what a nybble is, reading 0100.
 *
 * Rendered through headless Chromium rather than an image library because the
 * repo already depends on Playwright for test/harness.test.mjs, and adding a
 * second imaging toolchain to draw four squares is not a trade worth making.
 * ------------------------------------------------------------------------ */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/** --accent from app/globals.css. The icon is the same green as the buttons. */
const ACCENT = '#2f6f4f';
const INK = '#ffffff';

/**
 * Full-bleed background, art inside the maskable safe zone.
 *
 * Android may crop a maskable icon to a circle inscribed in the middle 80% of
 * the canvas. On a 512 grid that leaves 51.2 → 460.8 usable; the bit grid below
 * spans 116 → 396, so nothing meaningful is ever cut off. The same art is used
 * for `purpose: "any"`, where the full square shows and simply reads as a
 * square icon.
 */
function svg(size) {
  const cell = 128;
  const gap = 24;
  const origin = (512 - (cell * 2 + gap)) / 2;
  const at = (col, row) => [origin + col * (cell + gap), origin + row * (cell + gap)];

  // 0100 — one set bit in four. Reading order is left to right, top to bottom.
  const bits = [0, 1, 0, 0];
  const cells = bits
    .map((bit, i) => {
      const [x, y] = at(i % 2, Math.floor(i / 2));
      return bit
        ? `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="30" fill="${INK}"/>`
        : `<rect x="${x + 8}" y="${y + 8}" width="${cell - 16}" height="${cell - 16}" rx="24"
             fill="none" stroke="${INK}" stroke-width="16" stroke-opacity="0.92"/>`;
    })
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${ACCENT}"/>
    ${cells}
  </svg>`;
}

const TARGETS = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  // iOS applies its own rounded-rect mask and does not honour transparency, so
  // the same full-bleed art is exactly what it wants.
  { file: 'apple-touch-icon.png', size: 180 },
];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await browser.newPage();

for (const { file, size } of TARGETS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}</style>${svg(size)}`,
  );
  await writeFile(path.join(OUT, file), await page.screenshot({ omitBackground: true }));
  console.log(`wrote public/icons/${file}  (${size}×${size})`);
}

// The SVG goes alongside them: it is the source of truth for the shape, and a
// browser that prefers it in the manifest gets it at any size for free.
await writeFile(path.join(OUT, 'icon.svg'), svg(512) + '\n');
console.log('wrote public/icons/icon.svg');

await browser.close();
