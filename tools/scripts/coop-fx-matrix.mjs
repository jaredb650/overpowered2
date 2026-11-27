// Every weapon as the other players see it (src/weapons/watch.ts, src/net/world/remoteFire.ts). Three pages in one match: one
// player fires each weapon, load and special; a second stands beside them and a third watches from across the room. On the
// two watchers the script counts what was drawn and heard (the same fx, decal, light and sound calls the shooter's own game
// made) and compares where things ended. It runs twice: the host firing with two guests watching, then a guest firing with the
// host and the other guest watching. For every weapon a screenshot pair: the shooter's view and the watcher's at one moment.
//
//   OP2_NO_HMR=1 npx vite --port 5360 --strictPort
//   node tools/shot.mjs --port 5360 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 1500 \
//     --script tools/scripts/coop-fx-matrix.mjs --out /home/jared/jared/overpowered2/tools/out/coop/weapons-fx/matrix.png
//
// FX_NET='lag:120,jitter:40,loss:0.05' runs it on a bad network. FX_ONLY=lance,shotgun runs some cases, FX_ROUND=host or
// guest one round. FX_SHOTS=0 skips the screenshots (the second, guest-firing round takes none).
import { writeFileSync } from 'node:fs';
import { calm, inMatch, kit, startParty } from './coop-kit.mjs';

const NET = process.env.FX_NET ?? '';
const ONLY = (process.env.FX_ONLY ?? '').split(',').filter(Boolean);
const SHOTS = process.env.FX_SHOTS !== '0';
const ROUND = process.env.FX_ROUND ?? '';
const TAG = NET ? 'bad' : 'clean';

// ---------------------------------------------------------------------------------------------
// In the page
// ---------------------------------------------------------------------------------------------

/** Wraps the page's fx, decals, lights and audio so every call is counted, with where it was. Idempotent. */
const record = () => {
  const { ctx } = window.__op2;
  if (window.__fx) { window.__fx.reset(); return; }
  const log = { fx: {}, sounds: {}, loops: {}, decals: {}, lights: 0, points: {}, flat: [] };
  const R = window.__fx = {
    log,
    reset() { log.fx = {}; log.sounds = {}; log.loops = {}; log.decals = {}; log.lights = 0; log.points = {}; log.flat = []; },
  };
  const at = (name, v) => { if (v && typeof v.x === 'number') (log.points[name] ??= []).push([+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]); };
  const fx = ctx.fx;
  // What ends somewhere: the point that matters is the far end.
  const ENDS = { tracer: 1, beam: 1, arc: 1 };
  for (const name of ['tracer', 'beam', 'arc', 'ring', 'sparks', 'embers', 'impact', 'muzzleFlash', 'shellCasing', 'explosion', 'burst', 'slash',
    'heatShimmer', 'smoke', 'dust', 'hose', 'napalm', 'napalmSplash', 'dashStreaks', 'flame', 'inhale', 'bloodHit', 'bloodMist']) {
    const real = fx[name];
    if (typeof real !== 'function') continue;
    fx[name] = (...args) => {
      log.fx[name] = (log.fx[name] ?? 0) + 1;
      if (name !== 'hose' && name !== 'napalm') at(name, args[ENDS[name] ? 1 : 0]);
      return real.apply(fx, args);
    };
  }
  // Flechettes standing in walls and stakes standing in them: counted as they are stuck.
  const needles = ctx.combat.needles, stickN = needles.stick;
  needles.stick = (...args) => { log.fx.needle = (log.fx.needle ?? 0) + 1; return stickN.apply(needles, args); };
  const visuals = ctx.combat.projectiles.visuals, stickS = visuals.stick;
  visuals.stick = (...args) => { log.fx.stake = (log.fx.stake ?? 0) + 1; at('stake', args[0]); return stickS.apply(visuals, args); };
  const decals = ctx.render.decals, add = decals.add;
  decals.add = (...args) => { log.decals[args[0]] = (log.decals[args[0]] ?? 0) + 1; at(`decal:${args[0]}`, args[1]); return add.apply(decals, args); };
  const lights = ctx.render.lights, flash = lights.flash;
  lights.flash = (...args) => { log.lights++; return flash.apply(lights, args); };
  const audio = ctx.audio, play = audio.play, loop = audio.startLoop;
  audio.play = (id, options) => {
    log.sounds[id] = (log.sounds[id] ?? 0) + 1;
    // A sound with no place is in the listener's head: a watcher must hear none of a friend's gun that way.
    if (!options?.position) log.flat.push(id);
    return play.call(audio, id, options);
  };
  audio.startLoop = (id, options) => {
    log.loops[id] = (log.loops[id] ?? 0) + 1;
    if (!options?.position) log.flat.push(`loop:${id}`);
    return loop.call(audio, id, options);
  };
};

const read = () => {
  const { ctx } = window.__op2;
  const fxw = ctx.coop.world.weaponFx;
  const remotes = [...ctx.coop.remotes.values()].map(r => ({ slot: r.player.slot, beaming: r.watcher.beaming, giant: r.watcher.giantAt?.toArray().map(n => +n.toFixed(2)) ?? null,
    holding: r.watcher.holding, held: r.watcher.held, lit: r.watcher.lit, pouring: r.watcher.pouring }));
  return { globs: ctx.combat.flames.watched, log: JSON.parse(JSON.stringify(window.__fx.log)), sent: { ...fxw.sent }, drawn: { ...fxw.drawn }, watched: { ...fxw.watched }, remotes,
    projectiles: ctx.combat.projectiles.active.filter(p => p.cosmetic).length, own: ctx.combat.projectiles.active.filter(p => !p.cosmetic).length,
    enemies: ctx.enemies.alive.map(e => ({ uid: e.uid, health: e.health, burning: e.burning })) };
};

/** Puts the player at `at` looking at `look`, standing still, invulnerable, playing. */
const place = ([at, look]) => {
  const { ctx, game } = window.__op2; const V = ctx.player.position.constructor;
  const p = new V(...at), l = new V(...look);
  const yaw = Math.atan2(-(l.x - p.x), -(l.z - p.z));
  ctx.player.teleport(p, yaw);
  ctx.player.velocity.set(0, 0, 0);
  const eye = p.clone(); eye.y += 1.62;
  ctx.player.yaw = yaw;
  ctx.player.pitch = Math.atan2(l.y - eye.y, Math.hypot(l.x - eye.x, l.z - eye.z));
  ctx.player.modifiers.invulnerable = true;
  if (game.state !== 'playing') game.setState('playing');
};

/** The gun in hand with these mods and no others of its own, magazines full, ready to fire. `set`: the case's own switches. */
const arm = ([weapon, mods, set]) => {
  const { ctx, game } = window.__op2; const w = ctx.weapons;
  if (game.state !== 'playing') game.setState('playing');
  for (const action of ['fire', 'aim', 'reload', 'grenade', 'stim']) ctx.input.simulate(action, false);
  w.give(weapon); w.switchTo(weapon);
  for (const id of [...w.fitted]) w.fitMod(id, false);
  for (const id of mods) { w.grantMod(id); w.fitMod(id, true); }
  w.refillMagazines();
  w.modifiers.bottomlessMag = !set.mag;
  w.altLoaded.clear();
  if (set.alt) w.altLoaded.add(weapon);
  if (weapon === 'lance' && (w.lance.mode === 'ball') !== !!set.ball) w.lance.toggle();
  if (set.grenades) w.addGrenades(4);
  if (set.mag) w.slots[weapon].ammo.mag = set.mag;
  if (set.hurt) ctx.player.health = 40;
  window.__case = set;
};

/** After the draw: what needs the gun up first. */
const ready = ([weapon, set]) => {
  const { ctx } = window.__op2; const w = ctx.weapons;
  if (set.launcher && !w.glUp) w.raiseLauncher(true);
  return { current: w.current, drawn: w.drawLeft <= 0, sounds: w.slots[weapon].def.sounds.map(s => s.id), akimbo: w.akimbo };
};

const hold = ([action, on]) => { const { ctx, game } = window.__op2; if (game.state !== 'playing') game.setState('playing'); ctx.input.simulate(action, on); };
/** Presses `action` for a frame or two every `every` ms until stopped: a semi-auto fired over and over. */
const pump = ([action, every]) => {
  const { ctx } = window.__op2;
  clearInterval(window.__pump);
  const press = () => { ctx.input.simulate(action, true); setTimeout(() => ctx.input.simulate(action, false), 50); };
  press();
  window.__pump = setInterval(press, every);
};
const unpump = action => { clearInterval(window.__pump); window.__op2.ctx.input.simulate(action, false); };

// ---------------------------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------------------------

const near = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tol;
/** The share of `mine` that has one of `theirs` within `tol` metres. */
const matched = (mine, theirs, tol) => mine.length === 0 ? 1 : mine.filter(p => theirs.some(q => near(p, q, tol))).length / mine.length;
const sum = o => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const n = (o, k) => o?.[k] ?? 0;

/**
 * What a watcher must have of the shooter's own record. `same`: fx calls counted on both, equal within a tenth (a shot in
 * flight when the count was read). `ends`: fx calls whose end points must be where the shooter's were. `sounds`: heard as
 * many times as the shooter heard them, from the world.
 */
const alike = (s, w, ok, { same = [], ends = [], sounds = [], decals = [], tol = 0.8, slack = 0.12 }) => {
  for (const name of same) {
    const a = n(s.log.fx, name), b = n(w.log.fx, name);
    ok(a > 0 && Math.abs(a - b) <= Math.max(1, a * slack), `${name}: as many as the shooter's own (${a} and ${b})`, { shooter: a, watcher: b });
  }
  for (const name of ends) {
    const a = s.log.points[name] ?? [], b = w.log.points[name] ?? [];
    const share = matched(a, b, tol);
    ok(a.length > 0 && share >= 0.9, `${name}: ends where the shooter's ends (${Math.round(share * 100)}% of ${a.length} within ${tol} m)`, { share, shooter: a.slice(0, 4), watcher: b.slice(0, 4) });
  }
  for (const name of decals) {
    const a = n(s.log.decals, name), b = n(w.log.decals, name);
    ok(a > 0 && Math.abs(a - b) <= Math.max(1, a * slack), `${name} decals: as many as the shooter's (${a} and ${b})`, { shooter: a, watcher: b });
  }
  for (const id of sounds) {
    const a = n(s.log.sounds, id) + n(s.log.loops, id), b = n(w.log.sounds, id) + n(w.log.loops, id);
    ok(a > 0 && Math.abs(a - b) <= Math.max(1, a * slack), `${id}: heard as often as the shooter hears it (${a} and ${b})`, { shooter: a, watcher: b });
  }
};

/** A hitscan gun: every round, flash and casing, the report, and where each round ended. */
const gun = (extra = {}) => function (s, w, ok, info) {
  ok(w.drawn.fire === s.sent.fire && s.sent.fire > 0, `every shot arrived (${s.sent.fire} sent, ${w.drawn.fire} drawn)`, { sent: s.sent, drawn: w.drawn });
  alike(s, w, ok, { same: ['tracer', 'muzzleFlash', 'impact', ...(extra.same ?? [])], ends: ['tracer', ...(extra.ends ?? [])], sounds: extra.sounds ?? info.sounds, decals: extra.decals ?? ['bullet'], tol: extra.tol });
  if (extra.casing !== false) alike(s, w, ok, { same: ['shellCasing'] });
  extra.more?.(s, w, ok, info);
};
/** A gun whose round flies: the flash and report, and a copy of each projectile that ends where the shooter's blew up. */
const launcher = (extra = {}) => function (s, w, ok, info) {
  ok(w.drawn.round === s.sent.round && s.sent.round > 0, `every projectile arrived (${s.sent.round} sent, ${w.drawn.round} drawn)`, { sent: s.sent, drawn: w.drawn });
  ok(w.projectiles === 0, 'no copy is left flying', w.projectiles);
  alike(s, w, ok, { same: ['muzzleFlash', ...(extra.same ?? [])], ends: extra.ends ?? ['explosion'], sounds: extra.sounds ?? info.sounds, decals: extra.decals ?? [], tol: extra.tol ?? 1.5 });
  extra.more?.(s, w, ok, info);
};

/** A blade or a club: every swing, everything it drew in the air, and its sound from the swinger. */
const melee = (s, w, ok) => {
  ok(w.watched.swings === s.sent.fire && w.watched.swings >= 2, `every swing arrived (${s.sent.fire} and ${w.watched.swings})`, w.watched);
  ok(w.drawn.mfx === s.sent.mfx, `everything the swings drew in the air arrived (${s.sent.mfx} and ${w.drawn.mfx})`, { sent: s.sent, drawn: w.drawn });
  ok(sum(w.log.sounds) >= w.watched.swings, 'each swing is heard from them', w.log.sounds);
};
/** Rounds that go to a head the gun locked (a fan, the smart aim, Gun Kata): each arrives, and ends where the shooter's ended. */
const aimed = (what, more) => function (s, w, ok) {
  ok(s.sent.fire >= 2 && w.drawn.fire === s.sent.fire, `every ${what} arrived (${s.sent.fire} sent, ${w.drawn.fire} drawn)`, { sent: s.sent, drawn: w.drawn });
  alike(s, w, ok, { same: ['tracer', 'muzzleFlash'], ends: ['tracer'], tol: 1.2, slack: 0.2 });
  more?.(s, w, ok);
};

/**
 * `fire`: { hold: ms } the trigger held; { kata: ms } Gun Kata set off; { pump: every, ms } pressed over and over; { charge: true } held to a full Lance
 * charge and let go; { tap: ms }. `action`: the button (default fire). `shotAt`: ms after the trigger goes down that the
 * screenshots are taken. `set`: switches for `arm`. `dummies`: bodies in the lane.
 */
const CASES = [
  { id: 'lance-rail', weapon: 'lance', dummies: 3, fire: { tap: 60 }, settle: 1300, shotAt: 100,
    expect(s, w, ok) {
      ok(w.watched.rails === 1, 'the rail shot is a rail shot on the watcher', w.watched);
      alike(s, w, ok, { same: ['beam', 'arc', 'ring'], ends: ['beam'], sounds: ['lance_thunder', 'railgun_fire', 'railgun_beam'] });
      ok(n(w.log.fx, 'explosion') >= 3, 'a plasma burst at each body (the shooter\'s booms)', w.log.fx);
    } },
  { id: 'lance-beam', weapon: 'lance', fire: { charge: true }, settle: 1700, during: 'beam',
    expect(s, w, ok) {
      ok(w.watched.beams === 1, 'the beam starts on the watcher', w.watched);
      ok(w.mid?.remotes.some(r => r.beaming), 'it is pouring while the shooter\'s pours', w.mid?.remotes);
      ok(!w.remotes.some(r => r.beaming), 'and has stopped at the end', w.remotes);
      alike(s, w, ok, { sounds: ['lance_beam_loop', 'orbital_beam_loop', 'lance_thunder', 'orbital_strike', 'railgun_beam'], decals: ['scorch', 'crack'], ends: ['decal:scorch'], tol: 1.5, slack: 0.5 });
      alike(s, w, ok, { same: ['arc', 'heatShimmer'], slack: 0.35 });
      ok(n(w.log.fx, 'sparks') >= n(s.log.fx, 'sparks') * 0.5 && n(w.log.fx, 'sparks') >= 10, `the end of it sparks, tick by tick (${n(s.log.fx, 'sparks')} and ${n(w.log.fx, 'sparks')})`, w.log.fx);
      ok(w.log.lights >= s.log.lights * 0.7 && w.log.lights > 5, `its light at the wall, tick by tick (${s.log.lights} and ${w.log.lights})`, w.log.lights);
    } },
  { id: 'lance-ball', weapon: 'lance', set: { ball: true }, fire: { tap: 60 }, settle: 1700, shotAt: 150,
    expect(s, w, ok) {
      ok(w.watched.balls === 1 && w.drawn.round === 1, 'the ball leaves as a ball, and flies as a projectile', { watched: w.watched, drawn: w.drawn });
      alike(s, w, ok, { ends: ['explosion'], sounds: ['lance_plasma'], tol: 1 });
    } },
  { id: 'lance-giant', weapon: 'lance', set: { ball: true }, fire: { charge: true }, settle: 3600, during: 'giant',
    expect(s, w, ok) {
      ok(w.watched.giants === 1, 'the giant ball starts on the watcher', w.watched);
      ok(w.mid?.remotes.some(r => r.giant), 'it is in flight while the shooter\'s flies', w.mid?.remotes);
      ok(w.watched.giantLands === 1 && !w.remotes.some(r => r.giant), 'it goes off when the shooter\'s does', { watched: w.watched, remotes: w.remotes });
      alike(s, w, ok, { same: ['ring', 'explosion'], sounds: ['lance_giant', 'lance_nova', 'lance_giant_loop'], slack: 0.3 });
      // The nova's own bursts are scattered at random on each screen: the blast itself is where the shooter's was.
      const mine = (s.log.points.explosion ?? [])[0], theirs = w.log.points.explosion ?? [];
      ok(!!mine && theirs.some(q => near(mine, q, 1.5)), 'the nova goes off where the shooter\'s did', { mine, theirs });
    } },
  { id: 'lance-charge', weapon: 'lance', fire: { chargeTo: 0.5 }, cancel: 'aim', settle: 700,
    expect(s, w, ok) {
      ok(n(w.log.fx, 'inhale') > 0 && n(w.log.loops, 'railgun_charge_loop') === 1, 'the charge is seen and heard at their muzzle', { fx: w.log.fx, loops: w.log.loops });
    } },

  { id: 'smg', weapon: 'smg', fire: { hold: 700 }, settle: 700, shotAt: 400, expect: gun() },
  { id: 'smg-suppressed', weapon: 'smg', mods: ['suppressor'], fire: { hold: 700 }, settle: 700, shotAt: 400, expect: gun({ sounds: ['smg_suppressed_shot'] }) },
  { id: 'smg-akimbo', weapon: 'smg', mods: ['smgAkimbo'], fire: { hold: 700 }, settle: 700, shotAt: 400,
    expect: gun({ more(s, w, ok) {
      const flashes = w.log.points.muzzleFlash ?? [];
      const apart = flashes.some(a => flashes.some(b => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.2));
      ok(apart, 'the flashes leave two muzzles, a hand apart', flashes.slice(0, 6));
    } }) },
  { id: 'smg-light', weapon: 'smg', mods: ['smgLight'], fire: { hold: 300 }, settle: 900, shotAt: 250,
    expect(s, w, ok) { ok(w.remotes.some(r => r.lit), 'their weapon light is lit on the watcher', w.remotes); } },
  { id: 'gimlet', weapon: 'gimlet', mods: ['gimletCan'], fire: { hold: 700 }, settle: 700, shotAt: 400, expect: gun() },
  { id: 'gimlet-launcher', weapon: 'gimlet', mods: ['gimletGl'], set: { launcher: true }, fire: { pump: 900, ms: 2400 }, settle: 2800, shotAt: 1500, expect: launcher({ sounds: ['launcher_thump'] }) },
  { id: 'harrow', weapon: 'harrow', fire: { hold: 700 }, settle: 700, shotAt: 400, expect: gun() },
  { id: 'harrow-api', weapon: 'harrow', mods: ['harrowApi'], fire: { hold: 700 }, settle: 700, shotAt: 400, expect: gun({ more(s, w, ok) { ok(n(w.log.fx, 'sparks') >= s.sent.fire, 'API sparks where the rounds land', w.log.fx); } }) },
  { id: 'shear', weapon: 'shear', fire: { hold: 700 }, settle: 700, shotAt: 400, expect: gun() },
  { id: 'bodkin-oicw', weapon: 'bodkin', mods: ['bodkinOicw'], set: { launcher: true }, fire: { pump: 700, ms: 1800 }, settle: 2400, shotAt: 1000, expect: launcher({ sounds: ['launcher_thump'] }) },
  { id: 'flail', weapon: 'flail', fire: { hold: 700 }, settle: 700, shotAt: 400, expect: gun() },
  { id: 'shotgun', weapon: 'shotgun', fire: { pump: 650, ms: 1500 }, settle: 900, shotAt: 120, expect: gun({ casing: false }) },
  { id: 'shotgun-flechette', weapon: 'shotgun', mods: ['shotgunFlechette'], fire: { pump: 650, ms: 1500 }, settle: 900, shotAt: 120,
    expect: gun({ casing: false, same: ['needle'] }) },
  { id: 'shotgun-choke', weapon: 'shotgun', mods: ['shotgunChoke'], fire: { pump: 650, ms: 800 }, settle: 900, shotAt: 120, expect: gun({ casing: false, tol: 0.5 }) },
  { id: 'thresher', weapon: 'thresher', fire: { hold: 800 }, settle: 800, shotAt: 400, expect: gun() },
  { id: 'deuce', weapon: 'deuce', set: { mag: 2 }, fire: { tap: 80 }, settle: 900, shotAt: 120, expect: gun({ casing: false }) },
  { id: 'deuce-both', weapon: 'deuce', set: { mag: 2 }, action: 'aim', fire: { tap: 80 }, settle: 900, shotAt: 120, expect: gun({ casing: false, same: [] }) },
  { id: 'deuce-quad-both', weapon: 'deuce', mods: ['deuceQuad'], set: { mag: 4 }, action: 'aim', fire: { tap: 80 }, settle: 900, shotAt: 120, expect: gun({ casing: false, same: [] }) },
  { id: 'rocket', weapon: 'rocket', fire: { pump: 800, ms: 2600 }, settle: 2400, shotAt: 1500, expect: launcher() },
  { id: 'rocket-laser', weapon: 'rocket', before: 'aim', fire: { pump: 800, ms: 2600 }, settle: 2400, shotAt: 1500, after: 'aim',
    expect: launcher({ more(s, w, ok) {
      ok(n(w.log.fx, 'beam') >= 5, `their laser line is drawn while the sight is up (${n(s.log.fx, 'beam')} frames and ${n(w.log.fx, 'beam')})`, n(w.log.fx, 'beam'));
    } }) },
  { id: 'quiver-salvo', weapon: 'quiver', action: 'aim', fire: { tap: 80 }, settle: 3200, shotAt: 700, expect: launcher({ tol: 3 }) },
  { id: 'sabot', weapon: 'sabot', fire: { pump: 600, ms: 1300 }, settle: 800, shotAt: 120, expect: gun({ casing: false }) },
  { id: 'sabot-raufoss', weapon: 'sabot', mods: ['raufoss'], fire: { tap: 80 }, settle: 900, shotAt: 120,
    expect(s, w, ok) {
      ok(w.watched.raufoss === 1, 'the round is a Raufoss round on the watcher', w.watched);
      alike(s, w, ok, { same: ['burst', 'ring', 'embers'], ends: ['burst'], sounds: ['cannon_burst'], decals: ['scorch'], slack: 0.2 });
    } },
  { id: 'awl', weapon: 'awl', mods: ['awlBarrel'], fire: { tap: 80 }, settle: 1100, shotAt: 120, expect: gun({ casing: false }) },
  { id: 'autocannon', weapon: 'autocannon', fire: { pump: 500, ms: 2200 }, settle: 2000, shotAt: 1300, expect: launcher() },
  { id: 'autocannon-flak', weapon: 'autocannon', mods: ['autocannonFlak'], fire: { pump: 500, ms: 2200 }, settle: 2000, shotAt: 1300,
    expect: launcher({ more(s, w, ok) {
      // A ring a burst (the shell's trail leaves rings too, fewer on a copy that a late word cut short).
      ok(n(w.log.fx, 'ring') >= s.sent.round, `each shell\'s air burst and its ring (${s.sent.round} shells, ${n(w.log.fx, 'ring')} rings)`, w.log.fx);
      ok(n(w.log.fx, 'tracer') >= 10, `the fragments\' tracers (${n(s.log.fx, 'tracer')} and ${n(w.log.fx, 'tracer')})`, w.log.fx);
    } }) },
  { id: 'sword', weapon: 'sword', fire: { pump: 500, ms: 1400 }, settle: 700, shotAt: 150,
    expect(s, w, ok) {
      ok(w.watched.swings === s.sent.fire && w.watched.swings >= 2, `every swing arrived (${s.sent.fire} and ${w.watched.swings})`, w.watched);
      alike(s, w, ok, { same: ['slash'], ends: ['slash'], sounds: ['sword_swing'], tol: 0.05 });
    } },
  { id: 'sword-energy', weapon: 'sword', mods: ['swordEnergy'], fire: { pump: 500, ms: 1400 }, settle: 700, shotAt: 150,
    expect(s, w, ok) {
      alike(s, w, ok, { same: ['slash'], ends: ['slash'], sounds: ['sword_swing', 'lance_plasma'], tol: 0.05 });
    } },
  { id: 'sword-stab', weapon: 'sword', action: 'aim', fire: { tap: 80 }, settle: 900, shotAt: 150,
    expect(s, w, ok) {
      ok(w.watched.swings >= 1, 'the stab arrives', w.watched);
      alike(s, w, ok, { same: ['ring'], ends: ['ring'], tol: 0.05 });
    } },
  { id: 'judge', weapon: 'judge', fire: { pump: 550, ms: 1300 }, settle: 700, shotAt: 120, expect: gun({ casing: false }) },
  { id: 'rivet', weapon: 'rivet', fire: { pump: 180, ms: 900 }, settle: 700, shotAt: 200, expect: gun() },
  { id: 'ultramag', weapon: 'ultramag', mods: ['ultramagCan'], fire: { pump: 450, ms: 1200 }, settle: 700, shotAt: 120, expect: gun({ sounds: ['ultramag_suppressed_shot'] }) },
  { id: 'autoraffica', weapon: 'autoraffica', fire: { pump: 500, ms: 1200 }, settle: 700, shotAt: 150, expect: gun() },
  { id: 'trommel', weapon: 'buzzsaw', fire: { hold: 2200 }, settle: 900, shotAt: 1900,
    expect: gun({ same: ['burst'], ends: ['burst'], sounds: ['minigun_fire_loop', 'minigun_spinup', 'minigun_spindown'], tol: 0.6, more(s, w, ok) {
      ok(w.watched.whines >= 2, `the barrels are heard to spin up and to run down (${w.watched.whines} whines)`, w.watched);
    } }) },
  { id: 'trommel-12mm', weapon: 'buzzsaw', mods: ['trommel12'], fire: { hold: 2200 }, settle: 900, shotAt: 1900, expect: gun({ sounds: ['minigun_fire_loop'], tol: 0.6 }) },
  { id: 'piledriver', weapon: 'piledriver', fire: { hold: 800 }, settle: 800, shotAt: 450, expect: gun() },
  { id: 'piledriver-raufoss', weapon: 'piledriver', set: { alt: true }, fire: { hold: 500 }, settle: 900, shotAt: 350,
    expect(s, w, ok) {
      ok(w.watched.raufoss >= 2, 'the rounds are Raufoss rounds on the watcher', w.watched);
      alike(s, w, ok, { same: ['burst', 'ring'], ends: ['burst'], sounds: ['cannon_burst'], slack: 0.2 });
    } },
  { id: 'kiln', weapon: 'kiln', fire: { hold: 1800 }, settle: 3200, shotAt: 1300, during: 'hose',
    expect(s, w, ok) {
      ok(w.mid?.remotes.some(r => r.pouring) && w.mid.globs > 3, 'their stream pours while the shooter\'s does', w.mid);
      ok(!w.remotes.some(r => r.pouring), 'and stops when they let go', w.remotes);
      alike(s, w, ok, { sounds: ['flame_ignite', 'flame_hose_loop', 'flame_stop'] });
      ok(n(w.log.fx, 'hose') > 20 && n(w.log.fx, 'napalmSplash') >= 3 && n(w.log.fx, 'napalm') > 20, 'the hose, its splashes and burning pools are drawn', w.log.fx);
      ok(matched(s.log.points.napalmSplash ?? [], w.log.points.napalmSplash ?? [], 2.5) >= 0.6, 'the napalm lands about where the shooter\'s lands', { s: (s.log.points.napalmSplash ?? []).slice(0, 4), w: (w.log.points.napalmSplash ?? []).slice(0, 4) });
      ok(n(w.log.decals, 'scorch') >= 1, 'it scorches', w.log.decals);
    } },
  { id: 'stakegun', weapon: 'stakegun', fire: { pump: 700, ms: 1500 }, settle: 1200, shotAt: 150,
    expect: launcher({ same: ['stake'], ends: ['stake'], sounds: ['stake_hit_wall'], decals: ['crack'], tol: 0.6 }) },
  { id: 'stakegun-bolt', weapon: 'stakegun', set: { alt: true }, fire: { tap: 80 }, settle: 3000, shotAt: 600,
    expect: launcher({ ends: ['explosion'], sounds: ['stake_hit_wall'], more(s, w, ok) {
      // On a slow link the copy sticks later and goes off on time, so it has fewer beeps left to give.
      const want = NET ? 1 : n(s.log.sounds, 'stake_beep') - 1;
      ok(n(w.log.sounds, 'stake_beep') >= want && w.log.lights >= want, `the bolt beeps and blinks (${n(s.log.sounds, 'stake_beep')} and ${n(w.log.sounds, 'stake_beep')})`, w.log.sounds);
    } }) },
  { id: 'grenade', weapon: 'smg', set: { grenades: true }, action: 'grenade', fire: { hold: 500 }, settle: 3200, shotAt: 900,
    expect(s, w, ok) {
      ok(w.drawn.round === 1, 'the thrown grenade flies on the watcher', w.drawn);
      alike(s, w, ok, { ends: ['explosion'], sounds: ['grenade_throw'], tol: 2.5 });
      ok(n(w.log.sounds, 'grenade_bounce') >= 1 || n(s.log.sounds, 'grenade_bounce') === 0, 'it is heard to bounce', w.log.sounds);
    } },
  // ---- fix-hits: what the first matrix left to unit tests (checklist C15) ---------------------------------------------
  { id: 'knife', weapon: 'knife', fire: { pump: 500, ms: 1400 }, settle: 700, shotAt: 150, expect: melee },
  { id: 'crowbar', weapon: 'crowbar', fire: { pump: 600, ms: 1500 }, settle: 700, shotAt: 150, expect: melee },
  { id: 'shovel', weapon: 'shovel', fire: { pump: 600, ms: 1500 }, settle: 700, shotAt: 150, expect: melee },
  { id: 'baton', weapon: 'baton', fire: { pump: 500, ms: 1400 }, settle: 700, shotAt: 150, expect: melee },
  { id: 'judge-fan', weapon: 'judge', dummies: 3, tough: true, action: 'aim', fire: { hold: 1900 }, settle: 1600, shotAt: 2150,
    expect: aimed('fanned shot') },
  { id: 'smart-aim', weapon: 'autoraffica', dummies: 3, tough: true, prep: 'smart', fire: { hold: 900 }, settle: 900, shotAt: 600,
    expect: aimed('smart round') },
  { id: 'gun-kata', weapon: 'rivet', mods: ['rivetAkimbo'], dummies: 3, tough: true, fire: { kata: 1500 }, settle: 900, shotAt: 400,
    expect: aimed('kata round', (s, w, ok) => {
      const flashes = w.log.points.muzzleFlash ?? [];
      ok(flashes.some(a => flashes.some(b => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.2)), 'the kata fires from both hands', flashes.slice(0, 6));
    }) },
  { id: 'quiver-painted', weapon: 'quiver', dummies: 3, tough: true, action: 'aim', fire: { hold: 1500 }, settle: 3400, shotAt: 1900,
    expect: launcher({ tol: 3, more(s, w, ok) {
      ok(s.sent.round >= 2, `the painted salvo is more than one missile (${s.sent.round})`, s.sent);
    } }) },
  { id: 'stake-in-body', weapon: 'stakegun', dummies: 1, tough: true, fire: { pump: 700, ms: 1500 }, settle: 1300, shotAt: 150,
    expect(s, w, ok) {
      ok(w.drawn.round === s.sent.round && s.sent.round >= 2, `every stake arrived (${s.sent.round} sent, ${w.drawn.round} drawn)`, { sent: s.sent, drawn: w.drawn });
      ok(w.projectiles === 0, 'no copy is left flying', w.projectiles);
      // A stake that stops in a living body on the shooter's screen stops there for a watcher: none stands in the wall behind.
      ok(n(w.log.fx, 'stake') === n(s.log.fx, 'stake'), `as many stakes stand in the wall as on the shooter's screen (${n(s.log.fx, 'stake')} and ${n(w.log.fx, 'stake')})`, { shooter: s.log.fx, watcher: w.log.fx });
    } },
  { id: 'perk-tracer', weapon: 'smg', prep: 'bloodthirst', fire: { hold: 700 }, settle: 700, shotAt: 400,
    expect: gun({ more(s, w, ok) {
      ok(w.watched.perkTracers >= s.sent.fire && s.sent.fire > 0, `every round is drawn in the perk's colour (${s.sent.fire} shots, ${w.watched.perkTracers} coloured)`, w.watched);
    } }) },
  { id: 'reload', weapon: 'smg', set: { mag: 5 }, action: 'reload', fire: { tap: 80 }, settle: 1500, shotAt: 300,
    expect(s, w, ok, info) {
      ok(w.watched.reloads >= 1, 'their reload is a gesture on the watcher', w.watched);
      ok(info.reloadCues.every(id => n(w.log.sounds, id) >= 1), 'with the gun\'s own reload cues, from them', { want: info.reloadCues, heard: w.log.sounds });
    } },
  { id: 'stim', weapon: 'smg', set: { hurt: true }, action: 'stim', fire: { tap: 80 }, settle: 1500, shotAt: 300,
    expect(s, w, ok) {
      ok(w.watched.stims >= 1 && n(w.log.sounds, 'stim_click') >= 1, 'their stim is a gesture and a click on the watcher', { watched: w.watched, sounds: w.log.sounds });
    } },
];

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

const delta = (after, before) => {
  const out = JSON.parse(JSON.stringify(after));
  for (const key of ['sent', 'drawn', 'watched']) for (const k of Object.keys(out[key])) if (typeof out[key][k] === 'number') out[key][k] -= before[key][k] ?? 0;
  return out;
};

export default async function (host, { sleep, outDir }) {
  const out = { net: NET || 'clean', errors: [], checks: [], screenshots: [], cases: {}, failed: [], bytes: {} };
  const { progress } = kit(outDir, 'fx', out, sleep);
  const save = () => writeFileSync(`${outDir}/matrix-${TAG}.json`, JSON.stringify(out, null, 2));
  /** Polls `fn` on `page` until it is truthy. */
  const until = async (page, fn, arg, timeout = 20000) => {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await page.evaluate(fn, arg);
      if (value) return value;
      if (Date.now() > end) return null;
      await sleep(40);
    }
  };
  try {
    const party = await startParty(host, { players: 3, mode: 'crucible', net: NET || undefined, out, progress, sleep });
    await inMatch(party.pages, party.mode.contract);
    await calm(host);
    const [g1, g2] = party.guests;
    // A lane across the open floor: the shooter fires down it at a wall, with room for a watcher beside and one far off.
    const lane = await host.evaluate(() => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      const s = ctx.world.playerSpawns[0];
      let best = null;
      for (let i = 0; i < 32; i++) {
        const yaw = s.yaw + (i / 32) * Math.PI * 2;
        const dir = new V(-Math.sin(yaw), 0, -Math.cos(yaw));
        const eye = s.position.clone(); eye.y += 1.62;
        const hit = ctx.physics.raycast(eye, dir, 80, 1);
        const d = hit ? hit.distance : 80;
        // Far enough for a flight, near enough for a napalm arc's wall and a shotgun's pattern to be on screen.
        const score = d >= 16 && d <= 30 ? 100 - Math.abs(d - 22) : -Math.abs(d - 22);
        if (!best || score > best.score) best = { score, d, yaw, dir: dir.toArray(), origin: s.position.toArray() };
      }
      return best;
    });
    out.lane = lane;
    const P = (along, side, up = 0) => [lane.origin[0] + lane.dir[0] * along + lane.dir[2] * -side, lane.origin[1] + up, lane.origin[2] + lane.dir[2] * along + lane.dir[0] * side];
    const target = P(lane.d, 0, 1.5);
    // Calm for good: no waves, so nothing wanders into the lane.
    await host.evaluate(() => { const w = window.__op2.ctx.waves; w.reset(); w.phase = 'intermission'; w.nextWaveIn = 1e9; });

    const rounds = [
      { name: 'host fires', shooter: host, beside: g1, far: g2, shots: SHOTS },
      { name: 'guest fires', shooter: g1, beside: host, far: g2, shots: false },
    ];
    for (const round of rounds) {
      if (ROUND && !round.name.startsWith(ROUND)) continue;
      const { shooter, beside, far } = round;
      const key = round.name.replace(' ', '-');
      out.cases[key] = {};
      const stand = async () => {
        await shooter.evaluate(place, [P(0, 0), target]);
        await beside.evaluate(place, [P(-2.4, 2.2), P(9, -0.6, 1.2)]);
        await far.evaluate(place, [P(Math.min(lane.d - 4, 13), -6.5), P(1, 0, 1.3)]);
      };
      await stand();
      await sleep(600);
      for (const c of CASES) {
        if (ONLY.length && !ONLY.some(o => c.id.startsWith(o))) continue;
        progress(`${round.name}: ${c.id}`);
        const set = c.set ?? {};
        const action = c.action ?? 'fire';
        // Bodies in the lane, for what strikes bodies; none otherwise, so walls take it.
        await calm(host);
        if (c.dummies) {
          await host.evaluate(([count, pts, tough]) => {
            const { ctx } = window.__op2; const V = ctx.player.position.constructor;
            for (let i = 0; i < count; i++) {
              const e = ctx.enemies.spawn('husk', new V(...pts[i]));
              if (e) { e.behaviours = []; e.attacks = []; e.mode = 'hold'; e.dummy = true; if (tough) { e.health = e.maxHealth = 1e6; for (const region of e.limbHp.keys()) e.limbHp.set(region, 1e9); } }
            }
          }, [c.dummies, c.tough === true ? Array.from({ length: c.dummies }, (_, i) => P(8, (i - (c.dummies - 1) / 2) * 1.6)) : Array.from({ length: c.dummies }, (_, i) => P(7 + i * 2.5, 0)), c.tough === true]);
          for (const page of party.guests) await until(page, count => window.__op2.ctx.enemies.alive.length >= count, c.dummies);
          out.dummies = await host.evaluate(() => window.__op2.ctx.enemies.alive.map(e => e.center.toArray().map(n => +n.toFixed(2))));
        }
        await shooter.evaluate(arm, [c.weapon, c.mods ?? [], set]);
        await stand();
        // The gun is up, the watchers know what it is, and the last case's effects are gone.
        await until(shooter, weapon => { const w = window.__op2.ctx.weapons; return w.current === weapon && w.drawLeft <= 0 && !w.reloading; }, c.weapon);
        // Bodies in the lane: the shooter looks at the chest of the nearest, as this screen has it.
        if (c.dummies) await shooter.evaluate(() => {
          const { ctx } = window.__op2;
          let best = null;
          for (const e of ctx.enemies.alive) if (!best || e.center.distanceToSquared(ctx.player.eye) < best.center.distanceToSquared(ctx.player.eye)) best = e;
          if (!best) return;
          const d = best.center.clone().sub(ctx.player.eye);
          ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        });
        const info = await shooter.evaluate(ready, [c.weapon, set]);
        info.reloadCues = await shooter.evaluate(weapon => window.__op2.ctx.weapons.slots[weapon].def.reloadFoley.map(cue => cue[1]), c.weapon);
        const mods = c.mods ?? [];
        for (const page of [beside, far]) {
          await until(page, ([weapon, mods, slot]) => {
            const r = [...window.__op2.ctx.coop.remotes.values()].find(r => r.player.slot === slot);
            return r && r.watcher.holding === weapon && mods.every(m => r.watcher.has(m));
          }, [c.weapon, mods, await shooter.evaluate(() => window.__op2.ctx.coop.lobby.me.slot)], 8000);
        }
        if (set.launcher) await until(shooter, () => window.__op2.ctx.weapons.drawLeft <= 0);
        // The case's own switch on the shooter: the Autoraffica's smart aim on, or a perk that colours its rounds.
        if (c.prep) await shooter.evaluate(what => {
          const { ctx } = window.__op2;
          if (what === 'smart') ctx.weapons.smartOn = true;
          else ctx.progression.grant(what);
        }, c.prep);
        if (c.before) { await shooter.evaluate(hold, [c.before, true]); await sleep(120); await shooter.evaluate(hold, [c.before, false]); await sleep(200); }
        await sleep(500);
        for (const page of party.pages) await page.evaluate(record);
        const before = await Promise.all(party.pages.map(p => p.evaluate(read)));
        const fire = c.fire;
        let mids = null;
        const pair = async () => {
          if (!round.shots) return;
          const a = `${outDir}/${c.id}-shooter-${TAG}.png`, b = `${outDir}/${c.id}-watcher-${TAG}.png`, d = `${outDir}/${c.id}-far-${TAG}.png`;
          await Promise.all([shooter.screenshot({ path: a, timeout: 120000 }), beside.screenshot({ path: b, timeout: 120000 }), far.screenshot({ path: d, timeout: 120000 })]);
          out.screenshots.push(a, b, d);
        };
        const started = Date.now();
        if (fire.pump) await shooter.evaluate(pump, [action, fire.pump]);
        else if (fire.kata) out.kata = await shooter.evaluate(() => window.__op2.ctx.weapons.kata());
        else await shooter.evaluate(hold, [action, true]);
        const shotAt = async () => { await sleep(Math.max(0, (c.shotAt ?? 200) - (Date.now() - started))); };
        if (fire.chargeTo) {
          // A charge under way, not let go: the watchers see it gather for a moment, then it is cancelled.
          await until(shooter, level => window.__op2.ctx.weapons.charge >= level, fire.chargeTo);
          await sleep(350);
          await pair();
          await shooter.evaluate(hold, [c.cancel, true]); await sleep(120); await shooter.evaluate(hold, [c.cancel, false]);
          await shooter.evaluate(hold, [action, false]);
        } else if (fire.charge) {
          await until(shooter, () => window.__op2.ctx.weapons.charge >= 1);
          await shooter.evaluate(hold, [action, false]);
          // The shot is under way on the shooter: read the watchers a moment into it, and take the pictures then.
          await until(shooter, kind => { const l = window.__op2.ctx.weapons.lance; return kind === 'beam' ? l.beaming : !!l.giantAt; }, c.during);
          // Each watcher is read once the shot is under way there too (on a slow link the word takes two hops to the other guest).
          await sleep(250);
          await Promise.all([beside, far].map(page => until(page, kind => [...window.__op2.ctx.coop.remotes.values()].some(r => kind === 'beam' ? r.watcher.beaming : !!r.watcher.giantAt), c.during, 1500)));
          mids = await Promise.all(party.pages.map(p => p.evaluate(read)));
          await pair();
        } else if (fire.kata) {
          await shotAt();
          await pair();
          await sleep(Math.max(0, fire.kata - (Date.now() - started)));
        } else if (fire.pump) {
          await shotAt();
          await pair();
          await sleep(Math.max(0, fire.ms - (Date.now() - started)));
          await shooter.evaluate(unpump, action);
        } else if (fire.hold) {
          await shotAt();
          if (c.during) mids = await Promise.all(party.pages.map(p => p.evaluate(read)));
          await pair();
          await sleep(Math.max(0, fire.hold - (Date.now() - started)));
          if (c.cancel) { await shooter.evaluate(hold, [c.cancel, true]); await sleep(80); await shooter.evaluate(hold, [c.cancel, false]); }
          await shooter.evaluate(hold, [action, false]);
        } else {
          await sleep(fire.tap);
          await shooter.evaluate(hold, [action, false]);
          await shotAt();
          await pair();
        }
        await sleep(c.settle + (NET ? 500 : 0));
        if (c.prep === 'smart') await shooter.evaluate(() => { window.__op2.ctx.weapons.smartOn = false; });
        // A perk granted for a case ends with the case: Bloodthirst's bottomless magazine made the reload case that follows
        // a reload that never happens (nothing to reload), on the shooter's own screen as on the watchers'.
        else if (c.prep) await shooter.evaluate(what => window.__op2.ctx.progression.perks.stop(what), c.prep);
        if (c.after) { await shooter.evaluate(hold, [c.after, true]); await sleep(120); await shooter.evaluate(hold, [c.after, false]); }
        const after = await Promise.all(party.pages.map(p => p.evaluate(read)));
        const of = page => { const i = party.pages.indexOf(page); const d = delta(after[i], before[i]); if (mids) d.mid = mids[i]; return d; };
        const s = of(shooter);
        const result = { shooter: { sent: s.sent, fx: s.log.fx, sounds: s.log.sounds, decals: s.log.decals }, watchers: {}, failed: [], bytes: s.sent.bytes };
        for (const [name, page] of [['beside', beside], ['far', far]]) {
          const w = of(page);
          const ok = (condition, message, detail) => {
            const line = `${round.name} / ${c.id} / ${name}: ${message}`;
            if (condition) out.checks.push(line);
            else { result.failed.push({ line, detail }); out.failed.push({ line, detail }); }
          };
          c.expect(s, w, ok, info);
          // What holds for every weapon: nothing of a friend's gun plays in the watcher's own head, the watcher sent nothing
          // of its own, and nothing drawn hurt or lit anything on the watcher's copy of the enemies.
          // (Not a weapon's: the team's slow-mo coming and going, which Gun Kata starts, and the watcher's own perk running out.)
          const flat = w.log.flat.filter(id => !/^(ui_|music|hit_|kill_|headshot|loop:amb|amb_|step|foot|land|wind|heartbeat|loop:wind|loop:music|time_warp_|perk_)/.test(id));
          ok(flat.length === 0, 'no sound of the friend\'s weapon is unplaced', flat);
          ok(sum(w.sent) - w.sent.bytes - w.sent.held === 0, 'the watcher sent nothing of its own', w.sent);
          result.watchers[name] = { drawn: w.drawn, watched: w.watched, fx: w.log.fx, decals: w.log.decals, sounds: w.log.sounds, loops: w.log.loops, lights: w.log.lights };
        }
        out.cases[key][c.id] = result;
        out.bytes[`${key}/${c.id}`] = { bytes: s.sent.bytes, events: s.sent.fire + s.sent.round + s.sent.loop + s.sent.mfx, ms: Date.now() - started };
        progress(`  ${result.failed.length ? `FAILED ${result.failed.length}: ${result.failed.map(f => f.line.split(': ').slice(1).join(': ')).join(' | ')}` : 'ok'} (${s.sent.bytes} bytes sent)`);
        save();
      }
    }
  } catch (error) {
    out.errors.push(String(error?.stack ?? error));
  }
  save();
  return { checks: out.checks.length, failed: out.failed.map(f => f.line), errors: out.errors, screenshots: out.screenshots.length };
}
