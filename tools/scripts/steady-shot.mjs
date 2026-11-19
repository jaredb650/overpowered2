// A repeatable screenshot: freezes the clock, seeds Math.random, runs an exact number of frames, then takes the shot.
// Two runs give the same picture (prove it with tools/diff.mjs). See tools/scripts/lib/steady.mjs for what is and is not frozen.
//
//   node tools/shot.mjs --port <yours> --url "/?sandbox=gore" --wait 0 --script tools/scripts/steady-shot.mjs --out tools/out/<you>/a.png
//
// Settings (environment):
//   STEADY_SEED    seed for Math.random (default 1)
//   STEADY_FRAMES  frames of 16 ms to run once the page is ready (default 120, about 2 s)
//   STEADY_UNTIL   JS expression that is true when the page is ready (default "!!window.__op2")
//   STEADY_EVAL    JS run in the page once it is ready, before the frames (spawn something, start an animation)
import * as steady from './lib/steady.mjs';

export const before = page => steady.install(page, { seed: Number(process.env.STEADY_SEED ?? 1) });

export default async function (page) {
  const loading = await steady.ready(page, { until: process.env.STEADY_UNTIL ?? '!!window.__op2' });
  if (process.env.STEADY_EVAL) await page.evaluate(process.env.STEADY_EVAL);
  const frames = Number(process.env.STEADY_FRAMES ?? 120);
  await steady.frames(page, frames);
  return { seed: Number(process.env.STEADY_SEED ?? 1), loadingFrames: loading, frames };
}
