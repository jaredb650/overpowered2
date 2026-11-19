// Smoke proof for the kit itself: a pair on a fresh browser profile reaches a live Crucible match, and each page's frame rate.
//   node tools/shot.mjs --port <port> --dpr 2 --w 1440 --h 900 --wait 500 --timeout 400 --script tools/scripts/coop-smoke.mjs --out tools/out/coop/smoke.png
import { writeFileSync } from 'node:fs';
import { inMatch, kit, startPair, state } from './coop-kit.mjs';

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const { check, progress, shot } = kit(outDir, 'smoke', out, sleep);
  let guest;
  try {
    out.renderer = await host.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2'); const e = gl?.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    ({ guest } = await startPair(host, { mode: 'Crucible mode', password: 'coop-smoke', out, progress, sleep }));
    await inMatch([host, guest], 'crucible');
    check(true, 'A fresh profile reaches the match: the host was not sent to Retraining');
    for (const page of [host, guest]) await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
    await guest.waitForFunction(() => window.__op2.ctx.enemies.alive.length >= 6, null, { timeout: 90000 });
    await sleep(6000);
    out.live = { host: await state(host), guest: await state(guest) };
    out.fps = { host: await host.evaluate(() => window.__op2.stats().fps), guest: await guest.evaluate(() => window.__op2.stats().fps) };
    check(out.live.guest.enemies > 0 && out.live.guest.wave === out.live.host.wave, "The host's wave is on the guest's screen", out.live);
    await shot(host, 'host'); await shot(guest, 'guest');
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/smoke-evidence.json`, JSON.stringify(out, null, 2));
    await guest?.close();
  }
}
