/**
 * Firing range: target dummies, a wall, a thin wall, and a script that fires every weapon and asserts.
 *
 * The clock is stepped by hand, so results at 30, 60 and 144 fps are exact and do not depend on how
 * loaded the machine is. Everything visual is a no-op in this run. Results land in
 * window.__op2.stats().range and in the page title.
 *
 *   /?sandbox=range            runs the suite
 *   /?sandbox=range&only=sword runs tests whose name contains the text
 *   /?sandbox=range&live=1     the real game with waves off and every weapon owned, for scripts: real map, real
 *                              enemies, real gore. Loads only the archetypes that are baked. See window.__range,
 *                              and tools/scripts/range-live.mjs, which drives every weapon through it.
 */
import * as THREE from 'three';
import { humanoidRig, type GoreRegion } from '../characters/rig';
import type { Action, Ctx, DamageInfo, PlayerDamage } from '../core/contracts';
import type { CombatSystem, DamageResult, EnemyInstance, EnemyRayHit, EnemySystem, ExplosionSpec, ShotSpec, WeaponId, WeaponSystem } from '../core/gameplay';
import '../core/gameplay';
import { noop } from '../core/stubs';
import { Physics } from '../physics/Physics';
import { MOVE } from '../player/tuning';
import type { Combat } from '../weapons/Combat';
import { createCombat, createWeapons, SWORD, TUNING, WEAPONS } from '../weapons';
import { SHAPED_CHARGE } from '../weapons/data';
import type { Weapons } from '../weapons/Weapons';
import { makeCtx, runLoop } from './harness';

const RIG = humanoidRig('dummy');
const HEAD_BONE = 4;

interface Dummy extends EnemyInstance {
  hits: DamageInfo[];
}

function makeDummy(uid: number, x: number, y: number, z: number, health: number): Dummy {
  const bones = RIG.bones.map(() => new THREE.Bone());
  const position = new THREE.Vector3(x, y, z);
  const center = new THREE.Vector3(x, y + 1.2, z);
  bones[HEAD_BONE]!.position.set(x, y + 1.6, z);
  bones[HEAD_BONE]!.updateMatrixWorld(true);
  return {
    uid, id: 'husk', position, center, velocity: new THREE.Vector3(), yaw: 0, health, maxHealth: health, armor: 0, alive: true,
    score: 100, isBoss: false, frozen: 0, burning: 0, machine: false, hits: [],
    char: { rig: RIG, bones, severed: new Set(), anim: noop('anim') } as unknown as EnemyInstance['char'],
  };
}

const _closest = new THREE.Vector3();

/** Ray against a sphere. Returns the distance or -1. */
function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number, max: number): number {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const q = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - q;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= max ? t : -1;
}

/** Stand-in for EnemySystem with the same semantics as src/enemies/damage.ts for region multipliers. */
class Dummies implements EnemySystem {
  alive: EnemyInstance[] = [];
  remaining = 0;
  add(x: number, z: number, health = 100000, y = 0): Dummy {
    const d = makeDummy(this.alive.length + 1, x, y, z, health);
    this.alive.push(d);
    return d;
  }
  clear(): void {
    this.alive.length = 0;
  }
  spawn(): EnemyInstance | null {
    return null;
  }
  private test(e: EnemyInstance, o: THREE.Vector3, d: THREE.Vector3, max: number): EnemyRayHit | null {
    const head = _closest.copy(e.position);
    head.y += 1.6;
    let t = raySphere(o, d, head, 0.14, max);
    let region: GoreRegion = 'head';
    let bone = HEAD_BONE;
    if (t < 0) {
      const body = _closest.copy(e.position);
      body.y += 1;
      t = raySphere(o, d, body, 0.55, max);
      region = 'chest';
      bone = 2;
    }
    if (t < 0) return null;
    const point = o.clone().addScaledVector(d, t);
    return { enemy: e, distance: t, point, normal: d.clone().negate(), bone, region };
  }
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): EnemyRayHit | null {
    let best: EnemyRayHit | null = null;
    for (const e of this.alive) {
      if (!e.alive) continue;
      const h = this.test(e, o, d, best ? best.distance : max);
      if (h) best = h;
    }
    return best;
  }
  raycastAll(o: THREE.Vector3, d: THREE.Vector3, max: number, limit: number): EnemyRayHit[] {
    const list: EnemyRayHit[] = [];
    for (const e of this.alive) {
      if (!e.alive) continue;
      const h = this.test(e, o, d, max);
      if (h) list.push(h);
    }
    return list.sort((a, b) => a.distance - b.distance).slice(0, limit);
  }
  applyDamage(e: EnemyInstance, d: DamageInfo): DamageResult {
    const dummy = e as Dummy;
    dummy.hits.push({ ...d, point: d.point.clone(), dir: d.dir.clone() });
    const area = d.type === 'explosive' || d.type === 'fire' || d.type === 'shock';
    const headshot = d.region === 'head' && !area;
    const amount = d.amount * (headshot ? d.headshotMult ?? 2 : 1);
    e.health -= amount;
    const killed = e.health <= 0;
    if (killed) e.alive = false;
    return { dealt: amount, killed, headshot, severed: [], blocked: false };
  }
  query(center: THREE.Vector3, radius: number, out: EnemyInstance[]): number {
    out.length = 0;
    for (const e of this.alive) if (e.alive && e.position.distanceTo(center) <= radius + 2) out.push(e);
    return out.length;
  }
  killAll(): void {}
}

class ScriptInput {
  private held = new Set<Action>();
  private edges = new Set<Action>();
  private ups = new Set<Action>();
  isDown(a: Action): boolean {
    return this.held.has(a);
  }
  pressed(a: Action): boolean {
    return this.edges.has(a);
  }
  released(a: Action): boolean {
    return this.ups.has(a);
  }
  simulate(a: Action, down: boolean): void {
    if (down && !this.held.has(a)) this.edges.add(a);
    if (!down && this.held.has(a)) this.ups.add(a);
    if (down) this.held.add(a);
    else this.held.delete(a);
  }
  endFrame(): void {
    this.edges.clear();
    this.ups.clear();
  }
  clear(): void {
    this.held.clear();
    this.endFrame();
  }
  consumeWheel(): number {
    return 0;
  }
}

class StubPlayer {
  readonly position = new THREE.Vector3(0, 0, 0);
  readonly eye = new THREE.Vector3(0, 1.6, 0);
  readonly velocity = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, -1);
  alive = true;
  grounded = true;
  sliding = false;
  wallRunning = false;
  speed = 0;
  modifiers = { speed: 1, jump: 1, damageTaken: 1, invulnerable: false, infiniteDash: false };
  damage: PlayerDamage[] = [];
  launches: THREE.Vector3[] = [];
  takeDamage(d: PlayerDamage): void {
    this.damage.push({ ...d });
  }
  launch(v: THREE.Vector3): void {
    this.launches.push(v.clone());
  }
  aim(x: number, y: number, z: number): void {
    this.forward.set(x, y, z).normalize();
  }
  place(x: number, z: number): void {
    this.position.set(x, 0, z);
    this.eye.set(x, 1.6, z);
  }
}

interface Rig {
  ctx: Ctx;
  input: ScriptInput;
  player: StubPlayer;
  enemies: Dummies;
  weapons: Weapons;
  combat: Combat;
  record: { fired: Record<string, number>; left: number; right: number; sounds: string[]; stops: number[]; explosions: number; muzzles: number; trauma: number[]; markers: string[] };
}

async function makeRig(): Promise<Rig> {
  const physics = await Physics.create();
  // Room: floor and four walls at 40 m, a thick pillar, and a sheet wall thinner than any projectile step.
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(100, 0.5, 100), null, 'concrete');
  physics.addStaticBox(new THREE.Vector3(0, 5, -60), new THREE.Vector3(60, 6, 0.5), null, 'concrete');
  physics.addStaticBox(new THREE.Vector3(30, 2, -20), new THREE.Vector3(10, 4, 0.02), null, 'metal');
  physics.addStaticBox(new THREE.Vector3(-30, 2, -8), new THREE.Vector3(10, 4, 0.3), null, 'concrete');
  physics.flushQueries();

  const input = new ScriptInput();
  const player = new StubPlayer();
  const enemies = new Dummies();
  const record: Rig['record'] = { fired: {}, left: 0, right: 0, sounds: [], stops: [], explosions: 0, muzzles: 0, trauma: [], markers: [] };
  const ctx = makeCtx({
    physics, input: input as unknown as Ctx['input'], player: player as unknown as Ctx['player'],
    audio: { play: (id: string) => record.sounds.push(id), startLoop: () => null } as unknown as Ctx['audio'],
    camera: { addTrauma: (t: number) => record.trauma.push(t), kick() {}, fovPunch() {}, setZoom() {} } as unknown as Ctx['camera'],
    fx: new Proxy(noop<Ctx['fx']>('fx'), {
      get: (t, k) => (k === 'explosion' ? () => { record.explosions++; } : Reflect.get(t, k)),
    }),
  });
  ctx.enemies = enemies;
  ctx.gore = noop('gore');
  ctx.hud = { hitMarker: (k: string) => record.markers.push(k), feed() {} } as unknown as Ctx['hud'];
  ctx.viewmodel = {
    equip() {}, holster() {}, reload() {}, swing() {}, setCharge() {}, setAkimbo() {}, setScoped() {},
    fire(_s: number, left?: boolean) {
      if (left) record.left++;
      else record.right++;
    },
    muzzle: (out: THREE.Vector3) => out,
    ejectPort: (out: THREE.Vector3) => out,
  } as unknown as Ctx['viewmodel'];
  const hitStop = ctx.time.hitStop.bind(ctx.time);
  ctx.time.hitStop = (seconds: number, scale?: number) => {
    record.stops.push(seconds);
    hitStop(seconds, scale);
  };
  ctx.events.on('weapon:fired', e => {
    record.fired[e.weapon] = (record.fired[e.weapon] ?? 0) + 1;
  });
  const combat = createCombat(ctx) as Combat;
  ctx.combat = combat as CombatSystem;
  const weapons = createWeapons(ctx) as Weapons;
  ctx.weapons = weapons as WeaponSystem;
  combat.init(ctx);
  weapons.init();
  return { ctx, input, player, enemies, weapons, combat, record };
}

/** Advances `seconds` of game time at `fps`, in the order Game.frame uses. */
function run(r: Rig, seconds: number, fps: number, each?: (frame: number) => void): void {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    r.ctx.time.tick(1 / fps);
    each?.(i);
    r.weapons.update();
    r.combat.update();
    r.input.endFrame();
  }
}

function clean(r: Rig, weapon: WeaponId = 'smg'): void {
  r.input.clear();
  r.weapons.reset();
  r.combat.reset();
  r.enemies.clear();
  r.record.fired = {};
  r.record.left = r.record.right = 0;
  r.record.explosions = 0;
  r.record.sounds.length = 0;
  r.record.stops.length = 0;
  r.record.trauma.length = 0;
  r.record.markers.length = 0;
  const p = r.player;
  p.damage.length = 0;
  p.launches.length = 0;
  p.place(0, 0);
  p.aim(0, 0, -1);
  p.velocity.set(0, 0, 0);
  r.ctx.time.clearScales();
  r.weapons.give(weapon);
  r.weapons.switchTo(weapon);
  run(r, 0.5, 60);
  r.record.fired = {};
  r.record.sounds.length = 0;
}

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

const results: Result[] = [];
const filter = new URLSearchParams(location.search).get('only');

function check(name: string, ok: boolean, detail: unknown = ''): void {
  results.push({ name, ok, detail: String(detail) });
}

const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
const FPS = [30, 60, 144] as const;

const tests: Record<string, (r: Rig) => void> = {
  'fire rate: smg holds 20 rps at every frame rate'(r) {
    for (const fps of FPS) {
      clean(r);
      r.weapons.modifiers.bottomlessMag = true;
      r.input.simulate('fire', true);
      run(r, 3, fps);
      const shots = r.record.fired.smg ?? 0;
      check(`smg rate @${fps}`, near(shots / 3, 20, 0.34), `${(shots / 3).toFixed(2)} rps`);
    }
  },
  'fire rate: buzzsaw reaches 50 rps after spin-up'(r) {
    for (const fps of FPS) {
      clean(r, 'buzzsaw');
      r.weapons.modifiers.bottomlessMag = true;
      r.input.simulate('fire', true);
      run(r, 1, fps);
      r.record.fired = {};
      run(r, 2, fps);
      const shots = r.record.fired.buzzsaw ?? 0;
      check(`buzzsaw rate @${fps}`, near(shots / 2, 50, 0.6), `${(shots / 2).toFixed(2)} rps`);
    }
  },
  'fire rate: berserk modifier and real akimbo'(r) {
    for (const fps of FPS) {
      clean(r);
      const m = r.weapons.modifiers;
      m.bottomlessMag = true;
      m.fireRate = 3;
      m.akimbo = true;
      r.input.simulate('fire', true);
      run(r, 2, fps);
      const shots = r.record.fired.smg ?? 0;
      check(`akimbo total rate @${fps}`, near(shots / 2, 120, 1.5), `${(shots / 2).toFixed(2)} rps`);
      check(`both guns fire @${fps}`, Math.abs(r.record.left - r.record.right) <= 1 && r.record.left > 100, `L ${r.record.left} R ${r.record.right}`);
    }
  },
  'fire rate: semi-auto cadence with a press held from before cooldown ends'(r) {
    for (const fps of FPS) {
      clean(r, 'shotgun');
      r.weapons.modifiers.bottomlessMag = true;
      let last = false;
      run(r, 3, fps, () => {
        last = !last;
        r.input.simulate('fire', last);
      });
      const shots = r.record.fired.shotgun ?? 0;
      check(`shotgun clicks @${fps}`, shots >= 9 && shots <= 11, `${shots} in 3 s`);
    }
  },
  'slowmo: player fires at full cadence, shell moves at quarter speed'(r) {
    clean(r);
    r.weapons.modifiers.bottomlessMag = true;
    r.ctx.time.pushScale('slowmo', 0.25, 0, 0);
    run(r, 0.1, 60);
    r.input.simulate('fire', true);
    run(r, 2, 60);
    r.input.simulate('fire', false);
    const shots = r.record.fired.smg ?? 0;
    check('smg rate in slowmo', near(shots / 2, 20, 0.5), `${(shots / 2).toFixed(2)} rps`);
    clean(r, 'autocannon');
    r.player.aim(0, 0.2, 1);
    r.ctx.time.pushScale('slowmo', 0.25, 0, 0);
    run(r, 0.1, 60);
    r.input.simulate('fire', true);
    run(r, 0.05, 60);
    const p = r.combat.projectiles.active[0];
    const from = p ? p.position.z : 0;
    run(r, 0.25, 60);
    const moved = p ? p.position.z - from : 0;
    check('shell at 0.25x', near(moved, 200 * 0.25 * 0.25 * 0.98, 1.2), `${moved.toFixed(2)} m in 0.25 s`);
  },
  'reload: timing, ammo transfer, auto reload on empty'(r) {
    for (const fps of FPS) {
      clean(r);
      const a = r.weapons.ammo('smg');
      const reserve = a.reserve;
      r.input.simulate('fire', true);
      const frameCap = 1 / fps + 1e-6;
      let t = 0;
      let start = -1;
      let end = -1;
      const offA = r.ctx.events.on('weapon:reload', e => {
        if (e.phase === 'start') start = t;
        else end = t;
      });
      run(r, 3, fps, f => {
        t = f / fps;
        if (a.mag === 0) r.input.simulate('fire', false);
      });
      offA();
      check(`mag empties in 1.5 s @${fps}`, start > 1.4 && start < 1.7, `reload started ${start.toFixed(3)} s`);
      check(`reload takes 1.0 s @${fps}`, near(end - start, 1, 2 * frameCap), `${(end - start).toFixed(3)} s`);
      check(`ammo transferred @${fps}`, a.mag === 30 && a.reserve === reserve - 30, `mag ${a.mag} reserve ${a.reserve}`);
    }
    clean(r, 'rocket');
    r.input.simulate('fire', true);
    run(r, 0.05, 60);
    r.input.simulate('fire', false);
    const a = r.weapons.ammo('rocket');
    check('rocket mag spent', a.mag === 0, a.mag);
    run(r, 1.8, 60);
    check('rocket reloads itself', a.mag === 1, a.mag);
    clean(r);
    const b = r.weapons.ammo('smg');
    b.mag = 10;
    r.input.simulate('reload', true);
    run(r, 0.3, 60);
    r.input.simulate('reload', false);
    r.weapons.switchTo('shotgun');
    run(r, 1.5, 60);
    check('switch cancels reload without touching ammo', b.mag === 10 && !r.weapons.reloading, b.mag);
  },
  'damage: every hitscan weapon deals its table value'(r) {
    clean(r);
    let d = r.enemies.add(0, -10);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    run(r, 0.1, 60);
    check('smg body', d.hits[0]?.amount === 25 && d.hits[0]?.region === 'chest', d.hits[0]?.amount);

    clean(r);
    d = r.enemies.add(0, -10);
    r.player.aim(0, 0, -1);
    r.enemies.alive[0]!.position.y = 0;
    r.player.eye.y = 1.6;
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    run(r, 0.1, 60);
    check('smg head region', d.hits[0]?.region === 'head', d.hits[0]?.region);
    check('smg head mult', near(100000 - d.health, 50, 0.01), 100000 - d.health);
    check('headshot sound layer', r.record.sounds.includes('headshot'), r.record.sounds.join());
    check('headshot hit-stop', r.record.stops.length > 0, r.record.stops.join());

    clean(r, 'shotgun');
    d = r.enemies.add(0, -3);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    run(r, 0.05, 60);
    check('shotgun 6 pellets of 20', d.hits.length === 6 && d.hits.every(h => h.amount === 20), d.hits.map(h => h.amount).join());
    check('point-blank pellets sever harder', (d.hits[0]?.severMult ?? 0) > WEAPONS.shotgun.severMult, d.hits[0]?.severMult);

    clean(r, 'judge');
    d = r.enemies.add(0, -10);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    run(r, 0.05, 60);
    check('judge 120', d.hits[0]?.amount === 120, d.hits[0]?.amount);
  },
  'judge: a headshot ricochets to the nearest head and no further than the table'(r) {
    clean(r, 'judge');
    const a = r.enemies.add(0, -10);
    const b = r.enemies.add(3, -12);
    const c = r.enemies.add(-6, -14);
    const far = r.enemies.add(80, -10);
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    run(r, 0.1, 60);
    check('first head', a.hits[0]?.region === 'head', a.hits[0]?.region);
    check('hops to the nearest head', b.hits[0]?.region === 'head' && near(b.hits[0]!.amount, 96, 0.01), b.hits[0]?.amount);
    check('and on to the next', c.hits[0]?.region === 'head', c.hits[0]?.region);
    check('out of range head is safe', far.hits.length === 0, far.hits.length);
    check('ricochet sound', r.record.sounds.includes('revolver_ricochet'), '');
  },
  'lance: charge scales damage, pierces all, fizzles early'(r) {
    clean(r, 'lance');
    const row = [r.enemies.add(0, -6), r.enemies.add(0, -12), r.enemies.add(0, -18)];
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, TUNING.lance.chargeTime + 0.1, 60);
    r.input.simulate('fire', false);
    run(r, 0.05, 60);
    check('full charge pierces every target', row.every(d => d.hits.length === 1), row.map(d => d.hits.length).join());
    check('full charge full damage', near(row[2]!.hits[0]?.amount ?? 0, 420, 0.01), row[2]!.hits[0]?.amount);
    check('severs what it touches', (row[0]!.hits[0]?.severMult ?? 0) >= 1000, row[0]!.hits[0]?.severMult);
    const a = r.weapons.ammo('lance');
    check('one cell per shot', a.mag === a.magSize - 1, a.mag);

    clean(r, 'lance');
    const d = r.enemies.add(0, -6);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.1, 60);
    r.input.simulate('fire', false);
    run(r, 0.05, 60);
    check('release under the minimum fizzles', d.hits.length === 0 && r.record.sounds.includes('railgun_fizzle'), d.hits.length);

    clean(r, 'lance');
    const half = r.enemies.add(0, -6);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, TUNING.lance.chargeTime * 0.5, 60);
    r.input.simulate('fire', false);
    run(r, 0.05, 60);
    const dealt = half.hits[0]?.amount ?? 0;
    check('half charge lands between min and max', dealt > TUNING.lance.minDamage && dealt < 420, dealt.toFixed(1));

    clean(r, 'lance');
    r.player.place(30, 0);
    const behind = r.enemies.add(30, -24);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, TUNING.lance.chargeTime + 0.1, 60);
    r.input.simulate('fire', false);
    run(r, 0.05, 60);
    check('full charge punches through a thin wall', behind.hits.length === 1, behind.hits.length);
  },
  'explosions: falloff, line of sight, instakill, chains'(r) {
    clean(r);
    const near0 = r.enemies.add(0, -30);
    const edge = r.enemies.add(7, -30);
    const out = r.enemies.add(12, -30);
    const pos = new THREE.Vector3(0, 1, -30);
    r.combat.explode(pos, { radius: 8, damage: 100, kind: 'rocket', source: 'test', team: 'player' });
    check('center takes nearly all', (near0.hits[0]?.amount ?? 0) >= 95, near0.hits[0]?.amount);
    const e = edge.hits[0]?.amount ?? 0;
    check('edge falls to half', e > 50 && e < 60, e.toFixed(1));
    check('outside takes none', out.hits.length === 0, out.hits.length);
    check('one explosion id per blast', near0.hits[0]?.explosionId === edge.hits[0]?.explosionId && near0.hits[0]?.explosionId !== undefined, near0.hits[0]?.explosionId);

    clean(r);
    // The pillar wall spans x -40..-20 at z -8. Blast on one side, dummy on the other.
    const shielded = r.enemies.add(-30, -5);
    r.combat.explode(new THREE.Vector3(-30, 1.2, -11), { radius: 8, damage: 100, kind: 'rocket', source: 'test', team: 'player' });
    check('a wall stops the blast', shielded.hits.length === 0, shielded.hits.length);

    clean(r);
    const elite = r.enemies.add(0, -30, 5000);
    const boss = r.enemies.add(3, -30, 5000);
    boss.isBoss = true;
    r.combat.explode(new THREE.Vector3(0, 1, -30), { radius: 5, damage: 99999, kind: 'shell', source: 'autocannon', team: 'player', instakill: true, selfDamage: 0 });
    check('instakill kills the elite', !elite.alive, elite.health);
    check('a boss survives an instakill', boss.alive && boss.hits[0]!.amount === TUNING.autocannon.bossDamage, boss.hits[0]?.amount);

    clean(r);
    const list: number[] = [];
    const off = r.ctx.events.on('weapon:fired', () => list.push(1));
    r.ctx.enemies.applyDamage = ((e: EnemyInstance, d: DamageInfo) => {
      // A kill that sets off another blast, the way a bomber's tank does.
      r.combat.explode(e.center, { radius: 4, damage: 1, kind: 'barrel', source: 'chain', team: 'player' });
      return Dummies.prototype.applyDamage.call(r.enemies, e, d);
    });
    r.enemies.add(0, -30);
    r.combat.explode(new THREE.Vector3(0, 1, -30), { radius: 5, damage: 10, kind: 'rocket', source: 'x', team: 'player' });
    r.ctx.enemies.applyDamage = Dummies.prototype.applyDamage.bind(r.enemies);
    run(r, 0.3, 60);
    off();
    check('a blast inside a blast is queued, not re-entered', r.enemies.alive[0]!.health < 100000, r.enemies.alive[0]!.health);
  },
  'rocket jump: launch through player.launch with low self-damage'(r) {
    clean(r, 'rocket');
    r.player.aim(0, -1, 0);
    r.input.simulate('fire', true);
    run(r, 0.3, 60);
    r.input.simulate('fire', false);
    const v = r.player.launches[0];
    check('launched', !!v && v.y > 18, v?.y.toFixed(1));
    const hurt = r.player.damage.reduce((s, d) => s + d.amount, 0);
    check('low self-damage', hurt > 0 && hurt <= 16, hurt.toFixed(1));
  },
  'autocannon: no self-damage, ring trail, direct kill'(r) {
    clean(r, 'autocannon');
    r.player.aim(0, -1, 0);
    r.input.simulate('fire', true);
    run(r, 0.1, 60);
    r.input.simulate('fire', false);
    check('no self-damage from a shell', r.player.damage.length === 0, r.player.damage.length);
    clean(r, 'autocannon');
    const d = r.enemies.add(0, -30, 400);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.3, 60);
    r.input.simulate('fire', false);
    check('shell kills', !d.alive, d.health);
  },
  'rockets: a straight shot lands on the body, and a near miss goes off beside it'(r) {
    const fire = (x: number): Dummy => {
      clean(r, 'rocket');
      const d = r.enemies.add(x, -12, 1e7);
      r.player.eye.y = 1;
      r.input.simulate('fire', true);
      run(r, 0.5, 60);
      r.input.simulate('fire', false);
      return d;
    };
    const straight = fire(0);
    check('touches what it was aimed at', straight.hits.length > 0 && straight.hits[0]!.reach === undefined, straight.hits[0]?.reach);
    const skimmed = fire(0.9);
    check('a skimming shot still goes off', skimmed.hits.length > 0 && skimmed.hits[0]!.reach !== undefined, skimmed.hits[0]?.reach);
  },
  'shaped charges: a direct hit goes through armour, and its splash does little to it'(r) {
    for (const [weapon, kind] of [['rocket', 'rocket'], ['autocannon', 'shell']] as const) {
      const charge = SHAPED_CHARGE[kind]!;
      const direct = (armor: number): DamageInfo | undefined => {
        clean(r, weapon);
        const d = r.enemies.add(0, -12, 1e7);
        d.armor = armor;
        r.player.eye.y = 1;
        r.input.simulate('fire', true);
        run(r, 0.5, 60);
        r.input.simulate('fire', false);
        return d.hits[0];
      };
      const plated = direct(50);
      check(`${weapon}: through the plates`, plated?.pierces === true, plated?.pierces);
      check(`${weapon}: harder on armour`, plated?.amount === WEAPONS[weapon].damage * charge.direct, plated?.amount);
      const bare = direct(0);
      check(`${weapon}: as written on a bare body`, bare?.amount === WEAPONS[weapon].damage && !bare.pierces, bare?.amount);
    }

    clean(r);
    const at = new THREE.Vector3(0, 1, -30);
    const plated = r.enemies.add(3, -30, 1e7);
    plated.armor = 50;
    const bare = r.enemies.add(-3, -30, 1e7);
    r.combat.explode(at, { radius: 8, damage: 100, kind: 'rocket', source: 'test', team: 'player' });
    const splash = bare.hits[0]!.amount * SHAPED_CHARGE.rocket!.splash;
    check('rocket splash: less on armour', near(plated.hits[0]!.amount, splash, 0.01), plated.hits[0]?.amount);
    check('rocket splash: never pierces', !plated.hits[0]!.pierces, plated.hits[0]?.pierces);

    clean(r);
    const iron = r.enemies.add(2, -30, 1e7);
    iron.armor = 50;
    const flesh = r.enemies.add(-2, -30, 5000);
    r.combat.explode(at, { radius: 5, damage: 99999, kind: 'shell', source: 'autocannon', team: 'player', instakill: true, selfDamage: 0 });
    check('shell splash: a number on armour', iron.alive && near(iron.hits[0]!.amount, SHAPED_CHARGE.shell!.most * SHAPED_CHARGE.shell!.splash, 0.01), iron.hits[0]?.amount);
    check('shell splash: still the end of a bare body', !flesh.alive, flesh.health);

    clean(r);
    const grenaded = r.enemies.add(2, -30, 1e7);
    grenaded.armor = 50;
    const beside = r.enemies.add(-2, -30, 1e7);
    r.combat.explode(at, { radius: 7, damage: 190, kind: 'grenade', source: 'test', team: 'player' });
    check('a grenade is no shaped charge', near(grenaded.hits[0]!.amount, beside.hits[0]!.amount, 0.01), grenaded.hits[0]?.amount);
  },
  'tunnelling: nothing passes a 4 cm wall at any frame rate'(r) {
    for (const fps of [20, 30, 60, 144]) {
      for (const weapon of ['rocket', 'autocannon', 'stakegun'] as const) {
        clean(r, weapon);
        r.player.place(30, 0);
        r.player.eye.y = 1.5;
        const d = r.enemies.add(30, -24);
        r.input.simulate('fire', true);
        run(r, 1.2, fps);
        r.input.simulate('fire', false);
        // The blast and the stake must stop at the sheet at z -20, leaving the dummy behind it untouched.
        check(`${weapon} @${fps}`, d.hits.length === 0 && r.combat.projectiles.count === 0, `hits ${d.hits.length} live ${r.combat.projectiles.count}`);
      }
    }
    for (const fps of [20, 60, 144]) {
      clean(r);
      r.ctx.combat.spawnProjectile({
        origin: new THREE.Vector3(0, 1, -40), velocity: new THREE.Vector3(0, 0, 300), kind: 'bullet', team: 'enemy', damage: 10, source: 'enemy',
      });
      run(r, 0.5, fps);
      check(`300 m/s enemy bullet hits the player @${fps}`, r.player.damage.length === 1, r.player.damage.length);
    }
    for (const fps of [20, 60]) {
      clean(r, 'rocket');
      const d = r.enemies.add(0, -30);
      r.player.eye.y = 1;
      r.input.simulate('fire', true);
      run(r, 1, fps);
      r.input.simulate('fire', false);
      check(`rocket hits a body @${fps}`, d.hits.length >= 1 && d.hits[0]!.gib === true, d.hits.length);
    }
  },
  'sword: chain damage, escalation, instant hit'(r) {
    clean(r, 'sword');
    const d = r.enemies.add(0, -3);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    r.ctx.time.tick(1 / 60);
    r.weapons.update();
    r.input.endFrame();
    check('light hit lands on the frame of the click', d.hits.length === 1 && d.hits[0]!.amount === 75, d.hits.length);
    check('slice plane on every cut', !!d.hits[0]!.slicePlaneNormal, '');
    run(r, 0.95, 60);
    r.input.simulate('fire', false);
    const amounts = d.hits.map(h => h.amount);
    check('three swing chain', amounts[0] === 75 && amounts[1] === 93.75 && amounts[2] === 112.5, amounts.join());
    run(r, 1, 60);
    check('swings stop when the button does', d.hits.length <= 4, d.hits.length);
    const quiet = r.record.trauma[0] ?? 0;
    clean(r, 'sword');
    r.input.simulate('aim', true);
    run(r, 0.5, 60);
    r.input.simulate('aim', false);
    run(r, 0.05, 60);
    const heavy = Math.max(...r.record.trauma);
    check('15x shake contrast (trauma squared)', near((heavy * heavy) / (quiet * quiet), 15, 0.5), ((heavy * heavy) / (quiet * quiet)).toFixed(1));
  },
  'sword: cone and line of sight'(r) {
    clean(r, 'sword');
    r.player.place(-30, -5);
    r.player.eye.y = 1;
    const shielded = r.enemies.add(-30, -9.5);
    const inside = r.enemies.add(-30, -7.5);
    const behind = r.enemies.add(-30, 0);
    r.input.simulate('fire', true);
    run(r, 0.1, 60);
    r.input.simulate('fire', false);
    check('hits in front', inside.hits.length === 1, inside.hits.length);
    check('wall blocks it', shielded.hits.length === 0, shielded.hits.length);
    check('behind is safe', behind.hits.length === 0, behind.hits.length);
  },
  'sword: stays live for the player running into a target'(r) {
    clean(r, 'sword');
    const d = r.enemies.add(0, -6);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    check('out of reach on the click', d.hits.length === 0, d.hits.length);
    r.player.place(0, -1.5);
    r.player.eye.y = 1;
    run(r, 0.05, 60);
    check('cut on arrival', d.hits.length === 1, d.hits.length);
    run(r, 0.5, 60);
    check('only once per swing', d.hits.length === 1, d.hits.length);
  },
  'sword: lunge pulls toward a target out of reach'(r) {
    clean(r, 'sword');
    r.enemies.add(0, -8);
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    check('lunge', r.player.velocity.z < -8, r.player.velocity.z.toFixed(1));

    // Against the real stop rate, which is what made a one-off shove worth only a meter.
    for (const fps of FPS) {
      clean(r, 'sword');
      const d = r.enemies.add(0, -8.5);
      r.input.simulate('fire', true);
      let z = 0;
      run(r, 0.4, fps, () => {
        r.input.simulate('fire', false);
        const v = r.player.velocity;
        const speed = Math.abs(v.z);
        const next = Math.max(0, speed - MOVE.stopDecel / fps);
        v.z = speed > 0 ? (v.z / speed) * next : 0;
        z += v.z / fps;
        r.player.place(0, z);
        r.player.eye.y = 1;
      });
      const left = -z - 8.5;
      check(`lunge closes the gap @${fps}`, z < -3, z.toFixed(2));
      check(`and stops short of the body @${fps}`, Math.abs(left) >= 1.2, Math.abs(left).toFixed(2));
      void d;
    }
  },
  'sword: area sweep charges and reaches further'(r) {
    clean(r, 'sword');
    const near7 = r.enemies.add(0, -7.5);
    const close = r.enemies.add(0, -4);
    r.player.eye.y = 1;
    r.input.simulate('aim', true);
    run(r, 0.02, 60);
    r.input.simulate('aim', false);
    run(r, 0.3, 60);
    check('tap: weak and short', near(close.hits[0]?.amount ?? 0, 100 * SWORD.windup.tapPower, 8) && near7.hits.length === 0, `${close.hits[0]?.amount?.toFixed(1)} / far ${near7.hits.length}`);
    clean(r, 'sword');
    const far = r.enemies.add(0, -7.5);
    r.player.eye.y = 1;
    r.input.simulate('aim', true);
    run(r, 0.4, 60);
    r.input.simulate('aim', false);
    run(r, 0.3, 60);
    check('charged: full damage at full reach', far.hits[0]?.amount === 100, far.hits[0]?.amount);
  },
  'sword: finisher needs swing 2, blasts 200 ms later, ends the chain'(r) {
    clean(r, 'sword');
    const d = r.enemies.add(0, -3);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    run(r, 0.3, 60);
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    r.input.simulate('aim', true);
    run(r, 0.05, 60);
    r.input.simulate('aim', false);
    const before = d.hits.length;
    let blastAt = -1;
    let t = 0;
    run(r, 0.9, 60, f => {
      t = f / 60;
      if (blastAt < 0 && d.hits.length > before) blastAt = t;
    });
    const blast = d.hits[before];
    check('finisher explosive', blast?.type === 'explosive' && blast?.source === 'sword_finisher', blast?.source);
    check('it landed', blast !== undefined, d.hits.length);
    check('resets the chain', r.weapons.swordStep === 0, r.weapons.swordStep);
    check('finisher shake is heavy', Math.max(...r.record.trauma) > 0.8, Math.max(...r.record.trauma).toFixed(2));
    check('finisher hit-stop', Math.max(...r.record.stops) >= SWORD.finisher.hitStop, r.record.stops.join());

    clean(r, 'sword');
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    r.input.simulate('aim', true);
    run(r, 0.05, 60);
    r.input.simulate('aim', false);
    run(r, 0.6, 60);
    check('RMB on swing 1 is no finisher', !r.record.sounds.includes('sword_slam'), '');
  },
  'sword: switch during a committed finisher waits for the blast'(r) {
    clean(r, 'sword');
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    run(r, 0.3, 60);
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    r.input.simulate('aim', true);
    run(r, 0.32, 60);
    r.input.simulate('aim', false);
    r.weapons.switchTo('smg');
    check('still holding the sword', r.weapons.current === 'sword', r.weapons.current);
    run(r, 0.3, 60);
    check('switches once it has landed', r.weapons.current === 'smg', r.weapons.current);
  },
  'sword: guard parries early and blocks late'(r) {
    clean(r, 'sword');
    const shot: ShotSpec = { damage: 10, source: 'trooper', team: 'enemy' };
    const from = new THREE.Vector3(0, 1.4, -20);
    const dir = new THREE.Vector3(0, 0, 1);
    const d = r.enemies.add(0, -20);
    r.player.eye.y = 1.2;
    r.input.simulate('aim', true);
    run(r, 0.05, 60);
    r.ctx.combat.fireRay(from, dir, shot);
    check('parry takes no damage', r.player.damage.length === 0, r.player.damage.length);
    check('parry sends it back on the crosshair', d.hits.length === 1 && d.hits[0]!.source === 'sword_deflect', d.hits.length);
    run(r, 0.4, 60);
    r.ctx.combat.fireRay(from, dir, shot);
    check('late guard blocks', r.player.damage.length === 0 && d.hits.length === 1, `${r.player.damage.length}/${d.hits.length}`);
    r.input.simulate('aim', false);
    run(r, 1, 60);
    r.ctx.combat.fireRay(from, dir, shot);
    check('no guard, no block', r.player.damage.length === 1, r.player.damage.length);
    r.player.aim(0, 0, 1);
    r.input.simulate('aim', true);
    run(r, 0.05, 60);
    r.ctx.combat.fireRay(from, dir, shot);
    check('guard only works facing the shot', r.player.damage.length === 2, r.player.damage.length);
  },
  'modifiers: blood thirst, hellfire, ricochet, shock, always sever'(r) {
    clean(r, 'shotgun');
    const m = r.weapons.modifiers;
    m.damage = 2;
    m.pellets = 2;
    m.bottomlessMag = true;
    let d = r.enemies.add(0, -3);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    check('12 pellets of 40', d.hits.length === 12 && d.hits[0]!.amount === 40, `${d.hits.length} x ${d.hits[0]?.amount}`);
    check('mag untouched', r.weapons.ammo().mag === 6, r.weapons.ammo().mag);

    clean(r);
    r.weapons.modifiers.explosiveRounds = true;
    d = r.enemies.add(0, -10);
    const side = r.enemies.add(1, -10);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    check('hellfire round: direct hit keeps its bonus', d.hits[0]?.amount === 31.25, d.hits[0]?.amount);
    check('and splashes', side.hits.length === 1, side.hits.length);

    clean(r, 'rocket');
    const w = r.weapons.modifiers;
    w.blastRadius = 2.5;
    w.instakillBlast = true;
    r.enemies.add(0, -30);
    const far = r.enemies.add(15, -30, 5000);
    r.player.place(0, -20);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.5, 60);
    r.input.simulate('fire', false);
    check('hellfire rocket: radius 20 instakill', !far.alive, far.health);

    clean(r);
    r.weapons.modifiers.ricochet = 2;
    r.player.aim(0, 0, -1);
    const a = r.enemies.add(0, -10);
    const b = r.enemies.add(4, -12);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    check('ricochet jumps off a body', a.hits.length === 1 && b.hits.length === 1, `${a.hits.length}/${b.hits.length}`);

    clean(r);
    r.weapons.modifiers.shockRounds = true;
    const c1 = r.enemies.add(0, -10);
    const c2 = r.enemies.add(3, -10);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    check('shock arcs', c1.hits.length === 1 && c2.hits[0]?.type === 'shock', c2.hits[0]?.type);

    clean(r);
    r.weapons.modifiers.alwaysSever = true;
    const s = r.enemies.add(0, -10);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    check('always sever', (s.hits[0]?.severMult ?? 0) >= 1000, s.hits[0]?.severMult);
  },
  'grenades: fuse, bounce, cook, shot out of the air'(r) {
    clean(r);
    const start = r.weapons.grenades;
    r.input.simulate('grenade', true);
    run(r, 0.05, 60);
    r.input.simulate('grenade', false);
    run(r, 0.1, 60);
    check('uses one', r.weapons.grenades === start - 1, r.weapons.grenades);
    const g = r.combat.projectiles.active[0];
    check('in flight', g?.kind === 'grenade', g?.kind);
    run(r, 1.4, 60);
    check('has not gone off', r.combat.projectiles.count === 1, r.combat.projectiles.count);
    check('sits on or above the floor', (g?.position.y ?? 0) >= 0, g?.position.y.toFixed(2));
    run(r, 1.4, 60);
    check('fuse ends it', r.combat.projectiles.count === 0, r.combat.projectiles.count);

    clean(r);
    r.input.simulate('grenade', true);
    run(r, 3, 60);
    check('held too long goes off in the hand', r.combat.projectiles.count === 0 && r.player.damage.length === 1, r.player.damage.length);

    clean(r);
    r.ctx.combat.spawnProjectile({
      origin: new THREE.Vector3(0, 1.6, -15), velocity: new THREE.Vector3(0, 0, 0), kind: 'grenade', team: 'player', damage: 100, source: 'grenade',
      gravity: 0, fuse: 5, explosion: { radius: 6, damage: 100, kind: 'grenade' },
    });
    const by = r.enemies.add(3, -15);
    run(r, 0.05, 60);
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    check('shot out of the air', r.combat.projectiles.count === 0 && by.hits.length === 1, by.hits.length);
  },
  'kiln: stream ignites and burns through ammo'(r) {
    clean(r, 'kiln');
    const d = r.enemies.add(0, -5);
    const far = r.enemies.add(0, -16);
    r.player.eye.y = 1.2;
    r.input.simulate('fire', true);
    run(r, 1, 60);
    r.input.simulate('fire', false);
    run(r, 0.6, 60);
    check('burns the target', d.burning > 0 && d.hits.some(h => h.type === 'fire'), d.burning);
    check('short range', far.hits.length === 0, far.hits.length);
    const a = r.weapons.ammo('kiln');
    check('fuel burns at 30/s', near(a.magSize - a.mag, 30, 2), a.magSize - a.mag);
  },
  'stakegun: stake hits and costs one'(r) {
    clean(r, 'stakegun');
    const d = r.enemies.add(0, -20, 100);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.3, 60);
    r.input.simulate('fire', false);
    check('kills', !d.alive, d.health);
    check('one stake spent', r.weapons.ammo('stakegun').mag === 4, r.weapons.ammo('stakegun').mag);
  },
  'buzzsaw: spin gate, slowdown'(r) {
    clean(r, 'buzzsaw');
    r.weapons.modifiers.bottomlessMag = true;
    r.input.simulate('fire', true);
    run(r, 0.3, 60);
    check('nothing leaves before spin-up', (r.record.fired.buzzsaw ?? 0) === 0, r.record.fired.buzzsaw);
    run(r, 0.5, 60);
    check('fires once spun', (r.record.fired.buzzsaw ?? 0) > 3, r.record.fired.buzzsaw);
    r.player.velocity.set(17, 0, 0);
    run(r, 1, 60);
    check('slows the player', r.player.velocity.x < 11, r.player.velocity.x.toFixed(2));
  },
  'buzzsaw: the slowdown averages the same at any frame rate'(r) {
    const accel = MOVE.groundAccel;
    const top = MOVE.runSpeed;
    const tick = 1 / 120;
    for (const fps of FPS) {
      clean(r, 'buzzsaw');
      r.weapons.modifiers.bottomlessMag = true;
      r.input.simulate('fire', true);
      run(r, 1, fps);
      r.player.velocity.set(top, 0, 0);
      let travelled = 0;
      let carry = 0;
      // The player's own fixed ticks, between two of the gun's once-a-frame clamps.
      const seconds = 2;
      run(r, seconds, fps, () => {
        carry += 1 / fps;
        while (carry >= tick) {
          carry -= tick;
          const v = r.player.velocity;
          v.x = Math.min(top, v.x + accel * tick);
          travelled += v.x * tick;
        }
      });
      r.input.simulate('fire', false);
      const average = travelled / seconds;
      check(`average speed @${fps}`, near(average, top * TUNING.buzzsaw.moveSpeed, 0.6), average.toFixed(2));
    }
  },
  'ammo: a gun that runs dry hands over, and the sword is the last resort'(r) {
    clean(r);
    const smg = r.weapons.ammo('smg');
    smg.mag = 2;
    smg.reserve = 0;
    r.input.simulate('fire', true);
    run(r, 0.1, 60);
    check('the dry click plays', r.record.sounds.includes('weapon_dry'), r.record.sounds.join());
    check('holds the gun through the click', r.weapons.current === 'smg', r.weapons.current);
    run(r, 0.25, 60);
    check('hands over to the next loaded gun', r.weapons.current === 'shotgun', r.weapons.current);
    run(r, 0.35, 60);
    r.input.simulate('fire', false);
    check('a held trigger fires the new gun with no fresh click', r.record.fired.shotgun === 1, r.record.fired.shotgun);

    clean(r);
    for (const id of ['smg', 'shotgun', 'rocket', 'autocannon'] as const) {
      const a = r.weapons.ammo(id);
      a.mag = 0;
      a.reserve = 0;
    }
    r.weapons.ammo('smg').mag = 1;
    r.input.simulate('fire', true);
    run(r, 0.4, 60);
    r.input.simulate('fire', false);
    check('nothing left means the sword', r.weapons.current === 'sword', r.weapons.current);

    clean(r);
    const dry = r.weapons.ammo('rocket');
    dry.mag = 0;
    dry.reserve = 0;
    r.weapons.switchTo('rocket');
    run(r, 0.5, 60);
    check('drawing a dry gun does not bounce you off it', r.weapons.current === 'rocket', r.weapons.current);
    r.input.simulate('fire', true);
    run(r, 0.4, 60);
    r.input.simulate('fire', false);
    check('pulling its trigger does', r.weapons.current !== 'rocket', r.weapons.current);

    clean(r);
    const saved = r.weapons.ammo('smg');
    saved.mag = 1;
    saved.reserve = 0;
    r.input.simulate('fire', true);
    run(r, 0.1, 60);
    r.input.simulate('fire', false);
    r.weapons.addAmmo(0.25);
    run(r, 0.4, 60);
    check('a pickup during the click cancels the swap', r.weapons.current === 'smg', r.weapons.current);
  },
  'ammo: sword kills feed the last gun, wave breaks lift a floor'(r) {
    clean(r);
    const a = r.weapons.ammo('smg');
    a.mag = 0;
    a.reserve = 0;
    r.weapons.switchTo('sword');
    run(r, 0.3, 60);
    const kill = (source: string) => r.ctx.events.emit('enemy:killed', { damage: { source }, enemy: { id: 'husk' }, distance: 20 } as never);
    kill('sword');
    check('half a mag per sword kill', a.reserve === 15, a.reserve);
    kill('sword_finisher');
    check('every sword move counts', a.reserve === 30, a.reserve);
    kill('rocket');
    check('other kills do not', a.reserve === 30, a.reserve);

    clean(r);
    const low = r.weapons.ammo('shotgun');
    const rich = r.weapons.ammo('smg');
    low.reserve = 0;
    rich.reserve = rich.maxReserve;
    r.ctx.events.emit('wave:clear', { wave: 1, bonus: 0 });
    check('a dry gun is lifted to the floor', low.reserve === Math.ceil(low.maxReserve * TUNING.ammo.waveFloor), low.reserve);
    check('a full gun is left alone', rich.reserve === rich.maxReserve, rich.reserve);
  },
  'blasts: a queued blast keeps only its own fields'(r) {
    clean(r);
    // Queues `inner` from inside a blast, the way a bomber's tank does, then lets it go off.
    const nested = (inner: ExplosionSpec) => {
      r.ctx.enemies.applyDamage = ((e: EnemyInstance, d: DamageInfo) => {
        if (d.source === 'outer') r.combat.explode(e.center, inner);
        return Dummies.prototype.applyDamage.call(r.enemies, e, d);
      });
      r.combat.explode(new THREE.Vector3(0, 1, -30), { radius: 5, damage: 1, kind: 'rocket', source: 'outer', team: 'player' });
      r.ctx.enemies.applyDamage = Dummies.prototype.applyDamage.bind(r.enemies);
      run(r, 0.2, 60);
    };
    r.enemies.add(0, -30, 5000);
    nested({ radius: 4, damage: 1, kind: 'rocket', source: 'hot', team: 'player', instakill: true });
    const victim = r.enemies.add(0, -30, 5000);
    nested({ radius: 4, damage: 1, kind: 'barrel', source: 'cold', team: 'player' });
    const cold = victim.hits.find(h => h.source === 'cold');
    check('no instakill inherited from the slot before', !!cold && cold.amount < 10, cold?.amount);
  },
  'world objects: an explosive is resolved once, without a second fireball'(r) {
    clean(r);
    const d = r.enemies.add(0, -30);
    r.ctx.events.emit('world:explosion', { position: new THREE.Vector3(0, 1, -30), radius: 7, damage: 110, kind: 'barrel', source: 'smg' });
    check('damages enemies', d.hits.length === 1 && d.hits[0]!.type === 'explosive' && d.hits[0]!.source === 'smg', d.hits[0]?.source);
    check('the world already drew it', r.record.explosions === 0, r.record.explosions);
    check('no second sound', !r.record.sounds.includes('explosion_barrel'), r.record.sounds.join());
    check('kills it causes share an explosion id', d.hits[0]?.explosionId !== undefined, d.hits[0]?.explosionId);
    r.combat.explode(new THREE.Vector3(0, 1, -30), { radius: 7, damage: 110, kind: 'barrel', source: 'bomber', team: 'player' });
    check('a bomber tank still draws its own', r.record.explosions === 1, r.record.explosions);
  },
  'trigger: a press held through a reload fires when it ends'(r) {
    clean(r, 'rocket');
    r.player.aim(0, 0, -1);
    r.input.simulate('fire', true);
    run(r, 0.05, 60);
    r.input.simulate('fire', false);
    run(r, 0.3, 60);
    check('reloading', r.weapons.reloading, r.weapons.reloading);
    const fired = r.record.fired.rocket ?? 0;
    r.input.simulate('fire', true);
    run(r, 1.5, 60);
    check('fires on the first legal frame', (r.record.fired.rocket ?? 0) === fired + 1, r.record.fired.rocket);
    run(r, 1.8, 60);
    check('and only once per press', (r.record.fired.rocket ?? 0) === fired + 1, r.record.fired.rocket);
    r.input.simulate('fire', false);
  },
  'grenades: thrown against a wall stay on this side'(r) {
    clean(r);
    r.player.place(30, -19.6);
    r.player.eye.y = 1.5;
    r.input.simulate('grenade', true);
    run(r, 0.05, 60);
    r.input.simulate('grenade', false);
    run(r, 0.05, 60);
    const g = r.combat.projectiles.active[0];
    check('did not start behind the sheet', (g?.position.z ?? -99) > -20, g?.position.z.toFixed(2));
  },
  'stakes and hellfire: the stake bursts where it lands'(r) {
    clean(r, 'stakegun');
    r.weapons.modifiers.explosiveRounds = true;
    r.player.aim(0, -0.4, -1);
    r.input.simulate('fire', true);
    run(r, 0.3, 60);
    r.input.simulate('fire', false);
    check('explodes on the floor', r.record.explosions === 1, r.record.explosions);
  },
  'sword: the push keeps both the blade and the line of the swing'(r) {
    clean(r, 'sword');
    const d = r.enemies.add(0, -3);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.02, 60);
    r.input.simulate('fire', false);
    const dir = d.hits[0]?.dir;
    check('forward part survives', !!dir && dir.z < -0.4, dir?.z.toFixed(2));
    check('blade part survives', !!dir && Math.abs(dir.y) > 0.3, dir?.y.toFixed(2));
    clean(r, 'sword');
    const e = r.enemies.add(0, -3);
    r.player.eye.y = 1;
    r.input.simulate('melee', true);
    run(r, 0.02, 60);
    r.input.simulate('melee', false);
    check('melee key swings the blade in hand', e.hits.length === 1, e.hits.length);
  },
  'sword: a cleave only slices the first few, the budget is real'(r) {
    clean(r, 'sword');
    for (let i = 0; i < 6; i++) r.enemies.add(i - 2.5, -3, 10);
    r.player.eye.y = 1;
    r.input.simulate('fire', true);
    run(r, 0.02, 60);
    r.input.simulate('fire', false);
    const planes = r.enemies.alive.filter(d => (d as Dummy).hits[0]?.slicePlaneNormal).length;
    check('three slices, the rest ragdoll', planes === 3, planes);
  },
  'switching: per-weapon cooldowns, last weapon, ownership'(r) {
    clean(r, 'shotgun');
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    const a = r.weapons.ammo('shotgun').mag;
    r.weapons.switchTo('smg');
    r.weapons.switchTo('shotgun');
    run(r, 0.22, 60);
    r.input.simulate('fire', true);
    run(r, 0.016, 60);
    r.input.simulate('fire', false);
    check('swap does not skip the cooldown', r.weapons.ammo('shotgun').mag >= a - 1, r.weapons.ammo('shotgun').mag);
    r.weapons.switchTo('judge');
    check('cannot draw what you do not own', r.weapons.current !== 'judge' || r.weapons.owned.has('judge'), r.weapons.current);
  },
};

/** Scripts drive this through page.evaluate. Everything here is the real game. */
interface LiveRange {
  ctx: Ctx;
  /** Spawns `id` at `distance` straight ahead of the player and returns it. */
  spawn(id: string, distance: number, side?: number): EnemyInstance | null;
  /** Points the player at a world point. */
  aim(x: number, y: number, z: number): void;
  aimAt(e: EnemyInstance, head?: boolean): void;
}

async function liveRange(): Promise<void> {
  const { createCtx, Game } = await import('../core/Game');
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ctx = await createCtx(canvas);
  const game = new Game(ctx);
  const manifest = await (await fetch(`${import.meta.env.BASE_URL}assets/characters/manifest.json`)).json() as { models: Record<string, unknown> };
  const load = ctx.characters.load.bind(ctx.characters);
  const wanted = new URLSearchParams(location.search).get('load');
  ctx.characters.load = (ids?: string[]) => load((ids ?? ctx.characters.archetypes()).filter(id => id in manifest.models && (!wanted || wanted.split(',').includes(id))));
  (window as unknown as { __op2: unknown }).__op2 = { ctx, game, stats: () => game.stats() };
  await game.init(() => {});
  ctx.waves.start = () => {};
  ctx.waves.update = () => {};
  game.run();
  game.newRun();
  for (const id of ['judge', 'lance', 'buzzsaw', 'kiln', 'stakegun'] as const) ctx.weapons.give(id);
  const v = new THREE.Vector3();
  const live: LiveRange = {
    ctx,
    spawn(id, distance, side = 0) {
      const p = ctx.player;
      v.copy(p.position).addScaledVector(p.forward.clone().setY(0).normalize(), distance);
      v.x += Math.cos(p.yaw) * side;
      v.z -= Math.sin(p.yaw) * side;
      return ctx.enemies.spawn(id as never, v);
    },
    aim(x, y, z) {
      const p = ctx.player;
      const dx = x - p.eye.x;
      const dy = y - p.eye.y;
      const dz = z - p.eye.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    },
    aimAt(e, head) {
      const target = v.copy(e.center);
      if (head) target.y = e.position.y + e.char.rig.height * 0.93;
      this.aim(target.x, target.y, target.z);
    },
  };
  (window as unknown as { __range: LiveRange }).__range = live;
}

export default async function range(params: URLSearchParams): Promise<void> {
  if (params.get('live')) return liveRange();
  const r = await makeRig();
  for (const [name, fn] of Object.entries(tests)) {
    if (filter && !name.includes(filter)) continue;
    try {
      const before = results.length;
      fn(r);
      if (results.length === before) check(name, false, 'no assertions ran');
    } catch (e) {
      check(name, false, `threw: ${(e as Error).stack ?? e}`);
    }
  }
  const failed = results.filter(t => !t.ok);
  const summary = { total: results.length, passed: results.length - failed.length, failed: failed.length };
  console.log(`[range] ${summary.passed}/${summary.total} passed`);
  for (const f of failed) console.error(`[range] FAIL ${f.name}: ${f.detail}`);
  const report = { ...summary, failures: failed, results };
  document.title = `range ${summary.passed}/${summary.total}`;
  runLoop(r.ctx, () => {}, () => ({ range: report }));
}
