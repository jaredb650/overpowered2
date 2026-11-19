// The part of tools/sheet.mjs that runs inside tools/shot.mjs (so it shares shot.mjs's browser, GPU flags and machine-wide
// browser slot): captures the frames and draws the contact sheet. Not for direct use: run tools/sheet.mjs.
// Its settings arrive as JSON in OP2_SHEET.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as steady from './steady.mjs';
import { label, layout, pick, sheetHtml } from '../../lib/sheet-layout.mjs';

const cfg = JSON.parse(process.env.OP2_SHEET ?? '{}');
const user = cfg.script ? await import(pathToFileURL(cfg.script).href) : null;

export async function before(page, h) {
  if (!cfg.live) await steady.install(page, { seed: cfg.seed });
  await user?.before?.(page, h);
}

export default async function (page, h0) {
  const h = cfg.live ? h0 : steady.helpers(page, h0);
  let loading = null;
  if (!cfg.live) {
    loading = await steady.ready(page, { until: cfg.until });
    await steady.advance(page, cfg.wait);
  }
  const scriptResult = user?.default ? await user.default(page, h) : undefined;
  const evalResult = cfg.eval ? await page.evaluate(cfg.eval) : undefined;

  // The frames. Frozen clock: step to each time exactly (whole 16 ms frames) and shoot. Live: shoot as close to each time as
  // the machine allows and print the time it really was.
  const clip = cfg.crop ? { x: cfg.crop[0], y: cfg.crop[1], width: cfg.crop[2], height: cfg.crop[3] } : undefined;
  const frames = [];
  const start = performance.now();
  let steppedFrames = 0;
  for (let i = 0; i < cfg.frames; i++) {
    let ms;
    if (cfg.live) {
      const due = start + i * cfg.every - performance.now();
      if (due > 0) await h0.sleep(due);
      ms = performance.now() - start;
    } else {
      const target = Math.round(i * cfg.every / steady.FRAME_MS);
      await steady.frames(page, target - steppedFrames);
      steppedFrames = target;
      ms = steppedFrames * steady.FRAME_MS;
    }
    const name = `f-${String(i).padStart(4, '0')}.png`;
    await page.screenshot({ path: join(cfg.dir, name), clip });
    frames.push({ name, ms: Math.round(ms) });
  }

  // The sheet is drawn by a page of its own (device pixel ratio 1), which shrinks the frames and prints the times.
  const view = page.viewportSize();
  const shown = pick(frames.length, cfg.pick);
  const grid = layout({ count: shown.length, cols: cfg.cols, tile: cfg.tile, frameW: clip?.width ?? view.width, frameH: clip?.height ?? view.height });
  const clock = cfg.live ? 'real time (times are approximate)' : `frozen clock, seed ${cfg.seed}`;
  const html = sheetHtml({
    grid,
    tiles: shown.map(i => ({ src: frames[i].name, text: label(i, frames[i].ms) })),
    title: `${cfg.title}   ·   ${frames.length} frames, one every ${cfg.every} ms   ·   ${clock}`,
  });
  const context = await page.context().browser().newContext({ viewport: { width: grid.width, height: grid.height }, deviceScaleFactor: 1 });
  try {
    const sheet = await context.newPage();
    await sheet.route('http://sheet.invalid/**', route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      return name ? route.fulfill({ path: join(cfg.dir, name), contentType: 'image/png' }) : route.fulfill({ contentType: 'text/html', body: html });
    });
    await sheet.goto('http://sheet.invalid/');
    await sheet.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0), null, { timeout: 60000 });
    await sheet.screenshot({ path: cfg.out });
  } finally {
    await context.close();
  }
  return { sheet: cfg.out, size: [grid.width, grid.height], frames, loading, scriptResult, evalResult };
}
