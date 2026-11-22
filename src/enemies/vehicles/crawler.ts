/**
 * Old Mother: Holdfast's 30 m x 14 m x 12 m painted salt-harvesting crawler (Foreclosure Boss).
 *
 * Active three-stage boss fight — dangerous from start to finish:
 *   1. Hunt   — patrols the salt pans ellipse (`PANS.loop`), firing dual deck turrets, dorsal missile pod,
 *               and telegraphed bow cutter sweeps. Break both tracks (1500 HP each) to cripple her drive.
 *   2. Drag   — enraged! Even with tracks wrecked she fires auxiliary thruster-assisted lunges, high-arc
 *               telegraphed red-ring mortar salvos, close-range superheated steam shockwaves, and recessed
 *               hull autocannons until her remaining outer guns are stripped (or her reactor overheats).
 *   3. Deck   — Stern Reactor armored shroud doors blow open immediately on the Salt Pans, revealing a massive
 *               pulsing molten-orange Stern Engine (1600 HP) with heat fins, roaring vertical flame column,
 *               intense orange PointLight, klaxon alarm, and HUD beacon. Destroyable from the Frame (105mm
 *               Howitzer, 40mm, missiles, rotary) OR on foot via the walkable deck & stern ramp. Old Mother
 *               keeps pivoting and firing desperate mortar rings, steam vents, and bow sweeps until she blows
 *               apart in a multi-stage hull chain detonation (`mother:engine` + `mother:destroyed`).
 *
 * `CrawlerState` is pure state + phase math so unit tests can verify every transition and part pool directly.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ctx, ExplosionKind, LoopHandle } from '../../core/contracts';
import type { ExplosionSpec, MissileTarget } from '../../core/gameplay';
import { clamp, dampAngle, rand, wrapAngle } from '../../core/math';
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
    engine: 1600,
  },
  speedFull: 9.5,
  speedCrippled: 4.8,
  turnRate: 0.42,
  dragTurnRate: 1.15,
  deckTurnRate: 0.36,
  sweepReach: 21,
  sweepDamage: 320,
  sweepWindup: 1.25,
  sweepCooldown: 8.5,
  turretEvery: 2.2,
  turretDamage: 48,
  missileEvery: 7.5,
  missileDamage: 165,
  // Phase 2 enraged & Phase 3 exposed active attacks
  lungeWindup: 1.0,
  lungeDuration: 1.15,
  lungeSpeed: 15.5,
  lungeCooldown: 7.5,
  lungeDamage: 240,
  lungeReach: 16.5,
  mortarEvery: 6.5,
  mortarDeckEvery: 7.5,
  mortarCount: 3,
  mortarWarning: 1.65,
  mortarRadius: 5.5,
  mortarDamage: 145,
  steamReach: 14.5,
  steamWindup: 0.85,
  steamCooldown: 5.5,
  steamDamage: 125,
  casemateEvery: 1.65,
  casemateDamage: 34,
  /** Seconds in Phase 2 before Old Mother's overloaded Stern Reactor hatches blow open automatically. */
  dragMaxSeconds: 28,
  seizeSeconds: 1.6,
} as const;

export interface CrawlerPartHit {
  part: CrawlerPartId;
  dealt: number;
  broke: boolean;
  phaseChanged: CrawlerPhase | null;
}

/** Pure state machine for Old Mother's parts and active 3-stage boss fight. */
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

  get engineExposed(): boolean {
    return this.phase === 'deck' && this.hp.engine > 0;
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
      case 'drag': return 'OLD MOTHER — ENRAGED · STRIP HER WEAPONS';
      case 'seizing': return 'OLD MOTHER — REACTOR OVERLOAD!';
      case 'deck': return 'OLD MOTHER — STERN ENGINE EXPOSED · DESTROY';
      case 'dead': return 'OLD MOTHER — DESTROYED';
      default: return 'OLD MOTHER';
    }
  }

  hit(part: CrawlerPartId, amount: number): CrawlerPartHit {
    if (amount <= 0 || this.phase === 'dead' || this.phase === 'dormant') {
      return { part, dealt: 0, broke: false, phaseChanged: null };
    }
    // Engine is vulnerable once its rear shroud blows open (`deck` phase); external parts in Hunt / Drag.
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
      // Immediately blow open the Stern Reactor hatches — no forced-eject brick wall!
      this.phase = 'deck';
      phaseChanged = 'deck';
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
      this.phase = 'deck';
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

interface DeckColliderEntry {
  readonly collider: RAPIER.Collider;
  readonly lx: number;
  readonly ly: number;
  readonly lz: number;
  readonly pitch: number;
}

interface MortarStrike {
  readonly pos: THREE.Vector3;
  readonly radius: number;
  readonly ringMesh: THREE.Mesh;
  readonly fillMesh: THREE.Mesh;
  elapsed: number;
  readonly duration: number;
}

interface ChainBlast {
  delay: number;
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
  readonly scale: number;
}

const _p = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pitchQ = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _xAxis = new THREE.Vector3(1, 0, 0);

const PART_SPECS: readonly { id: CrawlerPartId; local: readonly [number, number, number]; half: readonly [number, number, number]; label: string }[] = [
  { id: 'trackL', local: [-5.8, 1.8, 0], half: [1.7, 1.8, 11.5], label: 'PORT TRACK' },
  { id: 'trackR', local: [5.8, 1.8, 0], half: [1.7, 1.8, 11.5], label: 'STARBOARD TRACK' },
  { id: 'turretF', local: [0, 7.6, 5.2], half: [1.7, 1.2, 1.9], label: 'FORE TURRET' },
  { id: 'turretA', local: [0, 7.6, -5.2], half: [1.7, 1.2, 1.9], label: 'AFT TURRET' },
  { id: 'launcher', local: [0, 11.0, -1.5], half: [1.5, 1.0, 1.6], label: 'MISSILE POD' },
  { id: 'engine', local: [0, 7.6, -11.6], half: [3.4, 2.6, 2.6], label: 'STERN ENGINE' },
];

const PANS_MIN_X = PANS.x0 + 18;
const PANS_MAX_X = PANS.x1 - 18;
const PANS_MIN_Z = PANS.z0 + 18;
const PANS_MAX_Z = PANS.z1 - 18;

export class OldMother implements ExtraTarget {
  readonly state = new CrawlerState();
  readonly position = new THREE.Vector3(-90, 0, -10);
  yaw = Math.PI;
  readonly root = new THREE.Group();

  private readonly materials: ModelMaterials;
  private readonly boxes: HitBox[] = [];
  private readonly byHandle = new Map<number, HitBox>();
  private readonly hullCollider: RAPIER.Collider;
  private readonly deckColliders: DeckColliderEntry[] = [];
  private readonly highlightList: THREE.Object3D[] = [];

  private cutter!: THREE.Group;
  private turretFMesh!: THREE.Group;
  private turretAMesh!: THREE.Group;
  private launcherMesh!: THREE.Group;
  private skirtL!: THREE.Group;
  private skirtR!: THREE.Group;
  private engineShroudL!: THREE.Group;
  private engineShroudR!: THREE.Group;
  private engineCoreGroup!: THREE.Group;
  private engineGlow!: THREE.Mesh;
  private engineFlame!: THREE.Mesh;
  private engineLight!: THREE.PointLight;
  private thrusterFlames!: THREE.Group;
  private readonly wheels: THREE.Object3D[] = [];

  private readonly mortars: MortarStrike[] = [];
  private readonly chainBlasts: ChainBlast[] = [];
  private readonly mortarRingGeo = new THREE.RingGeometry(0.84, 1.0, 28);
  private readonly mortarFillGeo = new THREE.CircleGeometry(0.84, 28);

  private loopAngle = -Math.PI * 0.45;
  private cutterAngle = 0;
  private sweepWindup = -1;
  private sweepCooldown = 3;
  private turretFIn = 2.0;
  private turretAIn = 3.1;
  private missileIn = 5.5;
  private lungeWindup = -1;
  private lungeLeft = 0;
  private lungeCooldown = 4.5;
  private lungeDealt = false;
  private mortarIn = 4.0;
  private steamWindup = -1;
  private steamCooldown = 3.0;
  private casemateIn = 1.4;
  private casemateSide = 1;
  private seizeLeft = -1;
  private smokeIn = 0;
  private engineFxIn = 0;
  private rumbleLoop: LoopHandle | null = null;
  private alarmLoop: LoopHandle | null = null;
  private onSeizeHook: (() => void) | null = null;

  constructor(private readonly ctx: Ctx, private readonly vehicles: VehicleSystem | null) {
    this.mortarRingGeo.rotateX(-Math.PI / 2);
    this.mortarFillGeo.rotateX(-Math.PI / 2);

    this.materials = new ModelMaterials(ctx);
    this.buildModel();
    this.root.visible = false;
    ctx.render.scene.add(this.root);

    this.hullCollider = ctx.physics.addStaticBox(new THREE.Vector3(0, -1000, 0), new THREE.Vector3(4.6, 3.0, 11.2), null, 'metal');
    for (const spec of PART_SPECS) {
      const center = new THREE.Vector3();
      const collider = ctx.physics.addStaticBox(new THREE.Vector3(0, -1000, 0), new THREE.Vector3(...spec.half), null, 'metal');
      const boxAlive = (): boolean => {
        if (spec.id === 'engine') return this.state.phase === 'deck' && this.state.hp.engine > 0;
        return (this.state.phase === 'hunt' || this.state.phase === 'drag') && this.state.hp[spec.id] > 0;
      };
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
            return boxAlive();
          },
          aimLift: spec.id === 'engine' ? 0.8 : 0.4,
          paintRadius: Math.max(spec.half[0], spec.half[1], spec.half[2]),
        },
      };
      this.boxes.push(box);
      this.byHandle.set(collider.handle, box);
    }

    this.vehicles?.addExtra(this);
  }

  get engineExposed(): boolean {
    return this.state.engineExposed;
  }

  barFraction(): number {
    return this.state.barFraction();
  }

  barLabel(): string {
    return this.state.barLabel();
  }

  /** Backward-compatible hook retained for mission scripts that listen to `seizing`. */
  setSeizeHook(fn: (() => void) | null): void {
    this.onSeizeHook = fn;
  }

  /** Shows Old Mother patrolling in the distance on the salt pans (`pans` section). */
  reveal(): void {
    this.state.reset();
    this.state.phase = 'dormant';
    this.clearDeckColliders();
    this.clearMortars();
    this.chainBlasts.length = 0;
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
    this.clearMortars();
    this.chainBlasts.length = 0;
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
    this.lungeWindup = -1;
    this.lungeLeft = 0;
    this.lungeCooldown = 5.0;
    this.mortarIn = 4.5;
    this.steamWindup = -1;
    this.steamCooldown = 3.0;
    this.casemateIn = 1.6;
    this.turretFIn = 2.0;
    this.turretAIn = 3.2;
    this.missileIn = 5.5;
    this.alarmLoop?.stop(0.2);
    this.alarmLoop = null;
    this.syncWorld();
    this.refreshMarkers();
    this.rumbleLoop ??= this.ctx.audio.startLoop('tank_turret_loop', { position: this.position, volume: 0.65, pitch: 0.55 });
  }

  /**
   * Opens the Stern Reactor housing, builds walkable deck colliders, and enters the exposed Stern Engine stage.
   * Retained with identical signature for checkpoint / `?beat=deck` compatibility.
   */
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
    this.lungeWindup = -1;
    this.lungeLeft = 0;
    this.thrusterFlames.visible = false;
    this.mortarIn = 4.2;
    this.steamWindup = -1;
    this.steamCooldown = 3.5;
    this.casemateIn = 2.2;
    this.buildDeckColliders();
    this.showExposedEngine(false);
    this.syncWorld();
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
    this.lungeWindup = -1;
    this.lungeLeft = 0;
    this.steamWindup = -1;
    this.thrusterFlames.visible = false;
    this.engineLight.intensity = 0;
    this.rumbleLoop?.stop(0.3);
    this.rumbleLoop = null;
    this.alarmLoop?.stop(0.3);
    this.alarmLoop = null;
    this.chainBlasts.length = 0;
    this.clearMortars();
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
    this.engineShroudL.visible = true;
    this.engineShroudR.visible = true;
    this.engineCoreGroup.visible = false;
    this.engineFlame.visible = false;
    this.engineLight.intensity = 0;
    this.thrusterFlames.visible = false;
  }

  private showExposedEngine(dramatic: boolean): void {
    const { audio, campaign, fx, hud, render } = this.ctx;
    this.engineShroudL.visible = false;
    this.engineShroudR.visible = false;
    this.engineCoreGroup.visible = true;
    this.engineGlow.visible = true;
    this.engineFlame.visible = true;
    this.engineLight.intensity = 26;

    const engCenter = this.localToWorld(0, 7.6, -11.6, _p);
    if (dramatic) {
      // Blow armored rear shroud plates off in a shower of molten sparks.
      fx.explosion(engCenter, { radius: 7.5, kind: 'rocket', scale: 1.9 });
      fx.chips(engCenter, 0xff7820, 42);
      fx.embers(engCenter, 36, 4.5);
      render.lights.flash(engCenter, 0xff8024, 34, 64, 0.65);
      audio.play('plate_destroyed', { position: engCenter, pitch: 0.72, volume: 1 });
      audio.play('boss_alarm', { volume: 0.75 });
      hud.feed('STERN ENGINE EXPOSED — BLAST THE GLOWING REAR CORE!', '#ffc14a');
      campaign.signal('mother:exposed');
    }
    this.alarmLoop ??= audio.startLoop('alarm_klaxon', { position: engCenter, volume: 0.55, pitch: 1.12 });
  }

  /** Blows off any leftover outer turrets and opens the Stern Reactor hatches immediately. */
  private exposeEngineNow(): void {
    const { fx, audio } = this.ctx;
    for (const id of ['turretF', 'turretA', 'launcher'] as const) {
      if (this.state.hp[id] > 0) {
        this.state.hp[id] = 0;
        const b = this.boxes.find(x => x.id === id);
        if (b) {
          fx.explosion(b.center, { radius: 5, kind: 'rocket', scale: 1.3 });
          audio.play('plate_destroyed', { position: b.center, volume: 0.75 });
        }
      }
    }
    this.turretFMesh.visible = false;
    this.turretAMesh.visible = false;
    this.launcherMesh.visible = false;
    this.lungeWindup = -1;
    this.lungeLeft = 0;
    this.thrusterFlames.visible = false;
    this.buildDeckColliders();
    this.showExposedEngine(true);
    this.syncWorld();
    this.refreshMarkers();
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

    // Always advance active telegraphed mortar rings so rings never freeze mid-flight.
    this.updateMortars(dt);

    if (phase === 'dormant') {
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
      this.updateChainDetonations(dt);
      this.emitStacks(dt, 0.28);
      return;
    }

    if (phase === 'seizing') {
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
      // Enraged Phase 2: aggressive thruster-assisted pivots + forward thruster lunges!
      this.updateThrusterLunge(dt);
      if (this.lungeLeft <= 0) {
        const wantYaw = Math.atan2(player.position.x - this.position.x, player.position.z - this.position.z);
        this.yaw = dampAngle(this.yaw, wantYaw, CRAWLER.dragTurnRate, dt);
      }
      if (this.state.tickDrag(dt)) {
        this.exposeEngineNow();
      }
    } else if (phase === 'deck') {
      // Phase 3 (Stern Engine Exposed): still pivots slowly & stays lethal until destroyed!
      const wantYaw = Math.atan2(player.position.x - this.position.x, player.position.z - this.position.z);
      this.yaw = dampAngle(this.yaw, wantYaw, CRAWLER.deckTurnRate, dt);
      this.updateExposedEngineVisuals(dt);
    }

    // Bow cutter wheel spin & telegraphed bow sweep (active across Hunt, Drag, AND Deck!).
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
      this.cutterAngle += (phase === 'deck' ? 3.5 : 2.4) * dt;
      if (distBow < CRAWLER.sweepReach && this.sweepCooldown <= 0 && player.alive) {
        this.sweepWindup = CRAWLER.sweepWindup;
        audio.play('metal_groan', { position: bow, pitch: 0.55, volume: 1 });
        audio.play('titan_charge', { position: bow, pitch: 0.65, volume: 0.9 });
        this.ctx.hud.feed('OLD MOTHER — CUTTER SWEEP INCOMING!', '#ff7a30');
      }
    }
    this.cutter.rotation.x = this.cutterAngle;

    // Deck turrets & dorsal missile pod (Phase 1 & 2).
    if (phase === 'hunt' || phase === 'drag') {
      this.updateWeapons(dt);
    }

    // Active enraged defenses (Phase 2 Drag & Phase 3 Exposed Stern Engine).
    if (phase === 'drag' || phase === 'deck') {
      this.updateMortarLauncher(dt, phase === 'deck' ? CRAWLER.mortarDeckEvery : CRAWLER.mortarEvery);
      this.updateSteamVent(dt);
      this.updateHullCasemates(dt, phase === 'deck' ? CRAWLER.casemateEvery * 1.4 : CRAWLER.casemateEvery);
    }

    this.syncWorld();
    this.emitStacks(dt, 0.25);
    this.rumbleLoop?.setPosition(this.position);
    if (this.alarmLoop) {
      this.localToWorld(0, 7.6, -11.6, _p);
      this.alarmLoop.setPosition(_p);
    }
  }

  private updateThrusterLunge(dt: number): void {
    const { player, audio, fx, hud, camera } = this.ctx;
    if (this.lungeLeft > 0) {
      this.lungeLeft -= dt;
      this.thrusterFlames.visible = true;
      const pulse = 0.85 + Math.sin(this.ctx.time.elapsed * 32) * 0.25;
      this.thrusterFlames.scale.set(1, 1, pulse);
      this.position.x = clamp(this.position.x + Math.sin(this.yaw) * CRAWLER.lungeSpeed * dt, PANS_MIN_X, PANS_MAX_X);
      this.position.z = clamp(this.position.z + Math.cos(this.yaw) * CRAWLER.lungeSpeed * dt, PANS_MIN_Z, PANS_MAX_Z);
      this.cutterAngle += 14 * dt;

      // Exhaust & salt plow FX
      this.localToWorld(0, 2.2, -13.5, _p);
      fx.smoke(_p, 0xffb060, 2.4, 1.4);
      this.localToWorld(0, 1.4, 13.5, _p2);
      fx.dust(_p2, _up, 1.8);

      // Impact damage if bow catches the player during the lunge.
      if (!this.lungeDealt && player.alive && _p2.distanceTo(player.position) <= CRAWLER.lungeReach) {
        this.lungeDealt = true;
        player.takeDamage({ amount: CRAWLER.lungeDamage, from: _p2, type: 'crush', source: 'crawler_lunge' });
        _dir.subVectors(player.position, this.position).setY(0.35).normalize().multiplyScalar(16);
        player.push(_dir);
        fx.slam(_p2, 3.0);
        audio.play('titan_stomp', { position: _p2, pitch: 0.72, volume: 1 });
        camera.addTrauma(0.85);
      }

      if (this.lungeLeft <= 0) {
        this.thrusterFlames.visible = false;
        this.lungeCooldown = CRAWLER.lungeCooldown;
        fx.slam(this.localToWorld(0, 1.2, 12.0, _p), 2.4);
      }
      return;
    }

    if (this.lungeWindup >= 0) {
      this.lungeWindup -= dt;
      this.thrusterFlames.visible = true;
      this.thrusterFlames.scale.set(0.65, 0.65, 0.65 + (1 - Math.max(0, this.lungeWindup) / CRAWLER.lungeWindup) * 0.7);
      this.localToWorld(0, 2.4, -13.2, _p);
      fx.smoke(_p, 0xe8d8c0, 1.8, 1.0);
      if (this.lungeWindup <= 0) {
        this.lungeWindup = -1;
        this.lungeLeft = CRAWLER.lungeDuration;
        this.lungeDealt = false;
        audio.play('steam_burst', { position: _p, pitch: 0.58, volume: 1 });
        audio.play('vehicle_explode', { position: _p, pitch: 0.65, volume: 0.55 });
      }
      return;
    }

    this.thrusterFlames.visible = false;
    this.lungeCooldown = Math.max(0, this.lungeCooldown - dt);
    const dist = this.position.distanceTo(player.position);
    if (this.lungeCooldown <= 0 && player.alive && dist > 15 && dist < 72) {
      this.lungeWindup = CRAWLER.lungeWindup;
      audio.play('titan_charge', { position: this.position, pitch: 0.75, volume: 0.95 });
      hud.feed('OLD MOTHER — AUXILIARY THRUSTER LUNGE!', '#ff6a28');
    }
  }

  private updateMortarLauncher(dt: number, interval: number): void {
    const { player, audio, fx, hud } = this.ctx;
    if (!player.alive) return;
    this.mortarIn -= dt;
    if (this.mortarIn > 0) return;
    this.mortarIn = interval + rand(-0.6, 0.9);
    if (this.position.distanceTo(player.position) > 150) return;

    const origin = this.localToWorld(0, 9.8, -4.5, _p);
    audio.play('tank_cannon', { position: origin, pitch: 0.7, volume: 0.85 });
    audio.play('missile_incoming', { volume: 0.55 });
    fx.muzzleFlash(origin, _up, 'rocket');
    fx.smoke(origin, 0xd4ccc0, 2.6, 2.4);
    hud.feed('OLD MOTHER — MORTAR BARRAGE · CLEAR RED RINGS!', '#ff4430');

    for (let i = 0; i < CRAWLER.mortarCount; i++) {
      // First shell leads player's velocity; extra shells bracket flanking escape lanes.
      const lead = i === 0 ? 0.65 : 0.25;
      const spread = i === 0 ? 2.5 : 11.5;
      const angle = (i / CRAWLER.mortarCount) * Math.PI * 2 + rand(-0.4, 0.4);
      const tx = clamp(
        player.position.x + player.velocity.x * lead + (i === 0 ? rand(-spread, spread) : Math.cos(angle) * rand(6, spread)),
        PANS.x0 + 6,
        PANS.x1 - 6,
      );
      const tz = clamp(
        player.position.z + player.velocity.z * lead + (i === 0 ? rand(-spread, spread) : Math.sin(angle) * rand(6, spread)),
        PANS.z0 + 6,
        PANS.z1 - 6,
      );
      this.spawnMortarRing(new THREE.Vector3(tx, 0.08, tz), CRAWLER.mortarRadius, CRAWLER.mortarWarning + i * 0.22);
    }
  }

  private spawnMortarRing(pos: THREE.Vector3, radius: number, duration: number): void {
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff2b1c,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xff4218,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ringMesh = new THREE.Mesh(this.mortarRingGeo, ringMat);
    const fillMesh = new THREE.Mesh(this.mortarFillGeo, fillMat);
    ringMesh.position.copy(pos);
    fillMesh.position.set(pos.x, pos.y + 0.01, pos.z);
    ringMesh.scale.setScalar(radius);
    fillMesh.scale.setScalar(0.1);
    this.ctx.render.scene.add(ringMesh, fillMesh);
    this.mortars.push({ pos, radius, ringMesh, fillMesh, elapsed: 0, duration });
  }

  private updateMortars(dt: number): void {
    const { audio, camera, fx, player, render } = this.ctx;
    for (let i = this.mortars.length - 1; i >= 0; i--) {
      const m = this.mortars[i]!;
      m.elapsed += dt;
      const t = clamp(m.elapsed / m.duration);
      const pulse = 0.72 + Math.sin(m.elapsed * 22) * 0.28;
      m.fillMesh.scale.setScalar(Math.max(0.1, m.radius * t));
      (m.ringMesh.material as THREE.MeshBasicMaterial).opacity = 0.55 + pulse * 0.4;
      (m.fillMesh.material as THREE.MeshBasicMaterial).opacity = 0.14 + t * 0.34;

      if (m.elapsed >= m.duration) {
        m.ringMesh.removeFromParent();
        m.fillMesh.removeFromParent();
        (m.ringMesh.material as THREE.Material).dispose();
        (m.fillMesh.material as THREE.Material).dispose();
        this.mortars.splice(i, 1);

        fx.explosion(m.pos, { radius: m.radius, kind: 'shell', scale: 1.55 });
        fx.slam(m.pos, 2.2);
        fx.embers(m.pos, 18, 3.0);
        render.lights.flash(m.pos, 0xff7824, 18, 36, 0.32);
        audio.play('rocket_explosion', { position: m.pos, volume: 0.9 });
        const dist = Math.hypot(player.position.x - m.pos.x, player.position.z - m.pos.z);
        if (player.alive && dist <= m.radius + 1.2) {
          const falloff = clamp(1 - dist / (m.radius + 2.5), 0.45, 1);
          player.takeDamage({ amount: CRAWLER.mortarDamage * falloff, from: m.pos, type: 'explosive', source: 'crawler_mortar' });
          camera.addTrauma(0.65);
        }
      }
    }
  }

  private clearMortars(): void {
    for (const m of this.mortars) {
      m.ringMesh.removeFromParent();
      m.fillMesh.removeFromParent();
      (m.ringMesh.material as THREE.Material).dispose();
      (m.fillMesh.material as THREE.Material).dispose();
    }
    this.mortars.length = 0;
  }

  private updateSteamVent(dt: number): void {
    const { audio, camera, fx, hud, player } = this.ctx;
    this.steamCooldown = Math.max(0, this.steamCooldown - dt);
    if (this.steamWindup >= 0) {
      this.steamWindup -= dt;
      for (const sx of [-4.8, 4.8]) {
        this.localToWorld(sx, 3.6, rand(-7, 7), _p);
        fx.smoke(_p, 0xeaeef0, 2.2, 1.0);
      }
      if (this.steamWindup <= 0) {
        this.steamWindup = -1;
        this.steamCooldown = CRAWLER.steamCooldown;
        const center = this.localToWorld(0, 3.2, 0, _p);
        fx.ring(center, _up, '#ffd8a8', CRAWLER.steamReach);
        fx.heatShimmer(center, CRAWLER.steamReach, 2.2);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          _p2.set(center.x + Math.cos(a) * 6.5, 2.6, center.z + Math.sin(a) * 6.5);
          fx.smoke(_p2, 0xf2f4f6, 3.8, 2.2);
        }
        audio.play('steam_burst', { position: center, pitch: 0.65, volume: 1 });
        audio.play('titan_stomp', { position: center, pitch: 0.9, volume: 0.7 });
        // Only hits ground/Frame-height huggers around the hull (so players fighting ON the deck y>=6 aren't punished unfairly).
        const horizDist = Math.hypot(player.position.x - center.x, player.position.z - center.z);
        if (player.alive && horizDist <= CRAWLER.steamReach + 1.5 && player.position.y < CRAWLER.deckY - 1.2) {
          player.takeDamage({ amount: CRAWLER.steamDamage, from: center, type: 'fire', source: 'crawler_steam' });
          _dir.set(player.position.x - center.x, 0.25, player.position.z - center.z).normalize().multiplyScalar(14);
          player.push(_dir);
          camera.addTrauma(0.6);
        }
      }
      return;
    }

    const horizDist = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
    if (this.steamCooldown <= 0 && player.alive && horizDist <= CRAWLER.steamReach && player.position.y < CRAWLER.deckY - 1.2) {
      this.steamWindup = CRAWLER.steamWindup;
      audio.play('steam_burst', { position: this.position, pitch: 1.25, volume: 0.85 });
      hud.feed('OLD MOTHER — SUPERHEATED STEAM VENT · BACK OFF!', '#ff9638');
    }
  }

  private updateHullCasemates(dt: number, interval: number): void {
    const { player, fx, audio } = this.ctx;
    if (!player.alive) return;
    this.casemateIn -= dt;
    if (this.casemateIn > 0) return;
    this.casemateIn = interval + rand(-0.25, 0.35);
    this.casemateSide = -this.casemateSide;
    const from = this.localToWorld(this.casemateSide * 4.7, 4.6, 5.5, _p);
    const quarry = player.eye;
    if (from.distanceTo(quarry) > 135) return;

    _dir.subVectors(quarry, from).normalize();
    const hitPoint = new THREE.Vector3(
      quarry.x + rand(-2.4, 2.4),
      Math.max(0.5, quarry.y + rand(-1.4, 1.5)),
      quarry.z + rand(-2.4, 2.4),
    );
    fx.muzzleFlash(from, _dir, 'autocannon');
    fx.tracer(from, hitPoint, 'heavy');
    audio.play('cannon_burst', { position: from, pitch: 1.15 + rand(-0.08, 0.08), volume: 0.65 });
    if (hitPoint.distanceTo(quarry) <= 4.0) {
      player.takeDamage({ amount: CRAWLER.casemateDamage, from, type: 'bullet', source: 'crawler_casemate' });
    }
  }

  private updateExposedEngineVisuals(dt: number): void {
    const t = this.ctx.time.elapsed;
    const pulse = 0.92 + Math.sin(t * 7.5) * 0.16;
    this.engineGlow.scale.set(pulse, 0.95 + Math.sin(t * 9.0) * 0.1, pulse);
    this.engineFlame.scale.set(0.85 + Math.sin(t * 17) * 0.2, 0.8 + Math.sin(t * 23) * 0.35, 0.85 + Math.cos(t * 15) * 0.2);
    this.engineFlame.rotation.y += 4.2 * dt;
    this.engineLight.intensity = 22 + Math.sin(t * 8.5) * 9;

    this.engineFxIn -= dt;
    if (this.engineFxIn <= 0) {
      this.engineFxIn = 0.12;
      const top = this.localToWorld(0, 9.6, -11.6, _p);
      this.ctx.fx.embers(top, 10, 2.4);
      this.ctx.fx.flame(top, _up, 1.35);
      if (Math.random() < 0.4) {
        this.ctx.fx.smoke(top, 0xff7a28, 2.2, 1.8);
      }
    }
  }

  private updateChainDetonations(dt: number): void {
    if (this.chainBlasts.length === 0) return;
    const { audio, camera, fx, render } = this.ctx;
    for (let i = this.chainBlasts.length - 1; i >= 0; i--) {
      const b = this.chainBlasts[i]!;
      b.delay -= dt;
      if (b.delay <= 0) {
        this.chainBlasts.splice(i, 1);
        this.localToWorld(b.localX, b.localY, b.localZ, _p);
        fx.explosion(_p, { radius: 8.5, kind: 'rocket', scale: b.scale });
        fx.chips(_p, 0xff9430, 32);
        fx.embers(_p, 30, 4.5);
        fx.heatShimmer(_p, 9, 4);
        render.lights.flash(_p, 0xff9a38, 30, 68, 0.55);
        audio.play('vehicle_explode', { position: _p, volume: 0.95 });
        camera.addTrauma(0.55);
      }
    }
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
      fx.smoke(_p, this.state.phase === 'dead' ? 0x1a1816 : 0x3b3936, this.state.phase === 'dead' ? 3.2 : 2.4, 3.4);
    }
    if (this.state.phase === 'dead') {
      this.localToWorld(rand(-3, 3), 7.4, rand(-10, 4), _p);
      fx.smoke(_p, 0x1f1d1b, 3.4, 3.6);
      if (Math.random() < 0.5) fx.embers(_p, 10, 3.0);
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
      // When the Stern Engine is exposed, hits to the stern hull splash generously onto the engine core!
      if (this.state.phase === 'deck' && this.state.hp.engine > 0) {
        const eng = this.boxes.find(b => b.id === 'engine');
        if (eng && eng.center.distanceTo(point) <= 7.5) {
          this.applyPartDamage(eng, amount * 0.7, point);
          return true;
        }
      }
      this.ctx.fx.chips(point, 0x8a8c90, 4);
      this.ctx.hud.hitMarker('armor');
      this.ctx.audio.play('armour_stopped', { volume: 0.45 });
      return true;
    }
    const box = this.byHandle.get(collider.handle);
    if (!box) return false;
    // Exposed Stern Engine takes full damage from ALL player weapons (on-foot rifles/autocannon AND Frame guns).
    const mult = box.id === 'engine'
      ? 1.0
      : (source.startsWith('frame_') || source === 'sabot' || source === 'autocannon' || amount >= 45 ? 1.0 : 0.4);
    this.applyPartDamage(box, amount * mult, point);
    return true;
  }

  direct(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, _kind: ExplosionKind, source: string): boolean {
    if (collider.handle === this.hullCollider.handle) {
      // Direct ordnance (105mm Howitzer, 40mm, rockets, satchels) hitting the hull splashes onto the nearest live part!
      const nearest = this.nearestLiveBox(point);
      if (nearest) {
        const ratio = nearest.id === 'engine' ? 0.75 : 0.5;
        this.applyPartDamage(nearest, amount * ratio, point);
      }
      return true;
    }
    const box = this.byHandle.get(collider.handle);
    if (!box) return false;
    const mult = source === 'frame_howitzer' ? 1.35 : box.id === 'engine' ? 1.2 : 1.15;
    this.applyPartDamage(box, amount * mult, point);
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
      const reach = Math.max(b.half[0], b.half[1], b.half[2]);
      const d = Math.max(0, b.center.distanceTo(center) - reach);
      if (d > spec.radius) continue;
      const falloff = 1 - (d / spec.radius) * (1 - def.edgeDamage);
      const howitzerBoost = spec.source === 'frame_howitzer' ? 1.25 : 1.0;
      this.applyPartDamage(b, spec.instakill ? 1600 : spec.damage * falloff * howitzerBoost, center);
      hit++;
    }
    return hit;
  }

  paintable(out: MissileTarget[]): void {
    if (!this.root.visible || this.state.phase === 'dormant' || this.state.phase === 'dead') return;
    for (const b of this.boxes) {
      if (b.target.alive) out.push(b.target);
    }
  }

  frameBlow(at: THREE.Vector3, radius: number, damage: number): number {
    if (!this.root.visible || this.state.phase === 'dormant' || this.state.phase === 'dead') return 0;
    let hit = 0;
    for (const b of this.boxes) {
      if (b.id === 'engine' && this.state.phase !== 'deck') continue;
      if (b.id !== 'engine' && this.state.phase !== 'hunt' && this.state.phase !== 'drag') continue;
      if (this.state.hp[b.id] <= 0) continue;
      const reach = Math.max(b.half[0], b.half[1], b.half[2]);
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
    fx.chips(point, box.id === 'engine' ? 0xff7a20 : 0xffaa44, box.id === 'engine' ? 11 : 7);
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
        this.destroyCrawler();
      }
    }

    if (res.phaseChanged === 'drag') {
      audio.play('metal_groan', { position: this.position, pitch: 0.5, volume: 1 });
      hud.feed('OLD MOTHER ENRAGED — WATCH FOR THRUSTER LUNGES & MORTARS!', '#ffc14a');
      campaign.signal('mother:drag');
      this.refreshMarkers();
    } else if (res.phaseChanged === 'deck') {
      this.exposeEngineNow();
    } else if (res.phaseChanged === 'seizing') {
      this.beginSeize();
    }
  }

  private destroyCrawler(): void {
    const { audio, campaign, camera, fx, hud, render } = this.ctx;
    this.clearMarkers();
    this.clearMortars();
    this.engineCoreGroup.visible = false;
    this.engineFlame.visible = false;
    this.engineLight.intensity = 0;
    this.thrusterFlames.visible = false;
    this.rumbleLoop?.stop(0.6);
    this.rumbleLoop = null;
    this.alarmLoop?.stop(0.3);
    this.alarmLoop = null;

    // Immediate primary Stern Engine detonation.
    this.localToWorld(0, 8.2, -11.6, _p);
    fx.explosion(_p, { radius: 10, kind: 'rocket', scale: 2.5 });
    fx.chips(_p, 0xff9830, 56);
    fx.embers(_p, 48, 5.5);
    render.lights.flash(_p, 0xffa840, 38, 80, 0.8);
    audio.play('vehicle_explode', { position: this.position, volume: 1 });
    audio.play('explosion_debris', { position: this.position, volume: 1 });
    camera.addTrauma(0.95);

    // Multi-stage chain detonation marching down Old Mother's hull.
    this.chainBlasts.length = 0;
    this.chainBlasts.push(
      { delay: 0.35, localX: -2.4, localY: 7.4, localZ: -6.0, scale: 2.0 },
      { delay: 0.72, localX: 2.6, localY: 8.6, localZ: -1.5, scale: 2.3 },
      { delay: 1.12, localX: -1.5, localY: 7.2, localZ: 4.5, scale: 2.1 },
      { delay: 1.55, localX: 0, localY: 6.0, localZ: 10.5, scale: 2.6 },
    );

    hud.feed('OLD MOTHER DESTROYED!', '#7ee787');
    campaign.signal('mother:engine');
    campaign.signal('mother:destroyed');
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
    for (const d of this.deckColliders) {
      this.localToWorld(d.lx, d.ly, d.lz, _p);
      d.collider.setTranslation(_p);
      if (d.pitch !== 0) {
        _pitchQ.setFromAxisAngle(_xAxis, d.pitch);
        d.collider.setRotation(_q.clone().multiply(_pitchQ));
      } else {
        d.collider.setRotation(_q);
      }
    }
  }

  private parkColliders(): void {
    _p.set(0, -1000, 0);
    this.hullCollider.setTranslation(_p);
    for (const b of this.boxes) b.collider.setTranslation(_p);
  }

  /** Solid walkable deck, bridge wall, waist-high cover blocks, and stern ramp for boarding / Phase 3. */
  private buildDeckColliders(): void {
    this.clearDeckColliders();
    const { physics } = this.ctx;
    _q.setFromAxisAngle(_up, this.yaw);
    const addBox = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, pitch = 0) => {
      const pos = this.localToWorld(lx, ly, lz, new THREE.Vector3());
      const c = physics.addStaticBox(pos, new THREE.Vector3(hx, hy, hz), null, 'metal');
      const rot = _q.clone();
      if (pitch !== 0) rot.multiply(new THREE.Quaternion().setFromAxisAngle(_xAxis, pitch));
      c.setRotation(rot);
      this.deckColliders.push({ collider: c, lx, ly, lz, pitch });
    };
    addBox(0, CRAWLER.deckY - 0.7, -0.5, 5.4, 0.7, 13.0);
    addBox(0, CRAWLER.deckY + 1.9, -1.8, 2.3, 1.9, 2.6);
    addBox(-3.0, CRAWLER.deckY + 0.65, 3.2, 0.9, 0.65, 0.9);
    addBox(3.0, CRAWLER.deckY + 0.65, 2.2, 0.9, 0.65, 0.9);
    addBox(-3.2, CRAWLER.deckY + 0.65, -4.2, 0.85, 0.65, 1.1);
    addBox(3.2, CRAWLER.deckY + 0.65, -4.2, 0.85, 0.65, 1.1);
    addBox(0, 3.1, -17.8, 2.6, 0.45, 5.8, -0.58);
  }

  private clearDeckColliders(): void {
    for (const d of this.deckColliders) this.ctx.physics.world.removeCollider(d.collider, true);
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
      if (eng && this.state.hp.engine > 0) {
        eng.unmark = hud.follow(eng.center, 'STERN ENGINE — DESTROY', '#ffaa20');
      }
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
      // Recessed emergency flank casemate autocannon ports (visible muzzle stubs on bow cheeks).
      .cyl(0.2, 0.24, 1.6, 8, '#1d2024', { at: [-4.7, 4.6, 5.5], rot: [Math.PI / 2, 0, 0] })
      .cyl(0.2, 0.24, 1.6, 8, '#1d2024', { at: [4.7, 4.6, 5.5], rot: [Math.PI / 2, 0, 0] })
      // Aft bridge superstructure with slit windows & radar mast.
      .solid(chamferBox(4.8, 3.8, 5.4, 0.2), '#3e4449', { at: [0, CRAWLER.deckY + 1.9, -1.8] })
      .solid(chamferBox(5.2, 0.45, 5.8, 0.08), '#2c3035', { at: [0, CRAWLER.deckY + 3.9, -1.8] })
      .glow(new THREE.BoxGeometry(3.6, 0.42, 0.14), '#ffae42', 2.8, { at: [0, CRAWLER.deckY + 2.6, 0.92] })
      // Twin heavy diesel smokestacks + dorsal emergency mortar tubes.
      .cyl(0.55, 0.7, 5.2, 10, '#26292d', { at: [-2.4, CRAWLER.deckY + 2.4, -7.2] })
      .cyl(0.55, 0.7, 5.2, 10, '#26292d', { at: [2.4, CRAWLER.deckY + 2.4, -7.2] })
      .cyl(0.32, 0.36, 2.2, 8, '#4a3d32', { at: [-1.1, CRAWLER.deckY + 2.6, -4.8], rot: [-0.35, 0, 0] })
      .cyl(0.32, 0.36, 2.2, 8, '#4a3d32', { at: [1.1, CRAWLER.deckY + 2.6, -4.8], rot: [-0.35, 0, 0] })
      // Waist-high deck cover crates & stern ramp geometry.
      .solid(chamferBox(1.8, 1.3, 1.8, 0.08), '#6b563c', { at: [-3.0, CRAWLER.deckY + 0.65, 3.2] })
      .solid(chamferBox(1.8, 1.3, 1.8, 0.08), '#5a6354', { at: [3.0, CRAWLER.deckY + 0.65, 2.2] })
      .solid(chamferBox(1.7, 1.3, 2.2, 0.08), '#6b563c', { at: [-3.2, CRAWLER.deckY + 0.65, -4.2] })
      .solid(chamferBox(1.7, 1.3, 2.2, 0.08), '#5a6354', { at: [3.2, CRAWLER.deckY + 0.65, -4.2] })
      // Stern access ramp (visual matching collider).
      .solid(chamferBox(5.0, 0.5, 11.4, 0.06), '#3c4045', { at: [0, 3.1, -17.8], rot: [-0.58, 0, 0] })
      // Stern engine armored cradle base.
      .solid(chamferBox(6.4, 1.4, 4.4, 0.14), '#282c31', { at: [0, CRAWLER.deckY + 0.6, -11.6] })
      // Rear auxiliary boost thruster nozzles.
      .cyl(0.95, 1.3, 2.4, 10, '#22262b', { at: [-2.8, 2.4, -12.6], rot: [Math.PI / 2, 0, 0] })
      .cyl(0.95, 1.3, 2.4, 10, '#22262b', { at: [2.8, 2.4, -12.6], rot: [Math.PI / 2, 0, 0] })
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
    this.root.add(mat.group(hull));

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

    // Armored Rear Shroud Doors covering the Stern Reactor until Phase 3 (`deck`).
    const makeShroud = (sx: number) => {
      const b = new ModelBuilder()
        .solid(chamferBox(2.9, 3.6, 4.2, 0.14), '#3d4248', { at: [sx * 1.55, CRAWLER.deckY + 2.1, -11.6] })
        .box(2.2, 0.42, 0.18, '#d98f22', { at: [sx * 1.55, CRAWLER.deckY + 2.4, -13.72] });
      const g = mat.group(b);
      this.root.add(g);
      return g;
    };
    this.engineShroudL = makeShroud(-1);
    this.engineShroudR = makeShroud(1);

    // Massive Pulsing Molten-Orange Stern Reactor Core + Radiating Heat Fins + Roaring Flame Column!
    this.engineCoreGroup = new THREE.Group();
    this.engineCoreGroup.position.set(0, CRAWLER.deckY + 2.3, -11.6);
    this.engineCoreGroup.visible = false;

    const coreB = new ModelBuilder()
      .glow(new THREE.CylinderGeometry(1.75, 1.85, 3.6, 14), '#ff6214', 4.4)
      .glow(new THREE.CylinderGeometry(1.15, 1.15, 3.9, 12), '#ffe082', 5.2)
      .glow(new THREE.TorusGeometry(2.35, 0.16, 8, 22), '#ff8e24', 4.0, { at: [0, 0.6, 0], rot: [Math.PI / 2, 0, 0] })
      .glow(new THREE.TorusGeometry(2.35, 0.16, 8, 22), '#ff5518', 3.8, { at: [0, -0.7, 0], rot: [Math.PI / 2, 0, 0] });
    this.engineGlow = new THREE.Mesh(coreB.glowGeometry()!, mat.glow);
    this.engineCoreGroup.add(this.engineGlow);

    // 8 radiating dark-steel & heat-reddened cooling fins around the core.
    const finB = new ModelBuilder();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      finB.solid(chamferBox(0.28, 3.5, 1.05, 0.04), i % 2 === 0 ? '#2b2420' : '#7a3316', {
        at: [Math.sin(a) * 2.1, 0, Math.cos(a) * 2.1],
        rot: [0, a, 0],
      });
    }
    this.engineCoreGroup.add(mat.group(finB));

    // Roaring vertical flame column rising above the exposed core.
    const flameB = new ModelBuilder()
      .glow(new THREE.ConeGeometry(1.55, 4.6, 10), '#ff7818', 4.2, { at: [0, 4.1, 0] })
      .glow(new THREE.ConeGeometry(0.85, 3.4, 8), '#fff0a0', 5.0, { at: [0, 3.5, 0] });
    this.engineFlame = new THREE.Mesh(flameB.glowGeometry()!, mat.glow);
    this.engineFlame.visible = false;
    this.engineCoreGroup.add(this.engineFlame);

    this.root.add(this.engineCoreGroup);

    // Intense orange PointLight attached to the stern reactor so the whole rear glows across the Salt Pans.
    this.engineLight = new THREE.PointLight(0xff6818, 0, 50, 1.6);
    this.engineLight.position.set(0, CRAWLER.deckY + 3.8, -12.6);
    this.root.add(this.engineLight);

    // Rear Auxiliary Boost Thruster Flame Cones (active during Phase 2 lunges).
    this.thrusterFlames = new THREE.Group();
    this.thrusterFlames.position.set(0, 2.4, -14.2);
    this.thrusterFlames.visible = false;
    const thrustB = new ModelBuilder()
      .glow(new THREE.ConeGeometry(1.15, 5.2, 10), '#ff7a20', 4.4, { at: [-2.8, 0, -2.6], rot: [-Math.PI / 2, 0, 0] })
      .glow(new THREE.ConeGeometry(1.15, 5.2, 10), '#ff7a20', 4.4, { at: [2.8, 0, -2.6], rot: [-Math.PI / 2, 0, 0] })
      .glow(new THREE.ConeGeometry(0.65, 3.6, 8), '#fff0b0', 5.0, { at: [-2.8, 0, -1.8], rot: [-Math.PI / 2, 0, 0] })
      .glow(new THREE.ConeGeometry(0.65, 3.6, 8), '#fff0b0', 5.0, { at: [2.8, 0, -1.8], rot: [-Math.PI / 2, 0, 0] });
    this.thrusterFlames.add(mat.group(thrustB));
    this.root.add(this.thrusterFlames);

    // Collect key meshes for Frame gunner highlight.
    for (const grp of [this.skirtL, this.skirtR, this.turretFMesh, this.turretAMesh, this.launcherMesh, this.cutter, this.engineCoreGroup]) {
      grp.traverse(o => { if ((o as THREE.Mesh).isMesh) this.highlightList.push(o); });
    }
  }

  dispose(): void {
    this.vehicles?.removeExtra(this);
    this.rumbleLoop?.stop(0.2);
    this.rumbleLoop = null;
    this.alarmLoop?.stop(0.2);
    this.alarmLoop = null;
    this.clearMortars();
    this.mortarRingGeo.dispose();
    this.mortarFillGeo.dispose();
    this.clearMarkers();
    this.clearDeckColliders();
    this.ctx.physics.world.removeCollider(this.hullCollider, true);
    for (const b of this.boxes) this.ctx.physics.world.removeCollider(b.collider, true);
    this.root.removeFromParent();
  }
}
