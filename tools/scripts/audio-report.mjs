// Writes tools/out/audio-report.json: level, envelope and spectrum of every sound, plus pass/fail.
//   node tools/shot.mjs --url "/?sandbox=audio&mode=idle" --script tools/scripts/audio-report.mjs --wait 500
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function report(page, { outDir, sleep }) {
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => !!window.__audio)) break;
    await sleep(250);
  }
  const data = await page.evaluate(() => {
    const a = window.__audio;
    const r = a.report();
    return { ...r, loadMs: a.loadMs, stats: a.engine.stats(), rooms: a.impulseTimes() };
  });
  writeFileSync(join(outDir, 'audio-report.json'), JSON.stringify({ generated: new Date().toISOString(), ...data }, null, 1));
  const bad = data.lines.filter(l => l.failures.length);
  return {
    loadMs: Math.round(data.loadMs),
    sounds: data.lines.length,
    seconds: Math.round(data.seconds),
    megabytes: Math.round(data.bytes / 1048576),
    failures: data.failures,
    failing: bad.map(l => `${l.id}: ${l.failures.slice(0, 3).join('; ')}`),
    rooms: data.rooms,
  };
}
