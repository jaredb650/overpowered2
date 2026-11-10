// Renders a song written as code to an audio file.
//
//   nice npx tsx tools/music/render.ts <slug>                 the whole song: WAV, report and spectrogram in tools/out/music,
//                                                             MP3 in public/audio/ost/<list>/ and its line in the manifest
//   nice npx tsx tools/music/render.ts <slug> --bars 24:40    only those bars (to exclusive), WAV and report, no MP3
//   nice npx tsx tools/music/render.ts <slug> --solo bass,sub only those tracks
//   nice npx tsx tools/music/render.ts <slug> --draft         the whole song without touching public/
//   --pic also draws the spectrogram for a partial render. --quiet prints only the summary. Flags may come before or after the slug.
//   The master line's crest is the WAV's. For comparing with a reference MP3, use the "decoded" crest under the mp3 line.
//
// A song is tools/music/songs/<slug>.ts with a default export `() => Song`. Same file, same bytes of audio.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SR, type Song } from './engine';
import { bandBalance, crest, energyOverTime, samplePeak, stereoStats } from './engine/meter';
import { ebur128, encodeMp3, readAudio, spectrogram, writeWav } from './engine/io';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
/** Flags that take a value. The value is not the slug, wherever the flag stands. */
const WITH_VALUE = new Set(['--bars', '--solo']);
const slug = args.find((a, i) => !a.startsWith('--') && !WITH_VALUE.has(args[i - 1] ?? ''));
const flag = (name: string): boolean => args.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!slug) {
  console.error('usage: npx tsx tools/music/render.ts <slug> [--bars a:b] [--solo a,b] [--draft] [--pic] [--quiet]');
  process.exit(1);
}
const file = join(here, 'songs', `${slug}.ts`);
if (!existsSync(file)) {
  console.error(`No song at ${file}`);
  process.exit(1);
}

/** Most MP3 a track may take, bytes. A menu must not make the first visit download much. */
const MAX_BYTES = 3.4e6;
const MAX_KBPS = 192;

const mod = (await import(pathToFileURL(file).href)) as { default: () => Song };
const song = mod.default();
const bars = value('bars')?.split(':').map(Number);
const solo = value('solo')?.split(',');
const partial = !!bars || !!solo;
const quiet = flag('quiet');
const say = (line: string): void => {
  if (!quiet) console.log(line);
};

say(`${song.title} (${song.slug}): ${song.bpm} BPM, ${song.bars} bars, ${song.seconds.toFixed(1)} s, list "${song.list}"`);
const res = song.render({ from: bars?.[0], to: bars?.[1], solo, log: say });
const m = res.master;
const outDir = join(root, 'tools/out/music');
mkdirSync(outDir, { recursive: true });
const tag = partial ? `.${bars ? `${res.fromBar}-${res.toBar}` : 'all'}${solo ? `.${solo.join('+')}` : ''}` : '';
const wav = join(outDir, `${song.slug}${tag}.wav`);
writeWav(wav, res.buf);

const bands = bandBalance(res.buf);
const st = stereoStats(res.buf);
const barSeconds = song.s(song.beatsPerBar);
const perFour = energyOverTime(res.buf, barSeconds * 4);
const sections = song.sections
  .filter(s => s.to > res.fromBar && s.from < res.toBar)
  .map(s => {
    const a = Math.max(0, Math.round((Math.max(s.from, res.fromBar) - res.fromBar) * barSeconds * SR));
    const b = Math.min(res.buf[0].length, Math.round((Math.min(s.to, res.toBar) - res.fromBar) * barSeconds * SR));
    let sum = 0;
    for (let i = a; i < b; i++) sum += res.buf[0][i] ** 2 + res.buf[1][i] ** 2;
    return { name: s.name, bars: `${s.from}-${s.to}`, rmsDb: 10 * Math.log10(Math.max(1e-12, sum / (2 * Math.max(1, b - a)))), bands: bandBalance(res.buf, SR, a, b) };
  });

console.log(`\nmaster  ${m.lufs.toFixed(2)} LUFS (target ${song.master.target})  short-term max ${m.shortTermMax.toFixed(1)}  range ${m.range.toFixed(1)} LU  peak ${m.peakDb.toFixed(2)} dBFS  crest ${crest(res.buf).toFixed(1)} dB`);
console.log(`        pushed ${m.pushDb.toFixed(1)} dB from ${m.preLufs.toFixed(1)} LUFS  glue max ${m.glueMaxDb.toFixed(1)} dB  limiter max ${m.limiterMaxDb.toFixed(1)} dB, mean ${m.limiterMeanDb.toFixed(1)} dB on ${(m.limiterShare * 100).toFixed(1)}% of samples`);
console.log(`stereo  correlation ${st.correlation.toFixed(2)}  side ${st.sideDb.toFixed(1)} dB  mono loss ${st.monoLossDb.toFixed(2)} dB  dc ${st.dc.toExponential(1)}`);
console.log(`bands   ${bands.map(b => `${b.name} ${b.db.toFixed(1)}`).join(' | ')}`);
if (sections.length) {
  console.log('sections (RMS dB, then the band balance of each)');
  for (const s of sections) console.log(`  ${s.name.padEnd(12)} ${s.bars.padEnd(8)} ${s.rmsDb.toFixed(1).padStart(6)}   ${s.bands.map(b => b.db.toFixed(0).padStart(4)).join('')}`);
}
say(`4-bar RMS  ${perFour.map(v => v.toFixed(0)).join(' ')}`);
console.log(`render  ${res.seconds.toFixed(1)} s of audio in ${res.cpu.toFixed(1)} s of CPU`);

const report: Record<string, unknown> = { title: song.title, slug: song.slug, list: song.list, bpm: song.bpm, bars: song.bars, key: song.key, seconds: res.seconds, cpu: res.cpu, master: m, stereo: st, bands, sections, tracks: res.tracks, fourBarRms: perFour };

if (flag('pic') || !partial) spectrogram(wav, join(outDir, `${song.slug}${tag}.png`));

// A song whose name starts with an underscore is a test and never ships.
if (!partial && !flag('draft') && !song.slug.startsWith('_')) {
  const mp3 = join(root, 'public/audio/ost', song.list, `${song.slug}.mp3`);
  const kbps = Math.min(MAX_KBPS, Math.floor((MAX_BYTES * 8) / res.seconds / 1000 / 8) * 8);
  const tags = { kbps, title: song.title, artist: 'OVERPOWERED 2', album: 'OVERPOWERED 2: Original Soundtrack' };
  encodeMp3(wav, mp3, tags);
  let measured = ebur128(mp3);
  // The MP3 must be as loud as the master it was made from. An encoder that changes the level is corrected once.
  const drift = measured.integrated - ebur128(wav).integrated;
  if (Math.abs(drift) > 0.15) {
    encodeMp3(wav, mp3, { ...tags, scale: Math.pow(10, -drift / 20) });
    measured = ebur128(mp3);
  }
  const size = statSync(mp3).size;
  // Crest and peak of the MP3, decoded. Encoding adds 2 to 3 dB of peak to a limited master, so the WAV's crest above is not
  // comparable with `analyze.ts` on a reference MP3. This one is.
  const decoded = readAudio(mp3);
  const mp3Peak = 20 * Math.log10(samplePeak(decoded));
  const mp3Crest = crest(decoded);
  console.log(`mp3     ${mp3.replace(`${root}/`, '')}  ${(size / 1e6).toFixed(2)} MB at ${kbps} kbps  ffmpeg: ${measured.integrated} LUFS, range ${measured.range} LU, true peak ${measured.truePeak} dBFS`);
  console.log(`        decoded: sample peak ${mp3Peak.toFixed(2)} dBFS, crest ${mp3Crest.toFixed(1)} dB (compare this crest with analyze.ts on a reference)`);
  report.mp3 = { file: `audio/ost/${song.list}/${song.slug}.mp3`, bytes: size, kbps, ...measured, samplePeakDb: mp3Peak, crestDb: mp3Crest };

  const manifestPath = join(root, 'public/audio/ost/manifest.json');
  type Entry = { file: string; title: string };
  const manifest: Record<string, Entry[]> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  for (const list of ['menu', 'easy', 'hard']) manifest[list] ??= [];
  const entry: Entry = { file: `audio/ost/${song.list}/${song.slug}.mp3`, title: song.title };
  for (const list of ['menu', 'easy', 'hard']) manifest[list] = manifest[list].filter(e => e.file !== entry.file);
  manifest[song.list].push(entry);
  manifest[song.list].sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(manifestPath, `${JSON.stringify({ menu: manifest.menu, easy: manifest.easy, hard: manifest.hard }, null, 2)}\n`);
}
writeFileSync(join(outDir, `${song.slug}${tag}.json`), JSON.stringify(report, null, 1));
