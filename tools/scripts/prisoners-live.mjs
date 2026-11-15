// A prisoner cuffed and taken away by the drone, in real Chrome: the cuffed man, the drone hovering with the hook down, the man lifted and
// dangling, and the BOUNTY SECURED popup. Outpost Defense by default, for the credits; `?contract=outpost` works too (feed line only).
//
//   node tools/shot.mjs --url "/?contract=defense&autostart=1" --dpr 2 --w 1440 --h 900 --script tools/scripts/prisoners-live.mjs --out tools/out/prisoners/prisoners.png --wait 500 --timeout 200
export default async function prisoners(page, h) {
  const out = {};
  const shot = name => h.shot(name).catch(e => console.error(`shot ${name} failed: ${e.message.split('\n')[0]}`));
  const until = async (test, ms = 60000, every = 100) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await page.evaluate(test)) return true;
      await h.sleep(every);
    }
    return false;
  };
  await until(() => !!window.__op2?.ctx, 90000, 500);
  const defense = await page.evaluate(() => !!window.__op2.ctx.contracts?.defense);
  if (defense) {
    await until(() => window.__op2.ctx.hud?.screens?.name === 'loadout', 90000, 250);
    await h.sleep(600);
    // Focus starts on Deploy: the default loadout.
    await h.press('Enter', 60);
  }
  out.playing = await until(() => window.__op2.game.state === 'playing', 60000, 250);
  await h.sleep(800);
  out.setup = await page.evaluate(() => {
    const { ctx } = window.__op2;
    const o = ctx.enemies.outpost;
    window.__ctx = ctx;
    window.__o = o;
    ctx.player.maxHealth = ctx.player.health = 1e5;
    ctx.waves.update = () => {};
    for (const e of [...ctx.enemies.alive]) ctx.enemies.withdraw(e);
    window.__look = (x, y, z) => {
      const p = ctx.player;
      p.yaw = Math.atan2(-(x - p.position.x), -(z - p.position.z));
      p.pitch = Math.atan2(y - p.eye.y, Math.hypot(x - p.position.x, z - p.position.z));
    };
    // Open sky near the player, so the drone comes straight to him.
    const lift = o.captives.airlift;
    const p = ctx.player.position.clone();
    const at = p.clone();
    let found = false;
    for (let r = 0; r <= 30 && !found; r += 3) {
      for (let k = 0; k < 8 && !found; k++) {
        at.set(p.x + Math.cos(k * 0.785) * r, p.y, p.z + Math.sin(k * 0.785) * r);
        if (ctx.world.nav.nearest(at, 2, at) && lift.openSky(at) && lift.openSky(at.clone().add({ x: 0, y: 0, z: 3.5 }))) found = true;
      }
    }
    ctx.player.teleport(at.clone().setY(at.y + 0.1), 0);
    const man = at.clone();
    man.z -= 3.5;
    ctx.world.nav.nearest(man, 3, man);
    o.formSquad(2, man);
    o.squads[o.squads.length - 1].grade = 'veteran';
    const e = ctx.enemies.spawn('trooper', man);
    const other = ctx.enemies.spawn('trooper', man.clone().setX(man.x + 1.5));
    window.__man = e;
    o.collapse(o.soldierOf(e), 'surrender');
    ctx.enemies.withdraw(other);
    window.__credits = ctx.contracts.defense?.credits ?? null;
    window.__feed = [];
    const feed = ctx.hud.feed.bind(ctx.hud);
    ctx.hud.feed = (text, color) => { window.__feed.push(text); feed(text, color); };
    return { found, at: at.toArray().map(v => +v.toFixed(1)) };
  });
  await h.sleep(1500);
  await page.evaluate(() => window.__look(window.__man.center.x, window.__man.position.y + 1.0, window.__man.center.z));
  await h.sleep(300);
  // Hold E: by the collar. Let go of the key, hold it again: cuffed.
  await page.evaluate(() => window.__ctx.input.simulate('interact', true));
  await h.sleep(650);
  await page.evaluate(() => window.__ctx.input.simulate('interact', false));
  await h.sleep(300);
  await shot('held');
  await page.evaluate(() => window.__ctx.input.simulate('interact', true));
  await h.sleep(850);
  await page.evaluate(() => window.__ctx.input.simulate('interact', false));
  out.cuffed = await page.evaluate(() => window.__o.soldierOf(window.__man)?.cuffed ?? false);
  // Round behind him and to one side, to see his wrists.
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const e = window.__man;
    const back = { x: -Math.sin(e.yaw), z: -Math.cos(e.yaw) };
    const side = { x: back.z, z: -back.x };
    const at = e.position.clone();
    at.x += back.x * 1.5 + side.x * 0.5;
    at.z += back.z * 1.5 + side.z * 0.5;
    ctx.world.nav.nearest(at, 2, at);
    ctx.player.teleport(at.setY(at.y + 0.1), 0);
  });
  await h.sleep(1500);
  await page.evaluate(() => window.__look(window.__man.position.x, window.__man.position.y + 0.45, window.__man.position.z));
  await h.sleep(250);
  await shot('cuffed');
  // Back off to watch it come.
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const e = window.__man;
    // Nine metres off, wherever there is a clear view of him.
    const at = e.position.clone();
    for (let k = 0; k < 16; k++) {
      at.set(e.position.x + Math.cos(k * 0.39) * 9, e.position.y, e.position.z + Math.sin(k * 0.39) * 9);
      if (!ctx.world.nav.nearest(at, 2, at)) continue;
      const eye = at.clone().setY(at.y + 1.6);
      const to = e.center.clone().sub(eye);
      const len = to.length();
      if (!ctx.physics.raycast(eye, to.divideScalar(len), len - 0.5)) break;
    }
    ctx.player.teleport(at.setY(at.y + 0.1), 0);
  });
  const drone = () => page.evaluate(() => {
    const d = window.__o.captives.airlift.drones.find(x => x.busy);
    const c = window.__o.captives.airlift.of(window.__o.soldierOf(window.__man));
    return d ? { leg: d.leg, line: +d.line.toFixed(1), y: +(d.pos.y - d.floorY).toFixed(1), phase: c?.phase, lifted: d.lifted } : { phase: c?.phase };
  });
  // Between the man and the drone, `k` of the way up, so both are in the frame and he is clear of the gun.
  const watch = (k = 0.5) => page.evaluate(k => {
    const d = window.__o.captives.airlift.drones.find(x => x.busy);
    const e = window.__man;
    if (!d) return;
    window.__look(e.position.x + (d.pos.x - e.position.x) * k, e.position.y + 0.5 + (d.pos.y - e.position.y) * k, e.position.z + (d.pos.z - e.position.z) * k);
  }, k);
  const t0 = Date.now();
  out.legs = [];
  let last = '';
  while (Date.now() - t0 < 40000) {
    const s = await drone();
    if (s.leg !== last) out.legs.push(`${s.leg} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    last = s.leg;
    await watch(0.42);
    if (s.leg === 'lower' && s.line > 4) break;
    await h.sleep(100);
  }
  await shot('hover');
  out.hover = await drone();
  await until(() => window.__o.captives.airlift.drones.some(d => d.busy && d.lifted), 20000, 30);
  await page.evaluate(() => {
    const e = window.__man;
    window.__look(e.position.x, e.position.y + 1.4, e.position.z);
  });
  await shot('bounty');
  out.secured = await drone();
  const t1 = Date.now();
  while (Date.now() - t1 < 8000) {
    const s = await drone();
    await page.evaluate(() => {
      const e = window.__man;
      window.__look(e.position.x, e.position.y + 1.2, e.position.z);
    });
    if (s.leg === 'climb' || (s.leg === 'haul' && s.line <= 3.3)) break;
    await h.sleep(100);
  }
  await h.sleep(900);
  await watch();
  await shot('lifted');
  out.lifted = await drone();
  await h.sleep(9000);
  out.after = await page.evaluate(() => ({
    gone: !window.__man.alive, flying: window.__o.captives.airlift.flying, feed: window.__feed,
    credits: window.__ctx.contracts.defense?.credits ?? null, before: window.__credits,
  }));
  return out;
}
