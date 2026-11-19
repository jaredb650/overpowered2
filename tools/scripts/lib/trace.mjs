// Performance trace: records what Chrome's Performance tab records, and boils it down to the slowest frames and the functions
// that ate them, so a "it stutters when X" report gets an answer in a few lines instead of a 30 MB file.
//
//   import * as trace from './lib/trace.mjs';
//   export default async (page, h) => {
//     const { summary, events } = await trace.record(page, async () => { /* do the slow thing */ await h.sleep(5000); });
//     return summary;
//   };
//
// Or with no script of your own: tools/scripts/perf-trace.mjs.
//
// What a "frame" is here: one requestAnimationFrame callback on the page's main thread. `workMs` is how long the game's own
// code ran in it (CPU); `intervalMs` is the time since the frame before (what the player feels: includes waiting for the GPU,
// the compositor and other tabs' load). Function times are self times from V8's sampling profiler, one sample a millisecond,
// so anything under a few milliseconds is noise. Measured under load, timings prove nothing: check `uptime` first.

const CATEGORIES = ['devtools.timeline', 'v8', 'disabled-by-default-v8.cpu_profiler', 'blink.user_timing'];

/** Records a trace while `during()` runs. Returns { summary, events } (the raw events, for writing to a file if wanted). */
export async function record(page, during, { top = 8 } = {}) {
  const browser = page.context().browser();
  await browser.startTracing(page, { categories: CATEGORIES });
  let events;
  try {
    await during();
  } finally {
    const raw = JSON.parse((await browser.stopTracing()).toString('utf8'));
    events = raw.traceEvents ?? raw;
  }
  return { summary: summarise(events, { top }), events };
}

const ms = micro => Number((micro / 1000).toFixed(2));
const quantile = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;

/** `name (file:line)` for a profiler node; engine internals keep their bracketed names. */
function nameOf(frame) {
  const fn = frame.functionName || '(anonymous)';
  if (!frame.url) return fn;
  const file = frame.url.replace(/[?#].*$/, '').replace(/^.*\/(src|node_modules)\//, '$1/').replace(/^https?:\/\/[^/]+\//, '');
  return `${fn} (${file}:${(frame.lineNumber ?? 0) + 1})`;
}

/**
 * Pure: trace events in, a short summary out.
 *   { seconds, frames, fps, intervalMs: { median, p95, p99, worst }, workMs: { median, p95, worst },
 *     slowFrames: [{ atMs, workMs, intervalMs, gcMs, top: [{ fn, ms }] }],      the `top` longest by work
 *     functions: [{ fn, ms, percent }],                                        self time over the whole trace, main thread
 *     gc: { count, totalMs, worstMs } }
 */
export function summarise(events, { top = 8 } = {}) {
  // The page's main thread: the one with the most animation frames.
  const perThread = new Map();
  for (const e of events) {
    if (e.name !== 'FireAnimationFrame' || e.ph !== 'X') continue;
    const key = `${e.pid}:${e.tid}`;
    if (!perThread.has(key)) perThread.set(key, []);
    perThread.get(key).push(e);
  }
  const [mainKey, frameEvents] = [...perThread.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? ['', []];
  frameEvents.sort((a, b) => a.ts - b.ts);
  const onMain = e => `${e.pid}:${e.tid}` === mainKey;
  const start = frameEvents[0]?.ts ?? 0;

  // Sampling profile of that thread: node id -> name, and every sample as { at, node, self }.
  const names = new Map();
  const samples = [];
  const clocks = new Map();
  for (const e of events) {
    if (!onMain(e)) continue;
    if (e.name === 'Profile') clocks.set(e.id, e.args?.data?.startTime ?? e.ts);
    if (e.name !== 'ProfileChunk') continue;
    const data = e.args?.data ?? {};
    for (const node of data.cpuProfile?.nodes ?? []) names.set(`${e.id}:${node.id}`, nameOf(node.callFrame ?? {}));
    const ids = data.cpuProfile?.samples ?? [];
    const deltas = data.timeDeltas ?? [];
    let at = clocks.get(e.id) ?? e.ts;
    for (let i = 0; i < ids.length; i++) {
      at += deltas[i] ?? 0;
      samples.push({ at, node: `${e.id}:${ids[i]}`, self: Math.max(0, deltas[i] ?? 0) });
    }
    clocks.set(e.id, at);
  }
  samples.sort((a, b) => a.at - b.at);
  const idle = name => /^\((idle|program|root)\)$/.test(name);
  const tally = (from, to) => {
    const by = new Map();
    for (const s of samples) {
      if (s.at < from || s.at > to) continue;
      const fn = names.get(s.node) ?? '(unknown)';
      if (idle(fn)) continue;
      by.set(fn, (by.get(fn) ?? 0) + s.self);
    }
    return [...by.entries()].sort((a, b) => b[1] - a[1]);
  };

  const gcEvents = events.filter(e => onMain(e) && e.ph === 'X' && /^(MinorGC|MajorGC|V8\.GC_)/.test(e.name) && !/BackgroundThread/.test(e.name));
  const gcIn = (from, to) => gcEvents.reduce((sum, g) => sum + Math.max(0, Math.min(to, g.ts + (g.dur ?? 0)) - Math.max(from, g.ts)), 0);

  const frames = frameEvents.map((e, i) => ({
    at: e.ts, work: e.dur ?? 0, interval: i ? e.ts - frameEvents[i - 1].ts : 0,
  }));
  const works = frames.map(f => f.work).sort((a, b) => a - b);
  const intervals = frames.slice(1).map(f => f.interval).sort((a, b) => a - b);
  const span = frames.length > 1 ? frames.at(-1).at - frames[0].at : 0;
  const all = tally(-Infinity, Infinity);
  const total = all.reduce((sum, [, t]) => sum + t, 0);

  return {
    seconds: Number((span / 1e6).toFixed(2)),
    frames: frames.length,
    fps: span ? Number(((frames.length - 1) / (span / 1e6)).toFixed(1)) : 0,
    intervalMs: { median: ms(quantile(intervals, 0.5)), p95: ms(quantile(intervals, 0.95)), p99: ms(quantile(intervals, 0.99)), worst: ms(intervals.at(-1) ?? 0) },
    workMs: { median: ms(quantile(works, 0.5)), p95: ms(quantile(works, 0.95)), worst: ms(works.at(-1) ?? 0) },
    slowFrames: [...frames].sort((a, b) => b.work - a.work).slice(0, top).map(f => ({
      atMs: ms(f.at - start), workMs: ms(f.work), intervalMs: ms(f.interval), gcMs: ms(gcIn(f.at, f.at + f.work)),
      top: tally(f.at, f.at + f.work).slice(0, 3).map(([fn, t]) => ({ fn, ms: ms(t) })),
    })),
    functions: all.slice(0, top * 2).map(([fn, t]) => ({ fn, ms: ms(t), percent: total ? Number((t / total * 100).toFixed(1)) : 0 })),
    gc: { count: gcEvents.length, totalMs: ms(gcEvents.reduce((sum, g) => sum + (g.dur ?? 0), 0)), worstMs: ms(Math.max(0, ...gcEvents.map(g => g.dur ?? 0))) },
  };
}
