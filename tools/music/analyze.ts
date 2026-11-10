// Measures any audio file the way the renderer measures its own output, to compare a render with a reference.
//
//   nice npx tsx tools/music/analyze.ts <file> [more files]     loudness, peak, crest, stereo, band balance, tempo, key,
//                                                               and the level of every 8 bars so the arrangement shows
//   --bpm 172      skip the tempo estimate and use this for the 8-bar windows
//   --pic          also write a spectrogram to tools/out/music/<name>.png
//
// The owner's placeholder songs under public/audio/music may be measured. Their notes may not be copied.
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SR } from './engine/core';
import { bandBalance, crest, energyOverTime, estimateKey, estimateTempo, loudness, samplePeak, stereoStats } from './engine/meter';
import { ebur128, readAudio, spectrogram } from './engine/io';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--bpm');
const bpmArg = args.includes('--bpm') ? Number(args[args.indexOf('--bpm') + 1]) : 0;
if (!files.length) {
  console.error('usage: npx tsx tools/music/analyze.ts <file> [--bpm n] [--pic]');
  process.exit(1);
}
for (const file of files) {
  const buf = readAudio(file);
  const seconds = buf[0].length / SR;
  const loud = loudness(buf);
  const ff = ebur128(file);
  const st = stereoStats(buf);
  const tempo = bpmArg ? { bpm: bpmArg, strength: 0 } : estimateTempo(buf);
  const key = estimateKey(buf);
  const bands = bandBalance(buf);
  const eight = energyOverTime(buf, (60 / tempo.bpm) * 32);
  console.log(`\n${basename(file)}`);
  console.log(`  length   ${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}  (${seconds.toFixed(1)} s)`);
  console.log(`  loudness ${loud.integrated.toFixed(2)} LUFS here, ${ff.integrated} by ffmpeg  short-term max ${loud.shortTermMax.toFixed(1)}  range ${loud.range.toFixed(1)} LU (ffmpeg ${ff.range})`);
  console.log(`  peak     ${(20 * Math.log10(samplePeak(buf))).toFixed(2)} dBFS sample, ${ff.truePeak} dBFS true  crest ${crest(buf).toFixed(1)} dB`);
  console.log(`  stereo   correlation ${st.correlation.toFixed(2)}  side ${st.sideDb.toFixed(1)} dB  mono loss ${st.monoLossDb.toFixed(2)} dB`);
  console.log(`  tempo    ${tempo.bpm} BPM${bpmArg ? ' (given)' : ` (strength ${tempo.strength.toFixed(2)})`}   key ${key.key} (margin ${key.confidence.toFixed(2)})`);
  console.log(`  bands    ${bands.map(b => `${b.name} ${b.db.toFixed(1)}`).join(' | ')}`);
  console.log(`  8-bar RMS ${eight.map(v => v.toFixed(0)).join(' ')}`);
  if (args.includes('--pic')) {
    const png = join(root, 'tools/out/music', `${basename(file).replace(/\.[^.]+$/, '')}.png`);
    spectrogram(file, png);
    console.log(`  picture  ${png}`);
  }
}
