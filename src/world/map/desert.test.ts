/**
 * Surplus — Desert Raid (Mission 5, `map: 'desert'`) map verification:
 * builds the real map with Rapier physics, Kit, MapSpec, and multi-level NavGraph, verifying:
 * - Triangle, static collider, baked-light, NavGraph, and LightVolume budgets
 * - Both `DESERT_STAGES + authorDesert` and standalone `authorDesert` builds succeed cleanly
 * - > 40 Tier-0 destructible `destructionClusters` across dunes, wall, warren, pumpyard & forecourt
 * - All 6 watchtowers at WALL_TOWERS and >= 18 shacks in The Warren have Tier-0 breakable nodes
 * - 100% solid Crashed Cargo Plane hull produces ZERO destruction clusters & has open door1/door2 frames
 * - Vaulted Dark Storm Sewer connects `sewerDropPos` (y = 0) through `y = -5.5` up to `sewerExitTop` (y = 0)
 * - Clean mutual multi-level NavGraph connectivity from DESERT_HUB ([0, 0, 44]) across Dunes, Wall
 *   Walkways (3.4), Warren, Minigun Nest (4.2), Pump Yard, Dark Sewer (-5.5), Forecourt, and Cargo Plane (1.5)
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CG } from '../../core/contracts';
import { Physics } from '../../physics/Physics';
import { canDamageTier, DestructionManager } from '../destruction';
import { Kit } from '../kit/kit';
import { NavGraph } from '../nav';
import {
  APPROACH_POSTS,
  authorDesert,
  CARGO_PLANE,
  CONVOY_PATHS,
  DESERT_BOUNDS,
  DESERT_HUB,
  DESERT_LEVELS,
  DESERT_LIGHT_BOUNDS,
  DESERT_LIGHT_CELL,
  DESERT_STAGES,
  DESERT_Z,
  LOUDSPEAKER_POLES,
  PUMP_YARD,
  WALL_TOWERS,
  WARREN_MINIGUN,
} from './desert';
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

  for (const stage of DESERT_STAGES) {
    stage.run(kit, spec);
  }
  authorDesert(kit, spec);
  physics.flushQueries();

  const bounds = new THREE.Box3(
    V(DESERT_BOUNDS.x0, DESERT_BOUNDS.y0, DESERT_BOUNDS.z0),
    V(DESERT_BOUNDS.x1, DESERT_BOUNDS.y1, DESERT_BOUNDS.z1),
  );
  nav = new NavGraph(physics);
  await nav.build(bounds, spec.jumpLinks, DESERT_HUB, async () => {}, {
    mutual: true,
    levels: [...DESERT_LEVELS],
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

const nodePos = (p: THREE.Vector3 | readonly [number, number, number]): readonly [number, number, number] =>
  p instanceof THREE.Vector3 ? [p.x, p.y, p.z] : p;

describe('Surplus (Desert Raid) map', () => {
  it('stays inside triangle, static collider, baked-light, NavGraph, and LightVolume budgets', () => {
    const triangles = kit.geo.triangles();
    const colliders = kit.colliders;
    const bakedLights = kit.lights.length;
    const totalNodes = spec.destructionClusters.reduce((sum, c) => sum + c.nodes.length, 0);

    console.info('desert', JSON.stringify({
      triangles,
      colliders,
      bakedLights,
      clusters: spec.destructionClusters.length,
      destructionNodes: totalNodes,
      explosives: spec.explosives.length,
      emplacements: spec.emplacements.length,
      navNodes: nav.nodeCount,
    }));

    expect(triangles).toBeGreaterThan(8_000);
    expect(triangles).toBeLessThan(400_000);
    expect(colliders).toBeLessThan(950);
    expect(bakedLights).toBeGreaterThanOrEqual(16);
    expect(bakedLights).toBeLessThanOrEqual(140);

    // Coordinate & bounds contracts
    expect(spec.reactor).toBeNull();
    expect(spec.killY).toBe(DESERT_BOUNDS.y0);
    expect(DESERT_HUB.toArray()).toEqual([0, 0, 44]);
    expect(DESERT_BOUNDS.y1).toBeLessThanOrEqual(118);
    expect(DESERT_BOUNDS.y0).toBeGreaterThanOrEqual(-19);

    // LightVolume hard limits: MAX_DIMS = [200, 48, 200]
    const lx = DESERT_LIGHT_BOUNDS.x1 - DESERT_LIGHT_BOUNDS.x0;
    const ly = DESERT_LIGHT_BOUNDS.y1 - DESERT_LIGHT_BOUNDS.y0;
    const lz = DESERT_LIGHT_BOUNDS.z1 - DESERT_LIGHT_BOUNDS.z0;
    expect(Math.ceil(lx / DESERT_LIGHT_CELL)).toBeLessThanOrEqual(200);
    expect(Math.ceil(ly / DESERT_LIGHT_CELL)).toBeLessThanOrEqual(48);
    expect(Math.ceil(lz / DESERT_LIGHT_CELL)).toBeLessThanOrEqual(200);

    // Minimap plan, roads, zones, spawns, pickups, emplacements & views
    expect(spec.plan).not.toBeNull();
    expect(spec.plan!.fills.length).toBeGreaterThanOrEqual(5);
    expect(spec.roads.map(r => r.id)).toEqual(['approach', 'wallLoop', 'exfil']);
    expect(spec.zones.length).toBeGreaterThanOrEqual(7);
    expect(spec.spawns).not.toBeNull();
    expect(spec.spawns!.some(s => s.kind === 'ground')).toBe(true);
    expect(spec.spawns!.some(s => s.kind === 'air')).toBe(true);
    expect(spec.pickupSpots.length).toBeGreaterThanOrEqual(8);
    expect(spec.emplacements.length).toBeGreaterThanOrEqual(1);

    for (const v of ['overview', 'approach', 'wall', 'warren', 'minigun', 'pumpyard', 'sewer', 'forecourt', 'plane', 'planeInterior']) {
      expect(spec.views[v], `Missing spec.views.${v}`).toBeDefined();
    }
  });

  it('also builds cleanly when authorDesert is called standalone without manually running DESERT_STAGES', async () => {
    const p2 = await Physics.create();
    const k2 = new Kit(p2);
    const s2 = new MapSpec();
    expect(() => authorDesert(k2, s2)).not.toThrow();
    expect(s2.destructionClusters.length).toBe(spec.destructionClusters.length);
    expect(s2.zones.length).toBe(spec.zones.length);
    expect(s2.roads.length).toBe(3);
  });

  it('registers > 40 Tier-0 destructible clusters across dunes, wall, warren, pumpyard & forecourt', () => {
    const clusters = spec.destructionClusters;
    expect(clusters.length).toBeGreaterThan(40);

    // Every single cluster across Surplus uses Tier-0 bullet-breakable structural nodes
    const tier0Clusters = clusters.filter(c => c.nodes.every(n => n.tier === 0));
    expect(tier0Clusters.length).toBe(clusters.length);
    expect(canDamageTier(0, 'smg')).toBe(true);
    expect(canDamageTier(0, 'minigun')).toBe(true);

    // 4 Approach lookout posts at APPROACH_POSTS with red fuel drum hazards
    for (const post of APPROACH_POSTS) {
      const c = clusters.find(cl => cl.tag === post.id);
      expect(c, `Missing approach lookout cluster ${post.id}`).toBeDefined();
      expect(c!.nodes.some(n => n.kind === 'hazard' && n.tier === 0)).toBe(true);
    }

    // >= 28 Tier-0 scrap wall panels + 2 side-gate barricades
    const wallPanels = clusters.filter(c => c.kind === 'scrapWall');
    expect(wallPanels.length).toBeGreaterThanOrEqual(28);
    expect(clusters.find(c => c.tag === 'wall.sidegate.west')).toBeDefined();
    expect(clusters.find(c => c.tag === 'wall.sidegate.east')).toBeDefined();

    // All 6 watchtowers at WALL_TOWERS with Tier-0 anchored legs (hp <= 120) & rooftop hazard drums
    for (const tw of WALL_TOWERS) {
      const c = clusters.find(cl => cl.tag === tw.id);
      expect(c, `Missing watchtower cluster ${tw.id}`).toBeDefined();
      const legs = c!.nodes.filter(n => n.kind === 'column' && n.anchored);
      expect(legs.length).toBeGreaterThanOrEqual(4);
      for (const leg of legs) {
        expect(leg.tier).toBe(0);
        expect(leg.hp).toBeLessThanOrEqual(120);
      }
      expect(c!.nodes.some(n => n.kind === 'hazard' && n.tier === 0)).toBe(true);
    }

    // >= 18 distinct Tier-0 Warren shacks (both 1-storey and 2-storey)
    const shacks = clusters.filter(c => c.kind === 'warrenShack');
    expect(shacks.length).toBeGreaterThanOrEqual(18);
    for (const shack of shacks) {
      expect(shack.nodes.some(n => n.kind === 'column' && n.tier === 0)).toBe(true);
      expect(shack.nodes.some(n => n.kind === 'wall' && n.tier === 0)).toBe(true);
      expect(shack.nodes.some(n => n.kind === 'roof' && !n.anchored && n.tier === 0)).toBe(true);
    }

    // Pump yard control shack + checkpoints + forecourt cover
    expect(clusters.find(c => c.tag === 'pumpyard.controlShack')).toBeDefined();
    expect(clusters.filter(c => c.kind === 'pumpCheckpoint').length).toBeGreaterThanOrEqual(3);
    expect(clusters.filter(c => c.kind === 'forecourtCover').length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the Crashed Cargo Plane 100% SOLID (ZERO destruction clusters) with open ramp & bulkhead doorways', () => {
    // ZERO destruction clusters or nodes may sit inside the Cargo Plane hull footprint (z <= -79, |x| <= 30)
    const planeClusters = spec.destructionClusters.filter(c =>
      c.nodes.some(n => {
        const [x, , z] = nodePos(n.pos);
        return z <= -79 && Math.abs(x) <= 30;
      }),
    );
    expect(planeClusters).toEqual([]);

    // Solid walkable cargo cabin floor at exact y = 1.5 across all 3 compartments
    for (const cz of [-92, -108, -124]) {
      const floorHit = physics.raycast(V(0, CARGO_PLANE.floorY + 2.0, cz), V(0, -1, 0), 4, CG.World);
      expect(floorHit, `Missing cargo plane floor at z=${cz}`).not.toBeNull();
      expect(floorHit!.point.y).toBeCloseTo(CARGO_PLANE.floorY, 1);

      // Solid overhead ceiling at y = 6.3
      const ceilHit = physics.raycast(V(0, CARGO_PLANE.floorY + 2.0, cz), V(0, 1, 0), 6, CG.World);
      expect(ceilHit, `Missing cargo plane ceiling at z=${cz}`).not.toBeNull();
      expect(ceilHit!.point.y).toBeCloseTo(CARGO_PLANE.floorY + CARGO_PLANE.hullHeight, 1);
    }

    // Unobstructed center-aisle doorways through plane.door1 (-102) and plane.door2 (-116)
    const door1Ray = physics.raycast(V(0, CARGO_PLANE.floorY + 1.5, CARGO_PLANE.door1Z + 3), V(0, 0, -1), 6, CG.World);
    expect(door1Ray).toBeNull();
    const door2Ray = physics.raycast(V(0, CARGO_PLANE.floorY + 1.5, CARGO_PLANE.door2Z + 3), V(0, 0, -1), 6, CG.World);
    expect(door2Ray).toBeNull();

    // Solid bulkhead flanks beside door1 & door2 (x = ±2.5)
    const flankHit1 = physics.raycast(V(2.5, CARGO_PLANE.floorY + 1.5, CARGO_PLANE.door1Z + 3), V(0, 0, -1), 6, CG.World);
    expect(flankHit1).not.toBeNull();
    const flankHit2 = physics.raycast(V(-2.5, CARGO_PLANE.floorY + 1.5, CARGO_PLANE.door2Z + 3), V(0, 0, -1), 6, CG.World);
    expect(flankHit2).not.toBeNull();

    // Main Gate (z = 62) & Pump Yard North Arch (z = -56) remain open for runtime setpieces
    expect(physics.raycast(V(0, 2.0, DESERT_Z.wallLine + 5), V(0, 0, -1), 10, CG.World)).toBeNull();
    expect(physics.raycast(V(0, 2.0, DESERT_Z.pumpNorthGate + 5), V(0, 0, -1), 10, CG.World)).toBeNull();
  });

  it('connects the Vaulted Dark Storm Sewer (-5.5..0) and mutually links all Surplus zones on the NavGraph', () => {
    expect(nav.nodeCount).toBeGreaterThan(20_000);
    expect(onNav(DESERT_HUB)).toBe(true);

    // Physical floor checks for Sewer Drop (0), Sewer Interior (-5.5), Sewer Exit Bottom (-5.5), and Sewer Exit Top (0)
    const dropHit = physics.raycast(V(PUMP_YARD.sewerDropPos[0], 2.0, PUMP_YARD.sewerDropPos[2]), V(0, -1, 0), 4, CG.World);
    expect(dropHit).not.toBeNull();
    expect(dropHit!.point.y).toBeCloseTo(0, 1);

    for (const sz of [-36, -54, PUMP_YARD.sewerExitBottom[2]]) {
      const sewerFloor = physics.raycast(V(0, -2.5, sz), V(0, -1, 0), 5, CG.World);
      expect(sewerFloor, `Missing sewer floor at z=${sz}`).not.toBeNull();
      expect(sewerFloor!.point.y).toBeCloseTo(PUMP_YARD.sewerFloorY, 1);

      // Sewer is enclosed overhead by the y = -0.8 ground slab (genuinely dark underground!)
      const sewerCeil = physics.raycast(V(0, -3.5, sz), V(0, 1, 0), 4, CG.World);
      expect(sewerCeil, `Sewer ceiling leak at z=${sz}`).not.toBeNull();
      expect(sewerCeil!.point.y).toBeLessThan(-0.5);
    }

    const exitTopHit = physics.raycast(V(PUMP_YARD.sewerExitTop[0], 2.0, PUMP_YARD.sewerExitTop[2]), V(0, -1, 0), 4, CG.World);
    expect(exitTopHit).not.toBeNull();
    expect(exitTopHit!.point.y).toBeCloseTo(0, 1);

    // Mutual NavGraph reachability across every key elevation & setpiece landmark
    const checkpoints: { label: string; p: THREE.Vector3 }[] = [
      { label: 'approach_start', p: V(0, 0, DESERT_Z.approachStart) },
      { label: 'wall_walkway_west', p: V(-36, 3.4, DESERT_Z.wallWalkway) },
      { label: 'wall_walkway_east', p: V(36, 3.4, DESERT_Z.wallWalkway) },
      { label: 'warren_minigun_nest', p: V(WARREN_MINIGUN.pos[0], WARREN_MINIGUN.pos[1], WARREN_MINIGUN.pos[2]) },
      { label: 'pump_yard_sewer_drop', p: V(PUMP_YARD.sewerDropPos[0], PUMP_YARD.sewerDropPos[1], PUMP_YARD.sewerDropPos[2]) },
      { label: 'sewer_south', p: V(0, PUMP_YARD.sewerFloorY, -36) },
      { label: 'sewer_mid', p: V(0, PUMP_YARD.sewerFloorY, -54) },
      { label: 'sewer_exit_bottom', p: V(PUMP_YARD.sewerExitBottom[0], PUMP_YARD.sewerExitBottom[1], PUMP_YARD.sewerExitBottom[2]) },
      { label: 'sewer_exit_top', p: V(PUMP_YARD.sewerExitTop[0], PUMP_YARD.sewerExitTop[1], PUMP_YARD.sewerExitTop[2]) },
      { label: 'plane_forecourt_exfil', p: V(CARGO_PLANE.forecourtExfilPos[0], CARGO_PLANE.forecourtExfilPos[1], CARGO_PLANE.forecourtExfilPos[2]) },
      { label: 'plane_aft_bay', p: V(0, CARGO_PLANE.floorY, -92) },
      { label: 'plane_quist_wait', p: V(CARGO_PLANE.quistWaitPos[0], CARGO_PLANE.quistWaitPos[1], CARGO_PLANE.quistWaitPos[2]) },
      { label: 'plane_quist_mid', p: V(CARGO_PLANE.quistMidPos[0], CARGO_PLANE.quistMidPos[1], CARGO_PLANE.quistMidPos[2]) },
      { label: 'plane_quist_corner', p: V(CARGO_PLANE.quistCornerPos[0], CARGO_PLANE.quistCornerPos[1], CARGO_PLANE.quistCornerPos[2]) },
    ];

    const broken: string[] = [];
    for (const c of checkpoints) {
      if (!onNav(c.p)) {
        broken.push(`${c.label} off nav`);
        continue;
      }
      const dTo = route(c.p, DESERT_HUB);
      const dFrom = route(DESERT_HUB, c.p);
      if (!(dTo < 800)) broken.push(`${c.label} cannot reach hub (${dTo})`);
      if (!(dFrom < 800)) broken.push(`hub cannot reach ${c.label} (${dFrom})`);
    }

    // Every authored ground spawn, player spawn, and pickup spot sits on the NavGraph
    for (const sp of spec.spawns ?? []) {
      if (sp.kind !== 'ground') continue;
      if (!onNav(V(sp.position.x, sp.position.y - 0.1, sp.position.z))) {
        broken.push(`ground spawn [${sp.position.toArray().join(',')}] (${sp.zone}) off nav`);
      }
    }
    for (const ps of spec.playerSpawns) {
      if (!onNav(V(ps.position.x, ps.position.y - 0.1, ps.position.z))) {
        broken.push(`playerSpawn [${ps.position.toArray().join(',')}] off nav`);
      }
    }
    for (const pk of spec.pickupSpots) {
      if (!onNav(pk)) {
        broken.push(`pickup [${pk.toArray().join(',')}] off nav`);
      }
    }

    expect(broken).toEqual([]);
  });

  it('validates cluster graph links, convoy/setpiece clearances, and live Tier-0 DestructionManager breakage', () => {
    // Every cluster link references valid node IDs within that cluster
    for (const c of spec.destructionClusters) {
      const ids = new Set(c.nodes.map(n => n.id));
      for (const [a, b] of c.links ?? []) {
        expect(ids.has(a), `Cluster ${c.id} link references unknown node ${a}`).toBe(true);
        expect(ids.has(b), `Cluster ${c.id} link references unknown node ${b}`).toBe(true);
      }
    }

    // Convoy approach & wallLoop waypoints + loudspeaker poles + water tower pad sit on clear y = 0 ground
    for (const pt of [...CONVOY_PATHS.approach, ...CONVOY_PATHS.wallLoop, ...LOUDSPEAKER_POLES, PUMP_YARD.towerBase]) {
      const hit = physics.raycast(V(pt[0], 3.5, pt[2]), V(0, -1, 0), 5, CG.World);
      expect(hit, `No ground at [${pt.join(',')}]`).not.toBeNull();
      expect(hit!.point.y).toBeCloseTo(0, 1);
    }

    // Mount all 89 Tier-0 clusters into a real DestructionManager and verify bullets break a watchtower leg
    const stubMat = () => new THREE.MeshBasicMaterial();
    const dm = new DestructionManager({ physics } as never, stubMat);
    for (const c of spec.destructionClusters) {
      dm.addCluster(c);
    }
    expect(dm.allClusters().length).toBe(spec.destructionClusters.length);

    const tower = dm.getCluster('wall_tower_w1');
    expect(tower).toBeDefined();
    const leg = tower!.getNode('leg_sw');
    expect(leg).toBeDefined();
    expect(leg!.tier).toBe(0);
    expect(dm.damageCollider(leg!.staticCollider, 150, 'smg', leg!.basePos)).toBe(true);
    expect(leg!.state).not.toBe('intact');
    dm.dispose();
  });
});

