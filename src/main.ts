import { chunkBootDone, importRetry, installChunkRecovery } from './core/chunkRetry';
import { classifyError } from './core/errors';
import { report, reporter, startReporting } from './core/report';
import { installGlobalCapture } from './core/capture';
import { showFatalError } from './ui/errorReport';
import { LOOPBACK } from './net/mode';

startReporting();
installGlobalCapture(showFatalError);
installChunkRecovery(showFatalError);
const bootStarted = performance.now();
/**
 * Entry point.
 *   /                 -> the game
 *   /?sandbox=<name>  -> src/sandbox/<name>.ts (default export is an async function)
 */
const params = new URLSearchParams(location.search);
const sandbox = params.get('sandbox');

async function boot(): Promise<void> {
  if (sandbox) {
    const mods = import.meta.glob<{ default: (params: URLSearchParams) => Promise<void> }>('./sandbox/*.ts');
    const load = mods[`./sandbox/${sandbox}.ts`];
    if (!load) throw new Error(`Unknown sandbox "${sandbox}". Available: ${Object.keys(mods).join(', ')}`);
    const mod = await load();
    await mod.default(params);
    return;
  }
  // One tab runs the game; another waits behind "Play here instead" (core/oneTab.ts). Not on the loopback test transport
  // (net/mode.ts, dev pages only), whose players are tabs of one browser.
  if (!LOOPBACK) await (await importRetry(() => import('./core/oneTab'))).claimTab();
  const { startGame } = await importRetry(() => import('./core/Game'));
  await startGame(params);
}

boot().then(() => { chunkBootDone(); report('BOOT_OK', { durationMs: performance.now() - bootStarted }); }).catch(async err => {
  console.error(err);
  // A co-op match's handoff was read on the way in: put it back so Reload rejoins the match. Loaded already, so no fetch.
  await import('./net/session').then(s => s.restoreHandoff()).catch(() => {});
  const code = classifyError(err);
  report(code, { error: err, stage: 'boot' });
  reporter.flush();
  showFatalError(code, err);
});
