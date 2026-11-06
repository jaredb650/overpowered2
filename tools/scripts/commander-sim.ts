// The Commander on the real Kill House with no browser: real EnemyManager, squads, Rapier and nav, with rendering, gore and bullets stood
// in for. It proves what the director picks and that each answer really turns up and works, never how anything looks.
//
//   nice -n 19 npx tsx tools/scripts/commander-sim.ts <bot> [seconds] [seed]
//
// Bots play a habit and clear waves by killing a man now and then, so that a run moves on:
//   camper   stands in one spot                       expects mortars or snipers
//   sonar    walks, and pings on every cooldown       expects jammers
//   route    walks the same two doors over and over   expects mines
//   idle     does nothing the Commander can read      expects standing orders
// `force=<id,id>` fields answers from the start, `wave=<n>` starts there, `kill=0` leaves the men alive.
// Writes tools/out/commander-<bot>.json.
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';

const opts = Object.fromEntries(process.argv.slice(5).map(a => a.split('=')));
const globals = globalThis as unknown as Record<string, unknown>;
const flags = new URLSearchParams({ contract: 'outpost', map: 'killhouse', dev: '1' });
if (opts.force) flags.set('cmd', opts.force);
if (opts.wave) flags.set('cmdwave', opts.wave);
globals.location = { search: `?${flags}` };
const gradient = { addColorStop() {} };
const paint: unknown = new Proxy({}, {
  get: (_, key) => (key === 'measureText' ? () => ({ width: 100 }) : String(key).endsWith('Gradient') ? () => gradient : () => undefined),
  set: () => true,
});
globals.document = { createElement: () => ({ getContext: () => paint, style: {}, width: 0, height: 0 }) };

const bot = process.argv[2] ?? 'camper';
const seconds = Number(process.argv[3] ?? 150);
const seed = Number(process.argv[4] ?? 7);
const killing = opts.kill !== '0';

const { mulberry32 } = await import('../../src/core/math');
Math.random = mulberry32(seed);
const { createHeadlessGame } = await import('../../src/player/testkit/headless');
const { World } = await import('../../src/world/World');
const { EnemyManager } = await import('../../src/enemies/EnemyManager');
const { noop } = await import('../../src/core/stubs');

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
ctx.render.materials = { patch: (m: unknown) => m, world: () => new THREE.MeshBasicMaterial() };
ctx.render.decals = noop('decals');
ctx.render.lights = noop('lights');
ctx.render.highlight = () => {};
ctx.characters = { spawn: fakeCharacter };
ctx.hud = noop('hud');
ctx.progression = { pickups: [] as unknown[], spawnPickup() {}, shootDown: () => true };
ctx.weapons = noop('weapons');
ctx.contracts = { sonar: { live: 0, wait: 0, limit: 8 } };

const blasts: Record<string, number> = {};
let hurt = 0;
ctx.combat = {
  spawnProjectile() {},
  enemyMuzzle() {},
  explode(_p: unknown, spec: { source: string; damage: number }) {
    blasts[spec.source] = (blasts[spec.source] ?? 0) + 1;
    hurt += spec.damage;
  },
  fireRay() { return null; },
};

const world = new World(game.ctx);
ctx.world = world;
await world.build();
ctx.physics.flushQueries?.();
const manager = new EnemyManager(game.ctx);
ctx.enemies = manager;
const outpost = manager.outpost!;
const commander = outpost.commander;
const waves = outpost.waves;
ctx.waves = waves;
manager.init(game.ctx);
const player = game.player;
player.modifiers.invulnerable = true;

const HOME: [number, number, number] = [0, 0.1, -19];
const LOOP: [number, number, number][] = [[-7.4, 0.1, -19], [-7.4, 0.1, -12], [7.4, 0.1, -12], [7.4, 0.1, -19]];
/** Up and down one hall, through no doors, so the only habit it shows is the one on the key. */
const PACE: [number, number, number][] = [[-7.4, 0.1, -19], [7.4, 0.1, -19]];
const stations = bot === 'route' ? LOOP : bot === 'sonar' ? PACE : [HOME];
player.teleport(new THREE.Vector3(...stations[0]!), 0);
manager.reset();
waves.start();

const log: unknown[] = [];
const say = (text: string) => { log.push(`${ctx.time.elapsed.toFixed(1)} ${text}`); };
ctx.events.on('wave:start', (e: { wave: number; total: number }) => say(`wave ${e.wave} starts, ${e.total} men, ${JSON.stringify(commander.describe())}`));
ctx.events.on('wave:clear', (e: { wave: number }) => say(`wave ${e.wave} clear`));
ctx.events.on('commander:briefing', (b: any) => say(`briefing after wave ${b.wave}: answer ${b.adaptation}, tricks ${b.tricks}, habits ${JSON.stringify(habitsNow())}`));
ctx.events.on('commander:status', (e: { flag: string; on: boolean }) => say(`status ${e.flag} ${e.on}`));
ctx.events.on('comms:line', (l: { kind: string; speaker: string | null; text: string }) => { if (l.kind === 'order') say(`radio ${l.speaker}: ${l.text}`); });

const habitsNow = () => Object.fromEntries(Object.entries(commander.tracker.habits()).filter(([, v]) => (v as number) > 0.05).map(([k, v]) => [k, +(v as number).toFixed(2)]));

const dt = 1 / 60;
let index = 0;
let killAt = 25;
let pingAt = 5;
let fireAt = 0;
const walk = new THREE.Vector3();
const here = new THREE.Vector3();
const t0 = performance.now();
let sawSpotter = 0;

for (let f = 0; f < seconds * 60; f++) {
  ctx.time.tick(dt);
  player.update();
  manager.update();
  waves.update();
  world.update();
  ctx.input.endFrame();
  const t = ctx.time.elapsed;

  const target = stations[index]!;
  walk.set(target[0] - player.position.x, 0, target[2] - player.position.z);
  const left = walk.length();
  if (left > 0.4) {
    here.copy(player.position).addScaledVector(walk.normalize(), Math.min(left, 6 * dt));
    player.teleport(here, Math.atan2(-walk.x, -walk.z));
  } else if (stations.length > 1) index = (index + 1) % stations.length;

  if (bot === 'sonar' && t >= pingAt) {
    pingAt = t + 8.2;
    ctx.events.emit('sonar:ping', { origin: player.eye });
  }
  if (t >= fireAt && bot !== 'idle') {
    fireAt = t + 0.25;
    ctx.events.emit('weapon:fired', { weapon: 'smg', origin: player.eye, dir: player.forward });
  }
  const spotter = commander.units.first('spotter');
  if (spotter?.s.sees) sawSpotter += dt;

  if (killing && t >= killAt) {
    killAt = t + 1.5;
    const list = manager.alive.filter((e: any) => outpost.soldierOf(e)?.fighting);
    // The regulars go first, as they would: the man on the far post is the last one anybody reaches.
    const victim = list.find((e: any) => !outpost.soldierOf(e)?.squad.directed) ?? list[0];
    if (victim) {
      manager.applyDamage(victim, {
        amount: 9999, type: 'bullet', point: victim.center.clone(), dir: new THREE.Vector3(0, 0, 1), force: 0, source: 'smg', region: 'chest',
      } as never);
    }
  }
}

const out = {
  bot, seconds, seed, wave: waves.wave, cpuSeconds: +((performance.now() - t0) / 1000).toFixed(1), fielded: commander.fielded, blasts, hurt: Math.round(hurt),
  missions: commander.mortars.missions, spotterSawSeconds: +sawSpotter.toFixed(1), describe: commander.describe(), habits: habitsNow(),
};
writeFileSync(`tools/out/commander-${bot}.json`, JSON.stringify({ ...out, log }, null, 1));
console.log(JSON.stringify(out, null, 1));
console.log(log.slice(-45).join('\n'));
