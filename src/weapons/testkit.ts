/**
 * A firing range for unit tests: the real Weapons and Combat on real Rapier physics, with stand-in enemies, a scripted
 * input and a stepped clock. Everything visual is a recorder or a no-op. Tests only; nothing in the game imports this.
 *
 * It mirrors the rig in src/sandbox/range.ts, which cannot be imported under Node because it reads the page's URL.
 */
import * as THREE from 'three';
import { humanoidRig, type GoreRegion } from '../characters/rig';
import type { Action, Ctx, DamageInfo, PlayerDamage, SurfaceKind } from '../core/contracts';
import type { CombatSystem, DamageResult, EnemyInstance, EnemyRayHit, EnemySystem, WeaponSystem } from '../core/gameplay';
import '../core/gameplay';
import { noop } from '../core/stubs';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import { Combat } from './Combat';
import { Weapons } from './Weapons';

const RIG = humanoidRig('dummy');
const HEAD_BONE = 4;

export interface Dummy extends EnemyInstance {
  hits: DamageInfo[];
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number, max: number): number {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const disc = b * b - (ox * ox + oy * oy + oz * oz - r * r);
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= max ? t : -1;
}

/** Bodies are a 0.55 m sphere at chest height and a 0.14 m head, as in the range sandbox. */
export class Dummies implements EnemySystem {
  alive: EnemyInstance[] = [];
  remaining = 0;
  add(x: number, z: number, health = 100000, y = 0): Dummy {
    const bones = RIG.bones.map(() => new THREE.Bone());
    bones[HEAD_BONE]!.position.set(x, y + 1.6, z);
    bones[HEAD_BONE]!.updateMatrixWorld(true);
    const d: Dummy = {
      uid: this.alive.length + 1, id: 'husk', position: new THREE.Vector3(x, y, z), center: new THREE.Vector3(x, y + 1.2, z),
      velocity: new THREE.Vector3(), yaw: 0, health, maxHealth: health, armor: 0, alive: true,
      score: 100, isBoss: false, frozen: 0, burning: 0, machine: false, hits: [],
      char: { rig: RIG, bones, severed: new Set(), anim: noop('anim') } as unknown as EnemyInstance['char'],
    };
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
    const at = new THREE.Vector3().copy(e.position);
    at.y += 1.6;
    let t = raySphere(o, d, at, 0.14, max);
    let region: GoreRegion = 'head';
    let bone = HEAD_BONE;
    if (t < 0) {
      at.copy(e.position);
      at.y += 1;
      t = raySphere(o, d, at, 0.55, max);
      region = 'chest';
      bone = 2;
    }
    if (t < 0) return null;
    return { enemy: e, distance: t, point: o.clone().addScaledVector(d, t), normal: d.clone().negate(), bone, region };
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
    const headshot = d.region === 'head' && d.type !== 'explosive';
    const amount = d.amount * (headshot ? d.headshotMult ?? 2 : 1);
    // A plate stops anything that does not say it goes through.
    if (e.armor > 0 && !d.pierces) return { dealt: 0, killed: false, headshot: false, severed: [], blocked: true };
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

export class ScriptInput {
  private held = new Set<Action>();
  private edges = new Set<Action>();
  isDown(a: Action): boolean {
    return this.held.has(a);
  }
  pressed(a: Action): boolean {
    return this.edges.has(a);
  }
  released(): boolean {
    return false;
  }
  simulate(a: Action, down: boolean): void {
    if (down && !this.held.has(a)) this.edges.add(a);
    if (down) this.held.add(a);
    else this.held.delete(a);
  }
  endFrame(): void {
    this.edges.clear();
  }
  clear(): void {
    this.held.clear();
    this.edges.clear();
  }
  consumeWheel(): number {
    return 0;
  }
}

export class StubPlayer {
  readonly position = new THREE.Vector3();
  readonly eye = new THREE.Vector3(0, 1, 0);
  readonly velocity = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, -1);
  alive = true;
  grounded = true;
  sliding = false;
  yaw = 0;
  pitch = 0;
  modifiers = { speed: 1, jump: 1, damageTaken: 1, invulnerable: false, infiniteDash: false };
  damage: PlayerDamage[] = [];
  takeDamage(d: PlayerDamage): void {
    this.damage.push({ ...d });
  }
  launch(): void {}
}

export interface Mark {
  at: THREE.Vector3;
  surface: SurfaceKind;
}

export interface Range {
  ctx: Ctx;
  physics: Physics;
  input: ScriptInput;
  player: StubPlayer;
  enemies: Dummies;
  weapons: Weapons;
  combat: Combat;
  record: {
    /** Every fx.impact, in order: entries and exits both. */
    impacts: Mark[];
    tracers: { from: THREE.Vector3; to: THREE.Vector3; kind: string }[];
    puffs: THREE.Vector3[];
    /** Every decal laid, with the normal it was laid on. */
    decals: { kind: string; at: THREE.Vector3; normal: THREE.Vector3 }[];
    explosions: number;
    /** Where each explosion went off. */
    blasts: THREE.Vector3[];
    sounds: string[];
    /** World raycasts since the last reset, the cost a penetration probe adds to. */
    worldRays: number;
  };
  /** A static box wall facing the player down -Z: its near face at `z`, `thick` meters deep. */
  wall(z: number, thick: number, surface?: SurfaceKind, x?: number, halfWidth?: number): void;
  /** Advances game time in the order Game.frame uses. */
  run(seconds: number, fps?: number): void;
  /** One press and release of an action, a frame apart. */
  tap(action: Action): void;
  reset(): void;
}

export async function makeRange(): Promise<Range> {
  const physics = await Physics.create();
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(200, 0.5, 200), null, 'concrete');
  physics.flushQueries();

  const input = new ScriptInput();
  const player = new StubPlayer();
  const enemies = new Dummies();
  const record: Range['record'] = { impacts: [], tracers: [], puffs: [], decals: [], explosions: 0, blasts: [], sounds: [], worldRays: 0 };
  const raycast = physics.raycast.bind(physics);
  physics.raycast = (...args: Parameters<Physics['raycast']>) => {
    record.worldRays++;
    return raycast(...args);
  };
  const fx: Record<string, unknown> = {
    impact: (at: THREE.Vector3, _n: THREE.Vector3, surface: SurfaceKind) => record.impacts.push({ at: at.clone(), surface }),
    tracer: (from: THREE.Vector3, to: THREE.Vector3, kind: string) => record.tracers.push({ from: from.clone(), to: to.clone(), kind }),
    smoke: (at: THREE.Vector3) => record.puffs.push(at.clone()),
    explosion: (at: THREE.Vector3) => {
      record.explosions++;
      record.blasts.push(at.clone());
    },
  };
  const decals = {
    add: (kind: string, at: THREE.Vector3, normal: THREE.Vector3) => record.decals.push({ kind, at: at.clone(), normal: normal.clone() }),
  };
  const ctx = makeCtx({
    physics, input: input as unknown as Ctx['input'], player: player as unknown as Ctx['player'],
    audio: { play: (id: string) => record.sounds.push(id), startLoop: () => null } as unknown as Ctx['audio'],
    camera: { addTrauma() {}, kick() {}, fovPunch() {}, setZoom() {} } as unknown as Ctx['camera'],
    fx: new Proxy(noop<Ctx['fx']>('fx'), { get: (t, k) => (typeof k === 'string' && k in fx ? fx[k] : Reflect.get(t, k)) }),
    render: new Proxy(noop<Ctx['render']>('render'), { get: (t, k) => (k === 'decals' ? decals : Reflect.get(t, k)) }),
  });
  ctx.enemies = enemies;
  ctx.gore = noop('gore');
  ctx.hud = { hitMarker() {}, feed() {} } as unknown as Ctx['hud'];
  ctx.viewmodel = {
    equip() {}, holster() {}, reload() {}, swing() {}, setCharge() {}, setAkimbo() {}, setScoped() {}, fire() {},
    muzzle: (out: THREE.Vector3) => out, ejectPort: (out: THREE.Vector3) => out,
  } as unknown as Ctx['viewmodel'];
  const combat = new Combat(ctx);
  ctx.combat = combat as CombatSystem;
  const weapons = new Weapons(ctx);
  ctx.weapons = weapons as WeaponSystem;
  combat.init(ctx);
  weapons.init();

  const run = (seconds: number, fps = 60): void => {
    const frames = Math.round(seconds * fps);
    for (let i = 0; i < frames; i++) {
      ctx.time.tick(1 / fps);
      weapons.update();
      combat.update();
      input.endFrame();
    }
  };
  return {
    ctx, physics, input, player, enemies, weapons, combat, record, run,
    wall(z, thick, surface = 'concrete', x = 0, halfWidth = 10) {
      physics.addStaticBox(new THREE.Vector3(x, 2, z - thick / 2), new THREE.Vector3(halfWidth, 4, thick / 2), null, surface);
      physics.flushQueries();
    },
    tap(action) {
      input.simulate(action, true);
      run(1 / 60);
      input.simulate(action, false);
      run(1 / 60);
    },
    reset() {
      input.clear();
      weapons.reset();
      combat.reset();
      enemies.clear();
      record.impacts.length = record.tracers.length = record.puffs.length = record.sounds.length = 0;
      record.decals.length = record.blasts.length = 0;
      record.explosions = record.worldRays = 0;
      ctx.time.clearScales();
      run(0.5);
      record.sounds.length = 0;
      record.worldRays = 0;
    },
  };
}
