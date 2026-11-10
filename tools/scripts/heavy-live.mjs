// Key 8 in the real game, on the Test Range: the rotary cannon (the Trommel, id `buzzsaw`), the heavy machine gun (the
// Piledriver) and the helicopter's door gun. Real pointer lock, real trigger, real enemies, real gore.
//
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/heavy-live.mjs --wait 500 --timeout 280 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/heavy/live.png
//
// HEAVY_ONLY=view,rotary,hmg,gallery,slow,cost,door reruns named steps.
//
// view     stills of both guns in the hand, at rest and firing
// rotary   nine Troopers in three ranks: rate once spun, bursts a round, kills, limbs, and a still of the barrage
// hmg      the same nine with the heavy machine gun: rate, how many one file loses to one round, bodies burst
// gallery  the piercing gallery: which bays each gun reaches
// slow     run speed with W held: free, barrels turning, firing each gun, and after letting go
// cost     24 bodies with their AI on under each gun for six seconds: frame times, the physics step, bursts a second
// door     the door gun over the gallery: rounds, bursts, kills, hits on bodies it had no line of sight to, frame times
const only = (process.env.HEAVY_ONLY ?? '').split(',').filter(Boolean);
const wants = step => only.length === 0 || only.includes(step);

export default async function heavyLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.V = ctx.player.position.constructor;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end) await window.frame();
    };
    window.wipe = async () => {
      ctx.enemies.reset();
      window.__lab.spawner.clearBodies();
      await window.frame();
    };
    window.home = async (yaw = 0, pitch = 0) => {
      ctx.player.teleport(new window.V(0, 0.1, 15), yaw);
      ctx.player.pitch = pitch;
      await window.world(0.2);
    };
    const log = { fired: {}, kills: {}, gibbed: {}, severed: {}, hits: {} };
    window.__heavy = log;
    const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
    ctx.events.on('weapon:fired', e => bump(log.fired, e.weapon));
    ctx.events.on('enemy:killed', e => { bump(log.kills, e.damage.source); if (e.gibbed) bump(log.gibbed, e.damage.source); });
    ctx.events.on('enemy:severed', e => bump(log.severed, e.damage.source));
    ctx.events.on('enemy:hit', e => bump(log.hits, e.damage.source));
    window.clearLog = () => { for (const k of Object.keys(log)) log[k] = {}; ctx.combat.bursts.stats.bursts = ctx.combat.bursts.stats.fragments = 0; };
    /** Frame intervals and the physics step, from now until `done()`. */
    window.meter = () => {
      const m = { dts: [], steps: [], on: true };
      let last = performance.now();
      const tick = now => {
        if (!m.on) return;
        m.dts.push(now - last);
        last = now;
        m.steps.push(ctx.physics.stepMs);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      m.done = () => {
        m.on = false;
        const q = (list, p) => { const s = [...list].sort((a, b) => a - b); return Number((s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0).toFixed(1)); };
        return { frames: m.dts.length, p50: q(m.dts, 0.5), p95: q(m.dts, 0.95), max: q(m.dts, 1), step50: q(m.steps, 0.5), step95: q(m.steps, 0.95), stepMax: q(m.steps, 1) };
      };
      return m;
    };
    window.crowd = async (id, ai = 'off', gun = 'buzzsaw') => {
      await window.wipe();
      const lab = window.__lab;
      Object.assign(lab.settings, { spawn: id, ai });
      lab.changed();
      await window.home();
      const placed = lab.heavy(gun);
      await window.world(0.8);
      return placed;
    };
  });
  const out = {};
  const draw = id => page.evaluate(async w => {
    window.__lab.draw(w);
    window.__op2.ctx.weapons.refillMagazines();
    await window.world(0.7);
  }, id);
  const log = () => page.evaluate(() => JSON.parse(JSON.stringify({ ...window.__heavy, bursts: window.__op2.ctx.combat.bursts.stats })));

  // Real pointer lock, so the trigger and the keys are the player's.
  await page.mouse.click(400, 500);
  await h.sleep(500);

  if (wants('view')) {
    await page.evaluate(() => window.wipe().then(() => window.home()));
    for (const id of ['buzzsaw', 'piledriver']) {
      await draw(id);
      await h.shot(`view-${id}-rest`);
      await page.mouse.down();
      await h.sleep(id === 'buzzsaw' ? 1100 : 400);
      await h.shot(`view-${id}-fire`);
      await page.mouse.up();
      await h.sleep(900);
    }
    out.view = await page.evaluate(() => ({
      names: [window.__op2.ctx.weapons.current, document.querySelector('.arm-family')?.textContent ?? null],
    }));
  }

  if (wants('rotary')) {
    const placed = await page.evaluate(() => window.crowd('trooper'));
    await page.evaluate(() => window.clearLog());
    await page.mouse.down();
    // Everything timed in the page: a still costs many seconds here, so none is taken while the clock matters.
    const run = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      const fired = () => window.__heavy.fired.buzzsaw ?? 0;
      await window.world(1.3);
      const a = fired();
      const t0 = ctx.time.playerElapsed;
      await window.world(1);
      return { rps: Number(((fired() - a) / (ctx.time.playerElapsed - t0)).toFixed(1)) };
    });
    await page.mouse.up();
    await h.sleep(1200);
    const end = await log();
    await h.shot('rotary-after');
    out.rotary = {
      placed, rps: run.rps,
      fired: end.fired.buzzsaw ?? 0, bursts: end.bursts.bursts, fragments: end.bursts.fragments,
      kills: end.kills.buzzsaw ?? 0, gibbed: end.gibbed.buzzsaw ?? 0, severed: end.severed.buzzsaw ?? 0,
      left: await page.evaluate(() => window.__op2.ctx.enemies.alive.length),
    };
  }

  if (wants('hmg')) {
    const placed = await page.evaluate(() => window.crowd('trooper', 'off', 'piledriver'));
    await page.evaluate(() => window.clearLog());
    // One round down the middle file, by the trigger's own edge.
    const one = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      ctx.input.simulate('fire', true);
      await window.frame();
      await window.frame();
      ctx.input.simulate('fire', false);
      await window.world(0.6);
      const l = window.__heavy;
      return { fired: l.fired.piledriver ?? 0, hits: l.hits.piledriver ?? 0, kills: l.kills.piledriver ?? 0, gibbed: l.gibbed.piledriver ?? 0 };
    });
    await page.mouse.down();
    const run = await page.evaluate(async f0 => {
      const { ctx } = window.__op2;
      const fired = () => window.__heavy.fired.piledriver ?? 0;
      const t0 = ctx.time.playerElapsed;
      await window.world(2);
      return { rps: Number(((fired() - f0) / (ctx.time.playerElapsed - t0)).toFixed(1)), pitch: Number(ctx.player.pitch.toFixed(3)) };
    }, one.fired);
    await page.mouse.up();
    await h.sleep(1200);
    const end = await log();
    await h.shot('hmg-after');
    out.hmg = {
      placed, oneRound: one, rps: run.rps, pitchClimbed: run.pitch,
      fired: end.fired.piledriver ?? 0, kills: end.kills.piledriver ?? 0, gibbed: end.gibbed.piledriver ?? 0,
      severed: end.severed.piledriver ?? 0, bursts: end.bursts.bursts,
      left: await page.evaluate(() => window.__op2.ctx.enemies.alive.length),
    };
  }

  if (wants('gallery')) {
    out.gallery = {};
    const fill = () => page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      const lab = window.__lab;
      Object.assign(lab.settings, { spawn: 'trooper', ai: 'off' });
      lab.changed();
      const before = new Set(ctx.enemies.alive);
      lab.gallery();
      window.galleryCrew = ctx.enemies.alive.filter(e => !before.has(e)).sort((a, b) => a.position.x - b.position.x);
      ctx.player.pitch = -0.012;
      await window.world(0.8);
    });
    const bays = () => page.evaluate(() => window.galleryCrew.map(e => (e.alive ? Math.round(e.health) : 0)));
    for (const [id, ms] of [['piledriver', 1500], ['buzzsaw', 2000]]) {
      await fill();
      await draw(id);
      await page.evaluate(() => { window.__op2.ctx.player.pitch = -0.012; window.clearLog(); });
      await page.mouse.down();
      await h.sleep(ms);
      await page.mouse.up();
      await h.sleep(900);
      out.gallery[id] = { bays: await bays(), bursts: (await log()).bursts.bursts };
    }
    await h.shot('gallery-after');
  }

  if (wants('slow')) {
    out.slow = {};
    // One call in the page for each gun, so no round trip sits inside a run of thirty metres. Speed is ground covered over
    // time: the gun clamps once a frame and the player regains between clamps, so a reading taken after the clamp is the
    // bottom of a sawtooth, not its mean.
    const run = id => page.evaluate(async w => {
      const { ctx } = window.__op2;
      await window.wipe();
      ctx.player.teleport(new window.V(-26, 0.1, 12), -Math.PI / 2);
      ctx.player.pitch = 0.12;
      window.__lab.draw(w);
      ctx.weapons.refillMagazines();
      await window.world(0.7);
      const covered = async seconds => {
        const from = ctx.player.position.clone();
        const t0 = ctx.time.playerElapsed;
        await window.world(seconds);
        from.y = ctx.player.position.y;
        return Number((ctx.player.position.distanceTo(from) / (ctx.time.playerElapsed - t0)).toFixed(2));
      };
      const r = { from: Number(ctx.player.position.x.toFixed(1)) };
      ctx.input.simulate('forward', true);
      await window.world(0.4);
      r.free = await covered(0.4);
      if (w === 'buzzsaw') {
        ctx.input.simulate('aim', true);
        await window.world(0.9);
        r.spun = await covered(0.6);
        ctx.input.simulate('aim', false);
      }
      ctx.input.simulate('fire', true);
      await window.world(w === 'buzzsaw' ? 0.5 : 0.5);
      r.firing = await covered(0.9);
      ctx.input.simulate('fire', false);
      await window.world(w === 'buzzsaw' ? 1.4 : 0.7);
      r.after = await covered(0.3);
      ctx.input.simulate('forward', false);
      r.to = Number(ctx.player.position.x.toFixed(1));
      return r;
    }, id);
    out.slow.buzzsaw = await run('buzzsaw');
    out.slow.piledriver = await run('piledriver');
    // A jump taken while the cannon fires: it drags, and does not stop.
    out.slow.hop = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      ctx.player.teleport(new window.V(-26, 0.1, 12), -Math.PI / 2);
      ctx.player.pitch = 0.12;
      window.__lab.draw('buzzsaw');
      await window.world(0.7);
      ctx.input.simulate('forward', true);
      await window.world(0.6);
      ctx.input.simulate('fire', true);
      ctx.input.simulate('jump', true);
      await window.frame();
      ctx.input.simulate('jump', false);
      const speeds = [];
      const t0 = ctx.time.elapsed;
      while (ctx.time.elapsed - t0 < 0.5) { await window.frame(); if (!ctx.player.grounded) speeds.push(ctx.player.speed); }
      ctx.input.simulate('fire', false);
      ctx.input.simulate('forward', false);
      return { atTakeoff: Number((speeds[0] ?? 0).toFixed(2)), inAirLast: Number((speeds[speeds.length - 1] ?? 0).toFixed(2)), samples: speeds.length };
    });
  }

  if (wants('cost')) {
    out.cost = {};
    const fight = (gun, seconds) => page.evaluate(async ([w, s]) => {
      const { ctx } = window.__op2;
      const lab = window.__lab;
      await window.wipe();
      await window.home();
      lab.draw(w);
      ctx.weapons.modifiers.bottomlessMag = true;
      ctx.player.modifiers.invulnerable = true;
      const ids = ['trooper', 'gunner', 'husk', 'riot', 'stalker', 'brute', 'burner', 'warden'];
      const spawn = () => {
        for (let i = ctx.enemies.alive.length; i < 24; i++) {
          const a = (i / 24) * Math.PI - Math.PI;
          lab.spawner.place(ids[i % ids.length], new window.V(Math.cos(a) * 13, 0, 15 + Math.sin(a) * 13), 'on');
        }
      };
      spawn();
      await window.world(0.6);
      window.clearLog();
      ctx.input.simulate('fire', true);
      await window.world(1.2);
      const m = window.meter();
      const t0 = ctx.time.elapsed;
      let top = 0;
      while (ctx.time.elapsed - t0 < s) {
        await window.frame();
        // A slow sweep across the arc they come in from, and keep the room full.
        ctx.player.yaw = Math.sin((ctx.time.elapsed - t0) * 1.1) * 1.1;
        ctx.player.pitch = -0.05;
        if (ctx.enemies.alive.length < 16) spawn();
        top = Math.max(top, window.__op2.game.stats?.().particles ?? 0);
      }
      ctx.input.simulate('fire', false);
      const r = m.done();
      ctx.weapons.modifiers.bottomlessMag = false;
      return {
        ...r, seconds: s, fired: window.__heavy.fired[w] ?? 0, burstsPerSecond: Number((ctx.combat.bursts.stats.bursts / s).toFixed(1)),
        fragments: ctx.combat.bursts.stats.fragments, kills: window.__heavy.kills[w] ?? 0, gibbed: window.__heavy.gibbed[w] ?? 0,
        severed: window.__heavy.severed[w] ?? 0, particles: top,
      };
    }, [gun, seconds]);
    out.cost.smg = await fight('smg', 6);
    out.cost.buzzsaw = await fight('buzzsaw', 6);
    out.cost.piledriver = await fight('piledriver', 6);
    await h.shot('cost-after');
    await page.evaluate(() => window.wipe());
    // The burst by itself. First what one costs the CPU, with a crowd standing by for its query: 300 of them timed in one go.
    out.cost.perBurstMs = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.home();
      for (let i = 0; i < 24; i++) window.__lab.spawner.place('trooper', new window.V(-12 + i, 0, 2), 'off');
      await window.world(0.5);
      const at = new window.V(0, 0.02, -6);
      const up = new window.V(0, 1, 0);
      const spec = { radius: 0.45, damage: 10 };
      const times = [];
      for (let k = 0; k < 6; k++) {
        const t0 = performance.now();
        for (let i = 0; i < 50; i++) { at.x = -6 + i * 0.24; ctx.combat.bursts.at(at, up, spec, 'buzzsaw', null); }
        times.push((performance.now() - t0) / 50);
        await window.frame();
        await window.frame();
      }
      await window.wipe();
      return times.map(t => Number(t.toFixed(3)));
    });
    // Then the gun into a bare wall for five seconds with its bursts, and five without: the frames a burst a round costs.
    const wall = strip => page.evaluate(async off => {
      const { ctx } = window.__op2;
      await window.home();
      window.__lab.draw('buzzsaw');
      ctx.weapons.modifiers.bottomlessMag = true;
      const def = ctx.weapons.slots.buzzsaw.def;
      const kept = def.burst;
      if (off) def.burst = undefined;
      window.clearLog();
      ctx.input.simulate('fire', true);
      await window.world(1.2);
      const m = window.meter();
      await window.world(5);
      const r = m.done();
      ctx.input.simulate('fire', false);
      def.burst = kept;
      ctx.weapons.modifiers.bottomlessMag = false;
      await window.world(0.6);
      return { ...r, bursts: ctx.combat.bursts.stats.bursts };
    }, strip);
    out.cost.wallBursts = await wall(false);
    out.cost.wallPlain = await wall(true);
    out.cost.wallBursts2 = await wall(false);
  }

  if (wants('door')) {
    await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      await window.home();
      const lab = window.__lab;
      Object.assign(lab.settings, { spawn: 'trooper', ai: 'off' });
      lab.changed();
      // Five behind the gallery's walls, and nine in the open beside it.
      lab.gallery();
      for (let i = 0; i < 9; i++) lab.spawner.place('trooper', new window.V(4 + (i % 3) * 5, 0, 8 + Math.floor(i / 3) * 3), 'off');
      await window.home();
      window.clearLog();
      // What the gun hit with no line of sight from its own eye.
      const d = { hits: 0, blind: 0, kills: 0, blindKills: 0 };
      window.__door = d;
      const dir = new window.V();
      const seen = (seat, e) => {
        const eye = seat.view.position;
        dir.copy(e.center).sub(eye);
        const dist = dir.length();
        dir.divideScalar(dist);
        const wall = ctx.physics.raycast(eye, dir, dist, 1);
        return !wall || wall.distance > dist - 0.7;
      };
      ctx.events.on('enemy:hit', e => {
        if (e.damage.source !== 'door_gun') return;
        const seat = ctx.progression.callInsManager.seats.seat;
        if (!seat) return;
        d.hits++;
        const blind = !seen(seat, e.enemy);
        if (blind) d.blind++;
        if (e.result.killed) { d.kills++; if (blind) d.blindKills++; }
      });
      ctx.progression.boardCallIn('doorGunner');
      // Holds the sight on the nearest enemy to it, as a steady hand would.
      const tick = () => {
        window.__aiming = requestAnimationFrame(tick);
        const seat = ctx.progression.callInsManager.seats.seat;
        if (seat?.stage !== 'seated') return;
        let best = null;
        let near = Infinity;
        for (const e of ctx.enemies.alive) {
          const v = e.center.distanceToSquared(seat.point);
          if (v < near) { near = v; best = e; }
        }
        if (!best) return;
        const eye = seat.view.position;
        const dx = best.center.x - eye.x, dy = best.center.y - eye.y, dz = best.center.z - eye.z;
        seat.yaw = Math.atan2(-dx, -dz);
        seat.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      };
      tick();
    });
    await page.waitForFunction(() => window.__op2.ctx.progression.callInsManager.seats.seat?.stage === 'seated', null, { timeout: 40000 });
    await h.sleep(600);
    const belt0 = await page.evaluate(() => window.__op2.ctx.progression.callInsManager.seats.seat.weapons[0].ammo);
    await page.evaluate(() => { window.__doorMeter = window.meter(); });
    await page.mouse.down();
    await h.sleep(8000);
    const frames = await page.evaluate(() => window.__doorMeter.done());
    // The one still of it firing, after the measuring is done: the stream goes on while it is taken.
    await h.shot('door-fire');
    await page.mouse.up();
    await h.sleep(600);
    out.door = await page.evaluate(([b0, f]) => {
      const { ctx } = window.__op2;
      const seat = ctx.progression.callInsManager.seats.seat;
      cancelAnimationFrame(window.__aiming);
      return {
        belt: seat?.weapons[0].name ?? null, rounds: b0 - (seat?.weapons[0].ammo ?? b0), seconds: 8,
        bursts: ctx.combat.bursts.stats.bursts, fragments: ctx.combat.bursts.stats.fragments, ...window.__door,
        left: ctx.enemies.alive.length, frames: f,
      };
    }, [belt0, frames]);
    await h.press('KeyE');
    await h.sleep(1200);
  }

  // The door gun where it belongs: over a map with walls. Run this one on the Kill House, by name:
  //   HEAVY_ONLY=doorwalls node tools/shot.mjs --url "/?map=killhouse&autostart=1" --script tools/scripts/heavy-live.mjs ...
  // The sight is held on a man the gun cannot see whenever there is one, so what it reports is what went through.
  if (only.includes('doorwalls')) {
    await page.evaluate(async () => {
      const { ctx } = window.__op2;
      ctx.player.modifiers.invulnerable = true;
      const d = { hits: 0, blind: 0, kills: 0, blindKills: 0, aimedBlind: 0, frames: 0 };
      window.__door = d;
      const dir = new window.V();
      const seen = (eye, e) => {
        dir.copy(e.center).sub(eye);
        const dist = dir.length();
        dir.divideScalar(dist);
        const wall = ctx.physics.raycast(eye, dir, dist, 1);
        return !wall || wall.distance > dist - 0.7;
      };
      ctx.events.on('enemy:hit', e => {
        if (e.damage.source !== 'door_gun') return;
        const seat = ctx.progression.callInsManager.seats.seat;
        if (!seat) return;
        d.hits++;
        const blind = !seen(seat.view.position, e.enemy);
        if (blind) d.blind++;
        if (e.result.killed) { d.kills++; if (blind) d.blindKills++; }
      });
      // Men to shoot, wherever the map lets them stand.
      const spots = ctx.world.spawnPoints.filter(p => p.kind === 'ground');
      for (let i = 0; i < 24 && spots.length > 0; i++) ctx.enemies.spawn('trooper', spots[i % spots.length].position);
      ctx.progression.boardCallIn('doorGunner');
      const tick = () => {
        window.__aiming = requestAnimationFrame(tick);
        const seat = ctx.progression.callInsManager.seats.seat;
        if (seat?.stage !== 'seated') return;
        const eye = seat.view.position;
        let best = null;
        let near = Infinity;
        let hidden = false;
        for (const e of ctx.enemies.alive) {
          const blind = !seen(eye, e);
          const v = e.center.distanceToSquared(seat.point);
          // A man behind something comes first: that is the shot being tested.
          if ((blind && !hidden) || (blind === hidden && v < near)) { near = v; best = e; hidden = blind; }
        }
        if (!best) return;
        d.frames++;
        if (hidden) d.aimedBlind++;
        const dx = best.center.x - eye.x, dy = best.center.y - eye.y, dz = best.center.z - eye.z;
        seat.yaw = Math.atan2(-dx, -dz);
        seat.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      };
      tick();
    });
    await page.waitForFunction(() => window.__op2.ctx.progression.callInsManager.seats.seat?.stage === 'seated', null, { timeout: 60000 });
    await h.sleep(500);
    await page.evaluate(() => { window.clearLog(); window.__doorMeter = window.meter(); });
    await page.mouse.down();
    await h.sleep(14000);
    const frames = await page.evaluate(() => window.__doorMeter.done());
    const result = await page.evaluate(f => {
      const { ctx } = window.__op2;
      return { ...window.__door, bursts: ctx.combat.bursts.stats.bursts, fragments: ctx.combat.bursts.stats.fragments, left: ctx.enemies.alive.length, meter: f };
    }, frames);
    await h.shot('doorwalls');
    await page.mouse.up();
    out.doorwalls = result;
  }

  out.errors = await page.evaluate(() => window.__op2?.game?.errors ?? null);
  return out;
}
