// The Office in a real browser, in either mode: waves spawn, the swarm reaches the player or the squads take cover, a wave is
// cleared and the supply pod lands under open sky, and what it costs in frames and draw calls.
//
//   node tools/shot.mjs --port 5293 --url "/?contract=crucible&map=office&autostart=1&dev=1" --dpr 2 --w 1440 --h 900 \
//     --script tools/scripts/office-live.mjs --out tools/out/office/live-swarm.png --wait 500 --timeout 280
//   (contract=outpost for Endless Humans.)
//
// OFFICE_AT=x,y,z,yaw is where the player stands (default the open office upstairs). OFFICE_SECONDS is the watch (default 40).
export default async function live(page, h) {
  const shot = name => h.shot(name).catch(e => console.error(`shot ${name} failed: ${e.message.split('\n')[0]}`));
  const started = Date.now();
  while (Date.now() - started < 120000) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  const boot = Math.round((Date.now() - started) / 1000);
  const at = (process.env.OFFICE_AT ?? '8,4.4,6,3.14').split(',').map(Number);
  const seconds = Number(process.env.OFFICE_SECONDS ?? 40);
  await page.evaluate(([x, y, z, yaw]) => {
    const { ctx } = window.__op2;
    const p = ctx.player;
    p.modifiers.invulnerable = true;
    ctx.weapons.modifiers.bottomlessMag = true;
    p.teleport(p.position.clone().set(x, y + 0.1, z), yaw);
    const log = { frames: [], calls: [], tris: [], samples: [], errors: [], seen: new Map(), stuck: 0, maxAlive: 0, closest: Infinity };
    window.__office = log;
    window.addEventListener('error', e => log.errors.push(String(e.message)));
    let last = performance.now();
    const tick = now => {
      requestAnimationFrame(tick);
      log.frames.push(now - last);
      last = now;
      log.calls.push(ctx.render.lastCalls ?? 0);
      log.tris.push(ctx.render.lastTriangles ?? 0);
    };
    requestAnimationFrame(tick);
  }, at);

  const sample = () => page.evaluate(() => {
    const { ctx } = window.__op2;
    const log = window.__office;
    const p = ctx.player.position;
    const alive = ctx.enemies.alive;
    log.maxAlive = Math.max(log.maxAlive, alive.length);
    let near = 0, sum = 0, n = 0, stuck = 0;
    for (const e of alive) {
      const d = e.position.distanceTo(p);
      log.closest = Math.min(log.closest, d);
      if (d < 6) near++;
      const path = ctx.world.nav.pathDistance(e.position);
      if (Number.isFinite(path)) { sum += path; n++; }
      const k = log.seen.get(e.uid) ?? { x: e.position.x, z: e.position.z, still: 0 };
      const moved = Math.hypot(e.position.x - k.x, e.position.z - k.z);
      k.still = moved < 0.3 && path > 8 ? k.still + 1 : 0;
      k.x = e.position.x; k.z = e.position.z;
      log.seen.set(e.uid, k);
      if (k.still >= 8) stuck++;
    }
    const o = ctx.enemies.outpost;
    const soldiers = o?.soldiers ?? [];
    const s = {
      wave: ctx.waves?.wave, phase: ctx.waves?.phase, alive: alive.length, near, meanPath: n ? Math.round(sum / n) : null, stuck,
      inCover: soldiers.filter(x => x.spot).length, soldiers: soldiers.length, squads: o?.squads?.length ?? 0,
    };
    log.samples.push(s);
    return s;
  });

  const t0 = Date.now();
  let shots = 0;
  while ((Date.now() - t0) / 1000 < seconds) {
    const s = await sample();
    const t = (Date.now() - t0) / 1000;
    if (shots === 0 && s.alive > 0 && (s.near > 0 || s.inCover > 0 || t > seconds * 0.5)) { await shot('cqb-1'); shots++; }
    else if (shots === 1 && t > seconds * 0.8) { await shot('cqb-2'); shots++; }
    await h.sleep(1000);
  }
  const watch = await page.evaluate(() => {
    const l = window.__office;
    const f = [...l.frames].sort((a, b) => a - b), c = [...l.calls].sort((a, b) => a - b), r = [...l.tris].sort((a, b) => a - b);
    const q = (a, x) => a[Math.min(a.length - 1, Math.floor(a.length * x))];
    return {
      frames: l.frames.length, frameMedian: q(f, 0.5)?.toFixed(1), frameP95: q(f, 0.95)?.toFixed(1),
      callsMedian: q(c, 0.5), callsMax: c[c.length - 1], trisMedian: q(r, 0.5), maxAlive: l.maxAlive, closest: l.closest.toFixed(1),
      peakNear: Math.max(...l.samples.map(s => s.near)), peakInCover: Math.max(...l.samples.map(s => s.inCover)),
      peakStuck: Math.max(...l.samples.map(s => s.stuck)), lastSample: l.samples[l.samples.length - 1], errors: l.errors,
    };
  });

  // Clear the wave by hand and wait for the supply pod.
  let pod = null;
  const t1 = Date.now();
  while ((Date.now() - t1) / 1000 < 90) {
    pod = await page.evaluate(() => {
      const { ctx } = window.__op2;
      if (ctx.waves?.phase !== 'intermission') ctx.enemies.killAll('test');
      const pods = ctx.progression?.pods?.pods ?? [];
      const live = pods.find(p => p.phase === 'landed' || p.phase === 'open');
      if (!live) return null;
      const at = live.entry.position;
      const up = ctx.physics.raycast(at.clone().setY(at.y + 1.5), at.clone().set(0, 1, 0), 60);
      const p = ctx.player;
      p.teleport(at.clone().set(at.x + 6, at.y + 0.1, at.z + 6), Math.atan2(6, 6));
      return { phase: live.phase, at: at.toArray().map(v => Math.round(v * 10) / 10), openSky: up === null, wave: ctx.waves.wave };
    });
    if (pod) break;
    await h.sleep(1000);
  }
  if (pod) { await h.sleep(1500); await shot('pod'); }
  return { boot, at, watch, pod };
}
