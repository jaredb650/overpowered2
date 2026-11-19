// Single-player slow-mo, measured: the reference the co-op time proofs are compared with, and the check that co-op's clock
// work changed nothing alone. Run on a solo page:
//
//   node tools/shot.mjs --port <port> --url "/?contract=crucible&autostart=1" --w 1280 --h 720 --wait 3000 --timeout 200 \
//     --script tools/scripts/coop-time-solo.mjs --out tools/out/coop/time/solo.png
//
// For SLOWMO (the perk) and Focus (the brain chip): the world clock's rate, the player's own clock, metres walked and rounds
// fired a second, and enemy speed, at full speed and in slow-mo. Also: no co-op notice, no gate on the clock, hit-stop works.
import { writeFileSync } from 'node:fs';
import { calm, give, spawn } from './coop-kit.mjs';

const sample = (page, uids, ms) => page.evaluate(async ([uids, ms]) => {
  const { ctx, game } = window.__op2, s = ctx.world.playerSpawns[0];
  if (game.state !== 'playing') game.setState('playing');
  ctx.player.modifiers.invulnerable = true;
  ctx.player.teleport(s.position.clone(), s.yaw);
  ctx.player.pitch = 1.1;
  ctx.weapons.refillMagazines();
  await new Promise(r => setTimeout(r, 120));
  const where = () => uids.map(u => { const e = ctx.enemies.alive.find(e => e.uid === u); return e ? [e.position.x, e.position.z] : null; });
  let shots = 0;
  const off = ctx.events.on('weapon:fired', () => shots++);
  ctx.input.simulate('forward', true); ctx.input.simulate('fire', true);
  await new Promise(r => setTimeout(r, 150));
  const a = where(), from = ctx.player.position.clone(), t0 = performance.now(), f0 = ctx.time.frame, r0 = ctx.time.realElapsed, w0 = ctx.time.elapsed, p0 = ctx.time.playerElapsed; shots = 0;
  const top = setInterval(() => ctx.weapons.refillMagazines(), 200);
  await new Promise(r => setTimeout(r, ms));
  const seconds = ctx.time.realElapsed - r0, b = where(), walked = ctx.player.position.distanceTo(from), fired = shots;
  clearInterval(top); off();
  ctx.input.simulate('forward', false); ctx.input.simulate('fire', false);
  const speeds = a.map((p, i) => p && b[i] ? Math.hypot(b[i][0] - p[0], b[i][1] - p[1]) / seconds : null).filter(v => v !== null).sort((x, y) => x - y);
  return { world: +((ctx.time.elapsed - w0) / seconds).toFixed(3), own: +((ctx.time.playerElapsed - p0) / seconds).toFixed(3), walk: +(walked / seconds).toFixed(2),
    fire: +(fired / seconds).toFixed(1), enemy: speeds.length ? +speeds[Math.floor(speeds.length / 2)].toFixed(2) : null,
    fps: Math.round((ctx.time.frame - f0) / ((performance.now() - t0) / 1000)) };
}, [uids, ms]);

export default async function (page, { sleep, outDir }) {
  const out = { checks: [], cases: {} };
  const check = (ok, message, detail) => { if (!ok) throw new Error(`${message} :: ${JSON.stringify(detail)}`); out.checks.push(message); };
  try {
    await page.waitForFunction(() => window.__op2?.game?.state === 'playing' || window.__op2?.game?.state === 'paused', null, { timeout: 120000 });
    await page.evaluate(() => { const { ctx, game } = window.__op2; game.setState('playing'); ctx.waves.nextWaveIn = 1e6; });
    await give(page, 'smg');
    const fresh = async () => { await calm(page); await page.evaluate(() => { window.__op2.ctx.waves.nextWaveIn = 1e6; }); const uids = await spawn(page, 'husk', 4, { ahead: 34, spacing: 2.5 }); await sleep(900); return uids; };
    check(await page.evaluate(() => !window.__op2.ctx.coop && window.__op2.ctx.time.gate === null && window.__op2.ctx.time.hostSteps === false), 'Solo: no co-op, no gate on the clock, no host steps');
    const run = async (key, scale, start, stop) => {
      const before = await sample(page, await fresh(), 900);
      const uids = await fresh();
      await start();
      await sleep(450);
      const during = await sample(page, uids, 900);
      const slowmo = await page.evaluate(() => +window.__op2.ctx.time.slowmo.toFixed(3));
      await stop();
      await page.waitForFunction(() => window.__op2.ctx.time.slowmo === 1, null, { timeout: 8000 });
      const c = out.cases[key] = { scale, slowmo, before, during, walkRatio: +(during.walk / before.walk).toFixed(3), fireRatio: +(during.fire / before.fire).toFixed(3), enemyRatio: +(during.enemy / before.enemy).toFixed(3) };
      check(Math.abs(during.world - scale) <= 0.03 && slowmo === scale, `Solo ${key}: the world runs at ${scale}x`, c);
      check(Math.abs(during.own - 1) <= 0.02, `Solo ${key}: the player's own clock stays at full speed`, c);
      // A gun fires on whole frames, so its measured rate moves with the frame rate: the tight bound needs a steady 40 fps.
      const steady = before.fps >= 40 && during.fps >= 40;
      check(Math.abs(c.walkRatio - 1) <= 0.1 && Math.abs(c.fireRatio - 1) <= (steady ? 0.12 : 0.3), `Solo ${key}: the player walks and fires as fast as at full speed${steady ? '' : ' (loose bound: the page ran below 40 fps)'}`, c);
      check(Math.abs(c.enemyRatio - scale) <= 0.14, `Solo ${key}: enemies walk at ${scale}x their speed`, c);
    };
    await run('slowmo', 0.25, () => page.evaluate(() => window.__op2.ctx.progression.grant('slowmo')), () => page.evaluate(() => window.__op2.ctx.progression.perks.stop('slowmo')));
    const tap = async () => { await page.evaluate(() => { const { ctx } = window.__op2, chips = ctx.contracts.chips; chips.rack.fit('focus', true); ctx.input.simulate('sonar', true); }); await sleep(60); await page.evaluate(() => window.__op2.ctx.input.simulate('sonar', false)); };
    await page.evaluate(() => { const chips = window.__op2.ctx.contracts.chips; chips.rack.fit('focus', true); chips.meter = 1; chips.rest = 0; });
    await run('focus', 0.35, tap, tap);
    check(await page.evaluate(() => !document.querySelector('.ct')), 'Solo: no co-op slow-mo notice exists');
    const stop = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      ctx.time.hitStop(0.3, 0.04);
      await new Promise(r => setTimeout(r, 100));
      const during = ctx.time.scale;
      await new Promise(r => setTimeout(r, 600));
      return { during, after: ctx.time.scale };
    });
    out.hitStop = stop;
    check(stop.during < 0.1 && stop.after === 1, 'Solo: hit-stop still freezes the frame, and lets go', stop);
    return out;
  } finally {
    writeFileSync(`${outDir}/time-solo-evidence.json`, JSON.stringify(out, null, 2));
  }
}
