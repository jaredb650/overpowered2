/**
 * Chancery Estate ("Quiet Title", Mission 3) runtime director:
 * owns the estate's stealth world systems, High Magistrate Aldous Vane's 75 s Upper Bureau
 * routine & Continuity Protocol bunker retreat, both Tier-3 bunker breach paths (Armory Breach
 * Charges & Generator Sub-Basement Hydraulic Overload), QRF dispatch loop, Stealth HUD, and
 * Chancery lore set-dressing props.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { ChipRack, ThermalSources } from '../contracts/chips';
import type { Ctx } from '../core/contracts';
import type { EnemyId, EnemyInstance } from '../core/gameplay';
import { clamp, wrapAngle } from '../core/math';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyManager } from '../enemies/EnemyManager';
import { MAX_HOSTILE } from '../enemies/outpost/doctrine';
import type { Outpost, PatrolPoint, PatrolRoute } from '../enemies/outpost';
import { discharge, soldierOf } from '../enemies/outpost/soldier';
import { StealthHud, type StealthHudUpdateOptions } from '../ui/hud/stealth';
import { AlarmSystem } from '../world/alarms';
import { BreakerSystem } from '../world/breakers';
import { CameraSystem } from '../world/cameras';
import { ShootableLights } from '../world/lights';
import { StealthTakedown } from '../world/stealthTakedown';
import {
  ARMORY_BENCH_POS,
  BUNKER_DESK_POS,
  BUNKER_DOOR_POS,
  CAPACITOR_POS,
  CHANCERY_ALARMS,
  CHANCERY_BREAKERS,
  CHANCERY_CAMERAS,
  CHANCERY_LIGHTS,
  EXEC_LIFT_UPPER_POS,
  RED_GOGGLES_BOARD_POS,
  VANE_DESK_POS,
} from '../world/map/chancery/plan';
import type { CampaignHud } from './hud';
import type { MissionRunner } from './runner';
import { MARKS, ROUTES, VANE_STATIONS } from './missions/quietTitle.places';

const BUNKER_DOOR_VEC = new THREE.Vector3(...BUNKER_DOOR_POS);
const BREACH_PLANT_VEC = new THREE.Vector3(BUNKER_DOOR_POS[0], BUNKER_DOOR_POS[1] + 1.2, BUNKER_DOOR_POS[2] + 0.8);
const ARMORY_KIT_VEC = new THREE.Vector3(...ARMORY_BENCH_POS);
const GENERATOR_CONSOLE_VEC = new THREE.Vector3(...CAPACITOR_POS);
const EXEC_LIFT_VEC = new THREE.Vector3(...EXEC_LIFT_UPPER_POS);
const BUNKER_DESK_VEC = new THREE.Vector3(...BUNKER_DESK_POS);
const GATEHOUSE_VEC = new THREE.Vector3(...MARKS.gatehouse!.at);
const UP = new THREE.Vector3(0, 1, 0);
const SOUTH = new THREE.Vector3(0, 0, 1);
const EMPTY_POSITIONS: readonly THREE.Vector3[] = [];

const VANE_HP = 160;
const VANE_STATION_ARRIVE_DIST = 0.85;
const VANE_LIFT_ARRIVE_DIST = 1.8;
const VANE_RETREAT_TIMEOUT = 5.5;
const BREACH_FUSE_SECONDS = 3.5;
const OVERLOAD_SECONDS = 6.0;
const INTERACT_REACH = 2.8;
const QRF_INTERVAL_SECONDS = 28;
const STING_COOLDOWN_SECONDS = 2.5;
const IMPACT_FALLBACK_RADIUS = 0.65;

type VanePhase = 'none' | 'routine' | 'retreating' | 'bunker' | 'dead';

type InteractKind = 'none' | 'takedown' | 'plant_breach' | 'overload_capacitor' | 'alarm' | 'breaker' | 'take_breach';

interface ContractsChipsAccess {
  chips?: {
    rack?: ChipRack;
  };
}

interface ImpactPayload {
  position?: THREE.Vector3;
  surface?: string;
}

const _v = new THREE.Vector3();

function routeFromMarks(markIds: readonly string[], loop = true, wait = 2.8): PatrolRoute {
  const points: PatrolPoint[] = [];
  for (let i = 0; i < markIds.length; i++) {
    const m = MARKS[markIds[i]!];
    if (!m) continue;
    points.push({
      x: m.at[0],
      y: m.at[1],
      z: m.at[2],
      yaw: m.yaw,
      wait,
    });
  }
  return { points, loop };
}

/** Pre-built sector patrol routes paired with their spawn marks for automatic assignment. */
const SECTOR_PATROLS: readonly {
  readonly anchor: readonly [number, number, number];
  readonly route: PatrolRoute;
}[] = [
  { anchor: MARKS.westGarden!.at, route: routeFromMarks(ROUTES.patrolWest!, true, 2.5) },
  { anchor: MARKS.generatorHouse!.at, route: routeFromMarks([...ROUTES.patrolWest!].reverse(), true, 3.0) },
  { anchor: MARKS.courtyard!.at, route: routeFromMarks(ROUTES.patrolCourtyard!, true, 2.2) },
  { anchor: MARKS.eastTerrace!.at, route: routeFromMarks(ROUTES.patrolEast!, true, 2.6) },
  { anchor: MARKS.foyer!.at, route: routeFromMarks(ROUTES.patrolMansion!, true, 3.0) },
  { anchor: MARKS.vaneWindow!.at, route: routeFromMarks(ROUTES.patrolUpper!, true, 4.0) },
];

export class Chancery {
  private built = false;
  private active = false;

  // Stealth world systems
  private lights: ShootableLights | null = null;
  private breakers: BreakerSystem | null = null;
  private cameras: CameraSystem | null = null;
  private alarms: AlarmSystem | null = null;
  private takedown: StealthTakedown | null = null;
  private stealthHud: StealthHud | null = null;

  // Outpost lockdown wrapper state (avoid double-wrapping across restarts)
  private outpostLockdownWrapped = false;
  private origOutpostLockdown: ((reason: string) => void) | null = null;
  private lastSuspiciousStingAt = -10;
  private lastAlertStingAt = -10;

  // Zero-alloc HUD & thermal caches
  private readonly hudOpts: StealthHudUpdateOptions = {
    prompt: null,
    cameraLock: 0,
    hubOverridden: false,
  };
  private readonly thermalHot: THREE.Object3D[] = [];
  private readonly thermalWarm: THREE.Object3D[] = [];
  private readonly thermalSourcesOut: ThermalSources = {
    hot: this.thermalHot,
    warm: this.thermalWarm,
  };

  // Patrol tracking for staggered mission squad arrivals
  private readonly patrolAssigned = new Set<number>();

  // High Magistrate Aldous Vane controller
  private vaneBody: Enemy | null = null;
  private vanePhase: VanePhase = 'none';
  private vaneStationIdx = 0;
  private vaneWaitLeft = 0;
  private vaneRetreatClock = 0;
  private vaneMarkerOff: (() => void) | null = null;
  private vaneLapelMesh: THREE.Mesh | null = null;

  // Lockdown & QRF state
  private lockdownActive = false;
  private qrfTimer = QRF_INTERVAL_SECONDS;

  // Dual Tier-3 Bunker Breach state
  private bunkerBreached = false;
  private hasBreachCharge = false;
  private breachPlanted = false;
  private breachTimer = 0;
  private breachBeepAccum = 0;
  private overloadActive = false;
  private overloadTimer = 0;
  private overloadSparkAccum = 0;

  // Scene props & interactive breach visuals
  private readonly propsRoot = new THREE.Group();
  private readonly ownedGeos: THREE.BufferGeometry[] = [];
  private readonly ownedMats: THREE.Material[] = [];
  private breachChargeGroup: THREE.Group | null = null;
  private breachLedMat: THREE.MeshBasicMaterial | null = null;
  private capacitorCoreMesh: THREE.Mesh | null = null;
  private capacitorLedMat: THREE.MeshBasicMaterial | null = null;
  private capacitorNeedle: THREE.Object3D | null = null;
  private armoryKitMesh: THREE.Group | null = null;

  // Contextual [E] interact state for current frame
  private pendingKind: InteractKind = 'none';
  private pendingId = '';
  private pendingEnemy: EnemyInstance | null = null;

  // Event unsubscribers
  private readonly unsubs: (() => void)[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly runner: MissionRunner,
    private readonly ui: CampaignHud,
  ) {
    this.propsRoot.name = 'chancery-props';
  }

  private get manager(): EnemyManager {
    return this.ctx.enemies as EnemyManager;
  }

  private get outpost(): Outpost | null {
    return this.manager.outpost ?? null;
  }

  private get chipRack(): ChipRack | null {
    return (this.ctx.contracts as unknown as ContractsChipsAccess)?.chips?.rack ?? null;
  }

  /** Builds all stealth world systems, HUD, interactive breach objects, and Chancery lore props once. */
  ensureBuilt(): void {
    if (this.built) return;
    this.built = true;

    const { ctx } = this;

    // 1. Shootable dynamic lights
    this.lights = new ShootableLights(ctx, {
      ambientBaseline: 0.06,
      onBroken: pos => {
        const o = this.outpost;
        o?.reportSound(pos, 12, false);
        o?.stealth.reportLightOut(pos);
        this.runner.signal('qt:light_broken');
      },
    });
    this.lights.addAll(CHANCERY_LIGHTS);

    // 2. Wing electrical circuit breakers linked to lights, cameras, and alarms
    this.breakers = new BreakerSystem(ctx, {
      lights: this.lights,
      onTrip: (spec, mode) => {
        this.cameras?.setGroupPower(spec.group, false);
        this.alarms?.setGroupPower(spec.group, false);
        _v.set(spec.position[0], spec.position[1], spec.position[2]);
        ctx.audio.play('breaker_flip', { position: _v, volume: 0.72 });
        const o = this.outpost;
        o?.reportSound(_v, mode === 'shot' ? 16 : 3, mode === 'shot');
        o?.stealth.reportLightOut(_v);
        this.runner.signal('qt:breaker_tripped');
      },
    });
    this.breakers.addAll(CHANCERY_BREAKERS);

    // 3. Sweeping CCTV security cameras
    this.cameras = new CameraSystem(ctx, CHANCERY_CAMERAS, {
      onAlert: (_camId, eye) => {
        ctx.audio.play('camera_beep', { position: eye, volume: 0.75 });
        this.triggerLockdown('camera');
      },
      onDestroyed: (pos, _id, radius) => {
        this.outpost?.reportSound(pos, radius, false);
      },
    });

    // 4. Wall alarm panels & Security Hub override console
    this.alarms = new AlarmSystem(ctx, CHANCERY_ALARMS, {
      onHubOverride: (_hubId, pos) => {
        ctx.audio.play('breaker_flip', { position: pos, pitch: 1.35, volume: 0.68 });
        ctx.hud.feed('SECURITY HUB OVERRIDDEN — QRF DISPATCH HALTED', '#7ee787');
        this.runner.signal('qt:hub_overridden');
      },
      onPanelDestroyed: (pos, _id, radius) => {
        this.outpost?.reportSound(pos, radius, false);
      },
      onPanelDisabled: pos => {
        this.outpost?.reportSound(pos, 3, false);
      },
    });

    // 5. Rear [E] silent takedown helper
    this.takedown = new StealthTakedown((enemyId, enemy) => {
      if (this.vaneBody && enemy.uid === this.vaneBody.uid) return true;
      const a = this.outpost?.stealth.getAgent(enemyId);
      return !a || a.state === 'unaware' || a.state === 'suspicious';
    });

    // 6. Stealth HUD overlay mounted into `.hud`
    this.stealthHud = new StealthHud();
    const mount = typeof document !== 'undefined' ? document.querySelector('.hud') : null;
    (mount ?? this.ui.el).append(this.stealthHud.el);

    // 7. Interactive bunker breach visuals & Chancery lore set-dressing props
    this.buildInteractiveBreachProps();
    this.buildLoreProps();
    ctx.render.scene?.add(this.propsRoot);

    // 8. Global event listeners (Vane damage/kill, patrol assignment, weapon impact fallback, explosions)
    this.bindEvents();
  }

  private bindEvents(): void {
    const { events } = this.ctx;

    this.unsubs.push(
      events.on('enemy:spawned', e => {
        if (!this.active) return;
        this.tryAssignPatrol(e.enemy);
      }),
    );

    this.unsubs.push(
      events.on('enemy:hit', e => {
        if (!this.active || !this.vaneBody) return;
        if (e.enemy.uid === this.vaneBody.uid && this.vaneBody.alive && this.vanePhase === 'routine') {
          this.spookVane('vane_hit');
        }
      }),
    );

    this.unsubs.push(
      events.on('enemy:killed', e => {
        if (!this.active || !this.vaneBody) return;
        if (e.enemy.uid === this.vaneBody.uid && this.vanePhase !== 'dead') {
          this.onVaneKilled();
        }
      }),
    );

    this.unsubs.push(
      events.on('world:explosion', e => {
        if (!this.active || this.bunkerBreached) return;
        if (e.position.distanceTo(BUNKER_DOOR_VEC) <= 6.5) {
          this.detonateBunkerDoor('breach_charge');
        }
      }),
    );

    // Fallback impact listener for glass shatter near Upper Bureau (spooks Vane) and proximity shot hits
    this.unsubs.push(
      (events as unknown as { on(type: string, fn: (p: ImpactPayload) => void): () => void }).on(
        'weapon:impact',
        payload => {
          if (!this.active || !payload?.position) return;
          const pos = payload.position;
          if (
            this.vanePhase === 'routine'
            && payload.surface === 'glass'
            && pos.y >= 5.5
            && pos.y <= 11.8
            && pos.z >= -52
            && pos.z <= -24
            && Math.abs(pos.x) <= 28
          ) {
            this.spookVane('bureau_glass');
          }
          this.checkProximityShotFallback(pos);
        },
      ),
    );
  }

  private readonly onColliderHit = (collider: RAPIER.Collider): boolean => this.handleShotCollider(collider);
  private readonly onBlast = (center: THREE.Vector3, radius: number, amount: number, source: string): void => {
    this.handleBlast(center, radius, amount, source);
  };

  private attachWorldHooks(): void {
    const objects = this.ctx.world?.objects;
    if (!objects) return;
    if (objects.colliderHitHandler !== this.onColliderHit) {
      objects.colliderHitHandler = this.onColliderHit;
    }
    if (objects.blastHandler !== this.onBlast) {
      objects.blastHandler = this.onBlast;
    }
  }

  private detachWorldHooks(): void {
    const objects = this.ctx.world?.objects;
    if (!objects) return;
    if (objects.colliderHitHandler === this.onColliderHit) {
      objects.colliderHitHandler = null;
    }
    if (objects.blastHandler === this.onBlast) {
      objects.blastHandler = null;
    }
  }

  /**
   * Direct gunshot collider hook for Wave 3 weapon hitscan integration.
   * Returns true if the shot struck a shootable light, circuit breaker, security camera, or alarm panel.
   */
  handleShotCollider(collider: RAPIER.Collider | null, hitPoint?: THREE.Vector3): boolean {
    if (!collider || !this.active) return false;
    if (this.lights?.damageCollider(collider, hitPoint)) return true;
    if (this.breakers?.damageCollider(collider, hitPoint)) return true;
    if (this.cameras?.damageCollider(collider)) return true;
    if (this.alarms?.damageCollider(collider)) return true;
    return false;
  }

  /** Direct radial blast hook so explosions/satchels break nearby lights, cameras, breakers, alarms, and the bunker door. */
  handleBlast(center: THREE.Vector3, radius: number, amount: number, _source: string): void {
    if (!this.active || radius <= 0) return;
    this.lights?.blast(center, radius);
    this.breakers?.blast(center, radius);
    this.cameras?.blast(center, radius);
    this.alarms?.blast(center, radius);
    if (!this.bunkerBreached && amount >= 80 && center.distanceTo(BUNKER_DOOR_VEC) <= radius + 4.5) {
      this.detonateBunkerDoor('breach_charge');
    }
  }

  /** Fallback check on `weapon:impact` in case a ray struck a camera/alarm collider without calling `handleShotCollider`. */
  private checkProximityShotFallback(pos: THREE.Vector3): void {
    const r2 = IMPACT_FALLBACK_RADIUS * IMPACT_FALLBACK_RADIUS;
    if (this.cameras) {
      for (const cam of this.cameras.cameras) {
        if (!cam.destroyed && cam.headWorldPos.distanceToSquared(pos) <= r2) {
          this.cameras.destroy(cam.id);
          return;
        }
      }
    }
    if (this.alarms) {
      for (const p of this.alarms.panels) {
        if (!p.isHub && !p.destroyed && p.position.distanceToSquared(pos) <= r2 && p.collider) {
          this.alarms.damageCollider(p.collider, 1);
          return;
        }
      }
    }
  }

  /** Dispatches `qt.*` mission script calls from `quietTitle.ts`. */
  call(name: string, _arg = ''): void {
    this.ensureBuilt();
    switch (name) {
      case 'qt.setup':
        this.beginInfiltration();
        return;
      case 'qt.lockdown':
        this.beginLockdownStage();
        return;
      case 'qt.exfil':
        this.beginExfilStage();
        return;
      default:
        console.warn(`[chancery] unknown call ${name}`);
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Mission stage transitions
  // -----------------------------------------------------------------------------------------------

  private beginInfiltration(): void {
    this.active = true;
    this.lockdownActive = false;
    this.bunkerBreached = false;
    this.breachPlanted = false;
    this.breachTimer = 0;
    this.overloadActive = false;
    this.overloadTimer = 0;
    this.qrfTimer = QRF_INTERVAL_SECONDS;
    this.patrolAssigned.clear();

    this.attachWorldHooks();
    this.wireOutpost(false);
    this.wireThermal(true);
    this.stealthHud?.setActive(true);

    // Assign patrol routes to any guards already spawned before `qt.setup`
    for (const enemy of this.manager.alive) {
      this.tryAssignPatrol(enemy);
    }

    this.spawnVane('routine');
  }

  private beginLockdownStage(): void {
    this.active = true;
    this.lockdownActive = true;
    this.qrfTimer = QRF_INTERVAL_SECONDS;

    this.attachWorldHooks();
    this.wireOutpost(true);
    this.wireThermal(true);
    this.stealthHud?.setActive(true);

    // Ensure Vane exists and is either retreating to or already inside the Continuity Bunker
    if (!this.vaneBody || !this.vaneBody.alive) {
      if (this.vanePhase !== 'dead') {
        this.spawnVane('bunker');
      }
    } else if (this.vanePhase === 'routine') {
      this.relocateVaneToBunker();
    }
  }

  private beginExfilStage(): void {
    this.active = true;
    this.attachWorldHooks();
    this.vanePhase = 'dead';
    this.clearVaneMarker();
    this.stealthHud?.setActive(true);
  }

  private wireOutpost(inLockdown: boolean): void {
    const o = this.outpost;
    if (!o) return;
    o.setStealthMode(true);
    o.setLightQuery(pos => this.lights?.lightAt(pos, 0.06, true) ?? 0.06);
    o.setAlarmPanels(() => this.alarms?.activePanelPositions() ?? EMPTY_POSITIONS);

    o.stealth.onGuardStateChange = (agent, prev) => {
      if (!this.active || this.lockdownActive) return;
      const now = this.ctx.time.elapsed;
      if (agent.state === 'suspicious' && prev === 'unaware' && now - this.lastSuspiciousStingAt >= STING_COOLDOWN_SECONDS) {
        this.lastSuspiciousStingAt = now;
        this.ctx.audio.play('stealth_suspicious', { volume: 0.5 });
      } else if (agent.state === 'alert' && prev !== 'alert' && now - this.lastAlertStingAt >= STING_COOLDOWN_SECONDS) {
        this.lastAlertStingAt = now;
        this.ctx.audio.play('stealth_alert', { volume: 0.62 });
      }
    };

    if (!this.outpostLockdownWrapped) {
      this.origOutpostLockdown = o.stealth.onLockdown;
      this.outpostLockdownWrapped = true;
    }
    o.stealth.onLockdown = reason => {
      this.origOutpostLockdown?.(reason);
      this.onLockdownTriggered(reason);
    };

    if (inLockdown && !o.stealth.lockdown) {
      o.triggerLockdown('checkpoint');
    }
  }

  private wireThermal(enabled: boolean): void {
    const rack = this.chipRack;
    if (!rack) return;
    rack.setThermalSources(enabled ? () => this.collectThermalSources() : null);
  }

  private collectThermalSources(): ThermalSources {
    this.thermalHot.length = 0;
    this.thermalWarm.length = 0;

    if (this.lights) {
      const bulbs = this.lights.thermalMeshes();
      for (let i = 0; i < bulbs.length; i++) this.thermalHot.push(bulbs[i]!);
    }
    if (this.overloadActive && this.capacitorCoreMesh) {
      this.thermalHot.push(this.capacitorCoreMesh);
    }
    if (this.breakers) {
      const boxes = this.breakers.thermalMeshes();
      for (let i = 0; i < boxes.length; i++) this.thermalWarm.push(boxes[i]!);
    }
    if (this.cameras) {
      const cams = this.cameras.thermalMeshes();
      for (let i = 0; i < cams.length; i++) this.thermalWarm.push(cams[i]!);
    }
    if (this.alarms) {
      const panels = this.alarms.thermalMeshes();
      for (let i = 0; i < panels.length; i++) this.thermalWarm.push(panels[i]!);
    }
    return this.thermalSourcesOut;
  }

  private tryAssignPatrol(enemy: EnemyInstance): void {
    if (this.patrolAssigned.has(enemy.uid)) return;
    if (this.vaneBody && enemy.uid === this.vaneBody.uid) return;
    const o = this.outpost;
    if (!o) return;

    let bestIdx = -1;
    let bestD2 = 64; // within 8 m of sector anchor
    for (let i = 0; i < SECTOR_PATROLS.length; i++) {
      const a = SECTOR_PATROLS[i]!.anchor;
      const dx = enemy.position.x - a[0];
      const dy = enemy.position.y - a[1];
      const dz = enemy.position.z - a[2];
      if (Math.abs(dy) > 3) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      o.assignPatrol(enemy.uid, SECTOR_PATROLS[bestIdx]!.route);
      this.patrolAssigned.add(enemy.uid);
    }
  }

  private triggerLockdown(reason: string): void {
    const o = this.outpost;
    if (o && !o.stealth.lockdown) {
      o.triggerLockdown(reason);
    } else {
      this.onLockdownTriggered(reason);
    }
  }

  private onLockdownTriggered(_reason: string): void {
    if (!this.active || this.lockdownActive || this.vanePhase === 'dead') return;
    this.lockdownActive = true;
    this.qrfTimer = QRF_INTERVAL_SECONDS;

    this.ctx.audio.play('stealth_lockdown', { volume: 0.72 });
    this.ctx.audio.play('shutter_slam', { position: _v.set(0, 6.8, -26), volume: 0.85 });
    this.ctx.hud.feed('COMPOUND LOCKDOWN — UPPER BUREAU SHUTTERS SEALING', '#ff5b4c');

    if (this.vaneBody && this.vaneBody.alive && this.vanePhase === 'routine') {
      this.vanePhase = 'retreating';
      this.vaneRetreatClock = 0;
    }

    this.runner.signal('qt:lockdown');
  }

  // -----------------------------------------------------------------------------------------------
  // High Magistrate Aldous Vane NPC Controller (kill-only target)
  // -----------------------------------------------------------------------------------------------

  private spawnVane(initialPhase: 'routine' | 'bunker'): void {
    if (this.vaneBody?.alive) {
      if (initialPhase === 'bunker') this.relocateVaneToBunker();
      return;
    }

    const startStation = VANE_STATIONS[0]!;
    const spawnPos = initialPhase === 'bunker'
      ? _v.copy(BUNKER_DESK_VEC)
      : _v.set(startStation.position[0], startStation.position[1], startStation.position[2]);

    const e = this.manager.spawn('warden', spawnPos) as Enemy | null;
    if (!e) return;

    // Detach Vane from Outpost squad/surrender/stealth AI so he is a pure kill-only aristocratic VIP.
    const o = this.outpost;
    if (o) {
      o.stealth.unregister(e.uid);
      const s = soldierOf(e);
      if (s) {
        s.holdout = true;
        s.silent = true;
        const si = o.soldiers.indexOf(s);
        if (si >= 0) o.soldiers.splice(si, 1);
        const mi = s.squad?.members.indexOf(s) ?? -1;
        if (mi >= 0) s.squad.members.splice(mi, 1);
        discharge(e);
      }
    }

    // Unarmored executive without helmet so headshots from suppressed Ultramag or Bell-Tower .50 AWL are crisp.
    for (const plate of e.plates) plate.mesh.visible = false;
    e.plates = [];
    e.armor = 0;
    e.maxHealth = VANE_HP;
    e.health = VANE_HP;
    e.isBoss = false;
    e.attacks = [];
    e.behaviours = [];
    e.barkAt = Infinity;
    e.footbound = true;
    e.mode = 'hold';
    e.face = 'lock';
    e.yaw = initialPhase === 'bunker' ? Math.PI : startStation.yaw;

    // Subtle aristocratic crimson/gold sash marker on his chest so he is unmistakable through binoculars or AWL scope.
    if (!this.vaneLapelMesh) {
      const geo = new THREE.BoxGeometry(0.46, 0.14, 0.32);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x9c1824,
        emissive: 0x3b080e,
        emissiveIntensity: 0.4,
        roughness: 0.55,
        metalness: 0.2,
      });
      this.ownedGeos.push(geo);
      this.ownedMats.push(mat);
      this.vaneLapelMesh = new THREE.Mesh(geo, mat);
      this.vaneLapelMesh.position.set(0, 1.32, 0.04);
    }
    e.char?.root?.add(this.vaneLapelMesh);

    this.vaneBody = e;
    this.vanePhase = initialPhase;
    this.vaneStationIdx = 0;
    this.vaneWaitLeft = startStation.seconds;
    this.vaneRetreatClock = 0;

    this.clearVaneMarker();
    this.vaneMarkerOff = this.ctx.hud.marker(e.position, 'MAGISTRATE VANE', '#ffc14a');
  }

  private spookVane(reason: string): void {
    if (this.vanePhase !== 'routine') return;
    this.vanePhase = 'retreating';
    this.vaneRetreatClock = 0;
    this.triggerLockdown(reason);
  }

  private relocateVaneToBunker(): void {
    const e = this.vaneBody;
    if (!e || !e.alive) return;
    e.position.copy(BUNKER_DESK_VEC);
    e.groundY = BUNKER_DESK_VEC.y;
    e.center.set(BUNKER_DESK_VEC.x, BUNKER_DESK_VEC.y + 1.0, BUNKER_DESK_VEC.z);
    e.velocity.set(0, 0, 0);
    e.mode = 'hold';
    e.face = 'lock';
    e.yaw = Math.PI;
    e.char?.root?.position.copy(e.position);
    this.vanePhase = 'bunker';
  }

  private updateVane(dt: number): void {
    const e = this.vaneBody;
    if (!e || this.vanePhase === 'none' || this.vanePhase === 'dead') return;
    if (!e.alive) {
      this.onVaneKilled();
      return;
    }

    if (this.vanePhase === 'routine') {
      const station = VANE_STATIONS[this.vaneStationIdx]!;
      const tx = station.position[0];
      const ty = station.position[1];
      const tz = station.position[2];
      const dx = tx - e.position.x;
      const dz = tz - e.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist > VANE_STATION_ARRIVE_DIST) {
        e.mode = 'point';
        e.face = 'move';
        e.pace = 0.42;
        e.moveTarget.set(tx, ty, tz);
      } else {
        e.mode = 'hold';
        e.face = 'lock';
        e.pace = 0;
        // Smoothly turn to face the station's inspection direction
        const diff = wrapAngle(station.yaw - e.yaw);
        e.yaw = wrapAngle(e.yaw + clamp(diff, -2.6 * dt, 2.6 * dt));

        this.vaneWaitLeft -= dt;
        if (this.vaneWaitLeft <= 0) {
          this.vaneStationIdx = (this.vaneStationIdx + 1) % VANE_STATIONS.length;
          this.vaneWaitLeft = VANE_STATIONS[this.vaneStationIdx]!.seconds;
        }
      }
      return;
    }

    if (this.vanePhase === 'retreating') {
      this.vaneRetreatClock += dt;
      const dist = Math.hypot(EXEC_LIFT_VEC.x - e.position.x, EXEC_LIFT_VEC.z - e.position.z);
      if (dist <= VANE_LIFT_ARRIVE_DIST || this.vaneRetreatClock >= VANE_RETREAT_TIMEOUT) {
        this.relocateVaneToBunker();
      } else {
        e.mode = 'point';
        e.face = 'move';
        e.pace = 1.0;
        e.moveTarget.copy(EXEC_LIFT_VEC);
      }
      return;
    }

    if (this.vanePhase === 'bunker') {
      // Pace nervously behind the Continuity Bunker Panic Desk facing the blast door
      e.mode = 'hold';
      e.face = 'lock';
      e.pace = 0;
      const dx = this.ctx.player.position.x - e.position.x;
      const dz = this.ctx.player.position.z - e.position.z;
      const desiredYaw = this.bunkerBreached ? Math.atan2(dx, dz) : Math.PI;
      const diff = wrapAngle(desiredYaw - e.yaw);
      e.yaw = wrapAngle(e.yaw + clamp(diff, -3.5 * dt, 3.5 * dt));
    }
  }

  private onVaneKilled(): void {
    if (this.vanePhase === 'dead') return;
    this.vanePhase = 'dead';
    this.clearVaneMarker();
    this.ctx.hud.feed('HIGH MAGISTRATE ALDOUS VANE ELIMINATED — FORM 9-A VOID', '#7ee787');
    this.runner.signal('qt:vane_dead');
  }

  private clearVaneMarker(): void {
    this.vaneMarkerOff?.();
    this.vaneMarkerOff = null;
  }

  // -----------------------------------------------------------------------------------------------
  // Dual Tier-3 Continuity Bunker Breach Paths (Armory Breach Charges + Generator Overload)
  // -----------------------------------------------------------------------------------------------

  private startBreachChargePlant(): void {
    if (this.bunkerBreached || this.breachPlanted) return;
    this.breachPlanted = true;
    this.breachTimer = BREACH_FUSE_SECONDS;
    this.breachBeepAccum = 0;
    if (this.breachChargeGroup) this.breachChargeGroup.visible = true;
    this.ctx.audio.play('stake_beep', { position: BREACH_PLANT_VEC, volume: 0.72, pitch: 1.1 });
    this.ctx.hud.feed('BREACH CHARGE PLANTED — CLEAR THE BLAST DOOR (3.5s)', '#ffae33');
    this.runner.signal('qt:breach_planted');
  }

  private startHydraulicOverload(): void {
    if (this.bunkerBreached || this.overloadActive) return;
    this.overloadActive = true;
    this.overloadTimer = OVERLOAD_SECONDS;
    this.overloadSparkAccum = 0;
    this.ctx.audio.play('bunker_overload', { position: GENERATOR_CONSOLE_VEC, volume: 0.85 });
    this.ctx.hud.feed('HYDRAULIC CAPACITOR OVERLOADING — VAULT SEAL PRESSURE CRITICAL (6.0s)', '#ffae33');
    this.runner.signal('qt:overload_started');
  }

  private detonateBunkerDoor(source: 'breach_charge' | 'hydraulic_overload'): void {
    if (this.bunkerBreached) return;
    this.bunkerBreached = true;
    this.breachPlanted = false;
    this.overloadActive = false;
    if (this.breachChargeGroup) this.breachChargeGroup.visible = false;
    if (this.capacitorLedMat) this.capacitorLedMat.color.setHex(0xff3824);

    const amount = source === 'hydraulic_overload' ? 1200 : 900;
    this.ctx.world.objects.destruction?.blast(BUNKER_DOOR_VEC, 6, amount, source);

    this.ctx.fx.explosion(BUNKER_DOOR_VEC, { radius: 6, kind: 'grenade', scale: 1.35, normal: SOUTH });
    this.ctx.fx.sparks(BUNKER_DOOR_VEC, SOUTH, 32, source === 'hydraulic_overload' ? 0x88ddff : 0xffaa44);
    this.ctx.fx.smoke(BUNKER_DOOR_VEC, 0xd8e0ea, 2.2, 3.2);
    this.ctx.camera.addTrauma(source === 'hydraulic_overload' ? 0.75 : 0.65);

    if (source === 'hydraulic_overload') {
      this.ctx.fx.sparks(GENERATOR_CONSOLE_VEC, UP, 24, 0x88ddff);
      this.ctx.fx.smoke(GENERATOR_CONSOLE_VEC, 0xd8e4f0, 1.5, 2.4);
      this.ctx.audio.play('bunker_overload', { position: BUNKER_DOOR_VEC, volume: 0.95 });
      this.ctx.audio.play('explosion', { position: BUNKER_DOOR_VEC, volume: 0.9 });
    } else {
      this.ctx.audio.play('explosion', { position: BUNKER_DOOR_VEC, volume: 1.0 });
    }

    this.outpost?.reportSound(BUNKER_DOOR_VEC, 65, true);
    this.ctx.hud.feed('CONTINUITY BUNKER BLAST DOOR BREACHED!', '#ffae33');
    this.runner.signal('qt:bunker_breached');
  }

  private updateBreachSystems(dt: number): void {
    // Also detect if `bunker.door` cluster was collapsed directly by any Tier-3 ordnance
    if (!this.bunkerBreached) {
      const dest = this.ctx.world.objects.destruction;
      if (dest && dest.getCluster('bunker.door') && !dest.isClusterAlive('bunker.door')) {
        this.bunkerBreached = true;
        this.breachPlanted = false;
        this.overloadActive = false;
        if (this.breachChargeGroup) this.breachChargeGroup.visible = false;
        this.runner.signal('qt:bunker_breached');
      }
    }

    // Path 1: Planted Armory Breach Charge countdown (3.5 s fuse)
    if (this.breachPlanted && !this.bunkerBreached) {
      this.breachTimer -= dt;
      const ratio = clamp(1 - this.breachTimer / BREACH_FUSE_SECONDS, 0, 1);
      const beepInterval = 0.55 - ratio * 0.4;
      this.breachBeepAccum += dt;
      if (this.breachBeepAccum >= beepInterval) {
        this.breachBeepAccum = 0;
        this.ctx.audio.play('stake_beep', {
          position: BREACH_PLANT_VEC,
          volume: 0.65,
          pitch: 1.05 + ratio * 0.65,
        });
      }
      if (this.breachLedMat) {
        const blink = Math.sin(this.ctx.time.elapsed * (10 + ratio * 28)) > 0;
        this.breachLedMat.color.setHex(blink ? 0xff2626 : 0x3a0808);
      }
      if (this.breachTimer <= 0) {
        this.detonateBunkerDoor('breach_charge');
      }
    }

    // Path 2: Generator Sub-Basement Hydraulic Overload (6.0 s whine -> surge)
    if (this.overloadActive && !this.bunkerBreached) {
      this.overloadTimer -= dt;
      const ratio = clamp(1 - this.overloadTimer / OVERLOAD_SECONDS, 0, 1);
      if (this.capacitorNeedle) {
        this.capacitorNeedle.rotation.z = -1.2 + ratio * 2.4 + Math.sin(this.ctx.time.elapsed * 32) * 0.08;
      }
      if (this.capacitorLedMat) {
        const pulse = Math.sin(this.ctx.time.elapsed * (8 + ratio * 24)) > 0;
        this.capacitorLedMat.color.setHex(pulse ? 0xffaa22 : 0xff2820);
      }
      this.overloadSparkAccum += dt;
      if (this.overloadSparkAccum >= 0.45) {
        this.overloadSparkAccum = 0;
        this.ctx.fx.sparks(GENERATOR_CONSOLE_VEC, UP, 8, 0x88ddff);
        this.ctx.fx.smoke(GENERATOR_CONSOLE_VEC, 0xc8d8e8, 0.7, 1.1);
        if (this.overloadTimer <= 2.4 && this.overloadTimer > 1.8) {
          this.ctx.audio.play('bunker_overload', { position: GENERATOR_CONSOLE_VEC, volume: 0.85, pitch: 1.18 });
        }
      }
      if (this.overloadTimer <= 0) {
        this.detonateBunkerDoor('hydraulic_overload');
      }
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Lockdown QRF Wave Loop (halts immediately when Security Hub is overridden)
  // -----------------------------------------------------------------------------------------------

  private updateQrfWaves(dt: number): void {
    if (!this.lockdownActive || this.vanePhase === 'dead') return;
    if (this.alarms?.hubOverridden) return;

    this.qrfTimer -= dt;
    if (this.qrfTimer > 0) return;
    this.qrfTimer = QRF_INTERVAL_SECONDS;

    const o = this.outpost;
    if (o && o.hostile + 3 > MAX_HOSTILE) return;

    const men: readonly EnemyId[] = ['trooper', 'gunner', 'trooper'];
    if (o) o.formSquad(men.length, GATEHOUSE_VEC);
    for (let i = 0; i < men.length; i++) {
      _v.set(GATEHOUSE_VEC.x + (i - 1) * 1.6, GATEHOUSE_VEC.y, GATEHOUSE_VEC.z);
      this.manager.spawn(men[i]!, _v);
    }
    this.ctx.hud.feed('QRF SQUAD ENTERING MAIN GATEHOUSE — OVERRIDE SECURITY HUB TO HALT', '#ffae33');
  }

  // -----------------------------------------------------------------------------------------------
  // Highest-Priority Contextual [E] Interactions & Stealth HUD Update
  // -----------------------------------------------------------------------------------------------

  private evaluateInteraction(): string | null {
    this.pendingKind = 'none';
    this.pendingId = '';
    this.pendingEnemy = null;

    const { player, input } = this.ctx;
    if (!player.alive || player.parked) return null;

    const key = input.labelFor?.('interact') ?? 'E';
    const p = player.position;

    // Priority 1: Silent close-quarters rear takedown
    if (this.takedown) {
      const target = this.takedown.findTarget(p, player.forward, this.manager.alive);
      if (target) {
        this.pendingKind = 'takedown';
        this.pendingEnemy = target;
        const label = this.vaneBody && target.uid === this.vaneBody.uid
          ? `[${key}] ELIMINATE MAGISTRATE VANE`
          : `[${key}] SILENT TAKEDOWN`;
        return label;
      }
    }

    // Priority 2: Plant shaped Breach Charge on Tier-3 Bunker Blast Door
    const playerHasBreach = this.hasBreachCharge || this.ctx.weapons.owned.has('satchel');
    if (
      !this.bunkerBreached
      && !this.breachPlanted
      && playerHasBreach
      && p.distanceTo(BREACH_PLANT_VEC) <= INTERACT_REACH
    ) {
      this.pendingKind = 'plant_breach';
      return `[${key}] PLANT BREACH CHARGE ON BLAST DOOR`;
    }

    // Priority 3: Overload Generator Sub-Basement Hydraulic Capacitor Console
    if (!this.bunkerBreached && !this.overloadActive && p.distanceTo(GENERATOR_CONSOLE_VEC) <= INTERACT_REACH) {
      this.pendingKind = 'overload_capacitor';
      return `[${key}] OVERLOAD HYDRAULIC CAPACITOR`;
    }

    // Priority 4: Security Hub Override / Wall Alarm Panel Disable
    if (this.alarms) {
      const alarm = this.alarms.nearestInteractable(p);
      if (alarm) {
        this.pendingKind = 'alarm';
        this.pendingId = alarm.id;
        return alarm.isHub ? `[${key}] OVERRIDE SECURITY HUB` : `[${key}] DISABLE ALARM PANEL`;
      }
    }

    // Priority 5: Wing Electrical Circuit Breaker Flip
    if (this.breakers) {
      const brk = this.breakers.nearestInteractable(p);
      if (brk) {
        this.pendingKind = 'breaker';
        this.pendingId = brk.id;
        return `[${key}] CUT BREAKER — ${brk.label}`;
      }
    }

    // Priority 6: Grab shaped Breach Charge from Estate Guard Armory bench
    if (!playerHasBreach && p.distanceTo(ARMORY_KIT_VEC) <= 2.6) {
      this.pendingKind = 'take_breach';
      return `[${key}] TAKE SHAPED BREACH CHARGES`;
    }

    return null;
  }

  private handleInteractPress(): void {
    if (this.pendingKind === 'none' || !this.ctx.input.pressed('interact')) return;

    switch (this.pendingKind) {
      case 'takedown':
        if (this.takedown && this.pendingEnemy?.alive) {
          const res = this.takedown.execute(this.pendingEnemy, this.ctx);
          this.ctx.audio.play('stealth_takedown', { position: res.position, volume: 0.85 });
          this.outpost?.reportSound(res.position, res.noiseRadius, false);
        }
        return;
      case 'plant_breach':
        this.startBreachChargePlant();
        return;
      case 'overload_capacitor':
        this.startHydraulicOverload();
        return;
      case 'alarm':
        if (this.pendingId) this.alarms?.interact(this.pendingId);
        return;
      case 'breaker':
        if (this.pendingId) this.breakers?.interact(this.pendingId);
        return;
      case 'take_breach':
        this.hasBreachCharge = true;
        if (this.armoryKitMesh) this.armoryKitMesh.visible = false;
        this.ctx.audio.play('ui_click', { position: ARMORY_KIT_VEC, volume: 0.6, pitch: 0.9 });
        this.ctx.hud.feed('SHAPED BREACH CHARGES ACQUIRED — PLANT AT CONTINUITY BUNKER DOOR', '#ffc14a');
        return;
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Interactive World Props & Chancery Lore Set-Dressing
  // -----------------------------------------------------------------------------------------------

  private buildInteractiveBreachProps(): void {
    const steelDark = new THREE.MeshStandardMaterial({ color: 0x252b33, roughness: 0.55, metalness: 0.72 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb98d44, roughness: 0.42, metalness: 0.78 });
    const chargeBodyMat = new THREE.MeshStandardMaterial({ color: 0x3b4437, roughness: 0.75, metalness: 0.15 });
    const breachLedMat = new THREE.MeshBasicMaterial({ color: 0xff2626 });
    const capLedMat = new THREE.MeshBasicMaterial({ color: 0x38d8ff });
    const capCoreMat = new THREE.MeshStandardMaterial({
      color: 0x5c7288,
      emissive: 0x1c384a,
      emissiveIntensity: 0.6,
      roughness: 0.4,
      metalness: 0.65,
    });
    this.breachLedMat = breachLedMat;
    this.capacitorLedMat = capLedMat;
    this.ownedMats.push(steelDark, brass, chargeBodyMat, breachLedMat, capLedMat, capCoreMat);

    // 1. Planted shaped Breach Charge mesh on the Tier-3 Bunker Blast Door (hidden until planted)
    const chargeGroup = new THREE.Group();
    chargeGroup.position.copy(BREACH_PLANT_VEC);
    const brickGeo = new THREE.BoxGeometry(0.42, 0.24, 0.12);
    const clampGeo = new THREE.BoxGeometry(0.48, 0.05, 0.14);
    const ledGeo = new THREE.SphereGeometry(0.032, 8, 6);
    this.ownedGeos.push(brickGeo, clampGeo, ledGeo);

    const brick = new THREE.Mesh(brickGeo, chargeBodyMat);
    const clampTop = new THREE.Mesh(clampGeo, steelDark);
    clampTop.position.set(0, 0.08, 0);
    const clampBot = new THREE.Mesh(clampGeo, steelDark);
    clampBot.position.set(0, -0.08, 0);
    const led = new THREE.Mesh(ledGeo, breachLedMat);
    led.position.set(0, 0, 0.075);
    chargeGroup.add(brick, clampTop, clampBot, led);
    chargeGroup.visible = false;
    this.breachChargeGroup = chargeGroup;
    this.propsRoot.add(chargeGroup);

    // 2. Generator Sub-Basement Hydraulic Capacitor Console at (-50, -8, -22)
    const consoleGroup = new THREE.Group();
    consoleGroup.position.copy(GENERATOR_CONSOLE_VEC);
    const pedGeo = new THREE.BoxGeometry(1.3, 1.15, 0.72);
    const cylGeo = new THREE.CylinderGeometry(0.24, 0.24, 1.35, 14);
    const dialGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 16);
    const needleGeo = new THREE.BoxGeometry(0.025, 0.18, 0.03);
    const beaconGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.12, 10);
    this.ownedGeos.push(pedGeo, cylGeo, dialGeo, needleGeo, beaconGeo);

    const pedestal = new THREE.Mesh(pedGeo, steelDark);
    pedestal.position.set(0, 0.575, 0);
    const capLeft = new THREE.Mesh(cylGeo, capCoreMat);
    capLeft.position.set(-0.42, 1.55, -0.14);
    const capRight = new THREE.Mesh(cylGeo, capCoreMat);
    capRight.position.set(0.42, 1.55, -0.14);
    this.capacitorCoreMesh = capLeft;

    const dial = new THREE.Mesh(dialGeo, brass);
    dial.rotation.x = Math.PI / 2;
    dial.position.set(0, 1.32, 0.34);

    const needlePivot = new THREE.Group();
    needlePivot.position.set(0, 1.32, 0.38);
    const needle = new THREE.Mesh(needleGeo, breachLedMat);
    needle.position.set(0, 0.06, 0);
    needlePivot.add(needle);
    needlePivot.rotation.z = -1.2;
    this.capacitorNeedle = needlePivot;

    const beacon = new THREE.Mesh(beaconGeo, capLedMat);
    beacon.position.set(0, 1.22, 0.18);

    consoleGroup.add(pedestal, capLeft, capRight, dial, needlePivot, beacon);
    this.propsRoot.add(consoleGroup);

    // 3. Estate Guard Armory Breach Charge visual crate at (-14, -8, -16)
    const kitGroup = new THREE.Group();
    kitGroup.position.set(ARMORY_KIT_VEC.x, ARMORY_KIT_VEC.y + 0.85, ARMORY_KIT_VEC.z);
    const pack1 = new THREE.Mesh(brickGeo, chargeBodyMat);
    pack1.position.set(-0.18, 0.12, 0);
    pack1.rotation.y = 0.2;
    const pack2 = new THREE.Mesh(brickGeo, chargeBodyMat);
    pack2.position.set(0.18, 0.12, 0.06);
    pack2.rotation.y = -0.3;
    kitGroup.add(pack1, pack2);
    this.armoryKitMesh = kitGroup;
    this.propsRoot.add(kitGroup);
  }

  private buildLoreProps(): void {
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x3b2618, roughness: 0.72, metalness: 0.08 });
    const slateMat = new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.85, metalness: 0.1 });
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xd9d2c3, roughness: 0.9, metalness: 0.0 });
    const redInkMat = new THREE.MeshStandardMaterial({ color: 0xb82424, roughness: 0.6, metalness: 0.1 });
    const pinMat = new THREE.MeshBasicMaterial({ color: 0xff2d2d });
    const stringMat = new THREE.LineBasicMaterial({ color: 0xe22a2a });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xc8a14c, roughness: 0.34, metalness: 0.82 });
    const shadeGreenMat = new THREE.MeshStandardMaterial({
      color: 0x1e6b3a,
      emissive: 0x22994c,
      emissiveIntensity: 0.65,
      roughness: 0.35,
      metalness: 0.1,
    });
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x2e353d, roughness: 0.65, metalness: 0.45 });
    this.ownedMats.push(darkWood, slateMat, paperMat, redInkMat, pinMat, stringMat, brassMat, shadeGreenMat, crateMat);

    // 1. Red Goggles Sighting Board on West wall of Upper Bureau (-19.5, 7.6, -42)
    const boardGroup = new THREE.Group();
    boardGroup.position.set(RED_GOGGLES_BOARD_POS[0], 7.6, RED_GOGGLES_BOARD_POS[2]);
    boardGroup.rotation.y = Math.PI / 2;

    const frameGeo = new THREE.BoxGeometry(3.2, 1.85, 0.08);
    const backingGeo = new THREE.BoxGeometry(3.0, 1.65, 0.05);
    const cardGeo = new THREE.BoxGeometry(0.46, 0.34, 0.02);
    const pinGeo = new THREE.SphereGeometry(0.032, 8, 6);
    this.ownedGeos.push(frameGeo, backingGeo, cardGeo, pinGeo);

    boardGroup.add(new THREE.Mesh(frameGeo, darkWood));
    const backing = new THREE.Mesh(backingGeo, slateMat);
    backing.position.z = 0.03;
    boardGroup.add(backing);

    // 4 sighting stills (Outpost, Carrow, Port Vell, Holdfast) + central Red Goggles print linked by red string
    const pinCoords: readonly (readonly [number, number])[] = [
      [-1.05, 0.42],
      [-0.25, 0.48],
      [0.85, 0.36],
      [-0.75, -0.38],
      [0.45, -0.32],
    ];
    for (let i = 0; i < pinCoords.length; i++) {
      const [px, py] = pinCoords[i]!;
      const card = new THREE.Mesh(cardGeo, i === 1 ? redInkMat : paperMat);
      card.position.set(px, py, 0.065);
      card.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.06;
      const pin = new THREE.Mesh(pinGeo, pinMat);
      pin.position.set(px, py + 0.12, 0.085);
      boardGroup.add(card, pin);
    }
    const lineVerts = new Float32Array([
      -1.05, 0.54, 0.085, -0.25, 0.6, 0.085,
      -0.25, 0.6, 0.085, 0.85, 0.48, 0.085,
      -0.25, 0.6, 0.085, -0.75, -0.26, 0.085,
      -0.75, -0.26, 0.085, 0.45, -0.2, 0.085,
      0.85, 0.48, 0.085, 0.45, -0.2, 0.085,
    ]);
    const stringGeo = new THREE.BufferGeometry();
    stringGeo.setAttribute('position', new THREE.BufferAttribute(lineVerts, 3));
    this.ownedGeos.push(stringGeo);
    boardGroup.add(new THREE.LineSegments(stringGeo, stringMat));
    this.propsRoot.add(boardGroup);

    // 2. Contractor #4418-B rangefinder tripod & equipment crate on East Bell-Tower Sniper Perch (48.8, 11.5, -21.2)
    const perchGroup = new THREE.Group();
    perchGroup.position.set(48.8, 11.5, -21.2);
    const crateGeo = new THREE.BoxGeometry(0.92, 0.36, 0.44);
    const legGeo = new THREE.CylinderGeometry(0.018, 0.014, 1.25, 6);
    const scopeGeo = new THREE.BoxGeometry(0.14, 0.1, 0.32);
    this.ownedGeos.push(crateGeo, legGeo, scopeGeo);

    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.set(0.32, 0.18, 0.35);
    crate.rotation.y = 0.45;
    perchGroup.add(crate);

    for (let i = 0; i < 3; i++) {
      const ang = (i * Math.PI * 2) / 3;
      const leg = new THREE.Mesh(legGeo, crateMat);
      leg.position.set(Math.cos(ang) * 0.22, 0.56, Math.sin(ang) * 0.22);
      leg.rotation.z = Math.cos(ang) * 0.26;
      leg.rotation.x = -Math.sin(ang) * 0.26;
      perchGroup.add(leg);
    }
    const rangefinder = new THREE.Mesh(scopeGeo, brassMat);
    rangefinder.position.set(0, 1.18, 0);
    rangefinder.rotation.y = Math.PI * 0.38;
    perchGroup.add(rangefinder);
    this.propsRoot.add(perchGroup);

    // 3. Tallow Rendering Works red-ink manifest stack & brass banker's lamp on Vane's Executive Desk (0, 6.9, -46)
    const deskGroup = new THREE.Group();
    deskGroup.position.set(VANE_DESK_POS[0], 6.9, VANE_DESK_POS[2]);
    const stackGeo = new THREE.BoxGeometry(0.32, 0.09, 0.42);
    const stampGeo = new THREE.BoxGeometry(0.24, 0.015, 0.16);
    const lampBaseGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.05, 12);
    const lampStemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.34, 8);
    const lampShadeGeo = new THREE.BoxGeometry(0.28, 0.11, 0.15);
    this.ownedGeos.push(stackGeo, stampGeo, lampBaseGeo, lampStemGeo, lampShadeGeo);

    const stack = new THREE.Mesh(stackGeo, paperMat);
    stack.position.set(-0.55, 0.045, 0.05);
    stack.rotation.y = 0.14;
    const redSeal = new THREE.Mesh(stampGeo, redInkMat);
    redSeal.position.set(-0.55, 0.095, 0.05);
    redSeal.rotation.y = 0.14;

    const lampBase = new THREE.Mesh(lampBaseGeo, brassMat);
    lampBase.position.set(0.68, 0.025, -0.08);
    const lampStem = new THREE.Mesh(lampStemGeo, brassMat);
    lampStem.position.set(0.68, 0.2, -0.08);
    const lampShade = new THREE.Mesh(lampShadeGeo, shadeGreenMat);
    lampShade.position.set(0.68, 0.38, -0.08);

    deskGroup.add(stack, redSeal, lampBase, lampStem, lampShade);
    this.propsRoot.add(deskGroup);

    // 4. Brass fireplace plaque in Grand Foyer ("Regional Infrastructure Reallocation #402 — Outpost Bridge Deferral")
    const plaqueGroup = new THREE.Group();
    plaqueGroup.position.set(0, 1.85, -35.8);
    const plaqueBackGeo = new THREE.BoxGeometry(1.18, 0.56, 0.06);
    const plaquePlateGeo = new THREE.BoxGeometry(1.04, 0.42, 0.04);
    this.ownedGeos.push(plaqueBackGeo, plaquePlateGeo);

    const plaqueBack = new THREE.Mesh(plaqueBackGeo, darkWood);
    const plaquePlate = new THREE.Mesh(plaquePlateGeo, brassMat);
    plaquePlate.position.z = 0.03;
    plaqueGroup.add(plaqueBack, plaquePlate);
    this.propsRoot.add(plaqueGroup);
  }

  // -----------------------------------------------------------------------------------------------
  // Per-frame Update, Reset & Disposal
  // -----------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (!this.built || !this.active) return;
    this.attachWorldHooks();

    // 1. Advance sweeping security cameras using current local light level at player's feet
    const lightLevel = this.lights?.lightAt(this.ctx.player.position, 0.06, true) ?? 0.06;
    if (this.cameras && this.ctx.player.alive) {
      this.cameras.update(dt, this.ctx.player.eye, lightLevel);
    }

    // 2. Drive High Magistrate Aldous Vane's 75 s Upper Bureau routine / Lift retreat / Bunker state
    this.updateVane(dt);

    // 3. Update planted Breach Charge fuse & Generator Hydraulic Capacitor overload countdowns
    this.updateBreachSystems(dt);

    // 4. Dispatch QRF reinforcements from Main Gatehouse while in lockdown unless Security Hub is overridden
    this.updateQrfWaves(dt);

    // 5. Evaluate highest-priority contextual [E] prompt & handle player press
    const prompt = this.evaluateInteraction();
    this.handleInteractPress();

    // 6. Push zero-allocation snapshot to Stealth HUD
    if (this.stealthHud && this.outpost) {
      const snap = this.outpost.getStealthSnapshot();
      this.hudOpts.prompt = prompt;
      this.hudOpts.cameraLock = this.cameras?.maxLock() ?? 0;
      this.hudOpts.hubOverridden = this.alarms?.hubOverridden ?? false;
      this.stealthHud.update(snap, this.hudOpts);
    }
  }

  /** Alias for `clear()` so Campaign.reset() resets transient state cleanly. */
  reset(): void {
    this.clear();
  }

  /** Resets transient mission state on checkpoint redeploy or fresh run start. */
  clear(): void {
    this.active = false;
    this.detachWorldHooks();
    this.lockdownActive = false;
    this.bunkerBreached = false;
    this.hasBreachCharge = false;
    this.breachPlanted = false;
    this.breachTimer = 0;
    this.breachBeepAccum = 0;
    this.overloadActive = false;
    this.overloadTimer = 0;
    this.overloadSparkAccum = 0;
    this.qrfTimer = QRF_INTERVAL_SECONDS;
    this.patrolAssigned.clear();
    this.pendingKind = 'none';
    this.pendingId = '';
    this.pendingEnemy = null;

    if (this.breachChargeGroup) this.breachChargeGroup.visible = false;
    if (this.armoryKitMesh) this.armoryKitMesh.visible = true;
    if (this.capacitorLedMat) this.capacitorLedMat.color.setHex(0x38d8ff);
    if (this.capacitorNeedle) this.capacitorNeedle.rotation.z = -1.2;

    if (this.vaneBody) {
      this.vaneLapelMesh?.removeFromParent();
      if (this.vaneBody.alive) this.manager.withdraw(this.vaneBody);
      this.vaneBody = null;
    }
    this.vanePhase = 'none';
    this.vaneStationIdx = 0;
    this.vaneWaitLeft = 0;
    this.vaneRetreatClock = 0;
    this.clearVaneMarker();

    this.lights?.reset();
    this.breakers?.reset();
    this.cameras?.reset();
    this.alarms?.reset();
    this.stealthHud?.reset();
    this.stealthHud?.setActive(false);

    this.wireThermal(false);
    const o = this.outpost;
    if (o) {
      o.setStealthMode(false);
      o.setLightQuery(null);
      o.setAlarmPanels(null);
      o.stealth.onGuardStateChange = null;
      if (this.outpostLockdownWrapped) {
        o.stealth.onLockdown = this.origOutpostLockdown;
      }
    }
  }

  /** Permanently tears down all owned meshes, colliders, DOM nodes, and listeners. */
  dispose(): void {
    this.clear();
    for (let i = 0; i < this.unsubs.length; i++) this.unsubs[i]!();
    this.unsubs.length = 0;

    this.lights?.dispose();
    this.breakers?.dispose();
    this.cameras?.dispose();
    this.alarms?.dispose();
    this.stealthHud?.el.remove();

    this.propsRoot.removeFromParent();
    this.propsRoot.clear();
    for (let i = 0; i < this.ownedGeos.length; i++) this.ownedGeos[i]!.dispose();
    for (let i = 0; i < this.ownedMats.length; i++) this.ownedMats[i]!.dispose();
    this.ownedGeos.length = 0;
    this.ownedMats.length = 0;

    this.lights = null;
    this.breakers = null;
    this.cameras = null;
    this.alarms = null;
    this.takedown = null;
    this.stealthHud = null;
    this.built = false;
  }
}
