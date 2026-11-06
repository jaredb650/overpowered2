// The Outpost's squads on the real Kill House, with no browser: real EnemyManager, real squad AI, real Rapier, real nav.
// Only rendering, gore and bullets are stood in for, so this proves movement and decisions, never how anything looks.
//
//   nice -n 19 npx tsx tools/scripts/outpost-sim.ts <scenario> [seconds] [seed]
//
// Scenarios: camp (player stands still, silent), hold (stands still, fires at what it sees), hunter (walks at them and
// fires), spree (kills fast, so squads break), rescue (a man goes down in the open), tour (walks the map, silent), berserk (the
// perk fires mid-fight), late (starts on wave 7, with every role in play), roles (one sniper squad and one riot squad, with the
// player out in the yard where the long lines are), wounds (one man in the open takes a hit in each zone in turn, and the log
// shows what became of him).
// Writes tools/out/outpost-<scenario>.json. tools/scripts/outpost-plot.py turns that into a top-down picture and numbers.
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

const scenario = process.argv[2] ?? 'hold';
const seconds = Number(process.argv[3] ?? 90);
const seed = Number(process.argv[4] ?? 7);

const { mulberry32 } = await import('../../src/core/math');
Math.random = mulberry32(seed);
const { createHeadlessGame } = await import('../../src/player/testkit/headless');
const { World } = await import('../../src/world/World');
const { EnemyManager } = await import('../../src/enemies/EnemyManager');
const { noop } = await import('../../src/core/stubs');
const { soldierOf } = await import('../../src/enemies/outpost');

function fakeCharacter(id: string): unknown {
  const root = new THREE.Group();
  const bones = Array.from({ length: 17 }, () => new THREE.Bone());
  for (const b of bones) root.add(b);
  const anim = {
    posture: 'stand', onFootstep: null, setLocomotion() {}, play: () => 0, flinch() {}, update() {}, disarm() {},
    setPosture(p: string) { this.posture = p; },
  };
  return {
    archetype: id, rig: { height: 1.85, bones: [] }, root, bones, mesh: root, anim, severed: new Set(), props: [], muzzle: null,
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

const counts = { rounds: 0, grenades: 0, flash: 0, rockets: 0 };
ctx.combat = {
  spawnProjectile(p: { kind: string; source: string }) {
    if (p.kind === 'bullet') counts.rounds++;
    else if (p.kind === 'grenade') counts[p.source === 'flashbang' ? 'flash' : 'grenades']++;
    else if (p.kind === 'rocket') counts.rockets++;
  },
  enemyMuzzle() {}, explode() {}, fireRay() { return null; },
};

const world = new World(game.ctx);
ctx.world = world;
await world.build();
ctx.physics.flushQueries?.();
const manager = new EnemyManager(game.ctx);
ctx.enemies = manager;
const waves = manager.outpost!.waves;
ctx.waves = waves;
manager.init(game.ctx);
const player = game.player;
player.modifiers.invulnerable = true;
const outpost = manager.outpost!;

const stations: Record<string, [number, number, number][]> = {
  camp: [[0, 0.1, -19]], hold: [[0, 0.1, -19]], rescue: [[0, 0.1, -19]], wounds: [[0, 0.1, -19]], berserk: [[0, 0.1, -19]], late: [[0, 0.1, -19]], roles: [[-30, 0.1, 6]],
  hunter: [[0, 0.1, -19], [19, 0.1, -19], [19, 0.1, 8], [-6, 0.1, 3], [-19, 0.1, 19]],
  spree: [[0, 0.1, 3]],
  tour: [[6.6, 0.1, 3], [11.7, 0.1, -11.7], [0, 0.1, -19], [-19, 0.1, -19], [-20, 0.1, 31], [19, 0.1, 19]],
};
const route = stations[scenario] ?? stations.hold!;
player.teleport(new THREE.Vector3(...route[0]!), 0);
manager.reset();
waves.start();
if (scenario === 'late') outpost.waves.jumpTo(7);
if (scenario === 'roles') {
  ctx.waves.update = () => {};
  player.update();
  manager.update();
  outpost.onWaveStart();
  for (const squad of [['sniper', 'trooper', 'trooper'], ['riot', 'riot', 'gunner', 'trooper']] as const) {
    outpost.formSquad(squad.length);
    for (const id of squad) outpost.sendIn(id);
  }
}

const log: unknown[] = [];
const on = (type: string, fn: (e: any) => unknown) => ctx.events.on(type, (e: unknown) => log.push({ t: +ctx.time.elapsed.toFixed(2), type, ...(fn(e) as object) }));
on('comms:line', e => ({ kind: e.kind, text: e.text, who: e.speaker ?? e.squad }));
on('enemy:broken', e => ({ uid: e.enemy.uid, fate: e.fate }));
on('enemy:surrendered', e => ({ uid: e.enemy.uid }));
on('enemy:wounded', e => ({ uid: e.enemy.uid, zone: e.zone, label: e.label }));
on('enemy:condition', e => ({ uid: e.enemy.uid, condition: e.condition }));
on('enemy:killed', e => ({ uid: e.enemy.uid, source: e.damage.source }));
on('enemy:escaped', e => ({ uid: e.enemy.uid }));
on('enemy:executed', e => ({ uid: e.kill.enemy.uid }));
on('squad:broken', e => e);
on('dread:spike', e => e);
on('wave:start', e => e);
on('wave:clear', e => e);
on('enemy:killed', e => ({ uid: e.enemy.uid, id: e.enemy.id, x: e.enemy.position.x, z: e.enemy.position.z }));

const damage = (e: any, amount: number) => ({
  amount, type: 'bullet', point: e.center.clone(), dir: e.center.clone().sub(player.eye).normalize(), force: 0, source: 'smg', region: 'chest',
});

const dt = 1 / 60;
const samples: unknown[] = [];
const fireGap = scenario === 'spree' ? 0.14 : 0.32;
const hitChance = scenario === 'spree' ? 0.9 : 0.5;
let sampleClock = 0, fireClock = 0, stationClock = 0, stationIndex = 0, rescued = false, perked = false;
/** Bone, then where on it the round goes in, travelling -Z, so through his front. Thigh, femoral, hand, arm, gut, carotid, lung. */
const WOUND_CASES: readonly (readonly [number, number, number, number])[] = [
  [11, 0.06, -0.2, 0.08], [14, 0.038, -0.1, 0.09], [10, 0, -0.05, 0.05], [8, 0, -0.2, 0.06], [1, 0, 0.08, 0.13], [3, 0.05, 0.04, 0.05], [2, -0.15, 0.1, 0.15],
];
let woundAt = 26, woundCase = 0;
let maxAlive = 0, airborne = 0, offGraph = 0, leaps = 0;
const wasAirborne = new Set<number>();
const walkDir = new THREE.Vector3();
const here = new THREE.Vector3();
const t0 = performance.now();

for (let f = 0; f < seconds * 60; f++) {
  ctx.time.tick(dt);
  player.update();
  manager.update();
  waves.update();
  world.update();
  ctx.input.endFrame();
  const t = ctx.time.elapsed;

  stationClock += dt;
  if ((scenario === 'hunter' || scenario === 'tour') && stationClock > 16 && route.length > 1) {
    stationClock = 0;
    stationIndex = (stationIndex + 1) % route.length;
  }
  // A plain walk from station to station, straight through whatever is in the way: the squads are what is under test.
  const target = route[stationIndex]!;
  walkDir.set(target[0] - player.position.x, 0, target[2] - player.position.z);
  const left = walkDir.length();
  if (left > 0.3) {
    here.copy(player.position).addScaledVector(walkDir.normalize(), Math.min(left, 6 * dt));
    player.teleport(here, Math.atan2(-walkDir.x, -walkDir.z));
  }

  if (scenario === 'berserk' && !perked && t > 30) {
    perked = true;
    ctx.events.emit('perk:start', { id: 'berserk', seconds: 10, label: 'BERSERK', color: '#f00' });
  }
  if (scenario === 'hold' || scenario === 'hunter' || scenario === 'spree' || scenario === 'late') {
    fireClock -= dt;
    if (fireClock <= 0) {
      let best: any = null, bestD = 40;
      for (const e of manager.alive) {
        const s = soldierOf(e);
        if (!e.hasLos || e.dist >= bestD || s?.surrendered || (s?.stage === 'hide' && s.spot && scenario !== 'spree')) continue;
        best = e;
        bestD = e.dist;
      }
      if (best) {
        fireClock = fireGap;
        ctx.events.emit('weapon:fired', { weapon: 'smg', origin: player.eye.clone(), dir: best.center.clone().sub(player.eye).normalize() });
        if (Math.random() < hitChance) manager.applyDamage(best, damage(best, scenario === 'spree' ? 45 : 25) as never);
      }
    }
  }

  if (scenario === 'rescue' && !rescued && t > 28) {
    const victim = manager.alive.find(e => outpost.intel.exposed(e.position.x, e.position.z) && e.dist > 8 && soldierOf(e)?.fighting);
    if (victim) {
      rescued = true;
      log.push({ t: +t.toFixed(2), type: 'downed', uid: victim.uid });
      // A blast that does not quite kill him: on the floor, on the clock, and able to stand if somebody gets to him.
      manager.applyDamage(victim, { ...damage(victim, victim.health + 1), type: 'explosive', region: undefined, bone: undefined } as never);
    }
  }

  // One zone at a time, on whoever is fighting and in the open, spaced so each plays out.
  if (scenario === 'wounds' && t > woundAt && woundCase < WOUND_CASES.length) {
    const victim = manager.alive.find(e => soldierOf(e)?.fighting && soldierOf(e)!.injuries.condition === 'healthy' && e.dist > 6 && e.hasLos);
    if (victim) {
      const c = WOUND_CASES[woundCase++]!;
      woundAt = t + 7;
      const [bone, x, y, z] = c;
      log.push({ t: +t.toFixed(2), type: 'wound', uid: victim.uid, id: victim.id, bone, at: [x, y, z] });
      manager.applyDamage(victim, { ...damage(victim, 30), point: new THREE.Vector3(x, y, z), dir: new THREE.Vector3(0, 0, -1), bone, region: 'chest' } as never);
    }
  }

  maxAlive = Math.max(maxAlive, outpost.hostile);
  for (const e of manager.alive) {
    if (e.airborne) {
      airborne++;
      if (!wasAirborne.has(e.uid)) {
        wasAirborne.add(e.uid);
        leaps++;
        log.push({ t: +t.toFixed(2), type: 'airborne', uid: e.uid, id: e.id, at: e.position.toArray().map(v => +v.toFixed(2)), ground: e.groundY, flight: e.flightLeft, vy: e.verticalSpeed, mode: e.mode, task: soldierOf(e)?.task, b: e.behaviour?.name });
      }
    } else wasAirborne.delete(e.uid);
  }

  sampleClock -= dt;
  if (sampleClock <= 0) {
    sampleClock = 0.25;
    const men = manager.alive.map(e => {
      const s = soldierOf(e);
      const nav = ctx.world.nav.nearest(e.position, 1.5, here);
      if (!nav) offGraph++;
      return s ? {
        u: e.uid, id: e.id, q: s.squad.name, tm: s.team, r: s.role, l: s.isLeader ? 1 : 0, m: s.squad.mode, k: s.task, st: s.stage, f: s.fate, b: e.behaviour?.name ?? '-',
        ms: s.state, mo: Math.round(s.morale), see: s.sees ? 1 : 0, ex: s.exposed ? 1 : 0, sp: s.spot ? 1 : 0, sh: s.canShoot ? 1 : 0, mt: s.squad.movingTeam, a: e.attack?.name ?? '',
        x: +e.position.x.toFixed(2), y: +e.position.y.toFixed(2), z: +e.position.z.toFixed(2), v: +Math.hypot(e.velocity.x, e.velocity.z).toFixed(2),
        pose: (e.char.anim as unknown as { posture: string }).posture, sec: s.squad.sector, fl: s.squad.filing ? 1 : 0,
        c: s.injuries.condition, wp: s.weapon,
      } : { u: e.uid, id: e.id, x: e.position.x, z: e.position.z };
    });
    samples.push({
      t: +t.toFixed(2), px: +player.position.x.toFixed(2), py: +player.position.y.toFixed(2), pz: +player.position.z.toFixed(2), dread: +outpost.dread.value.toFixed(1),
      hostile: outpost.hostile, prisoners: outpost.prisoners, wave: waves.wave, phase: waves.phase, men,
    });
  }
}

const plan = world.spec.plan!;
const out = {
  scenario, seconds, seed,
  wall: Math.round(performance.now() - t0),
  stats: { maxAlive, airborneFrames: airborne, leaps, offGraph, ...counts, coverSpots: outpost.cover.spots.length, nodes: world.navGraph.nodeCount },
  plan: { walls: plan.walls, blocks: plan.blocks, doors: plan.doors, gates: plan.gates, spots: outpost.cover.spots.map(s => [s.position.x, s.position.y, s.position.z, s.low, s.tall]) },
  log, samples,
};
writeFileSync(`tools/out/outpost-${scenario}.json`, JSON.stringify(out));
console.log(JSON.stringify({ scenario, ...out.stats, wall: out.wall, events: log.length, wave: waves.wave, hostile: outpost.hostile, prisoners: outpost.prisoners, dread: +outpost.dread.value.toFixed(1) }));
