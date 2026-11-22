import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../core/contracts';
import {
  DEFAULT_SHATTER_CHANCE,
  MAX_FLYING,
  PlateDebris,
  plateGeometry,
  plateMaterial,
  plateShards,
  type Plate,
  type PlatePaint,
  type PlateSpec,
} from './armor';
import { plateShatterChance } from './damage';

const PAINT: PlatePaint = {
  body: 0x607080,
  rib: 0x506070,
  edge: 0x90a0b0,
  bolt: 0xc0c8d0,
  stripe: 0xd0a030,
};

const HELMET_SPEC: PlateSpec = {
  regions: ['head'],
  bone: 0,
  hp: 0.3,
  size: [0.26, 0.24, 0.08],
  offset: [0, 0.04, 0],
  shape: 'slab',
  paint: PAINT,
  worn: 'helmet',
};

const BRUTE_CHEST_SPEC: PlateSpec = {
  regions: ['chest'],
  bone: 1,
  hp: 0.15,
  size: [0.56, 0.4, 0.09],
  offset: [0, 0.02, 0.27],
  shape: 'slab',
  paint: PAINT,
};

const BRUTE_SLEEVE_SPEC: PlateSpec = {
  regions: ['armL'],
  bone: 2,
  hp: 0.07,
  size: [0.2, 0.26, 0.03],
  offset: [0.1, -0.2, 0],
  shape: 'sleeve',
  paint: PAINT,
};

function makeCtx(): { ctx: Ctx; scene: THREE.Scene } {
  const scene = new THREE.Scene();
  const ctx = {
    render: {
      scene,
      materials: {
        patch: <T extends THREE.Material>(m: T): T => m,
      },
    },
  } as unknown as Ctx;
  return { ctx, scene };
}

function makePlate(spec: PlateSpec, ctx: Ctx, worn = false): { plate: Plate; bone: THREE.Group } {
  const bone = new THREE.Group();
  bone.position.set(1, 1.5, -2);
  bone.updateMatrixWorld(true);
  const geom = worn ? new THREE.SphereGeometry(0.14, 8, 6) : plateGeometry(spec);
  const mat = worn ? new THREE.MeshStandardMaterial({ color: spec.paint.body }) : plateMaterial(ctx);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(spec.offset[0], spec.offset[1], spec.offset[2]);
  bone.add(mesh);
  bone.updateMatrixWorld(true);
  return { plate: { spec, hp: 20, mesh, worn }, bone };
}

function minLuminance(geometry: THREE.BufferGeometry): number {
  const col = geometry.getAttribute('color') as THREE.BufferAttribute;
  let min = Infinity;
  for (let i = 0; i < col.count; i++) {
    const lum = 0.299 * col.getX(i) + 0.587 * col.getY(i) + 0.114 * col.getZ(i);
    if (lum < min) min = lum;
  }
  return min;
}

function maxLuminance(geometry: THREE.BufferGeometry): number {
  const col = geometry.getAttribute('color') as THREE.BufferAttribute;
  let max = -Infinity;
  for (let i = 0; i < col.count; i++) {
    const lum = 0.299 * col.getX(i) + 0.587 * col.getY(i) + 0.114 * col.getZ(i);
    if (lum > max) max = lum;
  }
  return max;
}

describe('all-armor shattering (PlateDebris)', () => {
  it('shatters helmets into 2–3 curved dome shards with darker liner underside, or launches intact when shatter does not trigger', () => {
    const { ctx, scene } = makeCtx();
    const debris = new PlateDebris(ctx);
    const dir = new THREE.Vector3(0, 0.2, 1).normalize();

    // Shatter guaranteed: 2–3 shards, original helmet mesh detached & hidden.
    const counts = new Set<number>();
    for (let trial = 0; trial < 20; trial++) {
      const { plate, bone } = makePlate(HELMET_SPEC, ctx, true);
      debris.launch(plate, dir, 1);
      expect(plate.mesh.parent).toBeNull();
      expect(plate.mesh.visible).toBe(false);
      expect(scene.children.includes(plate.mesh)).toBe(false);
      expect(scene.children.length).toBeGreaterThanOrEqual(2);
      expect(scene.children.length).toBeLessThanOrEqual(3);
      counts.add(scene.children.length);

      // Shards diverge and tumble over time.
      const beforePos = scene.children.map(c => c.position.clone());
      const beforeRot = scene.children.map(c => c.rotation.clone());
      debris.update(0.1);
      for (let i = 0; i < scene.children.length; i++) {
        const c = scene.children[i]!;
        expect(c.position.distanceTo(beforePos[i]!)).toBeGreaterThan(0.1);
        const rotDelta = Math.abs(c.rotation.x - beforeRot[i]!.x) + Math.abs(c.rotation.y - beforeRot[i]!.y) + Math.abs(c.rotation.z - beforeRot[i]!.z);
        expect(rotDelta).toBeGreaterThan(0.1);
      }
      debris.clear();
      expect(bone.children.length).toBe(0);
    }
    expect(counts.has(2) || counts.has(3)).toBe(true);

    // Intact pop-off when shatterChance = 0.
    const { plate: intact } = makePlate(HELMET_SPEC, ctx, true);
    debris.launch(intact, dir, 0);
    expect(scene.children).toEqual([intact.mesh]);
    expect(intact.mesh.visible).toBe(true);
    expect(debris.activeCount).toBe(1);
    debris.clear();

    // Helmet shard geometry includes both painted outer shell and noticeably darker matte liner underside, cached per spec.
    const shards = plateShards(HELMET_SPEC, 3);
    expect(shards).toHaveLength(3);
    expect(plateShards(HELMET_SPEC, 3)).toBe(shards);
    for (const s of shards) {
      expect(s.geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(minLuminance(s.geometry)).toBeLessThan(maxLuminance(s.geometry) * 0.4);
    }
  });

  it('shatters body/Brute slab and limb sleeve plates into 2–4 jagged shards, or launches intact when shatter does not trigger', () => {
    const { ctx, scene } = makeCtx();
    const debris = new PlateDebris(ctx);
    const dir = new THREE.Vector3(0.3, 0.1, 1).normalize();

    for (const spec of [BRUTE_CHEST_SPEC, BRUTE_SLEEVE_SPEC]) {
      for (let trial = 0; trial < 20; trial++) {
        const { plate } = makePlate(spec, ctx, false);
        debris.launch(plate, dir, 1);
        expect(plate.mesh.parent).toBeNull();
        expect(plate.mesh.visible).toBe(false);
        expect(scene.children.length).toBeGreaterThanOrEqual(2);
        expect(scene.children.length).toBeLessThanOrEqual(4);
        expect(debris.activeCount).toBe(scene.children.length);
        debris.clear();
      }

      // Intact pop-off when shatterChance = 0.
      const { plate: intact } = makePlate(spec, ctx, false);
      debris.launch(intact, dir, 0);
      expect(scene.children).toEqual([intact.mesh]);
      expect(intact.mesh.visible).toBe(true);
      expect(debris.activeCount).toBe(1);
      debris.clear();

      // Cached shard geometry with outer paint + darker fractured core.
      const cached4 = plateShards(spec, 4);
      expect(cached4).toHaveLength(4);
      expect(plateShards(spec, 4)).toBe(cached4);
      for (const s of cached4) {
        expect(s.geometry.getAttribute('position').count).toBeGreaterThan(0);
        expect(minLuminance(s.geometry)).toBeLessThan(maxLuminance(s.geometry) * 0.55);
      }
    }
  });

  it('keeps pooled plate.mesh restorable via release() and cleans up + recycles shards on expiry, clear(), and MAX_FLYING overflow', () => {
    const { ctx, scene } = makeCtx();
    const debris = new PlateDebris(ctx);
    const dir = new THREE.Vector3(0, 0, 1);

    // 1. Shattered plate mesh stays intact in memory and restores cleanly on release().
    const { plate, bone } = makePlate(BRUTE_CHEST_SPEC, ctx, false);
    const originalGeom = plate.mesh.geometry;
    const originalMat = plate.mesh.material;
    debris.launch(plate, dir, 1);
    expect(plate.mesh.visible).toBe(false);
    expect(plate.mesh.parent).toBeNull();

    // Simulate enemy respawn re-attaching its pooled plate mesh.
    debris.release(plate.mesh);
    bone.add(plate.mesh);
    expect(plate.mesh.visible).toBe(true);
    expect(plate.mesh.scale.x).toBe(1);
    expect(plate.mesh.scale.y).toBe(1);
    expect(plate.mesh.scale.z).toBe(1);
    expect(plate.mesh.geometry).toBe(originalGeom);
    expect(plate.mesh.material).toBe(originalMat);

    // 2. Expiry via update(dt) removes all shards from scene and returns them to the internal pool.
    const spawnedMeshes = new Set(scene.children);
    expect(spawnedMeshes.size).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 30; i++) debris.update(0.1);
    expect(scene.children.length).toBe(0);
    expect(debris.activeCount).toBe(0);
    expect(debris.pooledCount).toBe(spawnedMeshes.size);

    // Next shatter reuses pooled shard meshes instead of leaking new ones.
    debris.launch(plate, dir, 1);
    const reusedCount = scene.children.filter(c => spawnedMeshes.has(c)).length;
    expect(reusedCount).toBeGreaterThan(0);

    // 3. clear() removes all remaining shards from the scene.
    debris.clear();
    expect(scene.children.length).toBe(0);
    expect(debris.activeCount).toBe(0);

    // 4. Intact plate released mid-fade restores visible = true and scale = 1.
    debris.release(plate.mesh);
    bone.add(plate.mesh);
    debris.launch(plate, dir, 0);
    debris.update(1.45);
    debris.release(plate.mesh);
    expect(plate.mesh.visible).toBe(true);
    expect(plate.mesh.scale.x).toBe(1);
    expect(plate.mesh.scale.y).toBe(1);
    expect(plate.mesh.scale.z).toBe(1);
    expect(debris.activeCount).toBe(0);

    // 5. Respects MAX_FLYING cap under heavy multi-shard bursts.
    for (let i = 0; i < 30; i++) {
      const { plate: burstPlate } = makePlate(BRUTE_CHEST_SPEC, ctx, false);
      debris.launch(burstPlate, dir, 1);
      expect(debris.activeCount).toBeLessThanOrEqual(MAX_FLYING);
      expect(scene.children.length).toBeLessThanOrEqual(MAX_FLYING);
    }
    debris.clear();
    expect(scene.children.length).toBe(0);
    expect(debris.activeCount).toBe(0);
  });

  it('scales shatter probability with weapon class, overkill, AP ammo, explosives, and piercing hits', () => {
    const light = plateShatterChance({ amount: 14, type: 'bullet', source: 'smg' }, 21, 0);
    expect(light).toBeCloseTo(DEFAULT_SHATTER_CHANCE, 5);

    const medium = plateShatterChance({ amount: 35, type: 'bullet', source: 'harrow' }, 21, 0);
    expect(medium).toBeGreaterThan(light);

    const heavy = plateShatterChance({ amount: 75, type: 'bullet', source: 'piledriver' }, 21, 15);
    expect(heavy).toBeGreaterThanOrEqual(0.9);
    expect(heavy).toBeLessThanOrEqual(1);

    const explosive = plateShatterChance({ amount: 120, type: 'explosive', source: 'rocket' }, 21, 0);
    expect(explosive).toBeGreaterThanOrEqual(0.9);

    const piercing = plateShatterChance({ amount: 90, type: 'bullet', source: 'sabot', pierces: true, armorPiercing: true }, 21, 0);
    expect(piercing).toBeGreaterThanOrEqual(0.9);
  });
});
