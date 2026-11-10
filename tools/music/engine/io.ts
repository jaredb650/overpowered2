/**
 * Files: WAV out, anything in (through ffmpeg), MP3 encoding (through lame), and the two ffmpeg readings a master is
 * judged by. ffmpeg and lame are found on PATH, with Homebrew's folder as a fallback.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SR, type Stereo } from './core';

function tool(name: string): string {
  const brew = `/opt/homebrew/bin/${name}`;
  return existsSync(brew) ? brew : name;
}

/** 24-bit stereo WAV. */
export function writeWav(path: string, buf: Stereo, sr = SR): void {
  const n = buf[0].length;
  const data = Buffer.alloc(44 + n * 6);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + n * 6, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(sr, 24);
  data.writeUInt32LE(sr * 6, 28);
  data.writeUInt16LE(6, 32);
  data.writeUInt16LE(24, 34);
  data.write('data', 36);
  data.writeUInt32LE(n * 6, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      let v = Math.round(buf[c][i] * 8388607);
      v = v > 8388607 ? 8388607 : v < -8388608 ? -8388608 : v;
      data[o] = v & 255;
      data[o + 1] = (v >> 8) & 255;
      data[o + 2] = (v >> 16) & 255;
      o += 3;
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

/** Decodes any audio file to stereo floats at 44.1 kHz. */
export function readAudio(path: string, sr = SR): Stereo {
  const res = spawnSync(tool('ffmpeg'), ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', String(sr), '-'], { maxBuffer: 1 << 30 });
  if (res.status !== 0) throw new Error(`ffmpeg could not read ${path}: ${res.stderr?.toString()}`);
  const raw = res.stdout;
  const n = Math.floor(raw.length / 8);
  const view = new Float32Array(raw.buffer, raw.byteOffset, n * 2);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = view[2 * i];
    R[i] = view[2 * i + 1];
  }
  return [L, R];
}

export interface Mp3Opts {
  /** Average bitrate in kbps. */
  kbps: number;
  title?: string;
  artist?: string;
  album?: string;
  /** Level change applied by the encoder. See `encodeMp3`. */
  scale?: number;
}

/**
 * Average-bitrate MP3 at lame's best quality setting, joint stereo.
 *
 * lame's bitrate presets turn the level down on their own: to 0.95 (0.45 dB) at 160 kbps and under, 0.97 at 192. That
 * is multiplied with any `scale` given here, so the renderer measures the result against the WAV and encodes a second
 * time with the scale that cancels it.
 */
export function encodeMp3(wav: string, out: string, o: Mp3Opts): void {
  mkdirSync(dirname(out), { recursive: true });
  const args = ['--quiet', '--abr', String(o.kbps), '-q', '0', '-m', 'j', '--id3v2-only'];
  if (o.scale && o.scale !== 1) args.push('--scale', o.scale.toFixed(4));
  if (o.title) args.push('--tt', o.title);
  if (o.artist) args.push('--ta', o.artist);
  if (o.album) args.push('--tl', o.album);
  args.push(wav, out);
  execFileSync(tool('lame'), args, { stdio: ['ignore', 'inherit', 'inherit'] });
}

export interface Ebur128 {
  integrated: number;
  range: number;
  truePeak: number;
}

/** What ffmpeg's ebur128 filter says about a file. This is the number the tracks are matched on. */
export function ebur128(path: string): Ebur128 {
  const res = spawnSync(tool('ffmpeg'), ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { maxBuffer: 1 << 28 });
  const text = res.stderr.toString();
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const num = (re: RegExp): number => Number(re.exec(summary)?.[1] ?? NaN);
  return { integrated: num(/I:\s+(-?[\d.]+) LUFS/), range: num(/LRA:\s+(-?[\d.]+) LU/), truePeak: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

/** A spectrogram picture: time left to right, 0 to 22 kHz bottom to top on a log scale, brightness is level. */
export function spectrogram(path: string, png: string, width = 1800, height = 700): void {
  mkdirSync(dirname(png), { recursive: true });
  execFileSync(tool('ffmpeg'), ['-v', 'error', '-y', '-i', path, '-lavfi', `showspectrumpic=s=${width}x${height}:legend=1:fscale=log:scale=log:drange=90:color=magma`, png]);
}
