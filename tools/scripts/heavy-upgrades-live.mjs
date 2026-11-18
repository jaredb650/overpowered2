// The autocannon's flak shells and the Lance's full beam in the real game on the Test Range: a flak burst in front of a
// knot of husks (from the gun, and from the side with the world held still), and a full beam down a column of troopers (from
// the gun, and from the side, held still mid-beam). Run it against HEAD for the "before" beam.
//
//   node tools/shot.mjs --port 5209 --url "/?map=range" --script tools/scripts/heavy-upgrades-live.mjs --wait 500 --timeout 300 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/heavy-up/live.png --quiet
//
// UP_ONLY=flak,lance picks sets; UP_TAG names the stills (before / after).
const only = (process.env.UP_ONLY ?? 'flak,lance').split(',');
const tag = process.env.UP_TAG ?? 'after';

export default async function heavyLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    window.V = ctx.player.position.constructor;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end) await window.frame();
    };
    window.mine = async seconds => {
      const end = ctx.time.playerElapsed + seconds;
      while (ctx.time.playerElapsed < end) await window.frame();
    };
    window.advance = async seconds => {
      const end = ctx.time.elapsed + seconds;
      for (let i = 0; i < 400 && ctx.time.elapsed < end - 1e-4; i++) {
        lab.step(1);
        await window.frame();
        await window.frame();
      }
    };
    window.wipe = async () => {
      ctx.enemies.reset();
      lab.spawner.clearBodies();
      ctx.fx.clear();
      await window.frame();
    };
    window.aimAt = (x, y, z) => {
      const p = ctx.player;
      p.yaw = Math.atan2(-(x - p.eye.x), -(z - p.eye.z));
      p.pitch = Math.atan2(y - p.eye.y, Math.hypot(x - p.eye.x, z - p.eye.z));
    };
    window.start = { at: ctx.player.position.clone(), yaw: ctx.player.yaw };
    window.home = () => {
      const p = ctx.player;
      p.teleport(window.start.at.clone().setY(window.start.at.y + 0.1), window.start.yaw);
      p.pitch = 0;
      p.velocity.set(0, 0, 0);
    };
    window.fwd = () => new window.V(-Math.sin(window.start.yaw), 0, -Math.cos(window.start.yaw));
    window.side = () => new window.V(Math.cos(window.start.yaw), 0, -Math.sin(window.start.yaw));
    window.spot = (d, x = 0) => window.start.at.clone().addScaledVector(window.fwd(), d).addScaledVector(window.side(), x);
    window.setSpawn = (id, ai = 'off') => {
      Object.assign(lab.settings, { spawn: id, ai, arsenal: false });
      lab.changed();
    };
    window.stat = e => ({ alive: e.alive, hp: Math.round(e.health), lost: [...(e.char?.severed ?? [])].length });
    /** Puts the eye `d` m down the range and `x` across, looking at the floor point `d2`, `x2` at height `y2`. */
    window.lookFrom = async (d, x, y, d2, x2, y2) => {
      const p = ctx.player;
      const from = window.spot(d, x);
      p.teleport(from.setY(from.y + y), 0);
      const at = window.spot(d2, x2);
      window.aimAt(at.x, at.y + y2, at.z);
      await window.frame();
      await window.frame();
    };
  });
  const out = {};
  await page.mouse.click(400, 500);
  await h.sleep(500);
  const shot = async name => { await h.sleep(60); await h.shot(`${tag}-${name}`); };

  if (only.includes('flak')) {
    out.flak = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      window.home();
      window.setSpawn('husk');
      window.__lab.draw('autocannon');
      ctx.weapons.grantMod('autocannonFlak');
      ctx.weapons.fitMod('autocannonFlak', true);
      ctx.weapons.refillMagazines();
      await window.world(0.5);
      // A knot of husks: one out front, the rest behind him, spread.
      const at = [[16, 0], [19, -1.6], [19.5, 1.4], [21, 0.2], [22.5, -2.4], [23, 2.2], [24.5, -0.6], [25, 1.2], [26, -1.8]];
      window.knot = at.map(([d, x]) => window.__lab.spawner.place('husk', window.spot(d, x), 'off'));
      await window.world(0.8);
      const lead = window.knot[0];
      window.aimAt(lead.center.x, lead.center.y, lead.center.z);
      await window.world(0.2);
      return { placed: window.knot.length, weapon: ctx.weapons.current, flak: ctx.weapons.fitted.has('autocannonFlak') };
    });
    // Held still, to catch the burst. The trigger runs on the player's clock, the shell on the world's.
    await page.evaluate(async () => {
      const { ctx } = window.__op2;
      window.__lab.togglePause();
      await window.frame();
      ctx.input.simulate('fire', true);
      await window.frame();
      await window.frame();
      ctx.input.simulate('fire', false);
      for (let i = 0; i < 40 && ctx.combat.projectiles.active.some(p => p.flak); i++) await window.advance(1 / 60);
      window.burstAt = ctx.combat.projectiles.active.length;
    });
    await window_shot(page, shot, 'flak-burst-eye');
    await page.evaluate(() => window.advance(1 / 30));
    await shot('flak-burst-eye-2');
    await page.evaluate(() => window.lookFrom(12, 11, 1.7, 20, 0, 1.1));
    await shot('flak-burst-side');
    await page.evaluate(() => window.lookFrom(9, 4, 2.6, 20, 0, 0.9));
    await shot('flak-burst-high');
    await page.evaluate(async () => {
      window.__lab.togglePause();
      await window.world(1.2);
    });
    await shot('flak-after-side');
    out.flakAfter = await page.evaluate(() => window.knot.map(window.stat));
  }

  if (only.includes('lance')) {
    out.lance = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      window.home();
      window.setSpawn('trooper');
      window.__lab.draw('lance');
      ctx.weapons.refillMagazines();
      await window.world(0.5);
      window.col = [14, 18, 22, 27, 33].map(d => window.__lab.spawner.place('trooper', window.spot(d, 0), 'off'));
      await window.world(0.8);
      const far = window.col[window.col.length - 1];
      window.aimAt(far.center.x, far.center.y - 0.2, far.center.z);
      await window.world(0.2);
      ctx.input.simulate('fire', true);
      const t0 = performance.now();
      while (ctx.weapons.charge < 1 - 1e-6 && performance.now() - t0 < 6000) await window.frame();
      await window.frame();
      ctx.input.simulate('fire', false);
      await window.mine(0.25);
      // Held still mid-beam: a still at dpr 2 takes longer than the beam's second.
      window.__lab.togglePause();
      await window.frame();
      await window.frame();
      return { beaming: ctx.weapons.lance.beaming };
    });
    await shot('lance-hip');
    await page.evaluate(() => window.lookFrom(10, 13, 2.2, 18, 0, 1));
    await shot('lance-wide');
    await page.evaluate(() => window.lookFrom(-6, 3.5, 3.2, 16, 0, 0.2));
    await shot('lance-behind');
    out.lanceCost = await page.evaluate(async () => {
      window.__lab.togglePause();
      await window.world(1.5);
      const r = window.__op2.ctx.render.renderer.info;
      return { calls: r.render.calls, triangles: r.render.triangles, programs: r.programs?.length };
    });
  }
  return out;
}

/** A still that must not take the run with it. */
async function window_shot(page, shot, name) {
  try { await shot(name); } catch { /* lost */ }
}
