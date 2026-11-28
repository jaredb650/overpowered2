/**
 * Enemy Fortress "Iron Bastion" Blast Gates & Heavy Anti-Armor Turrets (`BastionDefenseSystem`).
 *
 * - Owns the 3 armored destructible Blast Gates sealing Iron Bastion at `z = -258` (`west`, `center`, `east`):
 *   - Physically blocks the player, player-driven vehicles, Distraint Frame, and friendly AI armor
 *     (via `CG.World` static box colliders + `AiVehicleFleet.setGateOpen(gate.id, false)`) until blown up.
 *   - Enemy ground vehicles (kinematic waypoint drivers) roll straight out through their own gates so
 *     reinforcements never jam, while enemy infantry deploy cleanly from exterior sally ports while sealed.
 *   - Heavy armor: takes 100%+ damage from tank shells, RPGs, bombs, AGMs, artillery, and Frame blows;
 *     takes 25% chip damage from small arms so combined-arms breaching feels earned.
 * - Owns 4 elevated wall-mounted Anti-Armor / SAM Defense Towers guarding Iron Bastion:
 *   - Ruthlessly prioritize any friendly armor, Frame, or intruder that enters Iron Bastion (`z < -250`),
 *     as well as allied aircraft raiding the fortress.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ally } from '../../allies/ally';
import { type Ctx, type ExplosionKind } from '../../core/contracts';
import type { ExplosionSpec, MissileTarget, VehicleRadarTarget } from '../../core/gameplay';
import { clamp } from '../../core/math';
import type { AiFriendlyVehicle, AiSiegeTarget } from '../../vehicles/drive/aiDriver';
import type { AiCombatJet } from '../dogfight/aiJet';
import type { ExtraTarget } from '../vehicles';
import {
  ENDLESS_WAR_BASTION_GATES,
  ENDLESS_WAR_BASTION_TURRETS,
  type BastionGatePlan,
  type WarLaneId,
} from '../../world/map/endlessWar/plan';

export interface BastionGateSnapshot {
  readonly id: string;
  readonly lane: WarLaneId;
  readonly shortName: string;
  readonly sealed: boolean;
  readonly hp: number;
  readonly maxHp: number;
  readonly rebuildLeft: number;
}

export interface BastionDefenseCallbacks {
  onGateBreached?: (plan: BastionGatePlan) => void;
  onGateRebuilt?: (plan: BastionGatePlan) => void;
}

interface LiveBastionGate {
  readonly plan: BastionGatePlan;
  readonly pos: THREE.Vector3;
  readonly center: THREE.Vector3;
  readonly half: THREE.Vector3;
  readonly group: THREE.Group;
  readonly intactGroup: THREE.Group;
  readonly breachedGroup: THREE.Group;
  readonly beaconMesh: THREE.Mesh;
  readonly beaconMat: THREE.MeshBasicMaterial;
  readonly collider: RAPIER.Collider | null;
  readonly siegeTarget: AiSiegeTarget;
  sealed: boolean;
  hp: number;
  maxHp: number;
  rebuildLeft: number;
  smokeCd: number;
  flashT: number;
}

interface BastionTurret {
  readonly id: string;
  readonly kind: 'at_cannon' | 'sam';
  readonly pos: THREE.Vector3;
  readonly group: THREE.Group;
  readonly head: THREE.Group;
  cooldown: number;
}

interface BastionTracer {
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly quat: THREE.Quaternion;
  isSam: boolean;
  life: number;
}

const MAX_TRACERS = 24;
const TURRET_GROUND_RANGE = 175;
const TURRET_AIR_RANGE = 320;

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _oneScale = new THREE.Vector3(1, 1, 1);
const _instMat = new THREE.Matrix4();

function buildGateVisuals(plan: BastionGatePlan): {
  group: THREE.Group;
  intactGroup: THREE.Group;
  breachedGroup: THREE.Group;
  beaconMesh: THREE.Mesh;
  beaconMat: THREE.MeshBasicMaterial;
} {
  const group = new THREE.Group();
  group.position.set(plan.position[0], plan.position[1], plan.position[2]);

  const intactGroup = new THREE.Group();
  const breachedGroup = new THREE.Group();
  breachedGroup.visible = false;
  group.add(intactGroup, breachedGroup);

  const [hx, hy, hz] = plan.half;
  const armorMat = new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.65, metalness: 0.62 });
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x1e2024, roughness: 0.55, metalness: 0.72 });
  const hazardMat = new THREE.MeshStandardMaterial({ color: 0xb83a22, roughness: 0.5, metalness: 0.35 });
  const charredMat = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.94, metalness: 0.2 });
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3b2c });

  // Twin armored steel blast door leaves
  const leafW = hx - 0.25;
  for (const sx of [-leafW * 0.5 - 0.15, leafW * 0.5 + 0.15]) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, hy * 1.92, hz * 1.45), armorMat);
    leaf.position.set(sx, hy * 0.96, 0);
    intactGroup.add(leaf);
  }

  // Vertical blast-door armor ribs & central hydraulic lock seam
  for (let rx = -hx + 2.2; rx <= hx - 2.2; rx += 4.2) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.65, hy * 1.98, hz * 1.8), ribMat);
    rib.position.set(rx, hy * 0.99, 0);
    intactGroup.add(rib);
  }
  const lockBar = new THREE.Mesh(new THREE.BoxGeometry(hx * 1.96, 0.85, hz * 1.9), hazardMat);
  lockBar.position.set(0, hy * 1.05, 0);
  intactGroup.add(lockBar);

  // Overhead armored lintel & glowing breach target beacon
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(hx * 2.1, 1.2, hz * 2.1), ribMat);
  lintel.position.set(0, hy * 2.0 + 0.5, 0);
  intactGroup.add(lintel);

  const beaconMesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), beaconMat);
  beaconMesh.position.set(0, hy * 2.0 + 2.6, 0.8);
  intactGroup.add(beaconMesh);

  // Breached state: jagged blasted door stubs flanking an open 24 m roadway
  for (const sx of [-hx + 1.1, hx - 1.1]) {
    const stub = new THREE.Mesh(new THREE.BoxGeometry(2.0, hy * 1.15, hz * 1.5), charredMat);
    stub.position.set(sx, hy * 0.58, 0);
    breachedGroup.add(stub);
  }

  const mergeChildren = (grp: THREE.Group, skip?: THREE.Object3D): void => {
    const byMat = new Map<THREE.Material, THREE.Mesh[]>();
    for (const ch of grp.children) {
      if (!(ch as THREE.Mesh).isMesh || ch === skip) continue;
      const m = ch as THREE.Mesh;
      if (Array.isArray(m.material)) continue;
      let list = byMat.get(m.material);
      if (!list) { list = []; byMat.set(m.material, list); }
      list.push(m);
    }
    for (const [mat, list] of byMat) {
      if (list.length < 2) {
        list[0]!.matrixAutoUpdate = false;
        list[0]!.updateMatrix();
        continue;
      }
      const geos: THREE.BufferGeometry[] = [];
      for (const m of list) {
        m.updateMatrix();
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.applyMatrix4(m.matrix);
        geos.push(g);
        grp.remove(m);
      }
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (merged) {
        const mm = new THREE.Mesh(merged, mat);
        mm.matrixAutoUpdate = false;
        mm.updateMatrix();
        grp.add(mm);
      }
    }
  };
  mergeChildren(intactGroup, beaconMesh);
  mergeChildren(breachedGroup);
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  intactGroup.matrixAutoUpdate = false;
  intactGroup.updateMatrix();
  breachedGroup.matrixAutoUpdate = false;
  breachedGroup.updateMatrix();

  return { group, intactGroup, breachedGroup, beaconMesh, beaconMat };
}

export class BastionDefenseSystem implements ExtraTarget {
  readonly root = new THREE.Group();
  private readonly gates: LiveBastionGate[] = [];
  private readonly gateByLane = new Map<WarLaneId, LiveBastionGate>();
  private readonly gateById = new Map<string, LiveBastionGate>();
  private readonly gateByCollider = new Map<RAPIER.Collider, LiveBastionGate>();
  private readonly turrets: BastionTurret[] = [];
  private readonly tracers: BastionTracer[] = [];
  private readonly tracerPool: BastionTracer[] = [];
  private readonly tracerGeo = new THREE.BoxGeometry(0.2, 0.2, 5.6);
  private readonly atMat = new THREE.MeshBasicMaterial({ color: 0xff5a2c });
  private readonly samMat = new THREE.MeshBasicMaterial({ color: 0xff2e44 });
  private readonly atTracerInst: THREE.InstancedMesh;
  private readonly samTracerInst: THREE.InstancedMesh;
  private unsubExplosion: (() => void) | null = null;
  private pulseClock = 0;
  private armorHintCd = 0;
  breachedCount = 0;

  constructor(
    private readonly ctx: Ctx,
    private readonly cb: BastionDefenseCallbacks = {},
  ) {
    this.root.name = 'endless-war-bastion-defense';
    this.atTracerInst = new THREE.InstancedMesh(this.tracerGeo, this.atMat, MAX_TRACERS);
    this.samTracerInst = new THREE.InstancedMesh(this.tracerGeo, this.samMat, MAX_TRACERS);
    for (const inst of [this.atTracerInst, this.samTracerInst]) {
      inst.count = 0;
      inst.visible = false;
      inst.frustumCulled = false;
      inst.castShadow = false;
      inst.receiveShadow = false;
    }
  }

  private syncTracers(): void {
    let at = 0;
    let sam = 0;
    for (let i = 0; i < this.tracers.length; i++) {
      const tr = this.tracers[i]!;
      _instMat.compose(tr.pos, tr.quat, _oneScale);
      if (tr.isSam) this.samTracerInst.setMatrixAt(sam++, _instMat);
      else this.atTracerInst.setMatrixAt(at++, _instMat);
    }
    this.atTracerInst.count = at;
    this.atTracerInst.visible = at > 0;
    if (at > 0) this.atTracerInst.instanceMatrix.needsUpdate = true;

    this.samTracerInst.count = sam;
    this.samTracerInst.visible = sam > 0;
    if (sam > 0) this.samTracerInst.instanceMatrix.needsUpdate = true;
  }

  init(): void {
    this.dispose();
    if (this.ctx.render.scene instanceof THREE.Scene) {
      this.ctx.render.scene.add(this.root);
    }
    this.root.add(this.atTracerInst, this.samTracerInst);

    // 1. Build the 3 destructible Iron Bastion Blast Gates
    for (const plan of ENDLESS_WAR_BASTION_GATES) {
      const vis = buildGateVisuals(plan);
      this.root.add(vis.group);
      const pos = new THREE.Vector3(...plan.position);
      const half = new THREE.Vector3(...plan.half);
      const center = new THREE.Vector3(pos.x, pos.y + half.y * 0.85, pos.z);

      let collider: RAPIER.Collider | null = null;
      if (this.ctx.physics?.addStaticBox) {
        collider = this.ctx.physics.addStaticBox(
          new THREE.Vector3(pos.x, pos.y + half.y, pos.z),
          half,
          null,
          'metal',
        );
      }

      const gate: LiveBastionGate = {
        plan,
        pos,
        center,
        half,
        group: vis.group,
        intactGroup: vis.intactGroup,
        breachedGroup: vis.breachedGroup,
        beaconMesh: vis.beaconMesh,
        beaconMat: vis.beaconMat,
        collider,
        siegeTarget: null as unknown as AiSiegeTarget,
        sealed: true,
        hp: plan.maxHp,
        maxHp: plan.maxHp,
        rebuildLeft: 0,
        smokeCd: 0,
        flashT: 0,
      };
      (gate as { siegeTarget: AiSiegeTarget }).siegeTarget = {
        id: plan.id,
        position: center,
        get alive() { return gate.sealed; },
        takeDamage: (amount, source) => this.damageGate(gate, amount, source ?? 'ally_armor', true),
      };

      this.gates.push(gate);
      this.gateByLane.set(plan.lane, gate);
      this.gateById.set(plan.id, gate);
      if (collider) this.gateByCollider.set(collider, gate);
    }

    // 2. Build the 4 elevated Iron Bastion AT/SAM Defense Turrets
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2526, roughness: 0.65, metalness: 0.58 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x1b1a1c, roughness: 0.45, metalness: 0.78 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xa62a22, roughness: 0.5, metalness: 0.3 });

    for (const def of ENDLESS_WAR_BASTION_TURRETS) {
      const group = new THREE.Group();
      group.position.set(def.pos[0], def.pos[1], def.pos[2]);

      const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 1.2, 8), baseMat);
      ped.position.y = 0.6;
      group.add(ped);

      const head = new THREE.Group();
      head.position.y = 1.4;
      if (def.kind === 'at_cannon') {
        const housing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.25, 2.5), baseMat);
        housing.position.y = 0.55;
        head.add(housing);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.16, 0.28, 2.56), trimMat);
        stripe.position.y = 1.05;
        head.add(stripe);
        for (const sx of [-0.42, 0.42]) {
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 3.2, 6), gunMat);
          barrel.rotation.x = Math.PI / 2;
          barrel.position.set(sx, 0.55, 2.0);
          head.add(barrel);
        }
      } else {
        const pod = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.3, 2.2), baseMat);
        pod.position.y = 0.6;
        head.add(pod);
        for (const sx of [-0.55, 0.55]) {
          const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.6, 6), trimMat);
          tube.rotation.x = Math.PI * 0.36;
          tube.position.set(sx, 0.95, 0.45);
          head.add(tube);
        }
      }
      group.add(head);
      this.root.add(group);

      this.turrets.push({
        id: def.id,
        kind: def.kind,
        pos: new THREE.Vector3(def.pos[0], def.pos[1] + 1.5, def.pos[2]),
        group,
        head,
        cooldown: Math.random() * 0.5,
      });
    }

    // Register with VehicleSystem so bullets, tank shells, rockets, AGMs, bombs, and Frame blows hit gates
    const vs = this.ctx.enemies?.vehicles as { addExtra?: (t: ExtraTarget) => void } | undefined;
    vs?.addExtra?.(this);

    if (this.ctx.events?.on) {
      this.unsubExplosion = this.ctx.events.on('combat:explosion', e => {
        this.applyBlast(e.position, e.radius, e.damage);
      });
    }
  }

  isGateSealed(lane: WarLaneId): boolean {
    return this.gateByLane.get(lane)?.sealed ?? false;
  }

  isGateIdSealed(id: string): boolean {
    return this.gateById.get(id)?.sealed ?? false;
  }

  getGateSnapshots(): BastionGateSnapshot[] {
    return this.gates.map(g => ({
      id: g.plan.id,
      lane: g.plan.lane,
      shortName: g.plan.shortName,
      sealed: g.sealed,
      hp: Math.max(0, Math.round(g.hp)),
      maxHp: g.maxHp,
      rebuildLeft: Math.max(0, Math.ceil(g.rebuildLeft)),
    }));
  }

  /** Returns live sealed gates as siege targets so friendly tanks help blast open sealed gates. */
  getSiegeTargets(): readonly AiSiegeTarget[] {
    const out: AiSiegeTarget[] = [];
    for (const g of this.gates) {
      if (g.sealed) out.push(g.siegeTarget);
    }
    return out;
  }

  damageGateByLane(lane: WarLaneId, amount: number, source = 'breach_charge', heavy = true): boolean {
    const g = this.gateByLane.get(lane);
    if (!g || !g.sealed) return false;
    this.damageGate(g, amount, source, heavy);
    return true;
  }

  update(
    dt: number,
    threatLevel: number,
    friendlyVehicles: readonly AiFriendlyVehicle[],
    friendlyInfantry: readonly Ally[],
    alliedJets: readonly AiCombatJet[],
  ): void {
    this.pulseClock += dt;
    if (this.armorHintCd > 0) this.armorHintCd = Math.max(0, this.armorHintCd - dt);

    const rebuildRate = 1 + Math.max(0, threatLevel - 3) * 0.06;

    // 1. Tick Blast Gates (beacon pulse, damage smoke, and rebuild timers)
    for (const g of this.gates) {
      if (g.sealed) {
        g.beaconMesh.rotation.y += dt * 2.2;
        const hpFrac = g.hp / g.maxHp;
        if (g.flashT > 0) {
          g.flashT = Math.max(0, g.flashT - dt);
          g.beaconMat.color.setHex(0xffffff);
        } else {
          const pulse = 0.68 + 0.32 * Math.sin(this.pulseClock * 5.2);
          g.beaconMat.color.setRGB(pulse, hpFrac < 0.45 ? 0.55 * pulse : 0.14 * pulse, 0.12 * pulse);
        }
        if (hpFrac < 0.6) {
          g.smokeCd -= dt;
          if (g.smokeCd <= 0) {
            g.smokeCd = hpFrac < 0.3 ? 0.25 : 0.55;
            _v.set(g.pos.x + (Math.random() - 0.5) * 14, g.pos.y + 3.2, g.pos.z + 2.0);
            this.ctx.fx?.smoke?.(_v, 0x262524, 3.0, 2.2);
          }
        }
      } else if (g.rebuildLeft > 0) {
        g.rebuildLeft = Math.max(0, g.rebuildLeft - dt * rebuildRate);
        if (g.rebuildLeft <= 0) {
          if (this.isDoorwayClear(g, friendlyVehicles)) {
            this.rebuildGate(g, threatLevel);
          } else {
            g.rebuildLeft = 3.0;
          }
        }
      }
    }

    // 2. Iron Bastion Wall Turrets: violently prioritize intruders inside walls (z < -250), then approaching armor & aircraft
    const threatMult = 1 + Math.min(0.65, Math.max(0, threatLevel - 1) * 0.08);
    const player = this.ctx.player as {
      alive?: boolean;
      position?: THREE.Vector3;
      takeDamage?: (info: unknown) => void;
    } | undefined;

    for (const t of this.turrets) {
      t.cooldown -= dt * threatMult;
      if (t.cooldown > 0) continue;

      let fired = false;

      // Priority 1: Friendly ground armor / APCs inside Iron Bastion (z < -250) or pressing the wall (z < -175)
      if (friendlyVehicles.length > 0) {
        let bestVeh: AiFriendlyVehicle | null = null;
        let bestScore = Infinity;
        for (const v of friendlyVehicles) {
          if (!v.alive || v.disposed) continue;
          const dist = v.position.distanceTo(t.pos);
          const maxR = v.airborne ? TURRET_AIR_RANGE : TURRET_GROUND_RANGE;
          if (dist > maxR) continue;
          if (!v.airborne && v.position.z > -165) continue;
          const insideWalls = !v.airborne && v.position.z < -250;
          // Inside walls = 3x priority; SAM turret prefers airborne choppers
          const mult = insideWalls ? 0.28 : (t.kind === 'sam' && v.airborne ? 0.45 : 1.0);
          const score = dist * mult;
          if (score < bestScore) {
            bestScore = score;
            bestVeh = v;
          }
        }
        if (bestVeh) {
          _v.set(bestVeh.position.x, bestVeh.position.y + bestVeh.aimLift, bestVeh.position.z);
          const insideWalls = !bestVeh.airborne && bestVeh.position.z < -250;
          this.aimAndFire(t, _v, t.kind === 'sam');
          const dmg = t.kind === 'at_cannon' ? (insideWalls ? 125 : 85) : 70;
          bestVeh.takeDamage(dmg, t.pos, 'bastion_at_turret');
          t.cooldown = t.kind === 'at_cannon' ? (insideWalls ? 0.72 : 1.05) : 1.35;
          fired = true;
        }
      }

      // Priority 2: Allied combat jets raiding Iron Bastion
      if (!fired && alliedJets.length > 0) {
        let bestJet: AiCombatJet | null = null;
        let bestDist = TURRET_AIR_RANGE;
        for (const jet of alliedJets) {
          if (!jet.alive) continue;
          const d = jet.position.distanceTo(t.pos);
          if (d < bestDist) {
            bestDist = d;
            bestJet = jet;
          }
        }
        if (bestJet) {
          this.aimAndFire(t, bestJet.position, t.kind === 'sam');
          bestJet.applyDamage(t.kind === 'sam' ? 52 : 24, bestJet.position, 'bastion_aa', false, t.kind === 'sam');
          t.cooldown = t.kind === 'sam' ? 1.4 : 0.45;
          fired = true;
        }
      }

      // Priority 3: Player breaching inside Iron Bastion (z < -248) or close to the gates (z < -215)
      if (!fired && player?.alive && player.position && player.position.z < -215) {
        const d = player.position.distanceTo(t.pos);
        if (d < 145) {
          _v.set(player.position.x, player.position.y + 1.2, player.position.z);
          this.aimAndFire(t, _v, false);
          const insideWalls = player.position.z < -252;
          player.takeDamage?.({
            amount: insideWalls ? 18 : 10,
            from: t.pos,
            type: 'bullet',
            source: 'IRON BASTION DEFENSE TURRET',
          });
          t.cooldown = insideWalls ? 0.85 : 1.3;
          fired = true;
        }
      }

      // Priority 4: Breaching friendly infantry inside/near Iron Bastion
      if (!fired && friendlyInfantry.length > 0) {
        let bestAlly: Ally | null = null;
        let bestDist = 140;
        for (const a of friendlyInfantry) {
          if (!a.alive || a.body.position.z > -195) continue;
          const d = a.body.position.distanceTo(t.pos);
          if (d < bestDist) {
            bestDist = d;
            bestAlly = a;
          }
        }
        if (bestAlly) {
          _v.set(bestAlly.body.position.x, bestAlly.body.position.y + 1.2, bestAlly.body.position.z);
          this.aimAndFire(t, _v, false);
          bestAlly.shotAt?.(t.pos, 32, 0.25, 'bastion_turret');
          t.cooldown = 0.55;
        }
      }
    }

    // 3. Advance tracer visuals
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i]!;
      tr.life -= dt;
      if (tr.life <= 0) {
        this.tracerPool.push(tr);
        this.tracers.splice(i, 1);
        continue;
      }
      tr.pos.addScaledVector(tr.vel, dt);
    }
    this.syncTracers();
  }

  private isDoorwayClear(g: LiveBastionGate, friendlyVehicles: readonly AiFriendlyVehicle[]): boolean {
    const p = this.ctx.player;
    if (p?.alive) {
      if (Math.abs(p.position.x - g.pos.x) < g.half.x + 2 && Math.abs(p.position.z - g.pos.z) < g.half.z + 3) {
        return false;
      }
    }
    for (const v of friendlyVehicles) {
      if (!v.alive || v.airborne) continue;
      if (Math.abs(v.position.x - g.pos.x) < g.half.x + 4 && Math.abs(v.position.z - g.pos.z) < g.half.z + 5) {
        return false;
      }
    }
    return true;
  }

  private damageGate(g: LiveBastionGate, amount: number, source: string, heavy: boolean): void {
    if (!g.sealed || amount <= 0) return;
    const eff = heavy ? amount : amount * 0.25;
    if (!heavy && this.armorHintCd <= 0 && source !== 'ally_armor') {
      this.armorHintCd = 14;
      this.ctx.hud?.feed?.(`${g.plan.shortName} HEAVILY ARMORED — USE TANKS, ROCKETS, OR AIR STRIKES TO BREACH!`, '#ffaa44');
    }

    g.hp = Math.max(0, g.hp - eff);
    g.flashT = 0.08;
    if (g.hp > 0) return;

    g.sealed = false;
    g.intactGroup.visible = false;
    g.breachedGroup.visible = true;
    g.rebuildLeft = g.plan.rebuildSec;
    g.collider?.setTranslation({ x: 0, y: -1e4, z: 0 });
    this.breachedCount++;

    const blastPos = _v.set(g.pos.x, g.pos.y + 3.6, g.pos.z);
    this.ctx.fx?.explosion?.(blastPos, { radius: 20, kind: 'thermobaric', scale: 1.7 });
    this.ctx.render?.lights?.flash?.(blastPos, 0xff7b28, 30, 80, 0.55);
    this.ctx.audio?.play?.('explosion', { position: blastPos, volume: 1.0 });

    const shop = this.ctx.contracts?.shop as { credits?: number } | null | undefined;
    if (shop && typeof shop.credits === 'number') {
      shop.credits += g.plan.bounty;
    }
    this.ctx.progression?.award?.(g.plan.bounty, `${g.plan.shortName} BREACHED`, blastPos);
    this.ctx.hud?.feed?.(
      `${g.plan.name} BREACHED (+${g.plan.bounty} CR) — ALLIED ARMOR CLEARED TO ASSAULT IRON BASTION!`,
      '#5ef0ff',
    );
    this.cb.onGateBreached?.(g.plan);
  }

  private rebuildGate(g: LiveBastionGate, threatLevel: number): void {
    const scale = 1 + Math.max(0, threatLevel - 1) * 0.12;
    g.maxHp = Math.round(g.plan.maxHp * scale);
    g.hp = g.maxHp;
    g.sealed = true;
    g.intactGroup.visible = true;
    g.breachedGroup.visible = false;
    g.collider?.setTranslation({ x: g.pos.x, y: g.pos.y + g.half.y, z: g.pos.z });
    this.ctx.hud?.feed?.(`ENEMY ENGINEERS SEALED ${g.plan.name}`, '#ff5c4a');
    this.cb.onGateRebuilt?.(g.plan);
  }

  applyBlast(center: THREE.Vector3, radius: number, damage: number, source = 'breach_charge'): number {
    let hits = 0;
    for (const g of this.gates) {
      if (!g.sealed) continue;
      // Box distance so wide 26 m gates take full splash anywhere along the door face!
      const dx = Math.max(0, Math.abs(center.x - g.pos.x) - g.half.x);
      const dz = Math.max(0, Math.abs(center.z - g.pos.z) - g.half.z);
      const dist = Math.hypot(dx, dz);
      const reach = radius + 2.5;
      if (dist > reach) continue;
      const falloff = clamp(1 - (dist / reach) * 0.5, 0.45, 1.0);
      this.damageGate(g, damage * falloff, source, true);
      hits++;
    }
    return hits;
  }

  private aimAndFire(t: BastionTurret, targetPos: THREE.Vector3, isSam: boolean): void {
    _dir.subVectors(targetPos, t.pos);
    const dist = Math.max(1, _dir.length());
    _dir.divideScalar(dist);
    t.head.rotation.y = Math.atan2(_dir.x, _dir.z);

    if (this.tracers.length < MAX_TRACERS) {
      const speed = isSam ? 165 : 230;
      _quat.setFromUnitVectors(_zAxis, _dir);
      let tr = this.tracerPool.pop();
      if (!tr) {
        tr = {
          pos: t.pos.clone().addScaledVector(_dir, 2.4),
          vel: _dir.clone().multiplyScalar(speed),
          quat: _quat.clone(),
          isSam,
          life: Math.min(0.9, dist / speed),
        };
      } else {
        tr.pos.copy(t.pos).addScaledVector(_dir, 2.4);
        tr.vel.copy(_dir).multiplyScalar(speed);
        tr.quat.copy(_quat);
        tr.isSam = isSam;
        tr.life = Math.min(0.9, dist / speed);
      }
      this.tracers.push(tr);
    }
  }

  // ---- ExtraTarget implementation -------------------------------------------

  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean {
    const g = this.gateByCollider.get(collider);
    if (!g || !g.sealed) return false;
    this.ctx.fx?.sparks?.(point, _up, 7, 0xffaa44);
    this.damageGate(g, amount, source, amount >= 80);
    return true;
  }

  direct(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, _kind: ExplosionKind, source: string): boolean {
    const g = this.gateByCollider.get(collider);
    if (!g || !g.sealed) return false;
    this.ctx.fx?.sparks?.(point, _up, 14, 0xff6b22);
    this.damageGate(g, amount * 1.35, source, true);
    return true;
  }

  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    return this.applyBlast(center, spec.radius, spec.damage, spec.source ?? 'blast');
  }

  paintable(out: MissileTarget[]): void {
    for (const g of this.gates) {
      if (!g.sealed) continue;
      out.push({
        center: g.pos,
        alive: g.sealed,
        isBoss: true,
        aimLift: g.half.y,
        paintRadius: g.half.x + 2,
      });
    }
  }

  radarTargets(out: VehicleRadarTarget[]): void {
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i]!;
      if (!g.sealed) continue;
      out.push({
        id: 92_000 + i,
        kind: 'tank',
        label: g.plan.shortName,
        position: g.center.clone(),
        velocity: new THREE.Vector3(),
        airborne: false,
      });
    }
  }

  frameBlow(at: THREE.Vector3, radius: number, damage: number, _dir: THREE.Vector3 | null, source: string): number {
    return this.applyBlast(at, radius + 3.5, damage * 1.45, source);
  }

  highlightMeshes(out: THREE.Object3D[]): void {
    for (const g of this.gates) {
      if (g.sealed) out.push(g.beaconMesh);
    }
  }

  dispose(): void {
    this.unsubExplosion?.();
    this.unsubExplosion = null;
    const vs = this.ctx.enemies?.vehicles as { removeExtra?: (t: ExtraTarget) => void } | undefined;
    vs?.removeExtra?.(this);

    for (const tr of this.tracers) this.tracerPool.push(tr);
    this.tracers.length = 0;
    this.syncTracers();
    this.atTracerInst.removeFromParent();
    this.samTracerInst.removeFromParent();
    for (const t of this.turrets) t.group.removeFromParent();
    this.turrets.length = 0;
    for (const g of this.gates) {
      g.collider?.setTranslation({ x: 0, y: -1e4, z: 0 });
      g.group.removeFromParent();
    }
    this.gates.length = 0;
    this.gateByLane.clear();
    this.gateById.clear();
    this.gateByCollider.clear();
    this.root.removeFromParent();
    this.breachedCount = 0;
  }
}
