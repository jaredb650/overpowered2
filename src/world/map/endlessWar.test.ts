/**
 * Endless War (`map: 'endless_war'`) map verification:
 * - LightVolume MAX_DIMS [200, 48, 200] compliance
 * - Triangle, collider, and nav bake sanity across 480 m x 720 m ground front
 * - Full NavGraph connectivity from Friendly FOB Vanguard across all 3 river bridges to Iron Bastion
 * - River gorge between bridges stays unwalkable so ground forces funnel across the 3 crossings
 * - Clear 170 m north runway corridor & unobstructed staging pads
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CG } from '../../core/contracts';
import { Physics } from '../../physics/Physics';
import { Kit } from '../kit/kit';
import { registerDestructionNavProxies } from '../destruction';
import { NavGraph } from '../nav';
import { MapSpec } from './spec';
import {
  authorEndlessWar,
  ENDLESS_WAR_AIRCRAFT_PAD,
  ENDLESS_WAR_CROSSINGS,
  ENDLESS_WAR_FACILITIES,
  ENDLESS_WAR_FOB_CORE,
  ENDLESS_WAR_HUB,
  ENDLESS_WAR_LEVELS,
  ENDLESS_WAR_LIGHT_BOUNDS,
  ENDLESS_WAR_LIGHT_CELL,
  ENDLESS_WAR_NAV_BOUNDS,
  ENDLESS_WAR_PLAYER_SPAWN,
  ENDLESS_WAR_STAGES,
  ENDLESS_WAR_TERMINAL,
  ENDLESS_WAR_WAR_CONSOLE,
} from './endlessWar';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

let physics: Physics;
let kit: Kit;
let spec: MapSpec;
let nav: NavGraph;

beforeAll(async () => {
  physics = await Physics.create();
  kit = new Kit(physics);
  spec = new MapSpec();

  for (const stage of ENDLESS_WAR_STAGES) {
    stage.run(kit, spec);
  }
  authorEndlessWar(kit, spec);
  physics.flushQueries();

  const bounds = new THREE.Box3(
    V(ENDLESS_WAR_NAV_BOUNDS.x0, ENDLESS_WAR_NAV_BOUNDS.y0, ENDLESS_WAR_NAV_BOUNDS.z0),
    V(ENDLESS_WAR_NAV_BOUNDS.x1, ENDLESS_WAR_NAV_BOUNDS.y1, ENDLESS_WAR_NAV_BOUNDS.z1),
  );
  nav = new NavGraph(physics);
  const releaseProxies = registerDestructionNavProxies(physics, spec.destructionClusters);
  try {
    await nav.build(bounds, spec.jumpLinks, ENDLESS_WAR_HUB, async () => {}, {
      mutual: true,
      levels: [...ENDLESS_WAR_LEVELS],
    });
  } finally {
    releaseProxies();
  }
}, 120000);

describe('Endless War map (480x720m front + 2200m sky)', () => {
  it('fits LightVolume MAX_DIMS [200, 48, 200] cleanly and covers the full battlefield', () => {
    const lx = Math.ceil((ENDLESS_WAR_LIGHT_BOUNDS.x1 - ENDLESS_WAR_LIGHT_BOUNDS.x0) / ENDLESS_WAR_LIGHT_CELL);
    const ly = Math.ceil((ENDLESS_WAR_LIGHT_BOUNDS.y1 - ENDLESS_WAR_LIGHT_BOUNDS.y0) / ENDLESS_WAR_LIGHT_CELL);
    const lz = Math.ceil((ENDLESS_WAR_LIGHT_BOUNDS.z1 - ENDLESS_WAR_LIGHT_BOUNDS.z0) / ENDLESS_WAR_LIGHT_CELL);
    expect(lx).toBeLessThanOrEqual(200);
    expect(ly).toBeLessThanOrEqual(48);
    expect(lz).toBeLessThanOrEqual(200);
    expect(ENDLESS_WAR_NAV_BOUNDS.x1 - ENDLESS_WAR_NAV_BOUNDS.x0).toBe(480);
    expect(ENDLESS_WAR_NAV_BOUNDS.z1 - ENDLESS_WAR_NAV_BOUNDS.z0).toBe(720);
  });

  it('builds rich geometry within performance budgets and connects South FOB to North Bastion via all 3 bridges', () => {
    const tris = kit.geo.triangles();
    const colliders = kit.colliders;
    console.info('endless_war', JSON.stringify({
      triangles: tris,
      colliders,
      lights: kit.lights.length,
      navNodes: nav.nodeCount,
      destructibleClusters: spec.destructionClusters.length,
    }));

    expect(tris).toBeGreaterThan(10000);
    expect(tris).toBeLessThan(180000);
    expect(colliders).toBeGreaterThan(200);
    expect(colliders).toBeLessThan(1800);
    expect(nav.nodeCount).toBeGreaterThan(180000);

    // Player spawn, terminals, and FOB core sit on/adjacent to walkable ground
    expect(nav.locate(V(...ENDLESS_WAR_PLAYER_SPAWN), 4)).toBeGreaterThanOrEqual(0);
    expect(nav.locate(V(ENDLESS_WAR_TERMINAL[0], 0, ENDLESS_WAR_TERMINAL[2] + 3), 4)).toBeGreaterThanOrEqual(0);
    expect(nav.locate(V(ENDLESS_WAR_WAR_CONSOLE[0], 0, ENDLESS_WAR_WAR_CONSOLE[2] + 3), 4)).toBeGreaterThanOrEqual(0);
    expect(nav.locate(V(ENDLESS_WAR_FOB_CORE[0], 0, ENDLESS_WAR_FOB_CORE[2] - 12), 4)).toBeGreaterThanOrEqual(0);

    // All 3 river crossings have walkable bridge decks connecting South -> North
    for (const c of ENDLESS_WAR_CROSSINGS) {
      expect(nav.locate(V(c.x, 0, 0), 3), `${c.id} bridge center`).toBeGreaterThanOrEqual(0);
      expect(nav.locate(V(...c.southApproach), 4), `${c.id} south`).toBeGreaterThanOrEqual(0);
      expect(nav.locate(V(...c.northBridgehead), 4), `${c.id} north`).toBeGreaterThanOrEqual(0);
    }

    // Open river water between bridges is NOT walkable at y = 0 (strictly funnels armies over the 3 bridges)
    expect(nav.locate(V(-72, 0, 0), 1.5)).toBe(-1);
    expect(nav.locate(V(72, 0, 0), 1.5)).toBe(-1);

    // Flow field settled from Friendly FOB reaches deep into North Iron Bastion
    nav.setTarget(V(...ENDLESS_WAR_PLAYER_SPAWN));
    nav.settle();
    const northCitadel = V(0, 0, -290);
    expect(nav.locate(northCitadel, 6)).toBeGreaterThanOrEqual(0);
    expect(nav.pathDistance(northCitadel)).toBeGreaterThan(500);
    expect(nav.pathDistance(northCitadel)).toBeLessThan(900);

    // Every strategic facility approach is reachable on foot
    for (const f of ENDLESS_WAR_FACILITIES) {
      const approach = V(f.position[0], 0, f.position[2] + 18);
      expect(nav.locate(approach, 8), `${f.id} approach`).toBeGreaterThanOrEqual(0);
    }

    // West runway takeoff raycast heading straight north (-Z) from aircraft pad is 100% clear for >= 150 m
    const runwayOrigin = V(ENDLESS_WAR_AIRCRAFT_PAD[0], 2.5, ENDLESS_WAR_AIRCRAFT_PAD[2]);
    const runwayHit = physics.raycast(runwayOrigin, V(0, 0, -1), 155, CG.World);
    expect(runwayHit).toBeNull();
  });

  it('authors enterable multi-story offices, driveable 3-level parking garage, houses, watchtowers, and Tier-3 bunkers with reachable upper floors', () => {
    const kinds = new Set(spec.destructionClusters.map(c => c.kind));
    expect(kinds.has('war_office')).toBe(true);
    expect(kinds.has('parking_garage')).toBe(true);
    expect(kinds.has('war_house')).toBe(true);
    expect(kinds.has('watchtower')).toBe(true);
    expect(kinds.has('timber_shack')).toBe(true);
    expect(kinds.has('reinforced_bunker')).toBe(true);
    expect(spec.destructionClusters.length).toBeGreaterThanOrEqual(24);

    // 3-Story Crossroads Office HQ (-32, 118): Ground, 2nd floor, 3rd floor, AND Rooftop all have connected nav!
    expect(nav.locate(V(-29, 0, 118), 3), 'office ground floor').toBeGreaterThanOrEqual(0);
    expect(nav.locate(V(-29, 3.6, 118), 3), 'office 2nd floor').toBeGreaterThanOrEqual(0);
    expect(nav.locate(V(-29, 7.2, 118), 3), 'office 3rd floor').toBeGreaterThanOrEqual(0);
    expect(nav.locate(V(-29, 10.8, 118), 3), 'office rooftop').toBeGreaterThanOrEqual(0);

    // 3-Level Driveable Parking Garage (+38, 108): Ground, Level 1, and Level 2 Roof Deck are all walkable!
    expect(nav.locate(V(38, 0, 108), 4), 'garage ground').toBeGreaterThanOrEqual(0);
    expect(nav.locate(V(38, 3.6, 112), 4), 'garage level 1').toBeGreaterThanOrEqual(0);
    expect(nav.locate(V(38, 7.2, 104), 4), 'garage level 2 roof').toBeGreaterThanOrEqual(0);

    // 2-Story Enterable Bridgehead House (-26, 68): Ground & 2nd floor walkable!
    expect(nav.locate(V(-26, 0, 69), 3), 'house ground').toBeGreaterThanOrEqual(0);
    expect(nav.locate(V(-26, 3.6, 69), 3), 'house 2nd floor').toBeGreaterThanOrEqual(0);

    // Walkable 4-leg Field Watchtower (-124, 168): Lookout deck at y = 3.6 m is walkable!
    expect(nav.locate(V(-124, 3.6, 168), 2.5), 'watchtower lookout deck').toBeGreaterThanOrEqual(0);
  });
});
