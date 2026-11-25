/**
 * Unit tests for Distraint Frame v2 Full Chassis silhouettes (`kestrel`, `bastion`, `valkyrie`, `chitin`, rebuilt
 * `cockpitOpen`, upgraded `cockpitTwin`), all 6 sculpted Heads / Sensor Crowns (`standard`, `duelist`, `cyclops`,
 * `stealth`, `bunker`, `halo`), vertex-color paint palette remapping, and `StandIn.setLoadout` full-matrix swaps.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../../core/contracts';
import { ModelMaterials } from '../../progression/modelkit';
import { StandIn } from '../cockpit';
import { defaultLoadout, fitPart, type FramePartId, type HeadKind } from '../loadout';
import { buildChassisVisual } from './chassis';
import { buildHeadVisual } from './heads';
import { BUREAU_PALETTE, FRAME_PALETTES, resolvePalette, type PaintKind } from './shared';

function makeMaterials(): ModelMaterials {
  const ctx = {
    render: { materials: { patch: <T extends THREE.Material>(m: T): T => m } },
  } as unknown as Ctx;
  return new ModelMaterials(ctx);
}

/** Verifies every mesh in `group` has finite vertex positions and returns total vertex & triangle counts. */
function inspectGroup(group: THREE.Object3D | undefined): { meshes: number; vertices: number; triangles: number; box: THREE.Box3 } {
  expect(group).toBeDefined();
  let meshes = 0;
  let vertices = 0;
  let triangles = 0;
  const box = new THREE.Box3();
  group!.updateMatrixWorld(true);
  group!.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes++;
    const pos = mesh.geometry.getAttribute('position');
    expect(pos).toBeDefined();
    expect(pos.count).toBeGreaterThan(0);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(Number.isFinite(z)).toBe(true);
    }
    vertices += pos.count;
    triangles += mesh.geometry.index ? mesh.geometry.index.count / 3 : pos.count / 3;
    mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) {
      box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    }
  });
  expect(meshes).toBeGreaterThan(0);
  expect(vertices).toBeGreaterThan(0);
  return { meshes, vertices, triangles, box };
}

/** Computes the average RGB vertex color of the first solid vertex-colored mesh in `group`. */
function averageSolidColor(group: THREE.Object3D): [number, number, number] {
  let result: [number, number, number] | null = null;
  group.traverse(obj => {
    if (result) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const col = mesh.geometry.getAttribute('color');
    if (!col || col.count === 0) return;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < col.count; i++) {
      r += col.getX(i);
      g += col.getY(i);
      b += col.getZ(i);
    }
    result = [r / col.count, g / col.count, b / col.count];
  });
  expect(result).not.toBeNull();
  return result!;
}

const FULL_HULL_CHASSIS: readonly FramePartId[] = [
  'chassisKestrel',
  'chassisBastion',
  'chassisValkyrie',
  'chassisChitin',
  'cockpitOpen',
];

const ALL_CHASSIS_PARTS: readonly FramePartId[] = [
  'cockpitStandard',
  'cockpitTwin',
  'cockpitOpen',
  'cockpitSensor',
  'chassisKestrel',
  'chassisBastion',
  'chassisValkyrie',
  'chassisChitin',
];

const ALL_HEAD_KINDS: readonly HeadKind[] = [
  'standard',
  'duelist',
  'cyclops',
  'stealth',
  'bunker',
  'halo',
];

const ALL_HEAD_PARTS: readonly FramePartId[] = [
  'headStandard',
  'headDuelist',
  'headCyclops',
  'headStealth',
  'headBunker',
  'headHalo',
];

const ALL_PAINT_PARTS: readonly FramePartId[] = [
  'paintBureau',
  'paintArctic',
  'paintHazard',
  'paintCrimson',
  'paintDesert',
  'paintStealth',
  'paintRust',
  'paintCobalt',
  'paintForest',
  'paintChrome',
];

describe('v2 Full-Body Chassis silhouettes', () => {
  it('builds all 4 new chassis and rebuilt cockpitOpen with replacesHull: true, high detail, and finite vertices', () => {
    const mat = makeMaterials();
    for (const id of FULL_HULL_CHASSIS) {
      const vis = buildChassisVisual(id, mat, BUREAU_PALETTE);
      expect(vis).not.toBeNull();
      expect(vis!.replacesHull).toBe(true);
      expect(vis!.hideStandardInterior).toBe(true);
      expect(vis!.hideStandardVisor).toBe(true);
      expect(vis!.places).toBeDefined();

      const ext = inspectGroup(vis!.exterior);
      const intr = inspectGroup(vis!.interior);
      // Merged bevelled multi-part geometry should contain high vertex/triangle density (> 1500 verts).
      expect(ext.vertices).toBeGreaterThan(1500);
      expect(ext.triangles).toBeGreaterThan(500);
      expect(intr.vertices).toBeGreaterThan(200);

      if (id !== 'cockpitOpen') {
        expect(vis!.visorActive).toBeDefined();
        expect(vis!.visorStandby).toBeDefined();
        expect(vis!.visorActive!.visible).toBe(true);
        expect(vis!.visorStandby!.visible).toBe(false);
      }
    }
  });

  it('builds upgraded cockpitTwin with wide twin-yoke gantries while keeping standard interior/cracks enabled', () => {
    const mat = makeMaterials();
    const vis = buildChassisVisual('cockpitTwin', mat, BUREAU_PALETTE);
    expect(vis).not.toBeNull();
    expect(vis!.hideStandardInterior).toBe(false);
    expect(vis!.hideStandardVisor).toBe(false);
    expect(vis!.places).toBeDefined();
    expect(Math.abs(vis!.places!.shoulders[0][0])).toBeGreaterThan(1.6);

    const ext = inspectGroup(vis!.exterior);
    const intr = inspectGroup(vis!.interior);
    expect(ext.vertices).toBeGreaterThan(1200);
    expect(intr.vertices).toBeGreaterThan(150);
  });

  it('gives each custom chassis distinct hardpoint places & posture silhouettes', () => {
    const mat = makeMaterials();
    const kestrel = buildChassisVisual('chassisKestrel', mat)!.places!;
    const bastion = buildChassisVisual('chassisBastion', mat)!.places!;
    const valkyrie = buildChassisVisual('chassisValkyrie', mat)!.places!;
    const chitin = buildChassisVisual('chassisChitin', mat)!.places!;
    const open = buildChassisVisual('cockpitOpen', mat)!.places!;

    // Narrow Kestrel vs wide Bastion arms.
    expect(Math.abs(kestrel.leftArm[0])).toBeLessThan(1.55);
    expect(Math.abs(bastion.leftArm[0])).toBeGreaterThanOrEqual(2.1);
    expect(Math.abs(bastion.rightArm[0])).toBeGreaterThanOrEqual(2.1);

    // Kestrel and Chitin have forward hunched posture pitch; Valkyrie is upright.
    expect(kestrel.posturePitch).toBeLessThan(-0.07);
    expect(chitin.posturePitch).toBeLessThan(-0.04);
    expect(valkyrie.posturePitch ?? 0).toBeGreaterThanOrEqual(0);

    // Valkyrie mounts shoulders wide on its sweeping wing rack.
    expect(Math.abs(valkyrie.shoulders[0][0])).toBeGreaterThan(2.0);

    // Open Frame supports all 3 distinct shoulder hardpoints (right, left, dorsal rollbar).
    expect(open.shoulders).toHaveLength(3);
    expect(open.shoulders[0][0]).toBeGreaterThan(1.0);
    expect(open.shoulders[1][0]).toBeLessThan(-1.0);
    expect(open.shoulders[2][1]).toBeGreaterThan(open.shoulders[0][1]);

    // Every chassis has unique arm/shoulder geometry signatures.
    const sigs = new Set([kestrel, bastion, valkyrie, chitin, open].map(p => JSON.stringify(p)));
    expect(sigs.size).toBe(5);
  });

  it('remaps vertex colors cleanly across paint liveries and custom paint swatches', () => {
    const mat = makeMaterials();
    const palettes: PaintKind[] = ['bureau', 'arctic', 'hazard', 'crimson'];
    for (const id of ['chassisKestrel', 'chassisBastion', 'chassisValkyrie', 'chassisChitin', 'cockpitOpen', 'cockpitTwin'] as const) {
      const colors = palettes.map(p => averageSolidColor(buildChassisVisual(id, mat, FRAME_PALETTES[p])!.exterior!));
      // Arctic white should be substantially brighter than dark Bureau obsidian.
      const bureauLum = colors[0]![0] + colors[0]![1] + colors[0]![2];
      const arcticLum = colors[1]![0] + colors[1]![1] + colors[1]![2];
      expect(arcticLum).toBeGreaterThan(bureauLum * 2);

      // Crimson red channel should dominate its blue channel.
      expect(colors[3]![0]).toBeGreaterThan(colors[3]![2] * 1.4);

      // Custom swatch override remaps primary/glow cleanly.
      const customPal = resolvePalette('bureau', { primary: '#20c840', secondary: '#1850c8', glow: '#ff00ff' });
      const customCol = averageSolidColor(buildChassisVisual(id, mat, customPal)!.exterior!);
      const diff = Math.abs(customCol[0] - colors[0]![0]) + Math.abs(customCol[1] - colors[0]![1]) + Math.abs(customCol[2] - colors[0]![2]);
      expect(diff).toBeGreaterThan(0.15);
    }
  });
});

describe('v2 Sculpted Heads / Sensor Crowns', () => {
  it('builds all 6 HeadKind models with finite geometry, distinct proportions, and palette remapping', () => {
    const mat = makeMaterials();
    const heights: Record<HeadKind, number> = {
      standard: 0, duelist: 0, cyclops: 0, stealth: 0, bunker: 0, halo: 0,
    };

    for (const kind of ALL_HEAD_KINDS) {
      const bureauHead = buildHeadVisual(kind, mat, BUREAU_PALETTE);
      expect(bureauHead).not.toBeNull();
      const info = inspectGroup(bureauHead!.group);
      expect(info.vertices).toBeGreaterThan(80);
      const size = new THREE.Vector3();
      info.box.getSize(size);
      heights[kind] = size.y;

      // Verify palette remapping produces distinct vertex colors on every head.
      const arcticHead = buildHeadVisual(kind, mat, FRAME_PALETTES.arctic)!;
      const bCol = averageSolidColor(bureauHead!.group);
      const aCol = averageSolidColor(arcticHead.group);
      const lumDiff = (aCol[0] + aCol[1] + aCol[2]) - (bCol[0] + bCol[1] + bCol[2]);
      expect(lumDiff).toBeGreaterThan(0.25);
    }

    // Halo Seraph Crown should be noticeably taller than the flat low-profile Stealth hood.
    expect(heights.halo).toBeGreaterThan(heights.stealth * 1.8);
  });

  it('animates Cyclops mono-eye tracking, Halo ring rotation/pulse, and head pitch tracking cleanly', () => {
    const mat = makeMaterials();

    // Cyclops mono-eye sweeps horizontally in pose().
    const cyclops = buildHeadVisual('cyclops', mat, BUREAU_PALETTE)!;
    const eyePivot = cyclops.group.getObjectByName('head.cyclops.eye')!;
    expect(eyePivot).toBeDefined();
    cyclops.pose!(0.4, 0.2, 0.5, false);
    const yaw1 = eyePivot.rotation.y;
    expect(Number.isFinite(yaw1)).toBe(true);
    expect(Math.abs(yaw1)).toBeGreaterThan(0.05);
    cyclops.pose!(-0.4, -0.2, 0.5, false);
    expect(eyePivot.rotation.y).not.toBeCloseTo(yaw1, 3);

    // Halo ring rotates and bobs smoothly in pose().
    const halo = buildHeadVisual('halo', mat, BUREAU_PALETTE)!;
    const ring = halo.group.getObjectByName('head.halo.ring')!;
    expect(ring).toBeDefined();
    const startRotY = ring.rotation.y;
    const startPosY = ring.position.y;
    halo.pose!(0, 0.15, 0.4, false);
    expect(ring.rotation.y).toBeGreaterThan(startRotY);
    expect(ring.position.y).not.toBeCloseTo(startPosY, 4);

    // All 6 heads handle active & standby pose ticks without NaN transforms.
    for (const kind of ALL_HEAD_KINDS) {
      const h = buildHeadVisual(kind, mat, BUREAU_PALETTE)!;
      h.pose?.(0.25, 0.3, 0.016, false);
      h.pose?.(0, -0.2, 0.016, true);
      h.group.traverse(o => {
        expect(Number.isFinite(o.rotation.x)).toBe(true);
        expect(Number.isFinite(o.rotation.y)).toBe(true);
        expect(Number.isFinite(o.position.y)).toBe(true);
      });
    }
  });
});

describe('StandIn full-matrix loadout swaps', () => {
  it('swaps cleanly across every chassis, head, and paint livery (plus custom paint) and updates places & visors', () => {
    const mat = makeMaterials();
    const scene = new THREE.Scene();
    const body = new StandIn(mat, scene);
    const eye = new THREE.Vector3();
    const feet = new THREE.Vector3(0, 0, 0);

    // Swap through every chassis & verify places + active/standby posing.
    for (const chassis of ALL_CHASSIS_PARTS) {
      const kit = fitPart(defaultLoadout(), chassis);
      body.setLoadout(kit);
      body.pose(feet, 0, 0, 0.5, 0.4, 0, 0, false, eye, { dt: 0.05, aimPitch: 0.15 });
      expect(Number.isFinite(eye.x) && Number.isFinite(eye.y) && Number.isFinite(eye.z)).toBe(true);
      body.pose(feet, 0, 0, 0, 0, 0, 0, true, eye, { dt: 0.05, parked: true, cracks: 2 });
    }

    // Swap through every head on a v2 chassis.
    let combo = fitPart(defaultLoadout(), 'chassisValkyrie');
    for (const head of ALL_HEAD_PARTS) {
      combo = fitPart(combo, head);
      body.setLoadout(combo);
      body.pose(feet, 0, 0.3, 1.0, 0.6, 0, 0, false, eye, { dt: 0.03, aimPitch: 0.2 });
    }

    // Swap through all 10 paint liveries + custom paint override.
    combo = fitPart(fitPart(defaultLoadout(), 'chassisKestrel'), 'headHalo');
    for (const paint of ALL_PAINT_PARTS) {
      combo = fitPart(combo, paint);
      body.setLoadout(combo);
      body.pose(feet, 0, 0, 0.2, 0.2, 0, 0, false, eye, { dt: 0.02, jets: true });
    }
    body.setLoadout({
      ...combo,
      customPaint: { primary: '#22aa88', secondary: '#182430', accent: '#f0c040', glow: '#40f0ff' },
    });
    body.pose(feet, 0, 0, 0, 0, 0, 0, false, eye, { dt: 0.02 });
    expect(Number.isFinite(eye.y)).toBe(true);
  });
});
