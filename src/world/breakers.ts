/**
 * Wing electrical breaker distribution boxes.
 *
 * Each breaker controls a circuit group (e.g. `'west_wing'`, `'courtyard'`, `'east_wing'`).
 * Players can either:
 *   1. Silently flip a breaker up close (`interact(id)` / `nearestInteractable(pos, maxDist)`),
 *      cutting power quietly (3 m click) and firing `onTrip(spec, 'manual')`.
 *   2. Shoot the steel cabinet (`damageCollider(collider)`), triggering a loud electric arc +
 *      spark burst (16 m noise), permanently shorting the panel so it cannot be re-enabled, and
 *      firing `onTrip(spec, 'shot')`.
 *
 * Powered cabinets stay warm in Thermal Vision via `thermalMeshes()`.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ctx } from '../core/contracts';
import type { ShootableLights } from './lights';

export interface BreakerSpec {
  id: string;
  label: string;
  group: string;
  position: readonly [number, number, number];
  yaw: number;
}

export type BreakerTripMode = 'manual' | 'shot';
export type BreakerTripCallback = (spec: BreakerSpec, mode: BreakerTripMode) => void;

export interface BreakerSystemOptions {
  /** Optional shootable light system whose circuit groups are toggled by breakers. */
  lights?: ShootableLights | null;
  /** Callback invoked when a breaker trips (`'manual'` or `'shot'`). */
  onTrip?: BreakerTripCallback;
  /** Optional parent Object3D; defaults to `ctx.render.scene` when it is a Scene. */
  parent?: THREE.Object3D;
}

interface BreakerEntry {
  readonly spec: BreakerSpec;
  readonly pos: THREE.Vector3;
  readonly rotQuat: THREE.Quaternion;
  readonly root: THREE.Group;
  readonly bodyMesh: THREE.Mesh;
  readonly doorPivot: THREE.Group;
  readonly leverPivot: THREE.Group;
  readonly ledMesh: THREE.Mesh;
  collider: RAPIER.Collider | null;
  powered: boolean;
  shorted: boolean;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const BREAKER_HALF_EXTENTS = new THREE.Vector3(0.28, 0.38, 0.16);
const DEFAULT_INTERACT_DIST = 2.4;

// Scratch vectors for zero-alloc FX on trip/short.
const _fxPos = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _arcEnd = new THREE.Vector3();

interface GeoPart {
  geo: THREE.BufferGeometry;
  pos?: readonly [number, number, number];
  rot?: readonly [number, number, number];
  scale?: readonly [number, number, number];
}

/** Merges multiple procedural primitives into a single BufferGeometry and disposes inputs. */
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

/** Builds a bevelled cabinet enclosure using ExtrudeGeometry with real chamfered edges. */
function buildBevelBox(w: number, h: number, d: number, bevel = 0.014): THREE.BufferGeometry {
  const hw = Math.max(w * 0.5 - bevel, 0.005);
  const hh = Math.max(h * 0.5 - bevel, 0.005);
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();

  const depth = Math.max(d - bevel * 2, 0.005);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 1,
  });
  geo.translate(0, 0, -depth * 0.5);
  return geo;
}

function buildBreakerGeometries(): {
  body: THREE.BufferGeometry;
  conduit: THREE.BufferGeometry;
  door: THREE.BufferGeometry;
  lever: THREE.BufferGeometry;
  led: THREE.BufferGeometry;
} {
  // Bevelled steel cabinet shell + wall mounting flange + drip brow + interior bus-bar rails.
  const body = mergeParts([
    { geo: buildBevelBox(0.46, 0.64, 0.16, 0.016), pos: [0, 0, -0.02] },
    // Top weather brow flange
    { geo: buildBevelBox(0.50, 0.032, 0.20, 0.006), pos: [0, 0.325, -0.005] },
    // Bottom flange lip
    { geo: buildBevelBox(0.49, 0.026, 0.18, 0.006), pos: [0, -0.325, -0.01] },
    // Hinge knuckles on left edge
    { geo: new THREE.CylinderGeometry(0.014, 0.014, 0.07, 8), pos: [-0.23, 0.18, 0.068] },
    { geo: new THREE.CylinderGeometry(0.014, 0.014, 0.07, 8), pos: [-0.23, -0.18, 0.068] },
    // LED bezel collar at upper-right
    { geo: new THREE.CylinderGeometry(0.032, 0.038, 0.024, 10), pos: [0.14, 0.24, 0.066], rot: [Math.PI / 2, 0, 0] },
  ]);

  // Rigid galvanized steel conduit pipes + hex compression couplings (top & bottom).
  const conduit = mergeParts([
    // Upper left conduit + collar
    { geo: new THREE.CylinderGeometry(0.024, 0.024, 0.58, 10), pos: [-0.11, 0.61, -0.03] },
    { geo: new THREE.CylinderGeometry(0.036, 0.036, 0.055, 6), pos: [-0.11, 0.355, -0.03] },
    // Upper right conduit + collar
    { geo: new THREE.CylinderGeometry(0.024, 0.024, 0.58, 10), pos: [0.11, 0.61, -0.03] },
    { geo: new THREE.CylinderGeometry(0.036, 0.036, 0.055, 6), pos: [0.11, 0.355, -0.03] },
    // Lower feed conduit + collar
    { geo: new THREE.CylinderGeometry(0.028, 0.028, 0.44, 10), pos: [0.0, -0.55, -0.03] },
    { geo: new THREE.CylinderGeometry(0.04, 0.04, 0.055, 6), pos: [0.0, -0.355, -0.03] },
  ]);

  // Hinged front access cover pivoted at its left edge (x = 0 -> extends to +0.40).
  const door = mergeParts([
    { geo: buildBevelBox(0.39, 0.50, 0.024, 0.008), pos: [0.20, -0.03, 0.012] },
    // Recessed pull latch handle on right side of door
    { geo: new THREE.CylinderGeometry(0.012, 0.012, 0.11, 8), pos: [0.35, -0.03, 0.036] },
    { geo: new THREE.CylinderGeometry(0.009, 0.009, 0.028, 6), pos: [0.35, 0.02, 0.024], rot: [Math.PI / 2, 0, 0] },
    { geo: new THREE.CylinderGeometry(0.009, 0.009, 0.028, 6), pos: [0.35, -0.08, 0.024], rot: [Math.PI / 2, 0, 0] },
  ]);

  // Main throw lever pivoted around X axis inside cabinet.
  const lever = mergeParts([
    { geo: new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), pos: [0, 0.05, 0.035], rot: [0.35, 0, 0] },
    { geo: new THREE.CylinderGeometry(0.016, 0.016, 0.11, 8), pos: [0, 0.105, 0.06], rot: [0, 0, Math.PI / 2] },
  ]);

  // Indicator LED dome
  const led = new THREE.SphereGeometry(0.024, 10, 8);

  return { body, conduit, door, lever, led };
}

export class BreakerSystem {
  readonly root = new THREE.Group();
  onTrip: BreakerTripCallback | null;

  private readonly ctx: Ctx;
  private readonly lights: ShootableLights | null;
  private readonly parent: THREE.Object3D | null;
  private readonly entries: BreakerEntry[] = [];
  private readonly byId = new Map<string, BreakerEntry>();
  private readonly byCollider = new Map<number, BreakerEntry>();
  private readonly liveThermal: THREE.Object3D[] = [];
  private thermalDirty = true;

  private readonly geo: ReturnType<typeof buildBreakerGeometries>;
  private readonly steelMat: THREE.MeshStandardMaterial;
  private readonly conduitMat: THREE.MeshStandardMaterial;
  private readonly doorMat: THREE.MeshStandardMaterial;
  private readonly leverMat: THREE.MeshStandardMaterial;
  private readonly ledPoweredMat: THREE.MeshStandardMaterial;
  private readonly ledTrippedMat: THREE.MeshStandardMaterial;
  private readonly ledShortedMat: THREE.MeshStandardMaterial;

  constructor(ctx: Ctx, options: BreakerSystemOptions = {}) {
    this.ctx = ctx;
    this.lights = options.lights ?? null;
    this.onTrip = options.onTrip ?? null;
    this.root.name = 'breaker-boxes';
    this.root.matrixAutoUpdate = false;
    this.root.updateMatrix();

    const defaultParent = ctx.render?.scene instanceof THREE.Scene ? ctx.render.scene : null;
    this.parent = options.parent ?? defaultParent;
    if (this.parent) this.parent.add(this.root);

    this.geo = buildBreakerGeometries();

    this.steelMat = this.makePatchedMaterial({
      color: 0x3b434c,
      metalness: 0.72,
      roughness: 0.45,
    });
    this.conduitMat = this.makePatchedMaterial({
      color: 0x5c6670,
      metalness: 0.82,
      roughness: 0.36,
    });
    this.doorMat = this.makePatchedMaterial({
      color: 0x46505b,
      metalness: 0.68,
      roughness: 0.4,
    });
    this.leverMat = this.makePatchedMaterial({
      color: 0xb82c24,
      metalness: 0.35,
      roughness: 0.45,
    });
    this.ledPoweredMat = this.makePatchedMaterial({
      color: 0x22ff66,
      roughness: 0.2,
      metalness: 0.05,
      emissive: 0x22ff66,
      emissiveIntensity: 4.0,
    });
    this.ledTrippedMat = this.makePatchedMaterial({
      color: 0xff3b1f,
      roughness: 0.2,
      metalness: 0.05,
      emissive: 0xff3b1f,
      emissiveIntensity: 3.4,
    });
    this.ledShortedMat = this.makePatchedMaterial({
      color: 0x240b08,
      roughness: 0.8,
      metalness: 0.2,
      emissive: 0x380c06,
      emissiveIntensity: 0.4,
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

  /** Registers an electrical breaker cabinet for a wing/circuit group. */
  add(spec: BreakerSpec): void {
    const pos = new THREE.Vector3(spec.position[0], spec.position[1], spec.position[2]);
    const rotQuat = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, spec.yaw);

    const freeze = (o: THREE.Object3D): void => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    };

    const group = new THREE.Group();
    group.name = `breaker:${spec.id}`;
    group.position.copy(pos);
    group.quaternion.copy(rotQuat);
    freeze(group);

    const bodyMesh = new THREE.Mesh(this.geo.body, this.steelMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    bodyMesh.userData.staticShadow = true;
    freeze(bodyMesh);

    const conduitMesh = new THREE.Mesh(this.geo.conduit, this.conduitMat);
    conduitMesh.castShadow = true;
    conduitMesh.receiveShadow = true;
    conduitMesh.userData.staticShadow = true;
    freeze(conduitMesh);

    const doorPivot = new THREE.Group();
    doorPivot.position.set(-0.21, 0, 0.065);
    freeze(doorPivot);
    const doorMesh = new THREE.Mesh(this.geo.door, this.doorMat);
    doorMesh.castShadow = true;
    doorMesh.receiveShadow = true;
    doorMesh.userData.dynamicShadow = true;
    freeze(doorMesh);
    doorPivot.add(doorMesh);

    const leverPivot = new THREE.Group();
    leverPivot.position.set(0, -0.02, 0.045);
    freeze(leverPivot);
    const leverMesh = new THREE.Mesh(this.geo.lever, this.leverMat);
    freeze(leverMesh);
    leverPivot.add(leverMesh);

    const ledMesh = new THREE.Mesh(this.geo.led, this.ledPoweredMat);
    ledMesh.position.set(0.14, 0.24, 0.078);
    freeze(ledMesh);

    group.add(bodyMesh, conduitMesh, doorPivot, leverPivot, ledMesh);
    this.root.add(group);

    const collider = this.createCollider(pos, rotQuat);

    const entry: BreakerEntry = {
      spec,
      pos,
      rotQuat,
      root: group,
      bodyMesh,
      doorPivot,
      leverPivot,
      ledMesh,
      collider,
      powered: true,
      shorted: false,
    };

    this.entries.push(entry);
    this.byId.set(spec.id, entry);
    if (collider) this.byCollider.set(collider.handle, entry);
    this.thermalDirty = true;
  }

  /** Registers an array of breaker boxes. */
  addAll(specs: readonly BreakerSpec[]): void {
    for (let i = 0; i < specs.length; i++) this.add(specs[i]!);
  }

  private createCollider(pos: THREE.Vector3, rotQuat: THREE.Quaternion): RAPIER.Collider | null {
    const addStaticBox = this.ctx.physics?.addStaticBox;
    if (typeof addStaticBox !== 'function') return null;
    const c = addStaticBox.call(this.ctx.physics, pos, BREAKER_HALF_EXTENTS, rotQuat, 'metal');
    return c && typeof c.handle === 'number' ? c : null;
  }

  /** Returns the nearest powered, non-shorted breaker within `maxDist` meters, or null. */
  nearestInteractable(playerPos: THREE.Vector3, maxDist = DEFAULT_INTERACT_DIST): BreakerSpec | null {
    let best: BreakerSpec | null = null;
    let bestDistSq = maxDist * maxDist;
    const px = playerPos.x;
    const py = playerPos.y;
    const pz = playerPos.z;

    for (let i = 0; i < this.entries.length; i++) {
      const b = this.entries[i]!;
      if (!b.powered || b.shorted) continue;
      const dx = b.pos.x - px;
      const dy = b.pos.y - py;
      const dz = b.pos.z - pz;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        best = b.spec;
      }
    }
    return best;
  }

  /**
   * Silently flips a breaker off (3 m mechanical click).
   * Switches LED to red/amber, opens cover, cuts group lights, and invokes `onTrip(spec, 'manual')`.
   */
  interact(id: string): boolean {
    const b = this.byId.get(id);
    if (!b || !b.powered || b.shorted) return false;

    b.powered = false;
    this.thermalDirty = true;
    this.applyVisualState(b);

    this.ctx.audio?.play?.('ui_click', { position: b.pos, volume: 0.45, pitch: 0.72 });
    this.lights?.setGroupPower(b.spec.group, false);
    this.onTrip?.(b.spec, 'manual');
    return true;
  }

  /** True if `collider` belongs to a breaker cabinet. */
  isBreakerCollider(collider: RAPIER.Collider | null): boolean {
    return !!collider && this.byCollider.has(collider.handle);
  }

  /**
   * Shoots a breaker cabinet to permanently short it (`shorted = true`).
   * Triggers electric arc FX + loud spark burst (16 m noise), cuts group lights,
   * prevents re-enabling, and invokes `onTrip(spec, 'shot')`.
   */
  damageCollider(collider: RAPIER.Collider | null, hitPoint?: THREE.Vector3): boolean {
    if (!collider) return false;
    const b = this.byCollider.get(collider.handle);
    if (!b || b.shorted) return false;

    b.shorted = true;
    b.powered = false;
    this.thermalDirty = true;
    this.applyVisualState(b);

    if (hitPoint) _fxPos.copy(hitPoint);
    else _fxPos.copy(b.pos);

    _forward.set(0, 0, 1).applyQuaternion(b.rotQuat);
    this.ctx.fx?.sparks?.(_fxPos, _forward, 26, 0x77ccff);
    _arcEnd.copy(_fxPos).addScaledVector(_forward, 0.55);
    _arcEnd.y += 0.35;
    this.ctx.fx?.arc?.(_fxPos, _arcEnd, 0x88ddff, 0.28, 0.08);
    _arcEnd.copy(_fxPos).addScaledVector(_forward, 0.45);
    _arcEnd.y -= 0.3;
    this.ctx.fx?.arc?.(_fxPos, _arcEnd, 0xffe488, 0.22, 0.06);
    this.ctx.fx?.smoke?.(_fxPos, 0x30363e, 0.75, 1.4);
    this.ctx.render?.lights?.flash?.(_fxPos, 0x88ccff, 34, 9, 0.14);
    this.ctx.audio?.play?.('electric_zap', { position: _fxPos, volume: 0.95, pitchJitter: 0.1 });

    this.lights?.setGroupPower(b.spec.group, false);
    this.onTrip?.(b.spec, 'shot');
    return true;
  }

  /** Shorts every intact breaker cabinet within `radius` of `center`. Returns how many shorted. */
  blast(center: THREE.Vector3, radius: number): number {
    if (radius <= 0) return 0;
    const r2 = radius * radius;
    let hits = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const b = this.entries[i]!;
      if (b.shorted || !b.collider) continue;
      if (b.pos.distanceToSquared(center) <= r2 && this.damageCollider(b.collider, b.pos)) {
        hits++;
      }
    }
    return hits;
  }

  /**
   * Sets power state on a specific breaker by ID.
   * Permanently shorted breakers refuse re-enabling and return `false`.
   */
  setPowered(id: string, powered: boolean): boolean {
    const b = this.byId.get(id);
    if (!b) return false;
    if (powered && b.shorted) return false;
    if (b.powered === powered) return true;

    b.powered = powered;
    this.thermalDirty = true;
    this.applyVisualState(b);
    this.lights?.setGroupPower(b.spec.group, powered);
    return true;
  }

  /** Attempts to restore a manually tripped breaker. Fails (returns `false`) if shorted. */
  restore(id: string): boolean {
    return this.setPowered(id, true);
  }

  /** True if circuit `group` currently has power (or has no breakers cutting it). */
  isPowered(group: string): boolean {
    let found = false;
    for (let i = 0; i < this.entries.length; i++) {
      const b = this.entries[i]!;
      if (b.spec.group !== group) continue;
      found = true;
      if (b.powered) return true;
    }
    return !found;
  }

  isShorted(id: string): boolean {
    return this.byId.get(id)?.shorted === true;
  }

  /** Returns cabinet body meshes of currently powered breakers (warm in Thermal Vision). Zero-alloc. */
  thermalMeshes(): readonly THREE.Object3D[] {
    if (this.thermalDirty) {
      this.liveThermal.length = 0;
      for (let i = 0; i < this.entries.length; i++) {
        const b = this.entries[i]!;
        if (b.powered) this.liveThermal.push(b.bodyMesh);
      }
      this.thermalDirty = false;
    }
    return this.liveThermal;
  }

  private applyVisualState(b: BreakerEntry): void {
    if (b.shorted) {
      b.ledMesh.material = this.ledShortedMat;
      b.doorPivot.rotation.set(0.14, -1.35, -0.18);
      b.leverPivot.rotation.set(1.1, 0, 0);
    } else if (!b.powered) {
      b.ledMesh.material = this.ledTrippedMat;
      b.doorPivot.rotation.set(0, -1.12, 0);
      b.leverPivot.rotation.set(1.1, 0, 0);
    } else {
      b.ledMesh.material = this.ledPoweredMat;
      b.doorPivot.rotation.set(0, 0, 0);
      b.leverPivot.rotation.set(0, 0, 0);
    }
    b.doorPivot.updateMatrix();
    b.leverPivot.updateMatrix();
  }

  /** Restores all breakers to powered, intact state on mission restart. */
  reset(): void {
    for (let i = 0; i < this.entries.length; i++) {
      const b = this.entries[i]!;
      b.powered = true;
      b.shorted = false;
      this.applyVisualState(b);
      if (!b.collider) {
        b.collider = this.createCollider(b.pos, b.rotQuat);
        if (b.collider) this.byCollider.set(b.collider.handle, b);
      }
      this.lights?.setGroupPower(b.spec.group, true);
    }
    this.thermalDirty = true;
  }

  /** Removes colliders, detaches meshes, and disposes shared geometries & materials. */
  dispose(): void {
    for (let i = 0; i < this.entries.length; i++) {
      const b = this.entries[i]!;
      if (b.collider) {
        this.byCollider.delete(b.collider.handle);
        this.ctx.physics?.world?.removeCollider?.(b.collider, false);
        b.collider = null;
      }
    }
    this.entries.length = 0;
    this.byId.clear();
    this.byCollider.clear();
    this.liveThermal.length = 0;
    this.thermalDirty = false;

    if (this.root.parent) this.root.parent.remove(this.root);
    this.root.clear();

    this.geo.body.dispose();
    this.geo.conduit.dispose();
    this.geo.door.dispose();
    this.geo.lever.dispose();
    this.geo.led.dispose();

    this.steelMat.dispose();
    this.conduitMat.dispose();
    this.doorMat.dispose();
    this.leverMat.dispose();
    this.ledPoweredMat.dispose();
    this.ledTrippedMat.dispose();
    this.ledShortedMat.dispose();
  }
}
