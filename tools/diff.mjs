#!/usr/bin/env node
// Screenshot difference: compares two PNGs of one size and shows where they differ.
//
//   node tools/diff.mjs before.png after.png --out tools/out/me/diff.png
//   node tools/diff.mjs a.png b.png --out d.png --threshold 0 --aa --max 0      (strict: fail on any difference)
//
// Writes:
//   <out>            the difference picture: "before" faded to grey, changed pixels red, ignored edge pixels yellow
//   <out>-strip.png  before | after | difference side by side, each panel shrunk to --panel pixels wide
//   <out>-zoom.png   the same three, cut to the box around the change at full size (only when something changed)
// Prints one JSON line: { changed, exact, total, percent, bbox, width, height, out, strip, zoom }.
//   changed  pixels that differ by more than the threshold;  exact  pixels whose bytes differ at all
//   bbox     { x, y, w, h } around the changed pixels, or null
//
// Options:
//   --out <file.png>    where to write (default: diff.png beside the first picture)
//   --threshold <0..1>  how different a pixel must be to count (default 0.1; 0 counts every visible difference)
//   --aa                also count anti-aliased edge pixels (by default they are detected and ignored)
//   --panel <px>        width of each panel in the strip (default 960)
//   --max <percent>     exit with code 1 when more than this percent of the pixels changed
//   --no-pictures       only print the numbers
// Exit code: 0, 1 when --max is exceeded, 2 on a bad input (missing file, not a PNG, different sizes).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join, basename, extname } from 'node:path';
import { PNG } from 'pngjs';
import { compare, crop, padBox, shrink, strip } from './lib/image.mjs';

const argv = process.argv.slice(2);
const files = [];
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { files.push(a); continue; }
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) opt[a.slice(2)] = true;
  else { opt[a.slice(2)] = next; i++; }
}
const fail = message => { console.error(`[diff] ${message}`); process.exit(2); };
if (files.length !== 2) fail('usage: node tools/diff.mjs before.png after.png --out diff.png [--threshold 0.1] [--aa] [--max <percent>]');

const read = file => {
  let png;
  try { png = PNG.sync.read(readFileSync(file)); } catch (e) { fail(`cannot read ${file}: ${e.message}`); }
  // A copy: a small PNG's bytes can sit at an odd offset in a shared buffer, which the comparison's 32-bit view refuses.
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
};
const write = (file, image) => {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  writeFileSync(file, PNG.sync.write(png));
  return file;
};

const before = read(files[0]), after = read(files[1]);
let result;
try {
  result = compare(before, after, { threshold: Number(opt.threshold ?? 0.1), aa: !!opt.aa });
} catch (e) {
  fail(e.message);
}
const out = resolve(String(opt.out ?? join(dirname(files[0]), 'diff.png')));
const stem = join(dirname(out), basename(out, extname(out)));
const report = {
  changed: result.changed, exact: result.exact, total: result.total, percent: result.percent, bbox: result.bbox,
  width: before.width, height: before.height, out: null, strip: null, zoom: null,
};
if (!opt['no-pictures']) {
  mkdirSync(dirname(out), { recursive: true });
  const panel = Number(opt.panel ?? 960);
  report.out = write(out, result.diff);
  report.strip = write(`${stem}-strip.png`, strip([before, after, result.diff].map(p => shrink(p, panel))));
  if (result.bbox) {
    const box = padBox(result.bbox, 24, before.width, before.height);
    report.zoom = write(`${stem}-zoom.png`, strip([before, after, result.diff].map(p => shrink(crop(p, box), panel))));
  }
}
process.stdout.write(JSON.stringify(report) + '\n');
if (opt.max !== undefined && result.percent > Number(opt.max)) process.exit(1);
