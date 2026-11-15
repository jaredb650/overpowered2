// The Sabot's wake and the enemy Sniper's round, in the real game. Waits are in game time (ctx.time.elapsed), because a loaded
// machine can run this page at a few frames a second, and each shot freezes the world with time.paused while it is taken.
//
//   node tools/shot.mjs --url "/?sandbox=range&live=1&load=sniper" --script tools/scripts/sabot-trail.mjs \
//     --dpr 2 --w 1440 --h 900 --wait 2000 --timeout 240 --out tools/out/sabot-trail2/live.png
export default async function sabotTrail(page, h) {
  await page.waitForFunction(() => window.__range, null, { timeout: 120000 });
  const ev = (js, arg) => page.evaluate(js, arg);
  await ev(() => {
    const { ctx } = window.__range;
    ctx.player.modifiers.invulnerable = true;
    ctx.weapons.switchTo('sabot');
    window.__snipes = 0;
    const f = ctx.fx.tracer.bind(ctx.fx);
    ctx.fx.tracer = (a, b, k) => {
      if (k === 'snipe' && window.__snipes++ === 0) window.__snipeAt = ctx.time.elapsed;
      return f(a, b, k);
    };
  });
  const now = () => ev(() => window.__range.ctx.time.elapsed);
  /** Waits until the game clock has passed `t`. */
  const until = async t => {
    while (await now() < t) await h.sleep(30);
  };
  const after = async s => until(await now() + s);
  const snap = async name => {
    await ev(() => { window.__range.ctx.time.paused = true; });
    // One more rendered frame with the clock held, so the screenshot is of the frozen moment.
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await h.shot(name);
    await ev(() => { window.__range.ctx.time.paused = false; });
  };
  const fire = () => ev(() => {
    const { ctx } = window.__range;
    ctx.input.simulate('fire', true);
    setTimeout(() => ctx.input.simulate('fire', false), 40);
    return ctx.time.elapsed;
  });
  await after(1.2);

  // First person, down the trail, over the box in front.
  await ev(() => {
    const r = window.__range;
    const p = r.ctx.player;
    const y = p.yaw + 0.92;
    r.aim(p.eye.x - Math.sin(y) * 100, p.eye.y + 9, p.eye.z - Math.cos(y) * 100);
  });
  await after(0.3);
  let t = await fire();
  await until(t + 0.03);
  await snap('fp-0');
  await until(t + 0.5);
  await snap('fp-05s');
  await after(2.5);

  // Side view: fire, then step 9 m to the side and look back at the middle of the trail.
  const mid = await ev(() => {
    const { ctx } = window.__range;
    const p = ctx.player;
    const f = p.forward.clone().setY(0).normalize();
    return { x: p.eye.x + f.x * 18, y: p.eye.y, z: p.eye.z + f.z * 18, sx: -f.z, sz: f.x, px: p.position.x, py: p.position.y, pz: p.position.z, yaw: p.yaw };
  });
  t = await fire();
  await until(t + 0.02);
  await ev(m => {
    const { ctx } = window.__range;
    const p = ctx.player;
    p.teleport(p.position.clone().set(m.px + m.sx * 9 - (m.x - m.px) * 0.3, m.py, m.pz + m.sz * 9 - (m.z - m.pz) * 0.3));
    window.__range.aim(m.x, m.y - 0.2, m.z);
  }, mid);
  await until(t + 0.06);
  await snap('side');
  await until(t + 0.5);
  await snap('side-05s');

  // Back, and an enemy Sniper off to one side. Look at him, a little to one side, and wait for his round.
  await ev(m => {
    const { ctx } = window.__range;
    ctx.player.teleport(ctx.player.position.clone().set(m.px, m.py, m.pz), m.yaw);
  }, mid);
  await after(0.5);
  // A spot 20 to 30 m off with floor at the player's height and a clear line to him, so the round is all in view.
  const e = await ev(() => {
    const { ctx } = window.__range;
    const p = ctx.player;
    const V = p.eye.constructor;
    const down = new V(0, -1, 0);
    for (let i = 0; i < 48; i++) {
      const a = p.yaw + 0.3 + (i % 12) * 0.5;
      const d = 22 + Math.floor(i / 12) * 3;
      const at = new V(p.eye.x - Math.sin(a) * d, p.eye.y + 1, p.eye.z - Math.cos(a) * d);
      const floor = ctx.physics.raycast(at, down, 4);
      if (!floor || Math.abs(floor.point.y - p.position.y) > 0.6) continue;
      const to = new V(at.x, p.eye.y, at.z).sub(p.eye);
      const len = to.length();
      if (ctx.physics.raycast(p.eye.clone(), to.normalize(), len)) continue;
      window.__sniper = ctx.enemies.spawn('sniper', floor.point.clone());
      return !!window.__sniper;
    }
    return false;
  });
  if (!e) return { error: 'no sniper' };
  for (let i = 0; i < 400; i++) {
    if (await ev(() => window.__snipes > 0)) break;
    await ev(() => {
      const r = window.__range;
      r.aimAt(window.__sniper);
      r.ctx.player.yaw += 0.12;
    });
    await h.sleep(50);
  }
  t = await ev(() => window.__snipeAt);
  await until(t + 0.03);
  await snap('enemy-0');
  await until(t + 0.5);
  await snap('enemy-05s');
  return ev(() => ({ snipes: window.__snipes, fx: window.__range.ctx.fx.stats?.() }));
}
