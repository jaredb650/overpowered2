// The humans in real Chrome: what the player sees and feels. Forces each moment, photographs it and reads the state behind it.
//
//   HUMAN_CASES=suppress,flash node tools/shot.mjs --url "/?contract=outpost&autostart=1&dev=1" --dpr 2 --w 1440 --h 900 --script tools/scripts/humans-live.mjs --out tools/out/humans.png --wait 500 --timeout 170
//
// Cases: suppress flash prompt question grab orders fight perf swarm. `fight` is real bullets from a real wave at a strafing player. Each writes tools/out/<out>-<case>-*.png. Prefer one to three per run.
const cases = (process.env.HUMAN_CASES ?? 'suppress,flash,prompt').split(',');

export default async function live(page, h) {
  const out = {};
  const shot = name => h.shot(name).catch(e => console.error(`shot ${name} failed: ${e.message.split('\n')[0]}`));
  const started = Date.now();
  while (Date.now() - started < 90000) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  out.boot = Math.round((Date.now() - started) / 1000);
  if (cases[0] === 'swarm') {
    out.swarm = await page.evaluate(() => {
      const { ctx } = window.__op2;
      return { outpost: ctx.enemies.outpost, waves: ctx.waves.constructor.name, alive: ctx.enemies.alive.length, interceptor: ctx.player.interceptor };
    });
    return out;
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const o = ctx.enemies.outpost;
    window.__ctx = ctx;
    window.__o = o;
    ctx.player.maxHealth = ctx.player.health = 1e5;
    ctx.waves.update = () => {};
    for (const e of [...ctx.enemies.alive]) ctx.enemies.withdraw?.(e);
    // A squad in the open, `offset` from the player's feet.
    window.__squad = (ids, grade, x, z) => {
      const p = ctx.player.position.clone();
      p.x += x;
      p.z += z;
      ctx.world.nav.nearest(p, 6, p);
      o.formSquad(ids.length, p);
      const q = o.squads[o.squads.length - 1];
      q.grade = grade;
      return ids.map((id, i) => {
        const at = p.clone();
        at.x += (i % 3) * 1.4;
        at.z += Math.floor(i / 3) * 1.4;
        ctx.world.nav.nearest(at, 3, at);
        return ctx.enemies.spawn(id, at);
      });
    };
    window.__look = (x, y, z) => {
      const p = ctx.player;
      p.yaw = Math.atan2(-(x - p.position.x), -(z - p.position.z));
      p.pitch = Math.atan2(y - p.eye.y, Math.hypot(x - p.position.x, z - p.position.z));
    };
  });

  const stand = (x, z, yaw = 0) => page.evaluate(({ x, z, yaw }) => {
    const p = window.__ctx.player;
    p.teleport(p.position.clone().set(x, 0.1, z), yaw);
  }, { x, z, yaw });
  const clear = () => page.evaluate(() => {
    const { ctx } = window.__op2;
    for (const e of [...ctx.enemies.alive]) ctx.enemies.withdraw?.(e);
  });

  const CASES = {
    async suppress() {
      // The yard is the one place on the Kill House with a long line.
      await stand(-30, -10, Math.PI);
      await h.sleep(600);
      await shot('suppress-calm');
      const line = await page.evaluate(() => {
        const { ctx } = window.__op2;
        const o = window.__o;
        const p = ctx.player;
        // The longest clear line out of here, in front of the player, so that they really can see each other.
        let at = [0, 12], best = 0;
        const dir = p.forward.clone();
        for (let i = -12; i <= 12; i++) {
          const a = Math.atan2(p.forward.x, p.forward.z) + i * 0.05;
          dir.set(Math.sin(a), 0, Math.cos(a));
          const reach = Math.min(ctx.physics.raycast(p.eye, dir, 34)?.distance ?? 34, 34);
          if (reach > best) {
            best = reach;
            at = [dir.x * reach * 0.85, dir.z * reach * 0.85];
          }
        }
        window.__men = window.__squad(['brute', 'trooper', 'trooper'], 'veteran', at[0], at[1]);
        window.__level = 0;
        const tick = () => { window.__level = Math.max(window.__level, o.suppression.level); requestAnimationFrame(tick); };
        tick();
        return at;
      });
      // On the game's own clock: this machine has other work, and a slow frame must not end the test early.
      const startedAt = await page.evaluate(() => window.__ctx.time.elapsed);
      let level = 0, clock = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 75000 && clock < 30 && level < 0.75) {
        await h.sleep(250);
        [level, clock] = await page.evaluate(s => [window.__o.suppression.level, window.__ctx.time.elapsed - s], startedAt);
      }
      await shot('suppress-under-fire');
      const read = await page.evaluate(() => ({ now: window.__o.suppression.level, peak: window.__level, cracks: window.__o.suppression.cracks, health: window.__ctx.player.health }));
      await clear();
      return { line, seconds: +clock.toFixed(1), ...read };
    },
    async flash() {
      await stand(-30, -10, Math.PI);
      await h.sleep(400);
      await page.evaluate(() => {
        const { ctx } = window.__op2;
        const p = ctx.player;
        const at = p.position.clone().addScaledVector(p.forward, 5);
        at.y = p.position.y + 0.5;
        window.__o.flashbang(at, 0.15);
      });
      await h.sleep(500);
      const peak = await page.evaluate(() => window.__o.suppression.blind);
      await shot('flash-1');
      await h.sleep(1600);
      await shot('flash-2');
      await h.sleep(1500);
      await shot('flash-3');
      await h.sleep(1500);
      await shot('flash-4');
      return { peak, ...(await page.evaluate(() => ({ after: window.__o.suppression.blind, level: window.__o.suppression.level }))) };
    },
    async prompt() {
      await stand(0, -19);
      await h.sleep(300);
      const read = await page.evaluate(() => {
        const { ctx } = window.__op2;
        const o = window.__o;
        const p = ctx.player;
        const men = window.__squad(['trooper', 'trooper'], 'regular', 0, -3.5);
        window.__man = men[0];
        window.__look(men[0].center.x, 1.2, men[0].center.z);
        o.collapse(o.soldierOf(men[0]), 'surrender');
        ctx.enemies.withdraw(men[1]);
        return p.position.distanceTo(men[0].position);
      });
      await h.sleep(1400);
      await page.evaluate(() => window.__look(window.__man.center.x, window.__man.position.y + 1.0, window.__man.center.z));
      await h.sleep(300);
      await shot('prompt');
      return read;
    },
    async question() {
      await CASES.prompt();
      await page.evaluate(() => {
        window.__squad(['trooper', 'gunner', 'trooper'], 'regular', 18, 26);
        window.__squad(['brute', 'trooper', 'trooper'], 'veteran', -18, 24);
      });
      await h.sleep(600);
      await page.evaluate(() => {
        const { ctx } = window.__op2;
        ctx.input.simulate('interact', true);
      });
      await h.sleep(120);
      await page.evaluate(() => window.__ctx.input.simulate('interact', false));
      await h.sleep(900);
      await shot('question');
      return page.evaluate(() => {
        const o = window.__o;
        const s = o.soldierOf(window.__man);
        return { questioned: s.questioned, prisoners: o.prisoners };
      });
    },
    async grab() {
      await CASES.prompt();
      await page.evaluate(() => window.__ctx.input.simulate('interact', true));
      await h.sleep(700);
      await page.evaluate(() => window.__ctx.input.simulate('interact', false));
      await h.sleep(300);
      await page.evaluate(() => {
        window.__look(window.__man.center.x, 1.4, window.__man.center.z);
        window.__squad(['trooper', 'trooper', 'trooper'], 'veteran', 2, -20);
      });
      await h.sleep(500);
      await shot('grab');
      const read = await page.evaluate(() => {
        const { ctx } = window.__op2;
        const o = window.__o;
        return { held: o.captives.held === o.soldierOf(window.__man), distance: window.__man.position.distanceTo(ctx.player.position) };
      });
      await h.sleep(5000);
      await shot('grab-late');
      return { ...read, ...(await page.evaluate(() => {
        const { ctx } = window.__op2;
        const o = window.__o;
        return { health: ctx.player.health, his: window.__man.health, alive: window.__man.alive, armor: window.__man.armor, heldNow: o.captives.held !== null };
      })) };
    },
    async fight() {
      // The real thing with nothing stood in for: a wave, flown rounds, the player's own capsule. It strafes and does not fight back.
      await stand(-30, 6);
      const start = await page.evaluate(() => {
        const { ctx } = window.__op2;
        const o = window.__o;
        o.setWave(3);
        window.__squad(['trooper', 'trooper', 'brute', 'trooper'], 'regular', 6, 24);
        window.__squad(['trooper', 'gunner', 'trooper', 'gunner'], 'regular', -6, -22);
        o.onWaveStart();
        window.__hurt = 0;
        window.__hits = 0;
        ctx.events.on('player:damaged', e => { window.__hurt += e.amount; window.__hits++; });
        let side = 1;
        window.__jink = setInterval(() => {
          side = -side;
          ctx.input.simulate('left', side < 0);
          ctx.input.simulate('right', side > 0);
          const near = ctx.enemies.alive.reduce((a, e) => (!a || e.position.distanceTo(ctx.player.position) < a.position.distanceTo(ctx.player.position) ? e : a), null);
          if (near) window.__look(near.center.x, near.center.y, near.center.z);
        }, 700);
        return ctx.time.elapsed;
      });
      let seconds = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 60000 && seconds < 45) {
        await h.sleep(1000);
        seconds = await page.evaluate(s => window.__ctx.time.elapsed - s, start);
        if (seconds > 18 && seconds < 20) await shot('fight');
      }
      return page.evaluate(s => {
        clearInterval(window.__jink);
        const { ctx } = window.__op2;
        ctx.input.simulate('left', false);
        ctx.input.simulate('right', false);
        const t = ctx.time.elapsed - s;
        return { seconds: +t.toFixed(1), damage: Math.round(window.__hurt), perMinute: Math.round((window.__hurt / t) * 60), hits: window.__hits, cracks: window.__o.suppression.cracks, speed: +ctx.player.speed.toFixed(1), squads: window.__o.squads.map(q => `${q.name} ${q.goal} ${q.drill} ${q.fighters()}`) };
      }, start);
    },
    async perf() {
      // The blur runs for as long as the player is under fire, so it has to be free. Same fight, with it forced off and forced full on.
      await stand(-30, 6);
      await page.evaluate(() => {
        window.__squad(['trooper', 'trooper', 'brute', 'trooper'], 'regular', 6, 24);
        window.__squad(['trooper', 'gunner', 'trooper', 'gunner'], 'regular', -6, -22);
        window.__o.onWaveStart();
        window.__sample = (level, ms) => new Promise(done => {
          const o = window.__o;
          const times = [];
          let last = performance.now();
          const started = last;
          const tick = now => {
            o.suppression.level = level;
            times.push(now - last);
            last = now;
            if (now - started < ms) requestAnimationFrame(tick);
            else {
              times.sort((a, b) => a - b);
              done({ level, frames: times.length, fps: +(times.length / (ms / 1000)).toFixed(1), median: +times[times.length >> 1].toFixed(1), p95: +times[Math.floor(times.length * 0.95)].toFixed(1) });
            }
          };
          requestAnimationFrame(tick);
        });
      });
      await h.sleep(3000);
      const rows = [];
      for (const level of [0, 1, 0, 1]) rows.push(await page.evaluate(l => window.__sample(l, 5000), level));
      return rows;
    },
    async orders() {
      await stand(0, -19);
      await page.evaluate(() => {
        const o = window.__o;
        o.commander.orders.reset();
        window.__squad(['trooper', 'trooper', 'brute', 'trooper'], 'regular', 19, 0);
        window.__squad(['trooper', 'gunner', 'trooper', 'gunner'], 'veteran', -19, 0);
        o.onWaveStart();
        window.__seen = [];
        window.__ctx.events.on('commander:order', e => window.__seen.push(`order ${e.squad} ${e.drill}`));
        window.__ctx.events.on('commander:obeyed', e => window.__seen.push(`obeyed ${e.squad} ${e.drill} ${e.seconds.toFixed(1)}s`));
      });
      let took = 0;
      for (let i = 0; i < 80 && took < 2; i++) {
        await h.sleep(500);
        const n = await page.evaluate(() => window.__seen.filter(s => s.startsWith('order')).length);
        if (n > took) {
          took = n;
          await h.sleep(500);
          await shot(`orders-${took}`);
        }
      }
      return page.evaluate(() => ({ seen: window.__seen, issued: window.__o.commander.orders.issued, obeyed: window.__o.commander.orders.obeyed }));
    },
  };

  for (const name of cases) {
    try {
      out[name] = await CASES[name]();
    } catch (e) {
      out[name] = `failed: ${e.message.split('\n')[0]}`;
    }
  }
  return out;
}
