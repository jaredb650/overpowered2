// Where one game page's memory, boot time and frame time go. Run under tools/proof-cost.mjs, which adds Chrome's own numbers:
//   node tools/proof-cost.mjs -- node tools/shot.mjs --port <port> --w 1280 --h 720 --wait 0 --script tools/scripts/page-cost.mjs
//   (give shot.mjs --url "/audio/ost/manifest.json": a small file, so the page shot.mjs opens first is not a game)
// PAGE_URL    the page to measure (default "/?contract=crucible&autostart=1"); "about:blank" measures Chrome alone
// PAGE_DRAW   0 stops the page drawing after boot (the loop still runs); m also keeps the scenes' matrices up to date
// PAGE_AUDIO  0 decodes no sound file
// PAGE_HOLD   seconds in the fight before reading (default 8)
// Returns the boot stages (ms since the page began), seconds to a running wave, the canvas size, the frame rate and the
// main-thread ms per frame, three.js's counts, and Chrome's own account of the page's memory: `heapUsedMb` is JavaScript
// objects, `buffersMb` every ArrayBuffer (typed arrays, wasm memory), `rendererMb` the whole page process (PSS).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { quiet, returning } from './coop-kit.mjs';

/** PSS in MB of the biggest renderer process of this run's browser (the game page), with its split. */
function rendererMb() {
  let best = null;
  for (const pid of execSync('pgrep -f -- --type=renderer || true').toString().split('\n').filter(Boolean)) {
    try {
      // Only this run's: the renderer's great-grandparent (zygote, zygote, browser) or grandparent chain reaches this node process.
      let p = Number(pid), mine = false;
      for (let i = 0; i < 6 && p > 1; i++) { p = Number(/\) \S (\d+)/.exec(readFileSync(`/proc/${p}/stat`, 'utf8'))[1]); if (p === process.pid) { mine = true; break; } }
      if (!mine) continue;
      const roll = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
      const pss = Number(/^Pss:\s+(\d+)/m.exec(roll)[1]) / 1024;
      if (!best || pss > best.pssMb) best = { pssMb: Math.round(pss) };
    } catch { /* gone */ }
  }
  return best?.pssMb ?? 0;
}

export default async function (page, { sleep }) {
  const target = process.env.PAGE_URL ?? '/?contract=crucible&autostart=1';
  if (target === 'about:blank') { await page.goto('about:blank'); await sleep(3000); return { blank: true }; }
  await page.addInitScript(quiet); await page.addInitScript(returning);
  // PAGE_AUDIO=0: no sound file is decoded (each becomes one silent sample), to see what the decoded sounds weigh.
  if (process.env.PAGE_AUDIO === '0') await page.addInitScript(() => {
    const stub = function () { return Promise.resolve(this.createBuffer(1, 1, 48000)); };
    AudioContext.prototype.decodeAudioData = stub; if (window.OfflineAudioContext) OfflineAudioContext.prototype.decodeAudioData = stub;
  });
  const started = Date.now();
  await page.goto(new URL(target, page.url()).href, { waitUntil: 'load', timeout: 120000 });
  const loadEvent = (Date.now() - started) / 1000;
  await page.waitForFunction(() => window.__op2?.game?.state === 'playing', null, { timeout: 150000 });
  const playing = (Date.now() - started) / 1000;
  if (process.env.PAGE_DRAW === '0') await page.evaluate(() => { window.__op2.ctx.render.render = () => {}; });
  // 'm': no drawing, but the scenes' world matrices are still brought up to date every frame, as render() does first.
  if (process.env.PAGE_DRAW === 'm') await page.evaluate(() => { const r = window.__op2.ctx.render; r.render = () => { r.scene.updateMatrixWorld(); r.viewScene.updateMatrixWorld(); }; });
  await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; const w = window.__op2.ctx.waves; if (w.phase === 'intermission') w.nextWaveIn = 0.2; });
  await sleep(Number(process.env.PAGE_HOLD ?? 8) * 1000);
  const inPage = await page.evaluate(() => {
    const { ctx } = window.__op2, r = ctx.render.renderer, mb = n => Math.round(n / 1048576);
    const marks = performance.getEntriesByType('mark').filter(m => m.name.startsWith('boot:')).map(m => [m.name.slice(5), Math.round(m.startTime)]);
    const res = performance.getEntriesByType('resource');
    const kinds = {};
    for (const e of res) { const k = e.name.split('?')[0].split('.').pop().slice(0, 5); const o = (kinds[k] ??= { n: 0, kb: 0 }); o.n++; o.kb += Math.round((e.decodedBodySize || 0) / 1024); }
    return {
      canvas: [r.domElement.width, r.domElement.height], dpr: devicePixelRatio, window: [innerWidth, innerHeight],
      heapMb: mb(performance.memory.usedJSHeapSize), heapTotalMb: mb(performance.memory.totalJSHeapSize),
      three: { ...r.info.memory, programs: r.info.programs?.length },
      stats: window.__op2.stats(), marks,
      requests: res.length, lastRequestMs: Math.round(Math.max(...res.map(e => e.responseEnd))), kinds,
      audioState: ctx.audio?.context?.state ?? null,
    };
  });
  // Chrome's own account of the page's memory, before and after a forced collection: what is live and what is boot garbage.
  const cdp = await page.context().newCDPSession(page);
  const usage = async () => { const u = await cdp.send('Runtime.getHeapUsage'); return { heapUsedMb: Math.round(u.usedSize / 1048576), heapTotalMb: Math.round(u.totalSize / 1048576), buffersMb: Math.round(u.backingStorageSize / 1048576), embedderMb: Math.round(u.embedderHeapUsedSize / 1048576) }; };
  const before = { ...await usage(), rendererMb: rendererMb() };
  await cdp.send('HeapProfiler.collectGarbage');
  await sleep(1500);
  const after = { ...await usage(), rendererMb: rendererMb() };
  return { target, draw: process.env.PAGE_DRAW ?? '1', loadEvent, playing, memory: { before, afterCollection: after }, ...inPage };
}
