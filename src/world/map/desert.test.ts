/**
 * Surplus — Desert Raid 2.0 (Mission 5, `map: 'desert'`) map verification:
 * builds the real map with Rapier physics, Kit, MapSpec, and multi-level NavGraph, verifying:
 * - Strict triangle (<= 145k), static collider (<= 380), baked-light (<= 64), NavGraph, and LightVolume budgets
 * - Both `DESERT_STAGES + authorDesert` and standalone `authorDesert` builds succeed cleanly
 * - Sturdy corrugated metal wall panels (hp >= 240, materialClass: 'metal', fractureGrid) + wood-legged towers
 * - Outer wall explosive barrels <= 4 so barrels can NEVER chain-nuke the wall
 * - High Terraces 6 timber-stilt towers, 6 stilted canvas tents, and Salt Cave 4 mine-shoring gantries
 * - 100% solid Relocated Crashed Cargo Plane hull (z <= -211) produces ZERO destruction clusters
 * - Extended 50 m Dark Storm Sewer (-5.5), High Terraces (0 / 3.6 / 7.2), Salt Cave (-2.5), Eastern Bypass (0),
 *   and Relocated Cargo Plane (1.5) are 100% mutually connected on the NavGraph from DESERT_HUB ([0, 0, 44])
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CG } from '../../core/contracts';
import { Physics } from '../../physics/Physics';
import {
  canDamageTier,
  DestructionManager,
  registerDestructionNavProxies,
} from '../destruction';
import { canDamageMaterial } from '../destructionMaterials';
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
  HIGH_TERRACES,
  LOUDSPEAKER_POLES,
  PUMP_YARD,
  SALT_CAVE,
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
  const releaseProxies = registerDestructionNavProxies(physics, spec.destructionClusters);
  try {
    await nav.build(bounds, spec.jumpLinks, DESERT_HUB, async () => {}, {
      mutual: true,
      levels: [...DESERT_LEVELS],
    });
  } finally {
    releaseProxies();
  }
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

describe('Surplus (Desert Raid 2.0) map', () => {
  it('stays strictly inside triangle, static collider, baked-light, NavGraph, and LightVolume budgets', () => {
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
    expect(triangles).toBeLessThanOrEqual(145_000);
    expect(colliders).toBeLessThanOrEqual(380);
    expect(bakedLights).toBeGreaterThanOrEqual(20);
    expect(bakedLights).toBeLessThanOrEqual(64);

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
    expect(spec.plan!.fills.length).toBeGreaterThanOrEqual(8);
    expect(spec.roads.map(r => r.id)).toEqual(['approach', 'wallLoop', 'exfil']);
    expect(spec.zones.length).toBeGreaterThanOrEqual(9);
    expect(spec.spawns).not.toBeNull();
    expect(spec.spawns!.some(s => s.kind === 'ground')).toBe(true);
    expect(spec.spawns!.some(s => s.kind === 'air')).toBe(true);
    expect(spec.pickupSpots.length).toBeGreaterThanOrEqual(12);
    expect(spec.emplacements.length).toBeGreaterThanOrEqual(1);

    for (const v of [
      'overview', 'approach', 'wall', 'warren', 'minigun',
      'pumpyard', 'sewer', 'terraces', 'cave', 'forecourt', 'plane', 'planeInterior',
    ]) {
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

  it('authors multi-material destructible structures (timber, drywall, glass, masonry, concrete), sturdy walls, watchtowers & enterable compounds', () => {
    const clusters = spec.destructionClusters;
    expect(clusters.length).toBeGreaterThan(60);

    // Every cluster uses explicit structuralMaterial & supportRole from the new destruction system
    const allNodes = clusters.flatMap(c => c.nodes);
    const mats = new Set(allNodes.map(n => n.structuralMaterial));
    expect(mats.has('timber')).toBe(true);
    expect(mats.has('drywall')).toBe(true);
    expect(mats.has('glass')).toBe(true);
    expect(mats.has('masonry')).toBe(true);
    expect(mats.has('concrete')).toBe(true);
    expect(allNodes.every(n => n.structuralMaterial !== undefined && n.supportRole !== undefined)).toBe(true);
    expect(allNodes.some(n => n.lazyFracture)).toBe(true);
    expect(allNodes.some(n => n.navWalkable)).toBe(true);
    expect(allNodes.some(n => n.navBlock)).toBe(true);

    // Material & tier gating across glass / timber / masonry / concrete
    expect(canDamageMaterial('glass', 'smg')).toBe(true);
    expect(canDamageTier(0, 'smg')).toBe(false);
    expect(canDamageTier(0, 'piledriver')).toBe(true);
    expect(canDamageTier(0, 'minigun')).toBe(true);
    expect(canDamageMaterial('masonry', 'jackal_agl')).toBe(true);
    expect(canDamageMaterial('concrete', 'piledriver')).toBe(false);
    expect(canDamageMaterial('concrete', 'satchel')).toBe(true);

    // Enterable 2-story Desert Masonry Compounds (reusing Endless War buildWarHouseCluster)
    const warHouses = clusters.filter(c => c.kind === 'war_house');
    expect(warHouses.length).toBe(2);
    for (const wh of warHouses) {
      expect(wh.batched).toBe(true);
      expect(wh.nodes.some(n => n.structuralMaterial === 'masonry')).toBe(true);
      expect(wh.nodes.some(n => n.structuralMaterial === 'drywall')).toBe(true);
      expect(wh.nodes.some(n => n.structuralMaterial === 'glass')).toBe(true);
      expect(wh.nodes.some(n => n.navWalkable)).toBe(true);
    }

    // Enterable poured-concrete Pump Control Station (Tier-2 concrete + glass + drywall + walkable roof)
    const pumpStation = clusters.find(c => c.tag === 'pumpyard.controlShack');
    expect(pumpStation).toBeDefined();
    expect(pumpStation!.nodes.some(n => n.structuralMaterial === 'concrete' && n.tier === 2)).toBe(true);
    expect(pumpStation!.nodes.some(n => n.structuralMaterial === 'glass')).toBe(true);
    expect(pumpStation!.nodes.some(n => n.structuralMaterial === 'drywall')).toBe(true);
    expect(pumpStation!.nodes.some(n => n.id === 'roof' && n.navWalkable)).toBe(true);

    // 4 Approach lookout posts at APPROACH_POSTS with red fuel drum hazards
    for (const post of APPROACH_POSTS) {
      const c = clusters.find(cl => cl.tag === post.id);
      expect(c, `Missing approach lookout cluster ${post.id}`).toBeDefined();
      expect(c!.nodes.some(n => n.kind === 'hazard' && n.tier === 0)).toBe(true);
    }

    // >= 28 sturdy corrugated metal wall panels (hp >= 240, materialClass: 'metal', fractureGrid) + 2 side gates
    const wallPanels = clusters.filter(c => c.kind === 'scrapWall');
    expect(wallPanels.length).toBeGreaterThanOrEqual(28);
    for (const wp of wallPanels) {
      const lower = wp.nodes.find(n => n.id === 'panel_lower');
      expect(lower).toBeDefined();
      expect(lower!.hp).toBeGreaterThanOrEqual(240);
      expect(lower!.materialClass).toBe('metal');
      expect(lower!.fractureGrid).toEqual([2, 2]);
      expect(wp.nodes.some(n => n.kind === 'hazard')).toBe(false);
    }
    expect(clusters.find(c => c.tag === 'wall.sidegate.west')).toBeDefined();
    expect(clusters.find(c => c.tag === 'wall.sidegate.east')).toBeDefined();

    // Anti-chain-nuke guarantee: total explosive drums (both hazard nodes & spec.explosives) along outer wall <= 4!
    let wallHazardCount = 0;
    for (const c of clusters) {
      for (const n of c.nodes) {
        const [, , z] = nodePos(n.pos);
        if (n.kind === 'hazard' && z >= 54 && z <= 70) wallHazardCount++;
      }
    }
    for (const ex of spec.explosives) {
      if (ex.pos.z >= 54 && ex.pos.z <= 70) wallHazardCount++;
    }
    expect(wallHazardCount).toBeLessThanOrEqual(4);

    // All 6 watchtowers at WALL_TOWERS with wood legs (hp 170..210) and ZERO rooftop chain barrels
    for (const tw of WALL_TOWERS) {
      const c = clusters.find(cl => cl.tag === tw.id);
      expect(c, `Missing watchtower cluster ${tw.id}`).toBeDefined();
      const legs = c!.nodes.filter(n => n.kind === 'column' && n.anchored);
      expect(legs.length).toBeGreaterThanOrEqual(4);
      for (const leg of legs) {
        expect(leg.tier).toBe(0);
        expect(leg.materialClass).toBe('wood');
        expect(leg.hp).toBeGreaterThanOrEqual(170);
        expect(leg.hp).toBeLessThanOrEqual(210);
      }
      expect(c!.nodes.some(n => n.kind === 'hazard')).toBe(false);
    }

    // >= 18 distinct Tier-0 Warren shacks with wood columns & fractured metal siding
    const shacks = clusters.filter(c => c.kind === 'warrenShack');
    expect(shacks.length).toBeGreaterThanOrEqual(18);
    for (const shack of shacks) {
      expect(shack.nodes.some(n => n.kind === 'column' && n.materialClass === 'wood')).toBe(true);
      expect(shack.nodes.some(n => n.kind === 'wall' && n.materialClass === 'metal' && n.fractureGrid)).toBe(true);
      expect(shack.nodes.some(n => n.kind === 'roof' && !n.anchored)).toBe(true);
    }

    // High Terraces: 6 timber-stilt guard towers, 6 elevated stilted canvas tents, >= 4 timber catwalks
    const terraceTowers = clusters.filter(c => c.kind === 'terraceTower');
    expect(terraceTowers.length).toBe(HIGH_TERRACES.towers.length);
    for (const tt of terraceTowers) {
      const legs = tt.nodes.filter(n => n.kind === 'column' && n.anchored && n.materialClass === 'wood');
      expect(legs.length).toBe(4);
    }
    const terraceTents = clusters.filter(c => c.kind === 'terraceTent');
    expect(terraceTents.length).toBe(HIGH_TERRACES.tents.length);
    for (const tent of terraceTents) {
      const stilts = tent.nodes.filter(n => n.kind === 'column' && n.anchored && n.materialClass === 'wood');
      expect(stilts.length).toBe(4);
    }
    expect(clusters.filter(c => c.kind === 'terraceCatwalk').length).toBeGreaterThanOrEqual(4);

    // Salt Cave: 4 destructible timber mine-shoring arch gantries
    const caveShoring = clusters.filter(c => c.kind === 'caveShoring');
    expect(caveShoring.length).toBe(4);
    for (const cs of caveShoring) {
      expect(cs.nodes.some(n => n.kind === 'column' && n.materialClass === 'wood')).toBe(true);
    }

    // Pump yard control shack + checkpoints + forecourt cover
    expect(clusters.find(c => c.tag === 'pumpyard.controlShack')).toBeDefined();
    expect(clusters.filter(c => c.kind === 'pumpCheckpoint').length).toBeGreaterThanOrEqual(3);
    expect(clusters.filter(c => c.kind === 'forecourtCover').length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the relocated Crashed Cargo Plane 100% SOLID (ZERO destruction clusters) with open ramp & bulkhead doorways', () => {
    // ZERO destruction clusters or nodes may sit inside the relocated Cargo Plane hull footprint (z <= -211, |x| <= 30)
    const planeClusters = spec.destructionClusters.filter(c =>
      c.nodes.some(n => {
        const [x, , z] = nodePos(n.pos);
        return z <= -211 && Math.abs(x) <= 30;
      }),
    );
    expect(planeClusters).toEqual([]);

    // Solid walkable cargo cabin floor at exact y = 1.5 across all 3 relocated compartments
    for (const cz of [-224, -240, -256]) {
      const floorHit = physics.raycast(V(0, CARGO_PLANE.floorY + 2.0, cz), V(0, -1, 0), 4, CG.World);
      expect(floorHit, `Missing cargo plane floor at z=${cz}`).not.toBeNull();
      expect(floorHit!.point.y).toBeCloseTo(CARGO_PLANE.floorY, 1);

      const ceilHit = physics.raycast(V(0, CARGO_PLANE.floorY + 2.0, cz), V(0, 1, 0), 6, CG.World);
      expect(ceilHit, `Missing cargo plane ceiling at z=${cz}`).not.toBeNull();
      expect(ceilHit!.point.y).toBeCloseTo(CARGO_PLANE.floorY + CARGO_PLANE.hullHeight, 1);
    }

    // Unobstructed center-aisle doorways through plane.door1 (-234) and plane.door2 (-248)
    expect(physics.raycast(V(0, CARGO_PLANE.floorY + 1.5, CARGO_PLANE.door1Z + 3), V(0, 0, -1), 6, CG.World)).toBeNull();
    expect(physics.raycast(V(0, CARGO_PLANE.floorY + 1.5, CARGO_PLANE.door2Z + 3), V(0, 0, -1), 6, CG.World)).toBeNull();

    // Solid bulkhead flanks beside door1 & door2 (x = ±2.5)
    expect(physics.raycast(V(2.5, CARGO_PLANE.floorY + 1.5, CARGO_PLANE.door1Z + 3), V(0, 0, -1), 6, CG.World)).not.toBeNull();
    expect(physics.raycast(V(-2.5, CARGO_PLANE.floorY + 1.5, CARGO_PLANE.door2Z + 3), V(0, 0, -1), 6, CG.World)).not.toBeNull();

    // Main Gate (z = 62) & Pump Yard North Arch (z = -56) remain open for runtime setpieces
    expect(physics.raycast(V(0, 2.0, DESERT_Z.wallLine + 5), V(0, 0, -1), 10, CG.World)).toBeNull();
    expect(physics.raycast(V(0, 2.0, DESERT_Z.pumpNorthGate + 5), V(0, 0, -1), 10, CG.World)).toBeNull();
  });

  it('mutually links Dunes, Wall (3.6), Warren, Pump Yard, Extended Sewer (-5.5), High Terraces (0/3.6/7.2), Salt Cave (-2.5), and Plane (1.5)', () => {
    expect(nav.nodeCount).toBeGreaterThan(20_000);
    expect(onNav(DESERT_HUB)).toBe(true);

    // Physical floor & ceiling checks for Extended Multi-Chamber Sewer (-5.5)
    const dropHit = physics.raycast(V(PUMP_YARD.sewerDropPos[0], 2.0, PUMP_YARD.sewerDropPos[2]), V(0, -1, 0), 4, CG.World);
    expect(dropHit).not.toBeNull();
    expect(dropHit!.point.y).toBeCloseTo(0, 1);

    for (const [sx, sz] of [
      [0, -34],
      [-5, -49],
      [5, -53],
      [0, -70],
      [PUMP_YARD.sewerExitBottom[0], PUMP_YARD.sewerExitBottom[2]],
    ] as const) {
      const sewerFloor = physics.raycast(V(sx, -2.5, sz), V(0, -1, 0), 5, CG.World);
      expect(sewerFloor, `Missing sewer floor at [${sx},${sz}]`).not.toBeNull();
      expect(sewerFloor!.point.y).toBeCloseTo(PUMP_YARD.sewerFloorY, 1);

      const sewerCeil = physics.raycast(V(sx, -3.5, sz), V(0, 1, 0), 4, CG.World);
      expect(sewerCeil, `Sewer ceiling leak at [${sx},${sz}]`).not.toBeNull();
      expect(sewerCeil!.point.y).toBeLessThan(-0.5);
    }

    const exitTopHit = physics.raycast(V(HIGH_TERRACES.sewerExitTop[0], 2.0, HIGH_TERRACES.sewerExitTop[2]), V(0, -1, 0), 4, CG.World);
    expect(exitTopHit).not.toBeNull();
    expect(exitTopHit!.point.y).toBeCloseTo(0, 1);

    // Physical floor & rock vault ceiling checks for Section 6: Salt Cave (-2.5)
    for (const cz of [-162, -176, -190]) {
      const caveFloor = physics.raycast(V(0, 1.0, cz), V(0, -1, 0), 6, CG.World);
      expect(caveFloor, `Missing Salt Cave floor at z=${cz}`).not.toBeNull();
      expect(caveFloor!.point.y).toBeCloseTo(SALT_CAVE.floorY, 1);

      const caveCeil = physics.raycast(V(0, 1.0, cz), V(0, 1, 0), 8, CG.World);
      expect(caveCeil, `Salt Cave ceiling leak at z=${cz}`).not.toBeNull();
      expect(caveCeil!.point.y).toBeGreaterThan(4.5);
    }

    // Eastern Convoy Bypass Road is flat y = 0 and unobstructed from Forecourt south past Cave & Terraces
    for (const [bx, bz] of [
      [48, -172],
      [50, -126],
      [48, -78],
    ] as const) {
      const bypassHit = physics.raycast(V(bx, 6.0, bz), V(0, -1, 0), 8, CG.World);
      expect(bypassHit, `Missing Eastern Bypass floor at [${bx},${bz}]`).not.toBeNull();
      expect(bypassHit!.point.y).toBeCloseTo(0, 1);
    }

    // Mutual NavGraph reachability across every key elevation & setpiece landmark
    const checkpoints: { label: string; p: THREE.Vector3 }[] = [
      { label: 'approach_start', p: V(0, 0, DESERT_Z.approachStart) },
      { label: 'wall_walkway_west', p: V(-36, 3.6, DESERT_Z.wallWalkway) },
      { label: 'wall_walkway_east', p: V(36, 3.6, DESERT_Z.wallWalkway) },
      { label: 'warren_minigun_nest', p: V(WARREN_MINIGUN.pos[0], WARREN_MINIGUN.pos[1], WARREN_MINIGUN.pos[2]) },
      { label: 'warren_masonry_west_2f', p: V(-61.8, 3.6, 22) },
      { label: 'warren_masonry_east_2f', p: V(61.8, 3.6, 34) },
      { label: 'pumpyard_control_interior', p: V(18.8, 0, -36) },
      { label: 'pumpyard_control_roof', p: V(20, 3.6, -36) },
      { label: 'pump_yard_sewer_drop', p: V(PUMP_YARD.sewerDropPos[0], PUMP_YARD.sewerDropPos[1], PUMP_YARD.sewerDropPos[2]) },
      { label: 'sewer_south', p: V(0, PUMP_YARD.sewerFloorY, -34) },
      { label: 'sewer_gallery_west', p: V(-5, PUMP_YARD.sewerFloorY, -49) },
      { label: 'sewer_gallery_east', p: V(5, PUMP_YARD.sewerFloorY, -53) },
      { label: 'sewer_exit_bottom', p: V(PUMP_YARD.sewerExitBottom[0], PUMP_YARD.sewerExitBottom[1], PUMP_YARD.sewerExitBottom[2]) },
      { label: 'terraces_sewer_exit_top', p: V(HIGH_TERRACES.sewerExitTop[0], HIGH_TERRACES.sewerExitTop[1], HIGH_TERRACES.sewerExitTop[2]) },
      { label: 'terraces_tower0_deck', p: V(HIGH_TERRACES.towers[0]![0], HIGH_TERRACES.tier2Y, HIGH_TERRACES.towers[0]![2]) },
      { label: 'terraces_tower1_deck', p: V(HIGH_TERRACES.towers[1]![0], HIGH_TERRACES.tier2Y, HIGH_TERRACES.towers[1]![2]) },
      { label: 'terraces_tier2_mid', p: V(0, HIGH_TERRACES.tier2Y, -110) },
      { label: 'terraces_tier3_west', p: V(-30, HIGH_TERRACES.tier3Y, -141) },
      { label: 'terraces_tier3_east', p: V(30, HIGH_TERRACES.tier3Y, -141) },
      { label: 'terraces_tower4_deck', p: V(HIGH_TERRACES.towers[4]![0], HIGH_TERRACES.tier3Y, HIGH_TERRACES.towers[4]![2]) },
      { label: 'terraces_tower5_deck', p: V(HIGH_TERRACES.towers[5]![0], HIGH_TERRACES.tier3Y, HIGH_TERRACES.towers[5]![2]) },
      { label: 'salt_cave_south_mouth', p: V(SALT_CAVE.southMouth[0], SALT_CAVE.southMouth[1], SALT_CAVE.southMouth[2]) },
      { label: 'salt_cave_mid', p: V(SALT_CAVE.midChamber[0], SALT_CAVE.midChamber[1], SALT_CAVE.midChamber[2]) },
      { label: 'salt_cave_north_exit', p: V(SALT_CAVE.northExit[0], SALT_CAVE.northExit[1], SALT_CAVE.northExit[2]) },
      { label: 'plane_forecourt_exfil', p: V(CARGO_PLANE.forecourtExfilPos[0], CARGO_PLANE.forecourtExfilPos[1], CARGO_PLANE.forecourtExfilPos[2]) },
      { label: 'plane_aft_bay', p: V(0, CARGO_PLANE.floorY, -224) },
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
      if (!(dTo < 1200)) broken.push(`${c.label} cannot reach hub (${dTo})`);
      if (!(dFrom < 1200)) broken.push(`hub cannot reach ${c.label} (${dFrom})`);
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

  it('validates cluster graph links, convoy/setpiece clearances, multi-material gating, and 4-pass zero-floating collapse', () => {
    for (const c of spec.destructionClusters) {
      const ids = new Set(c.nodes.map(n => n.id));
      for (const [a, b] of c.links ?? []) {
        expect(ids.has(a), `Cluster ${c.id} link references unknown node ${a}`).toBe(true);
        expect(ids.has(b), `Cluster ${c.id} link references unknown node ${b}`).toBe(true);
      }
    }

    // Convoy approach & wallLoop waypoints + water tower pad sit on clear y = 0 ground
    for (const pt of [...CONVOY_PATHS.approach, ...CONVOY_PATHS.wallLoop, PUMP_YARD.towerBase]) {
      const hit = physics.raycast(V(pt[0], 3.5, pt[2]), V(0, -1, 0), 5, CG.World);
      expect(hit, `No ground at [${pt.join(',')}]`).not.toBeNull();
      expect(hit!.point.y).toBeCloseTo(0, 1);
    }

    // Loudspeaker poles sit cleanly at their authored elevation (0 or 3.6 on High Terraces!)
    for (const pt of LOUDSPEAKER_POLES) {
      const hit = physics.raycast(V(pt[0], pt[1] + 2.5, pt[2]), V(0, -1, 0), 4, CG.World);
      expect(hit, `No floor under loudspeaker pole [${pt.join(',')}]`).not.toBeNull();
      expect(hit!.point.y).toBeCloseTo(pt[1], 1);
    }

    // Mount all clusters into a real DestructionManager and verify multi-material gating + 4-pass tipping collapse
    const stubMat = () => new THREE.MeshBasicMaterial();
    const dm = new DestructionManager({ physics } as never, stubMat);
    for (const c of spec.destructionClusters) {
      dm.addCluster(c);
    }
    expect(dm.allClusters().length).toBe(spec.destructionClusters.length);

    // 1. Timber watchtower: SMG blocked, .50-cal piledriver breaks 2 adjacent legs -> entire upper deck tips/falls (zero floating!)
    const tower = dm.getCluster('wall_tower_w1');
    expect(tower).toBeDefined();
    const legSw = tower!.getNode('leg_sw');
    const legSe = tower!.getNode('leg_se');
    expect(legSw).toBeDefined();
    expect(legSe).toBeDefined();
    expect(legSw!.tier).toBe(0);
    expect(dm.damageCollider(legSw!.staticCollider, 220, 'smg', legSw!.basePos)).toBe(true);
    expect(legSw!.state).toBe('intact');
    expect(dm.damageCollider(legSw!.staticCollider, 220, 'piledriver', legSw!.basePos)).toBe(true);
    expect(legSw!.state).not.toBe('intact');
    expect(dm.damageCollider(legSe!.staticCollider, 220, 'piledriver', legSe!.basePos)).toBe(true);
    expect(legSe!.state).not.toBe('intact');
    // After breaking 2 adjacent legs, the 4-pass solver must release the upper deck/roof (no floating parts)
    const deck = tower!.getNode('deck');
    expect(deck!.state).not.toBe('intact');

    // 2. Poured-concrete Pump Control Station: rifles & .50-cal bounce off concrete, heavy satchel breaches it, glass shatters on SMG
    const pumpStation = dm.getCluster('pumpyard.controlShack');
    expect(pumpStation).toBeDefined();
    const concreteWall = pumpStation!.getNode('wall_n');
    const obsGlass = pumpStation!.getNode('glass_s');
    expect(concreteWall).toBeDefined();
    expect(obsGlass).toBeDefined();
    expect(dm.damageCollider(concreteWall!.staticCollider, 450, 'piledriver', concreteWall!.basePos)).toBe(true);
    expect(concreteWall!.state).toBe('intact');
    expect(dm.damageCollider(concreteWall!.staticCollider, 900, 'satchel', concreteWall!.basePos)).toBe(true);
    expect(concreteWall!.state).not.toBe('intact');
    expect(dm.damageCollider(obsGlass!.staticCollider, 30, 'smg', obsGlass!.basePos)).toBe(true);
    expect(obsGlass!.state).not.toBe('intact');

    // 3. Stilted terrace tent breaks cleanly on .50-cal
    const tent = dm.getCluster('terraces.tent.0');
    expect(tent).toBeDefined();
    const stilt = tent!.getNode('stilt_sw');
    expect(stilt).toBeDefined();
    expect(dm.damageCollider(stilt!.staticCollider, 150, 'piledriver', stilt!.basePos)).toBe(true);
    expect(stilt!.state).not.toBe('intact');
    dm.dispose();
  });

  it('places all 4 hidden Desert Raid Easter egg weapon caches on reachable NavGraph nodes', () => {
    const caches: readonly [string, readonly [number, number, number]][] = [
      ['secretPiledriver', [72.5, 3.6, 58.8]],
      ['secretBillhook', [-44, 0, 2]],
      ['secretFlail', [-44, 0, -51]],
      ['secretRgl', [-35, 0, -96]],
    ];
    for (const [name, coords] of caches) {
      const p = V(coords[0], coords[1], coords[2]);
      expect(onNav(p, 2.0), `${name} at [${coords.join(', ')}] must sit on a NavGraph node`).toBe(true);
      const dist = route(DESERT_HUB, p);
      expect(Number.isFinite(dist) && dist < 999, `${name} must be mutually reachable from DESERT_HUB`).toBe(true);
    }
  });
});
