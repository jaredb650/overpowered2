// Weapons against real enemies, on the real map, with real gore. One group per run:
//
//   RL_GROUP=guns node tools/shot.mjs --url "/?sandbox=range&live=1&load=husk,trooper,smg,brute,minigun" \
//     --script tools/scripts/range-live.mjs --wait 1000 --timeout 200 --out tools/out/rl-guns.png
//
// Groups: guns, heavy, sword, perks, view, world, comma separated. Each prints a JSON result. Screenshots land beside --out.
const groups = (process.env.RL_GROUP ?? 'guns').split(',');
/** Comma list of step names, to rerun part of a group. */
const only = process.env.RL_ONLY?.split(',');

/** Runs in the page. Everything a test needs, hooked once. */
function prelude() {
  const R = window.__range;
  const ctx = R.ctx;
  const { input, player: P, weapons: W } = ctx;
  const log = { kills: [], severed: [], hits: 0, dealt: 0, blocked: 0, heads: 0, gore: {}, sounds: {}, stops: [], fx: {}, fired: {}, empty: 0 };
  const v = new (P.eye.constructor)();

  for (const k of ['slice', 'pin', 'headshot', 'gib', 'sever', 'ragdoll']) {
    log.gore[k] = 0;
    const f = ctx.gore[k].bind(ctx.gore);
    ctx.gore[k] = (...a) => {
      log.gore[k]++;
      if (k === 'slice') log.lastSlice = { point: a[1].toArray(), normal: a[2].toArray() };
      return f(...a);
    };
  }
  for (const k of ['chips', 'explosion', 'beam', 'slash', 'flame', 'ring', 'muzzleFlash', 'tracer', 'shellCasing', 'lensBlood']) {
    log.fx[k] = 0;
    const f = ctx.fx[k].bind(ctx.fx);
    ctx.fx[k] = (...a) => {
      log.fx[k]++;
      return f(...a);
    };
  }
  const play = ctx.audio.play.bind(ctx.audio);
  ctx.audio.play = (id, o) => {
    log.sounds[id] = (log.sounds[id] ?? 0) + 1;
    return play(id, o);
  };
  const stop = ctx.time.hitStop.bind(ctx.time);
  ctx.time.hitStop = (s, k) => {
    log.stops.push(Number(s.toFixed(3)));
    return stop(s, k);
  };
  const on = ctx.events.on.bind(ctx.events);
  on('enemy:killed', e => log.kills.push({
    id: e.enemy.id, src: e.damage.source, type: e.damage.type, head: e.headshot, gib: e.gibbed, sliced: e.sliced,
    blast: e.explosionId, d: Number(e.distance.toFixed(1)),
  }));
  on('enemy:severed', e => log.severed.push(e.region));
  on('enemy:hit', e => {
    log.hits++;
    log.dealt += e.result.dealt;
    if (e.result.blocked) log.blocked++;
    if (e.result.headshot) log.heads++;
  });
  on('weapon:fired', e => { log.fired[e.weapon] = (log.fired[e.weapon] ?? 0) + 1; });
  on('weapon:empty', () => log.empty++);

  const T = {
    R, ctx, log, W, P, input, v,
    frames: n => new Promise(res => {
      let i = 0;
      const f = () => (++i >= n ? res() : requestAnimationFrame(f));
      requestAnimationFrame(f);
    }),
    /** Seconds of wall clock on the game's clock. */
    wait(s, each) {
      const end = ctx.time.realElapsed + s;
      return new Promise(res => {
        const f = () => {
          each?.();
          if (ctx.time.realElapsed >= end) res();
          else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      });
    },
    async tap(action, frames = 2) {
      input.simulate(action, true);
      await T.frames(frames);
      input.simulate(action, false);
      await T.frames(1);
    },
    async equip(id) {
      W.switchTo(id);
      await T.wait(0.5);
    },
    mark() {
      log.kills.length = log.severed.length = log.stops.length = 0;
      log.hits = log.dealt = log.blocked = log.heads = log.empty = 0;
      for (const k in log.gore) log.gore[k] = 0;
      for (const k in log.fx) log.fx[k] = 0;
      for (const k in log.sounds) delete log.sounds[k];
      for (const k in log.fired) delete log.fired[k];
    },
    async clear() {
      ctx.enemies.killAll('test');
      await T.frames(4);
      T.mark();
    },
    headOf(e) {
      const bones = e.char.rig.bones;
      for (let i = 0; i < bones.length; i++) {
        if (bones[i].name === 'head') {
          const hit = bones[i].hit;
          v.set((hit.from[0] + hit.to[0]) / 2, (hit.from[1] + hit.to[1]) / 2, (hit.from[2] + hit.to[2]) / 2);
          return e.char.bones[i].localToWorld(v);
        }
      }
      return v.copy(e.center);
    },
    aim(e, head) {
      const t = head ? T.headOf(e) : e.center;
      R.aim(t.x, t.y, t.z);
    },
    /** Holds `action` for `seconds` while keeping the crosshair on `e`. */
    async hold(action, e, head, seconds) {
      input.simulate(action, true);
      await T.wait(seconds, () => { if (e?.alive) T.aim(e, head); });
      input.simulate(action, false);
      await T.frames(1);
    },
    /** One shot at `e`, aimed on the frame it leaves. */
    async shoot(e, head) {
      T.aim(e, head);
      await T.frames(2);
      T.aim(e, head);
      input.simulate('fire', true);
      await T.frames(2);
      input.simulate('fire', false);
      await T.frames(2);
    },
    /** Faces the direction with a wall between `min` and `max` meters away, flat on the eye line. Moves spawn if it must. */
    lane(min, max = 400) {
      const dir = new (P.eye.constructor)();
      for (const spot of [P.position.clone(), ...ctx.world.pickupSpots.slice(0, 40)]) {
        if (spot !== undefined && !spot.equals(P.position)) P.teleport(spot.clone().setY(spot.y + 0.1));
        for (let i = 0; i < 24; i++) {
          const yaw = (i / 24) * Math.PI * 2;
          dir.set(-Math.sin(yaw), 0, -Math.cos(yaw));
          const eye = P.position.clone();
          eye.y += 1.5;
          const hit = ctx.physics.raycast(eye, dir, 500);
          const d = hit ? hit.distance : 500;
          if (d >= min && d <= max) {
            P.yaw = yaw;
            P.pitch = 0;
            return { yaw, wall: d };
          }
        }
      }
      return null;
    },
    /** Stops the clocks the frame after `fn` runs, so a one-frame effect can be photographed. */
    async freezeAfter(fn) {
      await fn();
      ctx.time.paused = true;
      await T.frames(2);
    },
    thaw() {
      ctx.time.paused = false;
    },
  };
  P.modifiers.invulnerable = true;
  window.__T = T;
  return true;
}

const GROUPS = {
  guns: [
    ['smg', async () => {
      const { R, W, log, ctx } = window.__T;
      const T = window.__T;
      const out = {};
      out.lane = T.lane(25);
      await T.equip('smg');
      T.mark();
      const a = W.ammo('smg');
      a.mag = 30;
      const t0 = ctx.time.playerElapsed;
      T.input.simulate('fire', true);
      await T.wait(1.2);
      T.input.simulate('fire', false);
      await T.frames(2);
      out.rate = Number((log.fired.smg / (ctx.time.playerElapsed - t0)).toFixed(1));
      out.magAfter = a.mag;
      await T.wait(1.5);
      out.autoReload = { mag: a.mag, reserve: a.reserve };

      await T.clear();
      let e = R.spawn('husk', 10);
      await T.frames(3);
      const hp = e.health;
      await T.shoot(e, false);
      out.body = { before: hp, after: e.health, alive: e.alive, hits: log.hits, dealt: log.dealt, stops: [...log.stops] };

      await T.clear();
      e = R.spawn('trooper', 10);
      await T.frames(4);
      await T.shoot(e, true);
      await T.frames(4);
      out.head = {
        alive: e.alive, heads: log.heads, kills: [...log.kills], chips: log.fx.chips, sound: log.sounds.headshot ?? 0,
        gore: { ...log.gore }, stops: [...log.stops],
      };

      await T.clear();
      const reloadStart = ctx.time.playerElapsed;
      a.mag = 5;
      T.input.simulate('reload', true);
      await T.frames(2);
      T.input.simulate('reload', false);
      const reloading = W.reloading;
      while (W.reloading) await T.frames(1);
      out.reload = { reloading, seconds: Number((ctx.time.playerElapsed - reloadStart).toFixed(2)), mag: a.mag };
      return out;
    }],
    ['shotgun', async () => {
      const T = window.__T;
      const { R, log, W } = T;
      const out = {};
      await T.equip('shotgun');
      await T.clear();
      let e = R.spawn('trooper', 3.5);
      await T.frames(4);
      await T.shoot(e, false);
      await T.frames(3);
      out.pointBlank = { alive: e.alive, hits: log.hits, severed: [...log.severed], kills: [...log.kills], gore: { ...log.gore }, lensBlood: log.fx.lensBlood };
      await T.wait(0.5);
      await T.clear();
      e = R.spawn('brute', 5);
      await T.frames(4);
      for (let i = 0; i < 5 && e.alive; i++) {
        T.aim(e, false);
        await T.shoot(e, false);
        await T.wait(0.33);
      }
      out.brute = { alive: e.alive, health: Math.round(e.health), severed: [...log.severed], blocked: log.blocked, hits: log.hits, mag: W.ammo('shotgun').mag };
      return out;
    }],
    ['judge', async () => {
      const T = window.__T;
      const { R, log } = T;
      const out = {};
      await T.equip('judge');
      await T.clear();
      const a = R.spawn('husk', 11);
      R.spawn('husk', 12, 3);
      R.spawn('husk', 13, -3);
      await T.frames(4);
      await T.shoot(a, true);
      await T.frames(6);
      out.ricochet = { kills: [...log.kills], hops: log.sounds.revolver_ricochet ?? 0, heads: log.heads, stops: [...log.stops] };
      return out;
    }],
    ['buzzsaw', async () => {
      const T = window.__T;
      const { R, log, ctx, W } = T;
      const out = {};
      T.lane(60);
      await T.equip('buzzsaw');
      await T.clear();
      const e = R.spawn('brute', 12);
      await T.frames(4);
      T.input.simulate('fire', true);
      let spinFired = -1;
      const t0 = ctx.time.playerElapsed;
      await T.wait(0.42, () => { if (e.alive) T.aim(e, false); spinFired = log.fired.buzzsaw ?? 0; });
      out.firedDuringSpinUp = spinFired;
      const f0 = log.fired.buzzsaw ?? 0;
      const t1 = ctx.time.playerElapsed;
      await T.wait(1.6, () => { if (e.alive) T.aim(e, false); });
      out.rps = Number((((log.fired.buzzsaw ?? 0) - f0) / (ctx.time.playerElapsed - t1)).toFixed(1));
      out.charge = W.charge;
      T.input.simulate('forward', true);
      await T.wait(0.3, () => { if (e.alive) T.aim(e, false); });
      const from = T.P.position.clone();
      const clock = ctx.time.playerElapsed;
      await T.wait(0.8, () => { if (e.alive) T.aim(e, false); });
      out.speedWhileSpun = Number((from.distanceTo(T.P.position) / (ctx.time.playerElapsed - clock)).toFixed(1));
      T.input.simulate('forward', false);
      T.input.simulate('fire', false);
      await T.frames(3);
      out.result = { alive: e.alive, severed: [...log.severed], hits: log.hits, dealt: Math.round(log.dealt), blocked: log.blocked, gore: { ...log.gore } };
      await T.wait(0.3);
      await T.clear();
      T.input.simulate('forward', true);
      await T.wait(0.8);
      out.speedFree = Number(T.P.speed.toFixed(1));
      T.input.simulate('forward', false);
      void t0;
      return out;
    }],
    ['kiln', async () => {
      const T = window.__T;
      const { R, log, W } = T;
      const out = {};
      T.lane(25);
      await T.equip('kiln');
      await T.clear();
      const e = R.spawn('trooper', 5);
      const f = R.spawn('husk', 5.5, 1.2);
      await T.frames(4);
      let burned = 0;
      T.input.simulate('fire', true);
      await T.wait(0.8, () => { if (e.alive) T.aim(e, false); burned = Math.max(burned, e.burning); });
      return Object.assign(out, { burned, neighbour: f.burning, mag: W.ammo('kiln').mag, flames: log.fx.flame, hits: log.hits, dealt: Math.round(log.dealt) });
    }, 'kiln'],
    ['dry', async () => {
      const T = window.__T;
      const { W, log, ctx } = T;
      const out = {};
      T.lane(25);
      await T.equip('smg');
      await T.clear();
      const events = [];
      const off = ctx.events.on('weapon:switched', e => events.push(`${e.from}>${e.to}`));
      for (const id of W.owned) {
        const a = W.ammo(id);
        if (id !== 'sword') a.mag = a.reserve = 0;
      }
      W.ammo('smg').mag = 3;
      W.ammo('stakegun').mag = 2;
      T.input.simulate('fire', true);
      await T.wait(0.7);
      out.afterSmg = { current: W.current, empty: log.empty, click: log.sounds.weapon_dry ?? 0 };
      await T.wait(2.2);
      T.input.simulate('fire', false);
      await T.frames(2);
      out.afterStakes = { current: W.current, empty: log.empty, switches: events };
      off();
      ctx.events.emit('wave:clear', { wave: 1, bonus: 0 });
      out.floor = { smg: W.ammo('smg').reserve, rocket: W.ammo('rocket').reserve };
      return out;
    }],
    ['kiln2', async () => {
      const T = window.__T;
      const { log } = T;
      await T.wait(0.8);
      T.input.simulate('fire', false);
      await T.wait(1.2);
      return { kills: [...log.kills], gore: { ...log.gore } };
    }],
  ],

  heavy: [
    ['rocket', async () => {
      const T = window.__T;
      const { R, log, W, P, ctx } = T;
      const out = {};
      out.lane = T.lane(25);
      await T.equip('rocket');
      await T.clear();
      let e = R.spawn('trooper', 14);
      await T.frames(4);
      await T.shoot(e, false);
      await T.wait(0.6);
      out.direct = { alive: e.alive, kills: [...log.kills], gib: log.gore.gib, explosions: log.fx.explosion, mag: W.ammo('rocket').mag };
      await T.wait(1.8);
      out.reloaded = W.ammo('rocket').mag;

      await T.clear();
      P.modifiers.invulnerable = false;
      const hp = P.health;
      // Open sky, or the measurement is only the height of whatever is overhead.
      const skyward = new P.position.constructor(0, 1, 0);
      const eyeOf = s2 => new P.position.constructor(s2.x, s2.y + 2, s2.z);
      const sky = ctx.world.pickupSpots.find(s2 => !ctx.physics.raycast(eyeOf(s2), skyward, 40));
      if (sky) {
        P.teleport(sky.clone());
        await T.wait(0.4);
      }
      const yStart = P.position.y;
      P.pitch = -1.5;
      await T.frames(2);
      P.pitch = -1.5;
      T.input.simulate('jump', true);
      await T.frames(2);
      T.input.simulate('jump', false);
      await T.frames(1);
      await T.tap('fire', 2);
      let peak = 0;
      let vy = 0;
      await T.wait(1.3, () => {
        peak = Math.max(peak, P.position.y - yStart);
        vy = Math.max(vy, P.velocity.y);
      });
      P.modifiers.invulnerable = true;
      out.rocketJump = { openSky: !!sky, peak: Number(peak.toFixed(2)), vy: Number(vy.toFixed(1)), selfDamage: Number((hp - P.health).toFixed(1)), explosions: log.fx.explosion };
      P.health = P.maxHealth;
      P.pitch = 0;
      void ctx;
      return out;
    }],
    ['autocannon', async () => {
      const T = window.__T;
      const { R, log, W, P, ctx } = T;
      const out = {};
      T.lane(25);
      await T.equip('autocannon');
      await T.clear();
      const fov0 = ctx.camera.fov;
      await T.tap('aim', 2);
      await T.wait(0.4);
      out.scope = { scoped: W.scoped, fovFrom: Number(fov0.toFixed(1)), fovTo: Number(ctx.camera.fov.toFixed(1)), lookScale: Number(P.lookScale.toFixed(3)) };
      const e = R.spawn('brute', 22);
      await T.frames(4);
      await T.shoot(e, false);
      await T.wait(0.4);
      out.shot = { alive: e.alive, kills: [...log.kills], explosions: log.fx.explosion, rings: log.fx.ring, mag: W.ammo('autocannon').mag };
      return out;
    }, 'scope'],
    ['unscope', async () => {
      const T = window.__T;
      const { W, ctx, P } = T;
      await T.tap('aim', 2);
      await T.wait(0.3);
      return { scoped: W.scoped, fov: Number(ctx.camera.fov.toFixed(1)), lookScale: Number(P.lookScale.toFixed(3)) };
    }],
    ['lance', async () => {
      const T = window.__T;
      const { R, log, W } = T;
      const out = {};
      T.lane(30);
      await T.equip('lance');
      await T.clear();
      T.input.simulate('fire', true);
      await T.wait(0.95);
      out.charge = Number(W.charge.toFixed(2));
      const row = [R.spawn('husk', 7), R.spawn('husk', 10), R.spawn('trooper', 13), R.spawn('husk', 16)];
      await T.frames(2);
      T.aim(row[1], false);
      await T.frames(1);
      T.aim(row[1], false);
      T.input.simulate('fire', false);
      await T.frames(3);
      await T.wait(0.2);
      out.pierce = { kills: [...log.kills], severed: [...log.severed], beam: log.fx.beam, stops: [...log.stops], mag: W.ammo('lance').mag, gore: { ...log.gore } };
      return out;
    }, 'lance'],
    ['stake', async () => {
      const T = window.__T;
      const { R, log, W, ctx, P } = T;
      const out = {};
      out.lane = T.lane(7, 10);
      await T.equip('stakegun');
      await T.clear();
      const e = R.spawn('husk', 3.5);
      await T.frames(3);
      await T.shoot(e, true);
      await T.wait(0.9);
      out.head = { alive: e.alive, kills: [...log.kills], gore: { ...log.gore }, sounds: Object.keys(log.sounds).filter(k => k.startsWith('stake')), pinned: ctx.gore.bodies.filter(b => b.stakes.length).length };
      ctx.time.paused = true;
      await T.frames(2);
      return out;
    }, 'stake'],
    ['stake body', async () => {
      const T = window.__T;
      const { R, log, ctx, P } = T;
      const out = {};
      T.thaw();
      await T.wait(0.3);
      await T.clear();
      const e = R.spawn('trooper', 3.5);
      await T.frames(3);
      T.aim(e, false);
      P.pitch -= 0.08;
      await T.frames(1);
      T.input.simulate('fire', true);
      await T.frames(2);
      T.input.simulate('fire', false);
      await T.wait(1.4);
      const hips = new P.position.constructor();
      const hang = ctx.gore.bodies.filter(b => b.stakes.length).map(b => {
        hips.setFromMatrixPosition(b.char.bones[0].matrixWorld);
        return { hipsAboveFloor: Number((hips.y - P.position.y).toFixed(2)), hipsToAnchor: Number(hips.distanceTo(b.stakes[0].anchor).toFixed(2)), stakeBone: b.stakes[0].bone, anchorAboveFloor: Number((b.stakes[0].anchor.y - P.position.y).toFixed(2)) };
      });
      out.body = { alive: e.alive, kills: [...log.kills], gore: { ...log.gore }, hang };
      R.aim(ctx.gore.bodies.at(-1).char.bones[0].matrixWorld.elements[12], ctx.gore.bodies.at(-1).char.bones[0].matrixWorld.elements[13], ctx.gore.bodies.at(-1).char.bones[0].matrixWorld.elements[14]);
      await T.frames(3);
      ctx.time.paused = true;
      await T.frames(2);
      return out;
    }, 'stake-body'],
    ['stake limb', async () => {
      const T = window.__T;
      const { R, log, ctx } = T;
      const out = {};
      T.thaw();
      await T.wait(0.8);
      await T.clear();
      const e = R.spawn('brute', 5);
      await T.frames(4);
      // A limb first, then the stake through what came off.
      const arm = e.char.bones.findIndex(b => /upperArmL|armL/i.test(b.name));
      if (arm >= 0) {
        e.char.bones[arm].getWorldPosition(T.v);
        R.aim(T.v.x, T.v.y, T.v.z);
      }
      await T.frames(2);
      await T.shoot(e, false);
      await T.wait(0.8);
      out.result = { severed: [...log.severed], gore: { ...log.gore }, alive: e.alive };
      void ctx;
      return out;
    }, 'stake-limb'],
    ['grenade', async () => {
      const T = window.__T;
      const { R, log, W, ctx } = T;
      const out = {};
      T.lane(25);
      await T.equip('smg');
      await T.clear();
      const e = R.spawn('trooper', 15);
      await T.frames(3);
      W.addGrenades(3);
      const g0 = W.grenades;
      T.aim(e, false);
      T.P.pitch += 0.15;
      await T.tap('grenade', 2);
      out.left = g0 - W.grenades;
      const projectiles = ctx.combat.projectiles;
      out.inFlight = projectiles.active.filter(p => p.kind === 'grenade').length;
      await T.wait(3);
      out.result = { explosions: log.fx.explosion, kills: [...log.kills], bounces: log.sounds.grenade_bounce ?? 0, sound: log.sounds.grenade_explode ?? 0 };

      await T.clear();
      const near = R.spawn('husk', 18, 2);
      await T.frames(2);
      T.P.pitch = 0.32;
      await T.tap('grenade', 2);
      await T.wait(0.6);
      const live = projectiles.active.find(p => p.kind === 'grenade');
      out.shotDown = { found: !!live };
      if (live) {
        const eye = T.P.eye;
        R.aim(live.position.x, live.position.y, live.position.z);
        await T.frames(1);
        R.aim(live.position.x, live.position.y, live.position.z);
        await T.tap('fire', 2);
        await T.frames(2);
        out.shotDown.gone = !projectiles.active.includes(live) || !live.live;
        out.shotDown.explosions = log.fx.explosion;
        void eye;
      }
      void near;
      return out;
    }],
  ],

  sword: [
    ['whiff light', async () => {
      const T = window.__T;
      const { ctx, log } = T;
      T.lane(25);
      await T.equip('sword');
      await T.clear();
      await T.freezeAfter(async () => {
        T.input.simulate('fire', true);
        await T.frames(2);
        T.input.simulate('fire', false);
      });
      void ctx;
      return { slash: log.fx.slash };
    }, 'whiff-light'],
    ['whiff area', async () => {
      const T = window.__T;
      const { log } = T;
      T.thaw();
      await T.wait(0.8);
      T.mark();
      T.input.simulate('aim', true);
      await T.wait(0.35);
      await T.freezeAfter(async () => {
        T.input.simulate('aim', false);
        await T.wait(0.07);
      });
      return { slash: log.fx.slash };
    }, 'whiff-area'],
    ['whiff heavy', async () => {
      const T = window.__T;
      const { log } = T;
      T.thaw();
      await T.wait(0.8);
      T.mark();
      await T.tap('fire', 2);
      await T.wait(0.28);
      await T.tap('fire', 2);
      await T.wait(0.33);
      await T.freezeAfter(async () => {
        T.input.simulate('fire', true);
        await T.frames(2);
        T.input.simulate('fire', false);
      });
      return { slash: log.fx.slash };
    }, 'whiff-heavy'],
    ['whiff thaw', async () => {
      window.__T.thaw();
      await window.__T.wait(0.6);
      return true;
    }],
    ['chain', async () => {
      const T = window.__T;
      const { R, log, W, P } = T;
      const out = {};
      out.lane = T.lane(25);
      await T.equip('sword');
      await T.clear();
      const swings = [];
      for (let i = 0; i < 3; i++) {
        const e = R.spawn('husk', 3.2);
        await T.frames(3);
        T.aim(e, false);
        const step = W.swordStep;
        const hp = e.health;
        const dealt0 = log.dealt;
        await T.tap('fire', 2);
        await T.frames(2);
        swings.push({ step, hp, dealt: Math.round(log.dealt - dealt0), alive: e.alive, slices: log.gore.slice, normal: log.lastSlice?.normal.map(n => Number(n.toFixed(2))) });
        await T.wait(0.28);
      }
      out.swings = swings;
      out.kills = [...log.kills];
      out.forward = P.forward.toArray().map(n => Number(n.toFixed(2)));
      out.slashes = log.fx.slash;
      out.stops = [...log.stops];
      return out;
    }, 'chain'],
    ['area', async () => {
      const T = window.__T;
      const { R, log, ctx } = T;
      const out = {};
      await T.wait(0.8);
      await T.clear();
      for (let i = -2; i <= 2; i++) R.spawn('husk', 5, i * 1.7);
      await T.frames(4);
      T.input.simulate('aim', true);
      await T.wait(0.4);
      await T.freezeAfter(async () => {
        T.input.simulate('aim', false);
        await T.frames(2);
      });
      out.frozenSlash = log.fx.slash;
      void ctx;
      return out;
    }, 'area'],
    ['area result', async () => {
      const T = window.__T;
      const { log } = T;
      T.thaw();
      await T.wait(0.6);
      return { kills: [...log.kills], gore: { ...log.gore }, slash: log.fx.slash, stops: [...log.stops] };
    }, 'area-after'],
    ['finisher', async () => {
      const T = window.__T;
      const { R, log, ctx } = T;
      const out = {};
      await T.wait(0.8);
      await T.clear();
      for (let i = -1; i <= 1; i++) R.spawn('brute', 6, i * 2);
      await T.frames(3);
      await T.tap('fire', 2);
      await T.wait(0.27);
      await T.tap('fire', 2);
      await T.wait(0.12);
      T.input.simulate('aim', true);
      await T.wait(0.2);
      T.input.simulate('aim', false);
      const t0 = ctx.time.realElapsed;
      while (!log.fx.explosion && ctx.time.realElapsed - t0 < 1.5) await T.frames(1);
      ctx.time.paused = true;
      await T.frames(2);
      out.delay = Number((ctx.time.realElapsed - t0).toFixed(2));
      out.blasts = log.fx.explosion;
      out.slam = log.sounds.sword_slam ?? 0;
      return out;
    }, 'finisher'],
    ['finisher result', async () => {
      const T = window.__T;
      const { log } = T;
      T.thaw();
      await T.wait(0.5);
      return { kills: [...log.kills], gore: { ...log.gore }, severed: [...log.severed], stops: [...log.stops] };
    }],
    ['parry', async () => {
      const T = window.__T;
      const { R, log, P } = T;
      const out = {};
      await T.wait(0.6);
      await T.clear();
      const e = R.spawn('trooper', 16);
      await T.frames(4);
      P.modifiers.invulnerable = false;
      const hp = P.health;
      const armor = P.armor;
      T.input.simulate('aim', true);
      await T.wait(6, () => { if (e.alive) T.aim(e, false); });
      T.input.simulate('aim', false);
      await T.frames(2);
      P.modifiers.invulnerable = true;
      out.result = { deflects: log.sounds.sword_deflect ?? 0, hurt: Number((hp - P.health + armor - P.armor).toFixed(1)), alive: e.alive, hits: log.hits, enemyShots: log.sounds.enemy_shoot ?? 0, kills: [...log.kills] };
      P.health = P.maxHealth;
      return out;
    }],
    ['lunge', async () => {
      const T = window.__T;
      const { R, log, P, ctx } = T;
      const out = {};
      T.thaw();
      T.lane(30);
      await T.equip('sword');
      await T.clear();
      const e = R.spawn('brute', 8.5);
      e.frozen = 2;
      await T.frames(3);
      T.aim(e, false);
      await T.frames(1);
      const from = P.position.clone();
      const start = e.position.distanceTo(P.position);
      T.input.simulate('fire', true);
      await T.frames(1);
      T.input.simulate('fire', false);
      let peak = 0;
      await T.wait(0.35, () => { peak = Math.max(peak, P.speed); });
      out.standing = { start: Number(start.toFixed(1)), moved: Number(from.distanceTo(P.position).toFixed(2)), peak: Number(peak.toFixed(1)), hits: log.hits };
      void ctx;
      return out;
    }],
    ['quick melee', async () => {
      const T = window.__T;
      const { R, log, W } = T;
      const out = {};
      await T.wait(0.6);
      await T.equip('smg');
      await T.clear();
      const a = W.ammo('smg');
      a.reserve = 0;
      const e = R.spawn('husk', 2.5);
      await T.frames(3);
      T.aim(e, false);
      await T.tap('melee', 2);
      await T.wait(0.5);
      out.result = { weapon: W.current, alive: e.alive, kills: [...log.kills], gore: { ...log.gore }, reserveFedBySwordKill: a.reserve };
      return out;
    }],
  ],

  perks: [
    ['bloodthirst', async () => {
      const T = window.__T;
      const { R, log, W, ctx } = T;
      const out = {};
      out.lane = T.lane(25);
      await T.equip('shotgun');
      await T.clear();
      ctx.progression.grant('bloodthirst');
      await T.frames(3);
      const m = W.modifiers;
      out.mods = { damage: m.damage, pellets: m.pellets, bottomless: m.bottomlessMag, tracer: m.tracer, layers: [...m.shotLayers] };
      const a = W.ammo('shotgun');
      const mag = a.mag;
      const e = R.spawn('brute', 6);
      await T.frames(3);
      await T.shoot(e, false);
      await T.frames(3);
      out.shot = { hits: log.hits, tracers: log.fx.tracer, mag0: mag, mag1: a.mag, sound: log.sounds.bloodthirsty_shot ?? 0, severed: [...log.severed] };
      return out;
    }, 'bloodthirst'],
    ['hellfire', async () => {
      const T = window.__T;
      const { R, log, W, ctx } = T;
      const out = {};
      await T.equip('smg');
      await T.clear();
      ctx.progression.grant('hellfire');
      await T.frames(3);
      const m = W.modifiers;
      out.mods = { explosive: m.explosiveRounds, radius: m.blastRadius, instakill: m.instakillBlast, tracer: m.tracer };
      const e = R.spawn('brute', 12);
      await T.frames(3);
      await T.hold('fire', e, false, 0.5);
      await T.frames(2);
      out.smg = { explosions: log.fx.explosion, hits: log.hits, dealt: Math.round(log.dealt), kills: [...log.kills] };
      await T.clear();
      await T.equip('rocket');
      W.ammo('rocket').mag = 1;
      const b = [R.spawn('brute', 16), R.spawn('trooper', 16, 12), R.spawn('husk', 16, -12)];
      await T.frames(3);
      await T.shoot(b[0], false);
      await T.wait(0.6);
      out.rocket = { kills: [...log.kills], explosions: log.fx.explosion, sound: log.sounds.hellfire_rocket_blast ?? 0, gibs: log.gore.gib };
      return out;
    }, 'hellfire'],
    ['berserk', async () => {
      const T = window.__T;
      const { R, log, W, ctx, P } = T;
      const out = {};
      await T.wait(5);
      await T.equip('smg');
      await T.clear();
      ctx.progression.grant('berserk');
      await T.frames(3);
      const m = W.modifiers;
      out.mods = { damage: m.damage, fireRate: m.fireRate, akimbo: m.akimbo, bottomless: m.bottomlessMag, speed: P.modifiers.speed, invulnerable: P.modifiers.invulnerable };
      let left = 0;
      let right = 0;
      const fire = ctx.viewmodel.fire.bind(ctx.viewmodel);
      ctx.viewmodel.fire = (s, l) => {
        if (l) left++;
        else right++;
        return fire(s, l);
      };
      await T.wait(0.4);
      const e = R.spawn('brute', 14);
      await T.frames(3);
      const t0 = ctx.time.playerElapsed;
      await T.hold('fire', e, false, 1.2);
      out.fire = { left, right, rps: Number(((left + right) / (ctx.time.playerElapsed - t0)).toFixed(1)), mag: W.ammo('smg').mag, kills: [...log.kills], severed: log.severed.length };
      T.input.simulate('fire', true);
      await T.wait(0.2, () => { if (e.alive) T.aim(e, false); });
      await T.freezeAfter(async () => { await T.frames(1); });
      return out;
    }, 'berserk'],
    ['thaw', async () => {
      const T = window.__T;
      T.thaw();
      T.input.simulate('fire', false);
      return true;
    }],
  ],

  view: [
    ['flash at speed', async () => {
      const T = window.__T;
      const { ctx, P, W, input } = T;
      const THREE_V = P.eye.constructor;
      const { render, viewmodel } = ctx;
      const out = {};
      T.lane(40);
      await T.equip('smg');
      await T.clear();

      const sock = new THREE_V();
      const p = new THREE_V();
      const mapped = pos => {
        const k = Math.tan((render.camera.fov * Math.PI) / 360) / Math.tan((render.viewCamera.fov * Math.PI) / 360);
        p.copy(pos).applyMatrix4(render.camera.matrixWorldInverse);
        p.x /= k;
        p.y /= k;
        return p.applyMatrix4(render.viewCamera.matrixWorld);
      };
      const toPx = (q, cam) => {
        const n = q.clone().project(cam);
        return [(n.x * 0.5 + 0.5) * innerWidth, (0.5 - n.y * 0.5) * innerHeight];
      };
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const samples = { oldPx: [], newPx: [], tracerPx: [], casingPx: [], speed: [], turn: [] };
      const flash = ctx.fx.muzzleFlash;
      const world = new THREE_V();
      ctx.fx.muzzleFlash = (pos, dir, kind, view) => {
        sock.setFromMatrixPosition(viewmodel.a.model.sockets.muzzle.matrixWorld);
        const socketPx = toPx(sock, render.viewCamera);
        samples.newPx.push(dist(toPx(mapped(pos), render.viewCamera), socketPx));
        viewmodel.muzzle(world, false);
        samples.oldPx.push(dist(toPx(mapped(world), render.viewCamera), socketPx));
        samples.speed.push(P.speed);
        return flash(pos, dir, kind, view);
      };
      // World-space starts have to line up with the gun on the frame that renders, after CameraRig has run.
      const pendingFrom = [];
      const tracer = ctx.fx.tracer;
      ctx.fx.tracer = (a, b, k) => {
        pendingFrom.push({ q: a.clone(), kind: 'tracerPx' });
        return tracer(a, b, k);
      };
      const casing = ctx.fx.shellCasing;
      ctx.fx.shellCasing = (a, b, k) => {
        pendingFrom.push({ q: a.clone(), kind: 'casingPx' });
        return casing(a, b, k);
      };
      let stop = false;
      const eject = new THREE_V();
      const check = () => {
        if (stop) return;
        requestAnimationFrame(check);
        // A rAF scheduled here runs before the game's next frame, so the camera is the one that drew these.
        if (!pendingFrom.length) return;
        sock.setFromMatrixPosition(viewmodel.a.model.sockets.muzzle.matrixWorld);
        const muzzlePx = toPx(sock, render.viewCamera);
        eject.setFromMatrixPosition(viewmodel.a.model.sockets.eject.matrixWorld);
        const portPx = toPx(eject, render.viewCamera);
        for (const f of pendingFrom) samples[f.kind].push(dist(toPx(f.q, render.camera), f.kind === 'tracerPx' ? muzzlePx : portPx));
        pendingFrom.length = 0;
      };
      requestAnimationFrame(check);

      const stats = a => {
        const s = [...a].sort((x, y) => x - y);
        const at = q => Number((s[Math.floor(q * (s.length - 1))] ?? 0).toFixed(1));
        return { n: s.length, median: at(0.5), p90: at(0.9), max: at(1) };
      };
      const phase = async (name, setup, seconds) => {
        for (const k in samples) samples[k].length = 0;
        setup?.();
        W.ammo('smg').mag = 30;
        input.simulate('fire', true);
        await T.wait(seconds, () => { if (name.includes('flick')) input.simulateLook(Math.sin(ctx.time.realElapsed * 9) * 60, 0); });
        input.simulate('fire', false);
        out[name] = { flashNew: stats(samples.newPx), flashOld: stats(samples.oldPx), tracer: stats(samples.tracerPx), casing: stats(samples.casingPx), speed: Number(stats(samples.speed).median) };
        await T.frames(2);
      };
      await phase('still', null, 0.6);
      input.simulate('forward', true);
      await T.wait(0.3);
      await phase('run forward', null, 0.5);
      input.simulate('forward', false);
      input.simulate('left', true);
      await T.wait(0.3);
      await phase('strafe left', null, 0.5);
      await phase('strafe + flick', null, 0.6);
      input.simulate('left', false);
      T.lane(40);
      input.simulate('forward', true);
      input.simulate('jump', true);
      await T.wait(0.3);
      T.P.velocity.x *= 2.4;
      T.P.velocity.z *= 2.4;
      await phase('air 40 m/s', null, 0.3);
      input.simulate('forward', false);
      input.simulate('jump', false);
      stop = true;
      ctx.fx.muzzleFlash = flash;
      ctx.fx.tracer = tracer;
      ctx.fx.shellCasing = casing;
      return out;
    }],
    ['strafe photo', async () => {
      const T = window.__T;
      const { ctx, input } = T;
      T.lane(40);
      input.simulate('left', true);
      await T.wait(0.4);
      input.simulate('fire', true);
      await T.wait(0.3);
      await T.freezeAfter(async () => { await T.frames(1); });
      void ctx;
      return { speed: Number(T.P.speed.toFixed(1)), muzzle: T.log.fx.muzzleFlash };
    }, 'strafe'],
    ['thaw', async () => {
      const T = window.__T;
      T.thaw();
      T.input.simulate('fire', false);
      T.input.simulate('left', false);
      await T.frames(2);
      return true;
    }],
  ],

  world: [
    ['barrels', async () => {
      const T = window.__T;
      const { R, ctx, log, P } = T;
      const out = {};
      const objects = ctx.world.objects;
      const list = objects.explosives.filter(e => e.kind === 'barrel' && e.alive);
      out.barrels = list.length;
      // The barrel with the most neighbours makes the best chain.
      let best = list[0];
      let bestN = -1;
      for (const b of list) {
        const n = list.filter(o => o !== b && o.pos.distanceTo(b.pos) < 7).length;
        if (n > bestN) {
          bestN = n;
          best = b;
        }
      }
      out.neighbours = bestN;
      const b = best;
      const dir = new (P.eye.constructor)();
      let stand = null;
      for (let i = 0; i < 16 && !stand; i++) {
        const yaw = (i / 16) * Math.PI * 2;
        dir.set(Math.sin(yaw), 0, Math.cos(yaw));
        const from = b.pos.clone();
        from.y += 1;
        const hit = ctx.physics.raycast(from.clone().addScaledVector(dir, 1.2), dir, 16);
        if (!hit) stand = from.clone().addScaledVector(dir, 16);
      }
      out.stand = stand?.toArray().map(n => Math.round(n));
      if (!stand) return out;
      P.teleport(stand.setY(stand.y - 0.9));
      await T.frames(5);
      await T.equip('smg');
      await T.clear();
      const husks = [];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        husks.push(ctx.enemies.spawn('husk', b.pos.clone().add(new (P.eye.constructor)(Math.cos(a) * 3, 0.2, Math.sin(a) * 3))));
      }
      await T.frames(2);
      const hp = P.health;
      R.aim(b.pos.x, b.pos.y + 0.6, b.pos.z);
      await T.frames(2);
      const counts = { fx: 0 };
      await T.hold('fire', null, false, 0.35);
      await T.wait(1.2);
      out.result = {
        barrelAlive: b.alive, explosionsByCombat: log.fx.explosion, sound: log.sounds.explosion_barrel ?? 0, kills: [...log.kills],
        hurt: Number((hp - P.health).toFixed(1)), left: objects.explosives.filter(e => e.kind === 'barrel' && e.alive).length, counts,
      };
      return out;
    }, 'barrels'],
    ['rocket chains barrels', async () => {
      const T = window.__T;
      const { ctx, log, P } = T;
      const out = {};
      const objects = ctx.world.objects;
      const list = objects.explosives.filter(e => e.alive);
      out.alive = list.length;
      if (!list.length) return out;
      const b = list[0];
      const dir = new (P.eye.constructor)();
      let stand = null;
      for (let i = 0; i < 16 && !stand; i++) {
        const yaw = (i / 16) * Math.PI * 2;
        dir.set(Math.sin(yaw), 0, Math.cos(yaw));
        const from = b.pos.clone();
        from.y += 1;
        if (!ctx.physics.raycast(from.clone().addScaledVector(dir, 1.5), dir, 20)) stand = from.clone().addScaledVector(dir, 20);
      }
      if (!stand) return out;
      P.teleport(stand.setY(stand.y - 0.9));
      await T.frames(5);
      await T.equip('rocket');
      T.W.ammo('rocket').mag = 1;
      await T.clear();
      T.R.aim(b.pos.x, b.pos.y + 0.6, b.pos.z);
      await T.frames(2);
      T.R.aim(b.pos.x, b.pos.y + 0.6, b.pos.z);
      await T.tap('fire', 2);
      await T.wait(1.2);
      out.result = { kind: b.kind, target: b.alive, rocketBlasts: log.fx.explosion, sound: log.sounds.explosion_barrel ?? 0, left: objects.explosives.filter(e => e.alive).length };
      return out;
    }],
    ['crane', async () => {
      const T = window.__T;
      const { ctx, P } = T;
      const out = {};
      const g = ctx.world.objects.gantries[0];
      if (!g) return { none: true };
      out.gantry = { x: Number(g.x.toFixed(1)), deck: g.deckY, z0: g.z0, z1: g.z1 };
      await T.clear();
      P.teleport(new (P.eye.constructor)(g.x, g.deckY + 0.3, (g.z0 + g.z1) / 2));
      await T.wait(0.6);
      const start = { px: P.position.x, gx: g.x, y: P.position.y, grounded: P.grounded };
      const peak = { v: 0 };
      await T.wait(3, () => { peak.v = Math.max(peak.v, Math.abs(g.vx)); });
      out.ride = {
        grounded: P.grounded, deckMoved: Number((g.x - start.gx).toFixed(2)), playerMoved: Number((P.position.x - start.px).toFixed(2)),
        drift: Number(((P.position.x - g.x) - (start.px - start.gx)).toFixed(3)), peakDeckSpeed: Number(peak.v.toFixed(2)), y: Number(P.position.y.toFixed(2)), velX: Number(P.velocity.x.toFixed(2)),
      };
      return out;
    }],
  ],
};

export default async function rangeLive(page, h) {
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => !!window.__range && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  await page.evaluate(prelude);
  await h.sleep(1500);
  const results = {};
  for (const [name, fn, shot] of groups.flatMap(g => GROUPS[g])) {
    if (only && !only.includes(name)) continue;
    try {
      results[name] = await page.evaluate(fn);
    } catch (e) {
      results[name] = { threw: String(e).slice(0, 400) };
    }
    if (shot) await h.shot(shot);
  }
  return results;
}
