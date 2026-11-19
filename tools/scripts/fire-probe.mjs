// Fire on bodies: full-size stills at chosen times and the numbers behind them, on the frozen clock (same picture every
// run). The scene is tools/scripts/fire-look.mjs's (same FIRE_CASE, FIRE_DIST, FIRE_TYPE, FIRE_SIDE, FIRE_GUN).
//
//   FIRE_CASE=fast FIRE_SHOTS=0.5,2,6,12,40 node tools/shot.mjs --port <yours> --url "/?map=range" --wait 0 \
//     --script tools/scripts/fire-probe.mjs --dpr 2 --w 1440 --h 900 --timeout 300 --out tools/out/<you>/fast.png
//
// Env: FIRE_SHOTS  seconds after the scene starts at which to take a still (default "1,3,6,12"); each is written beside
//                  --out as <name>-<seconds>s.png, and one line of numbers per still goes to stderr.
import * as steady from './lib/steady.mjs';
import fireLook from './fire-look.mjs';

const SHOTS = (process.env.FIRE_SHOTS ?? '1,3,6,12').split(',').map(Number).sort((a, b) => a - b);

export const before = page => steady.install(page, { seed: Number(process.env.STEADY_SEED ?? 1) });

export default async function fireProbe(page, h0) {
  const h = steady.helpers(page, h0);
  await steady.ready(page, { until: '!!(window.__op2 && window.__op2.ctx && window.__lab)' });
  const scene = await fireLook(page, h);
  const rows = [];
  let at = 0;
  for (const t of SHOTS) {
    const n = Math.round((t - at) * 1000 / steady.FRAME_MS);
    await steady.frames(page, n);
    at += n * steady.FRAME_MS / 1000;
    const row = await page.evaluate(() => {
      const { ctx } = window.__op2;
      const { made, state } = window.__fire;
      const e = made[0];
      const info = ctx.render.renderer.info;
      const decals = ctx.render.decals;
      return {
        alive: e.alive, deadAt: state.deadAt === undefined ? null : +state.deadAt.toFixed(2), bites: state.bites,
        burn: +(e.char.burn ?? -1).toFixed(3), burning: +e.burning.toFixed(2), charred: +e.charred.toFixed(3),
        fire: ctx.gore.fire?.stats?.() ?? null, gore: ctx.gore.stats?.() ? { corpses: ctx.gore.stats().corpses, limbs: ctx.gore.stats().limbs } : null,
        decals: decals.total ?? decals.count ?? decals.mesh?.count ?? null, calls: info.render.calls, tris: info.render.triangles,
      };
    });
    row.t = +at.toFixed(2);
    rows.push(row);
    console.error('[fire-probe]', JSON.stringify(row));
    await h.shot(`${String(t).replace('.', '_')}s`);
  }
  return { scene, rows };
}
