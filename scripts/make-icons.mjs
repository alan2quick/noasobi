// Renders the PWA icons from public/icons/icon.svg. Run with: node scripts/make-icons.mjs
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const svg = await readFile(new URL('../public/icons/icon.svg', import.meta.url));
const out = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// The artwork is full-bleed with the fish inside the central safe zone, so the same image works
// as a regular and a maskable icon.
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
]) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(out(name));
}
console.log('icons written');
