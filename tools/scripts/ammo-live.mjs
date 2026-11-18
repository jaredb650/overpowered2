// The ammo round on the Test Range: flechettes from the pump into a plated Brute and a bare Husk (darts, sparks off the plate,
// a wound a dart) and into a wall (needles standing in it); the Harrow's API rounds, red, into three men until one burns; the
// Piledriver's Raufoss rounds on a wall and on a man. Waits are in game time.
//
//   node tools/shot.mjs --port 5208 --url "/?map=range" --script tools/scripts/ammo-live.mjs --wait 500 --timeout 280 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/ammo/live.png
//
// AMMO_ONLY=flechette,wall,api,raufoss reruns named steps (raufoss alone runs on a tree without the other two).
const only = (process.env.AMMO_ONLY ?? '').split(',').filter(Boolean);
const wants = step => only.length === 0 || only.includes(step);

export default async function ammoLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.V = ctx.player.position.constructor;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end) await window.frame();
    };
    window.aim = (x, y, z) => {
      const p = ctx.player;
      const dx = x - p.eye.x;
      const dy = y - p.eye.y;
      const dz = z - p.eye.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
    window.stand = (x, z, ax, ay, az) => {
      ctx.player.teleport(new window.V(x, 0.1, z), 0);
      window.aim(ax, ay, az);
    };
    window.wipe = async () => {
      ctx.enemies.reset();
      window.__lab.spawner.clearBodies();
      await window.frame();
    };
    window.fit = id => {
      const w = ctx.weapons;
      if (!w.mods.has(id)) w.grantMod(id);
      if (!w.fitted.has(id)) w.fitMod(id, true);
    };
    window.unfit = id => { if (ctx.weapons.fitted.has(id)) ctx.weapons.fitMod(id, false); };
    window.pull = async () => {
      ctx.input.simulate('fire', true);
      await window.frame();
      await window.frame();
      ctx.input.simulate('fire', false);
    };
    /** The trigger for one frame, the shot just gone: for a still of the tracers in flight. */
    window.shoot = async () => {
      // Slow the world for the still: a frame here is up to 50 ms of world, longer than a dart's tracer lives. `still` puts it back.
      ctx.time.pushScale('ammo-still', 0.15, 0, 0);
      ctx.input.simulate('fire', true);
      await window.frame();
      ctx.input.simulate('fire', false);
      await window.frame();
    };
    window.man = (id, x, z, hp) => {
      const e = window.__lab.spawner.place(id, new window.V(x, 0, z), 'off');
      if (e && hp) e.health = e.maxHealth = hp;
      return e;
    };
  });
  const out = {};
  const freeze = on => page.evaluate(v => { window.__op2.ctx.time.paused = v; }, on);
  const still = async name => {
    await freeze(true);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await h.shot(name);
    await freeze(false);
    await page.evaluate(() => window.__op2.ctx.time.popScale('ammo-still'));
  };

  if (wants('flechette')) {
    // A Brute in his plates and a Husk in nothing, 7 m out, with their own health: one pump shell into each, buckshot then
    // flechettes, on fresh men, aimed at the chest. `dealt` is what the shell's hits did, `pool` the darts' blood left to bleed.
    out.flechette = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      const res = {};
      let dealt = 0;
      let hits = 0;
      const off = ctx.events.on('enemy:hit', e => { if (!e.result.blocked) dealt += e.result.dealt; hits++; });
      for (const load of ['buck', 'darts']) {
        for (const who of ['brute', 'husk']) {
          await window.wipe();
          window.__lab.draw('shotgun');
          if (load === 'darts') window.fit('shotgunFlechette'); else window.unfit('shotgunFlechette');
          window.stand(0, 0, 0, 1.3, -7);
          await window.world(0.5);
          const e = window.man(who, 0, -7);
          await window.world(0.4);
          const armour = e.armor;
          window.aim(e.center.x, e.center.y - 0.15, e.center.z);
          dealt = hits = 0;
          await window.pull();
          await window.world(0.05);
          res[`${load}-${who}`] = { hits, dealt: Math.round(dealt), of: e.maxHealth, pool: Math.round(e.darts ?? 0), alive: e.alive, armourBefore: Math.round(armour), armourAfter: Math.round(e.armor) };
        }
      }
      off?.();
      return res;
    });
    // The look: both men side by side, the shell into the Brute's plates, then into the Husk, and the Husk bleeding after.
    await page.evaluate(async () => {
      await window.wipe();
      window.__lab.draw('shotgun');
      window.fit('shotgunFlechette');
      window.stand(0, 0, 0, 1.3, -7);
      await window.world(0.5);
      window.brute = window.man('brute', -1, -6, 5000);
      window.husk = window.man('husk', 1.8, -6.8, 5000);
      await window.world(0.5);
      const b = window.brute;
      window.aim(b.center.x, b.center.y + 0.1, b.center.z);
      await window.shoot();
      await window.frame();
    });
    await still('flechette-brute');
    await page.evaluate(async () => {
      await window.world(0.7);
      const k = window.husk;
      window.aim(k.center.x, k.center.y, k.center.z);
      await window.frame();
      await window.shoot();
      await window.frame();
    });
    await still('flechette-husk');
    out.bleeders = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.world(1.4);
      // Up close and to the side of the Husk: the holes and the drips.
      const k = window.husk;
      ctx.player.teleport(new window.V(k.position.x + 0.6, 0.1, k.position.z + 2.2), 0);
      window.aim(k.center.x, k.center.y + 0.1, k.center.z);
      await window.frame();
      window.aim(k.center.x, k.center.y + 0.1, k.center.z);
      return { bleeding: ctx.gore.blood?.bleeding, huskDarts: Math.round(k.darts ?? -1) };
    });
    await still('flechette-bleeding');
  }

  if (wants('wall')) {
    // The gallery's first wall from 4 m: a shell of darts, then seen from beside it, the needles standing out.
    await page.evaluate(async () => {
      await window.wipe();
      window.__lab.draw('shotgun');
      window.fit('shotgunFlechette');
      window.stand(3, 17.5, 6, 1.4, 20.5);
      await window.world(0.6);
      await window.shoot();
      await window.frame();
    });
    await still('flechette-wall-shot');
    out.needles = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.world(0.1);
      // Stand a metre off the newest needle, to the side of the line it flew, and look at it.
      const n = ctx.combat.needles;
      const mesh = ctx.render.scene.getObjectByName('flechette-needles');
      const m = new mesh.matrixWorld.constructor();
      const p = new window.V();
      const q = mesh.quaternion.clone();
      const s = new window.V();
      const now = ctx.time.elapsed;
      const live = Array.from(n.until).filter(t => t > now).length;
      mesh.getMatrixAt((n.next + mesh.count - 1) % mesh.count, m);
      m.decompose(p, q, s);
      const at = { p: p.clone(), dir: new window.V(0, 1, 0).applyQuaternion(q) };
      if (at) {
        const side = new window.V().crossVectors(at.dir, new window.V(0, 1, 0)).normalize();
        const eye = at.p.clone().addScaledVector(at.dir, -0.35).addScaledVector(side, 0.75);
        ctx.player.teleport(new window.V(eye.x, at.p.y - 1.55, eye.z), 0);
        window.aim(at.p.x, at.p.y, at.p.z);
        await window.frame();
        window.aim(at.p.x, at.p.y, at.p.z);
      }
      return { live };
    });
    await still('flechette-wall-needles');
  }

  if (wants('api')) {
    out.api = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      window.__lab.draw('harrow');
      window.fit('harrowApi');
      // A magazine that never runs dry, so a still is never caught mid-reload.
      ctx.weapons.modifiers.bottomlessMag = true;
      window.stand(0, 0, 0, 1.3, -12);
      await window.world(0.5);
      window.crew = [window.man('trooper', -1.2, -12, 900), window.man('trooper', 0.2, -12.6, 900), window.man('trooper', 1.6, -12, 900)];
      await window.world(0.5);
      let shots = 0;
      const off = ctx.events.on('weapon:fired', () => shots++);
      let lit = 0;
      for (const e of window.crew) {
        window.aim(e.center.x, e.center.y, e.center.z);
        ctx.input.simulate('fire', true);
        await window.world(0.45);
        ctx.input.simulate('fire', false);
        await window.world(0.15);
      }
      lit = window.crew.filter(e => e.burning > 0).length;
      off?.();
      return { mode: ctx.weapons.ammoMode, shots, lit };
    });
    // Mid-burst for the tracers, then a burning man.
    await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.world(0.8);
      const e = window.crew[1];
      window.aim(e.center.x, e.center.y, e.center.z);
      ctx.input.simulate('fire', true);
      await window.world(0.25);
      ctx.time.pushScale('ammo-still', 0.15, 0, 0);
      await new Promise(r => { const off = ctx.events.on('weapon:fired', () => { off(); r(); }); });
      ctx.input.simulate('fire', false);
      await window.frame();
      await window.frame();
      // The world all but stopped (the player still moves: slow-mo leaves him his own clock), seen from beside the line of fire:
      // from behind the gun a tracer runs into the muzzle flash.
      ctx.time.pushScale('ammo-still', 0.001, 0, 0);
      ctx.player.teleport(new window.V(3.2, 0.1, -3.5), 0);
      window.aim(0, 1.2, -8);
      await window.frame();
      window.aim(0, 1.2, -8);
      for (let i = 0; i < 3; i++) await window.frame();
    });
    await h.shot('api-tracers');
    await page.evaluate(() => { const t = window.__op2.ctx.time; t.paused = false; t.popScale('ammo-still'); });
    out.apiBurn = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      ctx.input.simulate('fire', false);
      // Keep at them until one burns, at most 4 s of fire.
      for (let t = 0; t < 8 && !window.crew.some(e => e.alive && e.burning > 0); t++) {
        const e = window.crew.find(c => c.alive) ?? window.crew[0];
        window.aim(e.center.x, e.center.y, e.center.z);
        ctx.input.simulate('fire', true);
        await window.world(0.3);
        ctx.input.simulate('fire', false);
        await window.world(0.2);
      }
      await window.world(0.6);
      const burning = window.crew.find(e => e.alive && e.burning > 0);
      if (burning) {
        ctx.player.teleport(new window.V(burning.position.x + 2.2, 0.1, burning.position.z + 3.2), 0);
        window.aim(burning.center.x, burning.center.y, burning.center.z);
        await window.frame();
        window.aim(burning.center.x, burning.center.y, burning.center.z);
      }
      return { burning: !!burning, seconds: burning ? +burning.burning.toFixed(1) : 0 };
    });
    await still('api-burning');
    await page.evaluate(() => { window.__op2.ctx.weapons.modifiers.bottomlessMag = false; });
  }

  if (wants('raufoss')) {
    const holdR = () => page.evaluate(async () => {
      const { ctx } = window.__op2;
      if (ctx.weapons.ammoMode === 'RAUFOSS') return;
      ctx.input.simulate('reload', true);
      await window.world(0.4);
      ctx.input.simulate('reload', false);
      await window.world(0.3);
    });
    await page.evaluate(async () => {
      await window.wipe();
      window.__lab.draw('piledriver');
      window.stand(1.5, 22, 6, 1.3, 22);
      await window.world(0.7);
    });
    await holdR();
    out.raufossMode = await page.evaluate(() => window.__op2.ctx.weapons.ammoMode);
    // On the gallery's wall, 4.5 m: a round, held 50 ms after.
    await page.evaluate(async () => {
      window.stand(1.5, 22, 6, 1.3, 22);
      await window.frame();
      await window.pull();
      await window.world(0.05);
    });
    await still('raufoss-wall');
    // On a man 6 m out.
    await page.evaluate(async () => {
      await window.world(1.2);
      const e = window.man('trooper', 2.5, 16, 4000);
      window.stand(2.5, 22, 2.5, 1.3, 16);
      await window.world(0.4);
      window.aim(e.center.x, e.center.y, e.center.z);
      await window.frame();
      await window.pull();
      await window.world(0.05);
    });
    await still('raufoss-body');
  }
  return out;
}
