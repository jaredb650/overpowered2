// The Kiln's napalm in the real game: the hose from the eye and from the side, patches on the floor and on a wall, and a
// man coated in it. Waits are in game time, as in sabot-trail.mjs.
//
//   node tools/shot.mjs --url "/?sandbox=range&live=1&load=husk" --script tools/scripts/kiln-live.mjs \
//     --dpr 2 --w 1440 --h 900 --wait 2000 --timeout 240 --out tools/out/kiln/live.png
export default async function kilnLive(page, h) {
  await page.waitForFunction(() => window.__range, null, { timeout: 120000 });
  const ev = (js, arg) => page.evaluate(js, arg);
  await ev(() => {
    const { ctx } = window.__range;
    ctx.player.modifiers.invulnerable = true;
    ctx.weapons.switchTo('kiln');
  });
  const now = () => ev(() => window.__range.ctx.time.elapsed);
  const until = async t => {
    while (await now() < t) await h.sleep(30);
  };
  const after = async s => until(await now() + s);
  const stats = {};
  const snap = async name => {
    await ev(() => { window.__range.ctx.time.paused = true; });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    stats[name] = await ev(() => {
      const { ctx } = window.__range;
      return { calls: ctx.render.renderer.info.render.calls, patches: ctx.combat.flames.burning, globs: ctx.combat.flames.alive };
    });
    await h.shot(name);
    await ev(() => { window.__range.ctx.time.paused = false; });
  };
  const hold = down => ev(d => window.__range.ctx.input.simulate('fire', d), down);
  const look = (dYaw, pitch) => ev(([a, b]) => {
    const p = window.__range.ctx.player;
    p.yaw += a;
    p.pitch = b;
  }, [dYaw, pitch]);
  await after(1.5);

  // From the eye: a long squeeze, the arc falling away onto the floor.
  await look(0, 0.02);
  await hold(true);
  await after(0.45);
  await snap('fp-stream');
  await after(0.5);
  await snap('fp-stream-1s');
  await hold(false);

  // From the side: a lob, then step out of it and look back at the arc in the air.
  await after(2);
  const home = await ev(() => {
    const p = window.__range.ctx.player;
    return { x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw, fx: p.forward.x, fz: p.forward.z };
  });
  await look(0.7, 0.16);
  await hold(true);
  await after(0.9);
  await hold(false);
  await ev(m => {
    const R = window.__range;
    const p = R.ctx.player;
    const f = p.forward.clone().setY(0).normalize();
    const mid = p.eye.clone().addScaledVector(f, 8);
    p.teleport(p.position.clone().addScaledVector(f, 2).add(f.clone().set(-f.z, 0, f.x).multiplyScalar(-8)));
    R.aim(mid.x, mid.y - 0.3, mid.z);
  }, home);
  await after(0.02);
  await snap('side-arc');
  await after(0.6);
  await snap('side-landed');

  // Back, and down at the floor where it landed.
  await ev(m => {
    const p = window.__range.ctx.player;
    p.teleport(p.position.clone().set(m.x, m.y, m.z), m.yaw);
    p.pitch = -0.35;
  }, home);
  await after(1);
  await snap('floor-burning');
  await after(3);
  await snap('floor-burning-4s');

  // A wall, 5 to 12 m off, hosed down.
  const wall = await ev(() => {
    const { ctx } = window.__range;
    const p = ctx.player;
    const d = p.forward.clone();
    let best = null;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      d.set(-Math.sin(a), 0, -Math.cos(a));
      const hit = ctx.physics.raycast(p.eye, d, 14, 1);
      if (hit && hit.distance > 5 && hit.distance < 12 && Math.abs(hit.normal.y) < 0.3 && (!best || hit.distance < best.distance)) {
        best = { x: hit.point.x, y: hit.point.y, z: hit.point.z, distance: hit.distance };
      }
    }
    if (best) window.__range.aim(best.x, best.y + 0.6, best.z);
    return best;
  });
  if (wall) {
    await after(0.3);
    await hold(true);
    await after(1.2);
    await snap('wall-hosing');
    await hold(false);
    await after(1.2);
    await snap('wall-burning');
  }

  // A man hit by the stream.
  await ev(m => {
    const p = window.__range.ctx.player;
    p.teleport(p.position.clone().set(m.x, m.y, m.z), m.yaw + Math.PI);
    p.pitch = 0;
  }, home);
  await after(0.5);
  const man = await ev(() => {
    const R = window.__range;
    const e = R.spawn('husk', 8);
    // Tough enough to be seen burning, not killed by the stream.
    if (e) e.health = e.maxHealth = 5000;
    window.__man = e;
    return !!e;
  });
  if (man) {
    await after(1);
    await ev(() => window.__range.aimAt(window.__man));
    await hold(true);
    await after(0.25);
    await snap('enemy-hosed');
    await hold(false);
    await after(0.8);
    await ev(() => window.__range.aimAt(window.__man));
    await snap('enemy-coated');
  }
  return { wall, man, stats };
}
