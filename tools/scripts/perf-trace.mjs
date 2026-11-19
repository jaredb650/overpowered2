// Performance trace of a page: the slowest frames and the functions that ate them (tools/scripts/lib/trace.mjs explains the
// numbers). For "it stutters when X" reports.
//
//   node tools/shot.mjs --port <yours> --url "/?contract=crucible&autostart=1" --wait 8000 \
//     --script tools/scripts/perf-trace.mjs --out tools/out/<you>/trace.png
//
// Settings (environment):
//   TRACE_MS      how long to record (default 5000)
//   TRACE_UNTIL   JS expression to wait for before recording (default: the game is in play, so the trace is not of the
//                 loading screen; --wait alone is not enough on a busy machine)
//   TRACE_SCRIPT  another shot.mjs script to run while recording, instead of just waiting (its result is returned too)
//   TRACE_EVAL    JS run in the page right after recording starts (spawn the wave, fire the gun)
//   TRACE_TOP     how many slow frames to list (default 8; twice as many functions)
//   TRACE_KEEP    1 to also write the raw trace to trace.json beside --out (tens of MB; opens in Chrome's Performance tab
//                 or ui.perfetto.dev)
// Returns the summary as the script result. Timings taken while the machine is overloaded prove nothing: check `uptime`.
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as trace from './lib/trace.mjs';

export default async function (page, h) {
  const inner = process.env.TRACE_SCRIPT ? await import(pathToFileURL(resolve(process.env.TRACE_SCRIPT)).href) : null;
  let result;
  await page.waitForFunction(process.env.TRACE_UNTIL ?? '!!window.__op2 && (!window.__op2.game || window.__op2.game.state === "playing")', null, { timeout: 120000 });
  const { summary, events } = await trace.record(page, async () => {
    if (process.env.TRACE_EVAL) await page.evaluate(process.env.TRACE_EVAL);
    if (inner) result = await inner.default(page, h);
    else await h.sleep(Number(process.env.TRACE_MS ?? 5000));
  }, { top: Number(process.env.TRACE_TOP ?? 8) });
  if (process.env.TRACE_KEEP === '1') {
    summary.file = join(h.outDir, 'trace.json');
    writeFileSync(summary.file, JSON.stringify({ traceEvents: events }));
  }
  return inner ? { ...summary, scriptResult: result } : summary;
}
