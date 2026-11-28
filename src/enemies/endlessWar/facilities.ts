/**
 * Destructible Enemy Strategic Facilities (`StrategicFacilitySystem`) for Endless War.
 *
 * Manages the 5 Sector-3 & Sector-4 enemy strategic targets (`fuel_depot`, `artillery_battery`,
 * `radar_aa`, `motor_pool`, `airfield_tower`):
 *   - Real 3D structures + Rapier hitboxes implementing `ExtraTarget` so player rifles, rockets,
 *     tank shells, Distraint Frame weapons, and fighter/bomber AGMs & bombs all lock and destroy them.
 *   - Destroyed facilities trigger massive chain explosions, pay big credits, cripple their
 *     associated enemy capability, and fire a 30-second Momentum Surge until enemy engineers rebuild them.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx, type ExplosionKind } from '../../core/contracts';
import type { ExplosionSpec, MissileTarget, VehicleRadarTarget } from '../../core/gameplay';
import { clamp } from '../../core/math';
import type { ExtraTarget } from '../vehicles';
import {
  ENDLESS_WAR_FACILITIES,
  type StrategicFacilityId,
  type StrategicFacilityPlan,
} from '../../world/map/endlessWar/plan';

export interface FacilityStateSnapshot {
  readonly id: StrategicFacilityId;
  readonly shortName: string;
  readonly alive: boolean;
  readonly hp: number;
  readonly maxHp: number;
  readonly rebuildLeft: number;
}

export interface StrategicFacilityCallbacks {
  onDestroyed?: (plan: StrategicFacilityPlan) => void;
  onRebuilt?: (plan: StrategicFacilityPlan) => void;
}

interface LiveFacility {
  readonly plan: StrategicFacilityPlan;
  readonly pos: THREE.Vector3;
  readonly half: THREE.Vector3;
  readonly group: THREE.Group;
  readonly intactGroup: THREE.Group;
  readonly ruinedGroup: THREE.Group;
  readonly beaconMesh: THREE.Mesh;
  readonly beaconMat: THREE.MeshBasicMaterial;
  readonly collider: RAPIER.Collider | null;
  readonly meshes: THREE.Object3D[];
  alive: boolean;
  hp: number;
  maxHp: number;
  rebuildLeft: number;
  smokeCd: number;
  flashT: number;
}

const _v = new THREE.Vector3();

function buildFacilityVisuals(plan: StrategicFacilityPlan): {
  group: THREE.Group;
  intactGroup: THREE.Group;
  ruinedGroup: THREE.Group;
  beaconMesh: THREE.Mesh;
  beaconMat: THREE.MeshBasicMaterial;
  meshes: THREE.Object3D[];
} {
  const group = new THREE.Group();
  group.position.set(plan.position[0], plan.position[1], plan.position[2]);
  const intactGroup = new THREE.Group();
  const ruinedGroup = new THREE.Group();
  ruinedGroup.visible = false;
  group.add(intactGroup, ruinedGroup);

  const [hx, hy, hz] = plan.half;
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.72, metalness: 0.45 });
  const accentRed = new THREE.MeshStandardMaterial({ color: 0xa82e24, roughness: 0.55, metalness: 0.25 });
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x565a5e, roughness: 0.85, metalness: 0.1 });
  const charredMat = new THREE.MeshStandardMaterial({ color: 0x1d1c1b, roughness: 0.95, metalness: 0.15 });
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3b2f });

  const meshes: THREE.Object3D[] = [];
  const addMesh = (parent: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    meshes.push(m);
    return m;
  };

  if (plan.id === 'fuel_depot') {
    // 4 huge pressurized crimson-striped fuel spheres/cylinders + pump manifold
    for (const sx of [-5.2, 5.2]) {
      for (const sz of [-3.4, 3.4]) {
        addMesh(intactGroup, new THREE.CylinderGeometry(2.8, 2.8, 5.6, 12), accentRed, sx, 2.8, sz);
        addMesh(intactGroup, new THREE.CylinderGeometry(3.0, 3.0, 0.5, 12), darkSteel, sx, 4.4, sz);
      }
    }
    addMesh(intactGroup, new THREE.BoxGeometry(12, 2.4, 3.0), darkSteel, 0, 1.2, 0);
  } else if (plan.id === 'artillery_battery') {
    // Concrete artillery command casemate + heavy howitzer barrels
    addMesh(intactGroup, new THREE.BoxGeometry(hx * 1.45, hy * 1.15, hz * 1.35), concreteMat, 0, hy * 0.58, 0);
    addMesh(intactGroup, new THREE.BoxGeometry(hx * 1.55, 0.9, hz * 1.45), darkSteel, 0, hy * 1.2, 0);
    for (const sx of [-4.5, 4.5]) {
      const barrel = addMesh(intactGroup, new THREE.CylinderGeometry(0.32, 0.42, 7.2, 8), darkSteel, sx, hy * 1.35, 3.6);
      barrel.rotation.x = Math.PI * 0.34;
    }
  } else if (plan.id === 'radar_aa') {
    // Tall concrete radar pedestal + giant rotating dish frame + control bunker
    addMesh(intactGroup, new THREE.BoxGeometry(10.5, 4.2, 9.5), concreteMat, 0, 2.1, 0);
    addMesh(intactGroup, new THREE.CylinderGeometry(2.4, 3.2, 4.8, 10), darkSteel, 0, 6.4, 0);
    addMesh(intactGroup, new THREE.BoxGeometry(7.2, 3.2, 1.1), accentRed, 0, 9.6, 0);
  } else if (plan.id === 'motor_pool') {
    // Heavy steel-arched armored tank assembly hangar + exhaust stacks
    addMesh(intactGroup, new THREE.BoxGeometry(hx * 1.75, hy * 1.35, hz * 1.65), darkSteel, 0, hy * 0.68, 0);
    addMesh(intactGroup, new THREE.BoxGeometry(hx * 1.82, 1.1, hz * 1.72), accentRed, 0, hy * 1.42, 0);
    for (const sx of [-7, 0, 7]) {
      addMesh(intactGroup, new THREE.CylinderGeometry(0.65, 0.8, 3.6, 8), darkSteel, sx, hy * 1.78, -4.5);
    }
  } else {
    // Airfield Control Tower: tall tapered ATC shaft + wide glass-rimmed command cab + radar mast
    addMesh(intactGroup, new THREE.BoxGeometry(7.5, 11.0, 7.5), concreteMat, 0, 5.5, 0);
    addMesh(intactGroup, new THREE.BoxGeometry(11.4, 3.4, 11.4), darkSteel, 0, 12.6, 0);
    addMesh(intactGroup, new THREE.BoxGeometry(11.8, 0.8, 11.8), accentRed, 0, 14.5, 0);
    addMesh(intactGroup, new THREE.CylinderGeometry(0.35, 0.55, 5.5, 8), darkSteel, 0, 17.5, 0);
  }

  // Tall glowing crimson target beacon atop every facility so players/pilots spot them through mist!
  const beaconY = plan.id === 'airfield_tower' ? 20.6 : hy * 2.15 + 1.8;
  const beaconMesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.15, 0), beaconMat);
  beaconMesh.position.set(0, beaconY, 0);
  intactGroup.add(beaconMesh);

  // Ruined charred rubble shell shown while rebuilding
  const rubble = new THREE.Mesh(new THREE.BoxGeometry(hx * 1.5, 1.6, hz * 1.5), charredMat);
  rubble.position.set(0, 0.8, 0);
  ruinedGroup.add(rubble);
  const slag = new THREE.Mesh(new THREE.BoxGeometry(hx * 0.85, 2.3, hz * 0.75), charredMat);
  slag.position.set(hx * 0.25, 1.15, -hz * 0.18);
  ruinedGroup.add(slag);

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
  mergeChildren(ruinedGroup);
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  intactGroup.matrixAutoUpdate = false;
  intactGroup.updateMatrix();
  ruinedGroup.matrixAutoUpdate = false;
  ruinedGroup.updateMatrix();

  meshes.length = 0;
  intactGroup.traverse(o => {
    if ((o as THREE.Mesh).isMesh && o !== beaconMesh) meshes.push(o);
  });

  return { group, intactGroup, ruinedGroup, beaconMesh, beaconMat, meshes };
}

export class StrategicFacilitySystem implements ExtraTarget {
  readonly root = new THREE.Group();
  private readonly items: LiveFacility[] = [];
  private readonly byId = new Map<StrategicFacilityId, LiveFacility>();
  private readonly byCollider = new Map<RAPIER.Collider, LiveFacility>();
  private unsubExplosion: (() => void) | null = null;
  private pulseClock = 0;
  destroyedCount = 0;

  constructor(
    private readonly ctx: Ctx,
    private readonly cb: StrategicFacilityCallbacks = {},
  ) {
    this.root.name = 'endless-war-facilities';
  }

  init(): void {
    this.dispose();
    if (this.ctx.render.scene instanceof THREE.Scene) {
      this.ctx.render.scene.add(this.root);
    }

    for (const plan of ENDLESS_WAR_FACILITIES) {
      const vis = buildFacilityVisuals(plan);
      this.root.add(vis.group);
      const pos = new THREE.Vector3(...plan.position);
      const half = new THREE.Vector3(...plan.half);

      let collider: RAPIER.Collider | null = null;
      if (this.ctx.physics?.addStaticBox) {
        collider = this.ctx.physics.addStaticBox(
          new THREE.Vector3(pos.x, pos.y + half.y, pos.z),
          half,
          null,
          'metal',
        );
      }

      const item: LiveFacility = {
        plan,
        pos,
        half,
        group: vis.group,
        intactGroup: vis.intactGroup,
        ruinedGroup: vis.ruinedGroup,
        beaconMesh: vis.beaconMesh,
        beaconMat: vis.beaconMat,
        collider,
        meshes: vis.meshes,
        alive: true,
        hp: plan.maxHp,
        maxHp: plan.maxHp,
        rebuildLeft: 0,
        smokeCd: 0,
        flashT: 0,
      };
      this.items.push(item);
      this.byId.set(plan.id, item);
      if (collider) this.byCollider.set(collider, item);
    }

    // Register with VehicleSystem as ExtraTarget so guns, rockets, AGMs, bombs, and Frames all hit cleanly
    const vs = this.ctx.enemies?.vehicles as { addExtra?: (t: ExtraTarget) => void } | undefined;
    vs?.addExtra?.(this);

    if (this.ctx.events?.on) {
      this.unsubExplosion = this.ctx.events.on('combat:explosion', e => {
        this.applyBlast(e.position, e.radius, e.damage);
      });
    }
  }

  isAlive(id: StrategicFacilityId): boolean {
    return this.byId.get(id)?.alive ?? false;
  }

  getSnapshots(): FacilityStateSnapshot[] {
    return this.items.map(f => ({
      id: f.plan.id,
      shortName: f.plan.shortName,
      alive: f.alive,
      hp: Math.max(0, Math.round(f.hp)),
      maxHp: f.maxHp,
      rebuildLeft: Math.max(0, Math.ceil(f.rebuildLeft)),
    }));
  }

  /** Threat-scaled update ticking facility rebuild timers, beacon animation, and damage smoke. */
  update(dt: number, threatLevel: number): void {
    this.pulseClock += dt;
    const rebuildRate = 1 + Math.max(0, threatLevel - 4) * 0.08;

    for (const f of this.items) {
      if (f.alive) {
        f.beaconMesh.rotation.y += dt * 1.9;
        const hpRatio = f.hp / f.maxHp;
        if (f.flashT > 0) {
          f.flashT = Math.max(0, f.flashT - dt);
          f.beaconMat.color.setHex(0xffffff);
        } else {
          const pulse = 0.72 + 0.28 * Math.sin(this.pulseClock * 4.5);
          f.beaconMat.color.setRGB(pulse, hpRatio < 0.45 ? 0.55 * pulse : 0.16 * pulse, 0.14 * pulse);
        }
        // Emit heavy dark smoke when damaged below 60%
        if (hpRatio < 0.6) {
          f.smokeCd -= dt;
          if (f.smokeCd <= 0) {
            f.smokeCd = hpRatio < 0.3 ? 0.22 : 0.5;
            _v.set(f.pos.x + (Math.random() - 0.5) * 6, f.pos.y + f.half.y * 1.4, f.pos.z + (Math.random() - 0.5) * 6);
            this.ctx.fx?.smoke?.(_v, 0x262628, 3.2, 2.4);
          }
        }
      } else if (f.rebuildLeft > 0) {
        f.rebuildLeft = Math.max(0, f.rebuildLeft - dt * rebuildRate);
        f.smokeCd -= dt;
        if (f.smokeCd <= 0) {
          f.smokeCd = 0.65;
          _v.set(f.pos.x + (Math.random() - 0.5) * 8, f.pos.y + 1.8, f.pos.z + (Math.random() - 0.5) * 8);
          this.ctx.fx?.smoke?.(_v, 0x1e1e20, 3.8, 2.8);
        }
        if (f.rebuildLeft <= 0) {
          this.rebuildFacility(f, threatLevel);
        }
      }
    }
  }

  private damageFacility(f: LiveFacility, amount: number, source: string): void {
    if (!f.alive || amount <= 0) return;
    f.hp = Math.max(0, f.hp - amount);
    f.flashT = 0.08;
    if (f.hp > 0) return;

    f.alive = false;
    f.intactGroup.visible = false;
    f.ruinedGroup.visible = true;
    f.rebuildLeft = f.plan.rebuildSec;
    this.destroyedCount++;

    // Dramatic multi-blast chain detonation
    const center = _v.set(f.pos.x, f.pos.y + 3.2, f.pos.z);
    this.ctx.fx?.explosion?.(center, { radius: 22, kind: 'thermobaric', scale: 1.6 });
    this.ctx.render?.lights?.flash?.(center, 0xff7b29, 32, 85, 0.55);
    this.ctx.audio?.play?.('explosion', { position: center, volume: 1.0 });

    // Award bounty credits & score
    const shop = this.ctx.contracts?.shop as { credits?: number } | null | undefined;
    if (shop && typeof shop.credits === 'number') {
      shop.credits += f.plan.bounty;
    }
    this.ctx.progression?.award?.(f.plan.bounty, `${f.plan.shortName} DESTROYED`, center);
    this.ctx.hud?.feed?.(`${f.plan.name} DESTROYED (+${f.plan.bounty} CR) — ${f.plan.debuffLabel}`, '#ffb84d');
    void source;

    this.cb.onDestroyed?.(f.plan);
  }

  private rebuildFacility(f: LiveFacility, threatLevel: number): void {
    const scale = 1 + Math.max(0, threatLevel - 1) * 0.14;
    f.maxHp = Math.round(f.plan.maxHp * scale);
    f.hp = f.maxHp;
    f.alive = true;
    f.intactGroup.visible = true;
    f.ruinedGroup.visible = false;
    this.ctx.hud?.feed?.(`ENEMY REBUILT ${f.plan.name}`, '#ff5c4a');
    this.cb.onRebuilt?.(f.plan);
  }

  /** Direct programmatic sabotage helper (used by tests and artillery barrages). */
  damageById(id: StrategicFacilityId, amount: number, source = 'breach_charge'): boolean {
    const f = this.byId.get(id);
    if (!f || !f.alive) return false;
    this.damageFacility(f, amount, source);
    return true;
  }

  applyBlast(center: THREE.Vector3, radius: number, damage: number, source = 'breach_charge'): number {
    let hits = 0;
    for (const f of this.items) {
      if (!f.alive) continue;
      const dist = Math.hypot(center.x - f.pos.x, center.z - f.pos.z);
      const reach = radius + Math.max(f.half.x, f.half.z);
      if (dist > reach) continue;
      const falloff = clamp(1 - (dist / reach) * 0.55, 0.35, 1.0);
      this.damageFacility(f, damage * falloff, source);
      hits++;
    }
    return hits;
  }

  // ---- ExtraTarget implementation -------------------------------------------

  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean {
    const f = this.byCollider.get(collider);
    if (!f || !f.alive) return false;
    this.ctx.fx?.sparks?.(point, new THREE.Vector3(0, 1, 0), 6, 0xffaa44);
    this.damageFacility(f, amount, source);
    return true;
  }

  direct(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, _kind: ExplosionKind, source: string): boolean {
    const f = this.byCollider.get(collider);
    if (!f || !f.alive) return false;
    this.ctx.fx?.sparks?.(point, new THREE.Vector3(0, 1, 0), 12, 0xff7722);
    this.damageFacility(f, amount * 1.35, source);
    return true;
  }

  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    return this.applyBlast(center, spec.radius, spec.damage, spec.source ?? 'blast');
  }

  paintable(out: MissileTarget[]): void {
    for (const f of this.items) {
      if (!f.alive) continue;
      out.push({
        center: f.pos,
        alive: f.alive,
        isBoss: true,
        aimLift: f.half.y,
        paintRadius: Math.max(f.half.x, f.half.z) + 3.5,
      });
    }
  }

  radarTargets(out: VehicleRadarTarget[]): void {
    for (let i = 0; i < this.items.length; i++) {
      const f = this.items[i]!;
      if (!f.alive) continue;
      out.push({
        id: 90_000 + i,
        kind: 'tank',
        label: f.plan.shortName,
        position: new THREE.Vector3(f.pos.x, f.pos.y + f.half.y, f.pos.z),
        velocity: new THREE.Vector3(),
        airborne: false,
      });
    }
  }

  frameBlow(at: THREE.Vector3, radius: number, damage: number, _dir: THREE.Vector3 | null, source: string): number {
    return this.applyBlast(at, radius + 3, damage * 1.4, source);
  }

  highlightMeshes(out: THREE.Object3D[]): void {
    for (const f of this.items) {
      if (f.alive) out.push(f.beaconMesh);
    }
  }

  dispose(): void {
    this.unsubExplosion?.();
    this.unsubExplosion = null;
    const vs = this.ctx.enemies?.vehicles as { removeExtra?: (t: ExtraTarget) => void } | undefined;
    vs?.removeExtra?.(this);

    for (const f of this.items) {
      f.collider?.setTranslation({ x: 0, y: -1e4, z: 0 });
      f.group.removeFromParent();
    }
    this.items.length = 0;
    this.byId.clear();
    this.byCollider.clear();
    this.root.removeFromParent();
    this.destroyedCount = 0;
  }
}
