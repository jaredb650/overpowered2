/**
 * Holdfast's physics-enabled destructible four-gun Flak Tower.
 *
 * Owns BOTH:
 *   1. The entire 16 m × 14 m × 24 m Tier-3 reinforced concrete bunker structure at `FLAK`
 *      (`x: 12..28, z: -112..-98, y: 0..24`), built from 26 modular destructible concrete blocks
 *      (4 foundation corner piers, 4 mid piers, 4 upper piers, 3 central bunker core tiers,
 *      3 painted south facade slabs, 4 side curtain slabs, and 4 cantilevered roof/parapet quadrants).
 *      Each block carries its own Rapier collider registered in `byHandle` and rejects non-howitzer /
 *      non-nuke fire with ricochet sparks and a throttled HUD hint. Destroying blocks rips out real
 *      falling dynamic Rapier physics chunks, tilts the tower, drops unsupported corner AA guns, and
 *      triggers a 2.4-second twisting, shearing pancake collapse into low walkable rubble (`y <= 1.2 m`).
 *   2. The four articulated twin-88 mm AA guns (`FLAK_GUNS`) mounted on the roof corners.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx, type ExplosionKind } from '../../core/contracts';
import type { ExplosionSpec, MissileTarget } from '../../core/gameplay';
import { clamp, damp, dampAngle, rand, TAU } from '../../core/math';
import { groups } from '../../physics/Physics';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import { EXPLOSIONS } from '../../weapons/data';
import { DYES, FLAK, FLAK_GUNS } from '../../world/map/holdfast/plan';
import type { ExtraTarget, VehicleSystem } from './index';

export const FLAK_GUN_HP = 500;
export const FLAK_BLOCK_HP = 450;
export const FLAK_COLLAPSE_SECONDS = 2.4;
export const FLAK_LIQUIDATION_VALUE = 6_400_000;
export const FLAK_HINT_TEXT = 'REINFORCED CONCRETE — USE 105MM HOWITZER';

const FIRE_EVERY: readonly [number, number] = [2.6, 3.8];
const FLAK_DAMAGE = 70;
const FLAK_RADIUS = 7.5;
const MARK_COLOR = '#ff3b3b';
const HINT_COOLDOWN = 4.5;
const MAX_CHUNKS = 48;
const RUBBLE_HEIGHT = 0.85;

const TOWER_CX = (FLAK.x0 + FLAK.x1) / 2; // 20
const TOWER_CZ = (FLAK.z0 + FLAK.z1) / 2; // -105

const _to = new THREE.Vector3();
const _at = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();

/** Only the 105mm Howitzer and Tactical Nuke penetrate Tier-3 reinforced Flak Tower concrete. */
export function isTier3Piercing(source: string): boolean {
  return source === 'frame_howitzer' || source === 'nuke' || source.startsWith('frame_howitzer');
}

function rgbHex(rgb: readonly [number, number, number], scale = 0.82): string {
  const c = new THREE.Color(rgb[0] * scale, rgb[1] * scale, rgb[2] * scale);
  return `#${c.getHexString()}`;
}

function chamferBox(w: number, h: number, d: number, bevel = 0.08): THREE.BufferGeometry {
  const b = Math.min(bevel, w * 0.25, h * 0.25, d * 0.25);
  const hw = w / 2 - b;
  const hh = h / 2 - b;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.02, d - b * 2),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
  });
  geo.center();
  return geo;
}

/** Shortest distance from `p` to an axis-aligned box centered at `c` with half-extents `h`. */
function distToAabb(p: THREE.Vector3, c: THREE.Vector3, h: THREE.Vector3): number {
  const dx = Math.max(0, Math.abs(p.x - c.x) - h.x);
  const dy = Math.max(0, Math.abs(p.y - c.y) - h.y);
  const dz = Math.max(0, Math.abs(p.z - c.z) - h.z);
  return Math.hypot(dx, dy, dz);
}

export type BlockTier = 'foundation' | 'mid' | 'upper' | 'core' | 'facade' | 'roof';

export interface TowerBlock {
  readonly kind: 'block';
  readonly id: string;
  readonly tier: BlockTier;
  /** Corner index 0..3 matching `FLAK_GUNS` (0=NW, 1=NE, 2=SW, 3=SE), or null for core/side slabs. */
  readonly corner: number | null;
  readonly worldCenter: THREE.Vector3;
  readonly localCenter: THREE.Vector3;
  readonly halfExtents: THREE.Vector3;
  readonly mesh: THREE.Group;
  collider: RAPIER.Collider | null;
  hp: number;
  readonly maxHp: number;
  alive: boolean;
  collapsedPopped: boolean;
}

export interface FlakGun {
  readonly kind: 'gun';
  readonly index: number;
  readonly position: THREE.Vector3;
  readonly center: THREE.Vector3;
  readonly root: THREE.Group;
  readonly turret: THREE.Group;
  readonly barrels: THREE.Group;
  readonly wreck: THREE.Group;
  collider: RAPIER.Collider | null;
  readonly meshes: THREE.Object3D[];
  readonly target: MissileTarget;
  hp: number;
  alive: boolean;
  yaw: number;
  pitch: number;
  recoil: number;
  fireIn: number;
  smokeIn: number;
  unmark: (() => void) | null;
}

interface FallingChunk {
  mesh: THREE.Group;
  body: RAPIER.RigidBody | null;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  halfY: number;
  age: number;
  still: number;
  frozen: boolean;
}

interface BlockSpec {
  id: string;
  tier: BlockTier;
  corner: number | null;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  /** Optional Holdfast dye stripes on south/side facades: `[worldY, dyeIndex, face]`. */
  stripes?: readonly (readonly [number, number, 's' | 'w' | 'e'])[];
  /** Glowing orange bunker observation slit on the upper south facade. */
  slit?: boolean;
  /** Parapet walls on roof quadrants. */
  parapet?: readonly ('n' | 's' | 'w' | 'e')[];
}

function towerBlockSpecs(): BlockSpec[] {
  const f = FLAK;
  const specs: BlockSpec[] = [];

  // Corner coordinates aligned with FLAK_GUNS: 0=NW, 1=NE, 2=SW, 3=SE.
  const corners: readonly { idx: number; x0: number; x1: number; z0: number; z1: number; face: 'w' | 'e'; south: boolean }[] = [
    { idx: 0, x0: f.x0, x1: f.x0 + 5, z0: f.z0, z1: f.z0 + 4.5, face: 'w', south: false },
    { idx: 1, x0: f.x1 - 5, x1: f.x1, z0: f.z0, z1: f.z0 + 4.5, face: 'e', south: false },
    { idx: 2, x0: f.x0, x1: f.x0 + 5, z0: f.z1 - 4.5, z1: f.z1, face: 'w', south: true },
    { idx: 3, x0: f.x1 - 5, x1: f.x1, z0: f.z1 - 4.5, z1: f.z1, face: 'e', south: true },
  ];

  // 12 corner piers across 3 tiers (foundation y:0..8, mid y:8..16, upper y:16..22).
  const pierTiers: readonly { tier: 'foundation' | 'mid' | 'upper'; y0: number; y1: number }[] = [
    { tier: 'foundation', y0: 0, y1: 8 },
    { tier: 'mid', y0: 8, y1: 16 },
    { tier: 'upper', y0: 16, y1: 22 },
  ];
  for (const pt of pierTiers) {
    for (const c of corners) {
      const stripes: [number, number, 's' | 'w' | 'e'][] = [];
      if (pt.tier === 'foundation') {
        if (c.south) stripes.push([4, 0, 's']);
        stripes.push([4, 0, c.face]);
      } else if (pt.tier === 'mid') {
        if (c.south) {
          stripes.push([9, 2, 's']);
          stripes.push([14, 5, 's']);
        }
        stripes.push([9, 2, c.face]);
        stripes.push([14, 5, c.face]);
      }
      specs.push({
        id: `pier_${pt.tier}_${c.idx}`,
        tier: pt.tier,
        corner: c.idx,
        x0: c.x0,
        x1: c.x1,
        y0: pt.y0,
        y1: pt.y1,
        z0: c.z0,
        z1: c.z1,
        stripes: stripes.length ? stripes : undefined,
      });
    }
  }

  // 3 central bunker core tiers (x: 17..23, z: -112..-101).
  specs.push(
    { id: 'core_lower', tier: 'core', corner: null, x0: f.x0 + 5, x1: f.x1 - 5, y0: 0, y1: 8, z0: f.z0, z1: f.z1 - 3 },
    { id: 'core_mid', tier: 'core', corner: null, x0: f.x0 + 5, x1: f.x1 - 5, y0: 8, y1: 16, z0: f.z0, z1: f.z1 - 3 },
    { id: 'core_upper', tier: 'core', corner: null, x0: f.x0 + 5, x1: f.x1 - 5, y0: 16, y1: 22, z0: f.z0, z1: f.z1 - 3 },
  );

  // 3 south painted-stripe facade slabs facing Holdfast (x: 17..23, z: -101..-98).
  specs.push(
    { id: 'facade_south_lower', tier: 'facade', corner: null, x0: f.x0 + 5, x1: f.x1 - 5, y0: 0, y1: 8, z0: f.z1 - 3, z1: f.z1, stripes: [[4, 0, 's']] },
    { id: 'facade_south_mid', tier: 'facade', corner: null, x0: f.x0 + 5, x1: f.x1 - 5, y0: 8, y1: 16, z0: f.z1 - 3, z1: f.z1, stripes: [[9, 2, 's'], [14, 5, 's']] },
    { id: 'facade_south_upper', tier: 'facade', corner: null, x0: f.x0 + 5, x1: f.x1 - 5, y0: 16, y1: 22, z0: f.z1 - 3, z1: f.z1, slit: true },
  );

  // 4 side curtain facade slabs (west & east between north/south piers).
  specs.push(
    { id: 'facade_west_lower', tier: 'facade', corner: null, x0: f.x0, x1: f.x0 + 5, y0: 0, y1: 11, z0: f.z0 + 4.5, z1: f.z1 - 4.5, stripes: [[4, 0, 'w'], [9, 2, 'w']] },
    { id: 'facade_west_upper', tier: 'facade', corner: null, x0: f.x0, x1: f.x0 + 5, y0: 11, y1: 22, z0: f.z0 + 4.5, z1: f.z1 - 4.5, stripes: [[14, 5, 'w']] },
    { id: 'facade_east_lower', tier: 'facade', corner: null, x0: f.x1 - 5, x1: f.x1, y0: 0, y1: 11, z0: f.z0 + 4.5, z1: f.z1 - 4.5, stripes: [[4, 0, 'e'], [9, 2, 'e']] },
    { id: 'facade_east_upper', tier: 'facade', corner: null, x0: f.x1 - 5, x1: f.x1, y0: 11, y1: 22, z0: f.z0 + 4.5, z1: f.z1 - 4.5, stripes: [[14, 5, 'e']] },
  );

  // 4 cantilevered roof deck + parapet quadrants (y: 22..24, overhanging by 0.8 m).
  const ov = 0.8;
  specs.push(
    { id: 'roof_0', tier: 'roof', corner: 0, x0: f.x0 - ov, x1: TOWER_CX, y0: 22, y1: f.top, z0: f.z0 - ov, z1: TOWER_CZ, parapet: ['n', 'w'] },
    { id: 'roof_1', tier: 'roof', corner: 1, x0: TOWER_CX, x1: f.x1 + ov, y0: 22, y1: f.top, z0: f.z0 - ov, z1: TOWER_CZ, parapet: ['n', 'e'] },
    { id: 'roof_2', tier: 'roof', corner: 2, x0: f.x0 - ov, x1: TOWER_CX, y0: 22, y1: f.top, z0: TOWER_CZ, z1: f.z1 + ov, parapet: ['s', 'w'] },
    { id: 'roof_3', tier: 'roof', corner: 3, x0: TOWER_CX, x1: f.x1 + ov, y0: 22, y1: f.top, z0: TOWER_CZ, z1: f.z1 + ov, parapet: ['s', 'e'] },
  );

  return specs;
}

export class FlakTower implements ExtraTarget {
  readonly guns: FlakGun[] = [];
  readonly blocks: TowerBlock[] = [];
  private readonly byHandle = new Map<number, FlakGun | TowerBlock>();
  private readonly materials: ModelMaterials;
  private readonly concreteMat: THREE.MeshStandardMaterial;
  private readonly towerRoot = new THREE.Group();
  private readonly rubbleGroup = new THREE.Group();
  private rubbleCollider: RAPIER.Collider | null = null;
  private readonly chunks: FallingChunk[] = [];

  private active = false;
  private idleClock = 0;
  private hintCooldown = 0;
  private leanTargetX = 0;
  private leanTargetZ = 0;
  private leanX = 0;
  private leanZ = 0;

  private _collapsing = false;
  private _flattened = false;
  private collapseTimer = 0;
  private collapsePopTimer = 0;
  private collapseBoomTimer = 0;
  private readonly toppleDir = new THREE.Vector3(-0.65, 0, 0.76).normalize();
  private clearedSignalled = false;
  private flattenedSignalled = false;

  constructor(private readonly ctx: Ctx, private readonly vehicles: VehicleSystem | null) {
    this.materials = new ModelMaterials(ctx);
    this.concreteMat = ctx.render.materials.patch(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.88,
        metalness: 0.12,
      }),
    );
    this.towerRoot.position.set(TOWER_CX, 0, TOWER_CZ);
    ctx.render.scene.add(this.towerRoot);

    this.rubbleGroup.position.set(TOWER_CX, 0, TOWER_CZ);
    this.rubbleGroup.visible = false;
    ctx.render.scene.add(this.rubbleGroup);

    this.build();
    this.vehicles?.addExtra(this);
  }

  get aliveCount(): number {
    let n = 0;
    for (const g of this.guns) if (g.alive) n++;
    return n;
  }

  get aliveBlockCount(): number {
    let n = 0;
    for (const b of this.blocks) if (b.alive) n++;
    return n;
  }

  get destroyedFoundationCount(): number {
    let n = 0;
    for (const b of this.blocks) if (b.tier === 'foundation' && !b.alive) n++;
    return n;
  }

  /** Structural integrity of the reinforced concrete tower (0..1). */
  get towerIntegrity(): number {
    if (this._flattened || this._collapsing) return 0;
    let total = 0;
    let left = 0;
    for (const b of this.blocks) {
      total += b.maxHp;
      if (b.alive) left += b.hp;
    }
    return total > 0 ? clamp(left / total, 0, 1) : 0;
  }

  /** True once the tower has finished collapsing into walkable rubble. */
  get flattened(): boolean {
    return this._flattened;
  }

  /** True during the 2.4-second twisting, shearing pancake collapse sequence. */
  get collapsing(): boolean {
    return this._collapsing;
  }

  /** Combined HUD objective bar fraction (0..1) reflecting both AA guns and concrete structure. */
  barFraction(): number {
    if (this._flattened) return 0;
    if (this._collapsing) return clamp((1 - this.collapseTimer / FLAK_COLLAPSE_SECONDS) * 0.2, 0, 1);
    const gunShare = this.guns.length > 0 ? this.aliveCount / this.guns.length : 0;
    return clamp(gunShare * 0.4 + this.towerIntegrity * 0.6, 0, 1);
  }

  /** HUD boss/objective bar title for the Flak Tower engagement. */
  barLabel(): string {
    if (this._flattened) return 'FLAK TOWER — RAZED';
    if (this._collapsing) return 'FLAK TOWER — COLLAPSING';
    if (this.aliveCount > 0) return 'FLAK TOWER — DESTROY GUNS & FLATTEN CORE';
    return 'FLAK TOWER — FLATTEN CONCRETE CORE';
  }

  /** Activates targeting markers and live fire against the player/Frame (during the `flak` section). */
  setActive(on: boolean): void {
    this.active = on;
    for (const g of this.guns) {
      if (on && g.alive && !g.unmark) {
        g.unmark = this.ctx.hud.follow(_at.copy(g.center).setY(g.center.y + 2.6).clone(), `FLAK ${g.index + 1}`, MARK_COLOR);
      } else if (!on && g.unmark) {
        g.unmark();
        g.unmark = null;
      }
    }
  }

  /** Restores all four turrets and all 26 concrete structural blocks intact. */
  reset(): void {
    this.active = false;
    this.hintCooldown = 0;
    this.leanTargetX = 0;
    this.leanTargetZ = 0;
    this.leanX = 0;
    this.leanZ = 0;
    this._collapsing = false;
    this._flattened = false;
    this.collapseTimer = 0;
    this.collapsePopTimer = 0;
    this.collapseBoomTimer = 0;
    this.clearedSignalled = false;
    this.flattenedSignalled = false;

    this.clearChunks();
    this.removeRubbleCollider();
    this.rubbleGroup.visible = false;

    this.towerRoot.visible = true;
    this.towerRoot.position.set(TOWER_CX, 0, TOWER_CZ);
    this.towerRoot.rotation.set(0, 0, 0);

    for (const b of this.blocks) {
      b.hp = b.maxHp;
      b.alive = true;
      b.collapsedPopped = false;
      b.mesh.visible = true;
      b.mesh.scale.set(1, 1, 1);
      if (!b.collider) {
        b.collider = this.ctx.physics.addStaticBox(b.worldCenter, b.halfExtents, null, 'concrete');
        this.byHandle.set(b.collider.handle, b);
      }
    }

    for (const g of this.guns) {
      g.hp = FLAK_GUN_HP;
      g.alive = true;
      g.recoil = 0;
      g.fireIn = rand(FIRE_EVERY[0], FIRE_EVERY[1]) + g.index * 0.55;
      g.center.set(g.position.x, g.position.y + 1.65, g.position.z);
      g.turret.visible = true;
      g.wreck.visible = false;
      g.root.visible = true;
      g.unmark?.();
      g.unmark = null;
      if (!g.collider) {
        g.collider = this.ctx.physics.addStaticBox(g.center, new THREE.Vector3(1.65, 1.65, 1.65), null, 'metal');
        this.byHandle.set(g.collider.handle, g);
      }
    }
  }

  /** Instantly flattens the tower when caught in a Tactical Nuke detonation. */
  nukeFlatten(): void {
    if (this._flattened) return;
    const { audio, fx, render } = this.ctx;
    const center = new THREE.Vector3(TOWER_CX, 12, TOWER_CZ);

    // Strip all surviving colliders and blast outward debris chunks.
    this.removeAllStaticColliders();
    let spawned = 0;
    for (const b of this.blocks) {
      if (b.alive) {
        b.hp = 0;
        b.alive = false;
        b.collapsedPopped = true;
        b.mesh.visible = false;
        if (spawned < 14) {
          this.spawnChunk(b.worldCenter, b.halfExtents, center, false, 1.8);
          spawned++;
        }
      }
    }
    for (const g of this.guns) {
      if (g.alive) {
        g.hp = 0;
        this.destroyGun(g, true);
      }
    }

    fx.explosion(center, { radius: 22, kind: 'nuke', scale: 2.6 });
    fx.ring(center, _up, 0xffaa44, 28);
    render.lights.flash(center, 0xffd080, 40, 80, 0.7);
    audio.play('explosion_debris', { position: center, volume: 1 });

    this.finishCollapse();
  }

  /** Fires a dramatic visual flak burst from all living guns toward `point` (used during the courier shootdown). */
  salvoAt(point: THREE.Vector3): void {
    const { fx, audio } = this.ctx;
    let fired = false;
    for (const g of this.guns) {
      if (!g.alive) continue;
      fired = true;
      _to.subVectors(point, g.center);
      g.yaw = Math.atan2(_to.x, _to.z);
      g.pitch = clamp(Math.atan2(_to.y, Math.hypot(_to.x, _to.z)), 0.1, 1.15);
      g.turret.rotation.y = g.yaw;
      g.barrels.rotation.x = -g.pitch;
      g.recoil = 0.45;
      _at.copy(g.center).addScaledVector(_to.normalize(), 3.6);
      fx.muzzleFlash(_at, _to, 'rocket');
      fx.tracer(_at, point, 'heavy');
    }
    if (fired && this.guns[0]) {
      audio.play('tank_cannon', { position: this.guns[0].center, pitch: 1.25, volume: 0.7 });
    }
  }

  update(dt: number): void {
    this.idleClock += dt;
    if (this.hintCooldown > 0) this.hintCooldown = Math.max(0, this.hintCooldown - dt);

    this.updateChunks(dt);

    if (this._collapsing) {
      this.updateCollapse(dt);
      return;
    }

    if (this._flattened) {
      return;
    }

    // Smoothly tilt the tower visually as lower piers are blown away.
    const prevLeanX = this.leanX;
    const prevLeanZ = this.leanZ;
    this.leanX = damp(this.leanX, this.leanTargetX, 3.2, dt);
    this.leanZ = damp(this.leanZ, this.leanTargetZ, 3.2, dt);
    if (Math.abs(this.leanX - prevLeanX) > 1e-5 || Math.abs(this.leanZ - prevLeanZ) > 1e-5) {
      this.towerRoot.rotation.x = this.leanX;
      this.towerRoot.rotation.z = this.leanZ;
      this.syncGunCenters();
    }

    const { player, fx } = this.ctx;
    const quarry = player.eye;

    for (const g of this.guns) {
      if (!g.alive) {
        g.smokeIn -= dt;
        if (g.smokeIn <= 0) {
          g.smokeIn = 0.45;
          fx.smoke(_at.copy(g.center).setY(g.center.y + 0.9), 0x2e2c2a, 1.8, 2.8);
        }
        continue;
      }

      if (g.recoil > 0) {
        g.recoil = Math.max(0, g.recoil - dt * 2.2);
        g.barrels.position.z = -g.recoil;
      }

      if (this.active && player.alive) {
        _to.subVectors(quarry, g.center);
        const horiz = Math.hypot(_to.x, _to.z) || 1;
        const wantYaw = Math.atan2(_to.x, _to.z);
        const wantPitch = clamp(Math.atan2(_to.y, horiz), -0.42, 1.15);
        g.yaw = dampAngle(g.yaw, wantYaw, 3.2, dt);
        g.pitch = damp(g.pitch, wantPitch, 3.2, dt);
        g.turret.rotation.y = g.yaw;
        g.barrels.rotation.x = -g.pitch;

        g.fireIn -= dt;
        if (g.fireIn <= 0 && horiz < 145) {
          g.fireIn = rand(FIRE_EVERY[0], FIRE_EVERY[1]);
          this.fireGun(g, quarry);
        }
      } else {
        const sweep = Math.sin(this.idleClock * 0.45 + g.index * 1.4) * 0.8 + Math.PI;
        g.yaw = dampAngle(g.yaw, sweep, 1.5, dt);
        g.pitch = damp(g.pitch, 0.72 + Math.sin(this.idleClock * 0.3 + g.index) * 0.14, 1.5, dt);
        g.turret.rotation.y = g.yaw;
        g.barrels.rotation.x = -g.pitch;
      }
    }
  }

  private syncGunCenters(): void {
    this.towerRoot.updateMatrixWorld(true);
    for (const g of this.guns) {
      _pos.set(0, 1.65, 0);
      g.root.localToWorld(_pos);
      g.center.copy(_pos);
    }
  }

  private fireGun(g: FlakGun, target: THREE.Vector3): void {
    const { audio, fx, player, render } = this.ctx;
    g.recoil = 0.55;
    _dir.subVectors(target, g.center).normalize();
    const muzzle = _at.copy(g.center).addScaledVector(_dir, 3.8);
    fx.muzzleFlash(muzzle, _dir, 'rocket');
    audio.play('tank_cannon', { position: muzzle, pitch: 1.25 + rand(-0.06, 0.06), volume: 0.75 });

    const burst = new THREE.Vector3(
      target.x + rand(-4.5, 4.5),
      Math.max(1.2, target.y + rand(-1.5, 3.5)),
      target.z + rand(-4.5, 4.5),
    );
    fx.tracer(muzzle, burst, 'heavy');
    fx.explosion(burst, { radius: 4, kind: 'rocket', scale: 0.85 });
    fx.smoke(burst, 0x262422, 2.8, 2.4);
    render.lights.flash(burst, 0xff9838, 12, 24, 0.18);
    audio.play('rocket_explosion', { position: burst, pitch: 1.15, volume: 0.75 });

    const d = burst.distanceTo(player.eye);
    if (d <= FLAK_RADIUS && player.alive) {
      const falloff = 1 - (d / FLAK_RADIUS) * 0.55;
      player.takeDamage({ amount: Math.round(FLAK_DAMAGE * falloff), from: g.center, type: 'explosive', source: 'flak_gun' });
    }
  }

  // ---- ExtraTarget (damage & missile paint) ----------------------------------------------------------------------

  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean {
    const hit = this.byHandle.get(collider.handle);
    if (!hit) return false;
    if (hit.kind === 'gun') {
      if (!hit.alive) return true;
      const heavy = source.startsWith('frame_') || source === 'sabot' || source === 'autocannon' || source === 'ac130_25mm' || source === 'warthog' || amount >= 45;
      const dealt = heavy ? amount : amount * 0.35;
      this.damageGun(hit, dealt, point);
      return true;
    }
    // Concrete structural block: Tier-3 armor rule.
    if (!hit.alive || this._collapsing || this._flattened) return true;
    if (!isTier3Piercing(source)) {
      this.ricochetBlock(point);
      return true;
    }
    this.damageBlock(hit, amount, point);
    return true;
  }

  direct(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, _kind: ExplosionKind, source: string): boolean {
    const hit = this.byHandle.get(collider.handle);
    if (!hit) return false;
    if (hit.kind === 'gun') {
      if (!hit.alive) return true;
      this.damageGun(hit, amount * 1.15, point);
      return true;
    }
    if (!hit.alive || this._collapsing || this._flattened) return true;
    if (!isTier3Piercing(source)) {
      this.ricochetBlock(point);
      return true;
    }
    this.damageBlock(hit, amount * 1.25, point);
    return true;
  }

  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    if (spec.team !== 'player' || this._flattened) return 0;
    const def = EXPLOSIONS[spec.kind];
    let hit = 0;

    // 1. Roof AA guns take damage from any player blast.
    for (const g of this.guns) {
      if (!g.alive) continue;
      const d = Math.max(0, g.center.distanceTo(center) - 2.0);
      if (d > spec.radius) continue;
      const falloff = 1 - (d / Math.max(0.01, spec.radius)) * (1 - def.edgeDamage);
      this.damageGun(g, spec.instakill ? FLAK_GUN_HP : spec.damage * falloff, center);
      hit++;
    }

    // 2. Reinforced concrete tower blocks follow the Tier-3 armor rule.
    if (!this._collapsing && !this._flattened) {
      if (isTier3Piercing(spec.source)) {
        for (const b of this.blocks) {
          if (!b.alive) continue;
          const d = distToAabb(center, b.worldCenter, b.halfExtents);
          if (d > spec.radius) continue;
          const falloff = 1 - (d / Math.max(0.01, spec.radius)) * (1 - def.edgeDamage);
          const dmg = spec.instakill || spec.source === 'nuke' ? b.maxHp : spec.damage * falloff;
          this.damageBlock(b, dmg, center);
          hit++;
          if (this._collapsing || this._flattened) break;
        }
      } else {
        // Non-howitzer blast near concrete sparks off harmlessly and reminds the player.
        for (const b of this.blocks) {
          if (!b.alive) continue;
          if (distToAabb(center, b.worldCenter, b.halfExtents) <= spec.radius) {
            this.ricochetBlock(center);
            break;
          }
        }
      }
    }

    return hit;
  }

  paintable(out: MissileTarget[]): void {
    for (const g of this.guns) if (g.alive) out.push(g.target);
  }

  frameBlow(at: THREE.Vector3, radius: number, damage: number, _dir?: THREE.Vector3 | null, source = 'frame_stomp'): number {
    if (this._flattened) return 0;
    let hit = 0;
    for (const g of this.guns) {
      if (!g.alive) continue;
      if (g.center.distanceTo(at) <= radius + 2.2) {
        this.damageGun(g, damage, at);
        hit++;
      }
    }
    if (!this._collapsing && !this._flattened) {
      if (isTier3Piercing(source)) {
        for (const b of this.blocks) {
          if (!b.alive) continue;
          if (distToAabb(at, b.worldCenter, b.halfExtents) <= radius) {
            this.damageBlock(b, damage, at);
            hit++;
            if (this._collapsing || this._flattened) break;
          }
        }
      } else {
        for (const b of this.blocks) {
          if (!b.alive) continue;
          if (distToAabb(at, b.worldCenter, b.halfExtents) <= radius) {
            this.ricochetBlock(at);
            break;
          }
        }
      }
    }
    return hit;
  }

  highlightMeshes(out: THREE.Object3D[]): void {
    if (!this.active || this._flattened) return;
    for (const g of this.guns) if (g.alive) for (const m of g.meshes) out.push(m);
  }

  // ---- Block Damage, Chunk Ripping & Collapse --------------------------------------------------------------------

  private ricochetBlock(point: THREE.Vector3): void {
    const { audio, fx, hud } = this.ctx;
    _dir.set(point.x - TOWER_CX, 0.35, point.z - TOWER_CZ).normalize();
    fx.sparks(point, _dir, 10, 0xffd28a);
    fx.chips(point, 0x9b968e, 4);
    audio.play('ricochet', { position: point, pitch: 0.78 + rand(-0.08, 0.08), volume: 0.72 });
    audio.play('armour_stopped', { pitch: 0.85 });
    hud.hitMarker('armor');

    if (this.hintCooldown <= 0) {
      this.hintCooldown = HINT_COOLDOWN;
      hud.feed(FLAK_HINT_TEXT, '#ffb400');
      hud.callout?.(FLAK_HINT_TEXT);
    }
  }

  private damageBlock(b: TowerBlock, amount: number, point: THREE.Vector3): void {
    if (!b.alive || amount <= 0 || this._collapsing || this._flattened) return;
    const { audio, fx, hud } = this.ctx;
    b.hp = Math.max(0, b.hp - amount);
    fx.chips(point, 0x928d85, 14);
    fx.dust(point, _up, 2.2);
    fx.sparks(point, _up, 8, 0xffaa44);

    if (b.hp > 0) {
      // Visual battle-damage squeeze/crack feedback on struck concrete pier.
      const frac = b.hp / b.maxHp;
      b.mesh.scale.set(0.97 + frac * 0.03, 0.98 + frac * 0.02, 0.97 + frac * 0.03);
      hud.hitMarker('armorThrough');
      audio.play('concrete_crumble', { position: point, pitch: 0.85 + rand(-0.08, 0.08), volume: 0.7 });
      return;
    }

    this.destroyBlock(b, point);
  }

  private destroyBlock(b: TowerBlock, impactPoint: THREE.Vector3): void {
    const { audio, camera, fx, hud, player, progression, render } = this.ctx;
    b.alive = false;
    b.hp = 0;
    b.mesh.visible = false;
    this.removeBlockCollider(b);

    // Rip out a real falling dynamic Rapier concrete slab + rebar debris.
    this.spawnChunk(b.worldCenter, b.halfExtents, impactPoint, false, 1.0);
    // Secondary smaller broken concrete chunk for rich THE FINALS-style destruction.
    const subHalf = b.halfExtents.clone().multiplyScalar(0.45);
    const subPos = b.worldCenter.clone().add(new THREE.Vector3(rand(-1, 1), rand(0.5, 1.5), rand(-1, 1)));
    this.spawnChunk(subPos, subHalf, impactPoint, false, 1.35);

    _dir.subVectors(b.worldCenter, new THREE.Vector3(TOWER_CX, b.worldCenter.y, TOWER_CZ));
    if (_dir.lengthSq() < 0.01) _dir.set(0, 1, 0);
    else _dir.normalize();

    fx.dust(b.worldCenter, _dir, 3.6);
    fx.smoke(b.worldCenter, 0x8e887e, 4.2, 3.2);
    fx.chips(b.worldCenter, 0x8f8a82, 26);
    fx.sparks(b.worldCenter, _dir, 14, 0xffaa44);
    render.lights.flash(b.worldCenter, 0xff9d3b, 14, 28, 0.28);

    audio.play('explosion_debris', { position: b.worldCenter, volume: 0.95 });
    audio.play('concrete_crumble', { position: b.worldCenter, pitch: 0.72, volume: 0.9 });
    if (b.tier === 'foundation') {
      audio.play('metal_groan', { position: b.worldCenter, pitch: 0.62, volume: 0.9 });
    }

    const d = player.position.distanceTo(b.worldCenter);
    camera.addTrauma(Math.max(0.14, 0.52 - d / 140));
    hud.hitMarker('armorBroken');
    progression.award(150, 'FLAK PIER', b.worldCenter);

    // Recompute visual lean from missing lower/mid piers.
    this.updateTowerLean();

    // If an AA gun's supporting corner pier or roof deck is blown out underneath it, drop & detonate that gun!
    if (b.corner !== null && (b.tier === 'foundation' || b.tier === 'upper' || b.tier === 'roof')) {
      const gun = this.guns[b.corner];
      if (gun && gun.alive) {
        this.spawnChunk(gun.center, new THREE.Vector3(1.1, 0.85, 1.25), b.worldCenter, true, 1.2);
        this.destroyGun(gun);
      }
    }

    this.checkCollapseTrigger();
  }

  private updateTowerLean(): void {
    let lx = 0;
    let lz = 0;
    for (const b of this.blocks) {
      if (b.alive || b.corner === null) continue;
      const weight = b.tier === 'foundation' ? 0.024 : b.tier === 'mid' ? 0.012 : 0;
      if (weight === 0) continue;
      const sx = b.corner === 0 || b.corner === 2 ? -1 : 1; // west=-1, east=+1
      const sz = b.corner === 0 || b.corner === 1 ? -1 : 1; // north=-1, south=+1
      // Rotation around X tilts toward +Z when positive; rotation around Z tilts toward -X when positive.
      lx += sz * weight;
      lz -= sx * weight;
    }
    this.leanTargetX = clamp(lx, -0.075, 0.075);
    this.leanTargetZ = clamp(lz, -0.075, 0.075);
  }

  private checkCollapseTrigger(): void {
    if (this._collapsing || this._flattened) return;
    const destroyedBlocks = this.blocks.length - this.aliveBlockCount;
    const integrityLow = this.towerIntegrity <= 0.35;
    const foundationsGone = this.destroyedFoundationCount >= 3;
    const gunsDownHalfCore = this.aliveCount === 0 && destroyedBlocks >= Math.ceil(this.blocks.length * 0.5);
    if (integrityLow || foundationsGone || gunsDownHalfCore) {
      this.beginCollapse();
    }
  }

  private beginCollapse(): void {
    if (this._collapsing || this._flattened) return;
    const { audio, camera, fx, hud } = this.ctx;
    this._collapsing = true;
    this.collapseTimer = 0;
    this.collapsePopTimer = 0;
    this.collapseBoomTimer = 0;

    // Pick topple direction toward the weakest foundation side (or SW toward Holdfast yard if balanced).
    let tx = 0;
    let tz = 0;
    for (const b of this.blocks) {
      if (!b.alive && b.tier === 'foundation' && b.corner !== null) {
        tx += b.corner === 0 || b.corner === 2 ? -1 : 1;
        tz += b.corner === 0 || b.corner === 1 ? -1 : 1;
      }
    }
    if (Math.hypot(tx, tz) > 0.1) this.toppleDir.set(tx, 0, tz).normalize();
    else this.toppleDir.set(-0.65, 0, 0.76).normalize();

    // Immediately strip static colliders so nothing hangs in mid-air while the tower shears & collapses.
    this.removeAllStaticColliders();
    this.ensureRubbleCollider();

    const base = new THREE.Vector3(TOWER_CX, 6, TOWER_CZ);
    audio.play('metal_groan', { position: base, pitch: 0.52, volume: 1 });
    audio.play('concrete_crumble', { position: base, pitch: 0.65, volume: 1 });
    audio.play('explosion_debris', { position: base, volume: 1 });
    fx.dust(base, _up, 6);
    fx.smoke(base, 0x857f76, 8, 4.5);
    camera.addTrauma(0.9);
    hud.feed('FLAK TOWER STRUCTURAL FAILURE — COLLAPSING!', '#ff7a30');
  }

  private updateCollapse(dt: number): void {
    const { audio, camera, fx, render } = this.ctx;
    this.collapseTimer += dt;
    const p = clamp(this.collapseTimer / FLAK_COLLAPSE_SECONDS, 0, 1);

    // Twisting, shearing topple & pancake collapse over 2.4 seconds.
    const ease = p * p;
    const lean = ease * 0.62;
    this.towerRoot.rotation.set(
      this.leanX + this.toppleDir.z * lean,
      ease * 0.28,
      this.leanZ - this.toppleDir.x * lean,
    );
    this.towerRoot.position.set(
      TOWER_CX + this.toppleDir.x * ease * 3.8,
      -Math.pow(p, 2.2) * 23.0,
      TOWER_CZ + this.toppleDir.z * ease * 3.8,
    );
    this.towerRoot.updateMatrixWorld(true);

    // Detonate any surviving AA guns early in the topple.
    if (p >= 0.2) {
      for (const g of this.guns) {
        if (g.alive) {
          _pos.set(0, 1.65, 0);
          g.root.localToWorld(_pos);
          g.center.copy(_pos);
          this.spawnChunk(g.center, new THREE.Vector3(1.1, 0.85, 1.25), new THREE.Vector3(TOWER_CX, 10, TOWER_CZ), true, 1.4);
          this.destroyGun(g);
        }
      }
    }

    // Pop remaining structural blocks off into tumbling dynamic Rapier concrete slabs.
    this.collapsePopTimer -= dt;
    if (this.collapsePopTimer <= 0) {
      this.collapsePopTimer = 0.14;
      let popped = 0;
      for (let i = this.blocks.length - 1; i >= 0 && popped < 2; i--) {
        const b = this.blocks[i]!;
        if (!b.alive || b.collapsedPopped) continue;
        b.collapsedPopped = true;
        b.alive = false;
        b.hp = 0;
        b.mesh.visible = false;
        _pos.copy(b.localCenter);
        this.towerRoot.localToWorld(_pos);
        _pos.y = Math.max(1.5, _pos.y);
        this.spawnChunk(_pos, b.halfExtents.clone().multiplyScalar(0.85), new THREE.Vector3(TOWER_CX, Math.max(0, _pos.y - 3), TOWER_CZ), false, 1.25);
        fx.smoke(_pos, 0x8a847a, 5.5, 4.0);
        fx.dust(_pos, _up, 4.5);
        popped++;
      }
    }

    // Cascading secondary magazine detonations & concrete groans.
    this.collapseBoomTimer -= dt;
    if (this.collapseBoomTimer <= 0) {
      this.collapseBoomTimer = 0.42;
      const boom = new THREE.Vector3(
        TOWER_CX + rand(-7, 7),
        Math.max(1.5, (1 - p) * 20 + rand(-2, 2)),
        TOWER_CZ + rand(-6, 6),
      );
      fx.explosion(boom, { radius: 8, kind: 'rocket', scale: 1.8 });
      fx.embers(boom, 18, 4);
      render.lights.flash(boom, 0xffa040, 24, 48, 0.38);
      audio.play('explosion_debris', { position: boom, volume: 0.9 });
      audio.play('concrete_crumble', { position: boom, pitch: 0.65 + rand(-0.1, 0.1), volume: 0.85 });
      camera.addTrauma(0.42);
    }

    if (p >= 1) {
      this.finishCollapse();
    }
  }

  private finishCollapse(): void {
    const { audio, camera, campaign, events, fx, hud, progression, render } = this.ctx;
    this._collapsing = false;
    this._flattened = true;

    // Ensure all guns are destroyed (and `flak:cleared` signalled if not yet).
    for (const g of this.guns) {
      if (g.alive) this.destroyGun(g, true);
    }
    for (const b of this.blocks) {
      b.alive = false;
      b.hp = 0;
      b.collapsedPopped = true;
      b.mesh.visible = false;
    }
    this.removeAllStaticColliders();
    this.towerRoot.visible = false;

    // Leave low walkable concrete rubble mound (y <= 1.2 m).
    this.rubbleGroup.visible = true;
    this.ensureRubbleCollider();

    const ground = new THREE.Vector3(TOWER_CX, 1.4, TOWER_CZ);
    fx.slam?.(ground, 1.0);
    fx.explosion(ground, { radius: 16, kind: 'rocket', scale: 2.8 });
    fx.ring(ground, _up, 0xffaa44, 26);
    fx.dust(ground, _up, 8);
    fx.smoke(ground, 0x7e786f, 12, 6.0);
    fx.embers(ground, 36, 8);
    render.lights.flash(ground, 0xffb050, 36, 72, 0.7);
    render.decals?.add('scorch', ground, _up, 18, rand(0, TAU));
    audio.play('explosion_tank', { position: ground, volume: 1 });
    audio.play('explosion_debris', { position: ground, volume: 1 });
    camera.addTrauma(0.95);

    if (!this.clearedSignalled) {
      this.clearedSignalled = true;
      campaign.signal('flak:cleared');
    }
    if (!this.flattenedSignalled) {
      this.flattenedSignalled = true;
      (events as unknown as { emit?: (type: string, payload: unknown) => void })?.emit?.('world:liquidated', {
        label: 'FLAK TOWER RAZED',
        value: FLAK_LIQUIDATION_VALUE,
        kind: 'flakTower',
        position: ground.clone(),
      });
      progression.award(2500, 'FLAK TOWER RAZED', ground);
      hud.feed('FLAK TOWER RAZED — $6,400,000 LIQUIDATED', '#7ee787');
      campaign.signal('flak:flattened');
    }
  }

  // ---- Dynamic Physics Chunks ------------------------------------------------------------------------------------

  private spawnChunk(
    worldPos: THREE.Vector3,
    halfExtents: THREE.Vector3,
    blastFrom: THREE.Vector3,
    isTurret: boolean,
    speedScale = 1,
  ): void {
    if (this.chunks.length >= MAX_CHUNKS) {
      this.retireChunk(this.chunks.shift()!);
    }

    const hx = clamp(halfExtents.x, 0.45, 2.8);
    const hy = clamp(halfExtents.y, 0.4, 2.8);
    const hz = clamp(halfExtents.z, 0.45, 2.8);

    const b = new ModelBuilder();
    if (isTurret) {
      b.solid(chamferBox(hx * 2, hy * 2, hz * 2, 0.1), '#282b27')
        .cyl(0.12, 0.15, 2.2, 6, '#1c1f24', { at: [-0.32, 0.1, 1.3], rot: [Math.PI / 2, 0, 0] })
        .cyl(0.12, 0.15, 2.2, 6, '#1c1f24', { at: [0.32, 0.1, 1.3], rot: [Math.PI / 2, 0, 0] });
    } else {
      b.solid(chamferBox(hx * 2, hy * 2, hz * 2, 0.14), '#8a857c')
        .box(hx * 1.4, 0.12, 0.12, '#3a3c3f', { at: [hx * 0.7, hy * 0.3, 0], rot: [0, 0, 0.25] })
        .box(0.12, hy * 1.3, 0.12, '#3a3c3f', { at: [-hx * 0.4, hy * 0.6, hz * 0.3], rot: [0.22, 0, -0.18] });
    }

    const mesh = this.materials.group(b, isTurret ? this.materials.solid : this.concreteMat);
    mesh.position.copy(worldPos);
    _euler.set(rand(-0.2, 0.2), rand(0, TAU), rand(-0.2, 0.2));
    _quat.setFromEuler(_euler);
    mesh.quaternion.copy(_quat);
    this.ctx.render.scene.add(mesh);

    const out = new THREE.Vector3().subVectors(worldPos, blastFrom);
    out.y = 0;
    if (out.lengthSq() < 0.05) out.set(rand(-1, 1), 0, rand(-1, 1));
    out.normalize();

    const speed = rand(6, 13) * speedScale;
    const vel = new THREE.Vector3(
      out.x * speed + rand(-2.5, 2.5),
      rand(3.5, 9.5) * speedScale,
      out.z * speed + rand(-2.5, 2.5),
    );
    const angVel = new THREE.Vector3(rand(-3.5, 3.5), rand(-3.5, 3.5), rand(-3.5, 3.5));

    let body: RAPIER.RigidBody | null = null;
    const { R, world } = this.ctx.physics;
    if (R?.RigidBodyDesc && R?.ColliderDesc && typeof world?.createRigidBody === 'function') {
      body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(worldPos.x, worldPos.y, worldPos.z)
          .setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w })
          .setLinvel(vel.x, vel.y, vel.z)
          .setAngvel({ x: angVel.x, y: angVel.y, z: angVel.z })
          .setLinearDamping(0.08)
          .setAngularDamping(0.45),
      );
      world.createCollider(
        R.ColliderDesc.cuboid(hx, hy, hz)
          .setDensity(2200)
          .setFriction(0.85)
          .setRestitution(0.16)
          .setCollisionGroups(groups(CG.Debris, CG.World | CG.Debris)),
        body,
      );
    }

    this.chunks.push({ mesh, body, vel, angVel, halfY: hy, age: 0, still: 0, frozen: false });
  }

  private updateChunks(dt: number): void {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i]!;
      c.age += dt;
      if (!c.frozen) {
        if (c.body) {
          const t = c.body.translation();
          const r = c.body.rotation();
          const v = c.body.linvel();
          c.mesh.position.set(t.x, t.y, t.z);
          c.mesh.quaternion.set(r.x, r.y, r.z, r.w);
          const speedSq = v.x * v.x + v.y * v.y + v.z * v.z;
          c.still = speedSq < 0.16 ? c.still + dt : 0;
          if (c.still >= 1.5 || c.age >= 8 || t.y < -25) {
            this.ctx.physics.world.removeRigidBody(c.body);
            c.body = null;
            c.frozen = true;
          }
        } else {
          // Ballistic fallback when running under lightweight mocked physics.
          c.vel.y -= 19 * dt;
          c.mesh.position.addScaledVector(c.vel, dt);
          c.mesh.rotation.x += c.angVel.x * dt;
          c.mesh.rotation.y += c.angVel.y * dt;
          c.mesh.rotation.z += c.angVel.z * dt;
          if (c.mesh.position.y <= c.halfY) {
            c.mesh.position.y = c.halfY;
            c.vel.y *= -0.18;
            c.vel.x *= 0.6;
            c.vel.z *= 0.6;
            c.angVel.multiplyScalar(0.5);
            if (c.vel.lengthSq() < 0.2) c.frozen = true;
          }
        }
      }
      if (c.age >= 18) {
        this.retireChunk(c);
        this.chunks.splice(i, 1);
      }
    }
  }

  private retireChunk(c: FallingChunk): void {
    if (c.body) {
      this.ctx.physics.world.removeRigidBody(c.body);
      c.body = null;
    }
    c.mesh.removeFromParent();
  }

  private clearChunks(): void {
    for (const c of this.chunks) this.retireChunk(c);
    this.chunks.length = 0;
  }

  // ---- Gun Damage & Destruction ----------------------------------------------------------------------------------

  private damageGun(g: FlakGun, amount: number, point: THREE.Vector3): void {
    if (!g.alive || amount <= 0) return;
    const { audio, hud, fx } = this.ctx;
    g.hp = Math.max(0, g.hp - amount);
    fx.chips(point, 0xffaa44, 6);
    if (g.hp > 0) {
      hud.hitMarker('body');
      audio.play('hit_marker', { pitch: 0.9 });
      return;
    }
    this.destroyGun(g);
  }

  private destroyGun(g: FlakGun, silent = false): void {
    if (!g.alive) return;
    const { audio, campaign, fx, hud, progression, render } = this.ctx;
    g.alive = false;
    g.hp = 0;
    g.turret.visible = false;
    g.wreck.visible = true;
    g.unmark?.();
    g.unmark = null;
    this.removeGunCollider(g);

    if (!silent) {
      fx.explosion(g.center, { radius: 6, kind: 'rocket', scale: 1.6 });
      fx.chips(g.center, 0xff9030, 32);
      fx.embers(g.center, 24, 3);
      render.lights.flash(g.center, 0xffa040, 22, 42, 0.45);
      audio.play('veh_destroyed', { position: g.center, volume: 1 });
      hud.hitMarker('kill');
      audio.play('hit_marker_kill');
      progression.award(450, 'FLAK GUN', g.center);
      const done = this.guns.length - this.aliveCount;
      hud.feed(`FLAK GUN DESTROYED (${done}/${this.guns.length})`, '#ff7a30');
    }
    campaign.signal('flak:gun');

    if (this.aliveCount === 0 && !this.clearedSignalled) {
      this.clearedSignalled = true;
      if (!silent) {
        const roof = new THREE.Vector3(TOWER_CX, FLAK.top + 1.5, TOWER_CZ);
        fx.explosion(roof, { radius: 10, kind: 'rocket', scale: 2.4 });
        fx.ring(roof, _up, 0xffa040, 12);
        render.lights.flash(roof, 0xffb050, 28, 60, 0.65);
        audio.play('explosion_debris', { position: roof, volume: 1 });
        hud.feed('FLAK TOWER SILENCED — AIRSPACE OPEN', '#7ee787');
      }
      campaign.signal('flak:cleared');
    }

    if (!silent) {
      this.checkCollapseTrigger();
    }
  }

  // ---- Collider Helpers ------------------------------------------------------------------------------------------

  private removeBlockCollider(b: TowerBlock): void {
    if (!b.collider) return;
    this.byHandle.delete(b.collider.handle);
    this.ctx.physics.world.removeCollider(b.collider, true);
    b.collider = null;
  }

  private removeGunCollider(g: FlakGun): void {
    if (!g.collider) return;
    this.byHandle.delete(g.collider.handle);
    this.ctx.physics.world.removeCollider(g.collider, true);
    g.collider = null;
  }

  private removeAllStaticColliders(): void {
    for (const b of this.blocks) this.removeBlockCollider(b);
    for (const g of this.guns) this.removeGunCollider(g);
  }

  private ensureRubbleCollider(): void {
    if (this.rubbleCollider) return;
    const halfX = (FLAK.x1 - FLAK.x0) / 2;
    const halfZ = (FLAK.z1 - FLAK.z0) / 2;
    this.rubbleCollider = this.ctx.physics.addStaticBox(
      new THREE.Vector3(TOWER_CX, RUBBLE_HEIGHT / 2, TOWER_CZ),
      new THREE.Vector3(halfX, RUBBLE_HEIGHT / 2, halfZ),
      null,
      'concrete',
    );
  }

  private removeRubbleCollider(): void {
    if (!this.rubbleCollider) return;
    this.ctx.physics.world.removeCollider(this.rubbleCollider, true);
    this.rubbleCollider = null;
  }

  // ---- Geometry Construction -------------------------------------------------------------------------------------

  private build(): void {
    this.buildConcreteStructure();
    this.buildRubbleMound();
    this.buildGuns();
  }

  private buildConcreteStructure(): void {
    const { physics } = this.ctx;
    const specs = towerBlockSpecs();

    for (const spec of specs) {
      const w = spec.x1 - spec.x0;
      const h = spec.y1 - spec.y0;
      const d = spec.z1 - spec.z0;
      const wx = (spec.x0 + spec.x1) / 2;
      const wy = (spec.y0 + spec.y1) / 2;
      const wz = (spec.z0 + spec.z1) / 2;

      const worldCenter = new THREE.Vector3(wx, wy, wz);
      const localCenter = new THREE.Vector3(wx - TOWER_CX, wy, wz - TOWER_CZ);
      const halfExtents = new THREE.Vector3(w / 2, h / 2, d / 2);

      const shade = spec.tier === 'foundation'
        ? '#928e85'
        : spec.tier === 'roof'
          ? '#87837b'
          : spec.tier === 'core'
            ? '#7d7971'
            : '#9e9a90';

      const mb = new ModelBuilder();
      mb.solid(chamferBox(w - 0.04, h - 0.04, d - 0.04, 0.09), shade);

      // Subtle dark concrete horizontal formwork reveal band.
      mb.box(w + 0.01, 0.14, d + 0.01, '#68655e', { at: [0, -h / 2 + 0.22, 0] });

      // Painted Holdfast dye stripes on south & side exterior faces.
      if (spec.stripes) {
        for (const [sy, dyeIdx, face] of spec.stripes) {
          const ly = sy - wy;
          const color = rgbHex(DYES[dyeIdx]!);
          if (face === 's') {
            mb.box(w - 0.04, 1.65, 0.06, color, { at: [0, ly, d / 2 + 0.01] });
          } else if (face === 'w') {
            mb.box(0.06, 1.65, d - 0.04, color, { at: [-w / 2 - 0.01, ly, 0] });
          } else if (face === 'e') {
            mb.box(0.06, 1.65, d - 0.04, color, { at: [w / 2 + 0.01, ly, 0] });
          }
        }
      }

      // Glowing orange bunker observation slit on the upper south facade.
      if (spec.slit) {
        mb.box(5.6, 0.85, 0.12, '#3d3b37', { at: [0, 19 - wy, d / 2 + 0.01] });
        mb.glow(new THREE.BoxGeometry(5.1, 0.42, 0.08), '#ff8c28', 2.8, { at: [0, 19 - wy, d / 2 + 0.05] });
      }

      // Roof deck concrete parapet walls.
      if (spec.parapet) {
        const pt = 0.5;
        const ph = 1.0;
        const py = h / 2 + ph / 2;
        for (const edge of spec.parapet) {
          if (edge === 'n') mb.box(w, ph, pt, '#6a665f', { at: [0, py, -d / 2 + pt / 2] });
          else if (edge === 's') mb.box(w, ph, pt, '#6a665f', { at: [0, py, d / 2 - pt / 2] });
          else if (edge === 'w') mb.box(pt, ph, d, '#6a665f', { at: [-w / 2 + pt / 2, py, 0] });
          else if (edge === 'e') mb.box(pt, ph, d, '#6a665f', { at: [w / 2 - pt / 2, py, 0] });
        }
      }

      const mesh = this.materials.group(mb, this.concreteMat);
      mesh.position.copy(localCenter);
      this.towerRoot.add(mesh);

      const collider = physics.addStaticBox(worldCenter, halfExtents, null, 'concrete');

      const block: TowerBlock = {
        kind: 'block',
        id: spec.id,
        tier: spec.tier,
        corner: spec.corner,
        worldCenter,
        localCenter,
        halfExtents,
        mesh,
        collider,
        hp: FLAK_BLOCK_HP,
        maxHp: FLAK_BLOCK_HP,
        alive: true,
        collapsedPopped: false,
      };
      this.blocks.push(block);
      this.byHandle.set(collider.handle, block);
    }
  }

  private buildRubbleMound(): void {
    const mb = new ModelBuilder();
    const halfX = (FLAK.x1 - FLAK.x0) / 2;
    const halfZ = (FLAK.z1 - FLAK.z0) / 2;

    // Low walkable concrete rubble apron (y <= 1.2 m everywhere).
    mb.solid(chamferBox(halfX * 1.95, 0.65, halfZ * 1.95, 0.22), '#6f6b63', { at: [0, 0.32, 0] });
    mb.solid(chamferBox(halfX * 1.35, 0.55, halfZ * 1.35, 0.18), '#7c776e', { at: [-0.6, 0.72, 0.4], rot: [0.03, 0.08, -0.04] });

    // Broken concrete slabs & jutting twisted rebar across the flattened footprint.
    const slabOffsets: readonly [number, number, number, number, number, number][] = [
      [-5.2, 0.52, -4.4, 3.2, 0.6, 2.6],
      [4.8, 0.48, -4.1, 3.4, 0.55, 2.8],
      [-4.6, 0.55, 4.3, 3.1, 0.62, 2.7],
      [5.1, 0.5, 4.0, 3.3, 0.58, 2.5],
      [0.2, 0.62, -1.8, 4.2, 0.65, 3.2],
      [-1.5, 0.58, 2.4, 3.8, 0.58, 2.9],
    ];
    for (let i = 0; i < slabOffsets.length; i++) {
      const [ox, oy, oz, sw, sh, sd] = slabOffsets[i]!;
      mb.solid(chamferBox(sw, sh, sd, 0.12), i % 2 === 0 ? '#858077' : '#656159', {
        at: [ox, oy, oz],
        rot: [(i % 3 - 1) * 0.08, i * 0.55, ((i + 1) % 3 - 1) * 0.07],
      });
      mb.box(0.08, 0.95, 0.08, '#2d2f33', {
        at: [ox + 0.6, oy + 0.45, oz - 0.3],
        rot: [0.35, i * 0.4, -0.28],
      });
    }

    this.rubbleGroup.add(this.materials.group(mb, this.concreteMat));
  }

  private buildGuns(): void {
    const { physics } = this.ctx;
    const mat = this.materials;

    for (let i = 0; i < FLAK_GUNS.length; i++) {
      const [x, y, z] = FLAK_GUNS[i]!;
      const root = new THREE.Group();
      root.position.set(x - TOWER_CX, y, z - TOWER_CZ);

      const baseB = new ModelBuilder()
        .cyl(1.45, 1.65, 0.65, 12, '#2d3135', { at: [0, 0.32, 0] })
        .cyl(1.2, 1.35, 0.25, 12, '#4c3e32', { at: [0, 0.72, 0] });
      root.add(mat.group(baseB));

      const turret = new THREE.Group();
      turret.position.set(0, 0.85, 0);
      const turB = new ModelBuilder()
        .solid(chamferBox(2.2, 1.35, 2.5, 0.14), '#48523f', { at: [0, 0.68, -0.1] })
        .solid(chamferBox(1.75, 0.55, 1.9, 0.1), '#353d30', { at: [0, 1.48, -0.25] })
        .solid(chamferBox(0.45, 0.75, 1.1, 0.06), '#6b533b', { at: [-1.25, 0.65, -0.2] })
        .solid(chamferBox(0.45, 0.75, 1.1, 0.06), '#6b533b', { at: [1.25, 0.65, -0.2] })
        .solid(chamferBox(1.5, 0.3, 0.2, 0.04), '#8a6b28', { at: [0, 0.9, -1.35] })
        .glow(new THREE.BoxGeometry(0.65, 0.14, 0.12), '#ff9c38', 3.2, { at: [0, 1.25, 1.15] });
      turret.add(mat.group(turB));

      const barrels = new THREE.Group();
      barrels.position.set(0, 0.85, 0.85);
      const barB = new ModelBuilder()
        .solid(chamferBox(1.15, 0.55, 0.85, 0.08), '#26292e', { at: [0, 0, 0.1] });
      for (const sx of [-0.34, 0.34]) {
        barB
          .cyl(0.14, 0.18, 1.4, 8, '#2d3136', { at: [sx, 0, 1.0], rot: [Math.PI / 2, 0, 0] })
          .cyl(0.10, 0.13, 2.8, 8, '#1e2126', { at: [sx, 0, 3.0], rot: [Math.PI / 2, 0, 0] })
          .cyl(0.16, 0.16, 0.45, 8, '#3d3f44', { at: [sx, 0, 4.45], rot: [Math.PI / 2, 0, 0] });
      }
      barrels.add(mat.group(barB));
      turret.add(barrels);
      root.add(turret);

      const wreckB = new ModelBuilder()
        .solid(chamferBox(1.8, 0.65, 1.9, 0.08), '#1c1b1a', { at: [0, 1.1, 0], rot: [0.12, 0.2, -0.18] })
        .cyl(0.11, 0.13, 2.1, 6, '#232220', { at: [-0.3, 1.4, 0.8], rot: [1.3, 0.3, -0.4] });
      const wreck = mat.group(wreckB);
      wreck.visible = false;
      root.add(wreck);

      this.towerRoot.add(root);

      const center = new THREE.Vector3(x, y + 1.65, z);
      const collider = physics.addStaticBox(center, new THREE.Vector3(1.65, 1.65, 1.65), null, 'metal');
      const meshes: THREE.Object3D[] = [];
      turret.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o); });

      const gun: FlakGun = {
        kind: 'gun',
        index: i,
        position: new THREE.Vector3(x, y, z),
        center,
        root,
        turret,
        barrels,
        wreck,
        collider,
        meshes,
        target: {
          center,
          get alive() { return gun.alive; },
          aimLift: 0.4,
          paintRadius: 2.4,
        },
        hp: FLAK_GUN_HP,
        alive: true,
        yaw: Math.PI,
        pitch: 0.65,
        recoil: 0,
        fireIn: rand(FIRE_EVERY[0], FIRE_EVERY[1]) + i * 0.55,
        smokeIn: 0,
        unmark: null,
      };
      this.guns.push(gun);
      this.byHandle.set(collider.handle, gun);
    }
  }

  dispose(): void {
    this.vehicles?.removeExtra(this);
    this.clearChunks();
    this.removeRubbleCollider();
    this.removeAllStaticColliders();
    for (const g of this.guns) {
      g.unmark?.();
      g.root.removeFromParent();
    }
    this.guns.length = 0;
    this.blocks.length = 0;
    this.byHandle.clear();
    this.towerRoot.removeFromParent();
    this.rubbleGroup.removeFromParent();
    this.concreteMat.dispose();
  }
}
