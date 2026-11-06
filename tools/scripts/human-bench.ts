// How dangerous are the humans to a player who moves? Real Player controller on real Rapier, real EnemyManager and squads on the real Kill
// House, and real ballistics: every round is flown, swept against the walls and the player's capsule with the game's own radii, and every
// blast uses the game's own falloff. Only rendering and gore are stood in for, so this measures damage and decisions, never feel.
//
//   nice -n 19 npx tsx tools/scripts/human-bench.ts <bot> [seconds] [seed] [wave]
//
// Bots:
//   runner   full speed round the map, never stops, never fires. The careless player
//   strafe   holds a yard at 25 m from the men and sidesteps at full speed, turning every second. The good player
//   camper   stands in one room
//   fighter  runs the map and shoots what it sees, about as well as a decent player
//   duelist  holds ground in the Kill House, sidesteps, fights back and moves on when a man gets close. A player in a real fight
//
// Damage is counted, not applied, so a run lasts its full length: `deaths` is how often the same damage would have killed a player with
// the real 100 health and regen. Writes tools/out/bench-<bot>-<seed>.json.
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';

const globals = globalThis as unknown as Record<string, unknown>;
globals.location = { search: '?contract=outpost&map=killhouse' };
const gradient = { addColorStop() {} };
const paint: unknown = new Proxy({}, {
  get: (_, key) => (key === 'measureText' ? () => ({ width: 100 }) : String(key).endsWith('Gradient') ? () => gradient : () => undefined),
  set: () => true,
});
globals.document = { createElement: () => ({ getContext: () => paint, style: {}, width: 0, height: 0 }) };

const bot = process.argv[2] ?? 'runner';
const seconds = Number(process.argv[3] ?? 120);
const seed = Number(process.argv[4] ?? 3);
const startWave = Number(process.argv[5] ?? 1);

const { mulberry32 } = await import('../../src/core/math');
Math.random = mulberry32(seed);
const { createHeadlessGame } = await import('../../src/player/testkit/headless');
const { World } = await import('../../src/world/World');
const { EnemyManager } = await import('../../src/enemies/EnemyManager');
const { noop } = await import('../../src/core/stubs');
const { soldierOf } = await import('../../src/enemies/outpost');
const { Route } = await import('../../src/enemies/outpost/routes');
const { EXPLOSIONS } = await import('../../src/weapons/data');
const { CG } = await import('../../src/core/contracts');

function fakeCharacter(id: string): unknown {
  const root = new THREE.Group();
  const bones = Array.from({ length: 17 }, () => new THREE.Bone());
  for (const b of bones) root.add(b);
  // Rounds have to leave from a man, so the barrel is a real point on the body.
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.2, 1.42, 0.55);
  root.add(muzzle);
  const anim = {
    posture: 'stand', onFootstep: null, setLocomotion() {}, play: () => 0, flinch() {}, update() {}, disarm() {}, rearm() {},
    setPosture(p: string) { this.posture = p; },
  };
  return {
    archetype: id, rig: { height: 1.85, bones: [] }, root, bones, mesh: root, anim, severed: new Set(), props: [], muzzle,
    hideLimb() {}, addWound() {}, setBloodiness() {}, hitFlash() {}, attachProp() {}, setBurn() {}, setFrost() {}, setLod() {}, release() { root.removeFromParent(); },
    fracture() { return true; }, isFractured() { return false; },
  };
}

const game = await createHeadlessGame(() => {});
const ctx = game.ctx as unknown as Record<string, any>;
ctx.render.scene = new THREE.Scene();
ctx.render.materials = { patch: (m: unknown) => m };
ctx.render.decals = noop('decals');
ctx.characters = { spawn: fakeCharacter };
ctx.hud = noop('hud');
ctx.progression = noop('progression');
ctx.weapons = noop('weapons');
ctx.campaign = noop('campaign');

const PLAYER_RADIUS = 0.45;
const WHIZZ_RADIUS = 3;
const MAX_HEALTH = 100, REGEN = 5, REGEN_DELAY = 3;

interface Round { pos: THREE.Vector3; vel: THREE.Vector3; damage: number; source: string; left: number; whizzed: boolean; gravity: number; fuse: number; explosion: any; kind: string }
const rounds: Round[] = [];
const stats = {
  fired: {} as Record<string, number>, hit: {} as Record<string, number>, damage: {} as Record<string, number>, nearMisses: 0, grenades: 0, flash: 0, rockets: 0, blastDamage: 0,
  behind: 0, deaths: 0,
};
let pressureAt = -99;

const player = game.player;
const eye = new THREE.Vector3();
function capsule(a: THREE.Vector3, b: THREE.Vector3): { d: number; at: number } {
  // Closest approach of the segment a-b to the player's upright capsule.
  const top = player.eye;
  const p = player.position;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const ex = top.x - p.x, ey = top.y - p.y, ez = top.z - p.z;
  const rx = a.x - p.x, ry = a.y - p.y, rz = a.z - p.z;
  const A = dx * dx + dy * dy + dz * dz, E = ex * ex + ey * ey + ez * ez, F = ex * rx + ey * ry + ez * rz;
  const C = dx * rx + dy * ry + dz * rz, B = dx * ex + dy * ey + dz * ez;
  const den = A * E - B * B;
  let s = den > 1e-9 ? Math.min(1, Math.max(0, (B * F - C * E) / den)) : 0;
  let t = E > 1e-9 ? (B * s + F) / E : 0;
  if (t < 0) { t = 0; s = A > 1e-9 ? Math.min(1, Math.max(0, -C / A)) : 0; }
  else if (t > 1) { t = 1; s = A > 1e-9 ? Math.min(1, Math.max(0, (B - C) / A)) : 0; }
  const qx = a.x + dx * s - (p.x + ex * t), qy = a.y + dy * s - (p.y + ey * t), qz = a.z + dz * s - (p.z + ez * t);
  return { d: Math.hypot(qx, qy, qz), at: s };
}

const hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
const dirTmp = new THREE.Vector3();
const endTmp = new THREE.Vector3();

let now = 0;
let health = MAX_HEALTH, lastHurt = -99;
const hurt = (amount: number, source: string, from: THREE.Vector3): void => {
  stats.damage[source] = (stats.damage[source] ?? 0) + amount;
  health -= amount;
  lastHurt = now;
  pressureAt = now;
  dirTmp.subVectors(from, player.position).setY(0).normalize();
  if (dirTmp.dot(player.forward) < 0.3) stats.behind += amount;
  ctx.events.emit('player:damaged', { amount, from, type: 'bullet' });
  if (health <= 0) {
    stats.deaths++;
    health = MAX_HEALTH;
  }
};

function blast(center: THREE.Vector3, spec: { radius: number; damage: number; kind: string; team?: string; source?: string }, source: string): void {
  if (spec.team === 'player') return;
  const def = (EXPLOSIONS as Record<string, any>)[spec.kind] ?? { edgeDamage: 0.3 };
  const near = player.position.clone().setY(Math.min(Math.max(center.y, player.position.y), player.eye.y));
  const d = near.distanceTo(center);
  if (d > spec.radius) return;
  dirTmp.subVectors(near, center);
  if (d > 0.05) {
    dirTmp.divideScalar(d);
    if (!def.ignoresCover && ctx.physics.raycastInto(center, dirTmp, d, CG.World, hit)) return;
  }
  const amount = spec.damage * (1 - (d / spec.radius) * (1 - def.edgeDamage));
  stats.blastDamage += amount;
  hurt(amount, source, center);
}

ctx.combat = {
  spawnProjectile(p: any) {
    if (p.kind === 'grenade') stats[p.source === 'flashbang' ? 'flash' : 'grenades']++;
    else if (p.kind === 'rocket') stats.rockets++;
    else stats.fired[p.source] = (stats.fired[p.source] ?? 0) + 1;
    rounds.push({
      pos: p.origin.clone(), vel: p.velocity.clone(), damage: p.damage, source: p.source, left: p.fuse ?? p.lifetime ?? 2.5, whizzed: false, gravity: p.gravity ?? 0, fuse: p.fuse ?? 0, explosion: p.explosion ?? null, kind: p.kind,
    });
  },
  enemyMuzzle() {},
  explode(at: THREE.Vector3, spec: any) { blast(at, spec, spec.source ?? 'blast'); },
  fireRay(from: THREE.Vector3, dir: THREE.Vector3, spec: any) {
    stats.fired[spec.source] = (stats.fired[spec.source] ?? 0) + 1;
    const max = spec.maxDistance ?? 240;
    const wall = ctx.physics.raycastInto(from, dir, max, CG.World, hit);
    endTmp.copy(from).addScaledVector(dir, wall ? hit.distance : max);
    const c = capsule(from, endTmp);
    if (c.d < PLAYER_RADIUS) {
      stats.hit[spec.source] = (stats.hit[spec.source] ?? 0) + 1;
      hurt(spec.damage, spec.source, from);
    } else if (c.d < WHIZZ_RADIUS) {
      stats.nearMisses++;
      pressureAt = now;
    }
    return null;
  },
};

function flyRounds(dt: number): void {
  for (let i = rounds.length - 1; i >= 0; i--) {
    const r = rounds[i]!;
    r.left -= dt;
    r.vel.y += r.gravity * dt;
    const step = r.vel.length() * dt;
    dirTmp.copy(r.vel).normalize();
    const grenade = r.kind === 'grenade';
    const wall = ctx.physics.raycastInto(r.pos, dirTmp, step, CG.World, hit);
    endTmp.copy(r.pos).addScaledVector(dirTmp, wall ? hit.distance : step);
    const c = grenade ? null : capsule(r.pos, endTmp);
    if (c && c.d < PLAYER_RADIUS) {
      if (r.explosion) blast(endTmp, r.explosion, r.source);
      else {
        stats.hit[r.source] = (stats.hit[r.source] ?? 0) + 1;
        hurt(r.damage, r.source, r.pos.clone());
      }
      rounds.splice(i, 1);
      continue;
    }
    if (c && !r.whizzed && c.d < WHIZZ_RADIUS) {
      r.whizzed = true;
      stats.nearMisses++;
      pressureAt = now;
    }
    if (wall) {
      if (grenade) {
        r.pos.copy(hit.point).addScaledVector(hit.normal, 0.1);
        r.vel.multiplyScalar(0.25);
        r.vel.y = Math.abs(r.vel.y) * 0.3;
      } else {
        if (r.explosion) blast(hit.point.clone().addScaledVector(hit.normal, 0.2), r.explosion, r.source);
        rounds.splice(i, 1);
        continue;
      }
    } else r.pos.copy(endTmp);
    if (r.left <= 0) {
      if (r.explosion) blast(r.pos, r.explosion, r.source);
      rounds.splice(i, 1);
    }
  }
}

const world = new World(game.ctx);
ctx.world = world;
await world.build();
ctx.physics.flushQueries?.();
const manager = new EnemyManager(game.ctx);
ctx.enemies = manager;
const outpost = manager.outpost!;
const waves = outpost.waves;
ctx.waves = waves;
manager.init(game.ctx);

const SPAWN: Record<string, [number, number, number]> = { runner: [0, 0.1, -19], strafe: [-30, 0.1, 6], camper: [0, 0.1, -19], fighter: [0, 0.1, -19], duelist: [-30, 0.1, 6] };
player.teleport(new THREE.Vector3(...SPAWN[bot]!), 0);
manager.reset();
waves.start();
if (startWave > 1) waves.jumpTo(startWave);
// The bench counts damage itself, so that nothing ends the run early.
player.modifiers.invulnerable = true;

const input = game.input;
const route = new Route();
const STATIONS: [number, number, number][] = [[6.6, 0.1, 3], [11.7, 0.1, -11.7], [0, 0.1, -19], [-19, 0.1, -19], [-30, 0.1, 6], [-20, 0.1, 31], [19, 0.1, 19], [30, 0.1, -4]];
let station = 0, turnClock = 0, side = 1, fireClock = 0, stuck = 0;
const goal = new THREE.Vector3();

function steer(to: THREE.Vector3): void {
  player.yaw = Math.atan2(-(to.x - player.position.x), -(to.z - player.position.z));
}

function drive(dt: number): void {
  turnClock -= dt;
  if (bot === 'duelist') {
    // Stands and fights until someone is on top of it, then runs to the next ground and turns round.
    let near: any = null, nearD = 60;
    for (const e of manager.alive) if (e.dist < nearD && soldierOf(e)?.fighting) { near = e; nearD = e.dist; }
    const moving = route.count > 0 && !route.done;
    if (!moving && nearD < 8) {
      station = (station + 3) % STATIONS.length;
      goal.set(...STATIONS[station]!);
      outpost.routes.find(player.position, goal, route, null);
      route.next = 0;
    }
    if (route.count > 0 && !route.done) {
      input.simulate('left', false);
      input.simulate('right', false);
      if (Math.hypot(route.x[route.next]! - player.position.x, route.z[route.next]! - player.position.z) < 1.6) route.next++;
      if (!route.done) {
        steer(eye.set(route.x[route.next]!, 0, route.z[route.next]!));
        input.simulate('forward', true);
        return;
      }
    }
    input.simulate('forward', false);
    if (turnClock <= 0) {
      turnClock = 0.5 + Math.random() * 0.7;
      side = -side;
      input.simulate('left', side < 0);
      input.simulate('right', side > 0);
    }
    if (near) steer(near.position);
    return;
  }
  if (bot === 'runner' || bot === 'fighter') {
    // A bot that runs into a corner picks the next station, because a player would not stand there pushing on the wall.
    stuck = player.speed < 3 ? stuck + dt : 0;
    if (route.count === 0 || route.done || stuck > 0.5) {
      stuck = 0;
      station = (station + 1) % STATIONS.length;
      goal.set(...STATIONS[station]!);
      outpost.routes.find(player.position, goal, route, null);
      route.next = 0;
    }
    if (route.count > 0 && !route.done) {
      const d = Math.hypot(route.x[route.next]! - player.position.x, route.z[route.next]! - player.position.z);
      if (d < 1.6) route.next++;
      if (!route.done) {
        steer(eye.set(route.x[route.next]!, 0, route.z[route.next]!));
        input.simulate('forward', true);
      }
    }
    return;
  }
  if (bot === 'strafe') {
    if (turnClock <= 0) {
      turnClock = 0.7 + Math.random() * 0.6;
      side = -side;
      input.simulate('left', side < 0);
      input.simulate('right', side > 0);
    }
    // Facing whoever is nearest, as anyone in a firefight is.
    let best: any = null, bestD = 60;
    for (const e of manager.alive) if (e.dist < bestD && soldierOf(e)?.fighting) { best = e; bestD = e.dist; }
    if (best) steer(best.position);
  }
}

const damage = (e: any, amount: number) => ({
  amount, type: 'bullet', point: e.center.clone(), dir: e.center.clone().sub(player.eye).normalize(), force: 0, source: 'smg', region: 'chest',
});

function shoot(dt: number): void {
  if (bot !== 'fighter' && bot !== 'duelist') return;
  fireClock -= dt;
  if (fireClock > 0) return;
  let best: any = null, bestD = 34;
  for (const e of manager.alive) {
    const s = soldierOf(e);
    if (!e.hasLos || e.dist >= bestD || s?.surrendered || (s?.stage === 'hide' && s.spot)) continue;
    best = e;
    bestD = e.dist;
  }
  if (!best) return;
  fireClock = 0.3;
  ctx.events.emit('weapon:fired', { weapon: 'smg', origin: player.eye.clone(), dir: best.center.clone().sub(player.eye).normalize() });
  if (Math.random() < 0.5) manager.applyDamage(best, damage(best, 22) as never);
}

const dt = 1 / 60;
const seen = { seconds: 0, hostileSeconds: 0, pressured: 0, longestQuiet: 0, quietSince: -1, contactAt: -1 };
const men = { total: 0, firing: 0, moving: 0, idle: 0, noTarget: 0, sees: 0 };
const modes: Record<string, number> = {};
const lastFired = new Map<number, number>();
const speedSum = { sum: 0, n: 0 };
const log: unknown[] = [];
ctx.events.on('comms:line', (l: any) => log.push({ t: +now.toFixed(1), who: l.speaker ?? l.squad, kind: l.kind, text: l.text }));
ctx.events.on('enemy:broken', (e: any) => log.push({ t: +now.toFixed(1), type: 'broken', fate: e.fate }));
ctx.events.on('enemy:surrendered', (e: any) => {
  const s = soldierOf(e.enemy)!;
  log.push({ t: +now.toFixed(1), type: 'surrendered', rank: s.rank, signs: outpost.captives.signs(s), sinceHit: +(now - s.hitAt).toFixed(1), hostile: outpost.hostile, peak: +outpost.peakHostile.toFixed(1), hp: +(e.enemy.health / e.enemy.maxHealth).toFixed(2) });
});
const drills: Record<string, { done: number; failed: number; seconds: number }> = {};
ctx.events.on('squad:drill', (d: any) => {
  const row = drills[d.drill] ??= { done: 0, failed: 0, seconds: 0 };
  if (d.done) row.done++;
  else row.failed++;
  row.seconds += d.seconds;
});
const ranks: Record<string, number> = {};
ctx.events.on('enemy:spawned', (e: any) => { const s = soldierOf(e.enemy); if (s) ranks[s.rank] = (ranks[s.rank] ?? 0) + 1; });
ctx.events.on('enemy:killed', () => log.push({ t: +now.toFixed(1), type: 'killed' }));

const t0 = performance.now();
for (let f = 0; f < seconds * 60; f++) {
  ctx.time.tick(dt);
  now = ctx.time.elapsed;
  drive(dt);
  player.update();
  manager.update();
  waves.update();
  world.update();
  flyRounds(dt);
  input.endFrame();
  shoot(dt);
  if (process.env.TRACE && f % 60 === 0) console.log(now.toFixed(0), player.position.toArray().map(v => v.toFixed(1)).join(','), 'speed', player.speed.toFixed(1), 'next', route.next, '/', route.count, 'st', station);

  if (now - lastHurt >= REGEN_DELAY) health = Math.min(MAX_HEALTH, health + REGEN * dt);
  speedSum.sum += player.speed;
  speedSum.n++;

  const hostile = outpost.hostile;
  if (hostile > 0) {
    seen.hostileSeconds += dt;
    if (seen.contactAt < 0 && pressureAt > 0) seen.contactAt = now;
    if (seen.contactAt >= 0) {
      seen.seconds += dt;
      if (now - pressureAt < 1) seen.pressured += dt;
      seen.longestQuiet = Math.max(seen.longestQuiet, now - pressureAt);
    }
  }
  if (f % 15 === 0) {
    for (const e of manager.alive) {
      const s = soldierOf(e);
      if (!s?.fighting) continue;
      men.total++;
      modes[s.squad.mode] = (modes[s.squad.mode] ?? 0) + 1;
      if (s.sees) men.sees++;
      if (e.attack) lastFired.set(e.uid, now);
      const fired = now - (lastFired.get(e.uid) ?? -99) < 2;
      if (e.attack) men.firing++;
      else if (s.task === 'move' || s.hasOrder) men.moving++;
      else if (fired) men.firing++;
      else if (s.sees) men.noTarget++;
      else men.idle++;
    }
  }
}

const share = (n: number): number => +(100 * n / Math.max(men.total, 1)).toFixed(1);
const totalDamage = Object.values(stats.damage).reduce((a, b) => a + b, 0);
const minutes = seconds / 60;
const report = {
  bot, seconds, seed, wave: waves.wave, kills: log.filter((l: any) => l.type === 'killed').length,
  speed: +(speedSum.sum / speedSum.n).toFixed(1),
  damagePerMinute: +(totalDamage / minutes).toFixed(1),
  deaths: stats.deaths,
  bySource: Object.fromEntries(Object.entries(stats.damage).map(([k, v]) => [k, Math.round(v)])),
  accuracy: Object.fromEntries(Object.keys(stats.fired).map(k => [k, `${stats.hit[k] ?? 0}/${stats.fired[k]}`])),
  nearMissesPerMinute: +(stats.nearMisses / minutes).toFixed(1),
  grenades: stats.grenades, flash: stats.flash, rockets: stats.rockets, blastDamage: Math.round(stats.blastDamage),
  fromBehindShare: +(100 * stats.behind / Math.max(totalDamage, 1)).toFixed(1),
  pressuredShare: +(100 * seen.pressured / Math.max(seen.seconds, 1e-3)).toFixed(1),
  longestQuiet: +seen.longestQuiet.toFixed(1),
  firstContact: +seen.contactAt.toFixed(1),
  manTime: { firing: share(men.firing), moving: share(men.moving), seesNoShot: share(men.noTarget), idle: share(men.idle), sees: share(men.sees) },
  modes,
  drills: Object.fromEntries(Object.entries(drills).map(([k, v]) => [k, `${v.done}/${v.done + v.failed} ${(v.seconds / Math.max(v.done + v.failed, 1)).toFixed(1)}s`])),
  ranks,
  orders: `${outpost.commander.orders.obeyed}/${outpost.commander.orders.issued}`,
  cracks: outpost.suppression.cracks,
  broken: log.filter((l: any) => l.type === 'broken').length, surrendered: log.filter((l: any) => l.type === 'surrendered').length,
  wall: Math.round(performance.now() - t0),
};
writeFileSync(`tools/out/bench-${bot}-${seed}.json`, JSON.stringify({ report, log }, null, 1));
console.log(JSON.stringify(report));
