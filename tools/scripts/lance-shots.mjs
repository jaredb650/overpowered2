// Stills of the Lance's overhaul on the Test Range: the charge-up, the sustained beam through a crowd, a body vaporizing in
// the air, ball mode, and the giant ball's blast.
//
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/lance-shots.mjs --wait 500 --timeout 200 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/lance/shots.png --quiet
//
// LANCE_ONLY=charge,beam,ball,giant reruns named steps. Stills are JPEGs in the out dir, and numbers in shots.json.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const only = (process.env.LANCE_ONLY ?? '').split(',').filter(Boolean);
const wants = step => only.length === 0 || only.includes(step);

export default async function lanceShots(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end) await window.frame();
    };
    window.start = { at: ctx.player.position.clone(), yaw: ctx.player.yaw };
    const V = ctx.player.position.constructor;
    window.fwd = () => new V(-Math.sin(window.start.yaw), 0, -Math.cos(window.start.yaw));
    window.side = () => new V(Math.cos(window.start.yaw), 0, -Math.sin(window.start.yaw));
    window.spot = (d, x = 0) => window.start.at.clone().addScaledVector(window.fwd(), d).addScaledVector(window.side(), x);
    window.aimAt = (x, y, z) => {
      const p = ctx.player;
      p.yaw = Math.atan2(-(x - p.eye.x), -(z - p.eye.z));
      p.pitch = Math.atan2(y - p.eye.y, Math.hypot(x - p.eye.x, z - p.eye.z));
    };
    window.home = () => {
      const p = ctx.player;
      p.teleport(window.start.at.clone().setY(window.start.at.y + 0.1), window.start.yaw);
      p.pitch = 0;
      p.velocity.set(0, 0, 0);
    };
    window.wipe = async () => {
      ctx.enemies.reset();
      lab.spawner.clearBodies();
      ctx.fx.clear();
      await window.frame();
    };
    /** A loose crowd down the range: `rows` deep, `wide` across. */
    window.crowd = async (from, rows, wide, gap = 2.2) => {
      Object.assign(lab.settings, { spawn: 'trooper', ai: 'off', arsenal: false });
      lab.changed();
      const out = [];
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < wide; j++) out.push(lab.spawner.place('trooper', window.spot(from + i * gap, (j - (wide - 1) / 2) * 1.6), 'off'));
      }
      await window.world(0.9);
      return out.filter(Boolean);
    };
    window.ready = async () => {
      await window.wipe();
      window.home();
      lab.draw('lance');
      ctx.weapons.refillMagazines();
      if (ctx.weapons.lance.mode !== 'beam') ctx.weapons.lance.toggle();
      await window.world(0.6);
    };
    window.chargeTo = async level => {
      ctx.input.simulate('fire', true);
      const t0 = performance.now();
      while (ctx.weapons.charge < level - 1e-6 && performance.now() - t0 < 6000) await window.frame();
    };
  });
  const out = {};
  const file = join(h.outDir, 'shots.json');
  const save = () => writeFileSync(file, JSON.stringify(out, null, 1));
  const shot = async name => {
    try {
      await page.screenshot({ path: join(h.outDir, `${name}.jpg`), type: 'jpeg', quality: 88, timeout: 25000 });
    } catch {
      (out.lost ??= []).push(name);
    }
  };
  await page.mouse.click(400, 500);
  await h.sleep(400);

  if (wants('charge') || wants('beam')) {
    out.beam = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.ready();
      window.team = await window.crowd(9, 3, 4);
      const mid = window.spot(11.2);
      window.aimAt(mid.x, mid.y + 1.2, mid.z);
      await window.world(0.2);
      await window.chargeTo(1);
      await window.world(0.25);
      return { charge: ctx.weapons.charge, crowd: window.team.length, mag: ctx.weapons.ammo('lance').mag };
    });
    await shot('charge-up');
    await page.evaluate(async () => {
      const { ctx } = window.__op2;
      ctx.input.simulate('fire', false);
      // Just out of the gun, at its thickest.
      await window.world(0.12);
      window.__lab.togglePause();
      await window.frame();
    });
    await shot('beam-start');
    await page.evaluate(async () => {
      const { ctx } = window.__op2;
      window.__lab.togglePause();
      // Sweeping right across the crowd as it pours.
      const t0 = ctx.time.playerElapsed;
      while (ctx.time.playerElapsed - t0 < 0.4) {
        ctx.player.yaw -= 0.006;
        await window.frame();
      }
      // Held still for the stills: the beam holds where it is.
      window.__lab.togglePause();
      await window.frame();
    });
    await shot('beam-eye');
    out.beamMid = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      return { beaming: ctx.weapons.lance.beaming, dead: window.team.filter(e => !e.alive).length, mag: ctx.weapons.ammo('lance').mag };
    });
    // Seen from beside the crowd.
    await page.evaluate(async () => {
      const { ctx } = window.__op2;
      const from = window.spot(6, 9);
      const at = window.spot(12);
      ctx.player.teleport(from.setY(from.y + 0.1), 0);
      window.aimAt(at.x, at.y + 1.6, at.z);
      await window.frame();
      await window.frame();
    });
    await shot('beam-side');
    await page.evaluate(async () => {
      window.__lab.step(50);
      await window.world(0.1);
      for (let i = 0; i < 120 && window.__lab.steps > 0; i++) await window.frame();
    });
    await shot('vaporize-float');
    await page.evaluate(async () => {
      window.__lab.step(40);
      for (let i = 0; i < 120 && window.__lab.steps > 0; i++) await window.frame();
    });
    await shot('vaporize-late');
    out.after = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      window.__lab.togglePause();
      await window.world(2.5);
      return { dead: window.team.filter(e => !e.alive).length, corpses: ctx.gore.stats?.().ragdolls, mag: ctx.weapons.ammo('lance').mag };
    });
    await shot('beam-after');
    save();
  }

  if (wants('ball') || wants('giant')) {
    out.ball = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.ready();
      ctx.input.simulate('aim', true);
      await window.frame();
      ctx.input.simulate('aim', false);
      await window.world(0.5);
      return { mode: ctx.weapons.lance.mode, name: document.querySelector('.arm-name')?.textContent };
    });
    await shot('ball-mode');
    out.giant = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      window.team = await window.crowd(24, 3, 4, 1.8);
      const mid = window.spot(25.8);
      window.aimAt(mid.x, mid.y + 1.1, mid.z);
      await window.world(0.2);
      await window.chargeTo(1);
      await window.world(0.2);
      return { charge: ctx.weapons.charge };
    });
    await shot('ball-charge');
    await page.evaluate(async () => {
      const { ctx } = window.__op2;
      ctx.input.simulate('fire', false);
      await window.world(0.55);
      window.__lab.togglePause();
      await window.frame();
    });
    await shot('giant-flight');
    out.blast = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      window.__lab.togglePause();
      const t0 = performance.now();
      while (ctx.weapons.lance.giantAt && performance.now() - t0 < 5000) await window.frame();
      await window.frame();
      await window.frame();
      window.__lab.togglePause();
      await window.frame();
      return { dead: window.team.filter(e => !e.alive).length };
    });
    await shot('giant-blast');
    const stepTo = async n => page.evaluate(async frames => {
      window.__lab.step(frames);
      for (let i = 0; i < 200 && window.__lab.steps > 0; i++) await window.frame();
    }, n);
    await stepTo(20);
    await shot('giant-blast-later');
    await stepTo(50);
    await shot('giant-vaporize');
    save();
  }
  return out;
}
