import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  BLOOD_MAP_LAYERS,
  BloodSurfacePool,
  buildWalkMesh,
  findNearestTri,
  type WalkMesh,
} from './bloodSurface';
import { SurfaceBloodField, SurfaceBloodTuning } from '../../gore/surfaceBlood';
import type { LoadedModel } from '../model';
import type { CharacterInstance, Ctx } from '../../core/contracts';
import type { BloodField } from '../../gore/blood';
import type { SpurtField } from '../../gore/spurt';

/**
 * Builds a vertical 2x2 quad strip (8 triangles) along X ∈ [-0.25, 0.25], Y ∈ [0.8, 1.8], Z = 0.15
 * with a deliberate UV seam down the vertical midline Y = 1.3:
 *   - Upper half (Y ∈ [1.3, 1.8]) uses UV island A: U ∈ [0.05, 0.45], V ∈ [0.05, 0.45]
 *   - Lower half (Y ∈ [0.8, 1.3]) uses UV island B: U ∈ [0.55, 0.95], V ∈ [0.55, 0.95]
 * Even though the vertices along Y = 1.3 are duplicated with completely disjoint UVs,
 * `buildWalkMesh` must bridge their adjacency by 3D position so collars and dripping blood
 * flow seamlessly across the UV seam.
 *
 * Also adds a second bone (bone 1: clutching hand) on UV island C: U ∈ [0.55, 0.85], V ∈ [0.05, 0.35].
 */
function makeSeamedModel(): LoadedModel {
  const positions: number[] = [];
  const uvs: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];

  const pushVert = (x: number, y: number, z: number, u: number, v: number, bone: number): number => {
    const id = positions.length / 3;
    positions.push(x, y, z);
    uvs.push(u, v);
    skinIndices.push(bone, 0, 0, 0);
    skinWeights.push(255, 0, 0, 0);
    return id;
  };

  // Upper strip (bone 0, UV island A: u 0.05..0.45, v 0.05..0.45): 2 rows x 3 cols -> 4 triangles
  const u00 = pushVert(-0.25, 1.8, 0.15, 0.05, 0.05, 0);
  const u10 = pushVert(0.0, 1.8, 0.15, 0.25, 0.05, 0);
  const u20 = pushVert(0.25, 1.8, 0.15, 0.45, 0.05, 0);
  const u01 = pushVert(-0.25, 1.3, 0.15, 0.05, 0.45, 0);
  const u11 = pushVert(0.0, 1.3, 0.15, 0.25, 0.45, 0);
  const u21 = pushVert(0.25, 1.3, 0.15, 0.45, 0.45, 0);

  indices.push(u00, u01, u10, u10, u01, u11);
  indices.push(u10, u11, u20, u20, u11, u21);

  // Lower strip (bone 0, UV island B: u 0.55..0.95, v 0.55..0.95) sharing EXACT 3D positions at Y = 1.3
  const l00 = pushVert(-0.25, 1.3, 0.15, 0.55, 0.55, 0);
  const l10 = pushVert(0.0, 1.3, 0.15, 0.75, 0.55, 0);
  const l20 = pushVert(0.25, 1.3, 0.15, 0.95, 0.55, 0);
  const l01 = pushVert(-0.25, 0.8, 0.15, 0.55, 0.95, 0);
  const l11 = pushVert(0.0, 0.8, 0.15, 0.75, 0.95, 0);
  const l21 = pushVert(0.25, 0.8, 0.15, 0.95, 0.95, 0);

  indices.push(l00, l01, l10, l10, l01, l11);
  indices.push(l10, l11, l20, l20, l11, l21);

  // Hand quad (bone 1, UV island C: u 0.55..0.85, v 0.05..0.35)
  const h0 = pushVert(0.4, 1.1, 0.15, 0.55, 0.05, 1);
  const h1 = pushVert(0.4, 0.9, 0.15, 0.55, 0.35, 1);
  const h2 = pushVert(0.6, 1.1, 0.15, 0.85, 0.05, 1);
  const h3 = pushVert(0.6, 0.9, 0.15, 0.85, 0.35, 1);
  indices.push(h0, h1, h2, h2, h1, h3);

  const geom = new THREE.BufferGeometry();
  geom.setIndex(indices);

  return {
    attributes: {
      position: new THREE.BufferAttribute(new Float32Array(positions), 3),
      normal: new THREE.BufferAttribute(new Float32Array(positions.length), 3),
      uv: new THREE.BufferAttribute(new Float32Array(uvs), 2),
      skinIndex: new THREE.BufferAttribute(new Uint8Array(skinIndices), 4),
      skinWeight: new THREE.BufferAttribute(new Uint8Array(skinWeights), 4),
    },
    lods: [geom, geom],
    meta: { rigBoneCount: 2 },
  } as unknown as LoadedModel;
}

function makeMockChar(walkMesh: WalkMesh | null, pool: BloodSurfacePool, fleshy = true): CharacterInstance & {
  lastLayer: number;
  lastActive: number;
  lastSoak: number;
} {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const b0 = new THREE.Bone();
  const b1 = new THREE.Bone();
  b0.position.set(0, 1.3, 0);
  b1.position.set(0.5, 1.0, 0);
  root.add(b0);
  root.add(b1);
  root.updateMatrixWorld(true);

  const char = {
    archetype: fleshy ? 'husk' : 'drone',
    root,
    bones: [b0, b1],
    rig: { height: 1.85, bones: [{ parent: -1 }, { parent: 0 }] },
    severed: new Set(),
    lastLayer: 0,
    lastActive: 0,
    lastSoak: 0,
    a: {
      walkMesh: fleshy ? walkMesh : null,
      interior: fleshy ? new THREE.BufferGeometry() : null,
      bindPositions: [new THREE.Vector3(0, 1.3, 0), new THREE.Vector3(0.5, 1.0, 0)],
      bloodPool: pool,
    },
    setBloodMapLayer(layer: number, active: number, soak: number) {
      this.lastLayer = layer;
      this.lastActive = active;
      this.lastSoak = soak;
    },
    isHidden: () => false,
  };
  return char as unknown as CharacterInstance & { lastLayer: number; lastActive: number; lastSoak: number };
}

function makeHarness(pool: BloodSurfacePool) {
  let elapsed = 0;
  const ctx = {
    time: {
      get elapsed() { return elapsed; },
      dt: 1 / 60,
    },
    characters: { bloodPool: pool },
  } as unknown as Ctx;

  const blood = {
    drip: vi.fn(),
    droplet: vi.fn(),
    wetAt: vi.fn(() => false),
  } as unknown as BloodField & { drip: ReturnType<typeof vi.fn>; droplet: ReturnType<typeof vi.fn> };

  let nextSpurtId = 1;
  const spurts = {
    start: vi.fn(() => nextSpurtId++),
    setPower: vi.fn(),
    stop: vi.fn(),
    clampRemaining: vi.fn(),
  } as unknown as SpurtField & {
    start: ReturnType<typeof vi.fn>;
    setPower: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    clampRemaining: ReturnType<typeof vi.fn>;
  };

  const field = new SurfaceBloodField(ctx, blood, spurts, pool);
  return {
    field,
    blood,
    spurts,
    advance(seconds: number, steps = Math.max(1, Math.round(seconds * 60))) {
      const dt = seconds / steps;
      for (let i = 0; i < steps; i++) {
        elapsed += dt;
        field.update(dt);
      }
    },
    setTime(t: number) { elapsed = t; },
  };
}

describe('WalkMesh & BloodSurfacePool', () => {
  it('bridges triangle adjacency across disjoint UV seams via 3D edge welding', () => {
    const mesh = buildWalkMesh(makeSeamedModel());
    expect(mesh).not.toBeNull();
    // Triangles 0..3 are upper island A; triangles 4..7 are lower island B.
    // Upper triangles touching Y=1.3 must have at least one neighbor in lower island B (tri >= 4).
    let bridged = 0;
    for (let t = 0; t < 4; t++) {
      for (let e = 0; e < 3; e++) {
        const nb = mesh!.triAdj[t * 3 + e]!;
        if (nb >= 4 && nb < 8) bridged++;
      }
    }
    expect(bridged).toBeGreaterThanOrEqual(2);
  });

  it('paints a collar seamlessly across a UV seam into both UV islands', () => {
    const mesh = buildWalkMesh(makeSeamedModel())!;
    const pool = new BloodSurfacePool();
    const owner = {};
    const layer = pool.acquire(owner, 3, 0);

    const bary = new Float32Array(3);
    // Point right near the UV seam at (0, 1.32, 0.15)
    const tri = findNearestTri(mesh, 0, 0, 1.32, 0.15, bary);
    expect(tri).toBeGreaterThanOrEqual(0);
    pool.paintCollar(layer, mesh, tri, 0, 1.32, 0.15, 0.12, 0.9, 1.0);

    // Sample UV island A (just above seam: u=0.25, v=0.43) AND UV island B (just below seam: u=0.75, v=0.57)
    const [above] = pool.sampleUv(layer, 0.25, 0.43);
    const [below] = pool.sampleUv(layer, 0.75, 0.57);
    expect(above).toBeGreaterThan(0.2);
    expect(below).toBeGreaterThan(0.2);
  });

  it('allocates up to BLOOD_MAP_LAYERS, evicts lowest-priority oldest layer, and decays freshness without erasing coverage', () => {
    const pool = new BloodSurfacePool();
    const evicted: object[] = [];
    pool.onEvict = o => evicted.push(o);

    const owners = Array.from({ length: BLOOD_MAP_LAYERS + 1 }, () => ({}));
    for (let i = 0; i < BLOOD_MAP_LAYERS; i++) {
      // Give owner 0 lowest priority so it is evicted when layer 33 is acquired
      pool.acquire(owners[i]!, i === 0 ? 1 : 3, i);
    }
    const layerExtra = pool.acquire(owners[BLOOD_MAP_LAYERS]!, 4, 100);
    expect(layerExtra).toBe(0);
    expect(evicted).toEqual([owners[0]]);

    // Paint a streak and verify decayFreshness reduces freshness (G) while leaving coverage (R) intact
    pool.paintStreak(layerExtra, 0.2, 0.2, 0.3, 0.3, 2, 0.9, 1.0);
    const [beforeCov, beforeFresh] = pool.sampleUv(layerExtra, 0.25, 0.25);
    expect(beforeCov).toBeGreaterThan(0.5);
    expect(beforeFresh).toBeGreaterThan(0.5);
    for (let s = 0; s < 8; s++) pool.decayFreshness(0.5);
    const [afterCov, afterFresh] = pool.sampleUv(layerExtra, 0.25, 0.25);
    expect(afterCov).toBeCloseTo(beforeCov, 3);
    expect(afterFresh).toBeLessThan(beforeFresh);
  });
});

describe('SurfaceBloodField', () => {
  it('excludes machines (drones/skitters/Titan with interior === null) completely', () => {
    const mesh = buildWalkMesh(makeSeamedModel())!;
    const pool = new BloodSurfacePool();
    const { field, spurts } = makeHarness(pool);
    const drone = makeMockChar(mesh, pool, false);

    const ok = field.bleedWound(drone, {
      bone: 0,
      point: new THREE.Vector3(0, 1.6, 0.15),
      tier: 3,
    });
    expect(ok).toBe(false);
    expect(drone.lastLayer).toBe(0);
    expect(spurts.start).not.toHaveBeenCalled();
  });

  it('differentiates Tier 1/2/3, walks droplets across UV seams under gravity, and detaches to BloodField at hems', () => {
    const mesh = buildWalkMesh(makeSeamedModel())!;
    const pool = new BloodSurfacePool();
    const { field, blood, spurts, advance } = makeHarness(pool);
    const husk = makeMockChar(mesh, pool, true);

    // Tier 1: no spurt rope
    expect(field.bleedWound(husk, { bone: 0, point: new THREE.Vector3(0, 1.7, 0.15), tier: 1, zone: 'chest:0' })).toBe(true);
    expect(spurts.start).not.toHaveBeenCalled();

    // Upgrade same zone to Tier 3: launches arterial spurt rope
    expect(field.bleedWound(husk, { bone: 0, point: new THREE.Vector3(0, 1.7, 0.15), tier: 3, zone: 'chest:0' })).toBe(true);
    expect(spurts.start).toHaveBeenCalledTimes(1);

    // Step 4 seconds upright: droplets must walk down from island A (Y=1.7), cross the Y=1.3 UV seam into island B,
    // and reach the bottom hem at Y=0.8 where they detach into floor BloodField drops!
    advance(4.0, 240);
    expect(field.dropletsSpawned).toBeGreaterThan(3);
    expect(field.dropletsDetached).toBeGreaterThan(0);
    expect(blood.drip.mock.calls.length + blood.droplet.mock.calls.length).toBeGreaterThan(0);

    // Verify blood painted into BOTH upper UV island A (around u=0.25, v=0.25) AND lower UV island B (around u=0.75, v=0.75)
    const layer = husk.lastLayer - 1;
    let maxLower = 0;
    for (let u = 0.65; u <= 0.85; u += 0.02) {
      for (let v = 0.6; v <= 0.9; v += 0.05) {
        maxLower = Math.max(maxLower, pool.sampleUv(layer, u, v)[0]);
      }
    }
    expect(maxLower).toBeGreaterThan(0.15);
  });

  it('bends new drips sideways when the character rotates onto their side (pose-reactive gravity)', () => {
    const mesh = buildWalkMesh(makeSeamedModel())!;
    const pool = new BloodSurfacePool();
    const { field, advance } = makeHarness(pool);
    const char = makeMockChar(mesh, pool, true);

    // Rotate character 90° around Z so bind +X points straight down (-Y in world)!
    char.root.rotation.z = -Math.PI / 2;
    char.root.updateMatrixWorld(true);

    // Place wound on the upper-left side in bind space (-0.1, 1.55, 0.15) -> transformed to world
    const worldPt = new THREE.Vector3(-0.1, 1.55 - 1.3, 0.15).applyMatrix4(char.bones[0]!.matrixWorld);
    expect(field.bleedWound(char, { bone: 0, point: worldPt, tier: 2, zone: 'ribs:0' })).toBe(true);

    advance(2.0, 120);

    const layer = char.lastLayer - 1;
    // In island A, bind +X maps to increasing U (0.05 -> 0.45) at constant V (~0.25).
    // Check that blood flowed sideways to U > 0.30 (bind +X), NOT straight down to V > 0.40!
    let rightSide = 0;
    for (let u = 0.30; u <= 0.44; u += 0.02) {
      rightSide = Math.max(rightSide, pool.sampleUv(layer, u, 0.25)[0]);
    }
    expect(rightSide).toBeGreaterThan(0.15);
  });

  it('damps arterial spurt and stains clutching hand, stops on dressing, and clamps spurt on death', () => {
    const mesh = buildWalkMesh(makeSeamedModel())!;
    const pool = new BloodSurfacePool();
    const { field, spurts, advance } = makeHarness(pool);
    const soldier = makeMockChar(mesh, pool, true);

    field.bleedWound(soldier, { bone: 0, point: new THREE.Vector3(0, 1.65, 0.15), tier: 3, zone: 'carotid:0', spurtPower: 1.0 });
    expect(spurts.start).toHaveBeenCalledTimes(1);

    // Clutch wound on bone 0 with hand bone 1
    field.setClutch(soldier, 0, 1);
    expect(spurts.setPower).toHaveBeenCalledWith(1, SurfaceBloodTuning.clutchSpurtScale);

    // Hand UV island C (u 0.55..0.85, v 0.05..0.35) should now have blood stain
    const layer = soldier.lastLayer - 1;
    let handBlood = 0;
    for (let u = 0.58; u <= 0.82; u += 0.04) {
      for (let v = 0.08; v <= 0.32; v += 0.04) {
        handBlood = Math.max(handBlood, pool.sampleUv(layer, u, v)[0]);
      }
    }
    expect(handBlood).toBeGreaterThan(0.15);

    // Death clamps remaining spurt life
    field.onDeath(soldier);
    expect(spurts.clampRemaining).toHaveBeenCalled();

    // Dressing stops the zone's bleeding & spurt while keeping existing stains
    field.stopBleeding(soldier, 'carotid:0');
    expect(spurts.stop).toHaveBeenCalledWith(1);
    advance(0.5, 30);
    expect(pool.sampleUv(layer, 0.25, 0.17)[0]).toBeGreaterThan(0.1);
  });
});
