/**
 * Tests for the 4 Phase 1 leg gait plug-ins (`sprinter`, `heavy`, `treads`, `spider`) on real Rapier physics
 * and all 4 procedural 3D `LegsVisual` builders across walking, kneeling, parked, collapsed, limp, and jetMode poses.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Ctx } from '../../../core/contracts';
import { wrapAngle } from '../../../core/math';
import { Physics } from '../../../physics/Physics';
import { ModelMaterials } from '../../../progression/modelkit';
import { FRAME_PLACES, StandIn } from '../../cockpit';
import { Walker, type WalkerIntent } from '../../controller';
import { FRAME } from '../../data';
import { defaultLoadout, fitPart, frameStats, type FramePartId } from '../../loadout';
import { buildHeavyLegs } from '../../models/legs-heavy';
import { buildSpiderLegs } from '../../models/legs-spider';
import { buildSprinterLegs } from '../../models/legs-sprinter';
import { buildTreadsLegs } from '../../models/legs-treads';
import type { LegsVisualBuilder } from '../../models/shared';
import { HEAVY_GAIT } from './heavy';
import { SPIDER_GAIT } from './spider';
import { SPRINTER_GAIT } from './sprinter';
import { TREADS_FLAT_MULT, TREADS_GAIT, TREADS_SLOPE_MULT } from './treads';

const DT = 1 / 60;
const DEG = Math.PI / 180;

let physics: Physics;
let placed: RAPIER.Collider[] = [];

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const h = new THREE.Vector3((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
  placed.push(physics.addStaticBox(c, h, null, 'concrete'));
  physics.flushQueries();
}

const floor = () => box(-200, -1, -200, 200, 0, 200);

const idle = (): WalkerIntent => ({ moveX: 0, moveZ: 0, viewYaw: 0, jet: false, stomp: false, charge: false });

function makeWalker(legsPart: FramePartId, x = 0, z = 0, yaw = 0): Walker {
  const stats = frameStats(fitPart(defaultLoadout(), legsPart));
  const w = new Walker(physics, 0);
  w.setMovement(stats.gait, stats.drive);
  w.place(new THREE.Vector3(x, 0.5, z), yaw);
  w.speedScale = stats.walk;
  w.jumpScale = stats.jump;
  w.dashScale = stats.dash;
  w.strafeScale = stats.strafe;
  w.turnScale = stats.turnRate;
  w.fuelScale = stats.fuelScale;
  return w;
}

function run(w: Walker, seconds: number, intent: WalkerIntent, each?: (t: number) => void): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    w.update(DT, intent);
    intent.stomp = intent.charge = false;
    each?.(t + DT);
  }
}

beforeAll(async () => {
  physics = await Physics.create();
});

afterEach(() => {
  for (const c of placed) physics.world.removeCollider(c, false);
  placed = [];
  physics.flushQueries();
});

describe('Sprinter gait', () => {
  it('accelerates faster, turns legs quicker, and reaches ×1.30 top walk speed', () => {
    floor();
    const std = makeWalker('legsStandard');
    const spr = makeWalker('legsSprinter');
    expect(SPRINTER_GAIT.stepHeight).toBe(FRAME.body.step);
    expect(SPRINTER_GAIT.minWalkY).toBe(FRAME.body.minWalkY);

    // After 0.5 s of forward walk, Sprinter is well ahead of Standard.
    run(std, 0.5, { ...idle(), moveZ: 1 });
    run(spr, 0.5, { ...idle(), moveZ: 1 });
    expect(spr.speed).toBeGreaterThan(std.speed * 1.4);

    // At top speed, Sprinter hits 7 * 1.30 = 9.1 m/s.
    run(spr, 1.5, { ...idle(), moveZ: 1 });
    expect(spr.speed).toBeCloseTo(FRAME.walk.forward * 1.3, 1);

    // Quicker leg turning past the 80° arc.
    const stdTurn = makeWalker('legsStandard');
    const sprTurn = makeWalker('legsSprinter');
    for (let i = 0; i < 30; i++) {
      stdTurn.update(DT, { ...idle(), viewYaw: stdTurn.viewYaw + 20 * DEG });
      sprTurn.update(DT, { ...idle(), viewYaw: sprTurn.viewYaw + 20 * DEG });
    }
    expect(sprTurn.legYaw).toBeGreaterThan(stdTurn.legYaw * 1.25);
  });
});

describe('Pile-Driver (heavy) gait', () => {
  it('ramps up and turns more deliberately than Standard, capping at ×0.75 walk speed', () => {
    floor();
    const std = makeWalker('legsStandard');
    const hvy = makeWalker('legsHeavy');
    expect(HEAVY_GAIT.stepHeight).toBe(FRAME.body.step);
    expect(HEAVY_GAIT.minWalkY).toBe(FRAME.body.minWalkY);

    run(std, 0.5, { ...idle(), moveZ: 1 });
    run(hvy, 0.5, { ...idle(), moveZ: 1 });
    expect(hvy.speed).toBeLessThan(std.speed * 0.8);

    run(hvy, 2.0, { ...idle(), moveZ: 1 });
    expect(hvy.speed).toBeCloseTo(FRAME.walk.forward * 0.75, 1);

    const stdTurn = makeWalker('legsStandard');
    const hvyTurn = makeWalker('legsHeavy');
    for (let i = 0; i < 30; i++) {
      stdTurn.update(DT, { ...idle(), viewYaw: stdTurn.viewYaw + 20 * DEG });
      hvyTurn.update(DT, { ...idle(), viewYaw: hvyTurn.viewYaw + 20 * DEG });
    }
    expect(hvyTurn.legYaw).toBeLessThan(stdTurn.legYaw * 0.9);
  });
});

describe('Treads gait', () => {
  it('disables stride surge, runs ×1.25 on flat ground and slows to ×0.6 on slopes', () => {
    floor();
    expect(TREADS_GAIT.noSurge).toBe(true);

    // Flat ground: top speed = 7 * 1.25 = 8.75 m/s.
    const flat = makeWalker('legsTreads');
    run(flat, 2.0, { ...idle(), moveZ: 1 });
    expect(flat.speed).toBeCloseTo(FRAME.walk.forward * TREADS_FLAT_MULT, 1);

    // Build a long 22° ramp sloping up toward -Z (normal.y = cos(22°) ≈ 0.927 < 0.96).
    const slopeAngle = 22 * DEG;
    const rampQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), slopeAngle);
    placed.push(physics.addStaticBox(new THREE.Vector3(0, 6, -20), new THREE.Vector3(8, 0.3, 24), rampQuat, 'concrete'));
    physics.flushQueries();

    const climber = makeWalker('legsTreads', 0, -14);
    // Start standing directly on the ramp surface.
    climber.feet.set(0, 4.5, -14);
    climber.grounded = false;
    run(climber, 0.4, idle());
    expect(climber.grounded).toBe(true);
    run(climber, 2.5, { ...idle(), moveZ: 1 });
    expect(climber.speed).toBeCloseTo(FRAME.walk.forward * TREADS_SLOPE_MULT, 1);
    expect(flat.speed / climber.speed).toBeCloseTo(TREADS_FLAT_MULT / TREADS_SLOPE_MULT, 1);
  });

  it('turns hull at ×0.5 standard rate while torso aims freely, suppresses stomp, and blocks standard jet hop', () => {
    floor();
    const std = makeWalker('legsStandard');
    const trd = makeWalker('legsTreads');

    // Aim 140° left: Treads viewYaw tracks freely while hull turns at exactly ×0.5 standard rate (70°/s vs 140°/s).
    const targetYaw = 140 * DEG;
    for (let i = 0; i < 30; i++) {
      std.update(DT, { ...idle(), viewYaw: std.legYaw + targetYaw });
      trd.update(DT, { ...idle(), viewYaw: targetYaw });
    }
    expect(wrapAngle(trd.viewYaw - targetYaw)).toBeCloseTo(0, 5);
    expect(trd.legYaw).toBeCloseTo(0.5 * FRAME.turn.rate * 0.5, 4);
    expect(trd.legYaw).toBeCloseTo(std.legYaw * 0.5, 4);

    // Even if `turnScale` is left at 1 (standalone Walker), Treads still caps hull turn at ×0.5.
    const standalone = new Walker(physics, 0);
    standalone.setMovement('treads', 'jets');
    standalone.place(new THREE.Vector3(0, 0.5, 0), 0);
    for (let i = 0; i < 30; i++) standalone.update(DT, { ...idle(), viewYaw: targetYaw });
    expect(standalone.legYaw).toBeCloseTo(std.legYaw * 0.5, 4);

    // Standard jets cannot launch Treads off the ground (`jumpScale === 0`).
    run(trd, 0.5, { ...idle(), jet: true });
    expect(trd.grounded).toBe(true);
    expect(trd.said.lifted).toBe(false);

    // Mid-air stomp is suppressed (`startStomp` returns true without setting `stomping`).
    trd.feet.y = 8;
    trd.grounded = false;
    trd.velocity.y = 0;
    trd.update(DT, { ...idle(), stomp: true });
    expect(trd.stomping).toBe(false);
    expect(trd.said.stomped).toBe(-1);
  });
});

describe('Spider gait', () => {
  it('has 2.2 m stepHeight, climbs 2.2 m ledges & 45° slopes, strafes fast, and triggers leg sweep on stomp', () => {
    floor();
    expect(SPIDER_GAIT.stepHeight).toBe(2.2);
    expect(SPIDER_GAIT.minWalkY).toBeLessThanOrEqual(0.71);
    expect(SPIDER_GAIT.minWalkY).toBeGreaterThan(0.69);
    expect(SPIDER_GAIT.legSweepOnStomp).toBe(true);

    // 2.2 m tall ledge: Spider climbs right onto it, while Standard is blocked.
    box(-4, 0, -14, 4, 2.2, -8);
    const sp = makeWalker('legsSpider', 0, -4);
    const st = makeWalker('legsStandard', 0, -4);
    let spTop = 0;
    let stTop = 0;
    run(sp, 2.0, { ...idle(), moveZ: 1 }, () => { spTop = Math.max(spTop, sp.feet.y); });
    run(st, 2.0, { ...idle(), moveZ: 1 }, () => { stTop = Math.max(stTop, st.feet.y); });
    expect(spTop).toBeCloseTo(2.2, 2);
    expect(stTop).toBeLessThan(0.5);

    // Fast omnidirectional strafe: 5 * 1.4 = 7.0 m/s sideways.
    const strafer = makeWalker('legsSpider', 20, 0);
    run(strafer, 1.5, { ...idle(), moveX: 1 });
    expect(strafer.speed).toBeCloseTo(FRAME.walk.side * 1.4, 1);

    // 45° ramp climb.
    const ramp45 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 45 * DEG);
    placed.push(physics.addStaticBox(new THREE.Vector3(-30, 5, -15), new THREE.Vector3(6, 0.3, 12), ramp45, 'concrete'));
    physics.flushQueries();
    const climber = makeWalker('legsSpider', -30, -9);
    climber.feet.set(-30, 3.0, -9);
    climber.grounded = false;
    run(climber, 0.5, idle());
    expect(climber.grounded).toBe(true);
    const startY = climber.feet.y;
    run(climber, 1.0, { ...idle(), moveZ: 1 });
    expect(climber.feet.y).toBeGreaterThan(startY + 1.5);
    expect(climber.grounded).toBe(true);

    // Stomp press triggers 360° leg sweep instead of vertical stomp, with cooldown preventing spam.
    strafer.update(DT, { ...idle(), stomp: true });
    expect(strafer.said.swept).toBe(true);
    expect(strafer.stomping).toBe(false);
    strafer.update(DT, { ...idle(), stomp: true });
    expect(strafer.said.swept).toBe(false);
  });
});

describe('4 sculpted 3D LegsVisual builders', () => {
  const ctxStub = {
    render: { materials: { patch: (m: THREE.Material) => m } },
  } as unknown as Ctx;

  const builders: readonly (readonly [string, LegsVisualBuilder])[] = [
    ['sprinter', buildSprinterLegs],
    ['heavy', buildHeavyLegs],
    ['treads', buildTreadsLegs],
    ['spider', buildSpiderLegs],
  ];

  const poses: readonly (readonly [string, Parameters<ReturnType<LegsVisualBuilder>['pose']>])[] = [
    ['standing', [0, 0, 0, 0, 0, 0, false, false]],
    ['walking-a', [0.35, 1, -0.06, 0, 0, 0, false, false]],
    ['walking-b', [1.45, 0.85, -0.04, 0, 0, 0, false, false]],
    ['limp-left', [0.7, 0.8, -0.08, 0, 0, -1, false, false]],
    ['limp-right', [1.7, 0.8, -0.08, 0, 0, 1, false, false]],
    ['kneeling', [0, 0, -1.35, 1, 0, 0, false, false]],
    ['parked', [0, 0, -0.42, 0, 0, 0, true, false]],
    ['collapsed', [0, 0, -2.3, 0, 1, 0, true, false]],
    ['jetMode', [2.5, 0, 0, 0, 0, 0, false, true]],
  ];

  function assertAllFinite(root: THREE.Object3D): number {
    root.updateMatrixWorld(true);
    let meshes = 0;
    root.traverse(obj => {
      for (const v of [
        obj.position.x, obj.position.y, obj.position.z,
        obj.rotation.x, obj.rotation.y, obj.rotation.z,
        obj.scale.x, obj.scale.y, obj.scale.z,
      ]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      for (const m of obj.matrixWorld.elements) {
        expect(Number.isFinite(m)).toBe(true);
      }
      if (obj instanceof THREE.Mesh) {
        meshes++;
        const pos = obj.geometry.getAttribute('position');
        expect(pos.count).toBeGreaterThan(0);
      }
    });
    return meshes;
  }

  for (const [name, build] of builders) {
    it(`${name} builds valid 3D geometry resting near y=0..hipsY and poses cleanly in all states`, () => {
      const materials = new ModelMaterials(ctxStub);
      const visual = build(materials, FRAME_PLACES.hips);
      expect(visual).not.toBeNull();

      // Standing neutral pose: verify bounding box sits cleanly on the ground and reaches the waist ring.
      visual.pose(0, 0, 0, 0, 0, 0, false, false);
      const meshCount = assertAllFinite(visual.group);
      expect(meshCount).toBeGreaterThanOrEqual(2);

      const bounds = new THREE.Box3().setFromObject(visual.group);
      expect(bounds.min.y).toBeGreaterThan(-0.25);
      expect(bounds.min.y).toBeLessThan(0.25);
      expect(bounds.max.y).toBeGreaterThan(FRAME_PLACES.hips - 0.3);

      // Exercise every animation state without NaN or throwing.
      for (const [_label, args] of poses) {
        visual.pose(...args);
        assertAllFinite(visual.group);
      }
    });
  }

  it('Treads road wheels rotate continuously as stride advances', () => {
    const materials = new ModelMaterials(ctxStub);
    const treads = buildTreadsLegs(materials, FRAME_PLACES.hips);
    treads.pose(0, 1, 0, 0, 0, 0, false, false);
    const before: number[] = [];
    treads.group.traverse(o => { if (o instanceof THREE.Group && o.children.length > 0) before.push(o.rotation.x); });
    treads.pose(2.0, 1, 0, 0, 0, 0, false, false);
    const after: number[] = [];
    treads.group.traverse(o => { if (o instanceof THREE.Group && o.children.length > 0) after.push(o.rotation.x); });
    const changed = after.filter((v, i) => Math.abs(v - before[i]!) > 0.5).length;
    expect(changed).toBeGreaterThanOrEqual(10);
  });

  it('StandIn mounts and poses all 4 custom leg models cleanly across loadout swaps', () => {
    const scene = new THREE.Scene();
    const materials = new ModelMaterials(ctxStub);
    const stand = new StandIn(materials, scene);
    const feet = new THREE.Vector3(0, 0, 0);
    const eye = new THREE.Vector3();
    for (const part of ['legsStandard', 'legsSprinter', 'legsHeavy', 'legsTreads', 'legsSpider'] as const) {
      stand.setLoadout(fitPart(defaultLoadout(), part));
      stand.pose(feet, 0, 0.2, 1.25, 0.9, -0.05, 0.03, false, eye, { parked: false, jetMode: false });
      assertAllFinite(stand.legs);
      stand.pose(feet, 0, 0.2, 2.0, 0, 0, 0, false, eye, { parked: false, jetMode: true });
      assertAllFinite(stand.legs);
    }
  });
});
