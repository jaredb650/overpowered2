// What the whole gore update costs: one seeded bot fight, played in real time with every frame drawn, on any build.
//
//   node tools/shot.mjs --port <yours> --url "/?contract=crucible&autostart=1" --dpr 2 --w 1440 --h 900 --wait 0 --timeout 600 --quiet \
//     --script tools/scripts/gore-cost.mjs --out tools/out/<you>/cost.png
//
// The URL picks the mode (`contract=crucible` or `contract=outpost`, Endless Humans) and carries the update's switches
// (`GC_OFF` below is all of them off). The same command against a second worktree's Vite is "the game before".
//
// Two scenes (GC_SCENE):
//   worst   up to 48 alive, topped up at five a second, fought from one spot so the heap grows: SMG and shotgun, then
//           rockets and grenades into the crowd, then the Kiln, then bullets again; then a walk through the heap and back
//           with the crowd still coming. No Bombers, no Burners, no streak perks (they chain-react in a crowd this size).
//   normal  16 alive, SMG and shotgun with a rocket now and then, the player moving between two spots.
// The game's own waves are stopped and the bot spawns: the same kinds in the same order on every build (its own dice).
//
// The bot holds its fire while it is ahead of GC_KILLS kills a second (4 worst, 1.5 normal), so the crowd stays at its cap.
// Settings: GC_SECONDS (fight, default 75 worst / 50 normal), GC_WALK (default 15 worst / 0), GC_ALIVE, GC_LABEL (file name),
// GC_THROTTLE (Chrome's CPU throttling rate: 4, 6; default 1), GC_QUALITY (0 Low .. 3 Ultra; default the game's), GC_MESS
// (0 Low .. 3 Everything), GC_EVAL (JS run in the page before the fight), GC_SEED, GC_BENCH=0 skips the frame bench at the end,
// GC_DRS=1 leaves dynamic resolution on (off under automation by default), GC_SHOT=0 no picture.
//
// Writes <outDir>/cost.<label>.json and returns its summary:
//   frames   interval between frames (what a player feels), the game's whole script time a frame, the physics step, the
//            gore update, render() and the GPU's own time for the frame (EXT_disjoint_timer_query), each mean / median /
//            95th / 99th / worst; frames over 16.9, 33.4 and 50 ms; draw calls and triangles
//   phases   the same for the fight and for the walk
//   counts   what was on the floor at the end (bodies, baked bodies, limbs, pieces, decals by ring, colliders)
//   memory   GPU bytes by kind (webgl-memory), textures, the JS heap after a collection
//   bench    one fixed view of the heap drawn 30 times between GPU waits, whole and with one thing taken out at a time
//            (decals, shadows, the gun, the transparent pass's particles), in ms a frame: what each is worth to the GPU
// Timings taken while the machine is busy prove nothing: check `uptime`, run each build in turn, more than once.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadavg } from 'node:os';
import * as glmem from './lib/glmem.mjs';
import { mulberry32 } from './lib/steady.mjs';

/** Every switch of the gore update, off: append to a URL for "the update off". */
export const GC_OFF = 'flinch=0&clutch=0&carry=0&aimspoil=0&sway=0&gibthrow=0&fire=0&messrest=0&messpush=0&messfar=0&bigblood=0&hitblood=0&bloodmap=0&wear=0&vmblood=0&dryflesh=0';

const SCENE = process.env.GC_SCENE ?? 'worst';
const WORST = SCENE !== 'normal';
const SECONDS = Number(process.env.GC_SECONDS ?? (WORST ? 75 : 50));
const WALK = Number(process.env.GC_WALK ?? (WORST ? 15 : 0));
const ALIVE = Number(process.env.GC_ALIVE ?? (WORST ? 48 : 16));
const LABEL = process.env.GC_LABEL ?? 'run';
const THROTTLE = Number(process.env.GC_THROTTLE ?? 1);
const SEED = Number(process.env.GC_SEED ?? 1);

export const before = async page => {
  await glmem.inject(page);
  await page.addInitScript(`Math.random = (${mulberry32})(${SEED});`);
  await page.addInitScript(([quality, mess]) => {
    if (sessionStorage.getItem('gc.set')) return;
    sessionStorage.setItem('gc.set', '1');
    localStorage.clear();
    const s = { music: 0 };
    if (quality !== null) s.quality = quality;
    if (mess !== null) s.mess = mess;
    localStorage.setItem('op2.settings.v1', JSON.stringify(s));
    localStorage.setItem('op2.played.v1', '1');
  }, [process.env.GC_QUALITY === undefined ? null : Number(process.env.GC_QUALITY), process.env.GC_MESS === undefined ? null : Number(process.env.GC_MESS)]);
};

/** In the page: the bot and the recorder. */
async function install({ worst, aliveCap, drs, killRate, fightSeconds }) {
  const { ctx, game } = window.__op2;
  const r = ctx.render;
  const P = ctx.player;
  const V = P.eye.constructor;
  const humans = /contract=outpost/.test(location.search);
  if (!drs) r.dynamicResolution.enabled = false;
  ctx.waves.update = () => {};
  ctx.waves.start = () => {};
  P.modifiers.invulnerable = true;
  ctx.weapons.modifiers.bottomlessMag = true;
  try {
    const data = await import('/src/progression/data.ts');
    for (const table of Object.values(data)) if (table && typeof table === 'object' && 'dropChance' in table) table.dropChance = 0;
    // No streak perks either: with a bottomless magazine the run's own escalation (burning and explosive rounds) killed
    // fourteen a second by chain reaction, and the scene was the perks', not the bot's.
    (await import('/src/core/devflags.ts')).DevFlags.progression = false;
  } catch { /* a production build: drops and perks stay */ }
  // The gore update's automatic step-down, where the build has one (gore/load.ts): its step is in every snapshot.
  let load = null;
  try {
    load = (await import('/src/gore/load.ts')).GoreLoad;
  } catch { /* a build from before it */ }
  for (const id of ['smg', 'shotgun', 'rocket', 'kiln']) if (!ctx.weapons.owned.has(id)) ctx.weapons.give(id);
  for (const e of [...ctx.enemies.alive]) ctx.enemies.applyDamage(e, { amount: 99999, type: 'true', point: e.center.clone(), dir: new V(0, 0, 1), force: 0, source: 'smg' });

  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const hitOf = () => ({ point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null });
  const ground = (x, y, z) => {
    const h = hitOf();
    return ctx.physics.raycastInto(new V(x, y + 1.5, z), new V(0, -1, 0), 40, 1, h) ? h.point.clone() : new V(x, y, z);
  };
  const views = ctx.world.spec.views ?? {};
  const view = views.core_floor ?? views.court ?? views.yard ?? null;
  const origin = view ? new V(...view.pos) : P.position.clone();
  // Faces down the longest clear line from the spot, so the crowd has room to come.
  let heading = 0;
  let longest = 0;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const h = hitOf();
    const d = ctx.physics.raycastInto(new V(origin.x, origin.y + 1, origin.z), new V(Math.sin(a), 0, Math.cos(a)), 40, 1, h) ? h.distance : 40;
    if (d > longest) {
      longest = d;
      heading = a;
    }
  }
  const fwd = new V(Math.sin(heading), 0, Math.cos(heading));
  const side = new V(fwd.z, 0, -fwd.x);
  const home = ground(origin.x, origin.y, origin.z);
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  const along = (d, s = 0) => ground(origin.x + fwd.x * d + side.x * s, origin.y, origin.z + fwd.z * d + side.z * s);
  const reach = Math.min(longest - 1.5, 17);
  const heapAt = along(Math.min(4, reach * 0.4));
  const look = t => {
    const d = new V().subVectors(t, P.eye);
    P.yaw = Math.atan2(-d.x, -d.z);
    P.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  };
  P.teleport(home, yaw);

  const KINDS = humans
    ? ['trooper', 'trooper', 'gunner', 'trooper', 'riot', 'trooper', 'rocketeer', 'trooper', 'gunner', 'sniper', 'trooper', 'brute']
    : ['husk', 'husk', 'leaper', 'husk', 'trooper', 'husk', 'gunner', 'husk', 'stalker', 'husk', 'husk', 'brute'];
  // No Bombers and no Burners: in a crowd kept at 48 they set each other off, and the chain did the killing (seven of
  // every eight deaths in a trial), at fourteen a second, whatever the bot did.
  const born = new WeakMap();
  const put = new WeakSet();
  const bot = { phase: 'idle', t: 0, phaseT: 0, spawned: 0, weapon: '', switchT: 0, held: false, lastSpawn: -9, forced: 0, grenadeT: -9, nade: 0, leg: 0 };
  const rec = { frames: [], marks: [], snaps: [], gpu: [], disjoint: 0, errors: [] };
  // What the game's own frame guard swallowed (it reports each stage's first error and plays on): a run with any is not a measurement.
  const guard = game.guard;
  game.guard = (name, fn) => guard(name, () => {
    try {
      fn();
    } catch (e) {
      if (rec.errors.length < 12) rec.errors.push([name, rec.frames.length, String(e?.stack ?? e).slice(0, 700)]);
      throw e;
    }
  });
  // Who is doing the killing, by the damage's type and source: the bot's own guns, or the crowd's own blasts and fire.
  const deaths = {};
  ctx.events.on('enemy:killed', ev => {
    const d = ev?.damage ?? ev?.info ?? {};
    const key = `${d.type ?? '?'}/${d.source ?? '?'}`;
    deaths[key] = (deaths[key] ?? 0) + 1;
  });
  const fire = on => {
    if (bot.held === on) return;
    bot.held = on;
    ctx.input.simulate('fire', on);
  };
  // What the bot holds. The worst scene goes through every heavy thing in turn, as shares of the fight: bullets and
  // pellets (bodies, limbs, blood: the heap), then rockets and grenades into the crowd (pieces), then the Kiln (a crowd
  // alight: in this game a burning man lights whoever he brushes past, so it spreads by itself), then bullets again
  // while it burns out. In turn and not mixed, because once the crowd is alight the fire does the killing on any build.
  const wantWeapon = t => {
    if (worst) {
      const f = t / fightSeconds;
      if (f < 0.3 || f >= 0.7) return t % 10 < 7 ? 'smg' : 'shotgun';
      return f < 0.54 ? 'rocket' : 'kiln';
    }
    const c = t % 20;
    return c < 11 ? 'smg' : c < 18 ? 'shotgun' : 'rocket';
  };
  const blasting = t => worst && t / fightSeconds >= 0.3 && t / fightSeconds < 0.54;
  const spawn = () => {
    const near = 11;
    const at = along(near + rnd() * Math.max(1, reach - near), (rnd() - 0.5) * (worst ? 7 : 9));
    const e = ctx.enemies.spawn(KINDS[bot.spawned % KINDS.length], at);
    if (e) {
      bot.spawned++;
      born.set(e, bot.t);
    }
  };
  const step = dt => {
    if (bot.phase === 'idle') return;
    bot.t += dt;
    bot.phaseT += dt;
    const alive = ctx.enemies.alive;
    // The crowd is filled to its cap at once, then topped up at five a second (two in the normal scene), 11 m out and
    // beyond. Faster than that and the game's own rule that a burning man lights whoever he brushes past turns one
    // grenade into a wildfire that kills fourteen a second through a crowd refilled beside it: a machine's fight.
    const filling = bot.spawned < aliveCap;
    if (alive.length < aliveCap && (filling || bot.t - bot.lastSpawn > (worst ? 0.2 : 0.5))) {
      spawn();
      bot.lastSpawn = bot.t;
    }
    if (bot.phase === 'fight') {
      if (worst) {
        if (P.position.distanceTo(home) > 0.6) P.teleport(home, P.yaw);
      } else {
        // Normal play: back and forth across the hall, six seconds a leg.
        const leg = Math.floor(bot.phaseT / 6) % 2;
        const to = along(leg ? 1.5 : 0, leg ? 3.5 : -3.5);
        const d = new V().subVectors(to, P.position);
        d.y = 0;
        const local = d.length() > 0.6 ? d.normalize() : null;
        // Strafes toward the leg's end while facing the fight.
        const right = new V(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
        const front = new V(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
        ctx.input.simulate('right', !!local && local.dot(right) > 0.3);
        ctx.input.simulate('left', !!local && local.dot(right) < -0.3);
        ctx.input.simulate('forward', !!local && local.dot(front) > 0.3);
        ctx.input.simulate('back', !!local && local.dot(front) < -0.3);
      }
      let target = null;
      let best = 99;
      let crowd = null;
      let most = -1;
      for (const e of alive) {
        const d = e.center.distanceTo(P.eye);
        if (d < best) {
          best = d;
          target = e;
        }
        // One the bot cannot kill in a fair time (behind a pillar, off the nav) is put down, or the cap fills with them.
        // Once each, through the head: a man with anatomy (Endless Humans) does not die of his health running out, and a
        // round a frame into one who would not die was 2,200 extra hits a run.
        if (bot.t - (born.get(e) ?? bot.t) > 14 && !put.has(e)) {
          put.add(e);
          ctx.enemies.applyDamage(e, { amount: 9999, type: 'bullet', region: 'head', point: e.center.clone(), dir: fwd.clone(), force: 60, source: 'smg' });
          bot.forced++;
        }
      }
      // The bot is an aimbot with a bottomless magazine: left alone it kills 17 a second, which no player does. It holds its
      // fire while it is ahead of `killRate` (4 a second in the worst scene: a rocket's worth, then a pause), so the crowd
      // stays at its cap and the pace is a very good player's, not a machine's.
      const ahead = bot.spawned - alive.length > bot.phaseT * killRate + 6;
      const want = wantWeapon(bot.t);
      if (want !== bot.weapon) {
        bot.weapon = want;
        bot.switchT = bot.t + 0.55;
        ctx.weapons.switchTo(want);
        fire(false);
      }
      if (bot.weapon === 'rocket' || (blasting(bot.t) && bot.t - bot.grenadeT > 4)) {
        // Into the thickest of them: whoever has most neighbours within 3 m.
        for (const e of alive) {
          let n = 0;
          for (const o of alive) if (o !== e && Math.hypot(o.position.x - e.position.x, o.position.z - e.position.z) < 3) n++;
          const d = e.center.distanceTo(P.eye);
          if (d > 5 && n > most) {
            most = n;
            crowd = e;
          }
        }
      }
      if (blasting(bot.t) && crowd && !ahead && bot.t - bot.grenadeT > 4 && bot.t >= bot.switchT) {
        look(new V(crowd.position.x, crowd.position.y + 1.6, crowd.position.z));
        ctx.weapons.addGrenades?.(1);
        bot.nade = 3;
        bot.grenadeT = bot.t;
      }
      if (bot.nade > 0) {
        // The throw is an edge: down for a frame, then up.
        ctx.input.simulate('grenade', bot.nade === 3);
        bot.nade--;
      } else if (target && bot.t >= bot.switchT && !ahead) {
        const aim = bot.weapon === 'rocket' && crowd ? crowd : target;
        look(bot.weapon === 'rocket' ? new V(aim.position.x, aim.position.y + 0.15, aim.position.z) : aim.center);
        fire(bot.weapon === 'smg' || bot.weapon === 'kiln' || Math.floor(bot.t * 7.5) % 2 === 0);
      } else {
        fire(false);
        if (!target) look(heapAt.clone().add(new V(0, 0.9, 0)));
      }
    } else if (bot.phase === 'walk') {
      // Out through the heap and back, eyes on the floor ahead: bodies pushed aside, the stains under the feet.
      fire(false);
      const out = Math.floor(bot.phaseT / 5) % 2 === 0;
      const to = out ? along(Math.min(8, reach * 0.8)) : home;
      const d = new V().subVectors(to, P.position);
      d.y = 0;
      if (d.length() > 0.5) {
        P.yaw = Math.atan2(-d.x, -d.z);
        P.pitch = -0.45;
        ctx.input.simulate('forward', true);
      } else ctx.input.simulate('forward', false);
    }
  };

  // The GPU's own clock for the frame: one elapsed-time query round render(), read back when it is ready.
  const gl = r.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending = [];
  const pollGpu = () => {
    if (!ext) return;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) rec.disjoint++;
    while (pending.length && gl.getQueryParameter(pending[0][0], gl.QUERY_RESULT_AVAILABLE)) {
      const [q, index] = pending.shift();
      const frame = rec.frames[index];
      if (frame) frame[8] = Math.round(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e4) / 100;
      gl.deleteQuery(q);
    }
  };
  let renderMs = 0;
  const render = r.render.bind(r);
  r.render = () => {
    const q = ext && bot.phase !== 'idle' && pending.length < 8 ? gl.createQuery() : null;
    if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    const t0 = performance.now();
    render();
    renderMs = performance.now() - t0;
    if (q) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push([q, rec.frames.length]);
    }
  };
  let goreMs = 0;
  const goreUpdate = ctx.gore.update.bind(ctx.gore);
  ctx.gore.update = () => {
    const t0 = performance.now();
    goreUpdate();
    goreMs = performance.now() - t0;
  };
  let last = 0;
  const inner = game.frame.bind(game);
  game.frame = (...a) => {
    const now = performance.now();
    const t0 = now;
    step(ctx.time.realDt ?? 1 / 60);
    const out = inner(...a);
    if (bot.phase !== 'idle') {
      pollGpu();
      const info = r.renderer.info.render;
      rec.frames.push([last ? Math.round((now - last) * 100) / 100 : 16.67, Math.round((performance.now() - t0) * 100) / 100, Math.round(ctx.physics.stepMs * 100) / 100,
        Math.round(goreMs * 100) / 100, Math.round(renderMs * 100) / 100, r.drawCalls?.() ?? info.calls, r.triangles?.() ?? info.triangles, ctx.enemies.alive.length, -1]);
    }
    last = now;
    return out;
  };

  const counts = () => {
    let g = {};
    try {
      g = ctx.gore.stats();
    } catch (e) {
      if (rec.errors.length < 12) rec.errors.push(['stats', rec.frames.length, String(e?.message ?? e).slice(0, 200)]);
    }
    const d = r.decals;
    const world = ctx.physics.world;
    const ring = name => (d.live ? d.live(name) : undefined);
    return {
      deaths: { ...deaths }, t: Math.round(bot.t * 10) / 10, spawned: bot.spawned, kills: bot.spawned - ctx.enemies.alive.length, forced: bot.forced, alive: ctx.enemies.alive.length,
      corpses: g.corpses, far: g.far ?? 0, ragdolls: g.ragdolls, limbs: g.limbs, liveLimbs: g.liveLimbs, pieces: g.chunkBodies, halves: g.halves, guts: g.guts,
      decals: d.total ?? d.mesh.count, rings: d.live ? { floor: ring('floor'), scorch: ring('scorch'), big: ring('big'), blood: ring('blood'), mark: ring('mark') } : undefined,
      burning: ctx.gore.fire?.list?.length ?? ctx.gore.fire?.count ?? undefined,
      rigidBodies: world.bodies.len(), colliders: world.colliders.len(), resting: ctx.gore.mess?.stats?.().resting,
      ease: load?.ease, resolution: r.dynamicResolution?.scale,
      geometries: r.renderer.info.memory.geometries, textures: r.renderer.info.memory.textures, programs: r.renderer.info.programs?.length ?? 0,
      size: r.renderSize?.(),
    };
  };

  // A real GPU wait: a one-pixel read queued behind the work.
  const fbo = gl.createFramebuffer();
  const tex = gl.createTexture();
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
  const px = new Uint8Array(4);
  const sync = () => {
    const f = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  };
  /** ms a frame for `n` frames drawn back to back and waited for: CPU submission and GPU together, best of `rounds`. */
  const timeDraw = (n = 30, rounds = 4) => {
    let bestOf = Infinity;
    for (let k = 0; k < rounds; k++) {
      sync();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) render();
      sync();
      bestOf = Math.min(bestOf, (performance.now() - t0) / n);
    }
    return Math.round(bestOf * 100) / 100;
  };
  /**
   * The world stopped, one view, drawn whole and with one thing out at a time. `eye`: from where the player fought, at the
   * heap. `down`: standing in the heap looking at the floor, where stains stack deepest on screen.
   */
  const bench = which => {
    const cam = r.camera;
    const keep = { p: cam.position.clone(), q: cam.quaternion.clone() };
    if (which === 'down') {
      cam.position.set(heapAt.x - fwd.x * 0.6, heapAt.y + 1.7, heapAt.z - fwd.z * 0.6);
      cam.lookAt(heapAt.x + fwd.x * 1.4, heapAt.y, heapAt.z + fwd.z * 1.4);
    } else {
      cam.position.set(home.x, home.y + 1.7, home.z);
      cam.lookAt(heapAt.x, heapAt.y + 0.2, heapAt.z);
    }
    cam.updateMatrixWorld(true);
    const out = { whole: timeDraw() };
    out.calls = r.drawCalls?.();
    out.tris = r.triangles?.();
    const passes = r.passes;
    const without = (name, off, on) => {
      off();
      out[name] = Math.round((out.whole - timeDraw()) * 100) / 100;
      on();
    };
    if (passes) {
      without('decals', () => { passes.decals = false; }, () => { passes.decals = true; });
      without('shadows', () => { passes.shadows = false; }, () => { passes.shadows = true; });
    }
    without('gun', () => { r.viewScene.visible = false; }, () => { r.viewScene.visible = true; });
    // Everything skinned or instanced that is not the map: bodies, limbs, pieces, the far batch.
    const hidden = [];
    r.scene.traverse(o => {
      if (o.visible && (o.isSkinnedMesh || (o.isInstancedMesh && o !== r.decals.mesh))) hidden.push(o);
    });
    without('bodiesAndPieces', () => { for (const o of hidden) o.visible = false; }, () => { for (const o of hidden) o.visible = true; });
    const clear = [];
    r.scene.traverse(o => {
      if (o.visible && o.material && !Array.isArray(o.material) && o.material.transparent && (o.isPoints || o.isMesh) && o !== r.decals.mesh) clear.push(o);
    });
    without('transparent', () => { for (const o of clear) o.visible = false; }, () => { for (const o of clear) o.visible = true; });
    out.whole2 = timeDraw();
    cam.position.copy(keep.p);
    cam.quaternion.copy(keep.q);
    cam.updateMatrixWorld(true);
    return out;
  };

  window.__gc = {
    start: phase => {
      bot.phase = phase;
      bot.phaseT = 0;
      rec.marks.push([phase, rec.frames.length]);
      if (phase !== 'fight') for (const k of ['left', 'right', 'forward', 'back']) ctx.input.simulate(k, false);
    },
    stop: () => {
      fire(false);
      for (const k of ['left', 'right', 'forward', 'back', 'grenade']) ctx.input.simulate(k, false);
      bot.phase = 'idle';
    },
    snap: () => rec.snaps.push(counts()),
    counts, bench,
    result: () => ({ frames: rec.frames, marks: rec.marks, snaps: rec.snaps, errors: rec.errors, disjoint: rec.disjoint, timer: !!ext, humans, state: game.state, gpu: (() => { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; })() }),
    // The fight goes on while pictures are taken only if nobody stops it; the bench needs the world still.
    freeze: on => {
      if (on) {
        window.__gcRaf = window.__gcRaf ?? window.requestAnimationFrame;
        game.__held = game.frame;
        game.frame = () => {};
      } else if (game.__held) game.frame = game.__held;
    },
  };
  return { home: home.toArray(), reach, humans, view: view ? 'view' : 'player', timer: !!ext };
}

const q = (sorted, f) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] : 0);
const round = v => Math.round(v * 100) / 100;
function spread(values) {
  const list = values.filter(v => v >= 0).sort((a, b) => a - b);
  if (!list.length) return null;
  return { mean: round(list.reduce((s, v) => s + v, 0) / list.length), median: q(list, 0.5), p95: q(list, 0.95), p99: q(list, 0.99), worst: list.at(-1) };
}
function summarise(frames) {
  const col = i => frames.map(f => f[i]);
  const intervals = col(0);
  const total = intervals.reduce((s, v) => s + v, 0);
  return {
    frames: frames.length, seconds: round(total / 1000), fps: total ? round(frames.length / (total / 1000)) : 0,
    intervalMs: spread(intervals), scriptMs: spread(col(1)), physicsMs: spread(col(2)), goreMs: spread(col(3)), renderMs: spread(col(4)), gpuMs: spread(col(8)),
    over: { ms17: intervals.filter(v => v > 16.9).length, ms33: intervals.filter(v => v > 33.4).length, ms50: intervals.filter(v => v > 50).length },
    drawCalls: spread(col(5)), triangles: spread(col(6)), alive: spread(col(7)),
  };
}

export default async function (page, { sleep, outDir }) {
  const origin = new URL(page.url()).origin;
  const url = new URL(page.url());
  const t0 = Date.now();
  await page.waitForFunction(() => window.__op2?.game?.state === 'playing', null, { timeout: 180000 });
  const loadMs = Date.now() - t0;
  await sleep(1500);
  if (process.env.GC_EVAL) await page.evaluate(process.env.GC_EVAL);
  const setup = await page.evaluate(install, { worst: WORST, aliveCap: ALIVE, drs: process.env.GC_DRS === '1', killRate: Number(process.env.GC_KILLS ?? (WORST ? 4 : 1.5)), fightSeconds: SECONDS });
  const cdp = await page.context().newCDPSession(page);
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const load = { start: loadavg()[0] };
  await page.evaluate(() => window.__gc.start('fight'));
  for (let s = 0; s < SECONDS; s += 5) {
    await sleep(Math.min(5, SECONDS - s) * 1000);
    await page.evaluate(() => window.__gc.snap());
  }
  if (WALK > 0) {
    await page.evaluate(() => window.__gc.start('walk'));
    for (let s = 0; s < WALK; s += 5) {
      await sleep(Math.min(5, WALK - s) * 1000);
      await page.evaluate(() => window.__gc.snap());
    }
  }
  load.end = loadavg()[0];
  await page.evaluate(() => window.__gc.stop());
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.detach();
  await sleep(300);
  const raw = await page.evaluate(() => window.__gc.result());
  const counts = await page.evaluate(() => window.__gc.counts());
  const mem = await glmem.sample(page);
  const groups = await glmem.groups(page);
  const biggest = Object.entries(groups).map(([k, n]) => { const [kind, size] = k.split(' '); return { kind, mb: round(Number(size) / 1048576), n, totalMb: round(Number(size) * n / 1048576) }; }).sort((a, b) => b.totalMb - a.totalMb).slice(0, 14);
  let bench = null;
  if (process.env.GC_BENCH !== '0') {
    await page.evaluate(() => window.__gc.freeze(true));
    bench = { eye: await page.evaluate(() => window.__gc.bench('eye')), down: await page.evaluate(() => window.__gc.bench('down')) };
    await page.evaluate(() => window.__gc.freeze(false));
  }
  const frames = raw.frames;
  const mark = name => raw.marks.find(m => m[0] === name)?.[1];
  const walkFrom = mark('walk') ?? frames.length;
  // The first five seconds are the crowd arriving and programs linking: reported apart.
  let acc = 0;
  let warm = 0;
  while (warm < frames.length && acc < 5000) acc += frames[warm++][0];
  const result = {
    label: LABEL, scene: SCENE, mode: raw.humans ? 'humans' : 'crucible', url: url.pathname + url.search, origin, throttle: THROTTLE,
    quality: process.env.GC_QUALITY ?? 'default', mess: process.env.GC_MESS ?? 'default', gpu: raw.gpu, machineLoad: load, loadMs, setup,
    all: summarise(frames.slice(warm)),
    fight: summarise(frames.slice(warm, walkFrom)),
    walk: walkFrom < frames.length ? summarise(frames.slice(walkFrom)) : null,
    firstFive: summarise(frames.slice(0, warm)),
    lastTwenty: (() => { let a = 0; let i = walkFrom; while (i > warm && a < 20000) a += frames[--i][0]; return summarise(frames.slice(i, walkFrom)); })(),
    counts, snaps: raw.snaps,
    memory: { heapMB: round((mem.heap ?? 0) / 1048576), gpuMB: round(mem.gpuTotal / 1048576), textureMB: round(mem.gpuTexture / 1048576), bufferMB: round(mem.gpuBuffer / 1048576), renderbufferMB: round(mem.gpuRenderbuffer / 1048576), textures: mem.nTexture, buffers: mem.nBuffer, programs: mem.nProgram, biggest },
    bench, errors: raw.errors, disjoint: raw.disjoint, timer: raw.timer, state: raw.state,
  };
  writeFileSync(join(outDir, `cost.${LABEL}.json`), JSON.stringify({ ...result, raw: frames }));
  const { snaps, ...short } = result;
  return short;
}
