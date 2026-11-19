// The mess, judged: a seeded bot fight in the Crucible that kills 30, 60 and 150 on one spot with the real guns (SMG,
// shotgun and a rocket every twelfth kill), stops at each to photograph the floor, then walks the player through the heap.
//
//   node tools/shot.mjs --port <yours> --url "/?autostart=1" --dpr 2 --w 1440 --h 900 --wait 0 --timeout 1500 --quiet \
//     --script tools/scripts/mess-fight.mjs --out tools/out/<you>/last.png
//
// Frozen clock and seeded dice (tools/scripts/lib/steady.mjs), so the same build gives the same fight, and an old and a new
// build fight the same enemies in the same order. Writes into MESS_DIR (tools/out/mess), every name starting MESS_TAG:
//   <tag>-kills<N>-eye.png, -high.png   stills at each stop: from where the player stands, and from above
//   <tag>-fight.png                     contact sheet of the stops, eye and high
//   <tag>-walk.png                      contact sheet of the walk through the heap (and the frames it was made from)
//   <tag>-walk-after.png                the heap after the walk, from above
//   <tag>.json                          the numbers at each stop: corpses, heap height, decals, pieces, bodies in the physics
//                                       world, draw calls, triangles, and what a frame costs to draw (rendered between GPU
//                                       syncs, timed from outside the page because its clock is frozen)
//
// Settings: MESS_STOPS (30,60,150), MESS_SEED (1), MESS_SPOT (core_floor), MESS_URL_NOTE (free text kept in the json),
// MESS_WALK=0 skips the walk, MESS_EVAL is run in the page before the fight (set a tuning value, a setting).
// MESS_LIVE=1 runs on the real clock instead (no pictures worth keeping; frame intervals, the physics step and the gore
// update in the json: what the fight costs to run, which a frozen clock cannot say).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as steady from './lib/steady.mjs';
import { layout, sheetHtml } from '../lib/sheet-layout.mjs';

const STOPS = (process.env.MESS_STOPS ?? '30,60,150').split(',').map(Number);
const SEED = Number(process.env.MESS_SEED ?? 1);
const SPOT = process.env.MESS_SPOT ?? 'core_floor';
const DIR = resolve(process.env.MESS_DIR ?? 'tools/out/mess');
const TAG = process.env.MESS_TAG ?? 'mess';
const LIVE = process.env.MESS_LIVE === '1';
const WALK = process.env.MESS_WALK !== '0';
// MESS_CHOKE=1: a chokepoint. They come down one line, are shot as they reach the spot, and no rocket scatters them: how
// high a heap gets. Without it, a fight: they die over a few metres of floor and every twelfth is a rocket.
const CHOKE = process.env.MESS_CHOKE === '1';

export const before = page => (LIVE ? undefined : steady.install(page, { seed: SEED }));

/** Runs in the page: the bot, and the cameras and counters the script asks for. */
async function install({ spot, live, choke }) {
  const { ctx, game } = window.__op2;
  const r = ctx.render;
  const P = ctx.player;
  const V = P.eye.constructor;
  r.dynamicResolution.enabled = false;
  ctx.waves.update = () => {};
  ctx.waves.start = () => {};
  P.modifiers.invulnerable = true;
  ctx.weapons.modifiers.bottomlessMag = true;
  // Nothing drops: a health box picked up on the walk turns the whole picture green.
  const data = await import('/src/progression/data.ts');
  for (const table of Object.values(data)) if (table && typeof table === 'object' && 'dropChance' in table) table.dropChance = 0;
  for (const id of ['smg', 'shotgun', 'rocket']) if (!ctx.weapons.owned.has(id)) ctx.weapons.give(id);
  // The HUD is hidden by a rule, not on the element: the game shows and hides that itself.
  const css = document.createElement('style');
  css.textContent = '.hud { visibility: hidden !important; }';
  document.head.appendChild(css);
  // The bot's own dice: the page's are shared with everything else, and the bot must ask for the same enemies whatever a
  // build does with its own.
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
  const view = ctx.world.spec.views[spot];
  const origin = new V(...view.pos);
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
  /** Where the fighting is: the enemies come down the hall at the player and die on the way. */
  const killSpot = along(3.6);
  const look = t => {
    const d = new V().subVectors(t, P.eye);
    P.yaw = Math.atan2(-d.x, -d.z);
    P.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  };
  P.teleport(home, yaw);

  const KINDS = ['husk', 'trooper', 'husk', 'gunner', 'husk', 'leaper', 'husk', 'husk', 'trooper', 'husk', 'husk', 'brute'];
  const born = new WeakMap();
  const bot = {
    phase: 'idle', spawned: 0, kills: 0, goal: 0, weapon: 'smg', switchAt: 0, frame: 0, lastSpawn: -99, held: false,
    walkFrom: null, walkTo: null, stuck: 0, forced: 0,
    // What a frame of the fight costs, live runs only: frame intervals, the physics step and the gore update, in ms.
    intervals: [], physics: [], gore: [], last: 0,
  };
  const wantWeapon = () => (!choke && bot.kills % 12 === 11 ? 'rocket' : bot.kills % 4 === 3 ? 'shotgun' : 'smg');
  const fire = on => {
    if (bot.held === on) return;
    bot.held = on;
    ctx.input.simulate('fire', on);
  };
  const step = () => {
    bot.frame++;
    const alive = ctx.enemies.alive;
    bot.kills = bot.spawned - alive.length;
    if (bot.phase === 'fight') {
      // Stays put: the heap is to grow on one spot.
      if (P.position.distanceTo(home) > 0.6) P.teleport(home, P.yaw);
      if (bot.spawned < bot.goal && alive.length < 9 && bot.frame - bot.lastSpawn >= 10) {
        const at = along(12 + rnd() * 5, (rnd() - 0.5) * (choke ? 1 : 4));
        const e = ctx.enemies.spawn(KINDS[bot.spawned % KINDS.length], at);
        bot.lastSpawn = bot.frame;
        if (e) {
          bot.spawned++;
          born.set(e, bot.frame);
        }
      }
      let target = null;
      let best = 99;
      for (const e of alive) {
        const d = e.center.distanceTo(P.eye);
        // Shot as they come within 6 m (at a chokepoint, as they reach the spot), so they fall on one place. One that hangs
        // back to shoot is shot where it stands after four seconds.
        const reached = choke ? Math.hypot(e.position.x - killSpot.x, e.position.z - killSpot.z) < 1.3 || d < 3 : d <= 6;
        if (!reached && bot.frame - (born.get(e) ?? 0) < 250) continue;
        if (d < best) {
          best = d;
          target = e;
        }
      }
      const want = wantWeapon();
      if (want !== bot.weapon) {
        bot.weapon = want;
        bot.switchAt = bot.frame + 34;
        ctx.weapons.switchTo(want);
        fire(false);
      }
      if (target && bot.frame >= bot.switchAt) {
        // A rocket at the feet takes the men beside him and the dead under them.
        look(bot.weapon === 'rocket' ? new V(target.position.x, target.position.y + 0.15, target.position.z) : target.center);
        // The SMG is held down. The shotgun and the launcher fire once a pull, so the trigger is pulled again and again.
        fire(bot.weapon === 'smg' || bot.frame % 8 < 4);
        // One that cannot be reached (behind a pillar, off the nav) would hold the fight up for good.
        if (bot.frame - (born.get(target) ?? 0) > 700) {
          ctx.enemies.applyDamage(target, { amount: target.health + 1, type: 'bullet', point: target.center.clone(), dir: fwd.clone(), force: 0, source: 'smg' });
          bot.forced++;
        }
      } else {
        fire(false);
        if (!target) look(killSpot.clone().add(new V(0, 0.9, 0)));
      }
      if (bot.spawned >= bot.goal && alive.length === 0) {
        fire(false);
        bot.phase = 'hold';
      }
    } else if (bot.phase === 'walk') {
      const to = bot.walkTo;
      const d = new V().subVectors(to, P.position);
      d.y = 0;
      if (d.length() < 0.7) {
        ctx.input.simulate('forward', false);
        bot.phase = 'hold';
      } else {
        P.yaw = Math.atan2(-d.x, -d.z);
        P.pitch = -0.42;
        ctx.input.simulate('forward', true);
      }
    }
    if (live) {
      const now = performance.now();
      if (bot.last > 0 && bot.phase !== 'idle') {
        bot.intervals.push(now - bot.last);
        bot.physics.push(ctx.physics.stepMs);
      }
      bot.last = now;
    }
  };
  const inner = game.frame.bind(game);
  game.frame = (...a) => {
    step();
    return inner(...a);
  };
  if (live) {
    const update = ctx.gore.update.bind(ctx.gore);
    ctx.gore.update = () => {
      const t0 = performance.now();
      update();
      if (bot.phase !== 'idle') bot.gore.push(performance.now() - t0);
    };
  }

  const corpses = () => (ctx.gore.bodies ?? []).filter(b => b.sinking < 0 && !b.down);
  const hipsOf = b => new V().setFromMatrixPosition(b.char.bones[0].matrixWorld);
  // The heap is looked at where the fight was set, the same place on every build, so two builds' pictures can be laid side by side.
  const heap = () => ({ centre: killSpot.clone(), list: corpses().map(hipsOf).filter(h => Math.hypot(h.x - killSpot.x, h.z - killSpot.z) < 4.5 && Math.abs(h.y - killSpot.y) < 3) });
  const pctl = (a, p) => {
    if (a.length === 0) return 0;
    const s = [...a].sort((x, y) => x - y);
    return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2);
  };
  const stats = () => {
    const { centre, list } = heap();
    const floor = ground(centre.x, centre.y + 1, centre.z).y;
    const heights = list.map(h => h.y - floor);
    const d = r.decals;
    const ring = name => (d.live ? { live: d.live(name), limit: d.limit(name), retired: d.retired(name) } : undefined);
    const g = ctx.gore.stats();
    const world = ctx.physics.world;
    const mem = r.renderer.info.memory;
    const mess = ctx.gore.mess?.stats?.();
    return {
      kills: bot.kills, forced: bot.forced, corpses: corpses().length, near: list.length, gore: g, mess,
      within2m: list.filter(h => Math.hypot(h.x - centre.x, h.z - centre.z) < 2).length,
      hipsMax: +Math.max(0, ...heights).toFixed(2), hipsMedian: pctl(heights, 0.5), hips90: pctl(heights, 0.9),
      above35cm: heights.filter(y => y > 0.35).length, above60cm: heights.filter(y => y > 0.6).length,
      decals: d.total ?? d.mesh.count, soaked: d.soaked, rings: d.live ? { scorch: ring('scorch'), big: ring('big'), blood: ring('blood'), mark: ring('mark') } : undefined,
      chunkBodies: g.chunkBodies, halves: g.halves, limbs: g.limbs, guts: g.guts,
      rigidBodies: world.bodies.len(), colliders: world.colliders.len(),
      calls: r.drawCalls(), tris: r.triangles(), textures: mem.textures, geometries: mem.geometries,
    };
  };
  const cost = () => {
    const out = { intervalP50: pctl(bot.intervals, 0.5), intervalP95: pctl(bot.intervals, 0.95), intervalP99: pctl(bot.intervals, 0.99), frames: bot.intervals.length,
      physicsP50: pctl(bot.physics, 0.5), physicsP95: pctl(bot.physics, 0.95), physicsMax: pctl(bot.physics, 1),
      goreP50: pctl(bot.gore, 0.5), goreP95: pctl(bot.gore, 0.95), goreMax: pctl(bot.gore, 1) };
    bot.intervals.length = bot.physics.length = bot.gore.length = 0;
    return out;
  };

  // A real GPU wait: a read from a framebuffer of its own, after a clear queued behind the work.
  const gl = r.renderer.getContext();
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
  /** `n` frames drawn and waited for. Timed by the caller, from outside. */
  const draw = n => {
    for (let i = 0; i < n; i++) r.render();
    sync();
  };

  /** Draws one frame from a camera of the script's choosing, with the gun out of the picture. */
  // Where the player stands, for the pictures from above: a lit post, shown only for them.
  let ring = null;
  const shoot = (which, mark = false) => {
    const { centre } = heap();
    const cam = r.camera;
    const keep = { p: cam.position.clone(), q: cam.quaternion.clone() };
    const gun = r.viewScene.visible;
    r.viewScene.visible = false;
    if (which === 'high') {
      cam.position.set(centre.x - fwd.x * 3.4 + side.x * 1.6, centre.y + 4.2, centre.z - fwd.z * 3.4 + side.z * 1.6);
      cam.lookAt(centre.x, centre.y + 0.2, centre.z);
    } else if (which === 'low') {
      // Knee height, side on: how high the heap stands.
      cam.position.set(centre.x + side.x * 4.6 - fwd.x * 0.5, centre.y + 0.55, centre.z + side.z * 4.6 - fwd.z * 0.5);
      cam.lookAt(centre.x, centre.y + 0.4, centre.z);
    } else {
      cam.position.set(home.x, home.y + 1.7, home.z);
      cam.lookAt(centre.x, centre.y + 0.1, centre.z);
    }
    cam.updateMatrixWorld(true);
    if (mark) {
      if (!ring) {
        // Made from what the page already has: a thin lit post, a player high, where the player stands.
        const decal = r.decals.mesh;
        const Mesh = Object.getPrototypeOf(decal.constructor);
        const material = new decal.material.constructor();
        material.color.setHex(0);
        material.emissive.setHex(0xffd21a);
        material.emissiveIntensity = 4;
        material.side = 2;
        ring = new Mesh(new decal.geometry.constructor(0.08, 1.8), material);
        r.scene.add(ring);
      }
      ring.position.set(P.position.x, P.position.y + 0.9, P.position.z);
      ring.quaternion.copy(cam.quaternion);
      ring.visible = true;
      ring.updateMatrixWorld(true);
    }
    r.render();
    if (ring) ring.visible = false;
    cam.position.copy(keep.p);
    cam.quaternion.copy(keep.q);
    cam.updateMatrixWorld(true);
    r.viewScene.visible = gun;
  };

  window.__mess = {
    bot, stats, cost, draw, shoot,
    fight: goal => { bot.goal = goal; bot.phase = 'fight'; },
    walk: () => {
      const { centre } = heap();
      // Straight through the thick of it, from 5 m short to 6 m past.
      const from = ground(centre.x - fwd.x * 5, centre.y + 1, centre.z - fwd.z * 5);
      bot.walkTo = ground(centre.x + fwd.x * 6, centre.y + 1, centre.z + fwd.z * 6);
      P.teleport(from, yaw);
      P.pitch = -0.42;
      bot.phase = 'walk';
      return { from: from.toArray(), to: bot.walkTo.toArray(), centre: centre.toArray() };
    },
    player: () => ({ at: P.position.toArray().map(x => +x.toFixed(2)), speed: +Math.hypot(P.velocity.x, P.velocity.z).toFixed(2) }),
  };
  return { size: r.renderSize(), heading: +heading.toFixed(2), longest: +longest.toFixed(1), home: home.toArray() };
}

export default async function fight(page, h) {
  mkdirSync(DIR, { recursive: true });
  const ready = 'window.__op2 && window.__op2.game && window.__op2.game.state === "playing"';
  if (LIVE) await page.waitForFunction(`!!(${ready})`, null, { timeout: 120000 });
  else await steady.ready(page, { until: `!!(${ready})` });
  const run = async n => {
    if (LIVE) await h.sleep(n * 16);
    else await steady.frames(page, n);
  };
  await run(40);
  if (process.env.MESS_EVAL) await page.evaluate(process.env.MESS_EVAL);
  const report = { tag: TAG, seed: SEED, live: LIVE, note: process.env.MESS_URL_NOTE ?? '', url: page.url(), stops: [] };
  report.setup = await page.evaluate(install, { spot: SPOT, live: LIVE, choke: CHOKE });
  const still = async name => {
    const file = join(DIR, `${TAG}-${name}.png`);
    await page.screenshot({ path: file });
    return file;
  };
  /** What one frame costs to draw as things stand, in ms: timed here, since the page's clock does not move. */
  const drawCost = async () => {
    let best = Infinity;
    for (let i = 0; i < 6; i++) {
      const t0 = performance.now();
      await page.evaluate(() => window.__mess.draw(0));
      const t1 = performance.now();
      await page.evaluate(() => window.__mess.draw(30));
      const t2 = performance.now();
      best = Math.min(best, (t2 - t1 - (t1 - t0)) / 30);
    }
    return +best.toFixed(2);
  };
  const tiles = [];
  for (const stop of STOPS) {
    await page.evaluate(g => window.__mess.fight(g), stop);
    const limit = 400 + stop * 90;
    let frames = 0;
    while (frames < limit) {
      await run(30);
      frames += 30;
      if (await page.evaluate(() => window.__mess.bot.phase === 'hold')) break;
    }
    // Everything lands and lies still, and the pools spread, before the picture.
    await run(300);
    const fightCost = LIVE ? await page.evaluate(() => window.__mess.cost()) : undefined;
    const row = { stop, frames, ...(await page.evaluate(() => window.__mess.stats())), fightCost };
    for (const which of ['eye', 'high', 'low']) {
      await page.evaluate(w => window.__mess.shoot(w), which);
      row[which] = await still(`kills${stop}-${which}`);
      if (which === 'eye') row.drawMs = await drawCost();
      tiles.push({ src: row[which], text: `${stop} kills, ${which}: ${row.corpses} bodies kept, hips up to ${row.hipsMax} m, ${row.decals} decals` });
    }
    report.stops.push(row);
    console.log(JSON.stringify({ stop, kills: row.kills, corpses: row.corpses, hipsMax: row.hipsMax, above35cm: row.above35cm, decals: row.decals, drawMs: row.drawMs, calls: row.calls }));
  }

  if (WALK) {
    report.walk = { ...(await page.evaluate(() => window.__mess.walk())), frames: [] };
    const walkTiles = [];
    const highTiles = [];
    const before = await page.evaluate(() => window.__mess.stats());
    let moved = 0;
    let peak = { ragdolls: 0, rigidBodies: 0 };
    for (let i = 0; i < 48; i++) {
      const name = `walk-${String(i).padStart(2, '0')}`;
      const p = await page.evaluate(() => ({ ...window.__mess.player(), phase: window.__mess.bot.phase, g: window.__op2.ctx.gore.stats(), bodies: window.__op2.ctx.physics.world.bodies.len() }));
      peak = { ragdolls: Math.max(peak.ragdolls, p.g.ragdolls), rigidBodies: Math.max(peak.rigidBodies, p.bodies) };
      if (!LIVE) {
        const file = await still(name);
        walkTiles.push({ src: file, text: `#${i}  +${i * 3 * 16} ms   ${p.speed} m/s   ${p.g.ragdolls} ragdolls awake` });
        // The same moment from above, where what the walk does to the heap can be seen. The player is the yellow post.
        await page.evaluate(() => window.__mess.shoot('high', true));
        highTiles.push({ src: await still(`walkhigh-${String(i).padStart(2, '0')}`), text: `#${i}  +${i * 3 * 16} ms   ${p.g.ragdolls} ragdolls awake` });
      }
      report.walk.frames.push({ i, ...p.at && { at: p.at }, speed: p.speed, ragdolls: p.g.ragdolls });
      if (p.phase === 'hold' && i > 4) break;
      await run(3);
      moved++;
    }
    await run(240);
    const after = await page.evaluate(() => window.__mess.stats());
    report.walk.before = before;
    report.walk.after = after;
    report.walk.peak = peak;
    report.walk.cost = LIVE ? await page.evaluate(() => window.__mess.cost()) : undefined;
    await page.evaluate(() => window.__mess.shoot('high'));
    report.walk.afterShot = await still('walk-after');
    if (!LIVE) report.walk.highSheet = await sheet(page, highTiles, join(DIR, `${TAG}-walk-high.png`), `${TAG}: the same walk seen from above (the player is the yellow post)   ·   one frame every 48 ms   ·   frozen clock, seed ${SEED}`, 6);
    if (!LIVE) report.walk.sheet = await sheet(page, walkTiles, join(DIR, `${TAG}-walk.png`), `${TAG}: walking through the heap after ${STOPS[STOPS.length - 1]} kills   ·   one frame every 48 ms   ·   frozen clock, seed ${SEED}`, 6);
  }
  if (!LIVE) report.sheet = await sheet(page, tiles, join(DIR, `${TAG}-fight.png`), `${TAG}: the floor after ${STOPS.join(', ')} kills on one spot   ·   frozen clock, seed ${SEED}`, 3);
  writeFileSync(join(DIR, `${TAG}.json`), JSON.stringify(report, null, 1));
  return report;
}

/** Lays stills out on one picture with a line under each, drawn by a page of its own. */
async function sheet(page, tiles, out, title, cols) {
  if (tiles.length === 0) return null;
  const view = page.viewportSize();
  const grid = layout({ count: tiles.length, cols, tile: cols <= 3 ? 800 : 480, frameW: view.width, frameH: view.height });
  const names = tiles.map((t, i) => ({ src: `t${i}.png`, text: t.text, path: t.src }));
  const html = sheetHtml({ grid, tiles: names, title });
  const context = await page.context().browser().newContext({ viewport: { width: grid.width, height: grid.height }, deviceScaleFactor: 1 });
  try {
    const p = await context.newPage();
    await p.route('http://sheet.invalid/**', route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      const tile = names.find(t => t.src === name);
      return tile ? route.fulfill({ path: tile.path, contentType: 'image/png' }) : route.fulfill({ contentType: 'text/html', body: html });
    });
    await p.goto('http://sheet.invalid/');
    await p.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0), null, { timeout: 60000 });
    await p.screenshot({ path: out });
  } finally {
    await context.close();
  }
  return out;
}
