#!/usr/bin/env node
// Generates PWA icons (PNG) and favicon.ico from an inline SVG using Playwright's Chromium.
// Usage: node scripts/gen-icons.mjs
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACCENT = "#3b5bdb";

// White baby footprint on a solid accent square. `scale` shrinks the glyph
// (maskable icons need it inside the central 80% safe zone).
function svg(size, scale) {
  const glyph = `
    <g fill="#fff">
      <!-- sole -->
      <path d="M50 38c-11 0-17 9-17 21 0 9 4 14 6 20 2 6 1 13 11 13s13-6 12-13c-1-7 4-12 4-22 0-12-6-19-16-19z"/>
      <!-- toes, big to small -->
      <ellipse cx="38" cy="27" rx="6.2" ry="7.2"/>
      <circle cx="49.5" cy="22.5" r="4.6"/>
      <circle cx="58.5" cy="24" r="4"/>
      <circle cx="65.5" cy="28.5" r="3.4"/>
      <circle cx="70.5" cy="35" r="2.9"/>
    </g>`;
  const t = 50 - 50 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="${ACCENT}"/>
    <g transform="translate(${t - 2.5 * scale} ${t - 4 * scale}) scale(${scale})">${glyph}</g>
  </svg>`;
}

const targets = [
  { out: "public/icons/icon-192.png", size: 192, scale: 0.92 },
  { out: "public/icons/icon-512.png", size: 512, scale: 0.92 },
  { out: "public/icons/icon-maskable-512.png", size: 512, scale: 0.68 },
  { out: "public/apple-touch-icon.png", size: 180, scale: 0.86 },
];
const favSizes = [16, 32, 48];

async function render(page, size, scale) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><body style="margin:0">${svg(size, scale)}</body></html>`,
  );
  return page.screenshot({ clip: { x: 0, y: 0, width: size, height: size }, omitBackground: true });
}

// Build an ICO file that embeds PNG images (supported by all modern browsers).
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const t of targets) {
    const file = join(root, t.out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, await render(page, t.size, t.scale));
    console.log(`wrote ${t.out} (${t.size}x${t.size})`);
  }
  const favs = [];
  for (const size of favSizes) favs.push({ size, data: await render(page, size, 0.96) });
  writeFileSync(join(root, "src/app/favicon.ico"), ico(favs));
  console.log(`wrote src/app/favicon.ico (${favSizes.join(", ")})`);
} finally {
  await browser.close();
}
