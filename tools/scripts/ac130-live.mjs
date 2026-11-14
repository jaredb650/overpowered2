// The AC-130 in the real game. One mode per run:
//
//   AC_MODE=model node tools/shot.mjs --url "/?map=range" --script tools/scripts/ac130-live.mjs --dpr 2 --w 1440 --h 900 --wait 500 --out tools/out/ac-model.png
//   AC_MODE=sky   node tools/shot.mjs --url "/?map=killhouse&autostart=1" --script tools/scripts/ac130-live.mjs --dpr 2 --w 1440 --h 900 --wait 500 --out tools/out/ac-sky.png --timeout 200
//   AC_MODE=full  node tools/shot.mjs --url "/?map=killhouse&autostart=1" --script tools/scripts/ac130-live.mjs --wait 500 --out tools/out/ac-full.png --timeout 200
//   AC_MODE=reset node tools/shot.mjs --url "/?map=range" --script tools/scripts/ac130-live.mjs --wait 500 --out tools/out/ac-reset.png
//   AC_MODE=safe  node tools/shot.mjs --url "/?map=range" --script tools/scripts/ac130-live.mjs --wait 500 --out tools/out/ac-safe.png --timeout 200
//   AC_MODE=roof  node tools/shot.mjs --url "/?autostart=1" --script tools/scripts/ac130-live.mjs --wait 500 --out tools/out/ac-roof.png --timeout 200
//   AC_MODE=ring  node tools/shot.mjs --url "/?map=range" --script tools/scripts/ac130-live.mjs --wait 500 --out tools/out/ac-ring.png
//
// model  the airframe parked in front of the camera, from several sides
// sky    a real call-in, then the siege seen from the ground in real time at each stage, jumping between them
// full   all two minutes on a fast clock with nothing drawn: what fired, what died, and whether the player was touched
// reset  a new run during a live siege leaves nothing behind
// safe   a mortal player stands in the box among enemies with no AI, so anything that touches them came from the ship
// roof   the Crucible, marked under a roof beside its barrels: rounds still arrive and no barrel goes off
// ring   the marked box at rest, after the opening pulse has died away
const mode = process.env.AC_MODE ?? 'full';
const SPAWNS = Number(process.env.AC_SPAWNS ?? 14);
const SPOT = process.env.AC_SPOT ?? 'roofed';

/** Runs in the page. */
function prelude() {
  const { ctx, game } = window.__op2;
  const log = { radio: [], banners: [], kills: {}, sounds: {}, fx: {} };
  window.__ac = log;
  const hud = ctx.hud;
  const feed = hud.feed.bind(hud);
  hud.feed = (text, color) => {
    if (text.startsWith('SPECTRE')) log.radio.push(`${Number((window.__acT?.() ?? 0).toFixed(1))} ${text}`);
    return feed(text, color);
  };
  const banner = hud.banner.bind(hud);
  hud.banner = (text, sub, color) => {
    log.banners.push(`${text} / ${sub ?? ''}`);
    return banner(text, sub, color);
  };
  ctx.events.on('enemy:killed', e => { log.kills[e.damage.source] = (log.kills[e.damage.source] ?? 0) + 1; });
  log.hits = {};
  log.perks = [];
  log.impacts = {};
  ctx.events.on('enemy:hit', e => {
    const h = (log.hits[e.damage.source] ??= { n: 0, dealt: 0 });
    h.n++;
    h.dealt += Math.round(e.result.dealt);
  });
  ctx.events.on('perk:start', e => log.perks.push(e.id));
  log.mapBlasts = [];
  ctx.events.on('world:explosion', e => log.mapBlasts.push(e.source));
  /** Counts where each weapon's rounds end up. The strike sets onImpact, so this wraps it after the call-in. */
  window.__watchImpacts = () => {
    const rounds = ctx.progression.callInsManager.gunship.rounds;
    const onImpact = rounds.onImpact;
    rounds.onImpact = (kind, point, normal) => {
      const k = (log.impacts[kind] ??= { open: 0, floor: 0, wall: 0 });
      const where = !normal ? 'open' : normal.y > 0.7 ? 'floor' : 'wall';
      k[where]++;
      if (where === 'wall' && kind === 'g25' && (log.wallSample ??= []).length < 6) {
        const p = ctx.player.position;
        log.wallSample.push({ off: [point.x - p.x, point.y - p.y, point.z - p.z].map(Math.round), n: normal.toArray().map(v => Number(v.toFixed(2))) });
      }
      return onImpact(kind, point, normal);
    };
  };
  // The source lives on the call, not on the event, and an invulnerable player must still show up here.
  log.hurtBy = {};
  log.pushes = 0;
  const takeDamage = ctx.player.takeDamage.bind(ctx.player);
  ctx.player.takeDamage = d => {
    log.hurtBy[d.source] = (log.hurtBy[d.source] ?? 0) + 1;
    return takeDamage(d);
  };
  const launch = ctx.player.launch.bind(ctx.player);
  log.pushedBy = {};
  ctx.player.launch = v => {
    log.pushes++;
    const caller = new Error().stack.split('\n').slice(2, 5).map(l => l.trim().split(' ')[1]).join(' < ');
    log.pushedBy[caller] = (log.pushedBy[caller] ?? 0) + 1;
    return launch(v);
  };
  ctx.player.modifiers.invulnerable = true;
  const play = ctx.audio.play.bind(ctx.audio);
  ctx.audio.play = (id, o) => {
    log.sounds[id] = (log.sounds[id] ?? 0) + 1;
    return play(id, o);
  };
  const explosion = ctx.fx.explosion.bind(ctx.fx);
  ctx.fx.explosion = (p, o) => {
    log.fx[o.kind] = (log.fx[o.kind] ?? 0) + 1;
    return explosion(p, o);
  };

  /** Skips ahead with nothing drawn. Every system runs, on the same clock a slow frame would give it. */
  window.__skip = seconds => {
    const render = ctx.render.render;
    ctx.render.render = () => undefined;
    const end = ctx.time.realElapsed + seconds;
    while (ctx.time.realElapsed < end && game.state === 'playing') {
      ctx.time.tick(1 / 30);
      game.frame();
      ctx.input.endFrame?.();
    }
    ctx.render.render = render;
  };

  /** Presses an action for one frame, the way a key press lands. */
  window.__tap = async action => {
    ctx.input.simulate(action, true);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    ctx.input.simulate(action, false);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  };

  window.__spawn = (count, near, only) => {
    const p = ctx.player.position;
    const ids = only ? [only] : ['husk', 'husk', 'trooper', 'brute', 'gunner'];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = near + (i % 3) * 3;
      const at = p.clone();
      at.x += Math.cos(a) * r;
      at.z += Math.sin(a) * r;
      ctx.world.nav.nearest(at, 12, at);
      ctx.enemies.spawn(ids[i % ids.length], at);
    }
  };
}

async function booted(page, h) {
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) return true;
    await h.sleep(1000);
  }
  return false;
}

/**
 * Aim down and hold M: the gunship goes in with its crew on the guns, over what the crosshair is on. There is no mark
 * to place any more (air support part 1); a tap would put the player in the seat instead.
 */
async function callIn(page) {
  return page.evaluate(async () => {
    const { ctx } = window.__op2;
    ctx.player.pitch = -0.55;
    ctx.progression.grantCallIn('ac130');
    const before = ctx.progression.targeting;
    ctx.input.simulate('callinAc130', true);
    await new Promise(r => setTimeout(r, 600));
    ctx.input.simulate('callinAc130', false);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { before, after: ctx.progression.targeting, seated: ctx.progression.callInsManager.seats.occupied, held: [...ctx.progression.callIns], cooldown: ctx.progression.callInCooldown('ac130') };
  });
}

async function model(page, h) {
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const g = ctx.render.scene.getObjectByName('ac130');
    window.__park = (dx, dy, dz, yaw, roll) => {
      const p = ctx.player.eye;
      const f = ctx.player.forward;
      g.visible = true;
      g.position.set(p.x + f.x * dz + dx, p.y + dy, p.z + f.z * dz);
      g.rotation.set(0, yaw, roll);
    };
    ctx.time.paused = false;
  });
  const views = [
    ['left', 0, 3, 34, Math.PI / 2 + Math.PI, 0],
    ['leftbelow', 0, 12, 34, Math.PI / 2 + Math.PI + 0.5, -0.45],
    ['front', 0, 2, 30, Math.PI, 0],
    ['below', 0, 16, 26, Math.PI / 2 + Math.PI + 0.25, -0.9],
  ];
  for (const [name, ...v] of views) {
    await page.evaluate(a => window.__park(...a), v);
    await h.sleep(500);
    await h.shot(name);
  }
  return page.evaluate(() => ({ tris: window.__op2.game.stats() }));
}

async function sky(page, h) {
  // The catwalk: open sky, and a view down into the rooms.
  await page.evaluate(n => {
    const { ctx } = window.__op2;
    const p = ctx.player.position.clone();
    ctx.player.teleport(p.set(14.5, 4.7, 14.5), Math.PI * 0.75);
    window.__spawn(n, 16);
    // A 105 starts to whistle two seconds out, which is the moment to look at where it is going.
    window.__incoming = null;
    const play = ctx.audio.play;
    ctx.audio.play = (id, o) => {
      if (id === 'missile_incoming' && o?.pitch < 1) window.__incoming = o.position.clone();
      return play(id, o);
    };
  }, SPAWNS);
  const ci = await callIn(page);
  await h.sleep(1200);
  await h.shot('t01');
  const stats = [];
  // Look at the plane, then shoot what the player would see at each stage. Skipping is cheap, so only the shots cost.
  const stage = async (name, seconds) => {
    await page.evaluate(([s, n]) => {
      window.__skip(s);
      const { ctx } = window.__op2;
      ctx.player.teleport(ctx.player.position.clone().set(14.5, 4.7, 14.5));
      window.__spawn(n, 18);
    }, [seconds, Math.ceil(SPAWNS / 2)]);
    await page.evaluate(() => {
      const { ctx } = window.__op2;
      const g = ctx.render.scene.getObjectByName('ac130');
      const e = ctx.player.eye;
      const dx = g.position.x - e.x, dy = g.position.y - e.y, dz = g.position.z - e.z;
      ctx.player.yaw = Math.atan2(-dx, -dz);
      ctx.player.pitch = Math.max(-1.2, Math.atan2(dy, Math.hypot(dx, dz)) - 0.25);
    });
    await h.sleep(1600);
    await h.shot(name);
    // Then the ground: the nearest enemy, or the middle of the box.
    await page.evaluate(() => {
      const { ctx } = window.__op2;
      const e = ctx.player.eye;
      let best = null, bestD = Infinity;
      for (const x of ctx.enemies.alive) {
        const d = x.position.distanceTo(e);
        if (d > 8 && d < bestD) { bestD = d; best = x; }
      }
      if (!best) return;
      ctx.player.yaw = Math.atan2(-(best.position.x - e.x), -(best.position.z - e.z));
      ctx.player.pitch = 0.12;
    });
    await h.sleep(1400);
    await h.shot(`${name}g`);
    stats.push({ name, ...(await page.evaluate(() => window.__op2.game.stats())) });
  };
  await stage('t12', 10);
  await stage('t40', 26);
  await stage('t75', 32);
  await stage('t112', 12);
  const profile = await profiled(page, 12);
  // Catch one 105: in the air, then landing.
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    ctx.player.teleport(ctx.player.position.clone().set(14.5, 4.7, 14.5));
    window.__incoming = null;
  });
  for (let i = 0; i < 60; i++) {
    const seen = await page.evaluate(() => {
      const { ctx } = window.__op2;
      const a = window.__incoming;
      if (!a) return false;
      const e = ctx.player.eye;
      const dx = a.x - e.x, dy = a.y + 14 - e.y, dz = a.z - e.z;
      ctx.player.yaw = Math.atan2(-dx, -dz);
      ctx.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      return true;
    });
    if (seen) break;
    await h.sleep(200);
  }
  await h.shot('falling');
  await h.sleep(500);
  await h.shot('landing');
  return { ci, stats, profile, log: await page.evaluate(() => window.__ac) };
}

async function full(page, h) {
  await page.evaluate(n => window.__spawn(n, 15), SPAWNS);
  const ci = await callIn(page);
  await page.evaluate(() => window.__watchImpacts());
  const result = await page.evaluate(n => {
    const { ctx, game } = window.__op2;
    const log = window.__ac;
    const scene = ctx.render.scene;
    const g = scene.getObjectByName('ac130');
    const health = [ctx.player.health, ctx.player.armor];
    const track = [];
    let t = 0;
    window.__acT = () => t;
    // Enemies arrive through the siege the way a wave would, so the guns always have something to find.
    for (let i = 0; i < 148; i++) {
      window.__skip(1);
      t = i + 1;
      if (i % 12 === 0) window.__spawn(n, 15 + (i % 3) * 4);
      if (i % 10 === 0) {
        const dx = g.position.x - ctx.player.position.x, dz = g.position.z - ctx.player.position.z;
        track.push([t, Math.round(Math.hypot(dx, dz)), Math.round(g.position.y), g.visible ? 1 : 0]);
      }
    }
    return { track, health, end: [ctx.player.health, ctx.player.armor], state: game.state, cooldown: ctx.progression.callInCooldown('ac130'), visibleAtEnd: g.visible, combo: ctx.progression.combo, score: ctx.progression.score };
  }, Math.ceil(SPAWNS / 2));
  return { ci, ...result, log: await page.evaluate(() => window.__ac) };
}

/** Time spent in everything progression does, which is where the whole strike runs. */
async function profiled(page, seconds) {
  return page.evaluate(async s => {
    const { ctx } = window.__op2;
    const update = ctx.progression.update;
    const samples = [];
    ctx.progression.update = function () {
      const t = performance.now();
      update.call(this);
      samples.push(performance.now() - t);
    };
    await new Promise(r => setTimeout(r, s * 1000));
    ctx.progression.update = update;
    samples.sort((a, b) => a - b);
    const at = q => Number(samples[Math.floor(samples.length * q)]?.toFixed(2));
    return { frames: samples.length, median: at(0.5), p95: at(0.95), p99: at(0.99), max: Number(samples.at(-1)?.toFixed(2)) };
  }, seconds);
}

async function safe(page, h) {
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.__lab.settings.god = false;
    window.__lab.settings.arsenal = false;
    ctx.player.modifiers.invulnerable = false;
    // Still mortal, but only to the ship. Husks throw nothing, so a push can have no other cause.
    const take = ctx.player.takeDamage;
    ctx.player.takeDamage = d => { if (/^ac130|barrel|tank/.test(d.source)) take(d); else window.__ac.hurtBy[d.source] = (window.__ac.hurtBy[d.source] ?? 0) + 1; };
    window.__spawn(16, 4, 'husk');
  });
  const ci = await callIn(page);
  await page.evaluate(() => window.__watchImpacts());
  const result = await page.evaluate(() => {
    const { ctx } = window.__op2;
    const start = [ctx.player.health, ctx.player.armor, ctx.player.position.toArray()];
    const god = [];
    for (let i = 0; i < 145; i++) {
      window.__skip(1);
      god.push(ctx.player.modifiers.invulnerable);
      if (i % 15 === 0) window.__spawn(10, 3 + (i % 4) * 2, 'husk');
    }
    return { start, end: [ctx.player.health, ctx.player.armor, ctx.player.position.toArray()], everGod: god.some(Boolean), alive: ctx.player.alive };
  });
  return { ci, ...result, log: await page.evaluate(() => window.__ac) };
}

async function roof(page, h) {
  // Every known floor spot on the map, sorted by what is overhead, then the most roofed or the most open one.
  const where = await page.evaluate(spot => {
    const { ctx } = window.__op2;
    const up = ctx.player.position.clone().set(0, 1, 0);
    const lift = ctx.player.position.clone();
    const spots = [...ctx.world.pickupSpots, ...ctx.world.spawnPoints.filter(s => s.kind === 'ground').map(s => s.position)].map(p => {
      lift.copy(p).setY(p.y + 1.5);
      const hit = ctx.physics.raycast(lift, up, 300, 1);
      return { p, over: hit ? hit.distance : 999, zone: ctx.world.zoneAt(p)?.id };
    });
    const roofed = spots.filter(s => s.over > 4 && s.over < 40).sort((a, b) => a.over - b.over);
    const open = spots.filter(s => s.over >= 60).sort((a, b) => b.over - a.over);
    const pick = (spot === 'open' ? open : roofed)[0];
    const c = pick.p.clone();
    ctx.player.teleport(c);
    // This run is about where rounds go, and the player has to outlive it to find out.
    ctx.player.takeDamage = d => { window.__ac.hurtBy[d.source] = (window.__ac.hurtBy[d.source] ?? 0) + 1; };
    window.__spawn(14, 13);
    return { spot, zone: pick.zone, at: c.toArray().map(Math.round), over: Math.round(pick.over), roofed: roofed.length, open: open.length, total: spots.length };
  }, SPOT);
  const ci = await callIn(page);
  await page.evaluate(() => window.__watchImpacts());
  const result = await page.evaluate(() => {
    const { ctx } = window.__op2;
    for (let i = 0; i < 100; i++) {
      window.__skip(1);
      if (i % 12 === 0) window.__spawn(8, 12 + (i % 3) * 4);
    }
    return { state: window.__op2.game.state };
  });
  await h.sleep(900);
  await h.shot('hall');
  return { where, ci, ...result, log: await page.evaluate(() => window.__ac) };
}

async function ring(page, h) {
  const ci = await callIn(page);
  await page.evaluate(() => {
    window.__skip(16);
    window.__op2.ctx.player.pitch = -0.3;
  });
  await h.sleep(700);
  await h.shot('rest');
  return { ci };
}

async function reset(page, h) {
  await page.evaluate(n => window.__spawn(n, 14), 12);
  const ci = await callIn(page);
  // Forward to the guns, then on a frame at a time until something is provably in the air.
  const before = await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.__skip(70);
    window.__spawn(12, 16);
    const rounds = ctx.render.scene.getObjectByName('ac130.rounds');
    for (let i = 0; i < 900 && rounds.count < 6; i++) window.__skip(1 / 30);
    const rig = ctx.progression.callInsManager.gunship;
    return { plane: ctx.render.scene.getObjectByName('ac130').visible, drawn: rounds.count, idle: rig.rounds.idle };
  });
  const after = await page.evaluate(() => {
    const { ctx, game } = window.__op2;
    const rig = ctx.progression.callInsManager.gunship;
    const count = o => Object.values(o).reduce((a, b) => a + b, 0);
    const scene = ctx.render.scene;
    const log = window.__ac;
    const explosions = count(log.fx);
    const lines = log.radio.length;
    game.newRun();
    const atReset = { plane: scene.getObjectByName('ac130').visible, drawn: scene.getObjectByName('ac130.rounds').count, idle: rig.rounds.idle };
    window.__skip(12);
    return {
      atReset, plane: scene.getObjectByName('ac130').visible, drawn: scene.getObjectByName('ac130.rounds').count,
      newExplosions: count(log.fx) - explosions, newRadio: log.radio.length - lines,
      cooldown: ctx.progression.callInCooldown('ac130'), held: [...ctx.progression.callIns], strikes: ctx.progression.callInsManager.strikes.length,
    };
  });
  await h.shot('after');
  return { ci, before, after, loops: await page.evaluate(() => window.__op2.audio?.loops ?? null) };
}

export default async function ac130(page, h) {
  if (!(await booted(page, h))) return { booted: false };
  await page.evaluate(prelude);
  const run = { model, sky, full, reset, safe, roof, ring }[mode];
  return run(page, h);
}
