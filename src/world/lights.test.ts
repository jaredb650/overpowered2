/**
 * Unit tests for DynamicLightPool (persistent fixture channel), ShootableLights, and BreakerSystem.
 * Runs against real Rapier physics and real THREE scenes.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../core/contracts';
import { noop } from '../core/stubs';
import { Physics } from '../physics/Physics';
import { DynamicLightPool, MAX_LIVE_LIGHTS } from '../render/DynamicLightPool';
import { ShootableLights, type LightFixtureKind } from './lights';
import { BreakerSystem, type BreakerTripMode, type BreakerSpec } from './breakers';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

let physics: Physics;

beforeAll(async () => {
  physics = await Physics.create();
}, 30000);

function makeCtx(pool?: DynamicLightPool, overrides?: {
  audioPlay?: ReturnType<typeof vi.fn>;
  fxSparks?: ReturnType<typeof vi.fn>;
  fxArc?: ReturnType<typeof vi.fn>;
}) {
  const scene = new THREE.Scene();
  const viewScene = new THREE.Scene();
  const lightsPool = pool ?? new DynamicLightPool(scene, viewScene);
  const audioPlay = overrides?.audioPlay ?? vi.fn();
  const fxSparks = overrides?.fxSparks ?? vi.fn();
  const fxArc = overrides?.fxArc ?? vi.fn();
  const ctx = {
    physics,
    render: {
      ...noop('render'),
      scene,
      viewScene,
      lights: lightsPool,
      materials: {
        patch: <T extends THREE.MeshStandardMaterial>(m: T) => m,
      },
    },
    fx: {
      ...noop('fx'),
      sparks: fxSparks,
      arc: fxArc,
      impact: vi.fn(),
      smoke: vi.fn(),
    },
    audio: {
      ...noop('audio'),
      play: audioPlay,
    },
  } as unknown as Ctx;
  return { ctx, scene, viewScene, lightsPool, audioPlay, fxSparks, fxArc };
}

describe('DynamicLightPool persistent fixture channel', () => {
  it('activates only the 8 closest/brightest out of 16 fixtures and promotes the 9th when one is disabled', () => {
    const scene = new THREE.Scene();
    const viewScene = new THREE.Scene();
    const pool = new DynamicLightPool(scene, viewScene);
    const ids: number[] = [];

    // Place 16 equal-brightness fixtures along +X at x = 2, 4, 6, ..., 32
    for (let i = 0; i < 16; i++) {
      ids.push(pool.addFixture({
        position: V((i + 1) * 2, 2, 0),
        color: 0xffd2a0,
        intensity: 20,
        radius: 10,
      }));
    }

    pool.update(1 / 60, V(0, 2, 0));

    const live = pool.getLiveLights();
    expect(live).toHaveLength(MAX_LIVE_LIGHTS);
    const activeXs = live.filter(l => l.intensity > 0).map(l => l.position.x).sort((a, b) => a - b);
    expect(activeXs).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);

    // Disable the closest fixture (x = 2); the 9th fixture (x = 18) must be promoted into the live 8.
    pool.setFixtureEnabled(ids[0]!, false);
    pool.update(1 / 60, V(0, 2, 0));

    const promotedXs = live.filter(l => l.intensity > 0).map(l => l.position.x).sort((a, b) => a - b);
    expect(promotedXs).toEqual([4, 6, 8, 10, 12, 14, 16, 18]);

    // Boosting the 16th fixture (x = 32) dramatically promotes it into the live set.
    pool.setFixtureIntensity(ids[15]!, 800);
    pool.update(1 / 60, V(0, 2, 0));
    const boostedXs = live.filter(l => l.intensity > 0).map(l => l.position.x);
    expect(boostedXs).toContain(32);

    // Removing it drops it out again.
    pool.removeFixture(ids[15]!);
    pool.update(1 / 60, V(0, 2, 0));
    expect(live.filter(l => l.intensity > 0).map(l => l.position.x)).not.toContain(32);

    // clearFixtures removes all persistent lights.
    pool.clearFixtures();
    pool.update(1 / 60, V(0, 2, 0));
    expect(live.filter(l => l.intensity > 0)).toHaveLength(0);
  });

  it('coexists with transient flashes without exceeding MAX_LIVE_LIGHTS = 8 and stays compatible with camera updates', () => {
    const scene = new THREE.Scene();
    const viewScene = new THREE.Scene();
    const pool = new DynamicLightPool(scene, viewScene);

    for (let i = 0; i < 10; i++) {
      pool.addFixture({
        position: V(4 + i * 2, 2, 0),
        color: 0xffe0b0,
        intensity: 16,
        radius: 9,
      });
    }

    // Fire a bright close transient muzzle flash right in front of the camera.
    pool.flash(V(0, 2, -1), 0xff8833, 45, 8, 0.1);

    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 2, 0);
    cam.updateMatrixWorld();
    const viewCam = new THREE.PerspectiveCamera();
    viewCam.updateMatrixWorld();

    pool.update(0.016, cam, viewCam);

    const live = pool.getLiveLights();
    expect(live).toHaveLength(MAX_LIVE_LIGHTS);
    const active = live.filter(l => l.intensity > 0);
    expect(active).toHaveLength(MAX_LIVE_LIGHTS);
    // Transient flash at z = -1 must claim a slot.
    expect(active.some(l => Math.abs(l.position.z + 1) < 0.01)).toBe(true);

    // After flash expires (calling update(dt) without camera reuses last camera pos), all 8 slots return to fixtures.
    pool.update(0.2);
    const afterXs = live.filter(l => l.intensity > 0).map(l => l.position.x).sort((a, b) => a - b);
    expect(afterXs).toEqual([4, 6, 8, 10, 12, 14, 16, 18]);
  });
});

describe('ShootableLights', () => {
  it('computes near-ambient in darkness, high illumination under a live floodlight, drops after shatter, and toggles on setGroupPower', () => {
    const { ctx, audioPlay, fxSparks } = makeCtx();
    const brokenEvents: { id: string; group: string | undefined; pos: THREE.Vector3 }[] = [];
    const lights = new ShootableLights(ctx, {
      onBroken: (pos, id, group) => brokenEvents.push({ id, group, pos: pos.clone() }),
    });

    const floodPos = V(40, 4.0, 0);
    const probeUnderFlood = V(40, 1.2, 0);
    const probeInDarkness = V(-90, 1.2, -90);

    // Darkness baseline before any nearby lights
    expect(lights.lightAt(probeInDarkness)).toBeCloseTo(0.06, 4);

    // Add a floodlight and a sconce in the same circuit group
    lights.add({
      id: 'yard_flood',
      position: [floodPos.x, floodPos.y, floodPos.z],
      color: 0xdcecff,
      intensity: 42,
      radius: 14,
      kind: 'floodlight',
      group: 'courtyard',
      yaw: 0,
    });
    lights.add({
      id: 'yard_sconce',
      position: [48, 2.5, 0],
      color: 0xffc988,
      intensity: 14,
      radius: 8,
      kind: 'sconce',
      group: 'courtyard',
    });
    physics.flushQueries();

    expect(lights.isLit('yard_flood')).toBe(true);
    expect(lights.isLit('yard_sconce')).toBe(true);
    expect(lights.brokenCount()).toBe(0);
    expect(lights.thermalMeshes()).toHaveLength(2);

    // Live floodlight illuminates the ground beneath it brightly (> 0.7), while far point stays ~0.06
    expect(lights.lightAt(probeUnderFlood)).toBeGreaterThan(0.7);
    expect(lights.lightAt(probeInDarkness)).toBeCloseTo(0.06, 4);

    // Circuit power off extinguishes intact fixtures cleanly
    lights.setGroupPower('courtyard', false);
    expect(lights.isLit('yard_flood')).toBe(false);
    expect(lights.isLit('yard_sconce')).toBe(false);
    expect(lights.lightAt(probeUnderFlood)).toBeCloseTo(0.06, 4);
    expect(lights.thermalMeshes()).toHaveLength(0);

    // Restoring circuit power brings intact fixtures back on
    lights.setGroupPower('courtyard', true);
    expect(lights.isLit('yard_flood')).toBe(true);
    expect(lights.lightAt(probeUnderFlood)).toBeGreaterThan(0.7);
    expect(lights.thermalMeshes()).toHaveLength(2);

    // Shoot the floodlight via Rapier raycast
    const hit = physics.raycast(V(40, 4.0, 3), V(0, 0, -1), 6);
    expect(hit).not.toBeNull();
    expect(hit!.surface).toBe('glass');

    const shattered = lights.damageCollider(hit!.collider, hit!.point);
    expect(shattered).toBe(true);
    expect(lights.isLit('yard_flood')).toBe(false);
    expect(lights.isShattered('yard_flood')).toBe(true);
    expect(lights.brokenCount()).toBe(1);
    expect(lights.thermalMeshes()).toHaveLength(1);
    expect(brokenEvents).toHaveLength(1);
    expect(brokenEvents[0]!.id).toBe('yard_flood');
    expect(brokenEvents[0]!.group).toBe('courtyard');
    expect(fxSparks).toHaveBeenCalled();
    expect(audioPlay).toHaveBeenCalledWith('glass_break', expect.any(Object));

    // Illumination directly under the shattered floodlight drops back to near-ambient
    expect(lights.lightAt(probeUnderFlood)).toBeCloseTo(0.06, 4);

    // Cycling circuit power must NOT revive a shattered fixture
    lights.setGroupPower('courtyard', false);
    lights.setGroupPower('courtyard', true);
    expect(lights.isLit('yard_flood')).toBe(false);
    expect(lights.isLit('yard_sconce')).toBe(true);
    expect(lights.lightAt(probeUnderFlood)).toBeCloseTo(0.06, 4);

    // Mission reset restores intact lit state
    lights.reset();
    physics.flushQueries();
    expect(lights.brokenCount()).toBe(0);
    expect(lights.isLit('yard_flood')).toBe(true);
    expect(lights.lightAt(probeUnderFlood)).toBeGreaterThan(0.7);

    lights.dispose();
  });

  it('builds all five fixture kinds and respects wall occlusion when raycastOcclusion is enabled', () => {
    const { ctx } = makeCtx();
    const lights = new ShootableLights(ctx);
    const kinds: LightFixtureKind[] = ['sconce', 'lamp', 'chandelier', 'floodlight', 'desk'];

    kinds.forEach((kind, idx) => {
      lights.add({
        id: `kind_${kind}`,
        position: [80 + idx * 12, 3, 20],
        color: 0xffe4b8,
        intensity: 24,
        radius: 10,
        kind,
      });
    });

    // Place a solid concrete wall between the floodlight (x = 116, z = 20) and a shadow probe (x = 116, z = 24)
    const wall = physics.addStaticBox(V(116, 2.5, 22), V(4, 3, 0.25), null, 'concrete');
    physics.flushQueries();

    const behindWall = V(116, 1.5, 24);
    const inFront = V(116, 1.5, 18);

    // Without occlusion check, light bleeds through the wall
    expect(lights.lightAt(behindWall, 0.06, false)).toBeGreaterThan(0.4);
    // With occlusion check, the wall blocks it completely while unoccluded side stays lit (no self-occlusion)
    expect(lights.lightAt(behindWall, 0.06, true)).toBeCloseTo(0.06, 4);
    expect(lights.lightAt(inFront, 0.06, true)).toBeGreaterThan(0.6);

    physics.world.removeCollider(wall, false);
    lights.dispose();
  });
});

describe('BreakerSystem', () => {
  it('silent interact() trips circuit lights and invokes manual; shooting invokes shot and prevents re-enabling', () => {
    const { ctx, audioPlay, fxSparks, fxArc } = makeCtx();
    const lights = new ShootableLights(ctx);

    lights.add({
      id: 'west_sconce',
      position: [-40, 3, 10],
      color: 0xffd090,
      intensity: 20,
      radius: 10,
      kind: 'sconce',
      group: 'west_wing',
    });
    lights.add({
      id: 'east_flood',
      position: [-20, 4, 10],
      color: 0xdceeff,
      intensity: 36,
      radius: 14,
      kind: 'floodlight',
      group: 'east_wing',
    });

    const trips: { spec: BreakerSpec; mode: BreakerTripMode }[] = [];
    const breakers = new BreakerSystem(ctx, {
      lights,
      onTrip: (spec, mode) => trips.push({ spec, mode }),
    });

    breakers.add({
      id: 'brk_west',
      label: 'West Wing Breaker',
      group: 'west_wing',
      position: [-45, 1.5, 10],
      yaw: 0,
    });
    breakers.add({
      id: 'brk_east',
      label: 'East Wing Breaker',
      group: 'east_wing',
      position: [-25, 1.5, 10],
      yaw: 0,
    });
    physics.flushQueries();

    // Both breakers start powered and warm in thermal vision
    expect(breakers.isPowered('west_wing')).toBe(true);
    expect(breakers.isPowered('east_wing')).toBe(true);
    expect(breakers.thermalMeshes()).toHaveLength(2);

    // Nearest interactable finds West Wing breaker within 2.4m
    expect(breakers.nearestInteractable(V(-45, 1.5, 11.5), 2.4)?.id).toBe('brk_west');
    expect(breakers.nearestInteractable(V(-45, 1.5, 16), 2.4)).toBeNull();

    // 1) Silent manual flip on West Wing breaker
    expect(breakers.interact('brk_west')).toBe(true);
    expect(breakers.isPowered('west_wing')).toBe(false);
    expect(lights.isLit('west_sconce')).toBe(false);
    expect(lights.isLit('east_flood')).toBe(true);
    expect(breakers.thermalMeshes()).toHaveLength(1);
    expect(trips).toHaveLength(1);
    expect(trips[0]!.spec.id).toBe('brk_west');
    expect(trips[0]!.mode).toBe('manual');

    // Manual flip can be re-enabled (not shorted)
    expect(breakers.restore('brk_west')).toBe(true);
    expect(breakers.isPowered('west_wing')).toBe(true);
    expect(lights.isLit('west_sconce')).toBe(true);

    // 2) Shoot East Wing breaker cabinet to permanently short it
    const shotHit = physics.raycast(V(-25, 1.5, 12), V(0, 0, -1), 5);
    expect(shotHit).not.toBeNull();
    expect(shotHit!.surface).toBe('metal');
    expect(breakers.isBreakerCollider(shotHit!.collider)).toBe(true);

    expect(breakers.damageCollider(shotHit!.collider, shotHit!.point)).toBe(true);
    expect(breakers.isPowered('east_wing')).toBe(false);
    expect(breakers.isShorted('brk_east')).toBe(true);
    expect(lights.isLit('east_flood')).toBe(false);
    expect(trips).toHaveLength(2);
    expect(trips[1]!.spec.id).toBe('brk_east');
    expect(trips[1]!.mode).toBe('shot');
    expect(fxSparks).toHaveBeenCalled();
    expect(fxArc).toHaveBeenCalled();
    expect(audioPlay).toHaveBeenCalledWith('electric_zap', expect.any(Object));

    // Shooting permanently prevents re-enabling
    expect(breakers.restore('brk_east')).toBe(false);
    expect(breakers.setPowered('brk_east', true)).toBe(false);
    expect(breakers.isPowered('east_wing')).toBe(false);
    expect(lights.isLit('east_flood')).toBe(false);

    // Duplicate shot does not re-trigger onTrip
    expect(breakers.damageCollider(shotHit!.collider, shotHit!.point)).toBe(false);
    expect(trips).toHaveLength(2);

    // Mission reset restores shorted breakers and lights
    breakers.reset();
    expect(breakers.isPowered('east_wing')).toBe(true);
    expect(breakers.isShorted('brk_east')).toBe(false);
    expect(lights.isLit('east_flood')).toBe(true);
    expect(breakers.thermalMeshes()).toHaveLength(2);

    breakers.dispose();
    lights.dispose();
  });
});
