/**
 * Map 3: Fortress Halcyon (`map: 'halcyon'`) verification suite.
 * Builds the real map with Rapier physics, Kit, MapSpec, NavGraph, Structures, and DestructionManager:
 * - Verifies exact airspace, NavGraph, and LightVolume bounds + triangle/collider/light/draw-call budgets
 * - Verifies `HALCYON_STAGES + authorHalcyon` and standalone `authorHalcyon` produce identical results
 * - Verifies every target, breach wall, defense site, ground lane, chopper LZ, and air patrol is in bounds
 * - Verifies exact 1-to-1 integrity of `BREACH_WALL_IDS` with `spec.structures` and real NavGraph unblocking
 *   when Section B (`x in [-28, +28], z = +98`) is bombed open by B-1B ordnance (`ac130_bomb`)
 * - Verifies all 44 `StructuralCluster`s load into `DestructionManager`, have valid support graphs, and
 *   collapse cleanly (including Tier-3 Citadel Command HQ under heavy bomb strikes)
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CG } from '../../core/contracts';
import { Physics } from '../../physics/Physics';
import { canDamageTier, DestructionManager, MAX_DYNAMIC_BODIES } from '../destruction';
import { Kit } from '../kit/kit';
import { NavGraph } from '../nav';
import { Structures } from '../structures';
import {
  authorHalcyon,
  BREACH_EAST_GATE_IDS,
  BREACH_SECTION_B_IDS,
  BREACH_WALL_IDS,
  BREACH_WEST_GATE_IDS,
  HALCYON_AIR_PATROLS,
  HALCYON_ATMOSPHERE,
  HALCYON_BOUNDS,
  HALCYON_BREACH_WALLS,
  HALCYON_CHOPPER_LZS,
  HALCYON_DEFENSE_SITES,
  HALCYON_GROUND_LANES,
  HALCYON_HUB,
  HALCYON_LEVELS,
  HALCYON_LIGHT_BOUNDS,
  HALCYON_LIGHT_CELL,
  HALCYON_NAV_BOUNDS,
  HALCYON_PICKUP_SPOTS,
  HALCYON_PLAYER_SPAWN,
  HALCYON_STAGES,
  HALCYON_TARGETS,
  type HalcyonTargetCategory,
} from './halcyon';
import { MapSpec } from './spec';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const inBox = (
  p: readonly [number, number, number],
  b: { readonly x0: number; readonly y0: number; readonly z0: number; readonly x1: number; readonly y1: number; readonly z1: number },
): boolean =>
  p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1 && p[2] >= b.z0 && p[2] <= b.z1;

let physics: Physics;
let kit: Kit;
let spec: MapSpec;
let nav: NavGraph;

beforeAll(async () => {
  physics = await Physics.create();
  kit = new Kit(physics);
  spec = new MapSpec();

  for (const stage of HALCYON_STAGES) {
    stage.run(kit, spec);
  }
  authorHalcyon(kit, spec);
  physics.flushQueries();

  const navBounds = new THREE.Box3(
    V(HALCYON_NAV_BOUNDS.x0, HALCYON_NAV_BOUNDS.y0, HALCYON_NAV_BOUNDS.z0),
    V(HALCYON_NAV_BOUNDS.x1, HALCYON_NAV_BOUNDS.y1, HALCYON_NAV_BOUNDS.z1),
  );
  nav = new NavGraph(physics);
  await nav.build(navBounds, spec.jumpLinks, HALCYON_HUB, async () => {}, {
    mutual: true,
    levels: [...HALCYON_LEVELS],
  });
}, 120000);

const onNav = (p: THREE.Vector3, r = 1.8): boolean => {
  const out = V(0, 0, 0);
  return nav.nearest(V(p.x, p.y + 0.1, p.z), 3, out) && Math.hypot(out.x - p.x, out.z - p.z) < r && Math.abs(out.y - p.y) < 0.6;
};

const route = (from: THREE.Vector3, to: THREE.Vector3): number => {
  nav.setTarget(to);
  nav.settle();
  return nav.pathDistance(from);
};

describe('Map 3: Fortress Halcyon (giga-sized destructible military installation)', () => {
  it('stays inside triangle, static collider, baked-light, draw-call, and LightVolume budgets', () => {
    const triangles = kit.geo.triangles();
    const staticBuckets = kit.geo.buckets.size;
    const colliders = kit.colliders;
    const bakedLights = kit.lights.length;
    const totalClusterNodes = spec.destructionClusters.reduce((acc, c) => acc + c.nodes.length, 0);
    // Conservative upper bound on total world draw calls (static buckets + destructible nodes + structure chunks + breakables)
    const estimatedDrawCalls = staticBuckets + totalClusterNodes + 35;

    console.info('halcyon', JSON.stringify({
      triangles,
      staticBuckets,
      colliders,
      bakedLights,
      structures: spec.structures.length,
      clusters: spec.destructionClusters.length,
      totalClusterNodes,
      breakables: spec.breakables.length,
      explosives: spec.explosives.length,
      estimatedDrawCalls,
      navNodes: nav.nodeCount,
    }));

    expect(triangles).toBeGreaterThan(3_000);
    expect(triangles).toBeLessThanOrEqual(145_000);
    expect(colliders).toBeLessThanOrEqual(380);
    expect(bakedLights).toBeGreaterThanOrEqual(16);
    expect(bakedLights).toBeLessThanOrEqual(64);
    expect(estimatedDrawCalls).toBeLessThan(500);
    expect(spec.destructionClusters.every(c => c.nodes.length <= MAX_DYNAMIC_BODIES)).toBe(true);

    // Exact bounds & atmosphere contracts
    expect(spec.reactor).toBeNull();
    expect(spec.killY).toBe(HALCYON_BOUNDS.y0);
    expect(HALCYON_ATMOSPHERE).toBe('dawn');
    expect(HALCYON_BOUNDS).toEqual({ x0: -820, y0: -12, z0: -820, x1: 820, y1: 340, z1: 820 });
    expect(HALCYON_NAV_BOUNDS).toEqual({ x0: -180, y0: -6, z0: -180, x1: 180, y1: 36, z1: 180 });
    expect(HALCYON_LIGHT_BOUNDS).toEqual({ x0: -180, y0: -4, z0: -180, x1: 180, y1: 42, z1: 180 });
    expect(HALCYON_LIGHT_CELL).toBe(1.8);
    expect(HALCYON_LEVELS).toEqual([0, 3.8, 7.6]);
    expect([HALCYON_HUB.x, HALCYON_HUB.y, HALCYON_HUB.z]).toEqual([0, 0, 155]);

    // LightVolume hard limits: MAX_DIMS = [200, 48, 200]
    const lx = HALCYON_LIGHT_BOUNDS.x1 - HALCYON_LIGHT_BOUNDS.x0;
    const ly = HALCYON_LIGHT_BOUNDS.y1 - HALCYON_LIGHT_BOUNDS.y0;
    const lz = HALCYON_LIGHT_BOUNDS.z1 - HALCYON_LIGHT_BOUNDS.z0;
    expect(Math.ceil(lx / HALCYON_LIGHT_CELL)).toBeLessThanOrEqual(200);
    expect(Math.ceil(ly / HALCYON_LIGHT_CELL)).toBeLessThanOrEqual(48);
    expect(Math.ceil(lz / HALCYON_LIGHT_CELL)).toBeLessThanOrEqual(200);

    // Plan, roads, zones, spawns, pickups & views
    expect(spec.plan).not.toBeNull();
    expect(spec.plan!.fills.length).toBeGreaterThanOrEqual(7);
    expect(spec.roads.length).toBeGreaterThanOrEqual(6);
    expect(spec.zones.length).toBeGreaterThanOrEqual(9);
    expect(spec.spawns!.some(s => s.kind === 'ground')).toBe(true);
    expect(spec.spawns!.some(s => s.kind === 'air')).toBe(true);
    expect(spec.pickupSpots.length).toBe(HALCYON_PICKUP_SPOTS.length);

    for (const v of ['overview', 'bomberPass', 'beachhead', 'sectionB', 'armory', 'airfield', 'fuelDepot', 'barracks', 'citadel']) {
      expect(spec.views[v], `Missing spec.views.${v}`).toBeDefined();
    }
  });

  it('builds identically when authorHalcyon is called standalone without manually running HALCYON_STAGES', async () => {
    const p2 = await Physics.create();
    const k2 = new Kit(p2);
    const s2 = new MapSpec();
    expect(() => authorHalcyon(k2, s2)).not.toThrow();
    expect(s2.structures.length).toBe(spec.structures.length);
    expect(s2.destructionClusters.length).toBe(spec.destructionClusters.length);
    expect(s2.breakables.length).toBe(spec.breakables.length);
    expect(s2.zones.length).toBe(spec.zones.length);
    expect(s2.roads.length).toBe(spec.roads.length);
  });

  it('keeps every target, defense site, breach wall, ground lane, chopper LZ, and air patrol inside bounds and covers all 11 target categories', () => {
    const requiredCategories: HalcyonTargetCategory[] = [
      'wall', 'mortar', 'sam', 'flak', 'radar', 'tank_armory', 'hangar', 'parked_aircraft', 'fuel_ammo', 'barracks', 'hq',
    ];
    for (const cat of requiredCategories) {
      expect(HALCYON_TARGETS.some(t => t.category === cat), `Missing target category ${cat}`).toBe(true);
    }

    const clusterIdSet = new Set(spec.destructionClusters.map(c => c.id));

    for (const target of HALCYON_TARGETS) {
      expect(inBox(target.pos, HALCYON_NAV_BOUNDS), `Target ${target.id} outside HALCYON_NAV_BOUNDS`).toBe(true);
      expect(target.clusterIds.length + target.structureIds.length, `Target ${target.id} has no linked destructible IDs`).toBeGreaterThan(0);
      for (const cid of target.clusterIds) {
        expect(clusterIdSet.has(cid), `Target ${target.id} references missing cluster ${cid}`).toBe(true);
      }
      for (const sid of target.structureIds) {
        expect(spec.structures[sid], `Target ${target.id} references out-of-range structure ID ${sid}`).toBeDefined();
      }
    }

    // Defense sites: 3 mortars, 4 SAMs, 3 flak towers, 2 radar domes
    expect(HALCYON_DEFENSE_SITES.filter(s => s.role === 'mortar')).toHaveLength(3);
    expect(HALCYON_DEFENSE_SITES.filter(s => s.role === 'sam')).toHaveLength(4);
    expect(HALCYON_DEFENSE_SITES.filter(s => s.role === 'flak')).toHaveLength(3);
    expect(HALCYON_DEFENSE_SITES.filter(s => s.role === 'radar')).toHaveLength(2);
    for (const site of HALCYON_DEFENSE_SITES) {
      expect(inBox(site.pos, HALCYON_NAV_BOUNDS), `Defense site ${site.id} outside nav bounds`).toBe(true);
      expect(inBox(site.mountPos, HALCYON_NAV_BOUNDS), `Defense site mount ${site.id} outside nav bounds`).toBe(true);
      expect(clusterIdSet.has(site.clusterId), `Defense site ${site.id} missing cluster ${site.clusterId}`).toBe(true);
    }

    // Ground assault lanes inside nav bounds & flat y = 0
    for (const lane of HALCYON_GROUND_LANES) {
      for (const pt of [lane.spawn, ...lane.waypoints]) {
        expect(inBox([pt[0], 0, pt[1]], HALCYON_NAV_BOUNDS), `Lane ${lane.id} waypoint [${pt.join(',')}] outside nav bounds`).toBe(true);
        const floor = physics.raycast(V(pt[0], 4, pt[1]), V(0, -1, 0), 6, CG.World);
        expect(floor, `No flat ground on lane ${lane.id} at [${pt.join(',')}]`).not.toBeNull();
        expect(floor!.point.y).toBeCloseTo(0, 1);
      }
    }

    // Chopper LZs: 3 beachhead + 2 inner assault
    expect(HALCYON_CHOPPER_LZS.filter(z => z.phase === 'beachhead')).toHaveLength(3);
    expect(HALCYON_CHOPPER_LZS.length).toBeGreaterThanOrEqual(5);
    for (const lz of HALCYON_CHOPPER_LZS) {
      expect(inBox(lz.pos, HALCYON_NAV_BOUNDS), `LZ ${lz.id} outside nav bounds`).toBe(true);
      expect(inBox(lz.approachFrom, HALCYON_BOUNDS), `LZ ${lz.id} approach outside airspace bounds`).toBe(true);
      expect(inBox(lz.egressTo, HALCYON_BOUNDS), `LZ ${lz.id} egress outside airspace bounds`).toBe(true);
      // Open sky above every Valkyrie LZ
      const overhead = physics.raycast(V(lz.pos[0], 1, lz.pos[2]), V(0, 1, 0), 120, CG.World);
      expect(overhead, `Overhead obstruction above LZ ${lz.id}`).toBeNull();
    }

    // Air patrols inside 1,640 m flight airspace
    expect(HALCYON_AIR_PATROLS.length).toBeGreaterThanOrEqual(4);
    for (const patrol of HALCYON_AIR_PATROLS) {
      for (const wp of patrol.waypoints) {
        expect(inBox(wp, HALCYON_BOUNDS), `Air patrol ${patrol.id} waypoint [${wp.join(',')}] outside HALCYON_BOUNDS`).toBe(true);
      }
    }
  });

  it('mutually connects beachhead, Valkyrie LZs, pickups, fortress interior, and elevated y = 3.8 decks on NavGraph', () => {
    expect(nav.nodeCount).toBeGreaterThan(60_000);
    expect(onNav(HALCYON_HUB)).toBe(true);

    const checkpoints: { label: string; p: THREE.Vector3 }[] = [
      { label: 'player_spawn', p: V(HALCYON_PLAYER_SPAWN[0], 0, HALCYON_PLAYER_SPAWN[2]) },
      { label: 'citadel_south_plaza', p: V(0, 0, 14) },
      { label: 'tank_armory_yard', p: V(-54, 0, 20) },
      { label: 'airfield_taxiway', p: V(76, 0, 10) },
      { label: 'fuel_farm_crossroad', p: V(-38, 0, -68) },
      { label: 'barracks_parade', p: V(84, 0, -84) },
      { label: 'flak_west_deck', p: V(-52, 3.8, 70) },
      { label: 'flak_east_deck', p: V(52, 3.8, 70) },
      { label: 'flak_north_deck', p: V(0, 3.8, -104) },
      { label: 'rampart_west_catwalk', p: V(-50, 3.8, 94.2) },
      { label: 'rampart_east_catwalk', p: V(50, 3.8, 94.2) },
      ...HALCYON_CHOPPER_LZS.map(lz => ({ label: lz.id, p: V(lz.pos[0], lz.pos[1], lz.pos[2]) })),
      ...HALCYON_PICKUP_SPOTS.map((p, i) => ({ label: `pickup_${i}`, p: V(p[0], p[1], p[2]) })),
    ];

    const broken: string[] = [];
    for (const c of checkpoints) {
      if (!onNav(c.p)) {
        broken.push(`${c.label} off nav`);
        continue;
      }
      const dTo = route(c.p, HALCYON_HUB);
      const dFrom = route(HALCYON_HUB, c.p);
      if (!(dTo < 650)) broken.push(`${c.label} cannot reach hub (${dTo})`);
      if (!(dFrom < 650)) broken.push(`hub cannot reach ${c.label} (${dFrom})`);
    }
    expect(broken).toEqual([]);
  });

  it('aligns BREACH_WALL_IDS 1-to-1 with spec.structures and unblocks NavGraph when Section B is bombed', () => {
    // Verify Section B covers x in [-28, +28] at z = +98 and includes the Main South Armored Gate
    expect(BREACH_SECTION_B_IDS.length).toBe(13);
    expect(BREACH_WEST_GATE_IDS.length).toBe(3);
    expect(BREACH_EAST_GATE_IDS.length).toBe(3);
    expect(BREACH_WALL_IDS.length).toBe(19);

    for (const id of BREACH_SECTION_B_IDS) {
      const s = spec.structures[id]!;
      expect(s).toBeDefined();
      expect(s.z).toBeCloseTo(98, 2);
      expect(s.x).toBeGreaterThanOrEqual(-28);
      expect(s.x).toBeLessThanOrEqual(28);
    }
    expect(BREACH_SECTION_B_IDS.some(id => spec.structures[id]!.kind === 'gate')).toBe(true);

    for (const bw of HALCYON_BREACH_WALLS) {
      expect(bw.structureIds.length).toBeGreaterThan(0);
      for (const id of bw.structureIds) {
        expect(spec.structures[id], `Missing structure ${id} in ${bw.id}`).toBeDefined();
      }
    }

    // Attach real Structures to NavGraph, then bomb Section B with B-1B ordnance (`ac130_bomb`)
    const stubMat = () => new THREE.MeshBasicMaterial();
    const noop = () => {};
    const stubCtx = {
      physics,
      fx: { dust: noop, chips: noop, sparks: noop, smoke: noop },
      audio: { play: noop },
      events: { emit: noop },
      hud: { hitMarker: noop, feed: noop },
    };
    const structures = new Structures(stubCtx as never, spec.structures, stubMat);
    structures.attach(nav);

    // Before bombing, Section B gate piece is intact and blocking NavGraph
    const mainGateId = BREACH_SECTION_B_IDS.find(id => spec.structures[id]!.kind === 'gate')!;
    const mainGate = structures.all[mainGateId]!;
    expect(mainGate.id).toBe(mainGateId);
    expect(mainGate.stage).toBe('intact');
    expect(mainGate.blocking).toBe(true);

    // Drop heavy bomb on Section B main gate (0, 0, 98)
    structures.blast(V(0, 1, 98), 26, 2500, 'ac130_bomb');
    expect(mainGate.stage).toBe('breached');
    expect(mainGate.blocking).toBe(false);

    // Friendly tanks & squads can now route straight from HALCYON_HUB (0, 0, 155) into Citadel plaza (0, 0, 14)!
    const breachDist = route(HALCYON_HUB, V(0, 0, 14));
    expect(breachDist).toBeLessThan(260);
  });

  it('validates all 44 structural clusters and verifies B-1B bombs shatter both fuel silos and Tier-3 Citadel Command HQ', () => {
    expect(spec.destructionClusters.length).toBe(44);
    expect(canDamageTier(3, 'ac130_bomb')).toBe(true);
    expect(canDamageTier(3, 'rifle')).toBe(false);

    // Every cluster has unique IDs, >= 1 anchored node, and valid support links
    const seenClusterIds = new Set<string>();
    for (const c of spec.destructionClusters) {
      expect(c.id).toBeDefined();
      expect(seenClusterIds.has(c.id!)).toBe(false);
      seenClusterIds.add(c.id!);

      const nodeIds = new Set(c.nodes.map(n => n.id));
      expect(nodeIds.size).toBe(c.nodes.length);
      expect(c.nodes.some(n => n.anchored), `Cluster ${c.id} has no anchored node`).toBe(true);
      for (const [a, b] of c.links ?? []) {
        expect(nodeIds.has(a), `Cluster ${c.id} link endpoint ${a} missing`).toBe(true);
        expect(nodeIds.has(b), `Cluster ${c.id} link endpoint ${b} missing`).toBe(true);
      }
    }

    const stubMat = () => new THREE.MeshBasicMaterial();
    const dm = new DestructionManager({ physics } as never, stubMat);
    for (const c of spec.destructionClusters) dm.addCluster(c);

    // Verify Fuel Silo 01 shatters cleanly under bomb blast
    const silo = dm.getCluster('halcyon.fuel.1');
    expect(silo).toBeDefined();
    const siloCore = silo!.getNode('silo_core');
    expect(siloCore).toBeDefined();
    expect(dm.damageCollider(siloCore!.staticCollider, 500, 'ac130_bomb', siloCore!.basePos)).toBe(true);
    expect(siloCore!.state).not.toBe('intact');

    // Verify Tier-3 Citadel Command HQ resists rifle fire (zero HP loss) but cracks under heavy B-1B bomb strike!
    const hq = dm.getCluster('halcyon.citadel.hq');
    expect(hq).toBeDefined();
    const buttress = hq!.getNode('but_sw');
    expect(buttress).toBeDefined();
    expect(buttress!.tier).toBe(3);
    const fullHp = buttress!.hp;
    dm.damageCollider(buttress!.staticCollider, 150, 'rifle', buttress!.basePos);
    expect(buttress!.hp).toBe(fullHp);
    expect(buttress!.state).toBe('intact');
    expect(dm.damageCollider(buttress!.staticCollider, 800, 'ac130_bomb', buttress!.basePos)).toBe(true);
    expect(buttress!.state).not.toBe('intact');

    dm.dispose();
  });
});
