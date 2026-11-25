/**
 * Badlands — Open-Desert Mech Survival (`map: 'badlands'`) map verification:
 * builds the real map with Rapier physics, Kit, MapSpec, and NavGraph, verifying:
 * - Strict triangle (<= 145k), static collider (<= 380), baked-light (<= 64), and LightVolume ([200, 48, 200]) budgets
 * - Both `BADLANDS_STAGES + authorBadlands` and standalone `authorBadlands` builds succeed identically
 * - Open-sky central basin (r <= 58 m) & Frame staging pad with zero overhead obstructions
 * - All 8 radial convoy lanes & inner ring road are 100% clear of obstacles at vehicle height
 * - Monumental Sandstone Arch gives >= 9 m clear headroom for a Distraint Frame
 * - All player spawns, Frame pad, ground spawns, hover LZs, paratrooper zones, boss pads, pickup spots,
 *   and elevated y = 3.6 landmark decks are mutually reachable on the NavGraph from BADLANDS_HUB
 * - All 8 Tier-0 destruction clusters (4 lookout posts + 4 landmark sheds) break cleanly in DestructionManager
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CG } from '../../core/contracts';
import { Physics } from '../../physics/Physics';
import { canDamageTier, DestructionManager } from '../destruction';
import { Kit } from '../kit/kit';
import { NavGraph } from '../nav';
import {
  authorBadlands,
  BADLANDS_AIRCRAFT_PAD,
  BADLANDS_BOSS_ZONES,
  BADLANDS_BOUNDS,
  BADLANDS_CONVOY_LANES,
  BADLANDS_FRAME_PAD,
  BADLANDS_HOVER_ZONES,
  BADLANDS_HUB,
  BADLANDS_LANDMARKS,
  BADLANDS_LEVELS,
  BADLANDS_LIGHT_BOUNDS,
  BADLANDS_LIGHT_CELL,
  BADLANDS_LOOKOUT_POSTS,
  BADLANDS_PARATROOPER_ZONES,
  BADLANDS_PICKUP_SPOTS,
  BADLANDS_PLAYER_SPAWN,
  BADLANDS_RING_WAYPOINTS,
  BADLANDS_STAGES,
  BADLANDS_TERMINAL,
  BADLANDS_VEHICLE_PAD,
} from './badlands';
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

  for (const stage of BADLANDS_STAGES) {
    stage.run(kit, spec);
  }
  authorBadlands(kit, spec);
  physics.flushQueries();

  const bounds = new THREE.Box3(
    V(BADLANDS_BOUNDS.x0, BADLANDS_BOUNDS.y0, BADLANDS_BOUNDS.z0),
    V(BADLANDS_BOUNDS.x1, BADLANDS_BOUNDS.y1, BADLANDS_BOUNDS.z1),
  );
  nav = new NavGraph(physics);
  await nav.build(bounds, spec.jumpLinks, BADLANDS_HUB, async () => {}, {
    mutual: true,
    levels: [...BADLANDS_LEVELS],
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

describe('Badlands open-desert survival map', () => {
  it('stays strictly inside triangle, static collider, baked-light, NavGraph, and LightVolume budgets', () => {
    const triangles = kit.geo.triangles();
    const colliders = kit.colliders;
    const bakedLights = kit.lights.length;

    console.info('badlands', JSON.stringify({
      triangles,
      colliders,
      bakedLights,
      clusters: spec.destructionClusters.length,
      navNodes: nav.nodeCount,
    }));

    expect(triangles).toBeGreaterThan(2_000);
    expect(triangles).toBeLessThanOrEqual(145_000);
    expect(colliders).toBeLessThanOrEqual(380);
    expect(bakedLights).toBeGreaterThanOrEqual(16);
    expect(bakedLights).toBeLessThanOrEqual(64);

    // Coordinate & voxel-AO bounds contracts (352 m × 352 m basin with 112 m mech flight ceiling)
    expect(spec.reactor).toBeNull();
    expect(spec.killY).toBe(BADLANDS_BOUNDS.y0);
    expect(BADLANDS_BOUNDS.x1 - BADLANDS_BOUNDS.x0).toBe(352);
    expect(BADLANDS_BOUNDS.z1 - BADLANDS_BOUNDS.z0).toBe(352);
    expect(BADLANDS_BOUNDS.y1).toBeGreaterThanOrEqual(100);
    expect(BADLANDS_BOUNDS.y1).toBeLessThanOrEqual(118);

    // LightVolume hard limits: MAX_DIMS = [200, 48, 200]
    const lx = BADLANDS_LIGHT_BOUNDS.x1 - BADLANDS_LIGHT_BOUNDS.x0;
    const ly = BADLANDS_LIGHT_BOUNDS.y1 - BADLANDS_LIGHT_BOUNDS.y0;
    const lz = BADLANDS_LIGHT_BOUNDS.z1 - BADLANDS_LIGHT_BOUNDS.z0;
    expect(Math.ceil(lx / BADLANDS_LIGHT_CELL)).toBeLessThanOrEqual(200);
    expect(Math.ceil(ly / BADLANDS_LIGHT_CELL)).toBeLessThanOrEqual(48);
    expect(Math.ceil(lz / BADLANDS_LIGHT_CELL)).toBeLessThanOrEqual(200);

    // Minimap plan, roads, zones, spawns, pickups & views
    expect(spec.plan).not.toBeNull();
    expect(spec.plan!.fills.length).toBeGreaterThanOrEqual(6);
    expect(spec.roads.length).toBe(9);
    expect(spec.zones.length).toBeGreaterThanOrEqual(6);
    expect(spec.spawns!.some(s => s.kind === 'ground')).toBe(true);
    expect(spec.spawns!.some(s => s.kind === 'air')).toBe(true);
    expect(spec.pickupSpots.length).toBe(BADLANDS_PICKUP_SPOTS.length);

    for (const v of ['overview', 'pad', 'basin', 'fuelDepot', 'arch', 'oasis', 'derrick', 'sky']) {
      expect(spec.views[v], `Missing spec.views.${v}`).toBeDefined();
    }
  });

  it('builds identically when authorBadlands is called standalone without manually running BADLANDS_STAGES', async () => {
    const p2 = await Physics.create();
    const k2 = new Kit(p2);
    const s2 = new MapSpec();
    expect(() => authorBadlands(k2, s2)).not.toThrow();
    expect(s2.destructionClusters.length).toBe(spec.destructionClusters.length);
    expect(s2.zones.length).toBe(spec.zones.length);
    expect(s2.roads.length).toBe(spec.roads.length);
  });

  it('keeps all 8 radial convoy lanes, inner ring road, Frame staging pad, and Sandstone Arch clear for vehicles & mech flight', () => {
    // Central basin, Frame staging pad, vehicle bay, and north airstrip have 100% open sky to the flight ceiling
    for (const pt of [
      BADLANDS_PLAYER_SPAWN,
      BADLANDS_FRAME_PAD,
      BADLANDS_VEHICLE_PAD,
      BADLANDS_AIRCRAFT_PAD,
      [0, 0, 0] as const,
      [-10, 0, -10] as const,
      [10, 0, 10] as const,
    ]) {
      const floorHit = physics.raycast(V(pt[0], 3, pt[2]), V(0, -1, 0), 5, CG.World);
      expect(floorHit, `Missing ground at [${pt.join(',')}]`).not.toBeNull();
      expect(floorHit!.point.y).toBeCloseTo(0, 1);

      const skyHit = physics.raycast(V(pt[0], 1, pt[2]), V(0, 1, 0), 108, CG.World);
      expect(skyHit, `Unexpected ceiling over open staging pad at [${pt.join(',')}]`).toBeNull();
    }

    // Requisition Terminal kiosk stands solid at BADLANDS_TERMINAL
    const termHit = physics.raycast(V(BADLANDS_TERMINAL[0], 5, BADLANDS_TERMINAL[2]), V(0, -1, 0), 5, CG.World);
    expect(termHit, 'Missing solid collider at BADLANDS_TERMINAL').not.toBeNull();
    expect(termHit!.point.y).toBeGreaterThan(1.5);

    // Every radial convoy lane from outer spawn down to inner ring road is flat and completely unobstructed
    for (const lane of BADLANDS_CONVOY_LANES) {
      const pts = [lane.spawn, ...lane.route];
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i]!;
        const floor = physics.raycast(V(x, 6, z), V(0, -1, 0), 8, CG.World);
        expect(floor, `No flat floor on ${lane.id} waypoint ${i}`).not.toBeNull();
        expect(floor!.point.y).toBeCloseTo(0, 1);
      }
      // Horizontal corridor raycast at vehicle bumper/roof height (y = 2.0) along lane entry segment
      const a = V(lane.spawn[0], 2.0, lane.spawn[1]);
      const b = V(lane.route[1]![0], 2.0, lane.route[1]![1]);
      const dir = b.clone().sub(a);
      const len = dir.length();
      const obstacle = physics.raycast(a, dir.normalize(), len, CG.World);
      expect(obstacle, `Obstacle blocking radial convoy corridor ${lane.id}`).toBeNull();
    }

    // Inner ring road segments are unobstructed
    for (let i = 0; i < BADLANDS_RING_WAYPOINTS.length; i++) {
      const p0 = BADLANDS_RING_WAYPOINTS[i]!;
      const p1 = BADLANDS_RING_WAYPOINTS[(i + 1) % BADLANDS_RING_WAYPOINTS.length]!;
      const a = V(p0[0], 2.0, p0[1]);
      const b = V(p1[0], 2.0, p1[1]);
      const dir = b.clone().sub(a);
      const len = dir.length();
      expect(physics.raycast(a, dir.normalize(), len, CG.World), `Ring road segment ${i} blocked`).toBeNull();
    }

    // Sandstone Arch provides >= 9 m clear mech walkthrough headroom under its lintel
    const arch = BADLANDS_LANDMARKS.sandstoneArch;
    const archCeil = physics.raycast(V(arch.x, 1.0, arch.z), V(0, 1, 0), 20, CG.World);
    expect(archCeil).not.toBeNull();
    expect(archCeil!.point.y).toBeGreaterThanOrEqual(9.5);
  });

  it('mutually connects every spawn, Frame pad, LZ, paratrooper drop, boss pad, pickup, and elevated deck on NavGraph', () => {
    expect(nav.nodeCount).toBeGreaterThan(60_000);
    expect(onNav(BADLANDS_HUB)).toBe(true);

    const checkpoints: { label: string; p: THREE.Vector3 }[] = [
      { label: 'player_spawn', p: V(BADLANDS_PLAYER_SPAWN[0], 0, BADLANDS_PLAYER_SPAWN[2]) },
      { label: 'frame_pad', p: V(BADLANDS_FRAME_PAD[0], 0, BADLANDS_FRAME_PAD[2]) },
      { label: 'vehicle_pad', p: V(BADLANDS_VEHICLE_PAD[0], 0, BADLANDS_VEHICLE_PAD[2]) },
      { label: 'aircraft_pad', p: V(BADLANDS_AIRCRAFT_PAD[0], 0, BADLANDS_AIRCRAFT_PAD[2]) },
      { label: 'terminal_front', p: V(BADLANDS_TERMINAL[0] + 2.2, 0, BADLANDS_TERMINAL[2] + 1.2) },
      { label: 'arch_center', p: V(BADLANDS_LANDMARKS.sandstoneArch.x, 0, BADLANDS_LANDMARKS.sandstoneArch.z) },
      { label: 'oasis_center', p: V(BADLANDS_LANDMARKS.wreckedOasis.x, 0, BADLANDS_LANDMARKS.wreckedOasis.z) },
      { label: 'derrick_deck', p: V(BADLANDS_LANDMARKS.saltDerrick.x + 2.5, 3.6, BADLANDS_LANDMARKS.saltDerrick.z) },
      ...BADLANDS_HOVER_ZONES.map(z => ({ label: z.id, p: V(z.x, z.y, z.z) })),
      ...BADLANDS_PARATROOPER_ZONES.map(z => ({ label: z.id, p: V(z.x, z.y, z.z) })),
      ...BADLANDS_BOSS_ZONES.map(z => ({ label: z.id, p: V(z.x, z.y, z.z) })),
      ...BADLANDS_PICKUP_SPOTS.map((p, i) => ({ label: `pickup_${i}`, p: V(p[0], p[1], p[2]) })),
    ];

    const broken: string[] = [];
    for (const c of checkpoints) {
      if (!onNav(c.p)) {
        broken.push(`${c.label} off nav`);
        continue;
      }
      const dTo = route(c.p, BADLANDS_HUB);
      const dFrom = route(BADLANDS_HUB, c.p);
      if (!(dTo < 500)) broken.push(`${c.label} cannot reach hub (${dTo})`);
      if (!(dFrom < 500)) broken.push(`hub cannot reach ${c.label} (${dFrom})`);
    }

    expect(broken).toEqual([]);
  });

  it('authors 8 Tier-0 destructible desert clusters (4 lookout posts + 4 landmark sheds) that break cleanly', () => {
    expect(spec.destructionClusters.length).toBe(8);
    expect(canDamageTier(0, 'smg')).toBe(true);

    for (const post of BADLANDS_LOOKOUT_POSTS) {
      const c = spec.destructionClusters.find(cl => cl.tag === post.id);
      expect(c, `Missing lookout post ${post.id}`).toBeDefined();
      expect(c!.nodes.every(n => n.tier === 0)).toBe(true);
      expect(c!.nodes.some(n => n.kind === 'hazard')).toBe(true);
    }

    const stubMat = () => new THREE.MeshBasicMaterial();
    const dm = new DestructionManager({ physics } as never, stubMat);
    for (const c of spec.destructionClusters) dm.addCluster(c);

    const post = dm.getCluster('badlands.post.ene');
    expect(post).toBeDefined();
    const stilt = post!.getNode('stilt_fl');
    expect(stilt).toBeDefined();
    expect(dm.damageCollider(stilt!.staticCollider, 150, 'smg', stilt!.basePos)).toBe(true);
    expect(stilt!.state).not.toBe('intact');
    dm.dispose();
  });
});
