// The katana's energy blade on the Test Range: idle in hand, a man cut in half by the flat third slash and his halves burning
// away (stills through the dissolve), and the stab in a chain dashing at a man 8 m off. Waits are in game time.
//
//   node tools/shot.mjs --port 5211 --url "/?map=range" --script tools/scripts/energy-live.mjs --wait 500 --timeout 300 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/energy/live.png
// ENERGY_ONLY=idle,cut,dash reruns named steps.
const only = (process.env.ENERGY_ONLY ?? '').split(',').filter(Boolean);
const wants = step => only.length === 0 || only.includes(step);

export default async function energyLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.render.renderer.setPixelRatio(2);
    ctx.player.modifiers.invulnerable = true;
    window.V = ctx.player.position.constructor;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end) await window.frame();
    };
    window.aim = (x, y, z) => {
      const p = ctx.player;
      const dx = x - p.eye.x;
      const dz = z - p.eye.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(y - p.eye.y, Math.hypot(dx, dz));
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
    window.press = async key => {
      ctx.input.simulate(key, true);
      await window.frame();
      await window.frame();
      ctx.input.simulate(key, false);
    };
    window.man = (id, x, z, hp) => {
      const e = window.__lab.spawner.place(id, new window.V(x, 0, z), 'off');
      if (e && hp) e.health = e.maxHealth = hp;
      return e;
    };
    window.__lab.draw('sword');
    const w = ctx.weapons;
    w.grantMod('swordEnergy');
    w.fitMod('swordEnergy', true);
  });
  const freeze = on => page.evaluate(v => { window.__op2.ctx.time.paused = v; }, on);
  const still = async name => {
    await freeze(true);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await h.shot(name);
    await freeze(false);
  };
  const out = {};

  if (wants('idle')) {
    await page.evaluate(async () => {
      await window.wipe();
      window.stand(0, 4, 0, 1.4, -10);
      await window.world(1);
    });
    await still('idle');
  }

  if (wants('cut')) {
    // The third slash is the flat one: the chain is set two swings in, so the click is it.
    out.cut = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      window.stand(0, 4, 0, 1.2, 0);
      await window.world(0.6);
      const e = window.man('trooper', 0, 2.2, 30);
      await window.world(0.6);
      window.aim(e.center.x, e.center.y - 0.05, e.center.z);
      const sword = ctx.weapons.sword;
      sword.next = 2;
      sword.lastAttackAt = sword.clock;
      const halves = () => ctx.gore.stats?.().halves ?? -1;
      const before = halves();
      await window.press('fire');
      await window.world(0.02);
      return { alive: e.alive, halvesBefore: before, halvesAfter: halves() };
    });
    for (const [name, wait] of [['0.1', 0.06], ['0.35', 0.25], ['0.7', 0.35], ['1.0', 0.3], ['1.3', 0.3]]) {
      await page.evaluate(s => window.world(s), wait);
      await still(`cut-${name}`);
    }
    out.cut.halvesEnd = await page.evaluate(async () => { await window.world(0.4); return window.__op2.ctx.gore.stats?.().halves; });
  }

  if (wants('dash')) {
    // A slash at the air, then the stab: the lock finds a man 8 m off (the steel blade's lock reaches 6) and dashes at him.
    out.dash = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      window.stand(0, 6, 0, 1.2, -10);
      await window.world(0.6);
      const e = window.man('trooper', 0, -2.35, 5000);
      await window.world(0.6);
      window.aim(e.center.x, e.center.y, e.center.z);
      await window.press('fire');
      await window.world(0.15);
      window.__dashFrom = ctx.player.position.z;
      window.__dashHp = e.health;
      window.__dashMan = e;
      await window.press('aim');
      return { from: Math.round(window.__dashFrom * 100) / 100 };
    });
    for (const name of ['1', '2', '3']) {
      await page.evaluate(() => window.world(0.04));
      await still(`dash-${name}`);
    }
    out.dash.result = await page.evaluate(async () => {
      await window.world(0.4);
      const { ctx } = window.__op2;
      return { travelled: Math.round((window.__dashFrom - ctx.player.position.z) * 100) / 100, hit: Math.round(window.__dashHp - window.__dashMan.health) };
    });
  }
  return out;
}
