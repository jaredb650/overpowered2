/**
 * Shootable light fixtures and fast zero-allocation CPU illumination queries.
 *
 * Maps register architectural fixtures (sconces, post lamps, chandeliers, floodlights, desk lamps).
 * Each fixture builds a detailed procedural housing + emissive bulb mesh, registers a `'glass'`
 * static collider, and binds a persistent light in `DynamicLightPool` (when available).
 *
 * Shooting a fixture shatters it in 1 hit, extinguishing both its visual glow and GPU point light,
 * triggering sparks + glass-break audio, and firing `onBroken` so stealth AI can react. Breaker
 * boxes toggle intact fixtures per circuit group via `setGroupPower(group, powered)`; shattered
 * fixtures stay dark even if circuit power is restored.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx, type RayHit } from '../core/contracts';

export type LightFixtureKind = 'sconce' | 'lamp' | 'chandelier' | 'floodlight' | 'desk';

export interface LightFixtureSpec {
  id?: string;
  position: readonly [number, number, number];
  color: number;
  intensity: number;
  radius: number;
  kind: LightFixtureKind;
  /** Optional breaker circuit group id (e.g. 'west_wing', 'courtyard', 'east_wing'). */
  group?: string;
  /** Optional facing yaw in radians (for wall sconces / floodlights). */
  yaw?: number;
  /** Optional ambient illumination weight override (default 1). */
  weight?: number;
}

export type LightBrokenCallback = (pos: THREE.Vector3, id: string, group: string | undefined) => void;

export interface ShootableLightsOptions {
  /** Optional callback fired when an intact fixture is shattered (e.g. for 12 m stealth sound). */
  onBroken?: LightBrokenCallback;
  /** Optional parent Object3D for fixture meshes; defaults to `ctx.render.scene` if it is a Scene. */
  parent?: THREE.Object3D;
  /** Default ambient illumination floor returned by `lightAt()` in darkness (default `0.06`). */
  ambientBaseline?: number;
}

interface FixtureLightPool {
  addFixture(spec: {
    position: THREE.Vector3;
    color: THREE.ColorRepresentation;
    intensity: number;
    radius: number;
    enabled?: boolean;
  }): number;
  setFixtureEnabled(id: number, enabled: boolean): void;
  removeFixture(id: number): void;
}

interface FixtureGeoPair {
  housing: THREE.BufferGeometry;
  bulb: THREE.BufferGeometry;
  halfExtents: readonly [number, number, number];
  colliderOffset: readonly [number, number, number];
}

interface FixtureEntry {
  readonly id: string;
  readonly spec: LightFixtureSpec;
  readonly pos: THREE.Vector3;
  readonly colliderCenter: THREE.Vector3;
  readonly halfExtents: THREE.Vector3;
  readonly rotQuat: THREE.Quaternion;
  readonly radius: number;
  readonly radiusSq: number;
  readonly invRadiusSq: number;
  readonly gain: number;
  readonly group: string | undefined;
  readonly color: number;
  readonly root: THREE.Group;
  readonly bulbMesh: THREE.Mesh;
  readonly litMat: THREE.MeshStandardMaterial;
  collider: RAPIER.Collider | null;
  poolId: number;
  powered: boolean;
  shattered: boolean;
}

// Reusable scratch objects so hot queries (`lightAt`, `damageCollider`) allocate nothing.
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fxPos = new THREE.Vector3();
const _sparkDir = new THREE.Vector3(0, -1, 0);
const _upDir = new THREE.Vector3(0, 1, 0);
const _rayHit: RayHit = {
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
  surface: 'concrete',
  collider: null,
};

const DEFAULT_AMBIENT = 0.06;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

interface GeoPart {
  geo: THREE.BufferGeometry;
  pos?: readonly [number, number, number];
  rot?: readonly [number, number, number];
  scale?: readonly [number, number, number];
}

/** Merges multiple procedural primitives into a single non-indexed BufferGeometry and disposes inputs. */
function mergeParts(parts: GeoPart[]): THREE.BufferGeometry {
  const converted: THREE.BufferGeometry[] = [];
  let totalVerts = 0;
  const mat = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    if (g !== part.geo) part.geo.dispose();
    p.set(part.pos?.[0] ?? 0, part.pos?.[1] ?? 0, part.pos?.[2] ?? 0);
    euler.set(part.rot?.[0] ?? 0, part.rot?.[1] ?? 0, part.rot?.[2] ?? 0);
    q.setFromEuler(euler);
    s.set(part.scale?.[0] ?? 1, part.scale?.[1] ?? 1, part.scale?.[2] ?? 1);
    mat.compose(p, q, s);
    g.applyMatrix4(mat);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    totalVerts += g.getAttribute('position').count;
    converted.push(g);
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  let offset = 0;

  for (const g of converted) {
    const posAttr = g.getAttribute('position');
    const nrmAttr = g.getAttribute('normal');
    const uvAttr = g.getAttribute('uv');
    const count = posAttr.count;
    for (let i = 0; i < count; i++) {
      const i3 = (offset + i) * 3;
      const i2 = (offset + i) * 2;
      positions[i3] = posAttr.getX(i);
      positions[i3 + 1] = posAttr.getY(i);
      positions[i3 + 2] = posAttr.getZ(i);
      normals[i3] = nrmAttr.getX(i);
      normals[i3 + 1] = nrmAttr.getY(i);
      normals[i3 + 2] = nrmAttr.getZ(i);
      if (uvAttr) {
        uvs[i2] = uvAttr.getX(i);
        uvs[i2 + 1] = uvAttr.getY(i);
      }
    }
    offset += count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.computeBoundingSphere();
  return merged;
}

/** Builds shared procedural housing + bulb geometry for a fixture kind. */
function buildFixtureGeo(kind: LightFixtureKind): FixtureGeoPair {
  switch (kind) {
    case 'sconce': {
      // Wall-mounted lantern sconce facing +Z: octagonal backplate, bracket arm, flared hood, cage bars, finial.
      const housingParts: GeoPart[] = [
        { geo: new THREE.CylinderGeometry(0.10, 0.12, 0.035, 8), pos: [0, 0.02, -0.14], rot: [Math.PI / 2, 0, 0] },
        { geo: new THREE.CylinderGeometry(0.022, 0.026, 0.18, 8), pos: [0, 0.06, -0.05], rot: [Math.PI / 2, 0, 0] },
        { geo: new THREE.CylinderGeometry(0.035, 0.16, 0.10, 10), pos: [0, 0.15, 0.06] },
        { geo: new THREE.ConeGeometry(0.045, 0.07, 8), pos: [0, 0.22, 0.06] },
        { geo: new THREE.CylinderGeometry(0.11, 0.055, 0.05, 8), pos: [0, -0.14, 0.06] },
        { geo: new THREE.ConeGeometry(0.045, 0.07, 8), pos: [0, -0.19, 0.06], rot: [Math.PI, 0, 0] },
      ];
      // Three slender lantern cage struts around the globe
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3 + Math.PI / 6;
        housingParts.push({
          geo: new THREE.CylinderGeometry(0.009, 0.009, 0.24, 6),
          pos: [Math.cos(a) * 0.105, 0.0, 0.06 + Math.sin(a) * 0.105],
        });
      }
      const bulb = mergeParts([
        { geo: new THREE.CylinderGeometry(0.082, 0.068, 0.20, 10), pos: [0, 0.0, 0.06] },
      ]);
      return {
        housing: mergeParts(housingParts),
        bulb,
        halfExtents: [0.16, 0.23, 0.18],
        colliderOffset: [0, 0, 0.02],
      };
    }

    case 'lamp': {
      // Standing/post architectural lantern globe with stepped collar, domed cap, and spire.
      const housing = mergeParts([
        { geo: new THREE.CylinderGeometry(0.13, 0.18, 0.10, 8), pos: [0, -0.22, 0] },
        { geo: new THREE.CylinderGeometry(0.055, 0.07, 0.12, 8), pos: [0, -0.13, 0] },
        { geo: new THREE.CylinderGeometry(0.14, 0.10, 0.05, 10), pos: [0, -0.07, 0] },
        { geo: new THREE.CylinderGeometry(0.05, 0.19, 0.11, 12), pos: [0, 0.20, 0] },
        { geo: new THREE.ConeGeometry(0.04, 0.09, 8), pos: [0, 0.29, 0] },
      ]);
      const bulb = mergeParts([
        { geo: new THREE.SphereGeometry(0.135, 12, 10), pos: [0, 0.06, 0], scale: [1, 1.18, 1] },
      ]);
      return {
        housing,
        bulb,
        halfExtents: [0.18, 0.26, 0.18],
        colliderOffset: [0, 0.04, 0],
      };
    }

    case 'chandelier': {
      // Suspended wrought-iron ring chandelier with canopy, downrod, 4 radial spokes, and 6 candle globes.
      const housingParts: GeoPart[] = [
        { geo: new THREE.CylinderGeometry(0.14, 0.05, 0.07, 10), pos: [0, 0.56, 0] },
        { geo: new THREE.CylinderGeometry(0.024, 0.024, 0.56, 8), pos: [0, 0.28, 0] },
        { geo: new THREE.CylinderGeometry(0.065, 0.045, 0.09, 10), pos: [0, 0.0, 0] },
        { geo: new THREE.ConeGeometry(0.04, 0.09, 8), pos: [0, -0.08, 0], rot: [Math.PI, 0, 0] },
        { geo: new THREE.TorusGeometry(0.52, 0.032, 8, 24), pos: [0, 0.0, 0], rot: [Math.PI / 2, 0, 0] },
      ];
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        housingParts.push({
          geo: new THREE.CylinderGeometry(0.014, 0.014, 0.52, 6),
          pos: [Math.cos(a) * 0.26, 0.0, Math.sin(a) * 0.26],
          rot: [0, -a, Math.PI / 2],
        });
      }
      const bulbParts: GeoPart[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI * 2) / 6;
        const bx = Math.cos(a) * 0.52;
        const bz = Math.sin(a) * 0.52;
        // Brass candle cup on housing
        housingParts.push({
          geo: new THREE.CylinderGeometry(0.048, 0.032, 0.04, 8),
          pos: [bx, 0.04, bz],
        });
        // Glowing frosted flame bulb
        bulbParts.push({
          geo: new THREE.SphereGeometry(0.062, 8, 6),
          pos: [bx, 0.11, bz],
          scale: [0.88, 1.35, 0.88],
        });
      }
      return {
        housing: mergeParts(housingParts),
        bulb: mergeParts(bulbParts),
        halfExtents: [0.58, 0.22, 0.58],
        colliderOffset: [0, 0.06, 0],
      };
    }

    case 'floodlight': {
      // Industrial exterior security floodlight facing +Z: mounting base, U-yoke, tapered shroud, glare visor, recessed lens.
      const housing = mergeParts([
        // Wall/post mounting flange
        { geo: new THREE.CylinderGeometry(0.11, 0.13, 0.04, 10), pos: [0, 0, -0.20], rot: [Math.PI / 2, 0, 0] },
        // U-yoke crossbar + side arms
        { geo: new THREE.CylinderGeometry(0.022, 0.022, 0.52, 8), pos: [0, -0.14, -0.14], rot: [0, 0, Math.PI / 2] },
        { geo: new THREE.CylinderGeometry(0.02, 0.02, 0.24, 8), pos: [-0.26, -0.02, -0.06], rot: [Math.PI / 4, 0, 0] },
        { geo: new THREE.CylinderGeometry(0.02, 0.02, 0.24, 8), pos: [0.26, -0.02, -0.06], rot: [Math.PI / 4, 0, 0] },
        // Tapered octagonal reflector body
        { geo: new THREE.CylinderGeometry(0.22, 0.14, 0.22, 8), pos: [0, 0.02, 0.02], rot: [Math.PI / 2, 0, 0], scale: [1.35, 1, 0.85] },
        // Top glare hood visor (half-cylinder)
        { geo: new THREE.CylinderGeometry(0.225, 0.225, 0.14, 10, 1, true, -Math.PI * 0.5, Math.PI), pos: [0, 0.03, 0.14], rot: [Math.PI / 2, 0, Math.PI / 2], scale: [0.86, 1, 1.36] },
      ]);
      const bulb = mergeParts([
        { geo: new THREE.CylinderGeometry(0.19, 0.19, 0.035, 10), pos: [0, 0.02, 0.13], rot: [Math.PI / 2, 0, 0], scale: [1.3, 1, 0.8] },
      ]);
      return {
        housing,
        bulb,
        halfExtents: [0.33, 0.23, 0.24],
        colliderOffset: [0, 0.02, 0.02],
      };
    }

    case 'desk': {
      // Classic Chancery banker's desk lamp: weighted brass base, curved neck, half-cylinder shade, frosted tubular bulb.
      const housing = mergeParts([
        { geo: new THREE.CylinderGeometry(0.095, 0.12, 0.035, 12), pos: [0, -0.14, 0] },
        { geo: new THREE.CylinderGeometry(0.022, 0.032, 0.05, 10), pos: [0, -0.105, 0] },
        { geo: new THREE.CylinderGeometry(0.015, 0.017, 0.24, 8), pos: [0, 0.02, -0.02], rot: [0.14, 0, 0] },
        // Curved banker shade (half-cylinder horizontal along X)
        { geo: new THREE.CylinderGeometry(0.095, 0.095, 0.26, 12, 1, false, 0, Math.PI), pos: [0, 0.13, 0.03], rot: [0, 0, Math.PI / 2] },
      ]);
      const bulb = mergeParts([
        { geo: new THREE.CylinderGeometry(0.034, 0.034, 0.18, 8), pos: [0, 0.105, 0.03], rot: [0, 0, Math.PI / 2] },
      ]);
      return {
        housing,
        bulb,
        halfExtents: [0.16, 0.18, 0.14],
        colliderOffset: [0, 0.02, 0.01],
      };
    }
  }
}

export class ShootableLights {
  readonly root = new THREE.Group();
  onBroken: LightBrokenCallback | null;

  private readonly ctx: Ctx;
  private readonly parent: THREE.Object3D | null;
  private readonly defaultAmbient: number;
  private readonly fixtures: FixtureEntry[] = [];
  private readonly byId = new Map<string, FixtureEntry>();
  private readonly byCollider = new Map<number, FixtureEntry>();
  private readonly geoCache = new Map<LightFixtureKind, FixtureGeoPair>();
  private readonly litMatCache = new Map<number, THREE.MeshStandardMaterial>();
  private readonly housingMat: THREE.MeshStandardMaterial;
  private readonly unpoweredBulbMat: THREE.MeshStandardMaterial;
  private readonly brokenBulbMat: THREE.MeshStandardMaterial;
  private readonly liveThermal: THREE.Object3D[] = [];
  private thermalDirty = true;
  private brokenTotal = 0;
  private autoIdCounter = 0;

  constructor(ctx: Ctx, options: ShootableLightsOptions = {}) {
    this.ctx = ctx;
    this.onBroken = options.onBroken ?? null;
    this.defaultAmbient = options.ambientBaseline ?? DEFAULT_AMBIENT;
    this.root.name = 'shootable-lights';
    this.root.matrixAutoUpdate = false;
    this.root.updateMatrix();

    const defaultParent = ctx.render?.scene instanceof THREE.Scene ? ctx.render.scene : null;
    this.parent = options.parent ?? defaultParent;
    if (this.parent) this.parent.add(this.root);

    this.housingMat = this.makePatchedMaterial({
      color: 0x2a2724,
      metalness: 0.72,
      roughness: 0.42,
    });
    this.unpoweredBulbMat = this.makePatchedMaterial({
      color: 0x262d34,
      metalness: 0.12,
      roughness: 0.26,
      emissive: 0x000000,
      emissiveIntensity: 0,
    });
    this.brokenBulbMat = this.makePatchedMaterial({
      color: 0x0c0e10,
      metalness: 0.25,
      roughness: 0.88,
      emissive: 0x000000,
      emissiveIntensity: 0,
    });
  }

  private makePatchedMaterial(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial(params);
    const patch = this.ctx.render?.materials?.patch;
    if (typeof patch === 'function') {
      const patched = patch.call(this.ctx.render.materials, mat);
      if (patched instanceof THREE.MeshStandardMaterial) return patched;
    }
    return mat;
  }

  private getGeo(kind: LightFixtureKind): FixtureGeoPair {
    let pair = this.geoCache.get(kind);
    if (!pair) {
      pair = buildFixtureGeo(kind);
      this.geoCache.set(kind, pair);
    }
    return pair;
  }

  private getLitMaterial(color: number): THREE.MeshStandardMaterial {
    let mat = this.litMatCache.get(color);
    if (!mat) {
      mat = this.makePatchedMaterial({
        color,
        roughness: 0.2,
        metalness: 0.05,
        emissive: color,
        emissiveIntensity: 3.4,
      });
      this.litMatCache.set(color, mat);
    }
    return mat;
  }

  private getLightPool(): FixtureLightPool | null {
    const lights = this.ctx.render?.lights as Partial<FixtureLightPool> | undefined;
    if (lights && typeof lights.addFixture === 'function' && typeof lights.setFixtureEnabled === 'function') {
      return lights as FixtureLightPool;
    }
    return null;
  }

  /** Registers a shootable light fixture and returns its stable string ID. */
  add(spec: LightFixtureSpec): string {
    const id = spec.id ?? `light_${this.autoIdCounter++}`;
    const geo = this.getGeo(spec.kind);
    const litMat = this.getLitMaterial(spec.color);

    const pos = new THREE.Vector3(spec.position[0], spec.position[1], spec.position[2]);
    const yaw = spec.yaw ?? 0;
    const rotQuat = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw);

    const group = new THREE.Group();
    group.name = `fixture:${id}`;
    group.position.copy(pos);
    group.quaternion.copy(rotQuat);
    group.matrixAutoUpdate = false;
    group.updateMatrix();

    const housingMesh = new THREE.Mesh(geo.housing, this.housingMat);
    housingMesh.castShadow = true;
    housingMesh.receiveShadow = true;
    housingMesh.userData.staticShadow = true;
    housingMesh.matrixAutoUpdate = false;
    housingMesh.updateMatrix();

    const bulbMesh = new THREE.Mesh(geo.bulb, litMat);
    bulbMesh.castShadow = false;
    bulbMesh.receiveShadow = false;
    bulbMesh.matrixAutoUpdate = false;
    bulbMesh.updateMatrix();

    group.add(housingMesh, bulbMesh);
    this.root.add(group);

    const colliderCenter = new THREE.Vector3(
      geo.colliderOffset[0],
      geo.colliderOffset[1],
      geo.colliderOffset[2],
    ).applyQuaternion(rotQuat).add(pos);
    const halfExtents = new THREE.Vector3(geo.halfExtents[0], geo.halfExtents[1], geo.halfExtents[2]);
    const collider = this.createCollider(colliderCenter, halfExtents, rotQuat);

    let poolId = -1;
    const pool = this.getLightPool();
    if (pool) {
      const assigned = pool.addFixture({
        position: pos,
        color: spec.color,
        intensity: spec.intensity,
        radius: spec.radius,
        enabled: true,
      });
      if (typeof assigned === 'number') poolId = assigned;
    }

    const radius = Math.max(spec.radius, 0.01);
    const radiusSq = radius * radius;
    const weight = spec.weight ?? 1;
    // Normalized intensity gain: ~0.82 for a 12 cd sconce, ~1.0 for 18 cd lamp, capped at 1.35 for bright floodlights.
    const gain = Math.min(1.35, Math.sqrt(Math.max(spec.intensity, 0) / 18)) * weight;

    const entry: FixtureEntry = {
      id,
      spec,
      pos,
      colliderCenter,
      halfExtents,
      rotQuat,
      radius,
      radiusSq,
      invRadiusSq: 1 / radiusSq,
      gain,
      group: spec.group,
      color: spec.color,
      root: group,
      bulbMesh,
      litMat,
      collider,
      poolId,
      powered: true,
      shattered: false,
    };

    this.fixtures.push(entry);
    this.byId.set(id, entry);
    if (collider) this.byCollider.set(collider.handle, entry);
    this.thermalDirty = true;
    return id;
  }

  /** Registers an array of fixtures. */
  addAll(specs: readonly LightFixtureSpec[]): void {
    for (let i = 0; i < specs.length; i++) this.add(specs[i]!);
  }

  private createCollider(center: THREE.Vector3, halfExtents: THREE.Vector3, rotQuat: THREE.Quaternion): RAPIER.Collider | null {
    const addStaticBox = this.ctx.physics?.addStaticBox;
    if (typeof addStaticBox !== 'function') return null;
    const c = addStaticBox.call(this.ctx.physics, center, halfExtents, rotQuat, 'glass');
    return c && typeof c.handle === 'number' ? c : null;
  }

  /** True if `collider` belongs to an intact shootable light fixture. */
  isFixtureCollider(collider: RAPIER.Collider | null): boolean {
    return !!collider && this.byCollider.has(collider.handle);
  }

  /**
   * Applies bullet/projectile impact to a fixture collider. 1 shot shatters an intact fixture.
   * Returns true if an intact fixture was shattered.
   */
  damageCollider(collider: RAPIER.Collider | null, hitPoint?: THREE.Vector3): boolean {
    if (!collider) return false;
    const f = this.byCollider.get(collider.handle);
    if (!f || f.shattered) return false;

    f.shattered = true;
    this.brokenTotal++;
    this.thermalDirty = true;
    f.bulbMesh.material = this.brokenBulbMat;

    if (f.poolId >= 0) {
      this.getLightPool()?.setFixtureEnabled(f.poolId, false);
    }

    if (f.collider) {
      this.byCollider.delete(f.collider.handle);
      this.ctx.physics?.world?.removeCollider?.(f.collider, false);
      f.collider = null;
    }

    if (hitPoint) _fxPos.copy(hitPoint);
    else _fxPos.copy(f.pos);

    this.ctx.fx?.sparks?.(_fxPos, _sparkDir, 14, f.color);
    this.ctx.fx?.impact?.(_fxPos, _upDir, 'glass', 0.85);
    this.ctx.render?.lights?.flash?.(
      _fxPos,
      f.color,
      Math.min(f.spec.intensity * 1.3, 28),
      Math.min(f.radius, 6),
      0.08,
    );
    this.ctx.audio?.play?.('glass_break', { position: _fxPos, volume: 0.85, pitchJitter: 0.12 });
    this.onBroken?.(f.pos, f.id, f.group);
    return true;
  }

  /** Shatters every intact light fixture within `radius` of `center`. Returns how many broke. */
  blast(center: THREE.Vector3, radius: number): number {
    if (radius <= 0) return 0;
    const r2 = radius * radius;
    let hits = 0;
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i]!;
      if (f.shattered || !f.collider) continue;
      if (f.pos.distanceToSquared(center) <= r2 && this.damageCollider(f.collider, f.pos)) {
        hits++;
      }
    }
    return hits;
  }

  /**
   * Toggles circuit power for all fixtures in `group`.
   * Intact fixtures toggle on/off; shattered fixtures stay permanently dark until `reset()`.
   */
  setGroupPower(group: string, powered: boolean): void {
    const pool = this.getLightPool();
    let changed = false;
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i]!;
      if (f.group !== group) continue;
      if (f.powered === powered) continue;
      f.powered = powered;
      changed = true;
      if (!f.shattered) {
        f.bulbMesh.material = powered ? f.litMat : this.unpoweredBulbMat;
        if (f.poolId >= 0) pool?.setFixtureEnabled(f.poolId, powered);
      }
    }
    if (changed) this.thermalDirty = true;
  }

  isLit(id: string): boolean {
    const f = this.byId.get(id);
    return !!f && !f.shattered && f.powered;
  }

  isShattered(id: string): boolean {
    const f = this.byId.get(id);
    return !!f && f.shattered;
  }

  brokenCount(): number {
    return this.brokenTotal;
  }

  count(): number {
    return this.fixtures.length;
  }

  /** Returns live lit bulb meshes so Thermal Vision can highlight warm active lights. Zero-alloc. */
  thermalMeshes(): readonly THREE.Object3D[] {
    if (this.thermalDirty) {
      this.liveThermal.length = 0;
      for (let i = 0; i < this.fixtures.length; i++) {
        const f = this.fixtures[i]!;
        if (!f.shattered && f.powered) this.liveThermal.push(f.bulbMesh);
      }
      this.thermalDirty = false;
    }
    return this.liveThermal;
  }

  /**
   * Fast, zero-allocation CPU illumination query returning `0..1`.
   * Starts at `ambientBaseline` (default `0.06` for moonlit night), sums smooth quadratic falloff
   * from every live (powered & unbroken) fixture within `radius`, and optionally checks wall
   * occlusion via `CG.World` raycast for nearby fixtures.
   */
  lightAt(pos: THREE.Vector3, ambientBaseline = this.defaultAmbient, raycastOcclusion = false): number {
    let total = ambientBaseline;
    const px = pos.x;
    const py = pos.y;
    const pz = pos.z;
    const fixtures = this.fixtures;
    const n = fixtures.length;

    const physics = raycastOcclusion ? this.ctx.physics : null;
    const hasRaycastInto = !!physics && typeof physics.raycastInto === 'function';
    const hasRaycast = !!physics && typeof physics.raycast === 'function';

    for (let i = 0; i < n; i++) {
      const f = fixtures[i]!;
      if (f.shattered || !f.powered || f.gain <= 0) continue;

      const dx = f.pos.x - px;
      const dy = f.pos.y - py;
      const dz = f.pos.z - pz;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq >= f.radiusSq) continue;

      if (raycastOcclusion && distSq > 0.1225 && (hasRaycastInto || hasRaycast)) {
        const dist = Math.sqrt(distSq);
        const invDist = 1 / dist;
        _origin.set(px, py, pz);
        _dir.set(dx * invDist, dy * invDist, dz * invDist);
        const ownHandle = f.collider?.handle;
        let occluded = false;

        if (hasRaycastInto) {
          const hit = physics!.raycastInto(_origin, _dir, dist, CG.World, _rayHit);
          if (hit === true && _rayHit.collider?.handle !== ownHandle && _rayHit.distance < dist - 0.25) {
            occluded = true;
          }
        } else if (hasRaycast) {
          const hit = physics!.raycast(_origin, _dir, dist, CG.World);
          if (hit && hit.collider?.handle !== ownHandle && hit.distance < dist - 0.25) {
            occluded = true;
          }
        }
        if (occluded) continue;
      }

      const w = 1 - distSq * f.invRadiusSq;
      total += f.gain * w * w;
      if (total >= 1) return 1;
    }

    return total < 0 ? 0 : total > 1 ? 1 : total;
  }

  /** Restores all fixtures to intact, powered state on mission restart. */
  reset(): void {
    const pool = this.getLightPool();
    this.brokenTotal = 0;
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i]!;
      f.shattered = false;
      f.powered = true;
      f.bulbMesh.material = f.litMat;
      if (!f.collider) {
        f.collider = this.createCollider(f.colliderCenter, f.halfExtents, f.rotQuat);
        if (f.collider) this.byCollider.set(f.collider.handle, f);
      }
      if (f.poolId >= 0) pool?.setFixtureEnabled(f.poolId, true);
    }
    this.thermalDirty = true;
  }

  /** Removes all colliders, GPU fixtures, meshes, and disposes shared geometries & materials. */
  dispose(): void {
    const pool = this.getLightPool();
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i]!;
      if (f.collider) {
        this.byCollider.delete(f.collider.handle);
        this.ctx.physics?.world?.removeCollider?.(f.collider, false);
        f.collider = null;
      }
      if (f.poolId >= 0) {
        pool?.removeFixture?.(f.poolId);
        f.poolId = -1;
      }
    }
    this.fixtures.length = 0;
    this.byId.clear();
    this.byCollider.clear();
    this.liveThermal.length = 0;
    this.thermalDirty = false;
    this.brokenTotal = 0;

    if (this.root.parent) this.root.parent.remove(this.root);
    this.root.clear();

    for (const pair of this.geoCache.values()) {
      pair.housing.dispose();
      pair.bulb.dispose();
    }
    this.geoCache.clear();

    for (const mat of this.litMatCache.values()) mat.dispose();
    this.litMatCache.clear();
    this.housingMat.dispose();
    this.unpoweredBulbMat.dispose();
    this.brokenBulbMat.dispose();
  }
}
