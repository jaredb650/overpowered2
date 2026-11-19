// GPU memory sampling for leak checks, with the dev-only `webgl-memory` package injected by the test harness (never by game
// code). Used by tools/scripts/soak-memory.mjs; usable from any shot.mjs script:
//
//   import * as glmem from './lib/glmem.mjs';
//   export const before = page => glmem.inject(page);          // before the page loads: it wraps canvas.getContext
//   export default async page => { ...; const s = await glmem.sample(page); ... glmem.verdict(samples) };
//
// A sample is flat numbers: GPU bytes by kind, GPU object counts, three.js's own counts (renderer.info) and the JS heap after a
// forced collection. Not covered: contexts made inside web workers.
import { createRequire } from 'node:module';

/** Injects webgl-memory and a note of every WebGL context the page makes. Call from a script's `before` export. */
export async function inject(page) {
  await page.addInitScript({ path: createRequire(import.meta.url).resolve('webgl-memory') });
  await page.addInitScript(() => {
    const seen = new Set();
    globalThis.__glmem = seen;
    for (const Canvas of [globalThis.HTMLCanvasElement, globalThis.OffscreenCanvas]) {
      if (!Canvas) continue;
      const getContext = Canvas.prototype.getContext;
      Canvas.prototype.getContext = function (type, ...rest) {
        const context = getContext.call(this, type, ...rest);
        if (context && /^webgl/.test(String(type))) seen.add(context);
        return context;
      };
    }
  });
}

/** One reading. `gpu*` are bytes; `n*` are live GPU objects; `three*` is renderer.info; `heap` is JS bytes after a collection. */
export async function sample(page) {
  let heap = null;
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    heap = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    await cdp.detach();
  } catch { /* not Chromium: no heap figure */ }
  const gl = await page.evaluate(() => {
    const out = { contexts: 0, gpuTotal: 0, gpuTexture: 0, gpuBuffer: 0, gpuRenderbuffer: 0, gpuDrawingbuffer: 0,
      nTexture: 0, nBuffer: 0, nRenderbuffer: 0, nFramebuffer: 0, nProgram: 0, nShader: 0, nVertexArray: 0, nQuery: 0, nSync: 0 };
    for (const context of globalThis.__glmem ?? []) {
      const info = context.isContextLost() ? null : context.getExtension('GMAN_webgl_memory')?.getMemoryInfo();
      if (!info) continue;
      out.contexts++;
      out.gpuTotal += info.memory.total; out.gpuTexture += info.memory.texture; out.gpuBuffer += info.memory.buffer;
      out.gpuRenderbuffer += info.memory.renderbuffer; out.gpuDrawingbuffer += info.memory.drawingbuffer;
      const r = info.resources;
      out.nTexture += r.texture; out.nBuffer += r.buffer; out.nRenderbuffer += r.renderbuffer; out.nFramebuffer += r.framebuffer;
      out.nProgram += r.program; out.nShader += r.shader; out.nVertexArray += r.vertexArray; out.nQuery += r.query; out.nSync += r.sync;
    }
    const three = globalThis.__op2?.ctx?.render?.renderer?.info;
    if (three) Object.assign(out, { threeGeometries: three.memory.geometries, threeTextures: three.memory.textures, threePrograms: three.programs?.length ?? 0 });
    return out;
  });
  return { ...gl, heap };
}

const BYTES = /^(gpu|heap)/;

/**
 * Reads a run of samples (one per round) and says, for each number, whether it came back to where it was.
 * The first `warm` rounds are left out: the first round or two fill the pools and compile the shaders.
 *   flat    the last round is within tolerance of the first counted one (bytes: 2 % or 1 MB; counts: 2 % or 4)
 *   step    it rose, but the second half of the run is flat: a pool or cache that filled and then held
 *   grows   it rose and was still rising in the second half: a leak, or a pool that has not reached its cap yet
 *   shrinks it fell
 * Returns { rounds, metrics: { name: { first, last, growth, perRound, verdict } }, growing: [names], holds }.
 */
export function verdict(samples, { warm = 1 } = {}) {
  const run = samples.slice(warm);
  const metrics = {};
  const growing = [];
  if (run.length < 3) return { rounds: run.length, metrics, growing, holds: null, note: `needs at least 3 rounds after the ${warm} warm-up round(s)` };
  const mid = Math.floor((run.length - 1) / 2);
  for (const name of Object.keys(run[0])) {
    const values = run.map(s => s[name]);
    if (values.some(v => typeof v !== 'number')) continue;
    const first = values[0], last = values.at(-1);
    const tolerance = v => BYTES.test(name) ? Math.max(Math.abs(v) * 0.02, 1048576) : Math.max(Math.abs(v) * 0.02, 4);
    const growth = last - first;
    const late = last - values[mid];
    let verdictOf = 'flat';
    if (growth < -tolerance(first)) verdictOf = 'shrinks';
    else if (growth > tolerance(first)) verdictOf = late > tolerance(values[mid]) / 2 ? 'grows' : 'step';
    metrics[name] = { first, last, growth, perRound: Math.round(growth / (run.length - 1)), verdict: verdictOf };
    if (verdictOf === 'grows') growing.push(name);
  }
  return { rounds: run.length, metrics, growing, holds: growing.length === 0 };
}

/** Bytes as a short string for reports. */
export const mb = bytes => bytes === null || bytes === undefined ? 'n/a' : `${(bytes / 1048576).toFixed(1)} MB`;
