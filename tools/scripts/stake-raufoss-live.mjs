// The Stakegun's exploding bolts and the Piledriver's Raufoss rounds in the real game, on the Test Range: a bolt stuck in a
// wall with its light lit, one riding a man, the blast, and Raufoss rounds bursting on the gallery's first wall with their
// pellets coming out of its far side. Waits are in game time.
//
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/stake-raufoss-live.mjs --wait 500 --timeout 280 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/stake-raufoss/live.png
//
// SR_ONLY=wall,man,raufoss reruns named steps.
const only = (process.env.SR_ONLY ?? '').split(',').filter(Boolean);
const wants = step => only.length === 0 || only.includes(step);

export default async function stakeRaufoss(page, h) {
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
    window.bolt = () => ctx.combat.projectiles.active.find(p => p.kind === 'stake' && p.resting);
    window.wipe = async () => {
      ctx.enemies.reset();
      window.__lab.spawner.clearBodies();
      await window.frame();
    };
    /** Load the other round on the gun in hand, if it is not loaded already. */
    window.alt = async want => {
      if ((ctx.weapons.ammoMode !== '') !== want) {
        ctx.input.simulate('aim', true);
        await window.frame();
        ctx.input.simulate('aim', false);
      }
      await window.world(0.2);
    };
    window.pull = async () => {
      ctx.input.simulate('fire', true);
      await window.frame();
      await window.frame();
      ctx.input.simulate('fire', false);
    };
  });
  const out = {};
  const freeze = on => page.evaluate(v => { window.__op2.ctx.time.paused = v; }, on);
  const still = async name => {
    await freeze(true);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await h.shot(name);
    await freeze(false);
  };
  /** Runs the world until a stuck bolt has its light lit, then holds it there for a still. */
  const blinking = async (name, after = 0) => {
    await page.evaluate(async a => {
      const end = window.__op2.ctx.time.elapsed + 2;
      let seen = 0;
      while (window.__op2.ctx.time.elapsed < end) {
        await window.frame();
        const b = window.bolt();
        if (b && b.blink > 0 && seen++ >= a) break;
      }
    }, after);
    await still(name);
  };

  if (wants('wall')) {
    // The gallery's first wall, from 4 m off and to the side, so the bolt stands out of it.
    await page.evaluate(async () => {
      await window.wipe();
      window.__lab.draw('stakegun');
      window.stand(3, 17.5, 6, 1.4, 20.5);
      await window.world(0.7);
      await window.alt(true);
      await window.pull();
      await window.world(0.15);
      window.stand(4.2, 18.2, 6, 1.35, 20.2);
    });
    out.wallStuck = await page.evaluate(() => !!window.bolt());
    await blinking('bolt-wall-blink', 1);
    await page.evaluate(() => window.world(0.4));
    await still('bolt-wall-blast');
  }

  if (wants('man')) {
    // A man 7 m out with two friends 6 m behind and to his side; a bolt in his chest, seen from beside him.
    out.man = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      window.__lab.draw('stakegun');
      window.stand(0, 0, 0, 1.2, -10);
      await window.world(0.3);
      const lab = window.__lab;
      const man = lab.spawner.place('trooper', new window.V(0, 0, -7), 'on');
      const a = lab.spawner.place('trooper', new window.V(4, 0, -12), 'on');
      const b = lab.spawner.place('trooper', new window.V(5.2, 0, -12.5), 'on');
      window.man = man;
      if (man) man.health = man.maxHealth = 400;
      await window.world(0.6);
      window.aim(man.center.x, man.center.y, man.center.z);
      await window.alt(true);
      window.aim(man.center.x, man.center.y, man.center.z);
      await window.pull();
      await window.world(0.12);
      const bolt = window.bolt();
      return { placed: [!!man, !!a, !!b], stuck: !!bolt, bolted: man ? +(man.bolted - ctx.time.elapsed).toFixed(2) : null };
    });
    await page.evaluate(async () => {
      const m = window.man;
      const p = window.__op2.ctx.player;
      p.teleport(new window.V(m.position.x - 2.4, 0.1, m.position.z + 1.4), 0);
      window.aim(m.center.x, m.center.y, m.center.z);
      await window.frame();
      window.aim(m.center.x, m.center.y, m.center.z);
    });
    await still('bolt-man');
    out.manMoved = await page.evaluate(async () => {
      const m = window.man;
      const from = m.position.clone();
      await window.world(0.55);
      window.aim(m.center.x, m.center.y, m.center.z);
      return +m.position.distanceTo(from).toFixed(2);
    });
    await blinking('bolt-man-blink');
    out.manBlast = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      const end = ctx.time.elapsed + 1.5;
      while (ctx.time.elapsed < end && window.bolt()) await window.frame();
      await window.frame();
      await window.frame();
      return ctx.enemies.alive.filter(e => e.alive).length;
    });
    await still('bolt-man-blast');
  }

  if (wants('raufoss')) {
    // A man in the bay behind the gallery's 0.3 m panel wall; Raufoss rounds into the wall in front of him.
    out.raufoss = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      const lab = window.__lab;
      lab.draw('piledriver');
      window.stand(1.5, 22, 6, 1.3, 22);
      await window.world(0.7);
      const behind = lab.spawner.place('trooper', new window.V(9.4, 0, 22.3), 'off');
      if (behind) behind.health = behind.maxHealth = 2000;
      window.behind = behind;
      await window.world(0.3);
      await window.alt(true);
      window.stand(1.5, 22, 6, 1.3, 22);
      const hp = behind ? behind.health : 0;
      ctx.input.simulate('fire', true);
      await window.world(0.08);
      return { hpBefore: Math.round(hp) };
    });
    await still('raufoss-fp');
    await page.evaluate(async () => {
      const { ctx } = window.__op2;
      ctx.input.simulate('fire', false);
      await window.world(0.5);
    });
    // From the lane's open side: the wall's far face and the bay, while a burst goes into the wall from the stand.
    out.raufossSide = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      const p = ctx.player;
      const w = ctx.weapons;
      const shot = { damage: 90, source: 'piledriver', team: 'player', tracer: 'heavy', severMult: 5, force: 48 };
      p.teleport(new window.V(6.8, 0.1, 13.5), 0);
      window.aim(7.6, 1.2, 21.4);
      await window.world(0.3);
      const before = window.behind ? window.behind.health : 0;
      const origin = new window.V(1.5, 1.45, 21.6);
      for (let i = 0; i < 3; i++) {
        w.raufossRounds.fire(origin, new window.V(1, -0.02, 0.03 + i * 0.03).normalize(), { ...shot });
        await window.frame();
      }
      return { hpLost: Math.round(before - (window.behind ? window.behind.health : 0)) };
    });
    await still('raufoss-side');
  }
  return out;
}
