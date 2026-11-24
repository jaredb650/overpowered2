/**
 * Mounted guns: a heavy gun on a tripod behind a shield, placed by a map (`MapSpec.emplacement`) or the lab. The player
 * walks up, presses E, and is on the gun through the gunner's seat (`GunnerSeat` with `exposed`): the body stays standing
 * behind it and takes hits, the head above the shield. Ammunition never runs out; heat does. Hold the trigger too long
 * and the gun locks out until it has cooled right down. E again to step off.
 *
 * The ladder is `MOUNT_LEVELS`, data a shop can sell later: `upgrade(level)` swaps the gun and the shield in place.
 *
 * For allies, later: an AI mans a gun with `occupy(who)`, points it with `aimAt(point)`, holds the trigger with
 * `trigger(true)`, and gets off with `vacate(who)`. It stands at `standAt`. Heat, the arc and the rounds are the same
 * code the player goes through; nothing else about the AI lives here.
 *
 * Emplacements are fully destructible: gunfire, heavy ordnance, blast radii, Frame blows, and structural support
 * collapses can shatter the shield & tripod, eject/kill the gunner, leave a smoking twisted tripod wreck, emit
 * `'world:liquidated'`, and permanently disable interaction until the run resets (`clear()`).
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx, type ExplosionKind, type LoopHandle, type MuzzleKind, type PlayOptions } from '../core/contracts';
import type { EnemyInstance, ExplosionSpec, MissileTarget, ShotSpec } from '../core/gameplay';
import { clamp, rand, randomInCone, wrapAngle } from '../core/math';
import type { ExtraTarget, VehicleSystem } from '../enemies/vehicles';
import { groups } from '../physics/Physics';
import { ModelBuilder, type ModelMaterials } from '../progression/modelkit';
import { EXPLOSIONS } from '../weapons/data';
import { Gun, M134, type GunSpec } from './guns';
import { GunnerSeat, type SeatPlan, type SeatRig } from './seat';

export interface EmplacementSpec {
  /** The foot of the tripod. */
  pos: THREE.Vector3;
  /** Which way it faces, as a camera's yaw: 0 looks down -Z. */
  yaw: number;
  /** Radians it swings either side of `yaw`. */
  arc: number;
  /** 1 to 3, on MOUNT_LEVELS. Defaults to 1. */
  level?: number;
}

export interface MountLevel {
  name: string;
  gun: GunSpec;
  /** Structural durability of this mount before it explodes into a charred wreck. */
  maxHp: number;
  roundsPerSecond: number;
  damage: number;
  spread: number;
  severMult: number;
  force: number;
  /** Metres of concrete a round goes on through, and what a body costs it. */
  penetrate: number;
  bodyCost: number;
  impactScale: number;
  /** Heat each round adds. 1 is overheated. */
  heatPerShot: number;
  /** Heat lost a second off the trigger. */
  cool: number;
  /** Heat lost a second while locked out. The lockout ends at zero. */
  vent: number;
  /** Seconds for the barrels to come up to speed. 0 fires on the press. */
  spinUp: number;
  spinDown: number;
  /** Played for every round, or null for a gun heard as loops (the minigun's). */
  shot: string | null;
  pitch: number;
  flash: MuzzleKind;
  flashEvery: number;
  tracerEvery: number;
  /** Radians of walk on the view a round, and shake while it fires. */
  kick: number;
  trauma: number;
  /** Plate across the front, in metres: width, and its bottom and top above the ground. */
  shield: { width: number; bottom: number; top: number };
}

const IRON = '#3a4148';
const GUNMETAL = '#4d565f';
const WORN = '#6a747d';
const GRIP = '#22262b';
const BRASS = '#a4874c';
const OLIVE = '#4a5038';
const OLIVE_DARK = '#383d2b';
const CHARRED = '#1d1c1b';
const SCORCH = '#2b2622';
const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];

/** A Browning-pattern .50 on its cradle. Pivot at the trunnion, barrel along -Z, grips toward the gunner. */
export const HMG: GunSpec = {
  name: 'hmg',
  build: b => {
    b.box(0.16, 0.08, 0.3, IRON, { at: [0, -0.1, 0.05] });
    b.cyl(0.045, 0.05, 0.3, 8, IRON, { at: [0, -0.28, 0.05] });
    b.box(0.2, 0.2, 0.62, GUNMETAL, { at: [0, 0.02, 0.08] });
    b.box(0.18, 0.03, 0.4, WORN, { at: [0, 0.135, 0.12] });
    b.box(0.03, 0.04, 0.12, IRON, { at: [0.12, 0.05, 0.1] });
    b.box(0.04, 0.06, 0.02, IRON, { at: [0, 0.17, 0.3] });
    // Spade grips and the butterfly trigger between them.
    b.box(0.24, 0.03, 0.04, IRON, { at: [0, -0.02, 0.42] });
    for (const s of [1, -1]) b.cyl(0.02, 0.02, 0.14, 8, GRIP, { at: [s * 0.1, 0.03, 0.44] });
    b.box(0.05, 0.03, 0.02, BRASS, { at: [0, 0.01, 0.41] });
    // Ammunition can on the left and the belt up into the feed.
    b.box(0.13, 0.19, 0.3, OLIVE, { at: [-0.21, -0.07, 0.05] });
    for (let i = 0; i < 3; i++) b.box(0.07, 0.025, 0.05, BRASS, { at: [-0.15 + i * 0.025, 0.04 + i * 0.03, 0.02 + i * 0.02], rot: [0, 0, -0.6] });
  },
  moving: b => {
    b.cyl(0.05, 0.05, 0.3, 10, IRON, { at: [0, 0.02, -0.36], rot: ALONG_Z });
    b.cyl(0.028, 0.028, 1.0, 8, IRON, { at: [0, 0.02, -0.95], rot: ALONG_Z });
    b.box(0.03, 0.06, 0.12, WORN, { at: [0, 0.09, -0.4] });
    b.box(0.012, 0.05, 0.012, IRON, { at: [0, 0.07, -1.38] });
    b.cyl(0.04, 0.035, 0.1, 8, GUNMETAL, { at: [0, 0.02, -1.48], rot: ALONG_Z });
  },
  muzzle: [0, 0.02, -1.54],
  follow: 18,
  return: 26,
};

const HMG_LEVEL: MountLevel = {
  name: 'M2 .50 // MOUNT I', gun: HMG, maxHp: 240,
  roundsPerSecond: 8, damage: 70, spread: 0.006, severMult: 4, force: 40, penetrate: 1.2, bodyCost: 0.3, impactScale: 1.6,
  heatPerShot: 1 / 64, cool: 0.25, vent: 0.33,
  spinUp: 0, spinDown: 0, shot: 'hmg_shot', pitch: 1, flash: 'hmg', flashEvery: 3, tracerEvery: 3,
  kick: 0.006, trauma: 0.04,
  shield: { width: 1.1, bottom: 0.6, top: 1.28 },
};

/** The ladder, lowest first. Level n is `MOUNT_LEVELS[n - 1]`. */
export const MOUNT_LEVELS: readonly MountLevel[] = [
  HMG_LEVEL,
  // Faster, and a plate wide and tall enough to hide behind to the shoulders.
  {
    ...HMG_LEVEL, name: 'M2A1 .50 // MOUNT II', maxHp: 320,
    roundsPerSecond: 11, heatPerShot: 1 / 88, cool: 0.3, vent: 0.4, pitch: 1.1,
    shield: { width: 1.6, bottom: 0.35, top: 1.36 },
  },
  // The door gun's rotary: it spins up, then pours. Its own heat: about six seconds of fire.
  {
    name: 'M134 ROTARY // MOUNT III', gun: M134, maxHp: 450,
    roundsPerSecond: 33, damage: 32, spread: 0.012, severMult: 2.6, force: 30, penetrate: 0.4, bodyCost: 0.3, impactScale: 1.4,
    heatPerShot: 1 / 200, cool: 0.3, vent: 0.4,
    spinUp: 0.6, spinDown: 1.1, shot: null, pitch: 1, flash: 'rotary', flashEvery: 2, tracerEvery: 4,
    kick: 0.0035, trauma: 0.035,
    shield: { width: 1.6, bottom: 0.35, top: 1.36 },
  },
];

/** Heat on one gun: rounds put it in, time takes it out, and the top locks the trigger until it is back to nothing. */
export class Heat {
  value = 0;
  overheated = false;

  /** Any gun with the three heat numbers: a rung of the ladder, or the Frame's rotary. */
  constructor(public level: Pick<MountLevel, 'heatPerShot' | 'cool' | 'vent'>) {}

  /** One round. True if that was the one that locked it out. */
  shot(): boolean {
    if (this.overheated) return false;
    this.value += this.level.heatPerShot;
    if (this.value < 1) return false;
    this.value = 1;
    this.overheated = true;
    return true;
  }

  /** `firing` holds the heat where it is: a gun only cools off the trigger. */
  cool(dt: number, firing: boolean): void {
    if (this.overheated) {
      this.value = Math.max(0, this.value - this.level.vent * dt);
      if (this.value === 0) this.overheated = false;
    } else if (!firing) {
      this.value = Math.max(0, this.value - this.level.cool * dt);
    }
  }
}

/** How close the player has to be to get on: to the spot behind the gun, or the gun itself. */
const REACH = 1.7;
/** Trunnion height above the tripod's foot. */
const PIVOT = 1.2;
/** The gunner's feet behind the pivot, and the shield's face ahead of it. */
const STAND_BACK = 0.95;
const SHIELD_AHEAD = 0.45;
const SHIELD_THICK = 0.04;
const STOWED_PITCH = -0.12;
/** Below this, the sight is on something right in front of the gun, the shield's own edge, and rounds go down the bore. */
const NEAR_SIGHT = 4;
/** Radians a second at full spin. */
const BARREL_RATE = 60;
/** Share of full spin at which a rotary starts to fire. */
const FIRE_AT = 0.85;
const SPIN_PITCH = 0.45;
/** The minigun's fire loop is written at 25 rounds a second. */
const LOOP_RATE = 25;

const _muzzle = new THREE.Vector3();
const _bore = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _casing = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function seatPlan(level: MountLevel, arc: number): SeatPlan {
  return {
    label: level.name, tone: 'mount', seconds: Infinity, fov: 72, zoomFov: 42, aimZooms: true,
    arcCenter: 0, arcHalf: arc, pitchMin: -0.15, pitchMax: 0.45, lock: 0, roll: 0, eye: [0, 0.38, 0.75], reach: 300,
    grade: null, enemyColor: '#ff7a30', grace: 0, shake: 1, exposed: true,
  };
}

function tripod(b: ModelBuilder): void {
  b.cyl(0.05, 0.06, PIVOT - 0.62, 8, IRON, { at: [0, (PIVOT + 0.52) / 2 - 0.2, 0] });
  b.cyl(0.09, 0.09, 0.08, 10, GUNMETAL, { at: [0, 0.5, 0] });
  // Two legs forward and one long one back, as an M3 tripod stands.
  for (const [x, z] of [[-0.55, -0.55], [0.55, -0.55], [0, 0.95]] as const) {
    _to.set(x, -0.48, z);
    const length = _to.length();
    _q.setFromUnitVectors(UP, _to.normalize());
    const e = new THREE.Euler().setFromQuaternion(_q);
    b.cyl(0.03, 0.035, length, 6, IRON, { at: [x / 2, 0.5 - 0.24, z / 2], rot: [e.x, e.y, e.z] });
    b.box(0.1, 0.03, 0.14, IRON, { at: [x, 0.015, z] });
  }
}

function shield(b: ModelBuilder, s: MountLevel['shield']): void {
  const notch = 0.11;
  const half = s.width / 2;
  const tall = s.top - s.bottom;
  const midY = (s.top + s.bottom) / 2 - PIVOT;
  const side = half - notch;
  // Two leaves either side of a slot the barrel runs through, and the plate under it.
  for (const k of [1, -1]) b.box(side, tall, SHIELD_THICK, OLIVE, { at: [k * (notch + side / 2), midY, -SHIELD_AHEAD] });
  const under = PIVOT - 0.1 - s.bottom;
  b.box(notch * 2, under, SHIELD_THICK, OLIVE, { at: [0, s.bottom + under / 2 - PIVOT, -SHIELD_AHEAD] });
  b.box(s.width, 0.04, SHIELD_THICK + 0.02, OLIVE_DARK, { at: [0, s.top - PIVOT - 0.02, -SHIELD_AHEAD] });
  // Arms back to the cradle.
  for (const k of [1, -1]) b.box(0.03, 0.03, SHIELD_AHEAD, IRON, { at: [k * 0.14, -0.14, -SHIELD_AHEAD / 2] });
}

function charredWreck(b: ModelBuilder): void {
  // Twisted, splayed charred tripod base + snapped pintle + bent barrel stub + scorched shield shard on the ground.
  b.cyl(0.08, 0.1, 0.08, 8, CHARRED, { at: [0, 0.24, 0], rot: [0.35, 0.2, 0.28] });
  b.cyl(0.045, 0.055, 0.36, 6, SCORCH, { at: [0.06, 0.38, -0.04], rot: [0.65, 0.1, -0.45] });
  // Three bent/broken legs splayed flat onto the ground.
  b.cyl(0.028, 0.032, 0.85, 6, CHARRED, { at: [-0.36, 0.12, -0.34], rot: [0.95, 0.3, 0.85] });
  b.cyl(0.028, 0.032, 0.78, 6, CHARRED, { at: [0.38, 0.1, -0.26], rot: [1.1, -0.2, -0.95] });
  b.cyl(0.028, 0.032, 0.92, 6, SCORCH, { at: [0.05, 0.09, 0.44], rot: [-1.25, 0.15, 0.2] });
  // Bent barrel remnant & crumpled shield scrap lying beside the tripod.
  b.cyl(0.026, 0.032, 0.72, 6, CHARRED, { at: [-0.28, 0.05, -0.58], rot: [Math.PI / 2 - 0.08, 0.55, 0.12] });
  b.box(0.46, 0.04, 0.34, SCORCH, { at: [0.34, 0.03, -0.46], rot: [0.14, -0.4, 0.22] });
}

interface ScrapPiece {
  readonly mesh: THREE.Group;
  body: RAPIER.RigidBody | null;
  readonly vel: THREE.Vector3;
  readonly angVel: THREE.Vector3;
  age: number;
  readonly maxAge: number;
}

const SCRAP_MAX_AGE = 12;
const SCRAP_FADE_TIME = 2.0;
const _down = new THREE.Vector3(0, -1, 0);
const _rayOrigin = new THREE.Vector3();
const _euler = new THREE.Euler();
const _stepQ = new THREE.Quaternion();

/** Anything an AI uses to say it is the one on the gun. */
export type Occupant = object;

/**
 * Whose rounds these are. The player's are `emplacement`, and pay and score like his own; an ally's are `ally_` like every ally's gun
 * (allies/data.ts `ALLY_SOURCE`), so progression, the economy and the hit sounds treat them as his and not the player's.
 */
export const gunSource = (occupant: 'player' | Occupant | null): string => (occupant === 'player' || occupant === null ? 'emplacement' : 'ally_emplacement');

/**
 * The enemy on a gun (a mission's wall gunner): his rounds are enemy rounds, which only the player meets, at a man's share of the damage
 * and wider, because a gun that shot the player as the player shoots it would end every run on the first burst.
 */
export const HOSTILE_GUN = { source: 'enemy_emplacement', damage: 6, spread: 4 } as const;

export class Emplacement {
  /** Who is on the gun: 'player' through the seat, an AI by `occupy`, or nobody. */
  occupant: 'player' | Occupant | null = null;
  /** The man on it is the enemy's. */
  hostile = false;
  level: MountLevel;
  /** Structural durability of the mount; reaches 0 -> explodes into a charred unusable wreck. */
  hp: number;
  maxHp: number;
  destroyed = false;
  readonly heat: Heat;
  /** Where the gun turns. */
  readonly pivot = new THREE.Vector3();
  /** Where whoever mans it stands. */
  readonly standAt = new THREE.Vector3();
  /** Over the gun, for the prompt. */
  readonly top = new THREE.Vector3();
  readonly root = new THREE.Group();
  private readonly baseGroup: THREE.Group;
  private readonly wreckGroup: THREE.Group;
  private readonly guns = new Map<GunSpec, Gun>();
  private gun: Gun;
  private readonly shieldPivot = new THREE.Group();
  private readonly shieldCollider: RAPIER.Collider;
  private readonly bodyCollider: RAPIER.Collider;
  /** The gun's frame for the seat: its nose (+Z) points behind it, as an aircraft's does. */
  private readonly frame = new THREE.Quaternion();
  private seat: GunnerSeat | null = null;
  private rig: SeatRig | null = null;
  private yaw: number;
  private pitch = STOWED_PITCH;
  private spin = 0;
  private roundIn = 0;
  private fired = 0;
  private aimPoint: THREE.Vector3 | null = null;
  private held = false;
  /**
   * Co-op: whoever is on it is on another screen (contracts/defense `seats`). It swings, kicks, flashes and sounds here as theirs
   * does, but its rounds are drawn only: the damage is done where its gunner is.
   */
  remote = false;
  /** The trigger was down and the gun was firing on the last frame. */
  shooting = false;
  private spinLoop: LoopHandle | null = null;
  private fireLoop: LoopHandle | null = null;
  private readonly shotSpec: ShotSpec;
  private readonly voice: PlayOptions = {};
  private readonly scrap: ScrapPiece[] = [];
  private wreckSmokeLeft = 0;
  private wreckSmokeIn = 0;
  private hadSupport = false;
  private supportCheckIn = 0;

  constructor(private readonly ctx: Ctx, private readonly materials: ModelMaterials, readonly spec: EmplacementSpec) {
    const { pos, yaw } = spec;
    this.yaw = yaw;
    this.pivot.set(pos.x, pos.y + PIVOT, pos.z);
    this.standAt.set(pos.x + Math.sin(yaw) * STAND_BACK, pos.y, pos.z + Math.cos(yaw) * STAND_BACK);
    this.top.set(pos.x, pos.y + PIVOT + 0.6, pos.z);
    this.frame.setFromAxisAngle(UP, yaw + Math.PI);
    this.root.name = 'emplacement';

    const legs = new ModelBuilder();
    tripod(legs);
    this.baseGroup = materials.group(legs, materials.solid);
    this.baseGroup.position.copy(pos);
    this.baseGroup.rotation.y = yaw;

    const wreck = new ModelBuilder();
    charredWreck(wreck);
    this.wreckGroup = materials.group(wreck, materials.solid);
    this.wreckGroup.position.copy(pos);
    this.wreckGroup.rotation.y = yaw;
    this.wreckGroup.visible = false;

    this.shieldPivot.position.copy(this.pivot);
    this.root.add(this.baseGroup, this.wreckGroup, this.shieldPivot);
    ctx.render.scene.add(this.root);

    this.shieldCollider = ctx.physics.addStaticBox(this.pivot, _v.set(0.5, 0.3, SHIELD_THICK / 2), null, 'metal');
    // Tripod & receiver body hitbox: y in [pos.y + 0.10, pos.y + 1.26], strictly above support raycast origin and below gunner eye.
    this.bodyCollider = ctx.physics.addStaticBox(
      _v.set(pos.x, pos.y + 0.68, pos.z),
      new THREE.Vector3(0.44, 0.58, 0.44),
      null,
      'metal',
    );
    this.placeBodyCollider();

    this.level = MOUNT_LEVELS[0]!;
    this.maxHp = this.level.maxHp;
    this.hp = this.maxHp;
    this.heat = new Heat(this.level);
    this.gun = this.gunFor(this.level);
    this.shotSpec = { damage: 0, source: 'emplacement', team: 'player', maxDistance: 300, tracerFrom: _muzzle };
    this.upgrade(spec.level ?? 1);
  }

  /** Collider handles owned by this emplacement (`shield`, `body`) for hitscan & ordnance routing. */
  colliderHandles(): readonly [number, number] {
    return [this.shieldCollider.handle, this.bodyCollider.handle];
  }

  /** Direct collider accessor (shield or body) for weapon routing and tests. */
  colliderFor(part: 'shield' | 'body'): RAPIER.Collider {
    return part === 'shield' ? this.shieldCollider : this.bodyCollider;
  }

  private gunFor(level: MountLevel): Gun {
    let gun = this.guns.get(level.gun);
    if (!gun) {
      gun = new Gun(this.materials, this.ctx.render.scene, level.gun);
      gun.snap(this.yaw, this.pitch);
      this.guns.set(level.gun, gun);
    }
    return gun;
  }

  /** Onto rung `level` of MOUNT_LEVELS, clamped to the ladder. Heat carries over as a share. */
  upgrade(level: number): void {
    if (this.destroyed) return;
    const next = MOUNT_LEVELS[clamp(Math.round(level), 1, MOUNT_LEVELS.length) - 1]!;
    const hpRatio = this.maxHp > 0 ? clamp(this.hp / this.maxHp) : 1;
    this.silence();
    this.level = this.heat.level = next;
    this.maxHp = next.maxHp;
    this.hp = Math.max(1, Math.round(next.maxHp * hpRatio));
    if (this.seat) {
      this.seat.plan.label = next.name;
      this.rig?.hud.open(this.seat);
    }
    const gun = this.gunFor(next);
    if (gun !== this.gun) this.gun.hide();
    this.gun = gun;
    gun.snap(this.yaw, this.pitch);
    gun.point(this.pivot, this.yaw, this.pitch, 0);
    const b = new ModelBuilder();
    shield(b, next.shield);
    for (const child of [...this.shieldPivot.children]) {
      this.shieldPivot.remove(child);
      child.traverse(o => (o as THREE.Mesh).geometry?.dispose());
    }
    this.shieldPivot.add(this.materials.group(b, this.materials.solid));
    const s = next.shield;
    this.shieldCollider.setHalfExtents(_v.set(s.width / 2, (s.top - s.bottom) / 2, SHIELD_THICK / 2));
    this.placeShield();
  }

  get levelNumber(): number {
    return MOUNT_LEVELS.indexOf(this.level) + 1;
  }

  // ---- destructibility & structural support -------------------------------------------------------------------

  /**
   * Applies weapon, blast, or crush damage to this emplacement.
   * Returns `true` if this hit destroyed the emplacement.
   */
  damage(amount: number, source: string, at?: THREE.Vector3): boolean {
    if (this.destroyed || amount <= 0) return false;
    const { audio, fx, hud } = this.ctx;
    const hitAt = at ?? this.pivot;
    this.hp = Math.max(0, this.hp - amount);
    const broke = this.hp <= 0;

    fx.chips(hitAt, broke ? 0xff9430 : 0xffaa44, broke ? 16 : 6);
    fx.sparks?.(hitAt, UP, broke ? 18 : 7);
    hud.hitMarker(broke ? 'kill' : 'armor');
    audio.play(broke ? 'plate_destroyed' : 'hit_marker', { position: hitAt, pitch: broke ? 0.95 : 1.08 });

    if (broke) {
      this.destroy(source, hitAt);
      return true;
    }
    return false;
  }

  /** Shatters the emplacement into a charred smoking wreck, vacating/blasting any occupant and emitting `world:liquidated`. */
  destroy(_source: string, at?: THREE.Vector3): void {
    if (this.destroyed) return;
    const { audio, camera, enemies, events, fx, hud, player, render } = this.ctx;
    this.destroyed = true;
    this.hp = 0;

    // Eject/vacate whoever is on the gun.
    const prevOccupant = this.occupant;
    const wasHostile = this.hostile;
    if (this.seat) {
      this.seat.leave(true);
      this.seat = null;
    }
    this.occupant = null;
    this.hostile = false;
    this.remote = false;
    this.aimPoint = null;
    this.held = false;
    this.shooting = false;
    this.spin = 0;
    this.silence();

    if (wasHostile && prevOccupant && prevOccupant !== 'player') {
      const gunner = prevOccupant as EnemyInstance;
      if (gunner.alive && typeof enemies?.applyDamage === 'function') {
        _dir.set(Math.sin(this.yaw), 0.45, Math.cos(this.yaw)).normalize();
        enemies.applyDamage(gunner, {
          amount: 320,
          type: 'explosive',
          point: this.pivot,
          dir: _dir,
          force: 55,
          source: 'emplacement_blast',
          blastKind: 'grenade',
        });
      }
    }

    // Hide intact mount visuals & park colliders so nothing blocks movement or shots.
    this.baseGroup.visible = false;
    this.shieldPivot.visible = false;
    this.gun.hide();
    this.wreckGroup.visible = true;
    this.wreckSmokeLeft = 18;
    this.wreckSmokeIn = 0.08;
    this.parkColliders();

    // Explosion, metal sparks, smoke, flying scrap pieces, flash light, and audio.
    const blastAt = at ?? this.pivot;
    fx.explosion(this.pivot, { radius: 4.5, kind: 'grenade', scale: 1.15 });
    fx.chips(this.pivot, 0xff9830, 26);
    fx.embers(this.pivot, 22, 2.8);
    fx.sparks?.(blastAt, UP, 24);
    fx.smoke(this.pivot, 0x242220, 2.4, 2.6);
    render.lights.flash(this.pivot, 0xff9a38, 18, 32, 0.35);
    audio.play('veh_destroyed', { position: this.pivot, pitch: 1.15, volume: 0.9 });
    audio.play('explosion_debris', { position: this.pivot, pitch: 1.1, volume: 0.8 });
    if (player.position.distanceTo(this.pivot) <= 25) {
      camera.addTrauma(0.38);
    }
    hud.feed('EMPLACED HMG DESTROYED', '#ff8c38');
    this.spawnScrap();

    events.emit('world:liquidated', {
      label: 'EMPLACED HMG',
      value: 12000,
      kind: 'emplacement',
      position: this.spec.pos.clone(),
    });
  }

  /**
   * Checks whether an elevated emplacement (`pos.y > 0.35`) still rests on solid geometry.
   * When its supporting platform/tower collapses, destroys the emplacement with `'structural_collapse'`.
   */
  checkSupport(forceIfElevated = false): boolean {
    if (this.destroyed || this.spec.pos.y <= 0.35) return false;
    const physics = this.ctx.physics;
    if (typeof physics?.raycast !== 'function') return false;
    _rayOrigin.set(this.spec.pos.x, this.spec.pos.y + 0.06, this.spec.pos.z);
    const hit = physics.raycast(_rayOrigin, _down, 0.85, CG.World);
    if (hit) {
      this.hadSupport = true;
      return false;
    }
    if (this.hadSupport || forceIfElevated) {
      this.destroy('structural_collapse', this.pivot);
      return true;
    }
    return false;
  }

  private spawnScrap(): void {
    this.clearScrap();
    const { physics, render } = this.ctx;
    const R = physics.R;
    const world = physics.world;
    const hasRapier = Boolean(R?.RigidBodyDesc && R?.ColliderDesc && typeof world?.createRigidBody === 'function');
    const pieces: readonly { dims: readonly [number, number, number]; color: string; yOff: number }[] = [
      { dims: [0.46, 0.34, 0.05], color: OLIVE, yOff: 1.05 },      // torn shield plate
      { dims: [0.1, 0.1, 0.72], color: IRON, yOff: 1.22 },         // snapped barrel
      { dims: [0.18, 0.22, 0.3], color: OLIVE_DARK, yOff: 1.15 },  // ammo box
      { dims: [0.08, 0.08, 0.56], color: GUNMETAL, yOff: 0.72 },   // tripod strut
      { dims: [0.22, 0.14, 0.32], color: CHARRED, yOff: 1.18 },    // receiver cradle
    ];

    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i]!;
      const b = new ModelBuilder().box(p.dims[0], p.dims[1], p.dims[2], p.color);
      const mesh = this.materials.group(b, this.materials.solid);
      const ang = (i / pieces.length) * Math.PI * 2 + rand(-0.4, 0.4);
      const spawnPos = new THREE.Vector3(
        this.spec.pos.x + Math.cos(ang) * 0.28,
        this.spec.pos.y + p.yOff,
        this.spec.pos.z + Math.sin(ang) * 0.28,
      );
      mesh.position.copy(spawnPos);
      render.scene.add(mesh);

      const speed = rand(5.5, 11.5);
      const vel = new THREE.Vector3(Math.cos(ang) * speed, rand(5.5, 10.5), Math.sin(ang) * speed);
      const angVel = new THREE.Vector3(rand(-7, 7), rand(-6, 6), rand(-7, 7));

      let body: RAPIER.RigidBody | null = null;
      if (hasRapier) {
        const bd = R.RigidBodyDesc.dynamic()
          .setTranslation(spawnPos.x, spawnPos.y, spawnPos.z)
          .setLinearDamping(0.25)
          .setAngularDamping(0.35);
        body = world.createRigidBody(bd);
        const cd = R.ColliderDesc.cuboid(p.dims[0] / 2, p.dims[1] / 2, p.dims[2] / 2)
          .setDensity(1.8)
          .setRestitution(0.3)
          .setFriction(0.75)
          .setCollisionGroups(groups(CG.Debris, CG.World | CG.Debris));
        world.createCollider(cd, body);
        body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
        body.setAngvel({ x: angVel.x, y: angVel.y, z: angVel.z }, true);
      }

      this.scrap.push({ mesh, body, vel, angVel, age: 0, maxAge: SCRAP_MAX_AGE + rand(-2, 2) });
    }
  }

  private updateScrap(dt: number): void {
    const world = this.ctx.physics.world;
    const floorY = this.spec.pos.y + 0.08;
    for (let i = this.scrap.length - 1; i >= 0; i--) {
      const s = this.scrap[i]!;
      s.age += dt;
      if (s.age >= s.maxAge) {
        this.retireScrap(s);
        this.scrap.splice(i, 1);
        continue;
      }
      if (s.body) {
        const t = s.body.translation();
        const r = s.body.rotation();
        s.mesh.position.set(t.x, t.y, t.z);
        s.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      } else {
        s.vel.y -= 20 * dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        _euler.set(s.angVel.x * dt, s.angVel.y * dt, s.angVel.z * dt);
        _stepQ.setFromEuler(_euler);
        s.mesh.quaternion.multiply(_stepQ);
        if (s.mesh.position.y <= floorY) {
          s.mesh.position.y = floorY;
          s.vel.y = s.vel.y < -1.5 ? -s.vel.y * 0.25 : 0;
          s.vel.x *= Math.max(0, 1 - 5 * dt);
          s.vel.z *= Math.max(0, 1 - 5 * dt);
          s.angVel.multiplyScalar(Math.max(0, 1 - 6 * dt));
        }
      }
      const remaining = s.maxAge - s.age;
      if (remaining < SCRAP_FADE_TIME) {
        s.mesh.scale.setScalar(clamp(remaining / SCRAP_FADE_TIME, 0.01, 1));
      }
    }
  }

  private retireScrap(s: ScrapPiece): void {
    const world = this.ctx.physics.world;
    if (s.body && typeof world?.removeRigidBody === 'function') {
      world.removeRigidBody(s.body);
      s.body = null;
    }
    s.mesh.removeFromParent();
    s.mesh.traverse(o => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
  }

  private clearScrap(): void {
    for (const s of this.scrap) this.retireScrap(s);
    this.scrap.length = 0;
  }

  // ---- an AI on the gun ---------------------------------------------------------------------------------------

  /** Takes the gun for `who`. False if destroyed or someone is already on it. `hostile`: he is the enemy's (HOSTILE_GUN). */
  occupy(who: Occupant, hostile = false): boolean {
    if (this.destroyed || this.occupant) return false;
    this.occupant = who;
    this.hostile = hostile;
    return true;
  }

  vacate(who: Occupant): void {
    if (this.occupant !== who) return;
    this.occupant = null;
    this.hostile = false;
    this.remote = false;
    this.aimPoint = null;
    this.held = false;
    this.silence();
  }

  /** Where it points now, as world yaw and pitch. */
  get aimYaw(): number { return this.yaw; }
  get aimPitch(): number { return this.pitch; }

  /** Where the AI wants the gun. It swings there at the gun's own rate, inside its arc. */
  aimAt(point: THREE.Vector3): void {
    if (this.destroyed) return;
    this.aimPoint = (this.aimPoint ?? new THREE.Vector3()).copy(point);
  }

  trigger(held: boolean): void {
    if (this.destroyed) return;
    this.held = held;
  }

  // ---- the player on the gun ----------------------------------------------------------------------------------

  /** The player takes the gun. The owner holsters the player's own weapon. */
  man(rig: SeatRig): void {
    if (this.destroyed) return;
    const seat = new GunnerSeat(this.ctx, rig, seatPlan(this.level, this.spec.arc));
    seat.fixed(this.standAt);
    seat.noWayOut = false;
    this.seat = seat;
    this.rig = rig;
    this.occupant = 'player';
    seat.board();
    _to.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(30).add(this.pivot);
    seat.sit(_to, this.pivot);
    this.ctx.audio.play('weapon_draw_heavy');
  }

  /** Off the gun, whoever is on it, quietly, and restores destroyed mounts intact. For a new run / checkpoint. */
  clear(): void {
    this.seat?.leave(true);
    this.seat = null;
    this.occupant = null;
    this.hostile = false;
    this.remote = false;
    this.aimPoint = null;
    this.held = false;
    this.shooting = false;
    this.heat.value = 0;
    this.heat.overheated = false;
    this.spin = 0;
    this.silence();
    this.clearScrap();
    this.destroyed = false;
    this.hp = this.maxHp;
    this.hadSupport = false;
    this.supportCheckIn = 0;
    this.wreckSmokeLeft = 0;
    this.baseGroup.visible = true;
    this.shieldPivot.visible = true;
    this.wreckGroup.visible = false;
    this.yaw = this.spec.yaw;
    this.pitch = STOWED_PITCH;
    this.gun.snap(this.yaw, this.pitch);
    this.gun.point(this.pivot, this.yaw, this.pitch, 0);
    this.placeBodyCollider();
    this.placeShield();
  }

  update(dt: number): void {
    if (this.destroyed) {
      if (this.scrap.length > 0) this.updateScrap(dt);
      if (this.wreckSmokeLeft > 0) {
        this.wreckSmokeLeft -= dt;
        this.wreckSmokeIn -= dt;
        if (this.wreckSmokeIn <= 0) {
          this.wreckSmokeIn = rand(0.28, 0.55);
          _v.set(this.spec.pos.x, this.spec.pos.y + 0.35, this.spec.pos.z);
          this.ctx.fx.smoke(_v, 0x1e1c1a, 1.3, 1.9);
          if (Math.random() < 0.35) this.ctx.fx.embers(_v, 3, 1.2);
        }
      }
      return;
    }

    if (this.spec.pos.y > 0.35) {
      this.supportCheckIn -= dt;
      if (this.supportCheckIn <= 0) {
        this.supportCheckIn = 0.35;
        if (this.checkSupport(false)) return;
      }
    }

    const { input } = this.ctx;
    const { seat } = this;
    let firing = false;
    let target: THREE.Vector3 | null = null;
    if (seat && seat.stage === 'left') {
      // Death, a new run or the key: the seat is already empty, and this only notices.
      this.seat = null;
      this.occupant = null;
      this.silence();
    } else if (seat) {
      seat.update(dt, this.frame, this.pivot);
      if (input.pressed('interact')) {
        seat.leave();
      } else {
        this.yaw = seat.yaw;
        this.pitch = seat.pitch;
        firing = input.isDown('fire');
        if (firing && this.heat.overheated && input.pressed('fire')) this.ctx.audio.play('weapon_dry');
        if (seat.range > NEAR_SIGHT) target = seat.point;
      }
    } else if (this.occupant && this.aimPoint) {
      this.steer(dt, this.aimPoint);
      firing = this.held;
      target = this.aimPoint;
    }
    this.gun.point(this.pivot, this.yaw, this.pitch, dt);
    this.placeShield();
    this.shooting = firing && !this.heat.overheated;
    this.fire(dt, firing, target);
    if (this.seat) {
      this.seat.heat = this.heat.value;
      this.seat.overheated = this.heat.overheated;
      this.seat.spin = this.spin;
    }
  }

  /** An AI's aim: toward the point at a gunner's pace, held inside the arc. */
  private steer(dt: number, point: THREE.Vector3): void {
    _to.subVectors(point, this.pivot);
    const { yaw, arc } = this.spec;
    const want = yaw + clamp(wrapAngle(Math.atan2(-_to.x, -_to.z) - yaw), -arc, arc);
    const step = 2.5 * dt;
    this.yaw += clamp(wrapAngle(want - this.yaw), -step, step);
    this.pitch += clamp(clamp(Math.atan2(_to.y, Math.hypot(_to.x, _to.z)), -0.15, 0.45) - this.pitch, -step, step);
  }

  private placeBodyCollider(): void {
    _q.setFromAxisAngle(UP, this.spec.yaw);
    _v.set(this.spec.pos.x, this.spec.pos.y + 0.68, this.spec.pos.z);
    this.bodyCollider.setTranslation(_v);
    this.bodyCollider.setRotation(_q);
  }

  private placeShield(): void {
    this.shieldPivot.rotation.y = this.yaw;
    const s = this.level.shield;
    _q.setFromAxisAngle(UP, this.yaw);
    _v.set(0, (s.top + s.bottom) / 2 - PIVOT, -SHIELD_AHEAD).applyQuaternion(_q).add(this.pivot);
    this.shieldCollider.setTranslation(_v);
    this.shieldCollider.setRotation(_q);
  }

  private parkColliders(): void {
    _v.set(0, -1000, 0);
    this.shieldCollider.setTranslation(_v);
    this.bodyCollider.setTranslation(_v);
  }

  private fire(dt: number, held: boolean, target: THREE.Vector3 | null): void {
    const L = this.level;
    const { heat } = this;
    const want = held && !heat.overheated;
    this.voice.position = this.seat ? undefined : this.pivot;
    if (L.spinUp > 0) {
      this.spin = clamp(this.spin + (want ? dt / L.spinUp : -dt / L.spinDown));
      this.gun.turn(this.spin * BARREL_RATE * dt);
      this.spinSound(want);
    } else {
      this.spin = want ? 1 : 0;
    }
    const shooting = want && this.spin >= (L.spinUp > 0 ? FIRE_AT : 1);
    if (shooting) {
      if (L.shot === null) this.fireLoop ??= this.ctx.audio.startLoop('minigun_fire_loop', { fadeIn: 0.03, pitch: L.roundsPerSecond / LOOP_RATE, position: this.voice.position });
      this.roundIn -= dt;
      for (let i = 0; this.roundIn <= 0 && i < 4; i++) {
        this.roundIn += 1 / L.roundsPerSecond;
        this.round(target);
        if (heat.shot()) {
          this.overheat();
          break;
        }
      }
      // A long frame's debt is forgiven, so the rate never bursts to catch up.
      if (this.roundIn < 0) this.roundIn = 0;
    } else {
      this.roundIn = Math.max(0, this.roundIn - dt);
      this.ceaseFire();
    }
    heat.cool(dt, shooting);
  }

  private round(target: THREE.Vector3 | null): void {
    const { camera, combat, fx, audio } = this.ctx;
    const L = this.level;
    const { gun, shotSpec } = this;
    gun.muzzle(_muzzle);
    gun.bore(_bore);
    if (target) _to.subVectors(target, _muzzle).normalize();
    else _to.copy(_bore);
    const hostile = this.hostile && this.occupant !== 'player';
    randomInCone(_to, hostile ? L.spread * HOSTILE_GUN.spread : L.spread, _dir);
    this.fired++;
    shotSpec.team = hostile ? 'enemy' : 'player';
    shotSpec.damage = hostile ? HOSTILE_GUN.damage : L.damage;
    shotSpec.severMult = L.severMult;
    shotSpec.force = L.force;
    shotSpec.penetrate = L.penetrate;
    shotSpec.bodyCost = L.bodyCost;
    shotSpec.impactScale = L.impactScale;
    shotSpec.tracer = this.fired % L.tracerEvery === 0 ? 'heavy' : undefined;
    shotSpec.source = hostile ? HOSTILE_GUN.source : gunSource(this.occupant);
    if (this.remote) {
      // Someone else's gun, seen from here: the tracer is drawn to whatever the world puts in its way, and hurts nothing.
      if (shotSpec.tracer) {
        const hit = this.ctx.physics.raycast(_muzzle, _dir, 260, CG.World);
        fx.tracer(_muzzle, _to.copy(_muzzle).addScaledVector(_dir, hit ? hit.distance : 260), shotSpec.tracer);
      }
    } else combat.fireRay(_muzzle, _dir, shotSpec);
    if (this.fired % L.flashEvery === 0) fx.muzzleFlash(_muzzle, _bore, L.flash);
    if (this.fired % 2 === 0) {
      _casing.set(-_bore.z, 0, _bore.x).multiplyScalar(1.6);
      _casing.y = rand(1, 2);
      fx.shellCasing(gun.root.position, _casing, 'cannon');
    }
    if (L.shot) {
      this.voice.pitch = L.pitch;
      this.voice.pitchJitter = 0.03;
      audio.play(L.shot, this.voice);
      gun.recoil(0.05);
    }
    if (this.seat) {
      camera.kick(rand(0, L.kick), rand(-L.kick, L.kick));
      camera.addTrauma(L.trauma);
    }
  }

  private overheat(): void {
    this.ctx.audio.play('steam_burst', { position: this.pivot, volume: 0.9 });
  }

  private spinSound(want: boolean): void {
    const { audio } = this.ctx;
    if (want && !this.spinLoop) {
      audio.play('minigun_spinup', this.voice);
      this.spinLoop = audio.startLoop('minigun_spin_loop', { fadeIn: 0.1, position: this.voice.position });
    } else if (!want && this.spinLoop) {
      this.spinLoop.stop(0.2);
      this.spinLoop = null;
      // Written from full spin: a gun let go part way up starts it part way down.
      audio.play('minigun_spindown', { position: this.voice.position, offset: (1 - this.spin) * this.level.spinDown });
    }
    this.spinLoop?.setPitch(SPIN_PITCH + (1 - SPIN_PITCH) * this.spin, 0.04);
  }

  private ceaseFire(): void {
    if (!this.fireLoop) return;
    this.fireLoop.stop(0.08);
    this.fireLoop = null;
    this.ctx.audio.play('minigun_fire', { position: this.voice.position });
  }

  private silence(): void {
    this.ceaseFire();
    this.spinLoop?.stop(0.2);
    this.spinLoop = null;
  }
}

/** Every gun on the map, the key that gets the player onto one, and the prompt. Owned by the call-in manager, which owns the seat. */
export class Emplacements implements ExtraTarget {
  readonly all: Emplacement[] = [];
  private readonly byHandle = new Map<number, { emplacement: Emplacement; part: 'shield' | 'body' }>();
  private registeredOn: VehicleSystem | null = null;
  private prompted: Emplacement | null = null;
  private unprompt: (() => void) | null = null;

  constructor(private readonly ctx: Ctx, private readonly materials: ModelMaterials, private readonly rig: SeatRig, private readonly onMan: () => void) {
    this.ensureRegistered();
    ctx.events?.on?.('world:liquidated', e => {
      if (e.kind === 'emplacement' || !e.position) return;
      for (const emp of this.all) {
        if (emp.destroyed || emp.spec.pos.y <= 0.35) continue;
        const horiz = Math.hypot(emp.spec.pos.x - e.position.x, emp.spec.pos.z - e.position.z);
        if (horiz <= 18) {
          emp.checkSupport(true);
        }
      }
    });
  }

  private ensureRegistered(): void {
    const vs = (this.ctx.enemies as { vehicles?: VehicleSystem | null } | undefined)?.vehicles ?? null;
    if (!vs || vs === this.registeredOn) return;
    this.registeredOn?.removeExtra(this);
    vs.addExtra(this);
    this.registeredOn = vs;
  }

  place(spec: EmplacementSpec): Emplacement {
    this.ensureRegistered();
    const e = new Emplacement(this.ctx, this.materials, spec);
    this.all.push(e);
    const [shieldH, bodyH] = e.colliderHandles();
    this.byHandle.set(shieldH, { emplacement: e, part: 'shield' });
    this.byHandle.set(bodyH, { emplacement: e, part: 'body' });
    return e;
  }

  // ---- ExtraTarget (gunfire, heavy ordnance, blast radii, Frame stomps/charges) -------------------------------

  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean {
    const entry = this.byHandle.get(collider.handle);
    if (!entry) return false;
    const { emplacement, part } = entry;
    if (emplacement.destroyed) return true;
    // Don't let an enemy gunner's own muzzle clip damage their own mount.
    if (source === HOSTILE_GUN.source && emplacement.hostile) return true;
    const heavy = source.startsWith('frame_') || source === 'sabot' || source === 'autocannon' || amount >= 45;
    const mult = part === 'shield' && !heavy ? 0.85 : 1.0;
    emplacement.damage(amount * mult, source, point);
    return true;
  }

  direct(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, _kind: ExplosionKind, source: string): boolean {
    const entry = this.byHandle.get(collider.handle);
    if (!entry) return false;
    const { emplacement } = entry;
    if (emplacement.destroyed) return true;
    const mult = source === 'frame_howitzer' ? 2.0 : 1.5;
    emplacement.damage(amount * mult, source, point);
    return true;
  }

  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    const def = EXPLOSIONS[spec.kind];
    let hit = 0;
    for (const e of this.all) {
      if (e.destroyed) continue;
      const d = Math.max(0, e.pivot.distanceTo(center) - 0.8);
      if (d > spec.radius) continue;
      const falloff = 1 - (d / spec.radius) * (1 - def.edgeDamage);
      const dealt = spec.instakill ? e.maxHp : spec.damage * falloff * 1.45;
      e.damage(dealt, spec.source, center);
      hit++;
    }
    return hit;
  }

  frameBlow(at: THREE.Vector3, radius: number, damage: number): number {
    let hit = 0;
    for (const e of this.all) {
      if (e.destroyed) continue;
      if (e.pivot.distanceTo(at) <= radius + 1.2) {
        e.damage(damage * 1.5, 'frame_stomp', at);
        hit++;
      }
    }
    return hit;
  }

  paintable(_out: MissileTarget[]): void {
    // Ground tripods do not steal Frame missile lock from vehicles and bosses.
  }

  highlightMeshes(_out: THREE.Object3D[]): void {
    // No separate boss highlight needed.
  }

  /** `free` says the player may get on a gun this frame: not aiming a call-in, not already in a seat. */
  update(dt: number, free: boolean): void {
    this.ensureRegistered();
    const { input, player } = this.ctx;
    // Read before the guns run, so the press that steps off one cannot also step onto it.
    const seated = this.rig.occupied;
    for (const e of this.all) e.update(dt);
    // E is shared: an ally the player is looking at, in reach, has it over a gun that is merely near (src/allies/orders.ts).
    const ally = Number.isFinite(this.ctx.allies?.focusDistance ?? Infinity);
    const near = free && !seated && !ally && player.alive && !player.parked ? this.nearest() : null;
    this.prompt(near);
    if (near && input.pressed('interact')) {
      this.prompt(null);
      this.onMan();
      near.man(this.rig);
    }
  }

  private nearest(): Emplacement | null {
    const p = this.ctx.player.position;
    let best: Emplacement | null = null;
    let bestD = REACH;
    for (const e of this.all) {
      if (e.destroyed || e.occupant || Math.abs(p.y - e.standAt.y) > 1.2) continue;
      const d = Math.min(Math.hypot(p.x - e.standAt.x, p.z - e.standAt.z), Math.hypot(p.x - e.pivot.x, p.z - e.pivot.z));
      if (d >= bestD) continue;
      best = e;
      bestD = d;
    }
    return best;
  }

  private prompt(e: Emplacement | null): void {
    if (e === this.prompted) return;
    this.unprompt?.();
    this.unprompt = null;
    this.prompted = e;
    if (!e) return;
    const key = this.ctx.input.labelFor?.('interact') ?? 'E';
    this.unprompt = this.ctx.hud.follow(e.top, `${key} MAN GUN`, '#ffc14a');
  }

  clear(): void {
    this.prompt(null);
    for (const e of this.all) e.clear();
  }
}
