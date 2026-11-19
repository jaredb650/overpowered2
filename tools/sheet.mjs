#!/usr/bin/env node
// Motion contact sheet: captures a run of frames from a page and lays them on one PNG grid with the time under each, so a
// reload, a recoil, a ragdoll or a blood puff can be judged from one image. Runs through tools/shot.mjs (same browser, same
// GPU flags, same machine-wide browser slot, same private Vite when nothing answers on the port).
//
//   node tools/sheet.mjs --port <yours> --url "/?sandbox=viewmodels&weapon=smg" --eval "window.__vm.rig.reload(1)" \
//     --out tools/out/<you>/reload.png
//   node tools/sheet.mjs --port <yours> --url "/?sandbox=gore" --script tools/scripts/my-trigger.mjs --frames 36 --every 32 \
//     --crop 400,150,640,500 --video tools/out/<you>/hit.mp4 --out tools/out/<you>/hit.png
//
// The trigger (--script, then --eval) runs first; the first frame is taken right after it.
//
// By default the clock is frozen (tools/scripts/lib/steady.mjs): the page is stepped exactly, Math.random is seeded, and the
// same command gives the same sheet whatever the machine load. Frames are whole 16 ms steps, so --every 50 lands on
// 0, 48, 96, 144, 208...: the real time is printed under each tile. A --script gets helpers whose sleep/press/click move the
// frozen clock; a script that waits with its own setTimeout stands still. Sound, WebRTC and DOM animations are not frozen:
// for those (co-op, menus) use --live.
//
// Options:
//   --url <path|url>     page (default "/")
//   --port <n>           dev server port: ALWAYS pass your own (default 5173 is the owner's)
//   --out <file.png>     the sheet (default tools/out/sheet.png)
//   --frames <n>         frames to capture (default 24)
//   --every <ms>         time between frames (default 50)
//   --cols <n>           tiles per row (default 6)
//   --tile <px>          tile width on the sheet (default 480)
//   --pick <n>           put only n evenly spaced frames on the sheet (the video and --keep still get them all)
//   --crop x,y,w,h       capture only this part of the page, in page pixels (the gun, one body)
//   --w/--h/--dpr        viewport, as shot.mjs (default 1280x720 at 1)
//   --wait <ms>          time before the trigger: frozen-clock time after the page is ready (default 500), or with --live
//                        real time after load (default 3000)
//   --script <file>      shot.mjs script run as the trigger (its `before` export is honoured)
//   --eval <js>          JS run in the page as the trigger, after --script
//   --seed <n>           Math.random seed (default 1)
//   --until <js>         expression that is true when the page is ready (default "!!window.__op2"); frozen clock only
//   --live               real time instead of the frozen clock
//   --video <out.mp4>    also write a video of the frames with ffmpeg (skipped with a message where ffmpeg is absent)
//   --slow <x>           play the video x times slower (default 1)
//   --keep               keep the frame PNGs (in <out>-frames/)
//   --timeout <s>        as shot.mjs (default 240)
// Prints one JSON object: { sheet, size, frames: [{ name, ms }], video, errors, ... }. Exit code 1 when no sheet was made.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) opt[a.slice(2)] = true;
  else { opt[a.slice(2)] = next; i++; }
}

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(String(opt.out ?? 'tools/out/sheet.png'));
const dir = join(dirname(out), `${basename(out, extname(out))}-frames`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const live = !!opt.live;
const every = Number(opt.every ?? 50);
const crop = opt.crop ? String(opt.crop).split(',').map(Number) : null;
if (crop && (crop.length !== 4 || crop.some(n => !Number.isFinite(n)))) {
  console.error('[sheet] --crop wants x,y,w,h in page pixels, e.g. --crop 400,150,640,500');
  process.exit(1);
}
const config = {
  out, dir, live, every, crop,
  frames: Number(opt.frames ?? 24),
  cols: Number(opt.cols ?? 6),
  tile: Number(opt.tile ?? 480),
  pick: opt.pick ? Number(opt.pick) : 0,
  seed: Number(opt.seed ?? 1),
  until: String(opt.until ?? '!!window.__op2'),
  wait: Number(opt.wait ?? 500),
  script: opt.script ? resolve(String(opt.script)) : null,
  eval: opt.eval ? String(opt.eval) : null,
  title: String(opt.url ?? '/'),
};

const args = [join(here, 'shot.mjs'), '--url', String(opt.url ?? '/'), '--script', join(here, 'scripts/lib/sheet-capture.mjs'),
  '--wait', String(live ? Number(opt.wait ?? 3000) : 0), '--timeout', String(opt.timeout ?? 240)];
for (const k of ['port', 'w', 'h', 'dpr']) if (opt[k] !== undefined) args.push(`--${k}`, String(opt[k]));

const child = spawn(process.execPath, args, { env: { ...process.env, OP2_SHEET: JSON.stringify(config) }, stdio: ['ignore', 'pipe', 'inherit'] });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { child.kill(sig); });
let text = '';
child.stdout.on('data', d => { text += d; });
const code = await new Promise(done => child.on('close', done));

let report = null;
try { report = JSON.parse(text); } catch { /* shot.mjs died before its report */ }
const result = report?.scriptResult ?? null;
const summary = {
  sheet: result && existsSync(out) ? out : null,
  size: result?.size ?? null,
  every,
  clock: live ? 'live' : 'frozen',
  seed: live ? null : config.seed,
  frames: result?.frames ?? [],
  video: null,
  framesDir: opt.keep ? dir : null,
  scriptResult: result?.scriptResult,
  evalResult: result?.evalResult,
  errors: report?.errors ?? [`shot.mjs exited with code ${code} and no report`],
};

if (opt.video && summary.frames.length > 1) {
  const video = resolve(String(opt.video));
  mkdirSync(dirname(video), { recursive: true });
  const span = summary.frames.at(-1).ms - summary.frames[0].ms;
  const fps = Math.max(1, (summary.frames.length - 1) * 1000 / Math.max(1, span) / Number(opt.slow ?? 1));
  // Even sizes for H.264, and a pixel format every player opens.
  const made = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', fps.toFixed(3), '-i', join(dir, 'f-%04d.png'),
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', video], { encoding: 'utf8' });
  if (made.error?.code === 'ENOENT') {
    console.error('[sheet] ffmpeg is not installed, so no video was written (the sheet is fine). Install it (Linux: apt install ffmpeg; Mac: brew install ffmpeg) to use --video.');
  } else if (made.status !== 0) {
    console.error(`[sheet] ffmpeg failed: ${(made.stderr || made.error?.message || '').trim()}`);
  } else {
    summary.video = video;
    summary.videoFps = Number(fps.toFixed(3));
  }
}
if (!opt.keep) rmSync(dir, { recursive: true, force: true });
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
process.exit(summary.sheet ? 0 : 1);
