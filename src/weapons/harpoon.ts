/**
 * Gaff harpoon cannon projectile, multi-body skewer, wall pin, 3D steel rope, and grapple controller.
 *
 * Encapsulated cleanly behind a small public API so Weapons.ts and watch.ts only need a minimal hook:
 * - Single harpoon out at a time; firing launches a heavy barbed steel harpoon at ~95 m/s with mild gravity.
 * - Multi-body skewer: deals 550 damage (no explosion), pierces up to 6 killed bodies along the shaft,
 *   and pins every skewered corpse onto the wall behind when the harpoon nails into a surface.
 * - Living heavy/boss enemy survival lodges the harpoon into them (`anchored_enemy`).
 * - Right-click reel (`reelHeld`):
 *   - `anchored_wall`: slings the player toward the wall anchor (~55 m/s² + upward lift) via `player.push`
 *     so `player.flung` preserves full air momentum upon release or rope cut. Auto-releases within ~2.2 m.
 *   - `anchored_enemy`: reels enemies toward the player (and pulls the player toward heavy/boss enemies too).
 * - Tap-to-cut (`cutTapped` / `cut()`): severs the steel rope cleanly, leaves the embedded harpoon in the wall,
 *   preserves all player momentum, and starts the next harpoon reload.
 */
import * as THREE from 'three';
import { CG, type CorpseHit, type Ctx, type DamageInfo } from '../core/contracts';
import { toldKill, type EnemyInstance } from '../core/gameplay';
import type { GoreRegion } from '../characters/rig';
import { clamp } from '../core/math';

export type HarpoonState = 'ready' | 'flying' | 'anchored_wall' | 'anchored_enemy';

export interface HarpoonUpdateResult {
  /** Velocity delta applied to the player this step (null when not reeling or in cosmetic mode). */
  velocityDelta: THREE.Vector3 | null;
  /** True while the winch is reloading the next harpoon after a cut or auto-release. */
  reloading: boolean;
}

export const HARPOON = {
  /** Harpoon launch speed in m/s. */
  speed: 95,
  /** Mild gravity drop in m/s². */
  gravity: 4,
  /** Direct impact damage (no explosion). */
  damage: 550,
  /** Maximum number of killed bodies skewered onto a single harpoon shaft. */
  maxSkewer: 6,
  /** Ragdoll impulse in N·s on hit. */
  force: 160,
  /** Limb sever multiplier on hit. */
  severMult: 3.2,
  /** Headshot damage multiplier. */
  headshotMult: 2,
  /** Wall-anchor reel sling acceleration in m/s². */
  pullAccel: 55,
  /** Slight upward lift acceleration in m/s² while reeling toward a wall anchor. */
  pullLift: 14,
  /** Target sling speed cap along the rope in m/s. */
  pullMaxSpeed: 36,
  /** Auto-release distance from wall anchor in meters. */
  pullMinDist: 2.2,
  /** Reel speed for regular living enemies pulled toward the player in m/s. */
  enemyPullSpeed: 24,
  /** Reel speed for heavy/boss enemies pulled toward the player in m/s. */
  heavyEnemyPullSpeed: 12,
  /** Player sling acceleration toward a lodged heavy/boss enemy in m/s². */
  heavyPlayerPullAccel: 40,
  /** Max-HP threshold above which a surviving enemy counts as heavy (mutual pull). */
  heavyHpThreshold: 400,
  /** Auto-release distance from an anchored enemy in meters. */
  enemyReleaseDist: 2.4,
  /** Seconds an embedded harpoon remains nailed into a wall after rope cut. */
  stuckSeconds: 24,
  /** Pool capacity for static wall-embedded harpoons. */
  maxEmbedded: 12,
  /** Maximum harpoon flight distance in meters before automatic detach. */
  maxRange: 160,
  /** Maximum harpoon flight time in seconds before automatic detach. */
  flightLife: 3,
  /** Reload duration in seconds after cutting/detaching the steel rope. */
  reloadTime: 1.9,
  /** Lengthwise segments on the 3D steel rope mesh. */
  ropeSegments: 16,
  /** Radial sides on the 3D steel rope cylinder. */
  ropeRadialSides: 6,
  /** Visual radius of the steel rope in meters. */
  ropeRadius: 0.011,
  /** Maximum catenary sag in meters when the rope is slack. */
  ropeSagMax: 1.6,
  /** Spacing in meters between stacked skewered bodies pinned along the harpoon shaft. */
  pinStackStep: 0.22,
  /** Blend time from first-person muzzle onto true camera trajectory in seconds. */
  visualBlendSeconds: 0.08,
  /** Interval in seconds between cable/winch reel audio ticks. */
  reelTickInterval: 0.14,
  /** Total visual length of the world-space harpoon spear in meters. */
  spearLength: 1.08,
} as const;

const MAX_SWEEP_SLOTS = 16;
const UP = new THREE.Vector3(0, 1, 0);
const ALT_UP = new THREE.Vector3(1, 0, 0);

interface SweptHitSlot {
  enemy: EnemyInstance | null;
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  bone: number;
  region: GoreRegion;
}

interface SkeweredSlot {
  active: boolean;
  enemy: EnemyInstance | null;
  killPoint: THREE.Vector3;
  killDir: THREE.Vector3;
  headshot: boolean;
  hasCorpse: boolean;
  pinned: boolean;
  corpse: CorpseHit;
  pinAnchor: THREE.Vector3;
}

interface EmbeddedHarpoon {
  active: boolean;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  until: number;
}

function isHeavyEnemy(enemy: EnemyInstance): boolean {
  return (
    enemy.isBoss ||
    enemy.maxHealth >= HARPOON.heavyHpThreshold ||
    enemy.id === 'brute' ||
    enemy.id === 'juggernaut' ||
    enemy.id === 'titan'
  );
}

/** Merge plain BufferGeometries (positions + normals + indices) for pooled embedded harpoons. */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vertCount = 0;
  let indexCount = 0;
  for (const g of parts) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const pos = g.getAttribute('position');
    vertCount += pos.count;
    indexCount += g.index ? g.index.count : pos.count;
  }
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices = new Uint32Array(indexCount);
  let vo = 0;
  let io = 0;
  for (const g of parts) {
    const pos = g.getAttribute('position');
    const norm = g.getAttribute('normal');
    positions.set(pos.array as Float32Array, vo * 3);
    normals.set(norm.array as Float32Array, vo * 3);
    const n = g.index ? g.index.count : pos.count;
    for (let i = 0; i < n; i++) {
      indices[io + i] = (g.index ? g.index.getX(i) : i) + vo;
    }
    vo += pos.count;
    io += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  return out;
}

/**
 * Build a world-space barbed steel harpoon spear geometry oriented with nose along +Y,
 * origin at the broadhead shoulder (tail extends to -Y, tip extends to +Y).
 */
function buildHarpoonGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const shaft = new THREE.CylinderGeometry(0.015, 0.016, 0.88, 8);
  shaft.translate(0, -0.34, 0);
  parts.push(shaft);

  const tip = new THREE.ConeGeometry(0.032, 0.26, 6);
  tip.translate(0, 0.21, 0);
  parts.push(tip);

  // Twin swept-back barbed flukes flanking the broadhead.
  for (const side of [-1, 1]) {
    const barb = new THREE.BoxGeometry(0.014, 0.22, 0.044);
    barb.rotateZ(side * 0.42);
    barb.translate(side * 0.045, 0.03, 0);
    parts.push(barb);
  }

  // Rear striker collar + shackle ring at the tail.
  const collar = new THREE.CylinderGeometry(0.028, 0.028, 0.06, 8);
  collar.translate(0, -0.78, 0);
  parts.push(collar);

  const shackle = new THREE.TorusGeometry(0.026, 0.008, 6, 10);
  shackle.translate(0, -0.83, 0);
  parts.push(shackle);

  return mergeGeometries(parts);
}

/** Build a segmented cylindrical BufferGeometry updated in-place for the 3D steel rope. */
function buildRopeGeometry(segments: number, radialSides: number): THREE.BufferGeometry {
  const ringCount = segments + 1;
  const vertCount = ringCount * radialSides;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  for (let s = 0; s < segments; s++) {
    const rowA = s * radialSides;
    const rowB = (s + 1) * radialSides;
    for (let r = 0; r < radialSides; r++) {
      const rn = (r + 1) % radialSides;
      const a = rowA + r;
      const b = rowA + rn;
      const c = rowB + r;
      const d = rowB + rn;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const normAttr = new THREE.BufferAttribute(normals, 3);
  normAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', normAttr);
  geo.setIndex(indices);
  return geo;
}

export class Harpoon {
  private _state: HarpoonState = 'ready';
  private _skeweredCount = 0;
  private _reeling = false;
  private reloadRemaining = 0;
  private source = 'gaff';
  private cosmetic = false;

  private readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly embedDir = new THREE.Vector3(0, 0, -1);
  private readonly anchorPos = new THREE.Vector3();
  private readonly anchorNormal = new THREE.Vector3(0, 1, 0);
  private readonly anchorLocalOffset = new THREE.Vector3();
  private readonly visualStart = new THREE.Vector3();
  private readonly originPos = new THREE.Vector3();
  private readonly tailPos = new THREE.Vector3();
  private readonly visualPos = new THREE.Vector3();

  private anchoredEnemy: EnemyInstance | null = null;
  private flown = 0;
  private flightElapsed = 0;
  private reelTickTimer = 0;
  private clock = 0;
  private ropeTension = 0;

  private readonly hitEnemyUids = new Set<number>();
  private readonly sweptHits: SweptHitSlot[] = [];
  private readonly skewered: SkeweredSlot[] = [];
  private readonly embedded: EmbeddedHarpoon[] = [];
  private embeddedHead = 0;

  // Preallocated scratch vectors/matrices/damage structs (zero per-frame allocations).
  private readonly stepVec = new THREE.Vector3();
  private readonly stepDir = new THREE.Vector3();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private readonly tmpD = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpScale = new THREE.Vector3(1, 1, 1);
  private readonly outDelta = new THREE.Vector3();
  private readonly outResult: HarpoonUpdateResult = { velocityDelta: null, reloading: false };
  private readonly damageScratch: DamageInfo = {
    amount: HARPOON.damage,
    type: 'bullet',
    point: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    force: HARPOON.force,
    source: 'gaff',
    severMult: HARPOON.severMult,
    headshotMult: HARPOON.headshotMult,
    armorPiercing: true,
  };

  // Three.js scene visuals (lazily created when ctx.render?.scene is available).
  private visualsReady = false;
  private spearMesh: THREE.Mesh | null = null;
  private ropeMesh: THREE.Mesh | null = null;
  private embeddedMesh: THREE.InstancedMesh | null = null;
  private spearGeo: THREE.BufferGeometry | null = null;
  private ropeGeo: THREE.BufferGeometry | null = null;
  private spearMat: THREE.MeshStandardMaterial | null = null;
  private ropeMat: THREE.MeshStandardMaterial | null = null;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;

  constructor(private readonly ctx: Ctx) {
    for (let i = 0; i < MAX_SWEEP_SLOTS; i++) {
      this.sweptHits.push({
        enemy: null,
        distance: 0,
        point: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        bone: 0,
        region: 'chest',
      });
    }
    for (let i = 0; i < HARPOON.maxSkewer; i++) {
      this.skewered.push({
        active: false,
        enemy: null,
        killPoint: new THREE.Vector3(),
        killDir: new THREE.Vector3(),
        headshot: false,
        hasCorpse: false,
        pinned: false,
        corpse: {
          distance: 0,
          point: new THREE.Vector3(),
          normal: new THREE.Vector3(),
          handle: null,
          bone: 0,
          region: 'chest',
        },
        pinAnchor: new THREE.Vector3(),
      });
    }
    for (let i = 0; i < HARPOON.maxEmbedded; i++) {
      this.embedded.push({
        active: false,
        position: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
        until: 0,
      });
    }
    this.cosTable = new Float32Array(HARPOON.ropeRadialSides);
    this.sinTable = new Float32Array(HARPOON.ropeRadialSides);
    for (let r = 0; r < HARPOON.ropeRadialSides; r++) {
      const a = (r / HARPOON.ropeRadialSides) * Math.PI * 2;
      this.cosTable[r] = Math.cos(a);
      this.sinTable[r] = Math.sin(a);
    }
  }

  get state(): HarpoonState {
    return this._state;
  }

  get skeweredCount(): number {
    return this._skeweredCount;
  }

  get ropeOut(): boolean {
    return this._state !== 'ready';
  }

  get reloading(): boolean {
    return this.reloadRemaining > 0;
  }

  get reeling(): boolean {
    return this._reeling;
  }

  get anchor(): THREE.Vector3 {
    return this.anchorPos;
  }

  get position(): THREE.Vector3 {
    return this.pos;
  }

  get embeddedCount(): number {
    let n = 0;
    for (let i = 0; i < this.embedded.length; i++) {
      if (this.embedded[i]!.active) n++;
    }
    return n;
  }

  /**
   * Launch the harpoon. Only one harpoon can be out at a time; returns false if one is already
   * flying/anchored or if the winch is still reloading after a rope cut.
   */
  fire(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    muzzle: THREE.Vector3,
    source = 'gaff',
    cosmetic = false,
  ): boolean {
    if (this._state !== 'ready' || this.reloadRemaining > 0) return false;

    this.ensureVisuals();
    this.clearSkewered();
    this.hitEnemyUids.clear();

    this.source = source;
    this.cosmetic = cosmetic;
    this.anchoredEnemy = null;
    this._reeling = false;
    this.flown = 0;
    this.flightElapsed = 0;
    this.reelTickTimer = 0;
    this.ropeTension = 0.25;

    this.originPos.copy(origin);
    this.pos.copy(origin);
    this.visualStart.copy(muzzle);
    this.embedDir.copy(dir);
    if (this.embedDir.lengthSq() < 1e-8) this.embedDir.set(0, 0, -1);
    else this.embedDir.normalize();

    this.vel.copy(this.embedDir).multiplyScalar(HARPOON.speed);
    this.anchorPos.copy(origin);
    this._state = 'flying';

    if (!cosmetic) {
      this.ctx.audio?.play('stakegun_shot', { position: muzzle, volume: 1.0, pitch: 0.84 });
      this.ctx.audio?.play('stakegun_string', { position: muzzle, volume: 0.85, pitch: 0.92 });
    }
    this.syncVisuals(muzzle);
    return true;
  }

  /**
   * Advance harpoon flight, multi-body skewer, wall pinning, enemy/wall grapple reeling, and rope visuals.
   * Zero per-frame heap allocations.
   */
  update(
    dt: number,
    reelHeld: boolean,
    cutTapped: boolean,
    muzzle: THREE.Vector3,
    eye: THREE.Vector3,
    _forward: THREE.Vector3,
  ): HarpoonUpdateResult {
    this.outResult.velocityDelta = null;
    this._reeling = false;

    if (dt <= 0) {
      this.outResult.reloading = this.reloadRemaining > 0;
      return this.outResult;
    }

    this.clock += dt;

    if (this.reloadRemaining > 0) {
      this.reloadRemaining = Math.max(0, this.reloadRemaining - dt);
    }

    // Expire old embedded wall harpoons.
    this.updateEmbedded();

    if (cutTapped && this._state !== 'ready') {
      this.cut();
      this.outResult.reloading = this.reloadRemaining > 0;
      return this.outResult;
    }

    if (this._state === 'flying') {
      this.stepFlight(dt);
    } else if (this._state === 'anchored_wall') {
      this.retryPendingPins();
      this.stepWallGrapple(dt, reelHeld, eye);
    } else if (this._state === 'anchored_enemy') {
      this.stepEnemyGrapple(dt, reelHeld, eye);
    }

    this.syncVisuals(muzzle);
    this.outResult.reloading = this.reloadRemaining > 0;
    return this.outResult;
  }

  /**
   * Cleanly cut the steel rope, leaving any wall-anchored harpoon embedded, clearing the active
   * anchor without touching player momentum, and starting the next harpoon reload.
   */
  cut(): void {
    if (this._state === 'ready') return;
    if (this._state === 'anchored_wall') {
      this.leaveEmbedded(this.anchorPos, this.embedDir);
    }
    if (!this.cosmetic) {
      this.ctx.audio?.play('reload_bolt', { position: this.ctx.player?.eye, volume: 0.75, pitch: 1.15 });
    }
    this.detach(true);
  }

  /** Allow external weapon reload logic (e.g., Haste perk) to complete reload immediately. */
  finishReload(): void {
    this.reloadRemaining = 0;
  }

  /** Clear all active state, embedded harpoons, reload timer, and scene meshes. */
  reset(): void {
    this.detach(false);
    this.reloadRemaining = 0;
    this.clock = 0;
    this.embeddedHead = 0;
    for (let i = 0; i < this.embedded.length; i++) {
      this.embedded[i]!.active = false;
    }
    if (this.embeddedMesh) {
      this.embeddedMesh.count = 0;
      this.embeddedMesh.visible = false;
    }
  }

  /** Dispose Three.js resources if tearing down the controller. */
  dispose(): void {
    this.reset();
    const scene = this.ctx.render?.scene;
    if (scene) {
      if (this.spearMesh) scene.remove(this.spearMesh);
      if (this.ropeMesh) scene.remove(this.ropeMesh);
      if (this.embeddedMesh) scene.remove(this.embeddedMesh);
    }
    this.spearGeo?.dispose();
    this.ropeGeo?.dispose();
    this.spearMat?.dispose();
    this.ropeMat?.dispose();
    this.spearMesh = null;
    this.ropeMesh = null;
    this.embeddedMesh = null;
    this.spearGeo = null;
    this.ropeGeo = null;
    this.spearMat = null;
    this.ropeMat = null;
    this.visualsReady = false;
  }

  // -------------------------------------------------------------------------------------------
  // Flight & multi-body skewer
  // -------------------------------------------------------------------------------------------

  private stepFlight(dt: number): void {
    this.vel.y -= HARPOON.gravity * dt;
    this.stepVec.copy(this.vel).multiplyScalar(dt);
    const stepDist = this.stepVec.length();
    if (stepDist < 1e-6) return;

    this.stepDir.copy(this.stepVec).divideScalar(stepDist);
    this.embedDir.copy(this.stepDir);

    const wall = this.ctx.physics?.raycast(this.pos, this.stepDir, stepDist, CG.World) ?? null;
    const enemyLimit = wall ? wall.distance : stepDist;

    // Sweep all enemies along this frame's flight segment (nearest first).
    const hitStopped = this.sweepEnemies(this.stepDir, enemyLimit);
    if (hitStopped) return;

    if (wall) {
      this.pos.copy(wall.point);
      this.anchorPos.copy(wall.point);
      this.anchorNormal.copy(wall.normal);
      this._state = 'anchored_wall';
      this.ropeTension = 0.55;

      if (!this.cosmetic) {
        this.pinSkeweredToWall();
        this.ctx.fx?.impact?.(wall.point, wall.normal, wall.surface, 1.3);
        this.ctx.render?.decals?.add('crack', wall.point, wall.normal, 0.34);
        this.ctx.audio?.play('stake_twang', { position: wall.point, volume: 1.0, pitch: 0.88 });
        this.ctx.audio?.play('impact_metal', { position: wall.point, volume: 0.9, pitch: 0.85 });
      }
      return;
    }

    this.pos.addScaledVector(this.stepDir, stepDist);
    this.flown += stepDist;
    this.flightElapsed += dt;
    this.ropeTension = clamp(this.ropeTension * 0.9, 0.12, 1);

    if (this.flown >= HARPOON.maxRange || this.flightElapsed >= HARPOON.flightLife) {
      this.detach(true);
    }
  }

  /**
   * Pierce enemies along `dir` up to `limit`.
   * Returns true if the harpoon lodged into a living enemy and stopped flying.
   */
  private sweepEnemies(dir: THREE.Vector3, limit: number): boolean {
    const enemies = this.ctx.enemies;
    if (!enemies?.raycastAll) return false;
    const rawHits = enemies.raycastAll(this.pos, dir, limit, MAX_SWEEP_SLOTS);
    if (!rawHits || rawHits.length === 0) return false;

    // Copy hits out immediately so re-entrant calls inside applyDamage cannot overwrite scratch memory.
    const count = Math.min(rawHits.length, MAX_SWEEP_SLOTS);
    for (let i = 0; i < count; i++) {
      const src = rawHits[i]!;
      const dst = this.sweptHits[i]!;
      dst.enemy = src.enemy;
      dst.distance = src.distance;
      dst.point.copy(src.point);
      dst.normal.copy(src.normal);
      dst.bone = src.bone;
      dst.region = src.region;
    }

    for (let i = 0; i < count; i++) {
      const h = this.sweptHits[i]!;
      const enemy = h.enemy;
      if (!enemy || !enemy.alive || this.hitEnemyUids.has(enemy.uid)) continue;

      if (this.cosmetic) {
        this.hitEnemyUids.add(enemy.uid);
        continue;
      }

      // Already carrying the maximum 6 skewered bodies: stop piercing more enemies and carry these 6 to the wall.
      if (this._skeweredCount >= HARPOON.maxSkewer) break;

      this.hitEnemyUids.add(enemy.uid);

      const dmg = this.damageScratch;
      dmg.amount = HARPOON.damage;
      dmg.type = 'bullet';
      dmg.point.copy(h.point);
      dmg.dir.copy(dir);
      dmg.force = HARPOON.force;
      dmg.source = this.source;
      dmg.region = h.region;
      dmg.bone = h.bone;
      dmg.severMult = HARPOON.severMult;
      dmg.headshotMult = HARPOON.headshotMult;
      dmg.armorPiercing = true;
      dmg.pierces = enemy.armor > 0 ? true : undefined;

      const res = enemies.applyDamage(enemy, dmg);
      const killed = (res != null && toldKill(res)) || !enemy.alive;
      const headshot = Boolean(res?.headshot || h.region === 'head');

      if (killed) {
        const slot = this.skewered[this._skeweredCount++]!;
        slot.active = true;
        slot.enemy = enemy;
        slot.killPoint.copy(h.point);
        slot.killDir.copy(dir);
        slot.headshot = headshot;
        slot.hasCorpse = false;
        slot.pinned = false;
        this.captureCorpse(slot);

        this.ctx.audio?.play('stake_hit_flesh', { position: h.point, volume: 1.0, pitch: 0.92 });
        if (enemy.machine) {
          this.ctx.fx?.sparks?.(h.point, dir, 10, 0xffee88);
        } else {
          this.ctx.fx?.bloodHit?.(h.point, dir, 1.5);
        }
        continue;
      }

      // Surviving heavy/boss enemy: lodge harpoon into them and stop flight.
      this.pos.copy(h.point);
      this.anchorPos.copy(h.point);
      this.anchoredEnemy = enemy;
      this.anchorLocalOffset.subVectors(h.point, enemy.position);
      this._state = 'anchored_enemy';
      this.ropeTension = 0.65;

      this.ctx.audio?.play('stake_hit_flesh', { position: h.point, volume: 1.0, pitch: 0.82 });
      if (enemy.machine || res?.blocked) {
        this.ctx.audio?.play('metal_clang', { position: h.point, volume: 0.9, pitch: 0.9 });
        this.ctx.fx?.sparks?.(h.point, h.normal, 12, 0xffd9a0);
      } else {
        this.ctx.fx?.bloodHit?.(h.point, dir, 1.2);
      }
      return true;
    }

    return false;
  }

  /** Capture a newly killed enemy's ragdoll corpse handle (copies fields because GoreSystem reuses CorpseHit). */
  private captureCorpse(slot: SkeweredSlot): boolean {
    const gore = this.ctx.gore;
    if (!gore?.raycastCorpses) return false;

    const back = this.tmpA.copy(slot.killPoint).addScaledVector(slot.killDir, -1.2);
    let line = slot.killDir;
    const hips = slot.enemy?.char?.bones?.[0];
    if (slot.headshot && hips) {
      this.tmpB.setFromMatrixPosition(hips.matrixWorld).sub(back);
      if (this.tmpB.lengthSq() > 1e-6) {
        line = this.tmpB.normalize();
      }
    }

    const corpse = gore.raycastCorpses(back, line, 2.8);
    if (!corpse) return false;

    slot.corpse.distance = corpse.distance;
    slot.corpse.point.copy(corpse.point);
    slot.corpse.normal.copy(corpse.normal);
    slot.corpse.handle = corpse.handle;
    slot.corpse.bone = corpse.bone;
    slot.corpse.region = corpse.region;
    slot.hasCorpse = true;
    return true;
  }

  /** Pin every skewered body to stacked anchor points along the harpoon shaft nailed into the wall. */
  private pinSkeweredToWall(): void {
    const gore = this.ctx.gore;
    if (!gore?.pin) return;
    for (let i = 0; i < this._skeweredCount; i++) {
      const slot = this.skewered[i]!;
      if (!slot.active || slot.pinned) continue;
      if (!slot.hasCorpse) this.captureCorpse(slot);
      if (!slot.hasCorpse) continue;

      slot.pinAnchor
        .copy(this.anchorPos)
        .addScaledVector(this.embedDir, -(0.06 + i * HARPOON.pinStackStep));
      gore.pin(slot.corpse, slot.pinAnchor);
      slot.pinned = true;
    }
  }

  private retryPendingPins(): void {
    if (this.cosmetic || this._skeweredCount === 0) return;
    let hasUnpinned = false;
    for (let i = 0; i < this._skeweredCount; i++) {
      if (this.skewered[i]!.active && !this.skewered[i]!.pinned) {
        hasUnpinned = true;
        break;
      }
    }
    if (hasUnpinned) this.pinSkeweredToWall();
  }

  // -------------------------------------------------------------------------------------------
  // Grapple reeling (wall anchor & living enemy anchor)
  // -------------------------------------------------------------------------------------------

  private stepWallGrapple(dt: number, reelHeld: boolean, eye: THREE.Vector3): void {
    if (!reelHeld) {
      this.ropeTension = Math.max(0, this.ropeTension - dt * 3.5);
      return;
    }

    this._reeling = true;
    this.ropeTension = Math.min(1, this.ropeTension + dt * 8);

    if (this.cosmetic) return;

    const toAnchor = this.tmpA.subVectors(this.anchorPos, eye);
    const dist = toAnchor.length();
    if (dist <= HARPOON.pullMinDist) {
      // Auto-release cleanly near the wall while preserving all accumulated grapple velocity.
      this.leaveEmbedded(this.anchorPos, this.embedDir);
      this.ctx.audio?.play('reload_bolt', { position: eye, volume: 0.7, pitch: 1.25 });
      this.detach(true);
      return;
    }

    const pullDir = toAnchor.divideScalar(dist);
    const player = this.ctx.player;
    const currentAlong = player ? player.velocity.dot(pullDir) : 0;
    const accelStep = currentAlong < HARPOON.pullMaxSpeed
      ? Math.min(HARPOON.pullAccel * dt, HARPOON.pullMaxSpeed - currentAlong)
      : 0;

    this.outDelta.copy(pullDir).multiplyScalar(accelStep);

    // Slight upward lift on horizontal/upward pulls for an arcing kinetic sling.
    if (pullDir.y > -0.65) {
      const currentVy = player ? player.velocity.y : 0;
      const liftScale = clamp(1 - Math.max(0, currentVy) / 14, 0, 1);
      this.outDelta.y += HARPOON.pullLift * liftScale * dt;
    }

    if (player) {
      // Player.push sets `flung = true`, so air drag is skipped and full momentum carries after release/cut.
      player.push(this.outDelta);
    }
    this.outResult.velocityDelta = this.outDelta;
    this.tickReelSound(dt, eye);
  }

  private stepEnemyGrapple(dt: number, reelHeld: boolean, eye: THREE.Vector3): void {
    const enemy = this.anchoredEnemy;
    if (!enemy || !enemy.alive) {
      this.detach(true);
      return;
    }

    // Track the living enemy's current world position.
    this.anchorPos.copy(enemy.position).add(this.anchorLocalOffset);
    this.pos.copy(this.anchorPos);

    if (!reelHeld) {
      this.ropeTension = Math.max(0.15, this.ropeTension - dt * 3.5);
      return;
    }

    this._reeling = true;
    this.ropeTension = Math.min(1, this.ropeTension + dt * 8);

    if (this.cosmetic) return;

    const toEnemy = this.tmpA.subVectors(this.anchorPos, eye);
    const dist = toEnemy.length();
    if (dist <= HARPOON.enemyReleaseDist) {
      this.ctx.audio?.play('reload_bolt', { position: eye, volume: 0.7, pitch: 1.2 });
      this.detach(true);
      return;
    }

    const dirToEnemy = this.tmpB.copy(toEnemy).divideScalar(dist);
    const heavy = isHeavyEnemy(enemy);

    // Pull the enemy toward the player (respecting world walls so they never clip through geometry).
    const enemyPullDir = this.tmpC.copy(dirToEnemy).negate();
    if (enemy.id !== 'drone') {
      enemyPullDir.y *= 0.2;
      if (enemyPullDir.lengthSq() > 1e-6) enemyPullDir.normalize();
    }
    const desiredSpeed = heavy ? HARPOON.heavyEnemyPullSpeed : HARPOON.enemyPullSpeed;
    let moveDist = Math.min(desiredSpeed * dt, Math.max(0, dist - HARPOON.enemyReleaseDist * 0.85));

    if (moveDist > 1e-4) {
      const blocker = this.ctx.physics?.raycast(enemy.center, enemyPullDir, moveDist + 0.55, CG.World) ?? null;
      if (blocker) {
        moveDist = Math.max(0, blocker.distance - 0.55);
      }
      if (moveDist > 1e-4) {
        const dx = enemyPullDir.x * moveDist;
        const dy = enemyPullDir.y * moveDist;
        const dz = enemyPullDir.z * moveDist;
        enemy.position.x += dx;
        enemy.position.y += dy;
        enemy.position.z += dz;
        enemy.center.x += dx;
        enemy.center.y += dy;
        enemy.center.z += dz;
        if (enemy.char?.root?.position) {
          enemy.char.root.position.copy(enemy.position);
        }
        enemy.velocity.copy(enemyPullDir).multiplyScalar(desiredSpeed);
        this.anchorPos.copy(enemy.position).add(this.anchorLocalOffset);
        this.pos.copy(this.anchorPos);
      }
    }

    // Heavy/boss enemies also sling the player toward them!
    if (heavy) {
      const player = this.ctx.player;
      const currentAlong = player ? player.velocity.dot(dirToEnemy) : 0;
      const accelStep = currentAlong < HARPOON.pullMaxSpeed
        ? Math.min(HARPOON.heavyPlayerPullAccel * dt, HARPOON.pullMaxSpeed - currentAlong)
        : 0;
      this.outDelta.copy(dirToEnemy).multiplyScalar(accelStep);
      if (dirToEnemy.y > -0.65) {
        const currentVy = player ? player.velocity.y : 0;
        const liftScale = clamp(1 - Math.max(0, currentVy) / 14, 0, 1);
        this.outDelta.y += HARPOON.pullLift * 0.75 * liftScale * dt;
      }
      if (player) player.push(this.outDelta);
      this.outResult.velocityDelta = this.outDelta;
    }

    this.tickReelSound(dt, eye);
  }

  private tickReelSound(dt: number, eye: THREE.Vector3): void {
    this.reelTickTimer -= dt;
    if (this.reelTickTimer <= 0) {
      this.reelTickTimer = HARPOON.reelTickInterval;
      this.ctx.audio?.play('stakegun_string', { position: eye, volume: 0.42, pitch: 1.15 });
    }
  }

  private detach(startReload: boolean): void {
    this._state = 'ready';
    this._reeling = false;
    this.anchoredEnemy = null;
    this.ropeTension = 0;
    this.clearSkewered();
    this.hitEnemyUids.clear();
    if (startReload) {
      this.reloadRemaining = HARPOON.reloadTime;
    }
    if (this.spearMesh) this.spearMesh.visible = false;
    if (this.ropeMesh) this.ropeMesh.visible = false;
  }

  private clearSkewered(): void {
    for (let i = 0; i < this.skewered.length; i++) {
      const slot = this.skewered[i]!;
      slot.active = false;
      slot.enemy = null;
      slot.hasCorpse = false;
      slot.pinned = false;
      slot.corpse.handle = null;
    }
    this._skeweredCount = 0;
  }

  // -------------------------------------------------------------------------------------------
  // 3D Harpoon spear, embedded wall harpoons, and metallic steel rope visuals
  // -------------------------------------------------------------------------------------------

  private ensureVisuals(): void {
    if (this.visualsReady) return;
    const scene = this.ctx.render?.scene;
    if (!scene) return;

    this.spearGeo = buildHarpoonGeometry();
    this.spearMat = new THREE.MeshStandardMaterial({
      color: 0xbec6ce,
      metalness: 0.88,
      roughness: 0.28,
    });
    this.ctx.render?.materials?.patch?.(this.spearMat);

    this.spearMesh = new THREE.Mesh(this.spearGeo, this.spearMat);
    this.spearMesh.frustumCulled = false;
    this.spearMesh.visible = false;
    scene.add(this.spearMesh);

    this.embeddedMesh = new THREE.InstancedMesh(this.spearGeo, this.spearMat, HARPOON.maxEmbedded);
    this.embeddedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.embeddedMesh.frustumCulled = false;
    this.embeddedMesh.count = 0;
    this.embeddedMesh.visible = false;
    scene.add(this.embeddedMesh);

    this.ropeGeo = buildRopeGeometry(HARPOON.ropeSegments, HARPOON.ropeRadialSides);
    this.ropeMat = new THREE.MeshStandardMaterial({
      color: 0x8b959e,
      metalness: 0.82,
      roughness: 0.36,
    });
    this.ctx.render?.materials?.patch?.(this.ropeMat);

    this.ropeMesh = new THREE.Mesh(this.ropeGeo, this.ropeMat);
    this.ropeMesh.frustumCulled = false;
    this.ropeMesh.visible = false;
    scene.add(this.ropeMesh);

    this.visualsReady = true;
  }

  private leaveEmbedded(point: THREE.Vector3, dir: THREE.Vector3): void {
    const slot = this.embedded[this.embeddedHead]!;
    this.embeddedHead = (this.embeddedHead + 1) % HARPOON.maxEmbedded;
    slot.active = true;
    // Sink the broadhead tip slightly into the wall while keeping shaft & barbs protruding cleanly.
    slot.position.copy(point).addScaledVector(dir, -0.14);
    this.orientFromDir(dir, slot.rotation);
    slot.until = this.clock + HARPOON.stuckSeconds;
    this.uploadEmbeddedInstances();
  }

  private updateEmbedded(): void {
    let changed = false;
    for (let i = 0; i < this.embedded.length; i++) {
      const slot = this.embedded[i]!;
      if (slot.active && this.clock >= slot.until) {
        slot.active = false;
        changed = true;
      }
    }
    if (changed) this.uploadEmbeddedInstances();
  }

  private uploadEmbeddedInstances(): void {
    const mesh = this.embeddedMesh;
    if (!mesh) return;
    let count = 0;
    for (let i = 0; i < this.embedded.length; i++) {
      const slot = this.embedded[i]!;
      if (!slot.active) continue;
      this.tmpMat.compose(slot.position, slot.rotation, this.tmpScale);
      mesh.setMatrixAt(count++, this.tmpMat);
    }
    mesh.count = count;
    mesh.visible = count > 0;
    if (count > 0) mesh.instanceMatrix.needsUpdate = true;
  }

  private orientFromDir(dir: THREE.Vector3, out: THREE.Quaternion): void {
    if (Math.abs(dir.y) > 0.999) {
      out.setFromAxisAngle(ALT_UP, dir.y > 0 ? 0 : Math.PI);
    } else {
      out.setFromUnitVectors(UP, dir);
    }
  }

  private syncVisuals(muzzle: THREE.Vector3): void {
    if (!this.visualsReady || !this.spearMesh || !this.ropeMesh) return;
    if (this._state === 'ready') {
      this.spearMesh.visible = false;
      this.ropeMesh.visible = false;
      return;
    }

    // Blend visually from muzzle onto true trajectory over the first 0.08 s of flight.
    if (this._state === 'flying' && this.flightElapsed < HARPOON.visualBlendSeconds) {
      const alpha = clamp(this.flightElapsed / HARPOON.visualBlendSeconds, 0, 1);
      this.tmpA.subVectors(this.visualStart, this.originPos).multiplyScalar(1 - alpha);
      this.visualPos.copy(this.pos).add(this.tmpA);
    } else if (this._state === 'anchored_wall') {
      this.visualPos.copy(this.anchorPos).addScaledVector(this.embedDir, -0.14);
    } else {
      this.visualPos.copy(this.pos);
    }

    this.orientFromDir(this.embedDir, this.tmpQuat);
    this.spearMesh.position.copy(this.visualPos);
    this.spearMesh.quaternion.copy(this.tmpQuat);
    this.spearMesh.visible = true;

    // Steel rope connects player muzzle to the harpoon tail shackle ring.
    this.tailPos.copy(this.visualPos).addScaledVector(this.embedDir, -0.82);
    this.updateRopeGeometry(muzzle, this.tailPos);
    this.ropeMesh.visible = true;
  }

  private updateRopeGeometry(start: THREE.Vector3, end: THREE.Vector3): void {
    const geo = this.ropeGeo;
    if (!geo) return;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const normals = normAttr.array as Float32Array;

    const span = this.tmpA.subVectors(end, start);
    const dist = span.length();
    if (dist < 1e-4) return;

    const tangent = this.tmpB.copy(span).divideScalar(dist);
    const refUp = Math.abs(tangent.y) > 0.92 ? ALT_UP : UP;
    this.tmpRight.crossVectors(tangent, refUp).normalize();
    this.tmpUp.crossVectors(this.tmpRight, tangent).normalize();

    const slack = clamp(1 - this.ropeTension, 0, 1);
    const sag = Math.min(HARPOON.ropeSagMax, dist * 0.045) * slack;
    const segs = HARPOON.ropeSegments;
    const sides = HARPOON.ropeRadialSides;
    const radius = HARPOON.ropeRadius;

    let vi = 0;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const drop = 4 * t * (1 - t) * sag;
      const cx = start.x + span.x * t;
      const cy = start.y + span.y * t - drop;
      const cz = start.z + span.z * t;

      for (let r = 0; r < sides; r++) {
        const c = this.cosTable[r]!;
        const sn = this.sinTable[r]!;
        const nx = this.tmpRight.x * c + this.tmpUp.x * sn;
        const ny = this.tmpRight.y * c + this.tmpUp.y * sn;
        const nz = this.tmpRight.z * c + this.tmpUp.z * sn;

        positions[vi] = cx + nx * radius;
        positions[vi + 1] = cy + ny * radius;
        positions[vi + 2] = cz + nz * radius;

        normals[vi] = nx;
        normals[vi + 1] = ny;
        normals[vi + 2] = nz;
        vi += 3;
      }
    }

    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
  }
}
