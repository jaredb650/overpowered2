// The Autoraffica in the real game on the Test Range (weapons-update plan section 14): the gun at the hip, a burst mid-cycle,
// aimed down the sights at a man 20 m out and a burst into his head, the smart aim's circle with nobody in it, and the
// crosshair snapped onto a head with the gun turned to it. Three Troopers stand 13 to 20 m out; the clock is held still for
// each still.
//
//   node tools/shot.mjs --port 5273 --url "/?map=range" --script tools/scripts/autoraffica-live.mjs --dpr 2 --w 1440 --h 900 \
//     --wait 500 --timeout 200 --out tools/out/autoraffica/live.png
//
// The 3/4 model view is the viewmodel sandbox:
//   VM_IDS=autoraffica VM_VIEWS='[["34",140,14,0.8,0,0.01,-0.1],["r",-35,8,0.8,0,0.01,-0.1]]' node tools/shot.mjs --port 5273 \
//     --url "/?sandbox=viewmodels&view=inspect" --script tools/scripts/viewmodel-inspect.mjs --dpr 2 --w 1440 --h 900 \
//     --wait 1500 --out tools/out/autoraffica/model.png
export default async function autorafficaLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing').catch(() => false)) break;
    await h.sleep(500);
  }
  await page.mouse.click(400, 500);
  await h.sleep(500);
  await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.playerElapsed + seconds;
      while (ctx.time.playerElapsed < end) await window.frame();
    };
    window.aimAt = (v, dx = 0, dy = 0) => {
      const p = ctx.player;
      const x = v.x - p.eye.x, y = v.y - p.eye.y, z = v.z - p.eye.z;
      p.yaw = Math.atan2(-x, -z) + dx;
      p.pitch = Math.atan2(y, Math.hypot(x, z)) + dy;
    };
    window.head = e => ctx.combat.headOf(e, e.center.clone());
    window.hold = async (action, seconds) => {
      ctx.input.simulate(action, true);
      await window.world(seconds);
      ctx.input.simulate(action, false);
      await window.frame();
    };
    ctx.enemies.reset();
    lab.spawner.clearBodies();
    Object.assign(lab.settings, { spawn: 'trooper', ai: 'off', arsenal: false, overlay: false });
    lab.changed();
    ctx.player.modifiers.invulnerable = true;
    const p = ctx.player;
    const fwd = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
    const side = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
    window.crew = [];
    for (const [s, d] of [[-3, 14], [1.2, 20], [4.5, 13]]) {
      const v = p.position.clone();
      v.x += fwd.x * d + side.x * s;
      v.z += fwd.z * d + side.z * s;
      v.y = 0;
      const before = new Set(ctx.enemies.alive);
      lab.spawner.place('trooper', v, 'off');
      window.crew.push(...ctx.enemies.alive.filter(e => !before.has(e)));
    }
    ctx.weapons.give('autoraffica');
    ctx.weapons.switchTo('autoraffica');
    await window.world(0.8);
    ctx.weapons.refillMagazines();
  });
  const still = async name => {
    await page.evaluate(() => { window.__op2.ctx.time.paused = true; });
    await h.sleep(200);
    await h.shot(name);
    await page.evaluate(() => { window.__op2.ctx.time.paused = false; });
  };
  const state = () => page.evaluate(() => {
    const w = window.__op2.ctx.weapons;
    return { gun: w.current, mode: w.ammoMode, smart: w.smartAim.on, locked: !!w.smartAim.lock, mag: w.ammo().mag };
  });
  const out = {};

  // At the hip, the view between the first two men, smart aim off.
  await page.evaluate(async () => {
    window.aimAt(window.head(window.crew[1]), 0.22, -0.06);
    await window.world(0.6);
  });
  out.idle = await state();
  await still('idle');

  // A burst at the wall beside them, caught on its second round with the slide back.
  out.burst = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const w = ctx.weapons;
    const start = w.ammo().mag;
    ctx.input.simulate('fire', true);
    for (let i = 0; i < 30 && w.ammo().mag > start - 2; i++) await window.frame();
    ctx.time.paused = true;
    ctx.input.simulate('fire', false);
    return start - w.ammo().mag;
  });
  await h.sleep(200);
  await h.shot('burst');
  await page.evaluate(() => { window.__op2.ctx.time.paused = false; });
  await page.evaluate(() => window.world(0.6));

  // Aimed down the sights at the middle man's head, 20 m out: the post in the notch on his head, then a burst into it.
  out.ads = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const e = window.crew[1];
    window.aimAt(window.head(e));
    await window.world(0.3);
    await window.hold('aim', 0.05);
    await window.world(0.7);
    ctx.time.paused = true;
    return { aim: ctx.weapons.aim, dist: +ctx.player.eye.distanceTo(window.head(e)).toFixed(1) };
  });
  await h.sleep(200);
  await h.shot('ads');
  out.adsFire = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const e = window.crew[1];
    const before = e.health;
    ctx.time.paused = false;
    ctx.input.simulate('fire', true);
    await window.frame();
    await window.frame();
    ctx.input.simulate('fire', false);
    await window.world(0.035);
    ctx.time.paused = true;
    return { hurt: Math.round(before - e.health), alive: e.alive };
  });
  await h.sleep(200);
  await h.shot('ads-fire');
  await page.evaluate(async () => {
    window.__op2.ctx.time.paused = false;
    await window.world(0.4);
    await window.hold('aim', 0.05);
    await window.world(0.4);
  });

  // Smart aim on, the circle with nobody in it.
  await page.evaluate(async () => {
    window.aimAt(window.head(window.crew[1]), 0.5, 0.02);
    await window.world(0.2);
    await window.hold('reload', 0.4);
    await window.world(0.5);
  });
  out.circle = await state();
  await still('smart-circle');

  // Swing toward the man on the right until his head is inside the circle: the crosshair snaps onto it and the gun turns.
  out.snap = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    window.aimAt(window.head(window.crew[2]), 0.1, -0.05);
    await window.world(0.25);
    ctx.time.paused = true;
    return !!ctx.weapons.smartAim.lock;
  });
  await h.sleep(200);
  await h.shot('smart-snap');
  await page.evaluate(() => { window.__op2.ctx.time.paused = false; });

  // A locked burst: three into his head.
  out.lockedBurst = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const e = window.crew[2];
    ctx.input.simulate('fire', true);
    await window.frame();
    await window.frame();
    ctx.input.simulate('fire', false);
    await window.world(0.06);
    ctx.time.paused = true;
    return { alive: e.alive, health: Math.round(e.health) };
  });
  await h.sleep(200);
  await h.shot('smart-burst');
  return out;
}
