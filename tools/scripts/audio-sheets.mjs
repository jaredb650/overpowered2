// Spectrogram contact sheets of every sound: tools/out/audio-sheet-<n>.png.
//   node tools/shot.mjs --url "/?sandbox=audio&mode=idle" --script tools/scripts/audio-sheets.mjs --wait 200 --w 1248 --h 672
import { join } from 'node:path';

const PAGES = 7;

export default async function sheets(page, { outDir }) {
  const base = page.url().split('?')[0];
  const written = [];
  for (let p = 0; p < PAGES; p++) {
    await page.goto(`${base}?sandbox=audio&mode=sheet&p=${p}`, { waitUntil: 'load' });
    await page.waitForSelector('canvas[data-sheet="done"]', { timeout: 60000 });
    const file = join(outDir, `audio-sheet-${p}.png`);
    await page.screenshot({ path: file });
    written.push(file);
  }
  return written;
}
