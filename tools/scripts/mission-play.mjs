// Plays the Outpost in one sitting, from the film to the end screen, with the player's own keys, guns and jumps. Where mission-live.mjs
// teleports to prove a beat fires, this walks the routes, climbs the walls and shoots the tanks, and every time it has to cheat it says
// so under `cheats`, because a place a bot had to skip is a place to look at. Health is topped up and the damage it would have taken
// is counted per beat, so `hurt` is a measure of how much fire a beat puts out and not of how hard it is.
//
//   PLAY=full node tools/shot.mjs --url "/?contract=campaign&autostart=1" --script tools/scripts/mission-play.mjs --out tools/out/play.png --wait 500 --timeout 900 --dpr 2 --w 1440 --h 900 --quiet
//
// PLAY takes a comma list of stretches: film, ride, lockout, soft, heavy, wreck, turn, breach, barracks, coolant, gallery, mess, armoury,
// plates, stack, boss, ending, again. `full` is all of them, and `again` goes through the end screen's Play again and fast-forwards a
// second mission to its end. Add &beat=<id> to the URL to start a stretch cold. PLAY_DIE=1 kills the player once in every beat and checks
// what the checkpoint gives back.
const FULL = 'film,ride,lockout,soft,heavy,wreck,turn,breach,barracks,coolant,gallery,mess,armoury,plates,stack,boss,ending,again';
const PLAY = (process.env.PLAY ?? 'full').replace('full', FULL).split(',');
const DIE = process.env.PLAY_DIE === '1';

/** Runs in the page. Everything that has to happen on a frame happens here, because a round trip to Node is a tenth of a second on a busy laptop. */
function driver() {
  const op = window.__op2;
  const V3 = op.ctx.player.position.constructor;
  const a = new V3(), b = new V3(), dir = new V3();
  const FLOOR = 1e5;
  const bot = (window.__bot = { god: true, task: null, beats: {}, seen: new Set(), finder: null });
  const player = () => op.ctx.player;
  const input = () => op.ctx.input;
  const runner = () => op.campaign.runner;
  const host = () => op.campaign.host;
  const hold = (k, on = true) => input().simulate(k, on);
  const stop = () => { for (const k of ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide', 'fire']) hold(k, false); };
  const turnTo = (x, z) => { const p = player(); p.yaw = Math.atan2(-(x - p.position.x), -(z - p.position.z)); };
  const aim = (x, y, z) => {
    const p = player();
    const dx = x - p.eye.x, dy = y - p.eye.y, dz = z - p.eye.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  const tap = (st, k) => { hold(k, true); (st.up ??= []).push([k, 2]); };
  const release = st => {
    if (!st.up) return;
    for (const u of st.up) if (--u[1] <= 0) hold(u[0], false);
    st.up = st.up.filter(u => u[1] > 0);
  };

  const tick = last => now => {
    requestAnimationFrame(tick(now));
    const dt = Math.min((now - last) / 1000, 0.5);
    const { ctx, game } = op;
    const p = ctx.player;
    if (bot.god) {
      if (p.maxHealth < FLOOR) p.maxHealth = p.health = FLOOR;
      const beat = runner()?.beat?.id ?? 'none';
      const s = (bot.beats[beat] ??= { seconds: 0, frames: 0, slow: 0, worst: 0, men: 0, hurt: 0, cpu: 0 });
      s.seconds += dt;
      s.frames++;
      if (dt > 1 / 30) s.slow++;
      s.worst = Math.max(s.worst, Math.round(dt * 1000));
      s.men = Math.max(s.men, ctx.enemies.alive.length);
      s.hurt += FLOOR - p.health;
      s.cpu = Math.max(s.cpu, Number(op.stats().cpuMs) || 0);
      p.health = FLOOR;
    }
    const t = bot.task;
    if (!t || game.state !== 'playing') return;
    t.left -= dt;
    t.clock += dt;
    release(t);
    const out = t.step(t, dt);
    if (out === undefined && t.left > 0) return;
    bot.task = null;
    stop();
    t.done(out ?? 'timeout');
  };
  requestAnimationFrame(tick(performance.now()));

  /** One job at a time, on the frame, with a clock so nothing can hold the run for ever. */
  bot.run = (seconds, step) => new Promise(done => {
    if (bot.task) { bot.task.done('replaced'); stop(); }
    bot.task = { left: seconds, clock: 0, step, done };
  });
  bot.idle = () => { if (bot.task) { bot.task.done('stopped'); bot.task = null; } stop(); };

  const route = () => bot.route;
  const newRoute = st => {
    const p = player();
    a.copy(p.position);
    a.y += 0.1;
    st.points = 0;
    st.i = 1;
    return op.ctx.enemies.outpost.routes.find(a, b.set(st.x, st.y + 0.1, st.z), route()) ? route().count : 0;
  };
  /** One frame of walking the soldiers' own route graph, which is the walk a player would make. Null while on the way. */
  const stepWalk = st => {
    const p = player().position;
    if (Math.hypot(st.x - p.x, st.z - p.z) < st.within && Math.abs(st.y - p.y) < 1.6) return 'arrived';
    if (!st.points) {
      st.points = newRoute(st);
      st.direct = st.points < 2;
    }
    let tx = st.x, tz = st.z;
    if (!st.direct) {
      const r = route();
      while (st.i < r.count && Math.hypot(r.x[st.i] - p.x, r.z[st.i] - p.z) < 1 && Math.abs(r.y[st.i] - p.y) < 1.2) st.i++;
      if (st.i >= r.count) {
        st.points = 0;
        return null;
      }
      tx = r.x[st.i];
      tz = r.z[st.i];
    }
    turnTo(tx, tz);
    player().pitch = 0;
    hold('forward');
    st.since = (st.since ?? 0) + 1;
    if (st.mark === undefined || st.clock - st.mark > 0.7) {
      const moved = st.was ? Math.hypot(p.x - st.was[0], p.z - st.was[1]) : 9;
      st.was = [p.x, p.z];
      st.mark = st.clock;
      st.stuck = moved < 0.4 ? (st.stuck ?? 0) + 1 : 0;
      if (st.stuck === 1) st.points = 0;
      if (st.stuck >= 2 && st.stuck % 2 === 0) tap(st, 'jump');
      if (st.stuck >= 7) return `stuck at ${[p.x, p.y, p.z].map(Math.round)}`;
    }
    return null;
  };
  bot.walk = async (x, y, z, opts = {}) => {
    const { Route } = await import('/src/enemies/outpost/routes.ts');
    bot.route ??= new Route();
    const { within = 1.8, seconds = 40 } = opts;
    return bot.run(seconds, st => {
      st.x = x; st.y = y; st.z = z; st.within = within;
      return stepWalk(st) ?? undefined;
    });
  };

  const tagged = (tags, e) => {
    const tag = host().tagOf.get(e.uid);
    return tag !== undefined && (!tags || tags.includes(tag));
  };
  const clearLine = (x, y, z, slack) => {
    const eye = player().eye;
    dir.set(x - eye.x, y - eye.y, z - eye.z);
    const far = dir.length();
    dir.normalize();
    const hit = op.ctx.physics.raycast(eye, dir, far);
    return !hit || hit.distance > far - slack;
  };
  /** The nearest thing to shoot under these tags. What can be seen comes first. */
  const pick = tags => {
    const { ctx } = op;
    const p = player().position;
    let best = null, score = Infinity;
    const look = (x, y, z, kind, thing) => {
      const d = Math.hypot(x - p.x, y - p.y, z - p.z);
      const seen = clearLine(x, y, z, kind === 'man' ? 0.8 : 6);
      const s = d + (seen ? 0 : 500);
      if (s < score) { score = s; best = { x, y, z, d, seen, kind, thing }; }
    };
    for (const e of ctx.enemies.alive) if (tagged(tags, e)) look(e.center.x, e.center.y, e.center.z, 'man', e);
    for (const v of ctx.enemies.vehicles?.live ?? []) {
      if (!v.alive || (tags && !tags.includes(v.tag)) || !v.tag) continue;
      const air = v.def.kind === 'chopper';
      look(v.position.x, v.position.y + (air ? 0 : 1.4), v.position.z, air ? 'air' : v.def.armoured ? 'tank' : 'truck', v);
    }
    return best;
  };
  const arm = (st, id) => {
    const { weapons } = op.ctx;
    if (weapons.current !== id && weapons.owned.has(id)) weapons.switchTo(id);
    const ammo = weapons.ammo(weapons.current);
    if (ammo.mag === 0 && ammo.reserve > 0) tap(st, 'reload');
  };
  const LEAD = 40;
  /**
   * Stands and shoots whatever is in sight, and walks towards it when nothing is. `until` ends it early; otherwise it ends when nothing
   * under the tags is left. Rockets go at armour, and at men only when `blast` says so.
   */
  bot.fight = async (tags, opts = {}) => {
    const { Route } = await import('/src/enemies/outpost/routes.ts');
    bot.route ??= new Route();
    const { seconds = 60, gun = 'smg', heavy = 'rocket', until = null, reach = 55, stay = false } = opts;
    const test = until ? new Function('op', `return ${until}`) : null;
    const trail = new Map();
    return bot.run(seconds, st => {
      if (test?.(op)) return 'ended';
      const t = pick(tags);
      if (!t) {
        stop();
        if (!test && tags && tags.every(tag => runner().spawned(tag) > 0 && runner().left(tag) === 0)) return 'cleared';
        return undefined;
      }
      if (!t.seen || t.d > reach) {
        hold('fire', false);
        if (stay) return undefined;
        st.x = t.x; st.y = t.thing.groundY ?? player().position.y; st.z = t.z; st.within = 6;
        st.retarget = (st.retarget ?? 0) - 1;
        if (st.retarget <= 0) { st.points = 0; st.retarget = 45; }
        stepWalk(st);
        return undefined;
      }
      hold('forward', false);
      st.points = 0;
      let { x, y, z } = t;
      if (t.kind === 'air') {
        const old = trail.get(t.thing);
        const speed = old ? [(x - old[0]) / Math.max(st.clock - old[3], 0.01), (y - old[1]) / Math.max(st.clock - old[3], 0.01), (z - old[2]) / Math.max(st.clock - old[3], 0.01)] : [0, 0, 0];
        trail.set(t.thing, [x, y, z, st.clock]);
        const fly = t.d / LEAD;
        x += speed[0] * fly; y += speed[1] * fly; z += speed[2] * fly;
      }
      aim(x, y, z);
      arm(st, t.kind === 'man' ? (t.d < 12 && op.ctx.weapons.owned.has('shotgun') ? 'shotgun' : gun) : t.kind === 'truck' ? gun : heavy);
      st.pulse = !st.pulse;
      hold('fire', st.pulse);
      return undefined;
    });
  };

  /** A scripted press list against the clock, with forward held: the same thing a person's fingers do. */
  bot.keys = (yaw, list, seconds = 3) => {
    const plan = [...list].sort((p, q) => p[0] - q[0]);
    return bot.run(seconds, st => {
      player().yaw = yaw;
      player().pitch = 0;
      hold('forward');
      while (plan.length > 0 && plan[0][0] <= st.clock) tap(st, plan.shift()[1]);
      return plan.length === 0 && st.clock > 0.3 && player().grounded ? 'landed' : undefined;
    });
  };
  /** Runs at something until `when` is true of the body, then plays `list` from that moment. */
  bot.runUp = (yaw, when, list, seconds = 8) => {
    const test = new Function('p', `return ${when}`);
    const plan = [...list].sort((p, q) => p[0] - q[0]);
    let from = -1;
    return bot.run(seconds, st => {
      const p = player();
      p.yaw = yaw;
      p.pitch = 0;
      hold('forward');
      if (from < 0) {
        if (!test(p)) return undefined;
        from = st.clock;
      }
      while (plan.length > 0 && plan[0][0] <= st.clock - from) {
        const [, key, how] = plan.shift();
        if (how === 'hold') hold(key);
        else tap(st, key);
      }
      return plan.length === 0 && st.clock - from > 0.3 && p.grounded ? 'landed' : undefined;
    });
  };
  /** The gallery's lesson, as parkour's own bot does it: in along the wall, onto it, off it with a jump, and a jump again. */
  bot.wallRun = (lip, from, turn, leave) => {
    const EAST = -Math.PI / 2;
    let stage = 0, on = 0;
    return bot.run(9, st => {
      const p = player();
      hold('forward');
      p.pitch = 0;
      if (stage === 0) {
        p.yaw = EAST;
        if (p.position.x > lip - from - 3) stage = 1;
      } else if (stage === 1) {
        p.yaw = EAST + turn;
        if (p.position.x > lip - from) { tap(st, 'jump'); stage = 2; st.at = st.clock; }
      } else if (stage === 2) {
        if (p.wallRunning) { stage = 3; on = st.clock; p.yaw = EAST; }
        else if (st.clock - st.at > 1.5) return 'never on the wall';
      } else if (stage === 3) {
        if (st.clock - on > leave) { p.yaw = EAST - 0.35; tap(st, 'jump'); stage = 4; st.at = st.clock; }
        else if (p.grounded) return 'fell off the wall';
      } else if (stage === 4) {
        if (st.clock - st.at > 0.25) { tap(st, 'jump'); stage = 5; }
      } else if (p.grounded) return 'landed';
      return undefined;
    });
  };
  bot.state = () => {
    const { ctx } = op;
    const { position: at, yaw } = ctx.player;
    const ammo = ctx.weapons.ammo(ctx.weapons.current);
    return { at: [at.x, at.y, at.z].map(n => Math.round(n * 10) / 10), yaw: Math.round(yaw * 100) / 100, gun: ctx.weapons.current, mag: ammo.mag, reserve: ammo.reserve, owned: [...ctx.weapons.owned], men: ctx.enemies.alive.length, v: ctx.enemies.vehicles?.describe?.(), grounded: ctx.player.grounded, parked: ctx.player.parked };
  };
}

export default async function play(page, h) {
  const log = [];
  const cheats = [];
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const shot = h.shot;
  const snap = name => Promise.race([shot(name), h.sleep(9000)]).catch(() => log.push({ noShot: name }));
  const read = () => page.evaluate(() => window.__op2?.campaign?.runner?.describe() ?? null);
  const state = () => page.evaluate(() => window.__bot.state());
  const hud = () => page.evaluate(() => ({
    radio: document.querySelector('.ms-radio.on')?.textContent ?? null,
    hint: document.querySelector('.ms-hint.on')?.textContent ?? null,
    objectives: [...document.querySelectorAll('.ms-obj')].map(e => e.textContent),
  }));
  const until = async (test, seconds, label) => {
    for (let t = 0; t < seconds * 4; t++) {
      const d = await read();
      if (d && test(d)) return d;
      await h.sleep(250);
    }
    throw new Error(`timed out on ${label}: ${JSON.stringify(await read())}`);
  };
  const beatIs = (id, seconds = 30) => until(d => d.beat === id, seconds, id);
  const walk = async (x, y, z, opts) => {
    const out = await page.evaluate(([x, y, z, o]) => window.__bot.walk(x, y, z, o), [x, y, z, opts ?? {}]);
    if (out !== 'arrived') log.push({ walk: [x, y, z], out, s: await state() });
    return out === 'arrived';
  };
  const fight = (tags, opts) => page.evaluate(([t, o]) => window.__bot.fight(t, o), [tags, opts ?? {}]);
  const keys = (yaw, list, seconds) => page.evaluate(([y, l, s]) => window.__bot.keys(y, l, s), [yaw, list, seconds]);
  const runUp = (yaw, when, list, seconds) => page.evaluate(([y, w, l, s]) => window.__bot.runUp(y, w, l, s), [yaw, when, list, seconds]);
  const tp = (x, y, z, yaw = 0) => page.evaluate(([x, y, z, yaw]) => {
    const { player } = window.__op2.ctx;
    player.teleport(player.position.clone().set(x, y, z), yaw);
  }, [x, y, z, yaw]);
  const cheat = async (what, s) => {
    cheats.push({ what, beat: (await read())?.beat, s: s ?? await state() });
  };
  /** Dev skip: everything under these tags falls over. A truck's men climb out after it dies, so this is called until the beat moves. */
  const kill = (...tags) => page.evaluate(names => {
    const { ctx, campaign } = window.__op2;
    const point = ctx.player.position.clone();
    for (const e of [...ctx.enemies.alive]) {
      if (names.length && !names.includes(campaign.host.tagOf.get(e.uid))) continue;
      ctx.enemies.applyDamage(e, { amount: 1e6, type: 'true', point: e.center.clone(), dir: point.clone().set(0, 0, 1), force: 0, source: 'smg' });
    }
    for (const v of [...(ctx.enemies.vehicles?.live ?? [])]) if (!names.length || names.includes(v.tag)) v.take(1e6, null, 'rocket', v.position);
  }, tags);
  const skipTo = async (beat, seconds, ...tags) => {
    for (let t = 0; t < seconds; t++) {
      if ((await read()).beat === beat) return;
      await kill(...tags);
      await h.sleep(1000);
    }
    throw new Error(`never reached ${beat}: ${JSON.stringify(await read())}`);
  };

  /** Dies where it stands, and holds the checkpoint to its word: the place, the kit, and a beat that has started again. */
  const dieHere = async expect => {
    if (!DIE) return;
    const before = await read();
    await page.evaluate(() => {
      const b = window.__bot;
      b.god = false;
      b.idle();
      const p = window.__op2.ctx.player;
      p.maxHealth = p.health = 100;
      p.armor = 0;
      p.modifiers.invulnerable = false;
      p.takeDamage({ amount: 1e6, from: p.position, type: 'true', source: 'test' });
    });
    await until(d => d.deaths === before.deaths + 1 && d.state === 'running', 12, 'redeploy');
    await page.evaluate(() => { window.__bot.god = true; });
    await h.sleep(1600);
    const s = await state();
    const after = await read();
    log.push({ died: before.beat, back: after.beat, at: s.at, owned: s.owned, doors: after.doors, tags: after.tags, hud: await hud(), wanted: expect });
  };

  await page.waitForFunction(() => window.__op2?.campaign?.runner?.beat, null, { timeout: 90000 });
  await page.evaluate(driver);

  const stretches = {
    async film() {
      await beatIs('briefing', 60);
      await h.sleep(1500);
      await snap('film');
      await page.keyboard.press('KeyE');
      await beatIs('insertion', 8);
      log.push({ skipped: await hud() });
    },
    async ride() {
      await beatIs('insertion', 60);
      await h.sleep(3000);
      await snap('ride');
      await dieHere('the seat again');
      await page.evaluate(() => {
        const { ctx } = window.__op2;
        window.__rideGun = setInterval(() => {
          const s = ctx.progression.callInsManager.seats.seat;
          if (!s) return;
          const eye = s.view.position;
          let best = null, near = 300;
          for (const e of ctx.enemies.alive) { const d = e.center.distanceTo(eye); if (d < near) { near = d; best = e; } }
          if (!best) return;
          const dx = best.center.x - eye.x, dy = best.center.y - eye.y, dz = best.center.z - eye.z;
          s.yaw = Math.atan2(-dx, -dz);
          s.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        }, 120);
        ctx.input.simulate('fire', true);
      });
      await until(d => d.beat !== 'insertion', 170, 'the ride ending');
      await page.evaluate(() => { clearInterval(window.__rideGun); window.__op2.ctx.input.simulate('fire', false); });
      log.push({ rideDone: await read() });
    },
    async lockout() {
      await beatIs('lockout', 30);
      await h.sleep(3500);
      await snap('pit');
      log.push({ inPit: await state(), hud: await hud() });
      await dieHere('the pit');
      // Out of the cut on its north wall, as the hint says.
      const s = await state();
      const out = await runUp(0, 'p.position.z < 75', [[0, 'jump']], 6);
      await h.sleep(400);
      const up = await state();
      log.push({ mantle: out, from: s.at, to: up.at });
      if (up.at[1] < -0.5) {
        await cheat('never got out of the cut', up);
        await tp(-30, 0, 71, 0);
      }
      const rim = await fight(['lz.rim'], { seconds: 30 });
      log.push({ rim, s: await state() });
      await snap('rim');
      await walk(-2, 0, 40, { seconds: 25 });
      await snap('gatelane');
      await walk(0, 0, 30, { seconds: 8, within: 3 });
      await beatIs('softskins', 30).catch(e => cheat(`gate never shut: ${e.message}`));
      await snap('gate');
      log.push({ gate: await hud(), s: await state() });
    },
    async soft() {
      await beatIs('softskins', 60);
      await dieHere('the gate mouth');
      await walk(24, 0, 25, { seconds: 15 });
      await h.sleep(400);
      await snap('guardhouse');
      log.push({ guard: await state(), hud: await hud() });
      if (!(await state()).owned.includes('shotgun')) await cheat('walked to the crate and no shotgun');
      const out = await fight(null, { seconds: 130, until: 'op.campaign.runner.beat?.id !== "softskins"', gun: 'smg' });
      log.push({ softFight: out, d: await read(), s: await state() });
      await snap('soft-after');
      if (out === 'timeout') {
        await cheat('softskins not cleared by hand');
        await skipTo('breather', 40);
      }
      await beatIs('breather', 10);
      await dieHere('the apron rally');
      await until(d => d.beat === 'heavy', 28, 'heavy');
    },
    async heavy() {
      await beatIs('heavy', 40);
      await dieHere('the apron rally, again');
      await h.sleep(9000);
      await snap('heavy');
      log.push({ heavy: await hud(), v: (await state()).v });
      await until(d => d.objectives.some(o => o.includes('wreck')), 12, 'told of the wreck');
      await walk(46, 0, 60, { seconds: 22, within: 3 });
      await walk(70, 0, 76, { seconds: 12, within: 3 });
      await beatIs('wreck', 8).catch(e => cheat(`no wreck beat: ${e.message}`));
      await snap('hull');
    },
    async wreck() {
      await beatIs('wreck', 40);
      await dieHere('the foot of the wreck');
      await walk(84, 0, 78.6, { seconds: 10, within: 1 });
      const hull = await keys(Math.PI, [[0.05, 'jump'], [0.38, 'jump']], 3);
      await h.sleep(500);
      const up = await state();
      log.push({ doubleJump: hull, s: up.at });
      await snap('deck');
      if (up.at[1] < 3.8) {
        await cheat('double jump did not reach the deck', up);
        await tp(84, 4.3, 83, Math.PI);
      } else await walk(84, 4.2, 84, { seconds: 6, within: 1 }).catch(() => {});
      await beatIs('turn', 10).catch(async e => { await cheat(`no launcher: ${e.message}`); await tp(84, 4.3, 84, 0); await beatIs('turn', 5); });
      await h.sleep(1500);
      await snap('launcher');
      log.push({ launcher: await state(), hud: await hud() });
    },
    async turn() {
      await beatIs('turn', 40);
      await dieHere('the deck');
      const out = await fight(['heavy.tank1', 'heavy.tank2'], { seconds: 90, reach: 90 });
      log.push({ tanks: out, s: await state(), d: await read() });
      await snap('tanks');
      if (out !== 'cleared') { await cheat('tanks not killed with rockets'); await kill('heavy.tank1', 'heavy.tank2'); }
      const air = await fight(['turn.chopper'], { seconds: 60, reach: 120 });
      log.push({ chopper: air, s: await state() });
      if (air !== 'cleared') { await cheat('chopper not killed with rockets'); await kill('turn.chopper'); }
      await until(d => d.tags['turn.bulwark'], 12, 'Bulwark ordered');
      await walk(6, 0, 40, { seconds: 22, within: 4 });
      await h.sleep(8000);
      await snap('bulwark');
      log.push({ bulwark: await state(), hud: await hud() });
      const plug = await fight(['turn.bulwark'], { seconds: 50, reach: 80 });
      log.push({ plug, s: await state() });
      if (plug !== 'cleared') { await cheat('Bulwark not killed with rockets'); await kill('turn.bulwark'); }
      await beatIs('breach', 20);
    },
    async breach() {
      await beatIs('breach', 40);
      await dieHere('the gate mouth, wreck in place');
      await h.sleep(8000);
      await snap('jam');
      log.push({ jam: await state(), hud: await hud(), doors: (await read()).doors });
      // Over the wreck in the gate: nothing else gets a body through it.
      await walk(0, 0, 18, { seconds: 8, within: 1.2 });
      const over = await runUp(0, 'p.position.z < 15.5', [[0, 'jump']], 5);
      await h.sleep(700);
      const on = await state();
      await page.evaluate(() => window.__bot.run(2.5, st => { const { ctx } = window.__op2; ctx.player.yaw = 0; ctx.input.simulate('forward', true); if (ctx.player.position.z < 7) return 'through'; }));
      const past = await state();
      log.push({ overWreck: over, on: on.at, past: past.at });
      if (past.at[2] > 9.5) {
        await cheat('could not get over the wreck in the gate', past);
        await tp(0, 0, 6, 0);
      }
      await snap('yard');
      await fight(['breach.west', 'breach.east'], { seconds: 20, reach: 26, stay: true });
      await tp(0, 0, 12, 0).catch(() => {});
      const slid = await runUp(0, 'p.position.z < -4', [[0, 'slide', 'hold']], 5);
      await page.evaluate(() => window.__bot.run(1.2, st => { window.__op2.ctx.input.simulate('forward', true); }));
      const under = await state();
      log.push({ slide: slid, under: under.at, d: (await read()).doors });
      if (under.at[2] > -13) {
        await cheat('never got under the blast door', under);
        await until(d => d.doors.blastDoor === 0.4, 12, 'door up').catch(() => {});
        await tp(0, 0, -18, Math.PI);
      }
      await beatIs('barracks', 10);
    },
    async barracks() {
      await beatIs('barracks', 40);
      await h.sleep(1500);
      await dieHere('Sally Hall');
      await snap('sally');
      await until(d => d.doors.sallyWest === 1, 40, 'the door west');
      await h.sleep(1500);
      await snap('dark');
      log.push({ dark: await hud() });
      await walk(-14, 0, -17.5, { seconds: 8 });
      await h.sleep(600);
      await snap('corridor');
      const out = await fight(['bar.pin', 'bar.flank', 'bar.bunks'], { seconds: 60, reach: 46 });
      log.push({ barracks: out, s: await state(), d: await read() });
      await walk(-30, 0, -42.5, { seconds: 20, within: 3 });
      await snap('north');
      await walk(-34, 0, -47, { seconds: 10, within: 1.5 });
      await beatIs('coolant', 8).catch(async e => { await cheat(`barracks would not hand on: ${e.message}`); await tp(-34, 0, -48, 0); await beatIs('coolant', 4); });
    },
    async coolant() {
      await beatIs('coolant', 40);
      await dieHere('the near platform');
      await h.sleep(900);
      await snap('coolant');
      log.push({ coolant: await hud(), s: await state() });
      let tries = 0;
      for (; tries < 4; tries++) {
        await tp(-34, 0, -44, 0);
        await h.sleep(250);
        const out = await runUp(0, 'p.position.z < -49.7', [[0, 'jump'], [0.32, 'jump'], [0.5, 'dash']], 6);
        await h.sleep(300);
        const s = await state();
        log.push({ dash: out, s: s.at });
        if ((await read()).beat !== 'coolant') break;
      }
      if (tries === 4) { await cheat('dash never made it across'); await tp(-34, 0, -72, Math.PI); }
      await beatIs('gallery', 6);
    },
    async gallery() {
      await beatIs('gallery', 40);
      await dieHere('the near deck');
      await walk(-20, -5, -74.5, { seconds: 15, within: 2 });
      await h.sleep(400);
      await snap('gallery');
      log.push({ gallery: await hud(), s: await state() });
      let tries = 0;
      for (; tries < 4; tries++) {
        await tp(-23.4, -5, -75.8, -Math.PI / 2);
        await h.sleep(250);
        const out = await page.evaluate(() => window.__bot.wallRun(-11, 4, 0.35, 1.3));
        await h.sleep(300);
        log.push({ wall: out, s: (await state()).at });
        if ((await read()).beat !== 'gallery') break;
      }
      if (tries === 4) { await cheat('wall run never made it across'); await tp(18, -5, -74.5, -Math.PI / 2); }
      await beatIs('mess', 6);
    },
    async mess() {
      await beatIs('mess', 40);
      await dieHere('the far deck');
      await walk(35.5, 0, -74.5, { seconds: 12 });
      await snap('kitchen');
      await walk(34, 0, -66, { seconds: 8, within: 2.5 });
      await h.sleep(1500);
      await snap('mess');
      log.push({ mess: await hud(), s: await state(), quiet: await page.evaluate(() => window.__op2.ctx.enemies.outpost.soldiers.filter(s => s.silent).length) });
      await page.waitForFunction(() => document.querySelector('.ms-radio.on')?.textContent.includes('Now.'), null, { timeout: 16000 }).catch(() => cheats.push({ what: 'never heard Now' }));
      await h.sleep(1400);
      await snap('ambush');
      const out = await fight(['mess.floor', 'mess.west', 'mess.east'], { seconds: 60 });
      log.push({ messFight: out, s: await state(), d: await read() });
      if (out !== 'cleared') { await cheat('mess not cleared by hand'); await skipTo('armoury', 25, 'mess.floor', 'mess.west', 'mess.east'); }
      await beatIs('armoury', 6);
    },
    async armoury() {
      await beatIs('armoury', 40);
      await dieHere('the armoury');
      await walk(44, 0, -37, { seconds: 16, within: 1.2 });
      await snap('armoury');
      log.push({ armoury: await hud(), s: await state() });
      await beatIs('plates', 30);
    },
    async plates() {
      await beatIs('plates', 40);
      await dieHere('the armoury, with the cannon');
      await h.sleep(800);
      await walk(44, 0, -28, { seconds: 8, within: 2 });
      await h.sleep(3000);
      await snap('plates');
      const men = () => page.evaluate(() => {
        const { ctx, campaign } = window.__op2;
        return ctx.enemies.alive.map(e => ({ tag: campaign.host.tagOf.get(e.uid), id: e.id, armor: Math.round(e.armor), plates: e.plates.length, hp: Math.round(e.health), at: e.position.toArray().map(Math.round) }));
      });
      log.push({ men: await men(), hud: await hud() });
      const out = await fight(['plate.front', 'plate.back', 'plate.round'], { seconds: 70, gun: 'autocannon', reach: 46 });
      log.push({ plateFight: out, s: await state(), d: await read() });
      if (out !== 'cleared') { await cheat('plates not cleared by hand'); await skipTo('stack', 25, 'plate.front', 'plate.back', 'plate.round'); }
      await beatIs('stack', 14);
    },
    async stack() {
      await beatIs('stack', 40);
      await h.sleep(2500);
      await dieHere('the Stack floor');
      await walk(6, 0, -33, { seconds: 14, within: 2.5 });
      await snap('stackfloor');
      log.push({ stack: await hud(), s: await state() });
      const low = await fight(['stack.base', 'stack.lower'], { seconds: 45, gun: 'smg', reach: 40 });
      log.push({ low, s: await state(), d: await read() });
      await snap('stackmid');
      const high = await fight(['stack.upper'], { seconds: 35, gun: 'smg', reach: 40 });
      log.push({ high, s: await state() });
      await walk(0, 10, -60, { seconds: 22, within: 2.5 });
      await beatIs('commander', 6).catch(async e => { await cheat(`never reached the top: ${e.message}`); await tp(0, 10, -60, 0); await beatIs('commander', 4); });
    },
    async boss() {
      await beatIs('commander', 40);
      await dieHere('the top landing');
      await h.sleep(2500);
      await snap('boss');
      log.push({ boss: await hud(), s: await state() });
      const body = () => page.evaluate(() => {
        const b = window.__op2.ctx.enemies.outpost.commander.person.body;
        return b ? { at: b.position.toArray().map(Math.round), hp: Math.round(b.health), max: Math.round(b.maxHealth), armor: Math.round(b.armor) } : null;
      });
      log.push({ him: await body() });
      const first = await fight(['commander'], { seconds: 40, gun: 'autocannon', heavy: 'rocket', until: 'op.campaign.runner.describe().doors.warRoomStairs === 1' });
      log.push({ first, him: await body(), s: await state() });
      if (first !== 'ended') { await cheat('the first 40% of him did not come off in 40 s'); await page.evaluate(() => { const { ctx } = window.__op2; const b = ctx.enemies.outpost.commander.person.body; for (let i = 0; i < 80 && b.health / b.maxHealth > 0.56; i++) ctx.enemies.applyDamage(b, { amount: 400, type: 'true', point: b.center.clone(), dir: b.center.clone().set(0, 0, -1), force: 0, source: 'rocket' }); }); }
      await until(d => d.doors.warRoomStairs === 1, 8, 'he runs');
      await h.sleep(2000);
      await snap('he-runs');
      log.push({ fled: await hud(), him: await body() });
      await walk(0, 10, -72, { seconds: 10, within: 2.5 });
      await walk(-13.7, 14, -65.8, { seconds: 14, within: 2 });
      await snap('roof');
      const roof = await fight(['commander', 'boss.west', 'boss.east'], { seconds: 60, gun: 'autocannon', heavy: 'rocket', until: 'op.campaign.runner.beat?.id !== "commander"' });
      log.push({ roof, him: await body(), s: await state() });
      if (roof !== 'ended') {
        await cheat('he did not die in a minute');
        await page.evaluate(async () => { const { ctx } = window.__op2; const b = ctx.enemies.outpost.commander.person.body; for (let i = 0; i < 200 && b.alive; i++) { ctx.enemies.applyDamage(b, { amount: 1e6, type: 'true', point: b.center.clone(), dir: b.center.clone().set(0, 0, -1), force: 0, source: 'rocket' }); await new Promise(r => setTimeout(r, 30)); } });
      }
      await beatIs('ending', 12);
    },
    async ending() {
      await beatIs('ending', 40);
      await h.sleep(2500);
      await dieHere('the roof');
      await snap('end-box');
      await page.waitForFunction(() => window.__op2.campaign.host.film.playing, null, { timeout: 45000 });
      await h.sleep(4000);
      await snap('end-film');
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => document.querySelector('.scr-complete')?.style.display === '', null, { timeout: 30000 });
      await h.sleep(2200);
      await snap('end-screen');
      log.push({ result: await page.evaluate(() => window.__op2.campaign.result), stored: await page.evaluate(() => localStorage.getItem('op2_campaign_beaten')), bill: await page.evaluate(() => document.querySelector('.scr-complete').innerText) });
    },
    /** Play again on the same page, and every beat fast-forwarded: what a first win leaves behind is what breaks a second. */
    async again() {
      await page.locator('.scr-complete').getByText('Play again', { exact: true }).click();
      await beatIs('briefing', 10);
      await page.evaluate(() => { window.__bot.god = true; });
      log.push({ second: await read(), s: await state(), curtain: await page.evaluate(() => getComputedStyle(document.querySelector('.ms-curtain')).opacity) });
      await h.sleep(800);
      await snap('again');
      const ids = await page.evaluate(() => window.__op2.campaign.runner.mission.beats.map(b => b.id));
      await page.keyboard.press('KeyE');
      await beatIs('insertion', 8);
      await h.sleep(3000);
      await page.evaluate(() => window.__op2.ctx.time.pushScale('bot', 6, 0, 0));
      await beatIs('lockout', 60);
      await page.evaluate(() => window.__op2.ctx.time.popScale('bot'));
      log.push({ secondLanding: await state(), d: await read() });
      const marks = { lockout: [0, 0, 30], softskins: [24, 0, 25], heavy: [70, 0, 76], wreck: [84, 4.3, 84], breach: [0, 0, -18], barracks: [-34, 0, -48], coolant: [-34, 0, -72], gallery: [18, -5, -74.5], mess: [34, 0, -66], armoury: [44, 0, -37], stack: [0, 10, -60] };
      for (const id of ids.slice(ids.indexOf('lockout'), ids.indexOf('commander'))) {
        const next = ids[ids.indexOf(id) + 1];
        const deadline = Date.now() + 45000;
        for (;;) {
          const d = await read();
          if (ids.indexOf(d.beat) >= ids.indexOf(next)) break;
          if (Date.now() > deadline) { await cheat(`second time, stuck in ${d.beat}`); throw new Error(`second playthrough stuck: ${JSON.stringify(d)}`); }
          if (marks[d.beat]) await tp(...marks[d.beat]);
          await kill();
          await h.sleep(900);
        }
      }
      log.push({ secondCommander: await read(), s: await state() });
      await h.sleep(1500);
      await page.evaluate(async () => { const { ctx } = window.__op2; for (let i = 0; i < 300; i++) { const b = ctx.enemies.outpost.commander.person.body; if (b?.alive) ctx.enemies.applyDamage(b, { amount: 1e6, type: 'true', point: b.center.clone(), dir: b.center.clone().set(0, 0, -1), force: 0, source: 'rocket' }); await new Promise(r => setTimeout(r, 30)); if (window.__op2.campaign.runner.beat?.id === 'ending') break; } });
      await beatIs('ending', 10);
      await page.waitForFunction(() => window.__op2.campaign.host.film.playing, null, { timeout: 45000 });
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => document.querySelector('.scr-complete')?.style.display === '', null, { timeout: 30000 });
      await h.sleep(2000);
      await snap('again-end');
      log.push({ secondResult: await page.evaluate(() => window.__op2.campaign.result), bill: await page.evaluate(() => document.querySelector('.scr-complete').innerText.slice(0, 300)) });
    },
  };

  try {
    for (const step of PLAY) {
      const t = Date.now();
      await stretches[step]();
      log.push({ stretch: step, seconds: Math.round((Date.now() - t) / 1000) });
    }
  } catch (e) {
    errors.push(String(e));
    await snap('failed');
  }
  const beats = await page.evaluate(() => {
    const out = {};
    for (const [id, s] of Object.entries(window.__bot.beats)) out[id] = { seconds: Math.round(s.seconds), fps: Math.round(s.frames / Math.max(s.seconds, 0.1)), slowShare: Math.round((s.slow / s.frames) * 100), worstMs: s.worst, cpuPeak: Math.round(s.cpu), men: s.men, hurt: Math.round(s.hurt) };
    return out;
  });
  return { play: PLAY, cheats, errors, beats, log };
}
