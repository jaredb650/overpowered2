// The Lance in the real game on the Test Range: real enemies, real gore, the real trigger. A tap and its plasma ball, the
// charge by stage, a full beam down a column with the chain of bursts stepped for stills from the side, what a beam costs
// through twenty bodies, walls, and things that live through it.
//
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/lance-live.mjs --wait 500 --timeout 290 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/lance/live.png --quiet
//
// LANCE_ONLY=tap,wake,stages,chain,partial,twenty,walls,heavy reruns named steps; the whole list is too long for one run on a
// busy machine. With "/?map=range&lance=old" the same script drives the gun from before plasma, for the comparison: `tap`
// and `partial` mean nothing there and are skipped. Results are also written to <out dir>/live[-old].json after every step,
// and stills are JPEGs beside it, so a run that is cut short keeps what it had.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const only = (process.env.LANCE_ONLY ?? '').split(',').filter(Boolean);
const wants = step => only.length === 0 || only.includes(step);

export default async function lanceLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    window.V = ctx.player.position.constructor;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end) await window.frame();
    };
    /** Seconds on the player's clock, which is the one the trigger runs on. */
    window.mine = async seconds => {
      const end = ctx.time.playerElapsed + seconds;
      while (ctx.time.playerElapsed < end) await window.frame();
    };
    /** With the lab's pause on: steps the world on by `seconds`, a frame of 1/60 s at a time. */
    window.advance = async seconds => {
      const end = ctx.time.elapsed + seconds;
      for (let i = 0; i < 400 && ctx.time.elapsed < end - 1e-4; i++) {
        lab.step(1);
        await window.frame();
        await window.frame();
      }
    };
    window.wipe = async () => {
      ctx.enemies.reset();
      lab.spawner.clearBodies();
      ctx.fx.clear();
      await window.frame();
    };
    window.aimAt = (x, y, z) => {
      const p = ctx.player;
      const dx = x - p.eye.x;
      const dy = y - p.eye.y;
      const dz = z - p.eye.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
    window.start = { at: ctx.player.position.clone(), yaw: ctx.player.yaw };
    window.home = () => {
      const p = ctx.player;
      p.teleport(window.start.at.clone().setY(window.start.at.y + 0.1), window.start.yaw);
      p.pitch = 0;
      p.velocity.set(0, 0, 0);
    };
    window.fwd = () => new window.V(-Math.sin(window.start.yaw), 0, -Math.cos(window.start.yaw));
    window.side = () => new window.V(Math.cos(window.start.yaw), 0, -Math.sin(window.start.yaw));
    /** A point on the floor `d` metres down the range from the start and `x` to the right. */
    window.spot = (d, x = 0) => window.start.at.clone().addScaledVector(window.fwd(), d).addScaledVector(window.side(), x);
    window.setSpawn = (id, ai = 'off') => {
      Object.assign(lab.settings, { spawn: id, ai, arsenal: false });
      lab.changed();
      ctx.weapons.modifiers.bottomlessMag = false;
    };
    window.stat = e => ({
      alive: e.alive, hp: Math.round(e.health), max: Math.round(e.maxHealth), down: !!e.downed, lost: [...(e.char?.severed ?? [])].length,
    });
    /** How far `e` stands off the line down the range from the start, and how far along it. */
    window.off = e => {
      const d = e.position.clone().sub(window.start.at);
      return { along: d.dot(window.fwd()), across: d.dot(window.side()) };
    };
    window.fired = () => {
      const l = ctx.weapons.lance;
      return { balls: l.fired.balls, beams: [...l.fired.beams], bursts: l.fired.bursts, pending: l.chain.pending };
    };
    /** The trigger, to the frame. `seconds` is on the player's clock; 0 is a press and a release a frame apart. */
    window.pull = async (seconds = 0) => {
      ctx.input.simulate('fire', true);
      await window.frame();
      if (seconds > 0) await window.mine(seconds);
      ctx.input.simulate('fire', false);
      await window.frame();
      await window.frame();
    };
    /** Holds the trigger until the charge reads `level`, or for `seconds` when the page runs the old gun. Does not let go. */
    window.chargeTo = async (level, seconds = 1.2) => {
      ctx.input.simulate('fire', true);
      const t0 = performance.now();
      const old = new URLSearchParams(location.search).get('lance') === 'old';
      if (old && level >= 1) await window.mine(seconds);
      else while (ctx.weapons.charge < level - 1e-6 && performance.now() - t0 < 6000) await window.frame();
      // A frame more, so the stage that has just landed is on the screen and in the sound.
      await window.frame();
    };
    /** Frame times in ms from now until `seconds` of real time have passed. */
    window.record = seconds => new Promise(resolve => {
      const times = [];
      let last = performance.now();
      const t0 = last;
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        if (now - t0 < seconds * 1000) requestAnimationFrame(tick);
        else {
          const raw = [...times];
          times.sort((a, b) => a - b);
          const at = q => +times[Math.min(times.length - 1, Math.floor(times.length * q))].toFixed(1);
          resolve({
            n: times.length, p50: at(0.5), p95: at(0.95), max: at(1),
            over34: times.filter(t => t > 34).length, over50: times.filter(t => t > 50).length, over100: times.filter(t => t > 100).length,
            // The frames from the shot on, in order, so a spike can be placed.
            first: raw.slice(0, 45).map(t => Math.round(t)),
          });
        }
      };
      requestAnimationFrame(tick);
    });
    /** Times the work the Lance itself does: the ray of a beam, and each frame's bursts. */
    window.probe = () => {
      const out = { rayMs: [], tickMs: [], tickBursts: [] };
      const combat = ctx.combat;
      const fireRay = combat.fireRay.bind(combat);
      combat.fireRay = (o, d, spec) => {
        if (spec.source !== 'lance') return fireRay(o, d, spec);
        const t = performance.now();
        const r = fireRay(o, d, spec);
        out.rayMs.push(+(performance.now() - t).toFixed(2));
        return r;
      };
      const l = ctx.weapons.lance;
      const tick = l.tick.bind(l);
      l.tick = () => {
        const before = l.fired.bursts;
        const t = performance.now();
        tick();
        const ms = performance.now() - t;
        if (l.fired.bursts > before) {
          out.tickMs.push(+ms.toFixed(2));
          out.tickBursts.push(l.fired.bursts - before);
        }
      };
      window.unprobe = () => {
        delete combat.fireRay;
        delete l.tick;
      };
      return out;
    };
  });
  const old = await page.evaluate(() => new URLSearchParams(location.search).get('lance') === 'old');
  const out = { old };
  const file = join(h.outDir, old ? 'live-old.json' : 'live.json');
  const save = () => writeFileSync(file, JSON.stringify(out, null, 1));
  /** A JPEG beside the results. A still that will not come must not take the run with it. */
  const shot = async name => {
    try {
      await page.screenshot({ path: join(h.outDir, `${old ? 'old' : 'live'}-${name}.jpg`), type: 'jpeg', quality: 86, timeout: 25000 });
    } catch (e) {
      (out.shotsLost ??= []).push(name);
    }
  };

  await page.mouse.click(400, 500);
  await h.sleep(500);

  /** Stands a column down the range with the Lance drawn, aims through it, and returns who is in it. */
  const column = (count, id = 'trooper') => page.evaluate(async ([n, type]) => {
    const { ctx } = window.__op2;
    await window.wipe();
    window.home();
    window.setSpawn(type);
    await window.world(0.3);
    const before = new Set(ctx.enemies.alive);
    window.__lab.lance(n);
    await window.world(0.8);
    window.crew = ctx.enemies.alive.filter(e => !before.has(e));
    window.line = window.crew.filter(e => Math.abs(window.off(e).across) < 0.6).sort((a, b) => window.off(a).along - window.off(b).along);
    window.beside = window.crew.filter(e => Math.abs(window.off(e).across) >= 0.6);
    const far = window.line[window.line.length - 1];
    window.aimAt(far.center.x, far.center.y, far.center.z);
    await window.world(0.2);
    const reach = window.off(far).along;
    return { line: window.line.length, beside: window.beside.length, from: +window.off(window.line[0]).along.toFixed(1), to: +reach.toFixed(1), mag: ctx.weapons.ammo('lance').mag, weapon: ctx.weapons.current };
  }, [count, id]);
  const tally = () => page.evaluate(() => ({
    lineDead: window.line.filter(e => !e.alive).length,
    besideDead: window.beside.filter(e => !e.alive).length,
    besideHurt: window.beside.filter(e => e.alive && e.health < e.maxHealth).length,
    besideDown: window.beside.filter(e => e.alive && e.downed).length,
    besideLimbs: window.beside.reduce((n, e) => n + [...(e.char?.severed ?? [])].length, 0),
    fired: window.fired(),
  }));

  // A tap: one plasma ball, what it does to the body it hits and the one beside it, and how fast the taps come.
  if (wants('tap') && !old) {
    const r = {};
    r.before = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      window.home();
      window.setSpawn('trooper');
      await window.world(0.3);
      window.__lab.draw('lance');
      ctx.weapons.refillMagazines();
      window.t0 = window.__lab.spawner.place('trooper', window.spot(14), 'off');
      window.t1 = window.__lab.spawner.place('trooper', window.spot(14, 1.5), 'off');
      window.t2 = window.__lab.spawner.place('trooper', window.spot(14, 5), 'off');
      await window.world(0.8);
      window.aimAt(window.t0.center.x, window.t0.center.y, window.t0.center.z);
      await window.world(0.2);
      return [window.t0, window.t1, window.t2].map(window.stat);
    });
    // The world held still, so the ball can be caught in the air.
    r.ball = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      window.__lab.togglePause();
      await window.frame();
      await window.frame();
      await window.pull();
      const balls = ctx.combat.projectiles.active.filter(p => p.kind === 'plasma');
      const got = { count: balls.length, speed: balls[0] ? +balls[0].velocity.length().toFixed(1) : 0, mag: ctx.weapons.ammo('lance').mag, charge: ctx.weapons.charge, fired: window.fired() };
      await window.advance(0.08);
      return got;
    });
    await shot('ball-flight');
    await page.evaluate(() => window.advance(0.14));
    await shot('ball-burst');
    await page.evaluate(async () => {
      window.__lab.togglePause();
      await window.world(1.4);
    });
    await shot('ball-after');
    r.after = await page.evaluate(() => [window.t0, window.t1, window.t2].map(window.stat));
    save();

    // Eight taps a quarter of a second apart on the player's clock.
    r.rate = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      ctx.weapons.refillMagazines();
      const b0 = window.fired().balls;
      const t0 = ctx.time.playerElapsed;
      for (let i = 0; i < 8; i++) {
        const next = t0 + (i + 1) * 0.25;
        await window.pull();
        while (ctx.time.playerElapsed < next) await window.frame();
      }
      return { balls: window.fired().balls - b0, seconds: +(ctx.time.playerElapsed - t0).toFixed(2), mag: ctx.weapons.ammo('lance').mag };
    });

    // A Brute, plated: two balls, and whether it is put off its stride.
    r.brute = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      window.home();
      ctx.weapons.refillMagazines();
      const b = window.__lab.spawner.place('brute', window.spot(12), 'off');
      await window.world(0.8);
      window.aimAt(b.center.x, b.center.y, b.center.z);
      await window.world(0.2);
      const before = { ...window.stat(b), armor: Math.round(b.armor ?? 0) };
      await window.pull();
      await window.mine(0.3);
      await window.pull();
      await window.world(0.5);
      return { before, after: { ...window.stat(b), armor: Math.round(b.armor ?? 0), stagger: +(b.stagger ?? 0).toFixed(2) } };
    });
    out.tap = r;
    save();
  }

  // The ball in the air with nothing in its way: from the gun, and from beside its path, for its wake.
  if (wants('wake') && !old) {
    out.wake = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      window.home();
      window.__lab.draw('lance');
      ctx.weapons.refillMagazines();
      await window.world(0.6);
      window.__lab.togglePause();
      await window.frame();
      await window.frame();
      await window.pull();
      await window.advance(0.13);
      const ball = ctx.combat.projectiles.active.find(p => p.kind === 'plasma');
      return ball ? { out: +ball.position.distanceTo(ctx.player.eye).toFixed(1), size: ball.size, trail: ball.trail } : null;
    });
    await shot('wake-eye');
    await page.evaluate(async () => {
      const { ctx } = window.__op2;
      const from = window.spot(7, 6);
      const at = window.spot(8);
      ctx.player.teleport(from.setY(from.y + 0.1), 0);
      window.aimAt(at.x, at.y + 1.5, at.z);
      await window.frame();
      await window.frame();
    });
    await shot('wake-side');
    await page.evaluate(async () => {
      window.__lab.togglePause();
      await window.world(0.3);
      window.home();
    });
    save();
  }

  // The charge: what the bar, the gun and the view show at each stage, then the shot into open air.
  if (wants('stages')) {
    await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      window.home();
      window.setSpawn('trooper');
      window.__lab.draw('lance');
      ctx.weapons.refillMagazines();
      await window.world(0.7);
    });
    const sample = () => page.evaluate(() => {
      const { ctx } = window.__op2;
      const bar = document.querySelector('.xh-charge');
      return {
        charge: +ctx.weapons.charge.toFixed(2), stage: ctx.weapons.lance.stage, fov: +ctx.camera.fov.toFixed(1),
        look: +ctx.player.lookScale.toFixed(3), bar: bar ? `${bar.style.display === 'none' ? 'hidden' : 'shown'} ${bar.className}` : 'none',
      };
    });
    const r = { rest: await sample(), steps: [] };
    // The charge is let run to each level and then held there, so a still that takes a second is of a known moment.
    for (const [level, name] of old ? [[1, 'charge-full']] : [[0.15, 'charge-0'], [0.45, 'charge-1'], [0.8, 'charge-2'], [1, 'charge-full']]) {
      await page.evaluate(async lv => {
        const l = window.__op2.ctx.weapons.lance;
        delete l.update;
        await window.chargeTo(lv);
        l.update = () => {};
      }, level);
      r.steps.push({ name, ...(await sample()) });
      await shot(name);
    }
    // The world held, so the shot's first frame can be looked at, and then a little later.
    r.shot = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      const v0 = ctx.player.velocity.length();
      window.__lab.togglePause();
      await window.frame();
      delete ctx.weapons.lance.update;
      ctx.input.simulate('fire', false);
      await window.frame();
      await window.frame();
      return { mag: ctx.weapons.ammo('lance').mag, fired: window.fired(), pushed: +(ctx.player.velocity.length() - v0).toFixed(2) };
    });
    await shot('fire-air-00');
    await page.evaluate(() => window.advance(0.12));
    await shot('fire-air-12');
    await page.evaluate(async () => {
      await window.advance(0.4);
      window.__lab.togglePause();
    });
    r.after = await sample();
    out.stages = r;
    save();
  }

  // A full beam down a column of eight with three bystanders. The world is held on the shot and the view moved to the
  // side of the line, then stepped, so each still is a known moment of the ripple.
  if (wants('chain')) {
    const r = { set: await column(8) };
    r.atShot = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.chargeTo(1);
      const charge = +ctx.weapons.charge.toFixed(2);
      window.__lab.togglePause();
      await window.frame();
      ctx.input.simulate('fire', false);
      await window.frame();
      await window.frame();
      return { charge, lineDead: window.line.filter(e => !e.alive).length, fired: window.fired(), mag: ctx.weapons.ammo('lance').mag };
    });
    await shot('chain-eye-00');
    await page.evaluate(async () => {
      const { ctx } = window.__op2;
      // Off to the side of the middle of the column, looking across it.
      const mid = window.spot(8 + 3.5 * 1.8);
      const from = window.spot(8 + 3.5 * 1.8 - 3, 10);
      ctx.player.teleport(from.setY(from.y + 0.1), 0);
      window.aimAt(mid.x, mid.y + 1.1, mid.z);
      await window.frame();
      await window.frame();
    });
    await shot('chain-side-00');
    r.stills = [];
    let t = 0;
    for (const step of [0.07, 0.07, 0.1, 0.14, 0.3]) {
      await page.evaluate(s => window.advance(s), step);
      t += step;
      const name = `chain-side-${String(Math.round(t * 100)).padStart(2, '0')}`;
      await shot(name);
      r.stills.push({ name, bursts: (await tally()).fired.bursts });
    }
    await page.evaluate(async () => {
      window.__lab.togglePause();
      await window.world(2);
    });
    r.after = await tally();
    await shot('chain-side-after');
    out.chain = r;
    save();
  }

  // The weaker beams: let go at the first and at the second stage, down the same column.
  if (wants('partial') && !old) {
    const r = {};
    for (const [name, level] of [['low', 0.32], ['mid', 0.68]]) {
      await column(8);
      const charge = await page.evaluate(async lv => {
        const { ctx } = window.__op2;
        await window.chargeTo(lv);
        const c = +ctx.weapons.charge.toFixed(2);
        ctx.input.simulate('fire', false);
        await window.frame();
        await window.frame();
        return c;
      }, level);
      await shot(`partial-${name}`);
      await page.evaluate(() => window.world(1.2));
      r[name] = { charge, ...(await tally()), mag: await page.evaluate(() => window.__op2.ctx.weapons.ammo('lance').mag) };
    }
    out.partial = r;
    save();
  }

  // Twenty in line and seven beside them, twice: what the shot and its ripple cost a frame. The first volley of a page pays
  // for programs and gore that have never run; the second is the steady cost.
  if (wants('twenty')) {
    const r = { volleys: [] };
    for (let volley = 0; volley < 2; volley++) {
      const set = await column(20);
      const got = await page.evaluate(async () => {
        const { ctx } = window.__op2;
        const cost = window.probe();
        await window.chargeTo(1);
        const charge = +ctx.weapons.charge.toFixed(2);
        const quiet = await window.record(0.6);
        const frames = window.record(2.4);
        ctx.input.simulate('fire', false);
        const timing = await frames;
        await window.world(0.4);
        window.unprobe();
        const sum = cost.tickMs.reduce((a, b) => a + b, 0);
        return {
          charge, before: { p50: quiet.p50, max: quiet.max }, frames: timing,
          cost: {
            rayMs: cost.rayMs, burstFrames: cost.tickMs.length, burstMsTotal: +sum.toFixed(1),
            burstMsWorst: cost.tickMs.length ? Math.max(...cost.tickMs) : 0, mostBurstsInAFrame: cost.tickBursts.length ? Math.max(...cost.tickBursts) : 0,
          },
        };
      });
      r.volleys.push({ set, ...got, ...(await tally()) });
      out.twenty = r;
      save();
    }
    await shot('twenty-after');
  }

  // The piercing gallery: a full beam down the lane, through the walls its rule allows, with a burst in each bay it reaches.
  if (wants('walls')) {
    const r = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      window.setSpawn('trooper');
      window.__lab.draw('lance');
      ctx.weapons.refillMagazines();
      const before = new Set(ctx.enemies.alive);
      const placed = window.__lab.gallery();
      await window.world(0.9);
      const bays = ctx.enemies.alive.filter(e => !before.has(e)).sort((a, b) => a.position.distanceTo(ctx.player.position) - b.position.distanceTo(ctx.player.position));
      ctx.player.pitch = Math.atan2(bays[0].center.y - ctx.player.eye.y, 60);
      await window.world(0.2);
      const f0 = window.fired();
      await window.chargeTo(1);
      ctx.input.simulate('fire', false);
      await window.world(1.6);
      return { placed, dead: bays.map(e => (e.alive ? 0 : 1)).join(''), bursts: window.fired().bursts - f0.bursts };
    });
    await shot('walls-after');
    out.walls = r;
    save();
  }

  // What a full beam is worth on things that live through it, or would have.
  if (wants('heavy')) {
    const r = {};
    for (const id of ['brute', 'riot', 'juggernaut']) {
      r[id] = await page.evaluate(async type => {
        const { ctx } = window.__op2;
        await window.wipe();
        window.home();
        window.setSpawn(type);
        window.__lab.draw('lance');
        ctx.weapons.refillMagazines();
        const target = window.__lab.spawner.place(type, window.spot(18), 'off');
        await window.world(0.9);
        window.aimAt(target.center.x, target.center.y, target.center.z);
        await window.world(0.2);
        const before = { ...window.stat(target), armor: Math.round(target.armor ?? 0) };
        await window.chargeTo(1);
        ctx.input.simulate('fire', false);
        await window.world(1.2);
        return { before, after: { ...window.stat(target), armor: Math.round(target.armor ?? 0) } };
      }, id);
    }
    out.heavy = r;
    save();
  }
  return out;
}
