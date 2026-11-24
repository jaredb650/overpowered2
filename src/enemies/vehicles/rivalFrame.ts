/**
 * Harbourmaster's NPC-Controlled Heavy Mech Boss (`RivalFrame`):
 *
 * After Old Mother explodes on the Salt Flats, the Harbourmaster bursts out piloting her own ~6.2 m
 * Holdfast-livery Ironclad Frame for a Mech-vs-Mech boss duel.
 *
 *   - Visuals:   Salt-crusted dark teal armor plates, oxidized brass/gold shoulder pauldrons, weathered rust
 *                hazards, glowing crimson cockpit visor, articulated walking legs, independent torso yaw,
 *                left-arm spinning 6-barrel rotary gun, right-arm heavy cannon, dorsal 4-tube missile pod,
 *                and twin dorsal jump-jet exhaust nozzles.
 *   - Combat AI: Circles & strafes at 22–55 m inside `PANS` bounds with 4 telegraphed attacks:
 *                  1. Left-Arm Rotary Bursts (spin-up whine + sweeping tracer burst)
 *                  2. Right-Arm Heavy Cannon (0.75 s amber muzzle/laser telegraph + predicted explosive shell)
 *                  3. Shoulder Micro-Missile Salvo (4 arching smoke-trailed missiles every ~12 s)
 *                  4. Jump-Jet Reposition & Stomp (18–25 m jet arc + shockwave landing stomp)
 *   - Defeat:    At 0 HP the canopy blows off, the Frame slumps into a smoking hollowed-out kneeling wreck,
 *                and an animated rocket-trailed pilot capsule blasts 22 m skyward and lands ~16 m away on
 *                the Salt Flats (~1.8 s), signaling `'harbour:ejected'` and invoking `onEjected(pos)`.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ctx, ExplosionKind, LoopHandle } from '../../core/contracts';
import type { ExplosionSpec, MissileTarget } from '../../core/gameplay';
import { clamp, damp, dampAngle, rand, wrapAngle } from '../../core/math';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import { EXPLOSIONS } from '../../weapons/data';
import { PANS } from '../../world/map/holdfast/plan';
import type { ExtraTarget, VehicleSystem } from './index';

export type RivalFramePhase = 'idle' | 'launching' | 'active' | 'ejecting' | 'wrecked';
export type RivalAttackKind = 'none' | 'rotary' | 'cannon' | 'missile' | 'jump';
export type RivalHitZoneId = 'torso' | 'cockpit' | 'legs';

export const RIVAL_FRAME = {
  label: 'HARBOURMASTER // IRONCLAD FRAME',
  maxHealth: 4500,
  height: 6.2,
  walkSpeed: 10.5,
  strafeSpeed: 8.5,
  preferredMin: 22,
  preferredMax: 55,
  torsoTurnRate: 4.5,
  legTurnRate: 3.4,
  // Left-Arm Rotary Bursts
  rotaryCooldown: 5.5,
  rotaryWindup: 0.65,
  rotaryDuration: 1.45,
  rotaryRate: 0.095,
  rotarySpeed: 118,
  rotaryDamage: 22,
  // Right-Arm Heavy Cannon
  cannonCooldown: 7.0,
  cannonWindup: 0.75,
  cannonSpeed: 72,
  cannonDamage: 145,
  cannonRadius: 6.5,
  // Shoulder Micro-Missile Salvo
  missileCooldown: 12.0,
  missileWindup: 0.5,
  missileCount: 4,
  missileSpeed: 30,
  missileDamage: 95,
  missileRadius: 5.5,
  // Jump-Jet Reposition & Stomp
  jumpCooldown: 14.0,
  jumpWindup: 0.4,
  jumpDuration: 1.25,
  jumpHeight: 10.5,
  jumpDistMin: 18,
  jumpDistMax: 25,
  stompRadius: 11,
  stompDamage: 110,
  // Dramatic Jump-Jet Launch Out of Old Mother's Wreck
  launchDuration: 1.45,
  launchPeakHeight: 16.0,
  launchDistMin: 24,
  launchDistMax: 32,
  // Stagger & Emergency Eject
  staggerDuration: 0.65,
  staggerThreshold: 220,
  ejectDuration: 1.8,
  ejectPeakHeight: 22,
  ejectLandingDist: 16,
} as const;

const PANS_MIN_X = PANS.x0 + 10;
const PANS_MAX_X = PANS.x1 - 10;
const PANS_MIN_Z = PANS.z0 + 10;
const PANS_MAX_Z = PANS.z1 - 10;

// Holdfast Harbourmaster Ironclad Livery palette
const TEAL_DARK = '#163842';
const TEAL_ARMOR = '#1f4e5c';
const TEAL_LIGHT = '#2a6675';
const BRASS_GOLD = '#c49638';
const BRASS_DARK = '#7c5d22';
const RUST_HAZARD = '#943c20';
const IRON_DARK = '#24282d';
const STEEL_MID = '#3c434a';
const VISOR_RED = '#ff2820';
const REACTOR_AMBER = '#ff9428';

function chamferBox(w: number, h: number, d: number, bevel = 0.09): THREE.BufferGeometry {
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
    depth: Math.max(0.03, d - b * 2),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
  });
  geo.center();
  return geo;
}

interface HitZone {
  readonly id: RivalHitZoneId;
  readonly local: readonly [number, number, number];
  readonly half: readonly [number, number, number];
  readonly mult: number;
  readonly collider: RAPIER.Collider;
  readonly center: THREE.Vector3;
}

const ZONE_SPECS: readonly { id: RivalHitZoneId; local: readonly [number, number, number]; half: readonly [number, number, number]; mult: number }[] = [
  { id: 'torso', local: [0, 3.85, 0], half: [1.55, 1.35, 1.45], mult: 1.0 },
  { id: 'cockpit', local: [0, 4.25, 1.15], half: [0.95, 0.72, 0.85], mult: 1.35 },
  { id: 'legs', local: [0, 1.35, 0], half: [1.5, 1.35, 1.25], mult: 0.9 },
];

const _p = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);

export class RivalFrame implements ExtraTarget {
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly ejectLandingPoint = new THREE.Vector3();
  onEjected?: (pos: THREE.Vector3) => void;

  phase: RivalFramePhase = 'idle';
  health: number = RIVAL_FRAME.maxHealth;
  readonly maxHealth: number = RIVAL_FRAME.maxHealth;
  legYaw = 0;
  torsoYaw = 0;
  attack: RivalAttackKind = 'none';
  staggerLeft = 0;

  private readonly materials: ModelMaterials;
  private readonly zones: HitZone[] = [];
  private readonly byHandle = new Map<number, HitZone>();
  private readonly highlightList: THREE.Object3D[] = [];
  private readonly paintCenter = new THREE.Vector3();
  private readonly paintTarget: MissileTarget;

  // Articulated rig groups
  private pelvis!: THREE.Group;
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  private shinL!: THREE.Group;
  private shinR!: THREE.Group;
  private torso!: THREE.Group;
  private canopy!: THREE.Group;
  private armL!: THREE.Group;
  private rotaryBarrels!: THREE.Group;
  private armR!: THREE.Group;
  private cannonBarrel!: THREE.Group;
  private cannonGlow!: THREE.Mesh;
  private missilePod!: THREE.Group;
  private jetFlames!: THREE.Group;
  private jetLight!: THREE.PointLight;
  private ejectPod!: THREE.Group;

  // AI movement & attack timers
  private strafeDir = 1;
  private strafeFlipIn = 4.5;
  private stridePhase = 0;
  private lastStepIndex = 0;
  private rotaryCooldown = 2.6;
  private cannonCooldown = 4.2;
  private missileCooldown = 8.5;
  private jumpCooldown = 11.0;

  // Active attack state
  private attackClock = 0;
  private rotaryShotIn = 0;
  private rotarySpin = 0;
  private cannonRecoil = 0;
  private cannonAim = new THREE.Vector3();
  private jumpStart = new THREE.Vector3();
  private jumpEnd = new THREE.Vector3();
  private jumpInAir = false;

  // Launch-out-of-wreck state
  private launchStart = new THREE.Vector3();
  private launchEnd = new THREE.Vector3();
  private launchFacingYaw = 0;
  private launchElapsed = 0;
  private launchTrailIn = 0;
  private jetLoop: LoopHandle | null = null;

  // Emergency eject state
  private ejectStart = new THREE.Vector3();
  private ejectElapsed = 0;
  private ejectTrailIn = 0;
  private wreckSmokeIn = 0;
  private hudUnmark: (() => void) | null = null;

  constructor(private readonly ctx: Ctx, private readonly vehicles: VehicleSystem | null) {
    this.materials = new ModelMaterials(ctx);
    this.buildModel();
    this.root.visible = false;
    ctx.render.scene.add(this.root);

    this.ejectPod.visible = false;
    ctx.render.scene.add(this.ejectPod);

    for (const spec of ZONE_SPECS) {
      const center = new THREE.Vector3();
      const collider = ctx.physics.addStaticBox(new THREE.Vector3(0, -1000, 0), new THREE.Vector3(...spec.half), null, 'metal');
      const zone: HitZone = {
        id: spec.id,
        local: spec.local,
        half: spec.half,
        mult: spec.mult,
        collider,
        center,
      };
      this.zones.push(zone);
      this.byHandle.set(collider.handle, zone);
    }

    const self = this;
    this.paintTarget = {
      center: this.paintCenter,
      get alive() {
        return self.alive;
      },
      aimLift: 0.4,
      paintRadius: 2.8,
    };

    this.vehicles?.addExtra(this);
  }

  /** True while spawned and fighting with HP > 0. */
  get alive(): boolean {
    return this.phase === 'active' && this.health > 0;
  }

  /** True while deployed on the Salt Flats (launching, fighting, ejecting, or kneeling wreck). */
  get active(): boolean {
    return this.phase !== 'idle';
  }

  barFraction(): number {
    return this.phase === 'active' || this.phase === 'launching' ? clamp(this.health / this.maxHealth) : 0;
  }

  barLabel(): string {
    return RIVAL_FRAME.label;
  }

  /** Spawns the Harbourmaster's Ironclad Frame onto the Salt Flats ready for Mech-vs-Mech combat. */
  spawn(pos: THREE.Vector3, yaw = 0): void {
    this.stopJetLoop();
    this.position.set(clamp(pos.x, PANS_MIN_X, PANS_MAX_X), 0, clamp(pos.z, PANS_MIN_Z, PANS_MAX_Z));
    this.legYaw = yaw;
    this.torsoYaw = yaw;
    this.health = this.maxHealth;
    this.phase = 'active';
    this.attack = 'none';
    this.attackClock = 0;
    this.staggerLeft = 0;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeFlipIn = rand(3.5, 6.0);
    this.stridePhase = 0;
    this.lastStepIndex = 0;
    this.rotaryCooldown = 2.4;
    this.cannonCooldown = 4.2;
    this.missileCooldown = 9.0;
    this.jumpCooldown = 11.5;
    this.rotarySpin = 0;
    this.cannonRecoil = 0;
    this.jumpInAir = false;
    this.ejectElapsed = 0;

    this.root.visible = true;
    this.canopy.visible = true;
    this.cannonGlow.visible = false;
    this.jetFlames.visible = false;
    this.jetFlames.scale.set(1, 1, 1);
    this.jetLight.intensity = 0;
    this.ejectPod.visible = false;
    this.resetPose();
    this.syncWorld();

    this.hudUnmark?.();
    this.hudUnmark = this.ctx.hud.follow(this.paintCenter, 'HARBOURMASTER FRAME', '#ff3b30');
    this.ctx.fx.slam(this.position, 2.8);
    this.ctx.fx.dust(this.position, _up, 2.5);
    this.ctx.audio.play('titan_stomp', { position: this.position, pitch: 0.85, volume: 0.95 });
    this.ctx.hud.feed('HARBOURMASTER DEPLOYED — IRONCLAD FRAME ENGAGED!', '#ff5a30');
  }

  /**
   * Launches the Harbourmaster's Ironclad Frame on full jump-jets directly out of Old Mother's
   * exploding hull along a dramatic parabolic arc (~16 m apex, ~1.45 s) to a clear Salt Flats
   * landing spot, slamming down and immediately transitioning into active Mech-vs-Mech combat.
   */
  launchFromWreck(origin: THREE.Vector3, landAt: THREE.Vector3, facingYaw = 0): void {
    const { audio, camera, fx, hud, render } = this.ctx;
    this.stopJetLoop();

    this.launchStart.set(origin.x, Math.max(origin.y, 4.5), origin.z);
    this.launchEnd.set(clamp(landAt.x, PANS_MIN_X, PANS_MAX_X), 0, clamp(landAt.z, PANS_MIN_Z, PANS_MAX_Z));
    this.launchFacingYaw = facingYaw;
    this.launchElapsed = 0;
    this.launchTrailIn = 0;

    const travelYaw = Math.atan2(this.launchEnd.x - this.launchStart.x, this.launchEnd.z - this.launchStart.z);
    this.position.copy(this.launchStart);
    this.legYaw = travelYaw;
    this.torsoYaw = facingYaw;
    this.health = this.maxHealth;
    this.phase = 'launching';
    this.attack = 'none';
    this.attackClock = 0;
    this.staggerLeft = 0;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeFlipIn = rand(3.5, 6.0);
    this.stridePhase = 0;
    this.lastStepIndex = 0;
    this.rotaryCooldown = 1.6;
    this.cannonCooldown = 3.2;
    this.missileCooldown = 7.5;
    this.jumpCooldown = 10.0;
    this.rotarySpin = 0;
    this.cannonRecoil = 0;
    this.jumpInAir = false;
    this.ejectElapsed = 0;

    this.root.visible = true;
    this.canopy.visible = true;
    this.cannonGlow.visible = false;
    this.ejectPod.visible = false;
    this.jetFlames.visible = true;
    this.jetFlames.scale.set(1.45, 1.85, 1.45);
    this.jetLight.intensity = 42;
    this.applyLaunchPose(0);
    this.parkColliders();
    this.syncWorld();

    this.hudUnmark?.();
    this.hudUnmark = hud.follow(this.paintCenter, 'HARBOURMASTER FRAME', '#ff3b30');

    fx.explosion(this.launchStart, { radius: 6.5, kind: 'rocket', scale: 1.6 });
    fx.smoke(this.launchStart, 0xffb868, 3.4, 2.2);
    fx.embers(this.launchStart, 36, 4.5);
    render.lights.flash(this.launchStart, 0xff8c28, 38, 72, 0.55);
    audio.play('flame_ignite', { position: this.launchStart, pitch: 0.78, volume: 1 });
    audio.play('steam_burst', { position: this.launchStart, pitch: 0.72, volume: 0.95 });
    audio.play('rocket_fire', { position: this.launchStart, pitch: 0.85, volume: 0.95 });
    this.jetLoop = audio.startLoop('flame_loop', { fadeIn: 0.05, pitch: 0.62, volume: 0.95, position: this.position });
    camera.addTrauma(0.55);
    hud.feed('HARBOURMASTER LAUNCHING FROM OLD MOTHER — IRONCLAD FRAME INBOUND!', '#ff5a30');
  }

  /** Hides and resets the RivalFrame completely. */
  hide(): void {
    this.stopJetLoop();
    this.phase = 'idle';
    this.health = this.maxHealth;
    this.attack = 'none';
    this.staggerLeft = 0;
    this.jumpInAir = false;
    this.root.visible = false;
    this.ejectPod.visible = false;
    this.jetFlames.visible = false;
    this.jetFlames.scale.set(1, 1, 1);
    this.jetLight.intensity = 0;
    this.cannonGlow.visible = false;
    this.hudUnmark?.();
    this.hudUnmark = null;
    this.parkColliders();
  }

  /** Exposes zone collider for tests or inspection. */
  colliderFor(id: RivalHitZoneId): RAPIER.Collider | null {
    return this.zones.find(z => z.id === id)?.collider ?? null;
  }

  update(dt: number): void {
    if (this.phase === 'idle') return;

    if (this.phase === 'launching') {
      this.updateLaunch(dt);
      return;
    }

    if (this.phase === 'ejecting') {
      this.updateEject(dt);
      this.emitWreckSmoke(dt, 0.16);
      return;
    }

    if (this.phase === 'wrecked') {
      this.emitWreckSmoke(dt, 0.35);
      return;
    }

    // Active combat AI
    const { player } = this.ctx;
    this.rotaryCooldown = Math.max(0, this.rotaryCooldown - dt);
    this.cannonCooldown = Math.max(0, this.cannonCooldown - dt);
    this.missileCooldown = Math.max(0, this.missileCooldown - dt);
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    this.cannonRecoil = damp(this.cannonRecoil, 0, 9, dt);
    this.cannonBarrel.position.z = -this.cannonRecoil * 0.65;

    // Spin rotary barrels smoothly
    const wantSpin = this.attack === 'rotary' ? 28 : 0;
    this.rotarySpin = damp(this.rotarySpin, wantSpin, 6, dt);
    if (this.rotarySpin > 0.05) this.rotaryBarrels.rotation.z += this.rotarySpin * dt;

    // Aim torso smoothly toward the player
    const toPlayerX = player.position.x - this.position.x;
    const toPlayerZ = player.position.z - this.position.z;
    const dist = Math.hypot(toPlayerX, toPlayerZ);
    const wantTorsoYaw = Math.atan2(toPlayerX, toPlayerZ);
    this.torsoYaw = dampAngle(this.torsoYaw, wantTorsoYaw, RIVAL_FRAME.torsoTurnRate, dt);

    // Handle stagger from heavy hits (e.g. 105mm Howitzer)
    if (this.staggerLeft > 0) {
      this.staggerLeft = Math.max(0, this.staggerLeft - dt);
      const frac = this.staggerLeft / RIVAL_FRAME.staggerDuration;
      this.torso.rotation.x = -0.34 * Math.sin(frac * Math.PI);
      this.cannonGlow.visible = false;
      this.jetFlames.visible = false;
      this.syncWorld();
      return;
    }
    this.torso.rotation.x = damp(this.torso.rotation.x, 0, 8, dt);

    // Execute active attack or choose next one
    if (this.attack === 'jump') {
      this.updateJumpAttack(dt);
    } else {
      this.updateLocomotion(dt, toPlayerX, toPlayerZ, dist);
      if (this.attack === 'rotary') {
        this.updateRotaryAttack(dt);
      } else if (this.attack === 'cannon') {
        this.updateCannonAttack(dt);
      } else if (this.attack === 'missile') {
        this.updateMissileAttack(dt);
      } else if (player.alive) {
        this.chooseAttack(dist);
      }
    }

    this.syncWorld();
  }

  private updateLocomotion(dt: number, toPlayerX: number, toPlayerZ: number, dist: number): void {
    this.strafeFlipIn -= dt;
    if (this.strafeFlipIn <= 0) {
      this.strafeFlipIn = rand(3.2, 6.2);
      this.strafeDir = -this.strafeDir;
    }

    const invD = dist > 0.001 ? 1 / dist : 0;
    const fwdX = toPlayerX * invD;
    const fwdZ = toPlayerZ * invD;
    const rightX = -fwdZ * this.strafeDir;
    const rightZ = fwdX * this.strafeDir;

    // Maintain sweet-spot 22–55 m range while circling/strafing smoothly.
    let moveX = rightX * RIVAL_FRAME.strafeSpeed;
    let moveZ = rightZ * RIVAL_FRAME.strafeSpeed;
    if (dist > RIVAL_FRAME.preferredMax) {
      moveX += fwdX * RIVAL_FRAME.walkSpeed;
      moveZ += fwdZ * RIVAL_FRAME.walkSpeed;
    } else if (dist < RIVAL_FRAME.preferredMin) {
      moveX -= fwdX * (RIVAL_FRAME.walkSpeed * 0.8);
      moveZ -= fwdZ * (RIVAL_FRAME.walkSpeed * 0.8);
    }

    // Slow slightly while firing heavy weapons so legs feel planted & weighty.
    const speedScale = this.attack === 'cannon' ? 0.35 : this.attack === 'rotary' ? 0.65 : 1.0;
    moveX *= speedScale;
    moveZ *= speedScale;

    const prevX = this.position.x;
    const prevZ = this.position.z;
    this.position.x = clamp(this.position.x + moveX * dt, PANS_MIN_X, PANS_MAX_X);
    this.position.z = clamp(this.position.z + moveZ * dt, PANS_MIN_Z, PANS_MAX_Z);

    const moved = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    const actualSpeed = dt > 0 ? moved / dt : 0;

    if (actualSpeed > 0.6) {
      const moveYaw = Math.atan2(this.position.x - prevX, this.position.z - prevZ);
      this.legYaw = dampAngle(this.legYaw, moveYaw, RIVAL_FRAME.legTurnRate, dt);
      this.stridePhase += moved * 0.42;
      const swing = Math.sin(this.stridePhase);
      this.legL.rotation.x = swing * 0.46;
      this.legR.rotation.x = -swing * 0.46;
      this.shinL.rotation.x = Math.max(0, -swing) * 0.42;
      this.shinR.rotation.x = Math.max(0, swing) * 0.42;
      this.pelvis.position.y = 2.55 + Math.abs(Math.cos(this.stridePhase)) * 0.16;

      // Footfall dust & heavy mech thud on every half-cycle.
      const stepIdx = Math.floor(this.stridePhase / Math.PI);
      if (stepIdx !== this.lastStepIndex) {
        this.lastStepIndex = stepIdx;
        this.ctx.fx.dust(this.position, _up, 1.15);
        this.ctx.audio.play('titan_stomp', { position: this.position, pitch: 1.35 + rand(-0.08, 0.08), volume: 0.32 });
      }
    } else {
      this.legYaw = dampAngle(this.legYaw, this.torsoYaw, 2.2, dt);
      this.legL.rotation.x = damp(this.legL.rotation.x, 0, 8, dt);
      this.legR.rotation.x = damp(this.legR.rotation.x, 0, 8, dt);
      this.shinL.rotation.x = damp(this.shinL.rotation.x, 0, 8, dt);
      this.shinR.rotation.x = damp(this.shinR.rotation.x, 0, 8, dt);
      this.pelvis.position.y = damp(this.pelvis.position.y, 2.55, 8, dt);
    }
  }

  private chooseAttack(dist: number): void {
    // Priority 1: Jump-jet reposition & stomp if off cooldown (sooner if player rushes inside 18 m).
    if (this.jumpCooldown <= 0 && (dist < 18 || dist > 62 || Math.random() < 0.35)) {
      this.startJumpAttack();
      return;
    }
    // Priority 2: Shoulder micro-missile salvo every ~12 s.
    if (this.missileCooldown <= 0 && dist < 135) {
      this.attack = 'missile';
      this.attackClock = 0;
      this.ctx.audio.play('missile_incoming', { volume: 0.6 });
      this.ctx.hud.feed('HARBOURMASTER — MICRO-MISSILE SALVO · POP SMOKE OR DASH!', '#ff6a28');
      return;
    }
    // Priority 3: Right-Arm Heavy Cannon (telegraphed).
    if (this.cannonCooldown <= 0 && dist < 140) {
      this.attack = 'cannon';
      this.attackClock = 0;
      this.cannonGlow.visible = true;
      this.ctx.audio.play('sniper_charge', { position: this.muzzleWorld(true, _p), pitch: 0.72, volume: 0.9 });
      this.ctx.hud.feed('HARBOURMASTER — HEAVY CANNON LOCKING!', '#ffae33');
      return;
    }
    // Priority 4: Left-Arm Rotary Bursts.
    if (this.rotaryCooldown <= 0 && dist < 115) {
      this.attack = 'rotary';
      this.attackClock = 0;
      this.rotaryShotIn = 0;
      this.ctx.audio.play('minigun_spinup', { position: this.muzzleWorld(false, _p), pitch: 0.88, volume: 0.85 });
    }
  }

  private updateRotaryAttack(dt: number): void {
    this.attackClock += dt;
    if (this.attackClock < RIVAL_FRAME.rotaryWindup) return;

    if (this.attackClock >= RIVAL_FRAME.rotaryWindup + RIVAL_FRAME.rotaryDuration) {
      this.attack = 'none';
      this.rotaryCooldown = RIVAL_FRAME.rotaryCooldown + rand(-0.6, 0.8);
      this.ctx.audio.play('minigun_spindown', { position: this.muzzleWorld(false, _p), pitch: 0.9, volume: 0.5 });
      return;
    }

    this.rotaryShotIn -= dt;
    if (this.rotaryShotIn > 0) return;
    this.rotaryShotIn = RIVAL_FRAME.rotaryRate;

    const { combat, fx, audio, player } = this.ctx;
    const muzzle = this.muzzleWorld(false, _p);
    // Slight horizontal sweeping spread so strafing/dashing dodges the stream cleanly.
    const sweep = Math.sin((this.attackClock - RIVAL_FRAME.rotaryWindup) * 5.2) * 2.2;
    _p2.copy(player.eye);
    _p2.x += Math.cos(this.torsoYaw) * sweep + rand(-1.3, 1.3);
    _p2.y = Math.max(0.6, _p2.y + rand(-0.8, 0.9));
    _p2.z -= Math.sin(this.torsoYaw) * sweep + rand(-1.3, 1.3);

    _dir.subVectors(_p2, muzzle).normalize();
    fx.muzzleFlash(muzzle, _dir, 'rotary');
    audio.play('cannon_burst', { position: muzzle, pitch: 1.25 + rand(-0.08, 0.08), volume: 0.55 });
    combat.spawnProjectile({
      origin: muzzle.clone(),
      velocity: _dir.clone().multiplyScalar(RIVAL_FRAME.rotarySpeed),
      kind: 'bullet',
      team: 'enemy',
      damage: RIVAL_FRAME.rotaryDamage,
      source: 'rival_rotary',
      tracer: 'heavy',
      lifetime: 1.4,
    });
  }

  private updateCannonAttack(dt: number): void {
    const { audio, combat, fx, player, render } = this.ctx;
    this.attackClock += dt;
    const muzzle = this.muzzleWorld(true, _p);

    // Lead player's movement during telegraph, locking aim for the final 0.15 s so dashing escapes!
    if (this.attackClock < RIVAL_FRAME.cannonWindup - 0.15) {
      const dist = muzzle.distanceTo(player.eye);
      const flight = clamp(dist / RIVAL_FRAME.cannonSpeed, 0.1, 1.2);
      this.cannonAim.set(
        player.eye.x + player.velocity.x * flight * 0.65,
        Math.max(0.8, player.eye.y + player.velocity.y * flight * 0.25),
        player.eye.z + player.velocity.z * flight * 0.65,
      );
    }

    const pulse = 0.8 + (this.attackClock / RIVAL_FRAME.cannonWindup) * 1.1;
    this.cannonGlow.visible = true;
    this.cannonGlow.scale.setScalar(pulse);
    fx.beam(muzzle, this.cannonAim, 'laser', 0.09, 0.08);

    if (this.attackClock >= RIVAL_FRAME.cannonWindup) {
      this.cannonGlow.visible = false;
      this.cannonRecoil = 1.0;
      _dir.subVectors(this.cannonAim, muzzle).normalize();
      _dir.y += 0.03;
      _dir.normalize();

      fx.muzzleFlash(muzzle, _dir, 'autocannon');
      fx.smoke(muzzle, 0xd8c8a8, 1.8, 1.2);
      render.lights.flash(muzzle, 0xffa030, 18, 28, 0.18);
      audio.play('tank_cannon', { position: muzzle, pitch: 0.96, volume: 0.95 });

      combat.spawnProjectile({
        origin: muzzle.clone(),
        velocity: _dir.clone().multiplyScalar(RIVAL_FRAME.cannonSpeed),
        kind: 'rocket',
        team: 'enemy',
        damage: RIVAL_FRAME.cannonDamage,
        source: 'rival_cannon',
        gravity: 3.5,
        lifetime: 3.5,
        trail: 'smoke',
        tracer: 'heavy',
        explosion: { radius: RIVAL_FRAME.cannonRadius, damage: RIVAL_FRAME.cannonDamage, kind: 'shell', scale: 1.45 },
      });

      this.attack = 'none';
      this.cannonCooldown = RIVAL_FRAME.cannonCooldown + rand(-0.7, 0.9);
    }
  }

  private updateMissileAttack(dt: number): void {
    this.attackClock += dt;
    if (this.attackClock < RIVAL_FRAME.missileWindup) return;

    const { audio, combat, fx, player } = this.ctx;
    const podWorld = this.localTorsoToWorld(1.25, 5.85, -0.15, _p);
    audio.play('enemy_rocket_fire', { position: podWorld, pitch: 1.08, volume: 0.95 });
    fx.muzzleFlash(podWorld, _up, 'rocket');
    fx.smoke(podWorld, 0xd6d8dc, 2.2, 2.0);

    for (let i = 0; i < RIVAL_FRAME.missileCount; i++) {
      const fan = (i - (RIVAL_FRAME.missileCount - 1) * 0.5) * 0.24;
      _dir.subVectors(player.eye, podWorld).normalize();
      _dir.applyAxisAngle(_up, fan);
      _dir.y = clamp(_dir.y + 0.42 + (i % 2) * 0.1, 0.2, 0.8);
      _dir.normalize();

      combat.spawnProjectile({
        origin: podWorld.clone().add(_p2.set((i - 1.5) * 0.35, 0.25, 0)),
        velocity: _dir.clone().multiplyScalar(RIVAL_FRAME.missileSpeed),
        kind: 'rocket',
        team: 'enemy',
        damage: RIVAL_FRAME.missileDamage,
        source: 'rival_missile',
        gravity: 3.0,
        homing: 1.45,
        steerDelay: 0.35,
        lifetime: 5.5,
        trail: 'smoke',
        tracer: 'heavy',
        explosion: { radius: RIVAL_FRAME.missileRadius, damage: RIVAL_FRAME.missileDamage, kind: 'rocket', scale: 1.05 },
      });
    }

    this.attack = 'none';
    this.missileCooldown = RIVAL_FRAME.missileCooldown + rand(-1.0, 1.4);
  }

  private startJumpAttack(): void {
    const { audio, hud, player } = this.ctx;
    this.attack = 'jump';
    this.attackClock = 0;
    this.jumpInAir = false;
    this.jumpStart.copy(this.position);

    // Pick a fresh flanking angle 18–25 m away, clamped cleanly inside PANS bounds.
    const baseAngle = Math.atan2(this.position.z - player.position.z, this.position.x - player.position.x);
    const sideAngle = baseAngle + (Math.random() < 0.5 ? 1 : -1) * rand(0.7, 1.35);
    const hopDist = rand(RIVAL_FRAME.jumpDistMin, RIVAL_FRAME.jumpDistMax);
    let tx = this.position.x + Math.cos(sideAngle) * hopDist;
    let tz = this.position.z + Math.sin(sideAngle) * hopDist;
    if (tx < PANS_MIN_X || tx > PANS_MAX_X || tz < PANS_MIN_Z || tz > PANS_MAX_Z) {
      // Bounce toward arena center if near edge.
      const toCenter = Math.atan2(PANS.loop.z - this.position.z, PANS.loop.x - this.position.x);
      tx = this.position.x + Math.cos(toCenter) * hopDist;
      tz = this.position.z + Math.sin(toCenter) * hopDist;
    }
    this.jumpEnd.set(clamp(tx, PANS_MIN_X, PANS_MAX_X), 0, clamp(tz, PANS_MIN_Z, PANS_MAX_Z));

    audio.play('steam_burst', { position: this.position, pitch: 0.85, volume: 0.85 });
    hud.feed('HARBOURMASTER — JUMP-JET LEAP!', '#ffae33');
  }

  private updateJumpAttack(dt: number): void {
    const { audio, camera, fx, player } = this.ctx;
    this.attackClock += dt;

    if (this.attackClock < RIVAL_FRAME.jumpWindup) {
      // Crouch telegraph before blastoff.
      const c = this.attackClock / RIVAL_FRAME.jumpWindup;
      this.pelvis.position.y = 2.55 - c * 0.45;
      this.legL.rotation.x = -0.35 * c;
      this.legR.rotation.x = -0.35 * c;
      this.shinL.rotation.x = 0.65 * c;
      this.shinR.rotation.x = 0.65 * c;
      return;
    }

    if (!this.jumpInAir) {
      this.jumpInAir = true;
      this.jetFlames.visible = true;
      audio.play('titan_charge', { position: this.position, pitch: 1.15, volume: 0.9 });
      fx.dust(this.position, _up, 2.4);
      fx.smoke(this.position, 0xd8dce0, 2.8, 1.6);
    }

    const airElapsed = this.attackClock - RIVAL_FRAME.jumpWindup;
    const t = clamp(airElapsed / RIVAL_FRAME.jumpDuration);
    this.position.lerpVectors(this.jumpStart, this.jumpEnd, t);
    this.position.y = 4 * RIVAL_FRAME.jumpHeight * t * (1 - t);
    this.legYaw = dampAngle(this.legYaw, Math.atan2(this.jumpEnd.x - this.jumpStart.x, this.jumpEnd.z - this.jumpStart.z), 6, dt);

    // Airborne pose + thruster flames
    this.pelvis.position.y = 2.55;
    this.legL.rotation.x = -0.22;
    this.legR.rotation.x = 0.28;
    this.shinL.rotation.x = 0.45;
    this.shinR.rotation.x = 0.25;
    this.jetFlames.scale.set(1, 0.85 + Math.sin(this.ctx.time.elapsed * 36) * 0.25, 1);

    const nozzlePos = this.localTorsoToWorld(0, 3.2, -1.4, _p);
    fx.smoke(nozzlePos, 0xe8e4dc, 1.6, 1.1);
    fx.embers(nozzlePos, 4, 1.0);

    if (t >= 1) {
      // Heavy shockwave stomp landing!
      this.position.copy(this.jumpEnd);
      this.position.y = 0;
      this.jetFlames.visible = false;
      this.jumpInAir = false;
      this.attack = 'none';
      this.jumpCooldown = RIVAL_FRAME.jumpCooldown + rand(-1.5, 2.0);
      this.resetPose();

      fx.slam(this.position, 3.0);
      fx.dust(this.position, _up, 3.2);
      fx.chips(this.position, 0xd8c8a0, 24);
      fx.ring(this.position, _up, '#ffc46a', RIVAL_FRAME.stompRadius);
      audio.play('titan_stomp', { position: this.position, pitch: 0.82, volume: 1 });
      audio.play('explosion_debris', { position: this.position, volume: 0.75 });

      const d = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
      if (player.alive && d <= RIVAL_FRAME.stompRadius) {
        const falloff = clamp(1 - d / (RIVAL_FRAME.stompRadius + 2), 0.45, 1);
        player.takeDamage({ amount: RIVAL_FRAME.stompDamage * falloff, from: this.position, type: 'crush', source: 'rival_stomp' });
        _dir.set(player.position.x - this.position.x, 0.35, player.position.z - this.position.z).normalize().multiplyScalar(14);
        player.push(_dir);
        camera.addTrauma(0.75);
      } else if (d < 35) {
        camera.addTrauma(0.35 * (1 - d / 35));
      }
    }
  }

  // ---- Dramatic Launch Out of Old Mother's Wreck -----------------------------------------------------------------

  private updateLaunch(dt: number): void {
    const { audio, camera, fx, hud, player, render } = this.ctx;
    this.launchElapsed += dt;
    const t = clamp(this.launchElapsed / RIVAL_FRAME.launchDuration);

    // Parabolic jet-assisted arc: lifts cleanly to ~16 m apex above ground and never clips below terrain.
    const x = THREE.MathUtils.lerp(this.launchStart.x, this.launchEnd.x, t);
    const z = THREE.MathUtils.lerp(this.launchStart.z, this.launchEnd.z, t);
    const baseY = THREE.MathUtils.lerp(this.launchStart.y, 0, t);
    const peakExtra = Math.max(8, RIVAL_FRAME.launchPeakHeight - this.launchStart.y * 0.5);
    const arcY = 4 * peakExtra * t * (1 - t);
    this.position.set(x, Math.max(0, baseY + arcY), z);

    // Pivot mid-air toward the player so she slams down facing the duel head-on.
    const travelYaw = Math.atan2(this.launchEnd.x - this.launchStart.x, this.launchEnd.z - this.launchStart.z);
    const livePlayerYaw = Math.atan2(player.position.x - this.position.x, player.position.z - this.position.z);
    const desiredFacing = Number.isFinite(livePlayerYaw) ? livePlayerYaw : this.launchFacingYaw;
    if (t > 0.4) {
      this.legYaw = dampAngle(this.legYaw, this.launchFacingYaw, 7, dt);
    } else {
      this.legYaw = dampAngle(this.legYaw, travelYaw, 6, dt);
    }
    this.torsoYaw = dampAngle(this.torsoYaw, desiredFacing, 6.5, dt);

    // Dramatic airborne tucked/braced pose + blazing twin jump-jet flame cones & thruster light.
    this.applyLaunchPose(t);
    const flicker = Math.sin(this.ctx.time.elapsed * 44);
    const retroBoost = t > 0.72 ? 1.35 : 1.0;
    this.jetFlames.visible = true;
    this.jetFlames.scale.set(
      (1.3 + flicker * 0.14) * retroBoost,
      (1.75 + Math.cos(this.ctx.time.elapsed * 38) * 0.35) * retroBoost,
      (1.3 + flicker * 0.14) * retroBoost,
    );
    this.jetLight.intensity = (36 + flicker * 10) * retroBoost;
    this.jetLoop?.setPosition(this.position);

    // Heavy smoke, flame, and glowing ember exhaust trails behind twin jump-jets.
    this.launchTrailIn -= dt;
    if (this.launchTrailIn <= 0) {
      this.launchTrailIn = 0.035;
      for (const sx of [-0.62, 0.62]) {
        const nozzle = this.localTorsoToWorld(sx, 2.9, -1.68, _p);
        fx.smoke(nozzle, t < 0.65 ? 0xffb464 : 0xe4e0d8, 2.2, 1.7);
        fx.embers(nozzle, 7, 1.8);
        fx.flame?.(nozzle, _down, 1.35);
      }
    }

    this.syncWorld();

    if (t >= 1) {
      // Heavy cratering touchdown on the Salt Flats -> immediate Mech-vs-Mech combat!
      this.position.copy(this.launchEnd);
      this.position.y = 0;
      this.legYaw = this.launchFacingYaw;
      this.torsoYaw = this.launchFacingYaw;
      this.stopJetLoop();
      this.jetFlames.visible = false;
      this.jetFlames.scale.set(1, 1, 1);
      this.jetLight.intensity = 0;
      this.resetPose();
      this.phase = 'active';
      this.syncWorld();

      fx.slam(this.position, 4.0);
      fx.ring(this.position, _up, '#ffbc5e', 14);
      fx.dust(this.position, _up, 4.0);
      fx.chips(this.position, 0xd8c8a0, 32);
      fx.embers(this.position, 24, 3.2);
      render.lights.flash(this.position, 0xff9a38, 28, 52, 0.35);
      audio.play('titan_stomp', { position: this.position, pitch: 0.74, volume: 1 });
      audio.play('slam_impact', { position: this.position, pitch: 0.85, volume: 0.95 });
      audio.play('explosion_debris', { position: this.position, volume: 0.85 });
      camera.addTrauma(0.75);
      hud.feed('HARBOURMASTER IRONCLAD FRAME TOUCHDOWN — ENGAGE!', '#ff5a30');
    }
  }

  private applyLaunchPose(t: number): void {
    if (t < 0.68) {
      // Boost ascent & mid-air flight: forward-leaning chest, tucked legs, arms swept back.
      this.pelvis.position.y = 2.68;
      this.torso.rotation.x = 0.24;
      this.legL.rotation.x = -0.48;
      this.shinL.rotation.x = 0.92;
      this.legR.rotation.x = 0.24;
      this.shinR.rotation.x = 0.56;
      this.armL.rotation.x = -0.35;
      this.armR.rotation.x = -0.28;
    } else {
      // Retro-jet brace right before slamming onto the Salt Flats.
      const b = clamp((t - 0.68) / 0.32);
      this.pelvis.position.y = THREE.MathUtils.lerp(2.68, 2.15, b);
      this.torso.rotation.x = THREE.MathUtils.lerp(0.24, 0.14, b);
      this.legL.rotation.x = THREE.MathUtils.lerp(-0.48, -0.32, b);
      this.shinL.rotation.x = THREE.MathUtils.lerp(0.92, 0.62, b);
      this.legR.rotation.x = THREE.MathUtils.lerp(0.24, -0.26, b);
      this.shinR.rotation.x = THREE.MathUtils.lerp(0.56, 0.58, b);
      this.armL.rotation.x = THREE.MathUtils.lerp(-0.35, 0.12, b);
      this.armR.rotation.x = THREE.MathUtils.lerp(-0.28, 0.12, b);
    }
  }

  private stopJetLoop(): void {
    this.jetLoop?.stop(0.15);
    this.jetLoop = null;
  }

  // ---- Emergency Cockpit Eject -----------------------------------------------------------------------------------

  private triggerEject(): void {
    const { audio, camera, fx, hud, progression, render } = this.ctx;
    this.stopJetLoop();
    this.phase = 'ejecting';
    this.health = 0;
    this.attack = 'none';
    this.jumpInAir = false;
    this.position.y = 0;
    this.cannonGlow.visible = false;
    this.jetFlames.visible = false;
    this.jetFlames.scale.set(1, 1, 1);
    this.jetLight.intensity = 0;
    this.hudUnmark?.();
    this.hudUnmark = null;

    // Cascading sparks & reactor fire + explosive canopy bolt!
    const cockpitWorld = this.localTorsoToWorld(0, 4.4, 0.8, _p);
    fx.explosion(cockpitWorld, { radius: 8, kind: 'rocket', scale: 2.0 });
    fx.chips(cockpitWorld, 0xff9430, 52);
    fx.embers(cockpitWorld, 44, 5.0);
    render.lights.flash(cockpitWorld, 0xffa040, 34, 65, 0.65);
    audio.play('veh_destroyed', { position: this.position, volume: 1 });
    audio.play('plate_destroyed', { position: cockpitWorld, pitch: 0.85, volume: 1 });
    audio.play('rocket_fire', { position: cockpitWorld, pitch: 1.25, volume: 0.95 });
    camera.addTrauma(0.95);
    progression.award(1500, 'IRONCLAD FRAME', cockpitWorld);
    hud.feed('IRONCLAD FRAME CRITICAL — HARBOURMASTER EJECTING!', '#ffc14a');

    // Blow canopy off & pose the hollowed-out kneeling mech wreck.
    this.canopy.visible = false;
    this.applyKneelingWreckPose();
    this.parkColliders();

    // Compute safe Salt Flats landing spot ~16 m away (away from the wreck, clamped in PANS).
    const ejectAngle = this.torsoYaw + rand(-0.6, 0.6);
    let lx = this.position.x + Math.sin(ejectAngle) * RIVAL_FRAME.ejectLandingDist;
    let lz = this.position.z + Math.cos(ejectAngle) * RIVAL_FRAME.ejectLandingDist;
    if (lx < PANS_MIN_X || lx > PANS_MAX_X || lz < PANS_MIN_Z || lz > PANS_MAX_Z) {
      const toCenter = Math.atan2(PANS.loop.x - this.position.x, PANS.loop.z - this.position.z);
      lx = this.position.x + Math.sin(toCenter) * RIVAL_FRAME.ejectLandingDist;
      lz = this.position.z + Math.cos(toCenter) * RIVAL_FRAME.ejectLandingDist;
    }
    this.ejectLandingPoint.set(clamp(lx, PANS_MIN_X, PANS_MAX_X), 0, clamp(lz, PANS_MIN_Z, PANS_MAX_Z));

    this.ejectStart.copy(cockpitWorld);
    this.ejectElapsed = 0;
    this.ejectTrailIn = 0;
    this.ejectPod.position.copy(this.ejectStart);
    this.ejectPod.rotation.set(0, this.torsoYaw, 0);
    this.ejectPod.visible = true;
    this.syncWorld();
  }

  private updateEject(dt: number): void {
    this.ejectElapsed += dt;
    const t = clamp(this.ejectElapsed / RIVAL_FRAME.ejectDuration);

    // Parabolic rocket arc: shoots 22 m skyward then arcs down cleanly to ejectLandingPoint.
    const x = THREE.MathUtils.lerp(this.ejectStart.x, this.ejectLandingPoint.x, t);
    const z = THREE.MathUtils.lerp(this.ejectStart.z, this.ejectLandingPoint.z, t);
    const baseY = THREE.MathUtils.lerp(this.ejectStart.y, this.ejectLandingPoint.y + 0.6, t);
    const arcY = 4 * RIVAL_FRAME.ejectPeakHeight * t * (1 - t);
    this.ejectPod.position.set(x, baseY + arcY, z);
    this.ejectPod.rotation.x = (t - 0.35) * 0.9;
    this.ejectPod.rotation.y += 1.6 * dt;

    // Bright white rocket trail during ascent & mid-flight.
    this.ejectTrailIn -= dt;
    if (this.ejectTrailIn <= 0) {
      this.ejectTrailIn = 0.04;
      this.ctx.fx.smoke(this.ejectPod.position, 0xf2f4f8, t < 0.55 ? 2.1 : 1.4, 2.2);
      if (t < 0.6) {
        this.ctx.fx.embers(this.ejectPod.position, 5, 0.8);
      }
    }

    if (this.ejectElapsed >= RIVAL_FRAME.ejectDuration) {
      this.phase = 'wrecked';
      this.ejectPod.visible = false;
      this.ctx.fx.dust(this.ejectLandingPoint, _up, 2.4);
      this.ctx.fx.chips(this.ejectLandingPoint, 0xd8c8a0, 12);
      this.ctx.audio.play('metal_clang', { position: this.ejectLandingPoint, pitch: 0.9, volume: 0.85 });
      this.ctx.hud.feed('HARBOURMASTER DOWN ON THE SALT FLATS!', '#7ee787');
      this.ctx.campaign.signal('harbour:ejected');
      this.onEjected?.(this.ejectLandingPoint.clone());
    }
  }

  private applyKneelingWreckPose(): void {
    this.pelvis.position.y = 1.65;
    this.legL.rotation.x = -0.78;
    this.shinL.rotation.x = 1.45;
    this.legR.rotation.x = -0.32;
    this.shinR.rotation.x = 0.85;
    this.torso.rotation.x = 0.38;
    this.torso.rotation.z = 0.14;
    this.armL.rotation.x = 0.52;
    this.armR.rotation.x = 0.65;
  }

  private resetPose(): void {
    this.pelvis.position.y = 2.55;
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.shinL.rotation.set(0, 0, 0);
    this.shinR.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0);
    this.armR.rotation.set(0, 0, 0);
    this.cannonBarrel.position.z = 0;
  }

  private emitWreckSmoke(dt: number, rate: number): void {
    this.wreckSmokeIn -= dt;
    if (this.wreckSmokeIn > 0) return;
    this.wreckSmokeIn = rate;
    const at = this.localTorsoToWorld(0, 3.3, 0.4, _p);
    this.ctx.fx.smoke(at, 0x1d1c1a, 2.6, 3.0);
    if (Math.random() < 0.45) this.ctx.fx.embers(at, 8, 1.8);
  }

  // ---- ExtraTarget -----------------------------------------------------------------------------------------------

  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean {
    const zone = this.byHandle.get(collider.handle);
    if (!zone) return false;
    if (!this.alive) return true;
    const heavy = source.startsWith('frame_') || source === 'sabot' || source === 'autocannon' || amount >= 45;
    const mult = zone.mult * (heavy ? 1.0 : 0.45);
    this.applyDamage(amount * mult, zone, point, source, false);
    return true;
  }

  direct(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, _kind: ExplosionKind, source: string): boolean {
    const zone = this.byHandle.get(collider.handle);
    if (!zone) return false;
    if (!this.alive) return true;
    const isHowitzer = source === 'frame_howitzer';
    const mult = zone.mult * (isHowitzer ? 1.35 : 1.15);
    this.applyDamage(amount * mult, zone, point, source, isHowitzer || amount >= RIVAL_FRAME.staggerThreshold);
    return true;
  }

  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    if (!this.alive || spec.team !== 'player') return 0;
    const def = EXPLOSIONS[spec.kind];
    const torso = this.zones[0]!;
    const reach = 2.4;
    const d = Math.max(0, torso.center.distanceTo(center) - reach);
    if (d > spec.radius) return 0;
    const falloff = 1 - (d / spec.radius) * (1 - def.edgeDamage);
    const isHowitzer = spec.source === 'frame_howitzer';
    const dealt = spec.instakill ? this.maxHealth : spec.damage * falloff * (isHowitzer ? 1.2 : 1.0);
    this.applyDamage(dealt, torso, center, spec.source, isHowitzer || dealt >= RIVAL_FRAME.staggerThreshold);
    return 1;
  }

  paintable(out: MissileTarget[]): void {
    if (this.alive) out.push(this.paintTarget);
  }

  frameBlow(at: THREE.Vector3, radius: number, damage: number): number {
    if (!this.alive) return 0;
    const torso = this.zones[0]!;
    if (torso.center.distanceTo(at) > radius + 2.8) return 0;
    this.applyDamage(damage * 1.15, torso, at, 'frame_melee', damage >= 180);
    return 1;
  }

  highlightMeshes(out: THREE.Object3D[]): void {
    if (!this.alive) return;
    for (const m of this.highlightList) out.push(m);
  }

  private applyDamage(amount: number, zone: HitZone, point: THREE.Vector3, source: string, triggerStagger: boolean): void {
    if (!this.alive || amount <= 0) return;
    const { audio, fx, hud, render } = this.ctx;
    this.health = Math.max(0, this.health - amount);
    const killed = this.health <= 0;
    const crit = zone.id === 'cockpit';

    fx.chips(point, crit ? 0xff4420 : 0xffaa40, crit ? 14 : 8);
    hud.hitMarker(killed ? 'kill' : crit ? 'armorThrough' : 'body');
    audio.play(killed ? 'plate_destroyed' : crit ? 'armour_through' : 'hit_marker', { pitch: crit ? 1.2 : 0.95 });

    if (killed) {
      this.triggerEject();
      return;
    }

    // Heavy hits (105mm Howitzer direct hits, big blasts, Frame charges/stomps) stagger her!
    if ((triggerStagger || source === 'frame_howitzer') && !this.jumpInAir && this.staggerLeft <= 0) {
      this.staggerLeft = RIVAL_FRAME.staggerDuration;
      if (this.attack === 'cannon' || this.attack === 'rotary' || this.attack === 'missile') {
        this.attack = 'none';
        this.cannonGlow.visible = false;
      }
      fx.chips(point, 0xff9830, 26);
      render.lights.flash(point, 0xffa840, 18, 32, 0.25);
      audio.play('plate_destroyed', { position: point, pitch: 0.95, volume: 0.85 });
      hud.floatText(point, 'STAGGERED', '#ffb347');
    }
  }

  // ---- Transform & Collider Sync ---------------------------------------------------------------------------------

  private localTorsoToWorld(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(x, y, z).applyAxisAngle(_up, this.torsoYaw).add(this.position);
  }

  private muzzleWorld(rightArm: boolean, out: THREE.Vector3): THREE.Vector3 {
    return this.localTorsoToWorld(rightArm ? 2.15 : -2.15, 3.55, 2.85, out);
  }

  private syncWorld(): void {
    this.root.position.copy(this.position);
    this.root.rotation.set(0, this.legYaw, 0);
    this.torso.rotation.y = wrapAngle(this.torsoYaw - this.legYaw);

    this.paintCenter.set(this.position.x, this.position.y + 3.9, this.position.z);

    if (!this.alive) return;

    for (const z of this.zones) {
      const yaw = z.id === 'legs' ? this.legYaw : this.torsoYaw;
      _q.setFromAxisAngle(_up, yaw);
      z.center.set(z.local[0], z.local[1], z.local[2]).applyAxisAngle(_up, yaw).add(this.position);
      z.collider.setTranslation(z.center);
      z.collider.setRotation(_q);
    }
  }

  private parkColliders(): void {
    _p.set(0, -1000, 0);
    for (const z of this.zones) z.collider.setTranslation(_p);
  }

  // ---- Articulated ~6.2 m Heavy Mech Visuals (Holdfast Ironclad Livery) -----------------------------------------

  private buildModel(): void {
    const mat = this.materials;

    // Pelvis & articulated walking legs (hips at y = 2.55 m).
    this.pelvis = new THREE.Group();
    this.pelvis.position.set(0, 2.55, 0);
    const pelvisB = new ModelBuilder()
      .solid(chamferBox(2.3, 0.72, 1.8, 0.1), IRON_DARK, { at: [0, 0, 0] })
      .solid(chamferBox(1.5, 0.52, 2.05, 0.08), TEAL_DARK, { at: [0, -0.05, 0.1] })
      .box(0.95, 0.24, 0.16, RUST_HAZARD, { at: [0, -0.1, 1.12] });
    this.pelvis.add(mat.group(pelvisB));
    this.root.add(this.pelvis);

    const makeLeg = (sx: number): { hip: THREE.Group; shin: THREE.Group } => {
      const hip = new THREE.Group();
      hip.position.set(sx * 1.08, -0.05, 0);
      const thighB = new ModelBuilder()
        .cyl(0.36, 0.36, 0.55, 10, BRASS_DARK, { at: [0, 0, 0], rot: [0, 0, Math.PI / 2] })
        .solid(chamferBox(0.86, 1.38, 0.96, 0.08), TEAL_ARMOR, { at: [0, -0.68, 0.08] })
        .solid(chamferBox(0.92, 0.34, 0.84, 0.05), BRASS_GOLD, { at: [0, -0.35, 0.12] })
        .cyl(0.34, 0.34, 0.94, 10, IRON_DARK, { at: [0, -1.28, 0.15], rot: [0, 0, Math.PI / 2] });
      hip.add(mat.group(thighB));

      const shin = new THREE.Group();
      shin.position.set(0, -1.28, 0.15);
      const shinB = new ModelBuilder()
        .solid(chamferBox(0.76, 1.18, 0.92, 0.08), TEAL_DARK, { at: [0, -0.58, -0.12] })
        .solid(chamferBox(0.84, 0.72, 0.22, 0.04), TEAL_LIGHT, { at: [0, -0.38, 0.36] })
        .box(0.58, 0.16, 0.12, RUST_HAZARD, { at: [0, -0.62, 0.44] })
        // Heavy clawed industrial mech foot
        .solid(chamferBox(1.18, 0.34, 1.65, 0.06), IRON_DARK, { at: [0, -1.06, 0.18] })
        .solid(chamferBox(0.42, 0.26, 0.55, 0.04), STEEL_MID, { at: [-0.34, -1.1, 0.95] })
        .solid(chamferBox(0.42, 0.26, 0.55, 0.04), STEEL_MID, { at: [0.34, -1.1, 0.95] });
      shin.add(mat.group(shinB));
      hip.add(shin);
      this.pelvis.add(hip);
      return { hip, shin };
    };
    const leftLeg = makeLeg(-1);
    const rightLeg = makeLeg(1);
    this.legL = leftLeg.hip;
    this.shinL = leftLeg.shin;
    this.legR = rightLeg.hip;
    this.shinR = rightLeg.shin;

    // Articulated Torso (y = +0.42 above pelvis -> torso base at ~2.97 m, top of missile pod at ~6.2 m).
    this.torso = new THREE.Group();
    this.torso.position.set(0, 0.42, 0);
    this.pelvis.add(this.torso);

    const torsoB = new ModelBuilder()
      // Waist hydraulic turntable
      .cyl(0.95, 1.05, 0.46, 12, IRON_DARK, { at: [0, 0.18, 0] })
      // Main heavy armored chassis (salt-crusted dark teal + oxidized brass shoulders)
      .solid(chamferBox(2.95, 2.15, 2.45, 0.18), TEAL_ARMOR, { at: [0, 1.42, -0.05] })
      .solid(chamferBox(2.55, 0.72, 2.05, 0.12), TEAL_LIGHT, { at: [0, 2.52, -0.15] })
      // Hollowed-out cockpit recess (revealed when canopy ejects!)
      .box(1.25, 0.85, 0.65, '#111418', { at: [0, 1.48, 0.95] })
      .glow(new THREE.BoxGeometry(0.85, 0.12, 0.08), '#ff3818', 2.8, { at: [0, 1.24, 1.15] })
      // Oxidized brass heavy shoulder pauldrons + weathered rust hazard bands
      .solid(chamferBox(1.15, 1.25, 2.25, 0.12), BRASS_GOLD, { at: [-1.92, 2.05, -0.05], rot: [0, 0, 0.14] })
      .solid(chamferBox(1.15, 1.25, 2.25, 0.12), BRASS_GOLD, { at: [1.92, 2.05, -0.05], rot: [0, 0, -0.14] })
      .box(0.18, 0.95, 1.85, RUST_HAZARD, { at: [-2.48, 1.98, -0.05] })
      .box(0.18, 0.95, 1.85, RUST_HAZARD, { at: [2.48, 1.98, -0.05] })
      // Chest hazard trim & dorsal reactor cooling vents
      .box(1.9, 0.24, 0.14, BRASS_GOLD, { at: [0, 0.72, 1.22] })
      .glow(new THREE.BoxGeometry(0.85, 0.22, 0.14), REACTOR_AMBER, 3.2, { at: [0, 1.75, -1.28] })
      // Twin dorsal jump-jet thruster packs & exhaust nozzles
      .solid(chamferBox(1.85, 1.65, 0.92, 0.12), STEEL_MID, { at: [0, 1.55, -1.45] })
      .cyl(0.32, 0.48, 0.78, 10, IRON_DARK, { at: [-0.62, 0.68, -1.55], rot: [0.24, 0, 0] })
      .cyl(0.32, 0.48, 0.78, 10, IRON_DARK, { at: [0.62, 0.68, -1.55], rot: [0.24, 0, 0] });
    this.torso.add(mat.group(torsoB));

    // Removable Armored Canopy + Glowing Crimson Visor (blasts off during Emergency Eject!).
    this.canopy = new THREE.Group();
    const canopyB = new ModelBuilder()
      .solid(chamferBox(1.62, 1.18, 1.05, 0.12), TEAL_DARK, { at: [0, 1.52, 1.25], rot: [0.1, 0, 0] })
      .solid(chamferBox(1.75, 0.34, 0.82, 0.06), BRASS_GOLD, { at: [0, 2.02, 1.38] })
      .glow(new THREE.BoxGeometry(1.28, 0.26, 0.14), VISOR_RED, 4.4, { at: [0, 1.62, 1.74] })
      .glow(new THREE.BoxGeometry(0.38, 0.14, 0.12), VISOR_RED, 3.8, { at: [0, 1.24, 1.72] });
    this.canopy.add(mat.group(canopyB));
    this.torso.add(this.canopy);

    // Dorsal Jump-Jet Flame Cones + bright thruster PointLight (visible during launch & jump-jet leaps).
    this.jetFlames = new THREE.Group();
    this.jetFlames.position.set(0, 0.3, -1.65);
    this.jetFlames.visible = false;
    const jetB = new ModelBuilder()
      .glow(new THREE.ConeGeometry(0.46, 2.8, 10), '#ff7820', 4.4, { at: [-0.62, -1.35, -0.25], rot: [Math.PI + 0.24, 0, 0] })
      .glow(new THREE.ConeGeometry(0.46, 2.8, 10), '#ff7820', 4.4, { at: [0.62, -1.35, -0.25], rot: [Math.PI + 0.24, 0, 0] })
      .glow(new THREE.ConeGeometry(0.24, 1.8, 8), '#fff2b2', 5.0, { at: [-0.62, -0.95, -0.15], rot: [Math.PI + 0.24, 0, 0] })
      .glow(new THREE.ConeGeometry(0.24, 1.8, 8), '#fff2b2', 5.0, { at: [0.62, -0.95, -0.15], rot: [Math.PI + 0.24, 0, 0] });
    this.jetFlames.add(mat.group(jetB));
    this.jetLight = new THREE.PointLight(0xff7820, 0, 42, 1.5);
    this.jetLight.position.set(0, -1.2, -0.3);
    this.jetFlames.add(this.jetLight);
    this.torso.add(this.jetFlames);

    // Dorsal 4-tube Shoulder Missile Pod (peaks at y = 6.2 m world height).
    this.missilePod = new THREE.Group();
    this.missilePod.position.set(1.28, 2.88, -0.15);
    const podB = new ModelBuilder()
      .solid(chamferBox(1.18, 0.92, 1.38, 0.08), TEAL_DARK, { at: [0, 0.32, 0] })
      .box(1.22, 0.16, 1.15, RUST_HAZARD, { at: [0, 0.68, 0] })
      .glow(new THREE.BoxGeometry(0.92, 0.14, 0.1), VISOR_RED, 3.6, { at: [0, 0.72, 0.68] });
    for (const mx of [-0.28, 0.28]) {
      for (const my of [0.16, 0.48]) {
        podB.cyl(0.14, 0.14, 1.48, 8, IRON_DARK, { at: [mx, my, 0.08], rot: [Math.PI / 2, 0, 0] });
      }
    }
    this.missilePod.add(mat.group(podB));
    this.torso.add(this.missilePod);

    // Left-Arm Spinning 6-Barrel Rotary Gun.
    this.armL = new THREE.Group();
    this.armL.position.set(-2.15, 0.65, 0.35);
    const armLB = new ModelBuilder()
      .solid(chamferBox(0.74, 0.88, 1.45, 0.08), TEAL_ARMOR, { at: [0, 0, 0.15] })
      .solid(chamferBox(0.68, 0.58, 0.72, 0.06), BRASS_DARK, { at: [-0.25, -0.25, -0.1] });
    this.armL.add(mat.group(armLB));

    this.rotaryBarrels = new THREE.Group();
    this.rotaryBarrels.position.set(0, -0.05, 1.65);
    const rotB = new ModelBuilder()
      .cyl(0.28, 0.28, 0.22, 10, STEEL_MID, { at: [0, 0, -0.55], rot: [Math.PI / 2, 0, 0] })
      .cyl(0.28, 0.28, 0.22, 10, BRASS_GOLD, { at: [0, 0, 0.45], rot: [Math.PI / 2, 0, 0] });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      rotB.cyl(0.055, 0.055, 2.25, 6, IRON_DARK, {
        at: [Math.cos(a) * 0.18, Math.sin(a) * 0.18, 0],
        rot: [Math.PI / 2, 0, 0],
      });
    }
    this.rotaryBarrels.add(mat.group(rotB));
    this.armL.add(this.rotaryBarrels);
    this.torso.add(this.armL);

    // Right-Arm Heavy Cannon with recoil barrel & amber charge muzzle glow.
    this.armR = new THREE.Group();
    this.armR.position.set(2.15, 0.65, 0.35);
    const armRB = new ModelBuilder()
      .solid(chamferBox(0.84, 0.96, 1.65, 0.08), TEAL_ARMOR, { at: [0, 0, 0.2] })
      .box(0.88, 0.2, 1.2, BRASS_GOLD, { at: [0, 0.42, 0.3] });
    this.armR.add(mat.group(armRB));

    this.cannonBarrel = new THREE.Group();
    const barrelB = new ModelBuilder()
      .cyl(0.22, 0.28, 2.45, 10, IRON_DARK, { at: [0, 0, 1.75], rot: [Math.PI / 2, 0, 0] })
      .solid(chamferBox(0.56, 0.48, 0.48, 0.04), STEEL_MID, { at: [0, 0, 2.85] });
    this.cannonBarrel.add(mat.group(barrelB));
    this.armR.add(this.cannonBarrel);

    const glowB = new ModelBuilder()
      .glow(new THREE.SphereGeometry(0.42, 10, 8), '#ff9c24', 4.6)
      .glow(new THREE.SphereGeometry(0.22, 8, 6), '#fff4b8', 5.2);
    this.cannonGlow = new THREE.Mesh(glowB.glowGeometry()!, mat.glow);
    this.cannonGlow.position.set(0, 0, 3.05);
    this.cannonGlow.visible = false;
    this.armR.add(this.cannonGlow);
    this.torso.add(this.armR);

    // Animated Ejecting Pilot Capsule (rockets 22 m skyward at 0 HP).
    this.ejectPod = new THREE.Group();
    const ejB = new ModelBuilder()
      .solid(chamferBox(0.95, 1.35, 0.85, 0.1), TEAL_DARK, { at: [0, 0.65, 0] })
      .solid(chamferBox(0.52, 0.52, 0.52, 0.08), BRASS_GOLD, { at: [0, 1.35, 0.1] })
      .glow(new THREE.ConeGeometry(0.38, 1.6, 8), '#ffaa40', 4.8, { at: [0, -0.7, 0], rot: [Math.PI, 0, 0] })
      .glow(new THREE.ConeGeometry(0.2, 1.1, 8), '#ffffff', 5.4, { at: [0, -0.45, 0], rot: [Math.PI, 0, 0] });
    this.ejectPod.add(mat.group(ejB));

    // Register meshes for Frame gunner highlight.
    this.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh) this.highlightList.push(o);
    });
  }

  dispose(): void {
    this.stopJetLoop();
    this.vehicles?.removeExtra(this);
    this.hudUnmark?.();
    this.hudUnmark = null;
    for (const z of this.zones) this.ctx.physics.world.removeCollider(z.collider, true);
    this.root.removeFromParent();
    this.ejectPod.removeFromParent();
  }
}
