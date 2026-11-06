// The Commander in real Chrome: forces each tell, photographs it, and reads the state behind it. Run through tools/shot.mjs.
//
//   CMD_CASES=box,mortar node tools/shot.mjs --url "/?map=killhouse&autostart=1&dev=1" --w 1920 --h 1080 --script tools/scripts/commander-live.mjs --out tools/out/cmd.png --wait 500 --timeout 170
//
// Cases: box mortar sniper jammer mines surrender pickups barricade smoke person swarm. Each writes tools/out/cmd-<case>.png.
const cases = (process.env.CMD_CASES ?? 'box,mortar,jammer,mines,surrender').split(',');

export default async function live(page, h) {
  const out = {};
  const shot = name => h.shot(name).catch(e => console.error(`shot ${name} failed: ${e.message.split('\n')[0]}`));
  const started = Date.now();
  while (Date.now() - started < 90000) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  out.boot = Math.round((Date.now() - started) / 1000);

  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const c = ctx.enemies.outpost.commander;
    window.__c = c;
    window.__o = ctx.enemies.outpost;
    window.__ctx = ctx;
    ctx.player.maxHealth = ctx.player.health = 1e5;
    ctx.waves.update = () => {};
    window.__clear = () => {
      for (const e of [...ctx.enemies.alive]) ctx.enemies.killAll?.('test');
      c.devices.clear();
    };
    // Stands the camera at `from` looking at `at`.
    window.__look = (from, at, pitch) => {
      const p = ctx.player;
      p.teleport(p.position.clone().set(from[0], from[1], from[2]), Math.atan2(-(at[0] - from[0]), -(at[2] - from[2])));
      p.pitch = pitch ?? Math.atan2(at[1] - from[1] - 1.6, Math.hypot(at[0] - from[0], at[2] - from[2]));
    };
    // A camera `dist` metres from `at`, on floor, with a clear line to it. Walls here are everywhere, and a shot of a wall proves nothing.
    window.__frame = (at, dist, lift = 1.1, pitch) => {
      const V = ctx.player.position.constructor;
      const nav = ctx.world.nav;
      const aim = new V(at[0], at[1] + lift, at[2]);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2 + 0.4;
        const v = new V(at[0] + Math.sin(a) * dist, at[1] + 0.2, at[2] + Math.cos(a) * dist);
        if (!nav.nearest(v, 0.8, v)) continue;
        if (Math.abs(v.y - at[1]) > 0.5 || Math.hypot(v.x - at[0], v.z - at[2]) < dist * 0.8) continue;
        const eye = v.clone();
        eye.y += 1.6;
        if (!ctx.enemies.outpost.w.director.clearLine(eye, aim)) continue;
        window.__look([v.x, v.y, v.z], [at[0], at[1] + lift, at[2]], pitch);
        return true;
      }
      return false;
    };
    // One man with a job, standing where he is told. Skips the walk from the gate, which the headless runs already cover.
    window.__man = (kind, id, at) => {
      const o = window.__o;
      o.formSquad(1);
      const q = o.squads[o.squads.length - 1];
      q.directed = true;
      const e = ctx.enemies.spawn(id, new (ctx.player.position.constructor)(at[0], at[1], at[2]));
      const s = o.soldierOf(e);
      if (kind) {
        const u = c.units.enrol(s, kind);
        u.post.copy(e.position);
        u.placed = u.arrived = true;
      }
      return e;
    };
    window.__floor = (x, z) => {
      const v = new (ctx.player.position.constructor)(x, 0.2, z);
      ctx.world.nav.nearest(v, 6, v);
      return [v.x, v.y, v.z];
    };
    window.__report = over => ({ ...c.tracker.closeRound(1), kills: 9, damageTaken: 30, seconds: 80, ...over });
  });

  for (const name of cases) {
    const fn = CASES[name];
    if (!fn) continue;
    try {
      out[name] = await fn(page, h, shot);
    } catch (e) {
      out[name] = `failed: ${e.message.split('\n')[0]}`;
    }
  }
  return out;
}

const brief = (page, over) => page.evaluate(o => {
  const c = window.__c;
  const adaptation = o.adaptation ?? null;
  if (adaptation) c.adopt(adaptation);
  window.__ctx.events.emit('commander:briefing', {
    wave: o.wave ?? 3, next: (o.wave ?? 3) + 1, phase: o.phase, report: window.__report(o.report ?? {}), adaptation, tricks: o.tricks ?? [], fielded: c.fielded, seconds: 13,
  });
}, over);

const skim = async (page, h, shot, label, pages) => {
  // Lets the text finish typing, photographs each page in turn.
  for (let i = 0; i < pages; i++) {
    await h.sleep(1900);
    await shot(`${label}-${i + 1}`);
    await page.evaluate(() => window.__ctx.input.simulate('interact', true));
    await h.sleep(60);
    await page.evaluate(() => window.__ctx.input.simulate('interact', false));
    await h.sleep(150);
  }
};

const reset = async (page, h) => {
  await page.evaluate(() => {
    window.__ctx.enemies.killAll('test');
    window.__c.devices.clear();
    window.__c.units.list.length = 0;
  });
  await h.sleep(500);
};

const CASES = {
  /** The real thing: real waves, a camper who clears them, and the box and the mortars that follow. Leaves the wave loop running. */
  async campBot(page, h, shot) {
    await page.evaluate(() => {
      const ctx = window.__ctx;
      ctx.waves.update = Object.getPrototypeOf(ctx.waves).update.bind(ctx.waves);
      window.__look(window.__floor(0, -19), [0, 1, 0]);
      window.__log = [];
      for (const type of ['wave:start', 'wave:clear', 'commander:briefing', 'commander:status', 'commander:skipped']) ctx.events.on(type, e => window.__log.push([+ctx.time.elapsed.toFixed(1), type, e.adaptation ?? e.flag ?? e.wave ?? '']));
      window.__killer = setInterval(() => {
        if (window.__hold) return;
        const list = ctx.enemies.alive.filter(e => ctx.enemies.outpost.soldierOf(e)?.fighting);
        const e = list.find(x => !ctx.enemies.outpost.soldierOf(x).squad.directed) ?? list[0];
        ctx.events.emit('weapon:fired', { weapon: 'smg', origin: ctx.player.eye.clone(), dir: ctx.player.forward.clone() });
        if (e) ctx.enemies.applyDamage(e, { amount: 9999, type: 'bullet', point: e.center.clone(), dir: e.center.clone().sub(ctx.player.eye).normalize(), force: 0, source: 'smg', region: 'chest' });
      }, 900);
    });
    const until = async (test, ms) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await page.evaluate(test)) return true;
        await h.sleep(300);
      }
      return false;
    };
    const cleared = await until(() => window.__ctx.waves.wave >= 1 && window.__ctx.waves.phase === 'intermission', 45000);
    await h.sleep(1200);
    await shot('bot-box');
    const text = await page.evaluate(() => document.querySelector('.cmd-text')?.textContent);
    await page.evaluate(() => { window.__hold = true; });
    const started = await until(() => window.__ctx.waves.wave >= 2, 18000);
    const painted = await until(() => window.__c.mortars.stage === 'lasing' || window.__c.mortars.missions > 0, 45000);
    await shot('bot-wave2');
    return page.evaluate(([cleared, text, started, painted]) => ({ cleared, text, started, painted, describe: window.__c.describe(), log: window.__log.slice(-10) }), [cleared, text, started, painted]);
  },

  async mortar(page, h, shot) {
    const info = await page.evaluate(() => {
      const c = window.__c;
      const p = window.__ctx.player;
      window.__look(window.__floor(-30, 6), [-30, 0, 30]);
      c.adopt('mortars');
      c.mortars.chooseSite();
      window.__crew = [window.__man('mortar', 'trooper', [c.mortars.site.x + 1.4, c.mortars.site.y, c.mortars.site.z]), window.__man('mortar', 'trooper', [c.mortars.site.x - 1.4, c.mortars.site.y, c.mortars.site.z])];
      const v = p.position.clone();
      c.posts.overwatch(p.position, 16, 40, true, v);
      window.__spotter = window.__man('spotter', 'trooper', [v.x, v.y, v.z]);
      const e = window.__spotter;
      window.__look([p.position.x, p.position.y, p.position.z], [e.position.x, e.position.y + 1, e.position.z]);
      return { spot: v.toArray(), site: c.mortars.site.toArray(), dist: v.distanceTo(p.position) };
    });
    let stage = '';
    for (let i = 0; i < 60; i++) {
      await h.sleep(250);
      stage = await page.evaluate(() => window.__c.mortars.stage);
      if (stage === 'lasing') break;
    }
    info.lased = stage === 'lasing';
    await h.sleep(900);
    await shot('mortar-laser');
    for (let i = 0; i < 40 && stage !== 'smoke'; i++) {
      await h.sleep(150);
      stage = await page.evaluate(() => window.__c.mortars.stage);
    }
    info.smoke = stage === 'smoke';
    // Step out of the ring and turn round, as a player should, to watch it land where they were.
    await page.evaluate(() => {
      const c = window.__c;
      const t = c.mortars.target;
      window.__frame([t.x, t.y, t.z], 11, 1.2);
    });
    await h.sleep(1500);
    await shot('mortar-smoke');
    await h.sleep(1500);
    await shot('mortar-impact');
    await h.sleep(1400);
    await shot('mortar-impact2');
    info.missions = await page.evaluate(() => window.__c.mortars.missions);
    // Kill the spotter: no new mission may start, however long the crew stand there.
    await page.evaluate(() => {
      const e = window.__spotter;
      window.__ctx.enemies.applyDamage(e, { amount: 9999, type: 'bullet', point: e.center.clone(), dir: e.center.clone().setY(0).normalize(), force: 0, source: 'smg', region: 'chest' });
    });
    await h.sleep(6000);
    info.afterSpotter = await page.evaluate(() => ({ missions: window.__c.mortars.missions, stage: window.__c.mortars.stage, spotters: window.__c.units.count('spotter'), crew: window.__c.units.count('mortar') }));
    await reset(page, h);
    return info;
  },

  async sniper(page, h, shot) {
    const info = await page.evaluate(() => {
      const c = window.__c;
      const p = window.__ctx.player;
      window.__look(window.__floor(0, 3), [0, 0, 30]);
      const v = p.position.clone();
      const found = c.posts.overwatch(p.position, 14, 50, true, v);
      window.__sniper = window.__man('sniper', 'sniper', [v.x, v.y, v.z]);
      const e = window.__sniper;
      window.__look([p.position.x, p.position.y, p.position.z], [e.position.x, e.position.y + 1, e.position.z]);
      return { found, dist: v.distanceTo(p.position) };
    });
    let attack = '';
    for (let i = 0; i < 50; i++) {
      await h.sleep(200);
      attack = await page.evaluate(() => window.__sniper.attack?.name ?? '');
      if (attack) break;
    }
    info.attack = attack;
    await h.sleep(900);
    await shot('sniper-laser');
    await reset(page, h);
    return info;
  },

  async jammer(page, h, shot) {
    const info = await page.evaluate(() => {
      const c = window.__c;
      window.__look(window.__floor(0, -19), [0, 0, -30]);
      c.adopt('jammers');
      c.adopt('decoys');
      c.adopt('hiders');
      const at = window.__floor(0, -12);
      window.__op = window.__man('jammer', 'trooper', at);
      window.__far = [window.__man('guard', 'trooper', window.__floor(-19, 19)), window.__man('guard', 'trooper', window.__floor(19, -19)), window.__man('guard', 'trooper', window.__floor(19, 19))];
      c.devices.beacon(window.__ctx.player.position.clone().set(...window.__floor(6, -24)));
      c.devices.beacon(window.__ctx.player.position.clone().set(...window.__floor(-19, -19)));
      c.devices.beacon(window.__ctx.player.position.clone().set(...window.__floor(19, 8)));
      window.__frame(at, 6, 1.6);
      return { at };
    });
    await h.sleep(1200);
    await shot('jammer-antenna');
    await page.evaluate(() => {
      const at = window.__floor(0, -30);
      window.__look(at, [0, 1.5, 0]);
      window.__ctx.input.simulate('sonar', true);
    });
    await h.sleep(120);
    await page.evaluate(() => window.__ctx.input.simulate('sonar', false));
    await h.sleep(2300);
    await shot('jammer-sonar');
    info.state = await page.evaluate(() => ({ jammed: window.__c.jam.jammed, live: window.__ctx.contracts.sonar.live, radar: window.__c.jam.radar(window.__ctx.enemies.alive).length, real: window.__ctx.enemies.alive.length }));
    await page.evaluate(() => {
      const e = window.__op;
      window.__ctx.enemies.applyDamage(e, { amount: 9999, type: 'bullet', point: e.center.clone(), dir: e.center.clone().setY(0).normalize(), force: 0, source: 'smg', region: 'chest' });
    });
    await h.sleep(800);
    info.after = await page.evaluate(() => ({ jammed: window.__c.jam.jammed, radar: window.__c.jam.radar(window.__ctx.enemies.alive).length, real: window.__ctx.enemies.alive.length }));
    await reset(page, h);
    return info;
  },

  async mines(page, h, shot) {
    const info = await page.evaluate(() => {
      const c = window.__c;
      const ctx = window.__ctx;
      const o = window.__o;
      const door = o.doors[6];
      const v = ctx.player.position.clone();
      c.posts.doorFloor(door, v);
      const f = [v.x, v.y, v.z];
      const a = v.clone().set(f[0] - door.dz * 1.85, f[1], f[2] + door.dx * 1.85);
      const b = v.clone().set(f[0] + door.dz * 1.85, f[1], f[2] - door.dx * 1.85);
      const near = v.clone().set(f[0] - door.dx * 4, f[1], f[2] - door.dz * 4);
      ctx.world.nav.nearest(near, 3, near);
      c.devices.tripwire(a, b);
      const m1 = near.clone().set(near.x + door.dz * 1, near.y, near.z - door.dx * 1);
      c.devices.mine(m1);
      const m2 = near.clone().set(near.x - door.dz * 1.4, near.y, near.z + door.dx * 1.4);
      c.devices.claymore(m2, v.clone().set(-door.dx, 0, -door.dz));
      const m3 = near.clone().set(near.x - door.dx * 1, near.y, near.z - door.dz * 1);
      c.devices.charge(m3, 'rigged', 0);
      const framed = window.__frame([near.x, near.y, near.z], 4.4, 0, -0.42);
      window.__door = { near: near.toArray(), f, dx: door.dx, dz: door.dz, framed };
      return { door: f, devices: c.devices.live.length };
    });
    await h.sleep(1300);
    await shot('mines-laid');
    await h.sleep(220);
    await shot('mines-blink');
    await page.evaluate(() => {
      const { near, dz, dx } = window.__door;
      window.__look([near[0] + dz * 1, near[1] + 0.1, near[2] - dx * 1], [near[0] + dx * 5, near[1] + 1.2, near[2] + dz * 5]);
    });
    info.before = await page.evaluate(() => window.__c.devices.live.map(d => d.kind));
    await h.sleep(250);
    info.triggered = await page.evaluate(() => window.__c.devices.live.filter(d => d.lit).map(d => d.kind));
    await h.sleep(900);
    await shot('mines-blast');
    info.left = await page.evaluate(() => window.__c.devices.live.map(d => d.kind));
    await page.evaluate(() => {
      const c = window.__c;
      const e = c.devices.live.find(d => d.kind === 'tripwire');
      const ctx = window.__ctx;
      if (!e) return;
      const from = ctx.player.eye.clone();
      const dir = e.position.clone().sub(from).normalize();
      ctx.events.emit('weapon:fired', { weapon: 'smg', origin: from, dir });
    });
    await h.sleep(500);
    info.afterShot = await page.evaluate(() => window.__c.devices.live.map(d => d.kind));
    await reset(page, h);
    return info;
  },

  async surrender(page, h, shot) {
    const info = await page.evaluate(() => {
      const c = window.__c;
      const at = window.__floor(0, -19);
      c.adopt('falseSurrender');
      window.__frame(at, 13, 1);
      const e = window.__man(null, 'trooper', at);
      const s = window.__o.soldierOf(e);
      window.__feign = e;
      e.yaw = 0;
      const made = c.units.feignFor(s, 1);
      return { made, unit: c.units.list.map(u => u.kind) };
    });
    await h.sleep(1500);
    await page.evaluate(() => {
      const at = window.__feign.position;
      window.__frame([at.x, at.y, at.z], 7.4, 0.9);
    });
    await h.sleep(1300);
    await shot('surrender-hands');
    await page.evaluate(() => {
      const at = window.__feign.position;
      window.__frame([at.x, at.y, at.z], 4.4, 0.9);
    });
    await h.sleep(600);
    await shot('surrender-pin');
    info.step = await page.evaluate(() => window.__c.units.list.map(u => [u.kind, u.step]));
    await h.sleep(1200);
    info.grenades = await page.evaluate(() => window.__o.soldiers.map(s => s.grenades));
    await h.sleep(2200);
    await shot('surrender-after');
    await reset(page, h);
    return info;
  },

  async bodies(page, h, shot) {
    const info = await page.evaluate(() => {
      const c = window.__c;
      const v = window.__ctx.player.position.clone();
      const a = window.__floor(0, -19);
      const b = window.__floor(4, -21);
      c.units.placeBody('possum', v.clone().set(...a));
      window.__cas = c.units.placeBody('casualty', v.clone().set(...b));
      window.__frame([(a[0] + b[0]) / 2, a[1], (a[2] + b[2]) / 2], 7.5, 0.2);
      return { units: c.units.list.map(u => u.kind) };
    });
    await h.sleep(1600);
    await shot('bodies');
    info.radarNoPing = await page.evaluate(() => window.__c.jam.radar(window.__ctx.enemies.alive).length);
    await page.evaluate(() => {
      const c = window.__cas.position;
      window.__frame([c.x, c.y, c.z], 8, 0.3);
    });
    await h.sleep(300);
    await page.evaluate(() => {
      const c = window.__cas.position;
      window.__frame([c.x, c.y, c.z], 3.6, 0.3);
    });
    await h.sleep(1700);
    await shot('casualty-blast');
    info.left = await page.evaluate(() => window.__c.units.list.map(u => u.kind));
    await reset(page, h);
    return info;
  },

  async person(page, h, shot) {
    const info = {};
    await page.evaluate(() => {
      window.__look(window.__floor(0, 0), [0, 0, 20]);
      window.__c.person.summon();
    });
    await h.sleep(2600);
    info.body = await page.evaluate(() => {
      const c = window.__c;
      const e = c.person.body;
      if (!e) return null;
      const p = e.position;
      window.__frame([p.x, p.y, p.z], 10, 2.2);
      return { id: e.id, hp: e.health, at: p.toArray() };
    });
    await h.sleep(900);
    await shot('person');
    return info;
  },

  async rest(page, h, shot) {
    const info = await page.evaluate(() => {
      const c = window.__c;
      const ctx = window.__ctx;
      const at = window.__floor(0, -19);
      c.adopt('helmets');
      const v = ctx.player.position.clone();
      window.__helm = window.__man(null, 'trooper', at);
      c.props.fit(window.__helm.char, 'visor');
      const b = window.__floor(2.2, -19);
      window.__man('radio', 'trooper', b);
      const f = window.__floor(-2.2, -19);
      window.__man('hider', 'trooper', f);
      window.__frame(at, 4.4, 1.5);
      return { plates: window.__helm.plates.map(p => [p.spec.regions.join(), Math.round(p.hp)]), v: v.toArray() };
    });
    await h.sleep(1100);
    await shot('props');
    await page.evaluate(() => {
      const c = window.__c;
      const at = window.__floor(0, 0);
      const s = window.__floor(5, 5);
      window.__frame(s, 14, 1.6);
      c.smoke.pop(window.__ctx.player.position.clone().set(...s));
    });
    await h.sleep(3600);
    await shot('smoke');
    const shutter = await page.evaluate(() => {
      const c = window.__c;
      const o = window.__o;
      const ctx = window.__ctx;
      const door = o.doors[3];
      for (let i = 0; i < 40; i++) c.tracker.sample(0.25, door.x + (i % 2 ? 1 : -1) * door.dx * 2, 0.1, door.z + (i % 2 ? 1 : -1) * door.dz * 2, 6, true, null);
      window.__look(window.__floor(0, 0), [0, 0, 20]);
      const n = c.barricades.drop(1);
      const v = ctx.player.position.clone();
      c.posts.doorFloor(door, v);
      window.__frame([v.x, v.y, v.z], 7, 1.8);
      return { n, door: [door.x, door.z, door.dx, door.dz], count: c.barricades.count, doors: o.doors.length };
    });
    info.shutter = shutter;
    await h.sleep(900);
    await shot('shutter');
    await reset(page, h);
    await page.evaluate(() => window.__c.barricades.reset());
    return info;
  },

  async box(page, h, shot) {
    await brief(page, { phase: 'contact', report: { doorShots: 212 }, adaptation: 'mines', wave: 1 });
    await skim(page, h, shot, 'box-smug', 3);
    await h.sleep(300);
    await brief(page, { phase: 'adaptation', report: { stillSeconds: 41 }, adaptation: 'mortars', wave: 3 });
    await skim(page, h, shot, 'box-irritated', 1);
    await page.evaluate(() => { window.__ctx.input.simulate('interact', false); });
    await h.sleep(5500);
    await brief(page, { phase: 'desperation', report: { trapHits: [{ cause: 'mine', hits: 2, damage: 60 }] }, adaptation: 'falseSurrender', tricks: ['dangerClose'], wave: 6 });
    await skim(page, h, shot, 'box-rattled', 2);
    await h.sleep(5500);
    await brief(page, { phase: 'lastStand', report: { fallen: ['Dennis'] }, wave: 9 });
    await skim(page, h, shot, 'box-cracked', 1);
    return page.evaluate(() => document.querySelector('.cmd-box')?.className);
  },
};
