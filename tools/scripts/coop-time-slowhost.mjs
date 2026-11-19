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

/**
 * Over `ms` of wall time on this page: the world clock's rate, frames and world steps a second, the share of the window lost
 * to stalls (frames over a quarter second, which no host plays out in full), and how far the tracked enemies really moved
 * against what their own speed says they should have at real speed (1: the world is at real speed on this screen).
 */
const rates = (page, uids, ms) => page.evaluate(async ([uids, ms]) => {
  const { ctx } = window.__op2;
  const tracks = uids.map(() => ({ path: 0, due: 0, last: null }));
  let frames = 0, run = true, lastAt = performance.now(), stalled = 0;
  const follow = () => {
    const now = performance.now(), gap = now - lastAt; lastAt = now;
    frames++; stalled += Math.max(0, gap - 250);
    uids.forEach((u, i) => {
      const e = ctx.enemies.alive.find(e => e.uid === u), w = tracks[i];
      if (!e) { w.last = null; return; }
      if (w.last) { w.path += Math.hypot(e.position.x - w.last[0], e.position.z - w.last[1]); w.due += Math.hypot(e.velocity.x, e.velocity.z) * gap / 1000; }
      w.last = [e.position.x, e.position.z];
    });
    if (run) requestAnimationFrame(follow);
  };
  // Both ends of the window are read on a frame, after the game's own update: positions and clocks only change there.
  const frameEnd = () => new Promise(r => requestAnimationFrame(r));
  await frameEnd();
  requestAnimationFrame(follow);
  const t0 = performance.now(), w0 = ctx.time.elapsed, s0 = ctx.time.frame; frames = 0; stalled = 0; lastAt = t0;
  await new Promise(r => setTimeout(r, ms));
  await frameEnd();
  const seconds = (performance.now() - t0) / 1000; run = false;
  const moved = tracks.filter(w => w.due > 1).map(w => w.path / w.due).sort((x, y) => x - y);
  return { world: +((ctx.time.elapsed - w0) / seconds).toFixed(3), fps: +(frames / seconds).toFixed(1), steps: +((ctx.time.frame - s0) / seconds).toFixed(1),
    stalled: +(stalled / 1000 / seconds).toFixed(3), enemy: moved.length ? +moved[Math.floor(moved.length / 2)].toFixed(2) : null };
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
    // The caps are ceilings: on a loaded machine the page lands a little under them. Real speed is owed for every frame up to a
    // quarter second; the share of the window spent in longer stalls (`stalled`) is not.
    const real = r => r.host.world >= 0.97 - r.host.stalled && r.host.world <= 1.03;
    check(f15.host.fps < 17 && f10.host.fps < 11.5, 'The host page really ran at 15 and at 10 frames a second, or under', [f15.host.fps, f10.host.fps]);
    check(real(f15), `Host at ${f15.host.fps} fps (cap 15): the world clock keeps real speed`, f15.host);
    check(real(f10), `Host at ${f10.host.fps} fps (cap 10): the world clock keeps real speed`, f10.host);
    check(f15.host.steps > f15.host.fps * 1.5 && f10.host.steps > f10.host.fps * 1.8, 'The host takes two or more world steps a frame (each at most 1/20 s, as single player at 20 fps)', [f15.host.steps, f10.host.steps]);
    check(free.guest.enemy !== null && free.guest.enemy > 0.8, "Host uncapped: the guest's copies of the enemies move at their own speed", free);
    check(f15.guest.enemy >= free.guest.enemy - 0.12 - f15.host.stalled, "Host at 15 fps: the guest's enemies move as fast as with the host uncapped", [free.guest.enemy, f15.guest.enemy]);
    check(f10.guest.enemy >= free.guest.enemy - 0.12 - f10.host.stalled, "Host at 10 fps: the guest's enemies move as fast as with the host uncapped", [free.guest.enemy, f10.guest.enemy]);
    check(old.host.world < 0.65 && old.guest.enemy < 0.7, '(Control) Without the fix the same slow host runs the world, and the guest\'s enemies, at about half speed', old);

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
