/**
 * Mortar Rack shoulder weapon plug-in (`mortarRack`).
 *
 * Indirect-fire 6-tube mortar battery (25–180 m range, 0.5 s cadence, 6.5 s rack reload).
 * Hold the shoulder key (G / V / B) to project a glowing ground landing circle over cover; release fires a high-arc
 * mortar shell whose flight time scales with horizontal range (~2.5 s at 100 m, clamped 1.2..4.0 s).
 * Tap `3` / `4` / `5` to cycle three munitions:
 *   1. HE      — 6 m blast, 260 damage (`Combat.explode`, kind `'shell'`).
 *   2. WP      — 9 m white-hot burning patch lasting 14 s (Kiln `fx.napalm` + rising white smoke plume, igniting
 *                enemies via `enemies.afflict(e, 'burn', ...)`).
 *   3. CLUSTER — airbursts 18 m above the landing circle and releases 32 circular bomblets via `bombletCarpet`.
 */
import * as THREE from 'three';
import { CG, type Ctx } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import { GroundRing } from '../../progression/callins/ground';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { Sight } from '../arms/types';
import { bombletCarpet, clearBomblets, stepBombletsIfUnhooked, type BombletSpec } from '../bomblets';
import type { FrameShoulderWeapon, ShoulderPlugin, ShoulderUpdateContext } from './types';

export const MORTAR_ROUNDS = ['HE', 'WP', 'CLUSTER'] as const;
export type MortarRound = (typeof MORTAR_ROUNDS)[number];

export const MORTAR_TUNING = {
  rack: 6,
  cadence: 0.5,
  reload: 6.5,
  minRange: 25,
  maxRange: 180,
  minFlight: 1.2,
  maxFlight: 4.0,
  flightBase: 1.0,
  flightPerMetre: 0.015,
  gravity: 38,
  whistleLead: 0.9,
  he: {
    radius: 6,
    damage: 260,
  },
  wp: {
    impactRadius: 4.5,
    impactDamage: 90,
    patchRadius: 9,
    duration: 14,
    fade: 3,
    tick: 0.25,
    burnSeconds: 6,
    puffEvery: 0.22,
  },
  cluster: {
    burstHeight: 18,
  },
} as const;

export const MORTAR_CLUSTER_SPEC: Readonly<BombletSpec> = {
  count: 32,
  length: 18,
  width: 18,
  ripple: 0.7,
  blastRadius: 2.4,
  damage: 70,
  circular: true,
  source: 'frame_mortar_cluster',
};

const MORTAR_CLUSTER_COSMETIC_SPEC: Readonly<BombletSpec> = {
  ...MORTAR_CLUSTER_SPEC,
  cosmetic: true,
};

const RING_COLORS: readonly string[] = ['#ff8a2a', '#e8f4ff', '#ffcc30'];
const RING_RADII: readonly number[] = [
  MORTAR_TUNING.he.radius,
  MORTAR_TUNING.wp.patchRadius,
  MORTAR_CLUSTER_SPEC.width * 0.5,
];

const MAX_MORTAR_SHELLS = 24;
const MAX_WP_PATCHES = 12;
const WP_BODY_PAD = 0.35;
const WP_HEIGHT_TOL = 3.5;

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _origin = new THREE.Vector3();
const _target = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();
const _near: EnemyInstance[] = [];

const _heBlast: ExplosionSpec = {
  radius: MORTAR_TUNING.he.radius,
  damage: MORTAR_TUNING.he.damage,
  kind: 'shell',
  source: 'frame_mortar_he',
  team: 'player',
  selfDamage: 0,
  playerPush: 0,
  scale: 1.5,
  shake: 0.1,
};

const _wpBlast: ExplosionSpec = {
  radius: MORTAR_TUNING.wp.impactRadius,
  damage: MORTAR_TUNING.wp.impactDamage,
  kind: 'shell',
  source: 'frame_mortar_wp',
  team: 'player',
  selfDamage: 0,
  playerPush: 0,
  scale: 0.9,
  shake: 0.05,
};

/** Flight duration scaling with horizontal range (~2.5 s at 100 m, clamped to 1.2..4.0 s). */
export function mortarFlightTime(horizRange: number): number {
  return clamp(
    MORTAR_TUNING.flightBase + Math.max(0, horizRange) * MORTAR_TUNING.flightPerMetre,
    MORTAR_TUNING.minFlight,
    MORTAR_TUNING.maxFlight,
  );
}

/**
 * Projects the pilot's sight onto terrain within `[25, 180]` m horizontally of `feet`.
 * Writes the ground target into `out` and returns the clamped horizontal range in metres.
 */
export function mortarTargetPoint(ctx: Ctx, feet: THREE.Vector3, sight: Sight, out: THREE.Vector3): number {
  let candidateY = feet.y;
  if (Number.isFinite(sight.range) && sight.range > 0 && sight.range <= MORTAR_TUNING.maxRange + 40) {
    _aim.copy(sight.point);
    candidateY = _aim.y;
  } else {
    const hit = ctx.physics?.raycast?.(sight.view.position, sight.aim, MORTAR_TUNING.maxRange + 40, CG.World) ?? null;
    if (hit) {
      _aim.copy(hit.point);
      candidateY = hit.point.y;
    } else if (sight.aim.y < -0.02) {
      const t = clamp((feet.y - sight.view.position.y) / sight.aim.y, MORTAR_TUNING.minRange, MORTAR_TUNING.maxRange);
      _aim.copy(sight.view.position).addScaledVector(sight.aim, t);
      candidateY = feet.y;
    } else {
      _aim.set(sight.aim.x, 0, sight.aim.z);
      if (_aim.lengthSq() < 1e-4) _aim.set(0, 0, -1);
      else _aim.normalize();
      _aim.multiplyScalar(MORTAR_TUNING.maxRange).add(feet);
      candidateY = feet.y;
    }
  }

  const dx = _aim.x - feet.x;
  const dz = _aim.z - feet.z;
  const horiz = Math.hypot(dx, dz);
  let ux: number;
  let uz: number;
  if (horiz > 1e-3) {
    ux = dx / horiz;
    uz = dz / horiz;
  } else {
    const ah = Math.hypot(sight.aim.x, sight.aim.z);
    if (ah > 1e-3) {
      ux = sight.aim.x / ah;
      uz = sight.aim.z / ah;
    } else {
      ux = 0;
      uz = -1;
    }
  }

  const range = clamp(horiz, MORTAR_TUNING.minRange, MORTAR_TUNING.maxRange);
  const tx = feet.x + ux * range;
  const tz = feet.z + uz * range;

  // Snap Y to terrain surface below the target XZ.
  let ty = candidateY;
  const probeY = Math.max(feet.y, candidateY) + 60;
  const ground = ctx.physics?.raycast?.(_probe.set(tx, probeY, tz), DOWN, 160, CG.World) ?? null;
  if (ground) {
    ty = ground.point.y;
  } else {
    const navY = ctx.world?.nav?.groundHeight?.(tx, feet.y + 4, tz);
    ty = navY !== undefined && Number.isFinite(navY) ? navY : feet.y;
  }

  out.set(tx, ty, tz);
  return range;
}

/** Pure clock for the 6-round Mortar Rack (hold to aim landing circle, release to fire, 0.5 s cadence, 6.5 s reload). */
export class MortarRack {
  ammo: number = MORTAR_TUNING.rack;
  /** Remaining reload time in seconds, or -1 when not reloading. */
  reloading = -1;
  /** Minimum delay between launches in seconds (0.5 s). */
  cooldown = 0;
  roundIndex = 0;
  aiming = false;

  get round(): MortarRound {
    return MORTAR_ROUNDS[this.roundIndex]!;
  }

  get progress(): number {
    return this.reloading < 0 ? -1 : clamp(1 - this.reloading / MORTAR_TUNING.reload);
  }

  get ready(): boolean {
    return this.ammo > 0 && this.reloading < 0 && this.cooldown <= 0;
  }

  cycle(): MortarRound {
    this.roundIndex = (this.roundIndex + 1) % MORTAR_ROUNDS.length;
    return this.round;
  }

  /**
   * Advances rack timers and trigger state.
   * Returns true on the exact release frame that launches a mortar shell.
   */
  update(dt: number, held: boolean): boolean {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloading >= 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = -1;
        this.ammo = MORTAR_TUNING.rack;
      }
    }
    if (held) {
      this.aiming = this.ammo > 0 && this.reloading < 0;
      return false;
    }
    if (this.aiming) {
      this.aiming = false;
      if (this.ready) {
        this.ammo--;
        this.cooldown = MORTAR_TUNING.cadence;
        if (this.ammo === 0) this.reloading = MORTAR_TUNING.reload;
        return true;
      }
    }
    return false;
  }

  reset(): void {
    this.ammo = MORTAR_TUNING.rack;
    this.reloading = -1;
    this.cooldown = 0;
    this.roundIndex = 0;
    this.aiming = false;
  }
}

interface MortarShell {
  live: boolean;
  serial: number;
  roundIdx: number;
  age: number;
  flightTime: number;
  whistled: boolean;
  cosmetic: boolean;
  trailIn: number;
  origin: THREE.Vector3;
  aim: THREE.Vector3;
  target: THREE.Vector3;
  velocity: THREE.Vector3;
  pos: THREE.Vector3;
}

interface WpPatch {
  live: boolean;
  serial: number;
  age: number;
  duration: number;
  radius: number;
  cosmetic: boolean;
  puffIn: number;
  tickIn: number;
  lightIn: number;
  pos: THREE.Vector3;
}

function makeShell(): MortarShell {
  return {
    live: false,
    serial: 0,
    roundIdx: 0,
    age: 0,
    flightTime: 2.5,
    whistled: false,
    cosmetic: false,
    trailIn: 0,
    origin: new THREE.Vector3(),
    aim: new THREE.Vector3(),
    target: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    pos: new THREE.Vector3(),
  };
}

function makeWpPatch(): WpPatch {
  return {
    live: false,
    serial: 0,
    age: 0,
    duration: MORTAR_TUNING.wp.duration,
    radius: MORTAR_TUNING.wp.patchRadius,
    cosmetic: false,
    puffIn: 0,
    tickIn: 0,
    lightIn: 0,
    pos: new THREE.Vector3(),
  };
}

class MortarField {
  readonly shells: MortarShell[] = Array.from({ length: MAX_MORTAR_SHELLS }, makeShell);
  readonly patches: WpPatch[] = Array.from({ length: MAX_WP_PATCHES }, makeWpPatch);
  shellCount = 0;
  patchCount = 0;
  hooked = false;
  private serial = 0;
  private mesh: THREE.InstancedMesh | null = null;
  private readonly onPreStep = (dt: number): void => {
    this.step(dt);
  };

  constructor(private readonly ctx: Ctx) {}

  private ensureMesh(): THREE.InstancedMesh | null {
    if (this.mesh) return this.mesh;
    const scene = this.ctx.render?.scene;
    if (!scene || typeof scene.add !== 'function') return null;
    const geo = new THREE.OctahedronGeometry(0.28, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_MORTAR_SHELLS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    mesh.name = 'frame.mortar.shells';
    scene.add(mesh);
    this.mesh = mesh;
    return mesh;
  }

  private attach(): void {
    if (this.hooked) return;
    const preStep = this.ctx.physics?.preStep;
    if (preStep && typeof preStep.add === 'function') {
      preStep.add(this.onPreStep);
      this.hooked = true;
    }
  }

  private detach(): void {
    if (!this.hooked) return;
    const preStep = this.ctx.physics?.preStep;
    if (preStep && typeof preStep.delete === 'function') preStep.delete(this.onPreStep);
    this.hooked = false;
  }

  launch(
    roundIdx: number,
    origin: THREE.Vector3,
    target: THREE.Vector3,
    flightTime: number,
    cosmetic: boolean,
  ): void {
    let slot: MortarShell | null = null;
    let oldest = this.shells[0]!;
    for (let i = 0; i < MAX_MORTAR_SHELLS; i++) {
      const s = this.shells[i]!;
      if (!s.live) {
        slot = s;
        this.shellCount++;
        break;
      }
      if (s.serial < oldest.serial) oldest = s;
    }
    const s = slot ?? oldest;
    const T = clamp(flightTime, 0.3, 6);
    s.live = true;
    s.serial = ++this.serial;
    s.roundIdx = clamp(Math.round(roundIdx), 0, MORTAR_ROUNDS.length - 1);
    s.age = 0;
    s.flightTime = T;
    s.whistled = false;
    s.cosmetic = cosmetic;
    s.trailIn = 0.03;
    s.origin.copy(origin);
    s.pos.copy(origin);
    s.target.copy(target);
    // Cluster airbursts 18 m above the landing circle; HE & WP impact the ground target.
    s.aim.copy(target);
    if (s.roundIdx === 2) s.aim.y += MORTAR_TUNING.cluster.burstHeight;

    s.velocity.subVectors(s.aim, s.origin).divideScalar(T);
    s.velocity.y += 0.5 * MORTAR_TUNING.gravity * T;

    this.attach();
    this.syncMesh();
  }

  addWpPatch(at: THREE.Vector3, cosmetic: boolean): void {
    let slot: WpPatch | null = null;
    let oldest = this.patches[0]!;
    for (let i = 0; i < MAX_WP_PATCHES; i++) {
      const p = this.patches[i]!;
      if (!p.live) {
        slot = p;
        this.patchCount++;
        break;
      }
      if (p.serial < oldest.serial) oldest = p;
    }
    const p = slot ?? oldest;
    p.live = true;
    p.serial = ++this.serial;
    p.age = 0;
    p.duration = MORTAR_TUNING.wp.duration;
    p.radius = MORTAR_TUNING.wp.patchRadius;
    p.cosmetic = cosmetic;
    p.puffIn = 0;
    p.tickIn = 0;
    p.lightIn = 0;
    p.pos.copy(at);
    this.attach();
  }

  step(dt: number): void {
    if (dt <= 0) return;
    if (this.shellCount > 0) this.stepShells(dt);
    if (this.patchCount > 0) this.stepPatches(dt);
    if (this.shellCount <= 0 && this.patchCount <= 0) {
      this.shellCount = 0;
      this.patchCount = 0;
      this.detach();
    }
  }

  private stepShells(dt: number): void {
    const c = this.ctx;
    for (let i = 0; i < MAX_MORTAR_SHELLS; i++) {
      const s = this.shells[i]!;
      if (!s.live) continue;
      s.age += dt;
      const t = Math.min(s.age, s.flightTime);
      s.pos.copy(s.origin).addScaledVector(s.velocity, t);
      s.pos.y -= 0.5 * MORTAR_TUNING.gravity * t * t;

      // Whistle on descent.
      if (!s.whistled && s.flightTime - s.age <= MORTAR_TUNING.whistleLead) {
        s.whistled = true;
        c.audio?.play?.('missile_incoming', {
          position: s.target,
          pitch: s.roundIdx === 1 ? 1.05 : 0.9,
          volume: 0.9,
        });
      }

      // Visible arc trail puffs.
      s.trailIn -= dt;
      if (s.trailIn <= 0) {
        s.trailIn = 0.055;
        const smokeCol = s.roundIdx === 1 ? 0xf2f6fa : 0xb8bec6;
        c.fx?.smoke?.(s.pos, smokeCol, s.roundIdx === 1 ? 0.7 : 0.55, 0.85);
        _vel.copy(s.velocity);
        _vel.y -= MORTAR_TUNING.gravity * t;
        if (_vel.lengthSq() > 1e-4) {
          _dir.copy(_vel).normalize().negate();
          c.fx?.sparks?.(s.pos, _dir, 2, s.roundIdx === 1 ? '#f4f8ff' : '#ffcc66');
        }
      }

      if (s.age >= s.flightTime) {
        s.live = false;
        this.shellCount--;
        this.detonate(s);
      }
    }
    this.syncMesh();
  }

  private detonate(s: MortarShell): void {
    const c = this.ctx;
    if (s.roundIdx === 0) {
      // 1. HE: 6 m blast, 260 damage.
      _heBlast.cosmetic = s.cosmetic;
      _heBlast.mirrored = !s.cosmetic;
      _heBlast.normal = UP;
      c.combat.explode(s.aim, _heBlast);
      c.physics?.radialImpulse?.(s.aim, MORTAR_TUNING.he.radius * 1.6, 175);
      c.fx?.ring?.(s.aim, UP, '#ff9838', MORTAR_TUNING.he.radius * 2.1);
      c.fx?.sparks?.(s.aim, UP, 32, '#ffbe58');
      c.fx?.chips?.(s.aim, 0x6a645d, 22);
      c.fx?.smoke?.(_pt.copy(s.aim).setY(s.aim.y + 1.8), 0x2d2926, 4.2, 4.5);
      c.render?.lights?.flash?.(s.aim, 0xffaa44, 16, 22, 0.28);
      c.render?.decals?.add?.('scorch', s.aim, UP, MORTAR_TUNING.he.radius * 0.9, rand(0, Math.PI * 2));
      c.audio?.play?.('hellfirerocket_explode', { position: s.aim, volume: 1.1, pitch: 0.78 });
      c.audio?.play?.('explosion_debris', { position: s.aim, volume: 0.85, pitch: 0.85 });
      return;
    }

    if (s.roundIdx === 1) {
      // 2. White Phosphorus: initial white-hot burst + 9 m burning patch lasting 14 s with rising white smoke plume.
      _wpBlast.cosmetic = s.cosmetic;
      _wpBlast.mirrored = !s.cosmetic;
      _wpBlast.normal = UP;
      c.combat.explode(s.aim, _wpBlast);
      c.fx?.ring?.(s.aim, UP, '#f4f8ff', MORTAR_TUNING.wp.patchRadius * 1.8);
      c.fx?.sparks?.(s.aim, UP, 36, '#ffffff');
      c.fx?.smoke?.(_pt.copy(s.aim).setY(s.aim.y + 1.4), 0xf4f6f8, 5.2, 4.2);
      c.render?.lights?.flash?.(s.aim, 0xf4f8ff, 34, 24, 0.45);
      c.render?.decals?.add?.('scorch', s.aim, UP, MORTAR_TUNING.wp.patchRadius * 0.65, rand(0, Math.PI * 2));
      c.audio?.play?.('hellfirebullet_explode', { position: s.aim, volume: 1.0, pitch: 0.72 });
      c.audio?.play?.('flame_ignite', { position: s.aim, volume: 1.0 });
      c.audio?.play?.('char_sizzle', { position: s.aim, volume: 0.85 });
      this.addWpPatch(s.aim, s.cosmetic);
      return;
    }

    // 3. Cluster: airburst 18 m above landing circle, showering 32 circular bomblets across an 18 m patch.
    c.fx?.ring?.(s.aim, DOWN, '#ffcc40', 9.0);
    c.fx?.smoke?.(s.aim, 0xd4d8de, 3.4, 2.0);
    c.fx?.sparks?.(s.aim, DOWN, 28, '#ffd278');
    c.render?.lights?.flash?.(s.aim, 0xffbb55, 18, 22, 0.18);
    c.audio?.play?.('30mmshell_explode', { position: s.aim, volume: 1.0, pitch: 0.72 });
    bombletCarpet(c, s.aim, DOWN, s.cosmetic ? MORTAR_CLUSTER_COSMETIC_SPEC : MORTAR_CLUSTER_SPEC);
  }

  private stepPatches(dt: number): void {
    const c = this.ctx;
    const W = MORTAR_TUNING.wp;
    const thin = Math.min(1, 3 / Math.max(1, this.patchCount));

    for (let i = 0; i < MAX_WP_PATCHES; i++) {
      const p = this.patches[i]!;
      if (!p.live) continue;
      p.age += dt;
      if (p.age >= p.duration) {
        p.live = false;
        this.patchCount--;
        continue;
      }

      const heat = clamp((p.duration - p.age) / W.fade);

      // Reuse the Kiln's burning ground patches (`fx.napalm`), thinned so big 9 m patches stay within particle budget.
      c.fx?.napalm?.(p.pos, UP, p.radius, heat * thin * 0.45);

      // Rising white-hot phosphorus smoke plume + glowing white-hot embers.
      p.puffIn -= dt;
      if (p.puffIn <= 0) {
        p.puffIn = W.puffEvery;
        const ang = rand(0, Math.PI * 2);
        const rad = Math.sqrt(Math.random()) * p.radius * 0.78;
        _pt.set(p.pos.x + Math.cos(ang) * rad, p.pos.y + rand(0.6, 3.2), p.pos.z + Math.sin(ang) * rad);
        c.fx?.smoke?.(_pt, 0xf4f6f8, p.radius * rand(0.32, 0.52) * (0.45 + 0.55 * heat), rand(2.6, 4.4));
        if (Math.random() < heat) {
          c.fx?.sparks?.(_pt, UP, 3, '#f4f8ff');
          c.fx?.embers?.(_pt, 2, p.radius * 0.35);
        }
      }

      // Cool white-hot glow over the burning WP field (throttled).
      p.lightIn -= dt;
      if (p.lightIn <= 0) {
        p.lightIn = 0.35;
        _pt.set(p.pos.x, p.pos.y + 1.0, p.pos.z);
        c.render?.lights?.flash?.(_pt, 0xf0f6ff, 14 * heat * thin, p.radius * 1.9, 0.36);
      }

      // Ignite any enemy walking through the 9 m WP burning patch (morale break & burn via EnemySystem.afflict).
      p.tickIn -= dt;
      if (p.tickIn <= 0) {
        p.tickIn = W.tick;
        if (!p.cosmetic && c.enemies?.query && c.enemies?.afflict) {
          const n = c.enemies.query(p.pos, p.radius + 2.6, _near) || 0;
          const reach2 = (p.radius + WP_BODY_PAD) * (p.radius + WP_BODY_PAD);
          for (let k = 0; k < n; k++) {
            const e = _near[k]!;
            if (!e.alive) continue;
            if (Math.abs(e.position.y - p.pos.y) > WP_HEIGHT_TOL) continue;
            const dx = e.position.x - p.pos.x;
            const dz = e.position.z - p.pos.z;
            if (dx * dx + dz * dz <= reach2) {
              c.enemies.afflict(e, 'burn', W.burnSeconds);
            }
          }
          _near.length = 0;
        }
      }
    }
  }

  private syncMesh(): void {
    const mesh = this.ensureMesh();
    if (!mesh) return;
    if (this.shellCount <= 0) {
      mesh.count = 0;
      mesh.visible = false;
      return;
    }
    let count = 0;
    for (let i = 0; i < MAX_MORTAR_SHELLS; i++) {
      const s = this.shells[i]!;
      if (!s.live) continue;
      _vel.copy(s.velocity);
      _vel.y -= MORTAR_TUNING.gravity * Math.min(s.age, s.flightTime);
      if (_vel.lengthSq() > 1e-4) {
        _dir.copy(_vel).normalize();
        _quat.setFromUnitVectors(UP, _dir);
      } else {
        _quat.identity();
      }
      _scale.set(0.65, 2.2, 0.65);
      _mat.compose(s.pos, _quat, _scale);
      mesh.setMatrixAt(count, _mat);
      if (s.roundIdx === 1) _color.setRGB(3.2, 3.4, 3.6);
      else if (s.roundIdx === 2) _color.setRGB(3.4, 2.4, 0.6);
      else _color.setRGB(3.6, 1.8, 0.5);
      mesh.setColorAt(count, _color);
      count++;
    }
    mesh.count = count;
    mesh.visible = count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < MAX_MORTAR_SHELLS; i++) this.shells[i]!.live = false;
    for (let i = 0; i < MAX_WP_PATCHES; i++) this.patches[i]!.live = false;
    this.shellCount = 0;
    this.patchCount = 0;
    this.detach();
    if (this.mesh) {
      this.mesh.count = 0;
      this.mesh.visible = false;
    }
  }
}

const mortarFields = new WeakMap<Ctx, MortarField>();
let lastMortarCtx: Ctx | null = null;

function mortarFieldOf(ctx: Ctx): MortarField {
  let f = mortarFields.get(ctx);
  if (!f) {
    f = new MortarField(ctx);
    mortarFields.set(ctx, f);
  }
  lastMortarCtx = ctx;
  return f;
}

/** Advances in-flight mortar shells and WP burning patches for `ctx` (for tests or manual driving). */
export function updateMortarWorld(dt: number, ctx?: Ctx): void {
  const target = ctx ?? lastMortarCtx;
  if (!target) return;
  mortarFields.get(target)?.step(dt);
}

/** Clears active mortar shells and WP burning patches for `ctx`. */
export function clearMortarWorld(ctx?: Ctx): void {
  const target = ctx ?? lastMortarCtx;
  if (!target) return;
  mortarFields.get(target)?.clear();
}

export function activeMortarShellCount(ctx?: Ctx): number {
  const target = ctx ?? lastMortarCtx;
  if (!target) return 0;
  return mortarFields.get(target)?.shellCount ?? 0;
}

export function activeWpPatchCount(ctx?: Ctx): number {
  const target = ctx ?? lastMortarCtx;
  if (!target) return 0;
  return mortarFields.get(target)?.patchCount ?? 0;
}

export class MortarShoulder implements FrameShoulderWeapon {
  readonly kind = 'mortar' as const;
  readonly hasCycle = true;
  readonly clock = new MortarRack();
  private ring: GroundRing | null = null;
  private readonly lastTarget = new THREE.Vector3();
  private lastRange: number = MORTAR_TUNING.minRange;
  private ringClock = 0;

  constructor(private readonly ctx: Ctx) {}

  private ensureRing(): GroundRing | null {
    if (this.ring) return this.ring;
    const scene = this.ctx.render?.scene;
    if (!scene || typeof scene.add !== 'function') return null;
    this.ring = new GroundRing(this.ctx);
    this.ring.setOpacity(0.9);
    return this.ring;
  }

  private hideRing(): void {
    this.ring?.hide();
  }

  update(dt: number, u: ShoulderUpdateContext): void {
    const { audio } = this.ctx;
    const field = mortarFieldOf(this.ctx);
    if (!field.hooked) field.step(dt);
    stepBombletsIfUnhooked(dt, this.ctx);

    if (u.cyclePressed) {
      this.clock.cycle();
      audio?.play?.('reload_bolt', { pitch: 0.82 });
    }

    const wasLoading = this.clock.reloading >= 0;
    const activeHold = u.online && u.held;
    const fired = this.clock.update(dt, activeHold);

    if (wasLoading && this.clock.reloading < 0) {
      audio?.play?.('reload_rocket', { volume: 0.85, pitch: 0.85 });
    }

    if (this.clock.aiming) {
      this.lastRange = mortarTargetPoint(this.ctx, u.feet, u.sight, this.lastTarget);
      this.ringClock += dt;
      const ring = this.ensureRing();
      if (ring) {
        const idx = this.clock.roundIndex;
        const radius = RING_RADII[idx]!;
        ring.setColor(RING_COLORS[idx]!, 2.2);
        ring.show(this.lastTarget, radius, idx === 2 ? radius * 0.45 : 0);
        ring.tick(this.ringClock);
      }
    } else {
      this.hideRing();
    }

    if (fired) {
      this.launch(u);
    } else if (u.pressed && (!u.online || this.clock.ammo === 0 || this.clock.reloading >= 0)) {
      audio?.play?.('weapon_dry', { pitch: 0.72 });
    }
  }

  idleUpdate(dt: number): void {
    this.hideRing();
    this.clock.update(dt, false);
    const field = mortarFields.get(this.ctx);
    if (field && !field.hooked) field.step(dt);
    stepBombletsIfUnhooked(dt, this.ctx);
  }

  fillRow(row: GunnerWeapon, keyLabel: string, cycleKeyLabel: string, online: boolean): void {
    row.max = MORTAR_TUNING.rack;
    if (!online) {
      row.name = `${keyLabel} MORTAR // OFFLINE`;
      row.ammo = 0;
      row.reload = -1;
      return;
    }
    row.name = `${keyLabel} MORTAR ${this.clock.round} // ${cycleKeyLabel}`;
    row.ammo = this.clock.ammo;
    row.reload = this.clock.progress;
  }

  silence(): void {
    this.hideRing();
    this.clock.aiming = false;
  }

  reset(): void {
    this.hideRing();
    this.clock.reset();
    clearMortarWorld(this.ctx);
    clearBomblets(this.ctx);
  }

  private launch(u: ShoulderUpdateContext): void {
    const { audio, camera, fx, render } = this.ctx;
    u.mountPos(_origin);
    const flightTime = mortarFlightTime(this.lastRange);
    const roundIdx = this.clock.roundIndex;

    mortarFieldOf(this.ctx).launch(roundIdx, _origin, this.lastTarget, flightTime, false);

    // Mortar tube launch thump + backblast plume.
    fx?.smoke?.(_origin, 0xc8ccd2, 1.4, 1.3);
    fx?.sparks?.(_origin, UP, 14, '#ffbb55');
    fx?.ring?.(_origin, UP, '#ffaa44', 1.8);
    render?.lights?.flash?.(_origin, 0xffaa44, 6, 8, 0.08);
    audio?.play?.('mgl_shot', { position: _origin, volume: 1.15, pitch: 0.62 });
    audio?.play?.('quiver_fire', { position: _origin, volume: 0.5, pitch: 0.72 });
    camera?.addTrauma?.(0.08);

    u.onNews?.('mortar', [roundIdx, this.lastTarget.x, this.lastTarget.y, this.lastTarget.z, flightTime]);
  }
}

export const MORTAR_PLUGIN: ShoulderPlugin = {
  kind: 'mortar',
  newsKinds: ['mortar'],
  create: ctx => new MortarShoulder(ctx),
  remoteNews(ctx, _kind, values): void {
    if (values.length < 5) return;
    const roundIdx = clamp(Math.round(values[0]!), 0, MORTAR_ROUNDS.length - 1);
    _target.set(values[1]!, values[2]!, values[3]!);
    const flightTime = clamp(values[4]!, 0.4, 5.0);
    if (values.length >= 8) {
      _origin.set(values[5]!, values[6]!, values[7]!);
    } else {
      // Derive an indirect-fire launch point when only target + flightTime were transmitted.
      _origin.set(_target.x, _target.y + 10, _target.z + 35);
    }
    ctx.audio?.play?.('mgl_shot', { position: _origin, volume: 0.9, pitch: 0.62 });
    mortarFieldOf(ctx).launch(roundIdx, _origin, _target, flightTime, true);
  },
};
