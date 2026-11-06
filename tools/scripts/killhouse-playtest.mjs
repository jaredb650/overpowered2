// Waves 1 and 2 of the real game on The Kill House, played by a bot that holds a station for 20 s and then moves on.
//
//   node tools/shot.mjs --url "/?map=killhouse&autostart=1" --dpr 2 --w 1440 --h 900 --script tools/scripts/killhouse-playtest.mjs --out tools/out/kh-play.png --wait 500 --timeout 230
//
// The slowest walkers cover about 76 m in 20 s and the longest route an enemy has is under 90 m, so anything older than that
// and still far away by path at the end of a station is lost or stuck, not just late. Env: KH_SECONDS (default 170).
const seconds = Number(process.env.KH_SECONDS ?? 170);

export default async function playtest(page, h) {
  // On a busy machine a Retina screenshot can time out. The numbers are the point, so a lost picture must not lose them.
  const shot = name => h.shot(name).catch(e => console.error(`shot ${name} failed: ${e.message.split('\n')[0]}`));
  const started = Date.now();
  let ready = false;
  while (!ready && Date.now() - started < 90000) {
    ready = await page.evaluate(() => window.__op2?.game?.state === 'playing');
    if (!ready) await h.sleep(1000);
  }
  if (!ready) return { booted: false, body: await page.evaluate(() => document.body.innerText.slice(0, 500)) };
  const bootSeconds = Math.round((Date.now() - started) / 1000);

  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const p = ctx.player;
    const STATION_SECONDS = 20, FAR = 30, VERY_FAR = 50, STILL_SECONDS = 8, STILL_PATH = 18;
    p.modifiers.invulnerable = true;
    ctx.weapons.modifiers.bottomlessMag = true;
    const at = (x, y, z) => { const v = p.position.clone(); v.set(x, y, z); return v; };
    const stations = [
      ['court', at(-6.6, 0.1, 2.6)], ['room1', at(-23, 0.1, -17.6)], ['deck', at(14.5, 4.6, 14.5)], ['room4', at(19, 0.1, 8)],
      ['yard', at(-20, 0.1, 31)], ['room7', at(-17, 0.1, 17)], ['room2', at(8, 0.1, -19)], ['corridor', at(11.7, 0.1, -11.7)],
    ];
    const log = {
      frames: [], stations: [], waves: [], errors: [], spawned: 0, seenAtSpawn: 0, spawnPathMin: Infinity, spawnPathSum: 0,
      offGraph: 0, stuck: [], maxAlive: 0, kills: 0,
    };
    window.__kh = log;
    window.addEventListener('error', e => log.errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', e => log.errors.push(String(e.reason)));
    const known = new Map();
    const eye = p.eye.clone(), dir = p.eye.clone();
    const clearLine = target => {
      eye.copy(p.eye);
      dir.subVectors(target, eye);
      const d = dir.length();
      dir.divideScalar(d);
      return ctx.physics.raycast(eye, dir, d) === null;
    };
    let last = performance.now(), t = 0, stationT = 0, stationIndex = 0, sampleT = 0, lastWave = -1;
    const tick = now => {
      requestAnimationFrame(tick);
      const dt = (now - last) / 1000;
      last = now;
      log.frames.push(dt * 1000);
      t += dt;
      stationT += dt;
      sampleT += dt;
      const wave = ctx.waves?.wave ?? 0;
      if (wave !== lastWave) { lastWave = wave; log.waves.push({ wave, t: Math.round(t), phase: ctx.waves?.phase }); }
      const live = ctx.enemies.alive.filter(e => e.dying === 0);
      log.maxAlive = Math.max(log.maxAlive, live.length);

      // Aim at the nearest enemy it can actually see, as a player would. Bodies around a corner have to come to it.
      let best = null, bestD = Infinity;
      for (const e of live) {
        const seen = known.get(e.uid);
        if (!seen) {
          const path = ctx.world.nav.pathDistance(e.position);
          known.set(e.uid, { born: t, x: e.position.x, z: e.position.z, stillFor: 0, flagged: false });
          log.spawned++;
          if (Number.isFinite(path)) { log.spawnPathMin = Math.min(log.spawnPathMin, path); log.spawnPathSum += path; }
          if (clearLine(e.center)) log.seenAtSpawn++;
        }
        const d = e.position.distanceToSquared(p.position);
        if (d < bestD && clearLine(e.center)) { bestD = d; best = e; }
      }
      if (best) {
        const dx = best.center.x - p.eye.x, dy = best.center.y - p.eye.y, dz = best.center.z - p.eye.z;
        p.yaw = Math.atan2(-dx, -dz);
        p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      }
      ctx.input.simulate('fire', best !== null);

      if (sampleT >= 2) {
        sampleT = 0;
        for (const e of live) {
          const k = known.get(e.uid);
          const moved = Math.hypot(e.position.x - k.x, e.position.z - k.z);
          k.x = e.position.x; k.z = e.position.z;
          k.stillFor = moved < 0.75 ? k.stillFor + 2 : 0;
          const path = ctx.world.nav.pathDistance(e.position);
          if (!Number.isFinite(path)) log.offGraph++;
          if (k.stillFor >= STILL_SECONDS && path > STILL_PATH && !k.flagged) {
            k.flagged = true;
            log.stuck.push(`${e.def.id} at ${e.position.x.toFixed(1)},${e.position.y.toFixed(1)},${e.position.z.toFixed(1)} path ${path.toFixed(0)} mode ${e.mode}`);
          }
        }
      }

      if (stationT >= STATION_SECONDS) {
        // The count the brief asks for, taken before moving: bodies old enough to have got here and still far by path.
        const old = live.filter(e => t - known.get(e.uid).born >= 20);
        const paths = old.map(e => ctx.world.nav.pathDistance(e.position));
        log.stations.push({
          at: stations[stationIndex % stations.length][0], t: Math.round(t), wave, alive: live.length, old: old.length,
          far: paths.filter(d => d > FAR).length, veryFar: paths.filter(d => d > VERY_FAR).length,
          worst: paths.length ? Math.round(Math.max(...paths.filter(Number.isFinite), 0)) : 0,
          farList: old.filter(e => ctx.world.nav.pathDistance(e.position) > FAR).slice(0, 4).map(e => `${e.def.id} ${e.position.x.toFixed(0)},${e.position.y.toFixed(0)},${e.position.z.toFixed(0)} ${e.mode}`),
        });
        stationT = 0;
        stationIndex++;
        const next = stations[stationIndex % stations.length];
        p.teleport(next[1], p.yaw);
        ctx.world.nav.setTarget(next[1]);
      }
    };
    requestAnimationFrame(tick);
  });

  const shots = Math.floor(seconds / 30);
  for (let i = 1; i <= shots; i++) {
    await h.sleep(30000);
    await shot(`t${i * 30}`);
  }
  await h.sleep(Math.max(0, seconds - shots * 30) * 1000);

  return page.evaluate(boot => {
    const k = window.__kh;
    const { ctx, game } = window.__op2;
    const sorted = [...k.frames].sort((a, b) => a - b);
    const q = f => sorted[Math.floor(sorted.length * f)]?.toFixed(1);
    return {
      boot, frames: k.frames.length, frameMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99) }, stats: game.stats(),
      waves: k.waves, wave: ctx.waves?.wave, phase: ctx.waves?.phase, alive: ctx.enemies.alive.length, maxAlive: k.maxAlive,
      score: ctx.progression?.score, kills: ctx.progression?.kills,
      spawned: k.spawned, seenAtSpawn: k.seenAtSpawn, spawnPath: { min: Math.round(k.spawnPathMin), mean: Math.round(k.spawnPathSum / Math.max(1, k.spawned)) },
      offGraphSamples: k.offGraph, stuck: k.stuck.slice(0, 16), stations: k.stations, errors: k.errors.slice(0, 12),
    };
  }, bootSeconds);
}
