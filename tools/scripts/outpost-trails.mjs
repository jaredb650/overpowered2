// The Outpost in the real game: records the same trails as outpost-sim.ts, from real Chrome, and photographs the moments
// the headless run cannot show. The bot stands still and fires on what it can see, unless OUTPOST_BOT=silent.
//
//   node tools/shot.mjs --url "/?contract=outpost&autostart=1&dev=1" --dpr 2 --w 1440 --h 900 --script tools/scripts/outpost-trails.mjs --out tools/out/outpost-live.png --wait 500 --timeout 170
//
// Env: OUTPOST_SECONDS (default 70). Writes tools/out/outpost-live.json for outpost-plot.py. Shots: cover, peek, flight, surrender.
import { writeFileSync } from 'node:fs';

const seconds = Number(process.env.OUTPOST_SECONDS ?? 70);
const silent = process.env.OUTPOST_BOT === 'silent';

export default async function trails(page, h) {
  const shot = name => h.shot(name).catch(e => console.error(`shot ${name} failed: ${e.message.split('\n')[0]}`));
  const started = Date.now();
  while (Date.now() - started < 90000) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  const boot = Math.round((Date.now() - started) / 1000);

  await page.evaluate(({ quiet }) => {
    const { ctx } = window.__op2;
    const o = ctx.enemies.outpost;
    const p = ctx.player;
    // A deep pool, not invulnerability, so that incoming damage still gets counted.
    p.maxHealth = p.health = 1e6;
    ctx.weapons.modifiers.bottomlessMag = true;
    const at = p.position.clone().set(0, 0.1, -19);
    p.teleport(at, 0);
    const log = [], samples = [], frames = [];
    let hurt = 0;
    const rec = (type, fn) => ctx.events.on(type, e => log.push({ t: +ctx.time.elapsed.toFixed(2), type, ...fn(e) }));
    rec('comms:line', e => ({ kind: e.kind, text: e.text, who: e.speaker ?? e.squad }));
    rec('enemy:broken', e => ({ uid: e.enemy.uid, fate: e.fate }));
    rec('enemy:surrendered', e => ({ uid: e.enemy.uid }));
    rec('enemy:escaped', e => ({ uid: e.enemy.uid }));
    rec('enemy:executed', e => ({ uid: e.kill.enemy.uid }));
    rec('squad:broken', e => e);
    rec('dread:spike', e => e);
    rec('wave:start', e => e);
    rec('wave:clear', e => e);
    rec('enemy:killed', e => ({ uid: e.enemy.uid, id: e.enemy.id, x: e.enemy.position.x, z: e.enemy.position.z }));
    ctx.events.on('player:damaged', e => { hurt += e.amount; });
    const errors = [];
    window.addEventListener('error', e => errors.push(String(e.message)));
    let clock = 0, last = performance.now();
    const man = e => {
      const s = o.soldierOf(e);
      return s ? {
        u: e.uid, id: e.id, q: s.squad.name, tm: s.team, r: s.role, l: s.isLeader ? 1 : 0, m: s.squad.mode, k: s.task, st: s.stage, f: s.fate, b: e.behaviour?.name ?? '-',
        ms: s.state, mo: Math.round(s.morale), see: s.sees ? 1 : 0, ex: s.exposed ? 1 : 0, sp: s.spot ? 1 : 0, sh: s.canShoot ? 1 : 0, mt: s.squad.movingTeam, a: e.attack?.name ?? '',
        x: +e.position.x.toFixed(2), y: +e.position.y.toFixed(2), z: +e.position.z.toFixed(2), v: +Math.hypot(e.velocity.x, e.velocity.z).toFixed(2), fl: s.squad.filing ? 1 : 0,
      } : { u: e.uid, id: e.id, x: e.position.x, z: e.position.z };
    };
    const tick = now => {
      requestAnimationFrame(tick);
      const dt = (now - last) / 1000;
      last = now;
      frames.push(dt * 1000);
      clock -= dt;
      if (clock > 0) return;
      clock = 0.25;
      samples.push({
        t: +ctx.time.elapsed.toFixed(2), px: +p.position.x.toFixed(2), py: +p.position.y.toFixed(2), pz: +p.position.z.toFixed(2), dread: +o.dread.value.toFixed(1),
        hostile: o.hostile, prisoners: o.prisoners, wave: ctx.waves.wave, phase: ctx.waves.phase, men: ctx.enemies.alive.map(man),
      });
    };
    requestAnimationFrame(tick);
    window.__out = { log, samples, frames, errors, hurt: () => hurt };
    window.__look = (e, aim) => {
      const dx = e.position.x - p.position.x, dz = e.position.z - p.position.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = aim ? Math.atan2(e.center.y - p.eye.y, Math.hypot(dx, dz)) : -0.06;
    };
    // Stands the camera a few metres from a man, facing him, for a photograph.
    window.__visit = (test, range) => {
      const list = ctx.enemies.alive.filter(e => { const s = o.soldierOf(e); return s && test(s, e); });
      const e = list[0];
      if (!e) return null;
      const a = Math.atan2(p.position.x - e.position.x, p.position.z - e.position.z);
      const spot = e.position.clone();
      spot.x += Math.sin(a) * range;
      spot.z += Math.cos(a) * range;
      if (!ctx.world.nav.nearest(spot, 6, spot)) spot.copy(p.position);
      spot.y += 0.1;
      p.teleport(spot, 0);
      window.__look(e);
      return { id: e.id, uid: e.uid, posture: o.soldierOf(e).stage, at: spot.toArray() };
    };
  }, { quiet: silent });

  const fire = async () => {
    if (silent) return;
    await page.evaluate(() => {
      const { ctx } = window.__op2;
      const o = ctx.enemies.outpost;
      let best = null, d = 34;
      for (const e of ctx.enemies.alive) {
        const s = o.soldierOf(e);
        if (e.hasLos && e.dist < d && !s?.surrendered) { best = e; d = e.dist; }
      }
      if (best) window.__look(best, true);
      ctx.input.simulate('fire', !!best);
    });
  };
  const ceaseFire = () => page.evaluate(() => window.__op2.ctx.input.simulate('fire', false));

  const taken = {};
  const moment = async (name, test, range) => {
    if (taken[name]) return;
    const found = await page.evaluate(({ src, r }) => window.__visit(new Function('s', 'e', `return ${src}`), r), { src: test, r: range });
    if (!found) return;
    taken[name] = found;
    await h.sleep(500);
    await shot(name);
  };

  const t0 = Date.now();
  let holdingFire = false;
  while ((Date.now() - t0) / 1000 < seconds) {
    const left = seconds - (Date.now() - t0) / 1000;
    if (!holdingFire) await fire();
    await h.sleep(350);
    if (left < seconds * 0.6) {
      // Low cover only, with a man who has been there a moment, or the shot is of someone arriving at a gate.
      await moment('cover', "s.stage === 'hide' && s.spot && (s.spot.low & ~s.spot.tall) !== 0 && s.fate === 'none' && s.task === 'hold' && s.squad.mode === 'engage'", 4.5);
      await moment('peek', "s.stage === 'peek' && s.spot && s.fireSide !== 0 && s.fate === 'none' && s.task === 'hold' && s.squad.mode === 'engage'", 7);
    }
    if (left < seconds * 0.3 && !holdingFire) {
      // From here on the point is the breaking: scare whoever is left and photograph what they do.
      holdingFire = true;
      await ceaseFire();
      await page.evaluate(() => {
        const o = window.__op2.ctx.enemies.outpost;
        for (const s of o.soldiers) if (s.fighting) s.morale = 3;
      });
      await h.sleep(900);
    }
    if (holdingFire) {
      await moment('surrender', "s.surrendered && !s.released", 3.2);
      await moment('flight', "s.fate === 'flee' && !s.released", 4);
    }
  }
  const data = await page.evaluate(() => {
    const o = window.__out;
    const { ctx, stats } = window.__op2;
    const outpost = ctx.enemies.outpost;
    const f = o.frames.slice().sort((a, b) => a - b);
    const plan = ctx.world.spec.plan;
    return {
      scenario: 'live', samples: o.samples, log: o.log,
      plan: { walls: plan.walls, blocks: plan.blocks, doors: plan.doors, gates: plan.gates, spots: outpost.cover.spots.map(s => [s.position.x, s.position.y, s.position.z, s.low, s.tall]) },
      stats: { coverSpots: outpost.cover.spots.length, hurt: Math.round(o.hurt()), frames: f.length, p50: +f[f.length >> 1].toFixed(1), p95: +f[Math.floor(f.length * 0.95)].toFixed(1), ...stats() },
      errors: o.errors,
    };
  });
  writeFileSync('tools/out/outpost-live.json', JSON.stringify(data));
  return { boot, stats: data.stats, errors: data.errors, samples: data.samples.length, moments: taken };
}
