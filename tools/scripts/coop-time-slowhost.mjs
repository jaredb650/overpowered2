// Co-op time proof, T1: a host below 20 fps must not run the world in slow motion for everyone.
//
//   node tools/shot.mjs --port <port> --w 1280 --h 720 --wait 500 --timeout 300 --script tools/scripts/coop-time-slowhost.mjs --out tools/out/coop/time/slowhost.png
//
// The host page is capped at 15, then 10 frames a second while the guest runs free. Asserted: the host's world clock keeps
// real speed (it takes several world steps a frame), the guest's copies of the host's enemies walk as fast as with the host
// uncapped, and a single click on the host still fires a single round. Control: the same 10 fps with the fix switched off
// runs the world at half speed, which is what every guest saw before.
import { writeFileSync } from 'node:fs';
import { calm, give, kit, live, spawn, startParty } from './coop-kit.mjs';

/** Caps this page's animation frames (0: no cap), on top of the kit's own wrapper. */
const cap = (page, fps) => page.evaluate(fps => {
  window.__rafBase ??= window.requestAnimationFrame.bind(window);
  const raf = window.__rafBase;
  window.requestAnimationFrame = fps > 0 ? callback => { const due = performance.now() + 1000 / fps - 4; const tick = now => (now >= due ? callback(now) : raf(tick)); return raf(tick); } : raf;
}, fps);

/** Over `ms` of wall time on this page: the world clock's rate, frames and world steps a second, and the tracked enemies' median speed. */
const rates = (page, uids, ms) => page.evaluate(async ([uids, ms]) => {
  const { ctx } = window.__op2;
  const where = () => uids.map(u => { const e = ctx.enemies.alive.find(e => e.uid === u); return e ? [e.position.x, e.position.z] : null; });
  let frames = 0, run = true;
  const count = () => { frames++; if (run) requestAnimationFrame(count); };
  requestAnimationFrame(count);
  // Both ends of the window are read on a frame, after the game's own update: positions and clocks only change there.
  const frameEnd = () => new Promise(r => requestAnimationFrame(r));
  await frameEnd();
  const a = where(), t0 = performance.now(), w0 = ctx.time.elapsed, s0 = ctx.time.frame; frames = 0;
  await new Promise(r => setTimeout(r, ms));
  await frameEnd();
  const seconds = (performance.now() - t0) / 1000, b = where(); run = false;
  const speeds = a.map((p, i) => p && b[i] ? Math.hypot(b[i][0] - p[0], b[i][1] - p[1]) / seconds : null).filter(v => v !== null).sort((x, y) => x - y);
  return { world: +((ctx.time.elapsed - w0) / seconds).toFixed(3), fps: +(frames / seconds).toFixed(1), steps: +((ctx.time.frame - s0) / seconds).toFixed(1),
    enemy: speeds.length ? +speeds[Math.floor(speeds.length / 2)].toFixed(2) : null };
}, [uids, ms]);

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [], phases: {} };
  const tag = 'time-slowhost';
  const { check, progress } = kit(outDir, tag, out, sleep);
  let party;
  try {
    party = await startParty(host, { mode: 'crucible', players: 2, out, progress, sleep });
    await live(party, { enemies: 4 });
    const guest = party.guest;
    // Guns down on both pages: nothing staggers the walkers being timed.
    const phase = async (key, fps, hostSteps = true) => {
      progress(`${key}: host ${fps || 'uncapped'} fps${hostSteps ? '' : ', the fix switched off'}`);
      await cap(host, 0);
      await calm(host);
      const uids = await spawn(host, 'husk', 4, { ahead: 34, spacing: 2.5 });
      await guest.waitForFunction(uids => uids.every(u => window.__op2.ctx.enemies.alive.some(e => e.uid === u)), uids, { timeout: 15000 });
      await host.evaluate(on => { window.__op2.ctx.time.hostSteps = on; }, hostSteps);
      await cap(host, fps);
      await sleep(1200);
      const [h, g] = await Promise.all([rates(host, uids, 4000), rates(guest, uids, 4000)]);
      await host.evaluate(() => { window.__op2.ctx.time.hostSteps = true; });
      return out.phases[key] = { host: h, guest: g };
    };
    const free = await phase('uncapped', 0);
    const f15 = await phase('15fps', 15);
    const f10 = await phase('10fps', 10);
    const old = await phase('10fps-without-the-fix', 10, false);
    await cap(host, 0);
    check(f15.host.fps < 17 && f10.host.fps < 11.5, 'The host page really ran at 15 and at 10 frames a second', [f15.host.fps, f10.host.fps]);
    check(f15.host.world >= 0.97 && f15.host.world <= 1.03, "Host at 15 fps: the world clock keeps real speed", f15.host);
    check(f10.host.world >= 0.97 && f10.host.world <= 1.03, "Host at 10 fps: the world clock keeps real speed", f10.host);
    check(f15.host.steps > f15.host.fps * 1.8 && f10.host.steps > f10.host.fps * 1.8, 'The host takes two world steps a frame at 15 and at 10 fps (each one at most 1/20 s, as single player at 20 fps)', [f15.host.steps, f10.host.steps]);
    check(free.guest.enemy > 2, "The guest sees the host's enemies walking (uncapped host)", free);
    check(Math.abs(f15.guest.enemy / free.guest.enemy - 1) <= 0.1, "Host at 15 fps: the guest's enemies walk as fast as with the host uncapped", [free.guest.enemy, f15.guest.enemy]);
    check(Math.abs(f10.guest.enemy / free.guest.enemy - 1) <= 0.1, "Host at 10 fps: the guest's enemies walk as fast as with the host uncapped", [free.guest.enemy, f10.guest.enemy]);
    check(old.host.world < 0.6 && old.guest.enemy / free.guest.enemy < 0.65, '(Control) Without the fix the same 10 fps host runs the world, and the guest\'s enemies, at half speed', old);

    // One click is one round, even when the frame it lands in is several world steps.
    await cap(host, 10);
    await give(host, 'judge');
    await calm(host);
    const rounds = await host.evaluate(async () => {
      const { ctx, game } = window.__op2;
      if (game.state !== 'playing') game.setState('playing');
      ctx.weapons.refillMagazines(); ctx.player.pitch = 1.1;
      await new Promise(r => setTimeout(r, 600));
      let shots = 0; const off = ctx.events.on('weapon:fired', () => shots++);
      const yaw = ctx.player.yaw;
      ctx.input.simulate('fire', true); ctx.input.simulateLook(100, 0);
      await new Promise(r => setTimeout(r, 250));
      ctx.input.simulate('fire', false);
      await new Promise(r => setTimeout(r, 300));
      off();
      return { shots, turned: Math.abs(ctx.player.yaw - yaw) };
    });
    await cap(host, 0);
    await host.evaluate(() => { window.__lookRef = null; });
    const ref = await host.evaluate(async () => {
      const { ctx } = window.__op2; const yaw = ctx.player.yaw;
      ctx.input.simulateLook(100, 0);
      await new Promise(r => setTimeout(r, 300));
      return Math.abs(ctx.player.yaw - yaw);
    });
    out.input = { ...rounds, turnedUncapped: ref };
    check(rounds.shots === 1, 'Host at 10 fps: one click of a semi-automatic fires one round, not one a world step', rounds);
    check(Math.abs(rounds.turned - ref) < 1e-3, 'Host at 10 fps: a mouse move turns the view once, not once a world step', out.input);
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/${tag}-evidence.json`, JSON.stringify(out, null, 2));
    for (const page of party?.guests ?? []) await page.close().catch(() => {});
  }
}
