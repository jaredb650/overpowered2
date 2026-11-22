/**
 * Chancery Estate ("Quiet Title") map verification:
 * builds the real map with Rapier physics, Kit, MapSpec, and multi-level NavGraph, verifying:
 * - Hard geometry, collider, baked-light, and LightVolume budgets
 * - Stealth exports (40+ shootable lights, 4 wing breakers, 6 CCTV cameras, 5+ alarms + Security Hub)
 * - Tier-3 destructible `bunker.door` StructuralClusterSpec
 * - Breakable glass panes on Vane's South Panoramic Window & Roof Skylight
 * - Unobstructed physics raycast sightlines from Bell-Tower Perch to Vane Window, East Loggia & Vane Desk
 * - Clean mutual multi-level NavGraph connectivity across Ground (0), Upper Bureau (6), Bell-Tower Perch (11.5), and Sub-Level (-8)
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CG } from '../../core/contracts';
import { Physics } from '../../physics/Physics';
import { canDamageTier } from '../destruction';
import { Kit } from '../kit/kit';
import { NavGraph } from '../nav';
import {
  authorChancery,
  CHANCERY_ALARMS,
  CHANCERY_BOUNDS,
  CHANCERY_BREAKERS,
  CHANCERY_CAMERAS,
  CHANCERY_HUB,
  CHANCERY_KILL_Y,
  CHANCERY_LEVELS,
  CHANCERY_LIGHT_BOUNDS,
  CHANCERY_LIGHT_CELL,
  CHANCERY_LIGHTS,
  CHANCERY_STAGES,
} from './chancery';
import { INSERTION, SECURITY_HUB_POS, SIGHTLINES } from './chancery/plan';
import { MapSpec } from './spec';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

let physics: Physics;
let kit: Kit;
let spec: MapSpec;
let nav: NavGraph;

beforeAll(async () => {
  physics = await Physics.create();
  kit = new Kit(physics);
  spec = new MapSpec();

  for (const stage of CHANCERY_STAGES) {
    stage.run(kit, spec);
  }
  authorChancery(kit, spec);
  physics.flushQueries();

  const bounds = new THREE.Box3(
    V(CHANCERY_BOUNDS.x0, CHANCERY_BOUNDS.y0, CHANCERY_BOUNDS.z0),
    V(CHANCERY_BOUNDS.x1, CHANCERY_BOUNDS.y1, CHANCERY_BOUNDS.z1),
  );
  nav = new NavGraph(physics);
  await nav.build(bounds, spec.jumpLinks, CHANCERY_HUB, async () => {}, {
    mutual: true,
    levels: CHANCERY_LEVELS,
  });
}, 120000);

const onNav = (p: THREE.Vector3, r = 1.6): boolean => {
  const out = V(0, 0, 0);
  return nav.nearest(V(p.x, p.y + 0.1, p.z), 3, out) && Math.hypot(out.x - p.x, out.z - p.z) < r && Math.abs(out.y - p.y) < 0.5;
};

const route = (from: THREE.Vector3, to: THREE.Vector3): number => {
  nav.setTarget(to);
  nav.settle();
  return nav.pathDistance(from);
};

describe('Chancery Estate map', () => {
  it('stays well inside triangle, static collider, baked-light, NavGraph, and LightVolume budgets', () => {
    const triangles = kit.geo.triangles();
    const colliders = kit.colliders;
    const bakedLights = kit.lights.length;

    console.info('chancery', JSON.stringify({
      triangles,
      colliders,
      bakedLights,
      dynamicLights: CHANCERY_LIGHTS.length,
      breakables: spec.breakables.length,
      navNodes: nav.nodeCount,
    }));

    expect(triangles).toBeGreaterThan(5_000);
    expect(triangles).toBeLessThan(400_000);
    expect(colliders).toBeLessThan(950);
    expect(bakedLights).toBeLessThan(60);
    expect(bakedLights).toBeGreaterThanOrEqual(12);

    // Exact shared coordinate contract
    expect(spec.killY).toBe(CHANCERY_KILL_Y);
    expect(CHANCERY_KILL_Y).toBe(-18);
    expect(CHANCERY_LEVELS).toEqual([-8, 0, 6, 11.5]);
    expect(CHANCERY_HUB.toArray()).toEqual([0, 0, 12]);

    // NavGraph hard Y limits: TOP_Y = 118, BOTTOM_Y = -19
    expect(CHANCERY_BOUNDS.y1).toBeLessThanOrEqual(118);
    expect(CHANCERY_BOUNDS.y0).toBeGreaterThanOrEqual(-19);

    // LightVolume hard limits: MAX_DIMS = [200, 48, 200]
    const lx = CHANCERY_LIGHT_BOUNDS.x1 - CHANCERY_LIGHT_BOUNDS.x0;
    const ly = CHANCERY_LIGHT_BOUNDS.y1 - CHANCERY_LIGHT_BOUNDS.y0;
    const lz = CHANCERY_LIGHT_BOUNDS.z1 - CHANCERY_LIGHT_BOUNDS.z0;
    expect(Math.ceil(lx / CHANCERY_LIGHT_CELL)).toBeLessThanOrEqual(200);
    expect(Math.ceil(ly / CHANCERY_LIGHT_CELL)).toBeLessThanOrEqual(48);
    expect(Math.ceil(lz / CHANCERY_LIGHT_CELL)).toBeLessThanOrEqual(200);
  });

  it('exports complete stealth lighting, wing breakers, CCTV cameras, and alarm specs', () => {
    expect(CHANCERY_LIGHTS.length).toBeGreaterThanOrEqual(40);
    expect(CHANCERY_LIGHTS.length).toBeLessThanOrEqual(52);
    const groups = new Set(CHANCERY_LIGHTS.map(l => l.group));
    expect(groups.has('west_wing')).toBe(true);
    expect(groups.has('courtyard')).toBe(true);
    expect(groups.has('east_wing')).toBe(true);
    expect(groups.has('bunker')).toBe(true);

    expect(CHANCERY_BREAKERS.length).toBeGreaterThanOrEqual(4);
    const breakerIds = new Set(CHANCERY_BREAKERS.map(b => b.id));
    expect(breakerIds.has('breaker.courtyard')).toBe(true);
    expect(breakerIds.has('breaker.west')).toBe(true);
    expect(breakerIds.has('breaker.east')).toBe(true);
    expect(breakerIds.has('breaker.bunker')).toBe(true);

    expect(CHANCERY_CAMERAS.length).toBeGreaterThanOrEqual(6);
    for (const c of CHANCERY_CAMERAS) {
      expect(c.group).toBeTruthy();
    }

    expect(CHANCERY_ALARMS.length).toBeGreaterThanOrEqual(5);
    const hub = CHANCERY_ALARMS.find(a => a.id === 'alarm.hub');
    expect(hub).toBeDefined();
    expect(hub!.isHub).toBe(true);
    expect(hub!.position).toEqual(SECURITY_HUB_POS);
  });

  it('registers the Tier-3 destructible Continuity Vault Blast Door cluster and breakable glazing', () => {
    const door = spec.destructionClusters.find(c => c.tag === 'bunker.door');
    expect(door).toBeDefined();
    expect(door!.id).toBe('bunker_door');
    expect(door!.kind).toBe('bunkerDoor');
    expect(door!.label).toBe('CONTINUITY VAULT BLAST DOOR');
    expect(door!.value).toBe(250_000);
    expect(door!.nodes).toHaveLength(4);
    for (const node of door!.nodes) {
      expect(node.tier).toBe(3);
      expect(node.hp).toBe(360);
    }
    expect(canDamageTier(3, 'breach_charge')).toBe(true);
    expect(canDamageTier(3, 'hydraulic_overload')).toBe(true);
    expect(canDamageTier(3, 'rifle')).toBe(false);

    // Breakable panes cover Vane's South Panoramic Window (z = -26) and flat Roof Skylight
    const windowPanes = spec.breakables.filter(
      b => b.kind === 'pane' && !b.flat && Math.abs(b.z - (-26)) < 0.1 && b.y > 7 && b.y < 10.5 && b.x >= -14 && b.x <= 14,
    );
    expect(windowPanes.length).toBeGreaterThanOrEqual(5);

    const skylightPanes = spec.breakables.filter(
      b => b.kind === 'pane' && b.flat === true && b.y > 11.4 && b.x >= -6 && b.x <= 6 && b.z >= -46 && b.z <= -38,
    );
    expect(skylightPanes.length).toBeGreaterThanOrEqual(4);
  });

  it('guarantees unobstructed physics raycasts from Bell-Tower Perch to Vane Window, East Loggia, and Vane Desk', () => {
    const origin = V(...SIGHTLINES.perchEye);

    const assertClearRay = (label: string, targetArr: readonly [number, number, number]) => {
      const target = V(...targetArr);
      const delta = target.clone().sub(origin);
      const dist = delta.length();
      const dir = delta.normalize();
      const hit = physics.raycast(origin, dir, dist, CG.World);
      expect(
        hit,
        `Sightline "${label}" from (${origin.toArray().join(', ')}) to (${target.toArray().join(', ')}) was blocked at ${
          hit ? `(${hit.point.x.toFixed(2)}, ${hit.point.y.toFixed(2)}, ${hit.point.z.toFixed(2)}) dist=${hit.distance.toFixed(2)}` : 'none'
        }`,
      ).toBeNull();
    };

    assertClearRay('Bell-Tower Perch -> Vane South Panoramic Window', SIGHTLINES.vaneWindow);
    assertClearRay('Bell-Tower Perch -> East Private Loggia', SIGHTLINES.eastLoggia);
    assertClearRay('Bell-Tower Perch -> Vane Executive Desk', SIGHTLINES.vaneDesk);
  });

  it('mutually connects Ground (0), Upper Bureau (6), Bell-Tower Perch (11.5), and Sub-Level (-8) to CHANCERY_HUB', () => {
    expect(nav.nodeCount).toBeGreaterThan(2000);
    expect(onNav(CHANCERY_HUB)).toBe(true);

    const checkpoints: { label: string; p: THREE.Vector3 }[] = [
      { label: 'insertion_culvert', p: V(INSERTION.x, INSERTION.y, INSERTION.z) },
      { label: 'west_garden', p: V(-44, 0, 30) },
      { label: 'guardhouse_a', p: V(-26, 0, 40) },
      { label: 'guardhouse_b', p: V(34, 0, 40) },
      { label: 'generator_house', p: V(-46, 0, 2) },
      { label: 'east_terrace', p: V(48, 0, 28) },
      { label: 'glass_conservatory', p: V(48, 0, -4) },
      { label: 'bell_tower_perch', p: V(48, 11.5, -22) },
      { label: 'grand_foyer', p: V(0, 0, -28) },
      { label: 'west_library', p: V(-18, 0, -40) },
      { label: 'east_archive', p: V(18, 0, -46) },
      { label: 'security_hub', p: V(18, 0, -34) },
      { label: 'servant_wing', p: V(-44, 0, -34) },
      { label: 'upper_bureau_south', p: V(0, 6, -34) },
      { label: 'upper_bureau_vane_desk', p: V(0, 6, -47) },
      { label: 'east_private_loggia', p: V(24, 6, -40) },
      { label: 'generator_sub_basement', p: V(-46, -8, -22) },
      { label: 'utility_tunnel_vault_foot', p: V(-38, -8, -44) },
      { label: 'guard_armory', p: V(-14, -8, -14) },
      { label: 'vault_antechamber', p: V(0, -8, -32) },
      { label: 'continuity_bunker', p: V(0, -8, -48) },
    ];

    const broken: string[] = [];
    for (const c of checkpoints) {
      if (!onNav(c.p)) {
        broken.push(`${c.label} off nav`);
        continue;
      }
      const dTo = route(c.p, CHANCERY_HUB);
      const dFrom = route(CHANCERY_HUB, c.p);
      if (!(dTo < 500)) broken.push(`${c.label} cannot reach hub (${dTo})`);
      if (!(dFrom < 500)) broken.push(`hub cannot reach ${c.label} (${dFrom})`);
    }
    expect(broken).toEqual([]);
  });
});
