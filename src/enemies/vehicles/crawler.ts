/**
 * Old Mother: Holdfast's 30 m x 14 m x 12 m painted salt-harvesting crawler (stage 8 & stage 11 of
 * docs/proposals/mission-2-plan.md).
 *
 * Three-phase boss fight:
 *   1. Hunt   — patrols the salt pans ellipse (`PANS.loop`). Break both tracks (1500 HP each) to stop her,
 *               dodge her telegraphed 20 m bow cutter sweep, and tear down her deck turrets (700 HP each)
 *               and dorsal missile pod (500 HP).
 *   2. Drag   — both tracks gone. She anchors on the salt, pivots toward the Frame, fires remaining ordnance
 *               and telegraphed cutter lunges, then seizes the Frame's leg (`mother:seized`) for the eject.
 *   3. Deck   — solid walkable Rapier deck + cover + stern ramp; player lands on her back with the Autocannon,
 *               clears the deck crew, and destroys the exposed glowing Stern Engine (1200 HP -> `mother:engine`).
 *
 * `CrawlerState` is pure state + phase math so unit tests can verify every transition and part pool directly.
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

export type CrawlerPhase = 'dormant' | 'hunt' | 'drag' | 'seizing' | 'deck' | 'dead';
export type CrawlerPartId = 'trackL' | 'trackR' | 'turretF' | 'turretA' | 'launcher' | 'engine';

export const CRAWLER = {
  length: 30,
  width: 14,
  height: 12,
  deckY: 6.4,
  hp: {
    trackL: 1500,
    trackR: 1500,
    turretF: 700,
    turretA: 700,
    launcher: 500,
    engine: 1200,
  },
  speedFull: 9.5,
  speedCrippled: 4.8,
  turnRate: 0.42,
  sweepReach: 21,
  sweepDamage: 320,
  sweepWindup: 1.25,
  sweepCooldown: 8.5,
  turretEvery: 2.2,
  turretDamage: 48,
  missileEvery: 7.5,
  missileDamage: 165,
  /** Seconds in Phase 2 before Old Mother automatically forces a cutter seize even if weapons survive. */
  dragMaxSeconds: 42,
  seizeSeconds: 1.6,
} as const;

export interface CrawlerPartHit {
  part: CrawlerPartId;
  dealt: number;
  broke: boolean;
  phaseChanged: CrawlerPhase | null;
}

/** Pure state machine for Old Mother's parts and 3-phase boss fight. */
export class CrawlerState {
  phase: CrawlerPhase = 'dormant';
  readonly hp: Record<CrawlerPartId, number> = { ...CRAWLER.hp };
  dragClock = 0;

  reset(): void {
    this.phase = 'dormant';
    this.hp.trackL = CRAWLER.hp.trackL;
    this.hp.trackR = CRAWLER.hp.trackR;
    this.hp.turretF = CRAWLER.hp.turretF;
    this.hp.turretA = CRAWLER.hp.turretA;
    this.hp.launcher = CRAWLER.hp.launcher;
    this.hp.engine = CRAWLER.hp.engine;
    this.dragClock = 0;
  }

  get tracksAlive(): number {
    return (this.hp.trackL > 0 ? 1 : 0) + (this.hp.trackR > 0 ? 1 : 0);
  }

  get weaponsAlive(): number {
    return (this.hp.turretF > 0 ? 1 : 0) + (this.hp.turretA > 0 ? 1 : 0) + (this.hp.launcher > 0 ? 1 : 0);
  }

  get speed(): number {
    if (this.phase !== 'hunt') return 0;
    return this.tracksAlive === 2 ? CRAWLER.speedFull : this.tracksAlive === 1 ? CRAWLER.speedCrippled : 0;
  }

  /** Normalized 0..1 bar value for the active boss phase. */
  barFraction(): number {
    if (this.phase === 'deck') return clamp(this.hp.engine / CRAWLER.hp.engine);
    if (this.phase === 'dead') return 0;
    const cur = this.hp.trackL + this.hp.trackR + this.hp.turretF + this.hp.turretA + this.hp.launcher;
    const max = CRAWLER.hp.trackL + CRAWLER.hp.trackR + CRAWLER.hp.turretF + CRAWLER.hp.turretA + CRAWLER.hp.launcher;
    return clamp(cur / max);
  }

  barLabel(): string {
    switch (this.phase) {
      case 'hunt': return this.tracksAlive === 2 ? 'OLD MOTHER — BREAK HER TRACKS' : 'OLD MOTHER — ONE TRACK LEFT';
      case 'drag': return 'OLD MOTHER — IMMOBILIZED · STRIP HER WEAPONS';
      case 'seizing': return 'OLD MOTHER — HULL BREACH!';
      case 'deck': return 'OLD MOTHER — DESTROY THE STERN ENGINE';
      default: return 'OLD MOTHER';
    }
  }

  hit(part: CrawlerPartId, amount: number): CrawlerPartHit {
    if (amount <= 0 || this.phase === 'dead' || this.phase === 'dormant') {
      return { part, dealt: 0, broke: false, phaseChanged: null };
    }
    // Engine is only vulnerable on the deck (Phase 3); external parts only in Hunt / Drag.
    if (part === 'engine' && this.phase !== 'deck') {
      return { part, dealt: 0, broke: false, phaseChanged: null };
    }
    if (part !== 'engine' && this.phase !== 'hunt' && this.phase !== 'drag') {
      return { part, dealt: 0, broke: false, phaseChanged: null };
    }
    if (this.hp[part] <= 0) {
      return { part, dealt: 0, broke: false, phaseChanged: null };
    }
    const dealt = Math.min(this.hp[part], amount);
    this.hp[part] = Math.max(0, this.hp[part] - dealt);
    const broke = this.hp[part] <= 0;
    let phaseChanged: CrawlerPhase | null = null;

    if (this.phase === 'hunt' && (this.tracksAlive === 0 || this.barFraction() <= 0.35)) {
      this.phase = 'drag';
      this.dragClock = 0;
      phaseChanged = 'drag';
    }
    if (this.phase === 'drag' && this.weaponsAlive === 0) {
      this.phase = 'seizing';
      phaseChanged = 'seizing';
    }
    if (this.phase === 'deck' && this.hp.engine <= 0) {
      this.phase = 'dead';
      phaseChanged = 'dead';
    }
    return { part, dealt, broke, phaseChanged };
  }

  tickDrag(dt: number): boolean {
    if (this.phase !== 'drag') return false;
    this.dragClock += dt;
    if (this.dragClock >= CRAWLER.dragMaxSeconds) {
      this.phase = 'seizing';
      return true;
    }
    return false;
  }
}

function chamferBox(w: number, h: number, d: number, bevel = 0.16): THREE.BufferGeometry {
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
    depth: Math.max(0.05, d - b * 2),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
  });
  geo.center();
  return geo;
}

interface HitBox {
  readonly id: CrawlerPartId;
  readonly local: readonly [number, number, number];
  readonly half: readonly [number, number, number];
  readonly collider: RAPIER.Collider;
  readonly center: THREE.Vector3;
  readonly target: MissileTarget;
  readonly label: string;
  unmark: (() => void) | null;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const PART_SPECS: readonly { id: CrawlerPartId; local: readonly [number, number, number]; half: readonly [number, number, number]; label: string }[] = [
  { id: 'trackL', local: [-5.8, 1.8, 0], half: [1.7, 1.8, 11.5], label: 'PORT TRACK' },
  { id: 'trackR', local: [5.8, 1.8, 0], half: [1.7, 1.8, 11.5], label: 'STARBOARD TRACK' },
  { id: 'turretF', local: [0, 7.6, 5.2], half: [1.7, 1.2, 1.9], label: 'FORE TURRET' },
  { id: 'turretA', local: [0, 7.6, -5.2], half: [1.7, 1.2, 1.9], label: 'AFT TURRET' },
  { id: 'launcher', local: [0, 11.0, -1.5], half: [1.5, 1.0, 1.6], label: 'MISSILE POD' },
  { id: 'engine', local: [0, 7.8, -11.4], half: [2.4, 1.6, 1.8], label: 'STERN ENGINE' },
];

export class OldMother implements ExtraTarget {
  readonly state = new CrawlerState();
  readonly position = new THREE.Vector3(-90, 0, -10);
  yaw = Math.PI;
  readonly root = new THREE.Group();

  private readonly materials: ModelMaterials;
  private readonly boxes: HitBox[] = [];
  private readonly byHandle = new Map<number, HitBox>();
  private readonly hullCollider: RAPIER.Collider;
  private readonly deckColliders: RAPIER.Collider[] = [];
  private readonly highlightList: THREE.Object3D[] = [];

  private cutter!: THREE.Group;
  private turretFMesh!: THREE.Group;
  private turretAMesh!: THREE.Group;
  private launcherMesh!: THREE.Group;
  private skirtL!: THREE.Group;
  private skirtR!: THREE.Group;
  private engineGlow!: THREE.Mesh;
  private readonly wheels: THREE.Object3D[] = [];

  private loopAngle = -Math.PI * 0.45;
  private cutterAngle = 0;
  private sweepWindup = -1;
  private sweepCooldown = 3;
  private turretFIn = 2.0;
  private turretAIn = 3.1;
  private missileIn = 5.5;
  private seizeLeft = -1;
  private smokeIn = 0;
  private rumbleLoop: LoopHandle | null = null;
  private onSeizeHook: (() => void) | null = null;

  constructor(private readonly ctx: Ctx, private readonly vehicles: VehicleSystem | null) {
    this.materials = new ModelMaterials(ctx);
    this.buildModel();
    this.root.visible = false;
    ctx.render.scene.add(this.root);

    this.hullCollider = ctx.physics.addStaticBox(new THREE.Vector3(0, -1000, 0), new THREE.Vector3(4.6, 3.0, 11.2), null, 'metal');
    for (const spec of PART_SPECS) {
      const center = new THREE.Vector3();
      const collider = ctx.physics.addStaticBox(new THREE.Vector3(0, -1000, 0), new THREE.Vector3(...spec.half), null, 'metal');
      const hpAlive = (): boolean =>
        (this.state.phase === 'hunt' || this.state.phase === 'drag') && this.state.hp[spec.id] > 0;
      const box: HitBox = {
        id: spec.id,
        local: spec.local,
        half: spec.half,
        collider,
        center,
        label: spec.label,
        unmark: null,
        target: {
          center,
          get alive() {
            if (spec.id === 'engine') return false;
            return hpAlive();
          },
          aimLift: 0.4,
          paintRadius: Math.max(spec.half[0], spec.half[2]),
        },
      };
      this.boxes.push(box);
      this.byHandle.set(collider.handle, box);
    }

    this.vehicles?.addExtra(this);
  }

  /** Callback invoked when Old Mother enters `seizing` (lets the director trigger Frame hull breach flash). */
  setSeizeHook(fn: (() => void) | null): void {
    this.onSeizeHook = fn;
  }

  /** Shows Old Mother patrolling in the distance on the salt pans (`pans` section). */
  reveal(): void {
    this.state.reset();
    this.state.phase = 'dormant';
    this.clearDeckColliders();
    this.restoreMeshes();
    this.loopAngle = -Math.PI * 0.45;
    this.placeOnLoop();
    this.root.visible = true;
    this.syncWorld();
  }

  /** Starts the full Phase 1 Hunt boss fight (`mother` section). */
  startFight(): void {
    this.state.reset();
    this.state.phase = 'hunt';
    this.clearDeckColliders();
    this.restoreMeshes();
    if (!this.root.visible) {
      this.loopAngle = Math.PI + 0.3;
      this.position.set(-98, 0, -24);
      this.yaw = 0.24;
      this.root.visible = true;
    }
    this.seizeLeft = -1;
    this.sweepWindup = -1;
    this.sweepCooldown = 4;
    this.turretFIn = 2.0;
    this.turretAIn = 3.2;
    this.missileIn = 5.5;
    this.syncWorld();
    this.refreshMarkers();
    this.rumbleLoop ??= this.ctx.audio.startLoop('tank_turret_loop', { position: this.position, volume: 0.65, pitch: 0.55 });
  }

  /** Locks Old Mother stationary with solid walkable deck colliders and live Stern Engine (`deck` section). */
  enterDeck(snapToDefault = false): void {
    if (snapToDefault || !this.root.visible) {
      this.position.set(-90, 0, -2);
      this.yaw = 0;
      this.root.visible = true;
    }
    this.state.phase = 'deck';
    this.state.hp.trackL = 0;
    this.state.hp.trackR = 0;
    this.state.hp.turretF = 0;
    this.state.hp.turretA = 0;
    this.state.hp.launcher = 0;
    this.state.hp.engine = CRAWLER.hp.engine;
    this.skirtL.visible = false;
    this.skirtR.visible = false;
    this.turretFMesh.visible = false;
    this.turretAMesh.visible = false;
    this.launcherMesh.visible = false;
    this.engineGlow.visible = true;
    this.rumbleLoop?.stop(0.8);
    this.rumbleLoop = null;
    this.syncWorld();
    this.buildDeckColliders();
    this.refreshMarkers();
  }

  /** Transforms a point from Old Mother's local hull space into world coordinates. */
  localToWorld(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(x, y, z).applyAxisAngle(_up, this.yaw).add(this.position);
  }

  /** Safe landing spot on Old Mother's foredeck for eject & `?beat=deck`. */
  deckLandingPoint(out = new THREE.Vector3()): THREE.Vector3 {
    return this.localToWorld(0, CRAWLER.deckY + 0.35, 6.2, out);
  }

  /** Spot for the Autocannon weapon rack on the foredeck. */
  deckGunPoint(out = new THREE.Vector3()): THREE.Vector3 {
    return this.localToWorld(2.2, CRAWLER.deckY, 3.6, out);
  }

  /** Spot where the Harbourmaster stands by the smoking stern bridge once the engine dies. */
  harbourmasterPoint(out = new THREE.Vector3()): THREE.Vector3 {
    return this.localToWorld(0, CRAWLER.deckY, -7.8, out);
  }

  /** Hides and resets Old Mother completely (new run / non-pans beats). */
  hide(): void {
    this.state.reset();
    this.root.visible = false;
    this.seizeLeft = -1;
    this.sweepWindup = -1;
    this.rumbleLoop?.stop(0.3);
    this.rumbleLoop = null;
    this.clearMarkers();
    this.clearDeckColliders();
    this.parkColliders();
  }

  private restoreMeshes(): void {
    this.skirtL.visible = true;
    this.skirtR.visible = true;
    this.turretFMesh.visible = true;
    this.turretAMesh.visible = true;
    this.launcherMesh.visible = true;
    this.engineGlow.visible = true;
  }

  private placeOnLoop(): void {
    const L = PANS.loop;
    const x = L.x + Math.cos(this.loopAngle) * L.rx;
    const z = L.z + Math.sin(this.loopAngle) * L.rz;
    const tx = -Math.sin(this.loopAngle) * L.rx;
    const tz = Math.cos(this.loopAngle) * L.rz;
    this.position.set(x, 0, z);
    this.yaw = Math.atan2(tx, tz);
  }

  update(dt: number): void {
    if (!this.root.visible) return;
    const phase = this.state.phase;

    if (phase === 'dormant') {
      // Slow majestic patrol across the salt pans when glimpsed from the west gate.
      this.loopAngle += (4.5 / 65) * dt;
      this.placeOnLoop();
      this.cutterAngle += 1.5 * dt;
      this.cutter.rotation.x = this.cutterAngle;
      this.spinWheels(4.5 * dt);
      this.syncWorld();
      this.emitStacks(dt, 0.45);
      return;
    }

    if (phase === 'dead') {
      this.emitStacks(dt, 0.35);
      return;
    }

    if (phase === 'deck') {
      // Engine core pulses visibly; light smoke rises from shattered turrets & tracks.
      const pulse = 0.85 + Math.sin(this.ctx.time.elapsed * 5.5) * 0.25;
      this.engineGlow.scale.setScalar(pulse);
      this.cutterAngle += 0.45 * dt;
      this.cutter.rotation.x = this.cutterAngle;
      this.emitStacks(dt, 0.3);
      return;
    }

    // Active boss combat (hunt / drag / seizing).
    const { player, audio, fx } = this.ctx;
    const speed = this.state.speed;
    if (phase === 'hunt' && speed > 0) {
      this.loopAngle += (speed / 65) * dt;
      const L = PANS.loop;
      const wantX = L.x + Math.cos(this.loopAngle) * L.rx;
      const wantZ = L.z + Math.sin(this.loopAngle) * L.rz;
      const dx = wantX - this.position.x;
      const dz = wantZ - this.position.z;
      const wantYaw = Math.atan2(dx, dz);
      this.yaw = dampAngle(this.yaw, wantYaw, 1.8, dt);
      this.position.x += Math.sin(this.yaw) * speed * dt;
      this.position.z += Math.cos(this.yaw) * speed * dt;
      this.spinWheels(speed * dt);
    } else if (phase === 'drag') {
      // Tracks dead: pivot slowly to face the Frame with the bow cutter.
      const wantYaw = Math.atan2(player.position.x - this.position.x, player.position.z - this.position.z);
      this.yaw = dampAngle(this.yaw, wantYaw, CRAWLER.turnRate, dt);
      if (this.state.tickDrag(dt)) this.beginSeize();
    } else if (phase === 'seizing') {
      this.seizeLeft -= dt;
      this.cutterAngle += 12 * dt;
      this.cutter.rotation.x = this.cutterAngle;
      this.ctx.camera.addTrauma(0.25);
      if (this.seizeLeft <= 0) {
        this.seizeLeft = 999;
        this.ctx.campaign.signal('mother:seized');
      }
      this.syncWorld();
      return;
    }

    // Cutter wheel spin & telegraphed bow sweep.
    const bow = this.localToWorld(0, 2.2, 13.5, _p);
    const distBow = bow.distanceTo(player.position);
    this.sweepCooldown = Math.max(0, this.sweepCooldown - dt);
    if (this.sweepWindup >= 0) {
      this.sweepWindup -= dt;
      this.cutterAngle += 11 * dt;
      fx.dust(bow, _up, 1.4);
      if (this.sweepWindup <= 0) {
        this.sweepWindup = -1;
        this.sweepCooldown = CRAWLER.sweepCooldown;
        this.executeSweep(bow);
      }
    } else {
      this.cutterAngle += 2.2 * dt;
      if (distBow < CRAWLER.sweepReach && this.sweepCooldown <= 0 && player.alive) {
        this.sweepWindup = CRAWLER.sweepWindup;
        audio.play('metal_groan', { position: bow, pitch: 0.55, volume: 1 });
        audio.play('titan_charge', { position: bow, pitch: 0.65, volume: 0.9 });
        this.ctx.hud.feed('OLD MOTHER — CUTTER SWEEP INCOMING!', '#ff7a30');
      }
    }
    this.cutter.rotation.x = this.cutterAngle;

    // Deck turrets & dorsal missile pod.
    this.updateWeapons(dt);
    this.syncWorld();
    this.emitStacks(dt, 0.25);
    this.rumbleLoop?.setPosition(this.position);
  }

  private executeSweep(bow: THREE.Vector3): void {
    const { audio, camera, fx, player } = this.ctx;
    fx.slam(bow, 3.6);
    fx.chips(bow, 0xd8c8a0, 28);
    audio.play('titan_stomp', { position: bow, pitch: 0.7, volume: 1 });
    audio.play('explosion_debris', { position: bow, volume: 0.9 });
    if (bow.distanceTo(player.position) <= CRAWLER.sweepReach + 2 && player.alive) {
      player.takeDamage({ amount: CRAWLER.sweepDamage, from: bow, type: 'crush', source: 'crawler_cutter' });
      camera.addTrauma(0.85);
    }
  }

  private updateWeapons(dt: number): void {
    const { player, fx, audio } = this.ctx;
    if (!player.alive) return;
    const quarry = player.eye;

    // Fore turret.
    if (this.state.hp.turretF > 0) {
      const at = this.localToWorld(0, 7.6, 5.2, _p);
      const wantYaw = Math.atan2(quarry.x - at.x, quarry.z - at.z) - this.yaw;
      this.turretFMesh.rotation.y = dampAngle(this.turretFMesh.rotation.y, wrapAngle(wantYaw), 2.8, dt);
      this.turretFIn -= dt;
      if (this.turretFIn <= 0 && at.distanceTo(quarry) < 155) {
        this.turretFIn = CRAWLER.turretEvery + rand(-0.3, 0.5);
        this.fireTurret(at, quarry);
      }
    }
    // Aft turret.
    if (this.state.hp.turretA > 0) {
      const at = this.localToWorld(0, 7.6, -5.2, _p);
      const wantYaw = Math.atan2(quarry.x - at.x, quarry.z - at.z) - this.yaw;
      this.turretAMesh.rotation.y = dampAngle(this.turretAMesh.rotation.y, wrapAngle(wantYaw), 2.8, dt);
      this.turretAIn -= dt;
      if (this.turretAIn <= 0 && at.distanceTo(quarry) < 155) {
        this.turretAIn = CRAWLER.turretEvery + rand(-0.2, 0.6);
        this.fireTurret(at, quarry);
      }
    }
    // Dorsal missile launcher.
    if (this.state.hp.launcher > 0) {
      this.missileIn -= dt;
      if (this.missileIn <= 0) {
        this.missileIn = CRAWLER.missileEvery + rand(-1, 1.5);
        const launch = this.localToWorld(0, 11.8, -1.5, _p);
        if (launch.distanceTo(quarry) < 170) {
          audio.play('enemy_rocket_fire', { position: launch, volume: 1 });
          fx.muzzleFlash(launch, _up, 'rocket');
          fx.smoke(launch, 0xc8ccc8, 2.5, 2.5);
          for (let i = 0; i < 2; i++) {
            _dir.subVectors(quarry, launch).normalize();
            _dir.x += rand(-0.1, 0.1);
            _dir.y += 0.25;
            _dir.z += rand(-0.1, 0.1);
            _dir.normalize();
            this.ctx.combat.spawnProjectile({
              origin: launch.clone().add(_v.set(i === 0 ? -0.9 : 0.9, 0.4, 0)),
              velocity: _dir.clone().multiplyScalar(32),
              kind: 'rocket',
              team: 'enemy',
              damage: CRAWLER.missileDamage,
              source: 'crawler_missile',
              gravity: 4,
              homing: 1.6,
              lifetime: 6,
              trail: 'smoke',
              tracer: 'heavy',
              explosion: { radius: 7, damage: CRAWLER.missileDamage, kind: 'rocket', scale: 1.25 },
            });
          }
        }
      }
    }
  }

  private fireTurret(from: THREE.Vector3, target: THREE.Vector3): void {
    const { fx, audio, player } = this.ctx;
    _dir.subVectors(target, from).normalize();
    const hitPoint = new THREE.Vector3(
      target.x + rand(-2.8, 2.8),
      Math.max(0.5, target.y + rand(-1.5, 1.8)),
      target.z + rand(-2.8, 2.8),
    );
    fx.muzzleFlash(from, _dir, 'rifle');
    fx.tracer(from, hitPoint, 'heavy');
    audio.play('tank_cannon', { position: from, pitch: 1.35 + rand(-0.08, 0.08), volume: 0.7 });
    if (hitPoint.distanceTo(player.eye) <= 4.5) {
      player.takeDamage({ amount: CRAWLER.turretDamage, from, type: 'explosive', source: 'crawler_turret' });
    }
  }

  private beginSeize(): void {
    this.seizeLeft = CRAWLER.seizeSeconds;
    this.clearMarkers();
    this.ctx.audio.play('metal_groan', { pitch: 0.5, volume: 1 });
    this.ctx.audio.play('plate_destroyed', { pitch: 0.65, volume: 1 });
    this.ctx.camera.addTrauma(0.95);
    this.onSeizeHook?.();
  }

  private spinWheels(dist: number): void {
    const ang = dist / 1.1;
    for (const w of this.wheels) w.rotation.x += ang;
  }

  private emitStacks(dt: number, rate: number): void {
    this.smokeIn -= dt;
    if (this.smokeIn > 0) return;
    this.smokeIn = rate;
    const { fx } = this.ctx;
    for (const sx of [-2.4, 2.4]) {
      this.localToWorld(sx, 11.4, -7.2, _p);
      fx.smoke(_p, this.state.phase === 'dead' ? 0x1e1d1b : 0x3b3936, 2.4, 3.2);
    }
    if (this.state.hp.trackL <= 0) {
      this.localToWorld(-5.8, 2.8, 0, _p);
      fx.smoke(_p, 0x262422, 2.0, 2.2);
    }
    if (this.state.hp.trackR <= 0) {
      this.localToWorld(5.8, 2.8, 0, _p);
      fx.smoke(_p, 0x262422, 2.0, 2.2);
    }
  }

  // ---- ExtraTarget -----------------------------------------------------------------------------------------------

  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean {
    if (collider.handle === this.hullCollider.handle) {
      this.ctx.fx.chips(point, 0x8a8c90, 4);
      this.ctx.hud.hitMarker('armor');
      this.ctx.audio.play('armour_stopped', { volume: 0.45 });
      return true;
    }
    const box = this.byHandle.get(collider.handle);
    if (!box) return false;
    const mult = box.id === 'engine' ? 1.0 : (source.startsWith('frame_') || source === 'sabot' || source === 'autocannon' || amount >= 45 ? 1.0 : 0.4);
    this.applyPartDamage(box, amount * mult, point);
    return true;
  }

  direct(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, _kind: ExplosionKind, _source: string): boolean {
    if (collider.handle === this.hullCollider.handle) {
      // Rockets/40mm hitting the hull splash onto the nearest live part at 50%.
      const nearest = this.nearestLiveBox(point);
      if (nearest) this.applyPartDamage(nearest, amount * 0.5, point);
      return true;
    }
    const box = this.byHandle.get(collider.handle);
    if (!box) return false;
    this.applyPartDamage(box, amount * 1.15, point);
    return true;
  }

  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    if (!this.root.visible || spec.team !== 'player' || this.state.phase === 'dormant' || this.state.phase === 'dead') return 0;
    const def = EXPLOSIONS[spec.kind];
    let hit = 0;
    for (const b of this.boxes) {
      if (b.id === 'engine' && this.state.phase !== 'deck') continue;
      if (b.id !== 'engine' && this.state.phase !== 'hunt' && this.state.phase !== 'drag') continue;
      if (this.state.hp[b.id] <= 0) continue;
      const reach = Math.max(b.half[0], b.half[2]);
      const d = Math.max(0, b.center.distanceTo(center) - reach);
      if (d > spec.radius) continue;
      const falloff = 1 - (d / spec.radius) * (1 - def.edgeDamage);
      this.applyPartDamage(b, spec.instakill ? 1500 : spec.damage * falloff, center);
      hit++;
    }
    return hit;
  }

  paintable(out: MissileTarget[]): void {
    if (!this.root.visible || (this.state.phase !== 'hunt' && this.state.phase !== 'drag')) return;
    for (const b of this.boxes) {
      if (b.id !== 'engine' && this.state.hp[b.id] > 0) out.push(b.target);
    }
  }

  frameBlow(at: THREE.Vector3, radius: number, damage: number): number {
    if (!this.root.visible || (this.state.phase !== 'hunt' && this.state.phase !== 'drag')) return 0;
    let hit = 0;
    for (const b of this.boxes) {
      if (b.id === 'engine' || this.state.hp[b.id] <= 0) continue;
      const reach = Math.max(b.half[0], b.half[2]);
      if (b.center.distanceTo(at) <= radius + reach) {
        this.applyPartDamage(b, damage, at);
        hit++;
      }
    }
    return hit;
  }

  highlightMeshes(out: THREE.Object3D[]): void {
    if (!this.root.visible || this.state.phase === 'dormant' || this.state.phase === 'dead') return;
    for (const m of this.highlightList) out.push(m);
  }

  private nearestLiveBox(point: THREE.Vector3): HitBox | null {
    let best: HitBox | null = null;
    let bestD = Infinity;
    for (const b of this.boxes) {
      if (b.id === 'engine' && this.state.phase !== 'deck') continue;
      if (b.id !== 'engine' && this.state.phase !== 'hunt' && this.state.phase !== 'drag') continue;
      if (this.state.hp[b.id] <= 0) continue;
      const d = b.center.distanceTo(point);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  private applyPartDamage(box: HitBox, amount: number, point: THREE.Vector3): void {
    const res = this.state.hit(box.id, amount);
    const { audio, campaign, fx, hud, progression, render } = this.ctx;
    if (res.dealt <= 0) {
      hud.hitMarker('armor');
      audio.play('armour_stopped', { volume: 0.4 });
      return;
    }
    fx.chips(point, box.id === 'engine' ? 0xff7a20 : 0xffaa44, 7);
    hud.hitMarker(res.broke ? 'kill' : box.id === 'engine' ? 'armorThrough' : 'body');
    audio.play(res.broke ? 'plate_destroyed' : 'hit_marker', { pitch: box.id === 'engine' ? 1.15 : 0.9 });

    if (res.broke) {
      fx.explosion(box.center, { radius: 6, kind: 'rocket', scale: 1.7 });
      fx.chips(box.center, 0xff9030, 32);
      render.lights.flash(box.center, 0xffa040, 20, 44, 0.45);
      audio.play('vehicle_explode', { position: box.center, volume: 1 });
      progression.award(500, box.label, box.center);
      hud.feed(`${box.label} DESTROYED`, '#ff7a30');
      box.unmark?.();
      box.unmark = null;
      if (box.id === 'trackL') this.skirtL.visible = false;
      if (box.id === 'trackR') this.skirtR.visible = false;
      if (box.id === 'turretF') this.turretFMesh.visible = false;
      if (box.id === 'turretA') this.turretAMesh.visible = false;
      if (box.id === 'launcher') this.launcherMesh.visible = false;
      if (box.id === 'engine') {
        this.engineGlow.visible = false;
        this.destroyCrawler();
      }
    }

    if (res.phaseChanged === 'drag') {
      audio.play('metal_groan', { position: this.position, pitch: 0.5, volume: 1 });
      hud.feed('OLD MOTHER IMMOBILIZED — STRIP HER WEAPONS', '#ffc14a');
      campaign.signal('mother:drag');
      this.refreshMarkers();
    } else if (res.phaseChanged === 'seizing') {
      this.beginSeize();
    }
  }

  private destroyCrawler(): void {
    const { audio, campaign, fx, hud, render } = this.ctx;
    this.clearMarkers();
    for (const z of [-10, -2, 6]) {
      this.localToWorld(0, 8.2, z, _p);
      fx.explosion(_p, { radius: 8, kind: 'rocket', scale: 2.1 });
      fx.embers(_p, 28, 4);
    }
    render.lights.flash(this.localToWorld(0, 9, -8, _p), 0xffa840, 32, 70, 0.7);
    audio.play('vehicle_explode', { position: this.position, volume: 1 });
    audio.play('explosion_debris', { position: this.position, volume: 1 });
    hud.feed('OLD MOTHER ENGINE DESTROYED', '#7ee787');
    campaign.signal('mother:engine');
  }

  // ---- Colliders & Markers ---------------------------------------------------------------------------------------

  private syncWorld(): void {
    this.root.position.copy(this.position);
    this.root.rotation.set(0, this.yaw, 0);
    _q.setFromAxisAngle(_up, this.yaw);
    this.localToWorld(0, 3.0, 0, _p);
    this.hullCollider.setTranslation(_p);
    this.hullCollider.setRotation(_q);
    for (const b of this.boxes) {
      this.localToWorld(b.local[0], b.local[1], b.local[2], b.center);
      b.collider.setTranslation(b.center);
      b.collider.setRotation(_q);
    }
  }

  private parkColliders(): void {
    _p.set(0, -1000, 0);
    this.hullCollider.setTranslation(_p);
    for (const b of this.boxes) b.collider.setTranslation(_p);
  }

  /** Solid walkable deck, bridge wall, waist-high cover blocks, and stern ramp for Phase 3. */
  private buildDeckColliders(): void {
    this.clearDeckColliders();
    const { physics } = this.ctx;
    _q.setFromAxisAngle(_up, this.yaw);
    const addBox = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, pitch = 0) => {
      const pos = this.localToWorld(lx, ly, lz, new THREE.Vector3());
      const c = physics.addStaticBox(pos, new THREE.Vector3(hx, hy, hz), null, 'metal');
      const rot = _q.clone();
      if (pitch !== 0) rot.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
      c.setRotation(rot);
      this.deckColliders.push(c);
    };
    // Thick 1.4 m walkable upper deck slab (top surface sits cleanly at CRAWLER.deckY = 6.4 m) — zero slam fall-through!
    addBox(0, CRAWLER.deckY - 0.7, -0.5, 5.4, 0.7, 13.0);
    // Aft bridge pilothouse superstructure (player can flank around either side to reach the stern engine).
    addBox(0, CRAWLER.deckY + 1.9, -1.8, 2.3, 1.9, 2.6);
    // Waist-high deck cover crates (4 spots across foredeck & middeck).
    addBox(-3.0, CRAWLER.deckY + 0.65, 3.2, 0.9, 0.65, 0.9);
    addBox(3.0, CRAWLER.deckY + 0.65, 2.2, 0.9, 0.65, 0.9);
    addBox(-3.2, CRAWLER.deckY + 0.65, -4.2, 0.85, 0.65, 1.1);
    addBox(3.2, CRAWLER.deckY + 0.65, -4.2, 0.85, 0.65, 1.1);
    // Solid stern access ramp from salt floor (y=0, z=-22.5) up to stern deck (y=6.4, z=-13.2) so falling off isn't a softlock.
    addBox(0, 3.1, -17.8, 2.6, 0.45, 5.8, -0.58);
  }

  private clearDeckColliders(): void {
    for (const c of this.deckColliders) this.ctx.physics.world.removeCollider(c, true);
    this.deckColliders.length = 0;
  }

  private refreshMarkers(): void {
    this.clearMarkers();
    const { hud } = this.ctx;
    if (this.state.phase === 'hunt') {
      for (const b of this.boxes) {
        if ((b.id === 'trackL' || b.id === 'trackR') && this.state.hp[b.id] > 0) {
          b.unmark = hud.follow(b.center, b.label, '#ff5a3a');
        }
      }
    } else if (this.state.phase === 'drag') {
      for (const b of this.boxes) {
        if ((b.id === 'turretF' || b.id === 'turretA' || b.id === 'launcher') && this.state.hp[b.id] > 0) {
          b.unmark = hud.follow(b.center, b.label, '#ff3b3b');
        }
      }
    } else if (this.state.phase === 'deck') {
      const eng = this.boxes.find(b => b.id === 'engine');
      if (eng && this.state.hp.engine > 0) eng.unmark = hud.follow(eng.center, 'STERN ENGINE', '#ff3b3b');
    }
  }

  private clearMarkers(): void {
    for (const b of this.boxes) {
      b.unmark?.();
      b.unmark = null;
    }
  }

  // ---- AAA Procedural Model --------------------------------------------------------------------------------------

  private buildModel(): void {
    const mat = this.materials;
    const hull = new ModelBuilder();

    // Main armoured chassis & sloped industrial prow.
    hull
      .solid(chamferBox(9.2, 4.4, 24.0, 0.25), '#363b40', { at: [0, 4.0, -0.5] })
      .solid(chamferBox(8.6, 2.2, 4.6, 0.2), '#2b2f34', { at: [0, 3.8, 11.4], rot: [0.35, 0, 0] })
      // Walkable deck plate + industrial grating strips.
      .solid(chamferBox(10.6, 0.45, 25.4, 0.08), '#494e52', { at: [0, CRAWLER.deckY - 0.22, -0.5] })
      // Holdfast folk-art painted flank murals (ochre, sea-teal, magenta, cream stripes).
      .box(0.14, 1.4, 18.5, '#e09a26', { at: [-4.68, 4.7, -0.5] })
      .box(0.14, 1.0, 15.0, '#23879c', { at: [-4.72, 3.4, -0.5] })
      .box(0.14, 0.55, 11.0, '#b83c6a', { at: [-4.75, 5.6, -0.5] })
      .box(0.14, 1.4, 18.5, '#e09a26', { at: [4.68, 4.7, -0.5] })
      .box(0.14, 1.0, 15.0, '#23879c', { at: [4.72, 3.4, -0.5] })
      .box(0.14, 0.55, 11.0, '#b83c6a', { at: [4.75, 5.6, -0.5] })
      // Aft bridge superstructure with slit windows & radar mast.
      .solid(chamferBox(4.8, 3.8, 5.4, 0.2), '#3e4449', { at: [0, CRAWLER.deckY + 1.9, -1.8] })
      .solid(chamferBox(5.2, 0.45, 5.8, 0.08), '#2c3035', { at: [0, CRAWLER.deckY + 3.9, -1.8] })
      .glow(new THREE.BoxGeometry(3.6, 0.42, 0.14), '#ffae42', 2.8, { at: [0, CRAWLER.deckY + 2.6, 0.92] })
      // Twin heavy diesel smokestacks.
      .cyl(0.55, 0.7, 5.2, 10, '#26292d', { at: [-2.4, CRAWLER.deckY + 2.4, -7.2] })
      .cyl(0.55, 0.7, 5.2, 10, '#26292d', { at: [2.4, CRAWLER.deckY + 2.4, -7.2] })
      // Waist-high deck cover crates & stern ramp geometry.
      .solid(chamferBox(1.8, 1.3, 1.8, 0.08), '#6b563c', { at: [-3.0, CRAWLER.deckY + 0.65, 3.2] })
      .solid(chamferBox(1.8, 1.3, 1.8, 0.08), '#5a6354', { at: [3.0, CRAWLER.deckY + 0.65, 2.2] })
      .solid(chamferBox(1.7, 1.3, 2.2, 0.08), '#6b563c', { at: [-3.2, CRAWLER.deckY + 0.65, -4.2] })
      .solid(chamferBox(1.7, 1.3, 2.2, 0.08), '#5a6354', { at: [3.2, CRAWLER.deckY + 0.65, -4.2] })
      // Stern access ramp (visual matching collider).
      .solid(chamferBox(5.0, 0.5, 11.4, 0.06), '#3c4045', { at: [0, 3.1, -17.8], rot: [-0.58, 0, 0] })
      // Stern engine armoured housing cradle.
      .solid(chamferBox(5.2, 2.6, 3.2, 0.14), '#2d3136', { at: [0, CRAWLER.deckY + 1.2, -11.4] })
      // Fore & aft warm floodlights.
      .glow(new THREE.BoxGeometry(1.1, 0.45, 0.2), '#ffe2a4', 3.4, { at: [-3.6, 5.8, 11.6] })
      .glow(new THREE.BoxGeometry(1.1, 0.45, 0.2), '#ffe2a4', 3.4, { at: [3.6, 5.8, 11.6] })
      .glow(new THREE.BoxGeometry(0.9, 0.35, 0.2), '#ff6b38', 2.8, { at: [-3.8, 5.9, -12.6] })
      .glow(new THREE.BoxGeometry(0.9, 0.35, 0.2), '#ff6b38', 2.8, { at: [3.8, 5.9, -12.6] });

    // Holdfast bunting flags along the deck edge.
    const dyes = ['#f29e1f', '#1f9ec7', '#db4785', '#3db36b', '#f5d64c'];
    for (let i = 0; i < 10; i++) {
      const z = -9 + i * 2.1;
      const col = dyes[i % dyes.length]!;
      hull.box(0.06, 0.55, 0.45, col, { at: [-5.32, CRAWLER.deckY + 0.55, z] });
      hull.box(0.06, 0.55, 0.45, col, { at: [5.32, CRAWLER.deckY + 0.55, z] });
    }

    // Track base beams & 6 rotating bogie wheels per side.
    for (const sx of [-5.8, 5.8]) {
      hull.solid(chamferBox(2.4, 2.2, 23.0, 0.16), '#1f2226', { at: [sx, 1.5, 0] });
    }
    const hullGroup = mat.group(hull);
    this.root.add(hullGroup);

    const wheelGeo = new THREE.CylinderGeometry(1.1, 1.1, 2.7, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelB = new ModelBuilder().solid(wheelGeo, '#2e3136').cyl(0.45, 0.45, 2.9, 8, '#7c623a', { rot: [0, 0, Math.PI / 2] });
    const wheelSolid = wheelB.solidGeometry()!;
    for (const sx of [-5.8, 5.8]) {
      for (let i = 0; i < 6; i++) {
        const wz = -9.5 + i * 3.8;
        const m = new THREE.Mesh(wheelSolid, mat.solid);
        m.position.set(sx, 1.15, wz);
        this.root.add(m);
        this.wheels.push(m);
      }
    }

    // Breakable armoured track skirts (Port & Starboard).
    const makeSkirt = (sx: number) => {
      const b = new ModelBuilder()
        .solid(chamferBox(0.55, 2.1, 22.4, 0.12), '#5b5245', { at: [sx * 7.0, 2.1, 0] })
        .solid(chamferBox(2.9, 0.45, 22.8, 0.1), '#45494e', { at: [sx * 5.8, 3.25, 0] })
        .box(0.12, 0.45, 20.5, '#d99e26', { at: [sx * 7.3, 2.4, 0] });
      const g = mat.group(b);
      this.root.add(g);
      return g;
    };
    this.skirtL = makeSkirt(-1);
    this.skirtR = makeSkirt(1);

    // Bow Rotating Salt-Cutter Wheel (10 m wide, 12 industrial teeth).
    this.cutter = new THREE.Group();
    this.cutter.position.set(0, 2.2, 13.6);
    const cutB = new ModelBuilder()
      .cyl(1.45, 1.45, 10.2, 14, '#393d42', { rot: [0, 0, Math.PI / 2] })
      .cyl(0.65, 0.65, 11.4, 10, '#6e4e2e', { rot: [0, 0, Math.PI / 2] });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const xOff = ((i % 4) - 1.5) * 2.2;
      cutB.solid(chamferBox(1.8, 0.75, 0.38, 0.06), i % 2 === 0 ? '#a85a24' : '#787e85', {
        at: [xOff, Math.cos(a) * 1.65, Math.sin(a) * 1.65],
        rot: [a, 0, 0],
      });
    }
    this.cutter.add(mat.group(cutB));
    this.root.add(this.cutter);

    // Fore & Aft Deck Gun Turrets.
    const makeTurret = (z: number) => {
      const g = new THREE.Group();
      g.position.set(0, CRAWLER.deckY + 0.1, z);
      const b = new ModelBuilder()
        .cyl(1.45, 1.6, 0.5, 12, '#2a2d32', { at: [0, 0.25, 0] })
        .solid(chamferBox(2.4, 1.3, 2.8, 0.14), '#4c5746', { at: [0, 1.05, -0.1] })
        .cyl(0.14, 0.18, 3.6, 8, '#1e2125', { at: [-0.42, 1.1, 2.2], rot: [Math.PI / 2, 0, 0] })
        .cyl(0.14, 0.18, 3.6, 8, '#1e2125', { at: [0.42, 1.1, 2.2], rot: [Math.PI / 2, 0, 0] })
        .glow(new THREE.BoxGeometry(0.7, 0.18, 0.12), '#ff5430', 3.0, { at: [0, 1.45, 1.35] });
      g.add(mat.group(b));
      this.root.add(g);
      return g;
    };
    this.turretFMesh = makeTurret(5.2);
    this.turretAMesh = makeTurret(-5.2);

    // Dorsal 4-tube Missile Pod atop the bridge.
    this.launcherMesh = new THREE.Group();
    this.launcherMesh.position.set(0, CRAWLER.deckY + 4.1, -1.5);
    const podB = new ModelBuilder()
      .solid(chamferBox(2.6, 1.4, 2.4, 0.14), '#5e4b3a', { at: [0, 0.7, 0] })
      .glow(new THREE.BoxGeometry(1.9, 0.24, 0.12), '#ff3c28', 3.2, { at: [0, 1.1, 1.24] });
    for (const sx of [-0.65, 0.65]) {
      for (const sy of [0.45, 0.98]) {
        podB.cyl(0.24, 0.24, 2.7, 8, '#23262b', { at: [sx, sy, 0.15], rot: [Math.PI / 2, 0, 0] });
      }
    }
    this.launcherMesh.add(mat.group(podB));
    this.root.add(this.launcherMesh);

    // Glowing exposed Stern Engine Core (Phase 3 target).
    const engGeo = chamferBox(3.4, 1.8, 2.0, 0.14);
    const engB = new ModelBuilder().glow(engGeo, '#ff7224', 3.6);
    this.engineGlow = new THREE.Mesh(engB.glowGeometry()!, mat.glow);
    this.engineGlow.position.set(0, CRAWLER.deckY + 1.5, -11.4);
    this.root.add(this.engineGlow);

    // Collect key meshes for Frame gunner highlight.
    for (const grp of [this.skirtL, this.skirtR, this.turretFMesh, this.turretAMesh, this.launcherMesh, this.cutter]) {
      grp.traverse(o => { if ((o as THREE.Mesh).isMesh) this.highlightList.push(o); });
    }
  }

  dispose(): void {
    this.vehicles?.removeExtra(this);
    this.rumbleLoop?.stop(0.2);
    this.rumbleLoop = null;
    this.clearMarkers();
    this.clearDeckColliders();
    this.ctx.physics.world.removeCollider(this.hullCollider, true);
    for (const b of this.boxes) this.ctx.physics.world.removeCollider(b.collider, true);
    this.root.removeFromParent();
  }
}
