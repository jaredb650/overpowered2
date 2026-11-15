// The Judge's fanning in the real game on the Test Range: a real right button through pointer lock, three standing
// Troopers, the view swept over their heads while it charges. Stills of the bar charging with a lock, three locks, the
// fan half way, three locks stacked on one man, and a blind dump; the clock is held still for each so the moment is caught.
//
//   node tools/shot.mjs --url "/?map=range" --port 5249 --script tools/scripts/judge-fan-live.mjs --wait 500 --timeout 200 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/judge-fan/live.png
export default async function judgeFanLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.playerElapsed + seconds;
      while (ctx.time.playerElapsed < end) await window.frame();
    };
    window.aimAt = v => {
      const p = ctx.player;
      const dx = v.x - p.eye.x, dy = v.y - p.eye.y, dz = v.z - p.eye.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
    window.head = e => ctx.combat.headOf(e, e.center.clone());
    /** Frames until `test` holds, then the clock is held. */
    window.holdWhen = async (test, limit = 240) => {
      for (let i = 0; i < limit && !test(); i++) await window.frame();
      ctx.time.paused = true;
      return test();
    };
  });
  await page.mouse.click(400, 500);
  await h.sleep(500);

  const out = {};
  await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    ctx.enemies.reset();
    lab.spawner.clearBodies();
    Object.assign(lab.settings, { spawn: 'trooper', ai: 'off', arsenal: false });
    lab.changed();
    const p = ctx.player;
    const yaw = p.yaw;
    const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const at = p.position.clone();
    window.crew = [];
    for (const s of [-3.5, 0, 3.5]) {
      const v = at.clone();
      v.x += fwd.x * 14 + side.x * s;
      v.z += fwd.z * 14 + side.z * s;
      v.y = 0;
      const before = new Set(ctx.enemies.alive);
      lab.spawner.place('trooper', v, 'off');
      window.crew.push(...ctx.enemies.alive.filter(e => !before.has(e)));
    }
    lab.draw('judge');
    await window.world(0.7);
    ctx.weapons.refillMagazines();
    window.aimAt(window.crew[1].center);
    await window.world(0.3);
  });
  out.placed = await page.evaluate(() => window.crew.length);
  out.current = await page.evaluate(() => window.__op2.ctx.weapons.current);

  const lookAt = k => page.evaluate(async ([k, s]) => {
    window.aimAt(window.head(window.crew[k]));
    await window.world(s);
  }, k);

  // Charging while the view sweeps: a lock a bar, one a man.
  await lookAt([0, 0]);
  await page.mouse.down({ button: 'right' });
  await lookAt([0, 0.5]);
  out.chargeOneBar = await page.evaluate(() => +window.__op2.ctx.weapons.charge.toFixed(2));
  out.locksOneBar = await page.evaluate(() => window.__op2.ctx.weapons.paint?.marks.length ?? -1);
  out.barShown = await page.evaluate(() => !!document.querySelector('.xh-charge.pips'));
  await page.evaluate(() => { window.__op2.ctx.time.paused = true; });
  await h.sleep(200);
  await h.shot('charging');
  await page.evaluate(() => { window.__op2.ctx.time.paused = false; });
  await lookAt([1, 0.4]);
  out.threeLocks = await page.evaluate(async () => {
    window.aimAt(window.head(window.crew[2]));
    return window.holdWhen(() => window.__op2.ctx.weapons.paint?.marks.length === 3);
  });
  await h.sleep(200);
  out.lockBoxes = await page.evaluate(() => [...document.querySelectorAll('.lk-box')].filter(b => b.style.display !== 'none').length);
  out.lockLabel = await page.evaluate(() => document.querySelector('.lk-label')?.textContent);
  out.slowBeforeRelease = await page.evaluate(() => window.__op2.ctx.time.slowmo);
  await h.shot('locks');

  // Let go: the dump, held on the frame of the second shot.
  await page.evaluate(() => { window.__op2.ctx.time.paused = false; });
  await page.mouse.up({ button: 'right' });
  out.midFan = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    return window.holdWhen(() => ctx.weapons.ammo('judge').mag <= 4);
  });
  out.slowMidFan = await page.evaluate(() => +window.__op2.ctx.time.slowmo.toFixed(2));
  await h.sleep(200);
  await h.shot('mid-fan');
  await page.evaluate(() => { window.__op2.ctx.time.paused = false; });
  await page.evaluate(() => window.world(1.2));
  out.after = await page.evaluate(() => {
    const { ctx } = window.__op2;
    return { mag: ctx.weapons.ammo('judge').mag, dead: window.crew.filter(e => !e.alive).length, slowmo: ctx.time.slowmo };
  });
  await h.shot('after');

  // Three locks stacked on one man: a full charge held on him.
  await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const before = new Set(ctx.enemies.alive);
    window.__lab.spawner.place('brute', window.crew[1].position.clone(), 'off');
    window.crew = ctx.enemies.alive.filter(e => !before.has(e));
    ctx.weapons.refillMagazines();
    await window.world(0.6);
    window.aimAt(window.head(window.crew[0]));
    await window.world(0.2);
  });
  await page.mouse.down({ button: 'right' });
  out.stacked = await page.evaluate(async () => {
    const w = window.__op2.ctx.weapons;
    await window.holdWhen(() => (w.paint?.marks.length ?? 0) === 3, 400);
    return { marks: w.paint?.marks.length, distinct: new Set(w.paint?.marks).size, count: document.querySelector('.lk-n')?.textContent };
  });
  await h.sleep(250);
  out.stackCount = await page.evaluate(() => [...document.querySelectorAll('.lk-n')].map(e => e.textContent).filter(Boolean));
  await h.shot('stack');
  await page.evaluate(() => { window.__op2.ctx.time.paused = false; });
  await page.mouse.up({ button: 'right' });
  await page.evaluate(() => window.world(1));
  out.stackAfter = await page.evaluate(() => ({ mag: window.__op2.ctx.weapons.ammo('judge').mag, dead: !window.crew[0].alive }));

  // No lock: charge two bars looking at the sky, let go. Both rounds go where it points, at normal speed.
  await page.evaluate(async () => {
    const { ctx } = window.__op2;
    ctx.weapons.refillMagazines();
    ctx.player.pitch = 1.2;
    await window.world(0.5);
  });
  await page.mouse.down({ button: 'right' });
  await page.evaluate(() => window.world(0.9));
  await page.mouse.up({ button: 'right' });
  out.blind = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    let slowest = 1;
    const end = ctx.time.playerElapsed + 1;
    while (ctx.time.playerElapsed < end) {
      slowest = Math.min(slowest, ctx.time.slowmo);
      await window.frame();
    }
    return { mag: ctx.weapons.ammo('judge').mag, slowest };
  });
  return out;
}
