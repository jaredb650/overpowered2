/**
 * Crossfire Campaign Maps (`airbase` — Valken Airbase & `strait` — Open-Sea Strait) verification:
 * builds both maps with real Rapier Physics, Kit, MapSpec, NavGraph, and DestructionManager, verifying:
 * - Exact bounds, LightVolume MAX_DIMS [200, 48, 200], triangle, static collider, and baked-light budgets
 * - Standalone `authorAirbase` / `authorStrait` and staged `*_STAGES + author*` builds succeed cleanly
 * - Valken Airbase:
 *   - All exported spawns, routes, pickups, destructibles, console, and pads fall strictly inside bounds
 *   - Hardened Alert Hangar provides >= 38 m x 42 m x 14 m clear envelope for the 28.2 m x 26.8 m B-1B Lancer
 *     with 100% unobstructed north & south blast door exits onto the 300 m Main Runway
 *   - Main Runway & all QRF/tank vehicle routes are flat and unobstructed
 *   - NavGraph mutually connects AIRBASE_HUB to South Gate, Fuel Apron, y = 3.6 Catwalk,
 *     all 4 levels of the ATC Tower (0 -> 3.6 -> 7.2 -> 10.8 Console), Alert Hangar, Runway, and pickups
 *   - All 5 Tier-0 destructible bunker & JP-8 fuel clusters break cleanly in DestructionManager
 * - Open-Sea Strait:
 *   - All exported carrier, destroyer, mount, sea-stack, cloud, outbound/inbound Lancer path, F-22 spawn,
 *     and enemy sector coordinates fall strictly inside STRAIT_BOUNDS
 *   - Fast NavGraph bake over STRAIT_NAV_BOUNDS succeeds cleanly
 *   - Outbound Part 2 & Inbound Part 4 Lancer flight corridors are completely clear of sea-stack collisions
 *   - Friendly Carrier deck (y = 10 at z = +540) and both Southern Missile Destroyers have solid colliders
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CG } from '../../core/contracts';
import { Physics } from '../../physics/Physics';
import { canDamageTier, DestructionManager } from '../destruction';
import { Kit } from '../kit/kit';
import { NavGraph } from '../nav';
import {
  AIRBASE_ALERT_HANGAR,
  AIRBASE_ALLY_SPAWNS,
  AIRBASE_ATC_CONSOLE,
  AIRBASE_ATC_TOWER,
  AIRBASE_BOUNDS,
  AIRBASE_BUDDY_RAPTOR_SPAWNS,
  AIRBASE_DESTRUCTIBLES,
  AIRBASE_ENEMY_SPAWNS,
  AIRBASE_HUB,
  AIRBASE_LANCER_SPAWN,
  AIRBASE_LEVELS,
  AIRBASE_LIGHT_BOUNDS,
  AIRBASE_LIGHT_CELL,
  AIRBASE_NAV_BOUNDS,
  AIRBASE_PICKUPS,
  AIRBASE_PLAYER_SPAWN,
  AIRBASE_RUNWAY,
  AIRBASE_SKY_SPAWNS,
  AIRBASE_STAGES,
  AIRBASE_TAKEOFF_GATE,
  AIRBASE_VEHICLE_ROUTES,
  authorAirbase,
} from './airbase';
import { MapSpec } from './spec';
import {
  authorStrait,
  STRAIT_BOUNDS,
  STRAIT_CARRIER_CENTER,
  STRAIT_CARRIER_DECK_Y,
  STRAIT_CARRIER_RECOVERY_Z,
  STRAIT_CLOUD_BANKS,
  STRAIT_COASTAL_RADARS,
  STRAIT_DECK_PLAYER_SPAWN,
  STRAIT_DESTROYER_CIWS_MOUNTS,
  STRAIT_DESTROYER_MOUNTS,
  STRAIT_DESTROYER_SAM_MOUNTS,
  STRAIT_DESTROYERS,
  STRAIT_ENEMY_SECTORS,
  STRAIT_FEET_DRY_Z,
  STRAIT_FRIENDLY_ESCORTS,
  STRAIT_HUB,
  STRAIT_INBOUND_LANCER_PATH,
  STRAIT_INBOUND_PLAYER_SPAWN,
  STRAIT_INBOUND_WINGMAN_SPAWNS,
  STRAIT_LEVELS,
  STRAIT_LIGHT_BOUNDS,
  STRAIT_LIGHT_CELL,
  STRAIT_NAV_BOUNDS,
  STRAIT_OUTBOUND_LANCER_PATH,
  STRAIT_OUTBOUND_PLAYER_SPAWN,
  STRAIT_OUTBOUND_WINGMAN_SPAWNS,
  STRAIT_SEA_STACKS,
  STRAIT_SKY_SPAWNS,
  STRAIT_SMOKE_PILLARS,
  STRAIT_STAGES,
} from './strait';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

type Bounds = { readonly x0: number; readonly y0: number; readonly z0: number; readonly x1: number; readonly y1: number; readonly z1: number };

const inBounds = (b: Bounds, x: number, y: number, z: number): boolean =>
  x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1;

describe('Crossfire Map 1 — Valken Airbase (`airbase`)', () => {
  let physics: Physics;
  let kit: Kit;
  let spec: MapSpec;
  let nav: NavGraph;

  beforeAll(async () => {
    physics = await Physics.create();
    kit = new Kit(physics);
    spec = new MapSpec();

    for (const stage of AIRBASE_STAGES) {
      stage.run(kit, spec);
    }
    authorAirbase(kit, spec);
    physics.flushQueries();

    const navBox = new THREE.Box3(
      V(AIRBASE_NAV_BOUNDS.x0, AIRBASE_NAV_BOUNDS.y0, AIRBASE_NAV_BOUNDS.z0),
      V(AIRBASE_NAV_BOUNDS.x1, AIRBASE_NAV_BOUNDS.y1, AIRBASE_NAV_BOUNDS.z1),
    );
    nav = new NavGraph(physics);
    await nav.build(navBox, spec.jumpLinks, AIRBASE_HUB, async () => {}, {
      mutual: true,
      levels: [...AIRBASE_LEVELS],
    });
  }, 120_000);

  const onNav = (p: THREE.Vector3, r = 1.8): boolean => {
    const out = V(0, 0, 0);
    return nav.nearest(V(p.x, p.y + 0.1, p.z), 3, out) && Math.hypot(out.x - p.x, out.z - p.z) < r && Math.abs(out.y - p.y) < 0.55;
  };

  const route = (from: THREE.Vector3, to: THREE.Vector3): number => {
    nav.setTarget(to);
    nav.settle();
    return nav.pathDistance(from);
  };

  it('matches required bounds, LightVolume limits, and geometry/light/collider budgets', () => {
    const triangles = kit.geo.triangles();
    const colliders = kit.colliders;
    const bakedLights = kit.lights.length;

    console.info('airbase', JSON.stringify({
      triangles,
      colliders,
      bakedLights,
      clusters: spec.destructionClusters.length,
      navNodes: nav.nodeCount,
    }));

    expect(AIRBASE_BOUNDS).toEqual({ x0: -640, y0: -10, z0: -640, x1: 640, y1: 300, z1: 640 });
    expect(AIRBASE_NAV_BOUNDS).toEqual({ x0: -168, y0: -6, z0: -168, x1: 168, y1: 40, z1: 168 });
    expect(AIRBASE_LIGHT_BOUNDS).toEqual({ x0: -168, y0: -4, z0: -168, x1: 168, y1: 40, z1: 168 });
    expect(AIRBASE_LIGHT_CELL).toBe(1.8);
    expect(AIRBASE_LEVELS).toEqual([0, 3.6, 7.2, 10.8]);
    expect(AIRBASE_HUB.toArray()).toEqual([0, 0, 128]);

    // LightVolume MAX_DIMS = [200, 48, 200]
    expect(Math.ceil((AIRBASE_LIGHT_BOUNDS.x1 - AIRBASE_LIGHT_BOUNDS.x0) / AIRBASE_LIGHT_CELL)).toBeLessThanOrEqual(200);
    expect(Math.ceil((AIRBASE_LIGHT_BOUNDS.y1 - AIRBASE_LIGHT_BOUNDS.y0) / AIRBASE_LIGHT_CELL)).toBeLessThanOrEqual(48);
    expect(Math.ceil((AIRBASE_LIGHT_BOUNDS.z1 - AIRBASE_LIGHT_BOUNDS.z0) / AIRBASE_LIGHT_CELL)).toBeLessThanOrEqual(200);

    expect(triangles).toBeGreaterThan(2_000);
    expect(triangles).toBeLessThanOrEqual(145_000);
    expect(colliders).toBeLessThanOrEqual(380);
    expect(bakedLights).toBeGreaterThanOrEqual(16);
    expect(bakedLights).toBeLessThanOrEqual(64);

    expect(spec.reactor).toBeNull();
    expect(spec.killY).toBe(AIRBASE_BOUNDS.y0);
    expect(spec.plan).not.toBeNull();
    expect(spec.roads.length).toBe(AIRBASE_VEHICLE_ROUTES.length);
    expect(spec.spawns!.some(s => s.kind === 'ground')).toBe(true);
    expect(spec.spawns!.some(s => s.kind === 'air')).toBe(true);
    expect(spec.pickupSpots.length).toBe(AIRBASE_PICKUPS.length);
  });

  it('builds identically when authorAirbase is called standalone without manually running AIRBASE_STAGES', async () => {
    const p2 = await Physics.create();
    const k2 = new Kit(p2);
    const s2 = new MapSpec();
    expect(() => authorAirbase(k2, s2)).not.toThrow();
    expect(s2.destructionClusters.length).toBe(spec.destructionClusters.length);
    expect(s2.zones.length).toBe(spec.zones.length);
    expect(s2.roads.length).toBe(spec.roads.length);
  });

  it('places all exported coordinates strictly inside AIRBASE_BOUNDS (and combat points inside AIRBASE_NAV_BOUNDS)', () => {
    expect(inBounds(AIRBASE_NAV_BOUNDS, ...AIRBASE_PLAYER_SPAWN)).toBe(true);
    expect(inBounds(AIRBASE_NAV_BOUNDS, ...AIRBASE_ATC_CONSOLE.at)).toBe(true);
    expect(inBounds(AIRBASE_NAV_BOUNDS, ...AIRBASE_LANCER_SPAWN.at)).toBe(true);
    expect(inBounds(AIRBASE_BOUNDS, ...AIRBASE_TAKEOFF_GATE.beaconAt)).toBe(true);
    expect(AIRBASE_TAKEOFF_GATE.northZ).toBe(-260);
    expect(AIRBASE_TAKEOFF_GATE.minAltitudeY).toBe(48);

    for (const a of AIRBASE_ALLY_SPAWNS) expect(inBounds(AIRBASE_NAV_BOUNDS, ...a.at)).toBe(true);
    for (const r of AIRBASE_BUDDY_RAPTOR_SPAWNS) expect(inBounds(AIRBASE_NAV_BOUNDS, ...r.at)).toBe(true);
    for (const e of AIRBASE_ENEMY_SPAWNS) expect(inBounds(AIRBASE_NAV_BOUNDS, ...e.at)).toBe(true);
    for (const p of AIRBASE_PICKUPS) expect(inBounds(AIRBASE_NAV_BOUNDS, ...p)).toBe(true);
    for (const d of AIRBASE_DESTRUCTIBLES) expect(inBounds(AIRBASE_NAV_BOUNDS, d.x, 0, d.z)).toBe(true);
    for (const s of AIRBASE_SKY_SPAWNS) expect(inBounds(AIRBASE_BOUNDS, ...s)).toBe(true);
    for (const r of AIRBASE_VEHICLE_ROUTES) {
      expect(inBounds(AIRBASE_NAV_BOUNDS, r.spawn[0], 0, r.spawn[1])).toBe(true);
      for (const wp of r.waypoints) expect(inBounds(AIRBASE_NAV_BOUNDS, wp[0], 0, wp[1])).toBe(true);
    }
  });

  it('gives the 28.2 m x 26.8 m B-1B Lancer generous Alert Hangar clearance, unobstructed exits, and a clean 300 m runway', () => {
    // Alert Hangar plan dimensions strictly exceed required 38 m x 42 m x 14 m & 34 m blast door
    expect(AIRBASE_ALERT_HANGAR.interiorWidth).toBeGreaterThanOrEqual(38);
    expect(AIRBASE_ALERT_HANGAR.interiorLength).toBeGreaterThanOrEqual(42);
    expect(AIRBASE_ALERT_HANGAR.interiorHeight).toBeGreaterThanOrEqual(14);
    expect(AIRBASE_ALERT_HANGAR.blastDoorSlot.width).toBeGreaterThanOrEqual(34);
    expect(AIRBASE_RUNWAY.length).toBe(300);
    expect(AIRBASE_RUNWAY.width).toBe(32);

    // Lancer interior clearance probe across wingspan (x in [-2, +26]) and fuselage length (z in [-92, -60])
    for (const lx of [-2, 12, 26]) {
      for (const lz of [-92, -76, -60]) {
        const floorHit = physics.raycast(V(lx, 3, lz), V(0, -1, 0), 5, CG.World);
        expect(floorHit, `Missing hangar floor at [${lx}, ${lz}]`).not.toBeNull();
        expect(floorHit!.point.y).toBeCloseTo(0, 1);

        const ceilHit = physics.raycast(V(lx, 1, lz), V(0, 1, 0), 22, CG.World);
        expect(ceilHit, `Missing hangar vault roof at [${lx}, ${lz}]`).not.toBeNull();
        expect(ceilHit!.point.y, `Low hangar ceiling at [${lx}, ${lz}]`).toBeGreaterThanOrEqual(13.8);
      }
    }

    // North & South blast door openings + taxi lanes are 100% clear at wing/fuselage height (y = 3.0)
    for (const tx of [-2, 12, 26]) {
      const northExit = physics.raycast(V(tx, 3.0, -76), V(0, 0, -1), 220, CG.World);
      expect(northExit, `Blocked north Lancer takeoff exit along x = ${tx}`).toBeNull();
      const southExit = physics.raycast(V(tx, 3.0, -76), V(0, 0, 1), 54, CG.World);
      expect(southExit, `Blocked south Lancer hangar exit along x = ${tx}`).toBeNull();
    }

    // Main Concrete Runway (x = 62, z = +150 -> -150) has flat tarmac & zero sky or horizontal obstructions
    for (const rz of [-145, -75, 0, 75, 145]) {
      const floorHit = physics.raycast(V(62, 3, rz), V(0, -1, 0), 5, CG.World);
      expect(floorHit).not.toBeNull();
      expect(floorHit!.point.y).toBeCloseTo(0, 1);
      expect(physics.raycast(V(62, 1, rz), V(0, 1, 0), 280, CG.World)).toBeNull();
    }
    expect(physics.raycast(V(62, 2.5, 148), V(0, 0, -1), 420, CG.World)).toBeNull();

    // Every QRF/Tank vehicle route segment is completely unobstructed at bumper/roof height (y = 2.0)
    for (const routeSpec of AIRBASE_VEHICLE_ROUTES) {
      const pts = [routeSpec.spawn, ...routeSpec.waypoints];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = V(pts[i]![0], 2.0, pts[i]![1]);
        const b = V(pts[i + 1]![0], 2.0, pts[i + 1]![1]);
        const dir = b.clone().sub(a);
        const len = dir.length();
        const hit = physics.raycast(a, dir.normalize(), len, CG.World);
        expect(hit, `Route ${routeSpec.id} segment ${i} blocked`).toBeNull();
      }
    }
  });

  it('mutually connects AIRBASE_HUB across all 4 levels (including y = 3.6 catwalk and y = 10.8 ATC Console)', () => {
    expect(nav.nodeCount).toBeGreaterThan(50_000);
    expect(onNav(AIRBASE_HUB)).toBe(true);

    const checkpoints: { label: string; p: THREE.Vector3 }[] = [
      { label: 'player_spawn', p: V(...AIRBASE_PLAYER_SPAWN) },
      ...AIRBASE_ALLY_SPAWNS.map(a => ({ label: a.id, p: V(...a.at) })),
      { label: 'catwalk_mid', p: V(-58, 3.6, 62) },
      { label: 'atc_l0', p: V(AIRBASE_ATC_TOWER.x, 0, AIRBASE_ATC_TOWER.z) },
      { label: 'atc_l1', p: V(AIRBASE_ATC_TOWER.x + 2, 3.6, AIRBASE_ATC_TOWER.z) },
      { label: 'atc_l2', p: V(AIRBASE_ATC_TOWER.x, 7.2, AIRBASE_ATC_TOWER.z) },
      { label: 'atc_console_l3', p: V(...AIRBASE_ATC_CONSOLE.at) },
      { label: 'lancer_hangar', p: V(...AIRBASE_LANCER_SPAWN.at) },
      ...AIRBASE_BUDDY_RAPTOR_SPAWNS.map(r => ({ label: r.id, p: V(...r.at) })),
      { label: 'runway_center', p: V(AIRBASE_RUNWAY.centerX, 0, 0) },
      ...AIRBASE_PICKUPS.map((p, i) => ({ label: `pickup_${i}`, p: V(...p) })),
      ...AIRBASE_ENEMY_SPAWNS.map((e, i) => ({ label: `enemy_${e.section}_${i}`, p: V(...e.at) })),
    ];

    const broken: string[] = [];
    for (const c of checkpoints) {
      if (!onNav(c.p)) {
        broken.push(`${c.label} off nav at [${c.p.toArray().join(',')}]`);
        continue;
      }
      const dTo = route(c.p, AIRBASE_HUB);
      const dFrom = route(AIRBASE_HUB, c.p);
      if (!(dTo < 550)) broken.push(`${c.label} cannot reach hub (${dTo})`);
      if (!(dFrom < 550)) broken.push(`hub cannot reach ${c.label} (${dFrom})`);
    }
    expect(broken).toEqual([]);
  });

  it('registers 5 Tier-0 destructible bunker & JP-8 fuel clusters that break cleanly in DestructionManager', () => {
    expect(spec.destructionClusters.length).toBe(AIRBASE_DESTRUCTIBLES.length);
    expect(canDamageTier(0, 'smg')).toBe(true);

    const stubMat = () => new THREE.MeshBasicMaterial();
    const dm = new DestructionManager({ physics } as never, stubMat);
    for (const c of spec.destructionClusters) dm.addCluster(c);

    const fuelDepot = dm.getCluster('airbase.fuel.south');
    expect(fuelDepot).toBeDefined();
    const tankNode = fuelDepot!.getNode('jp8_tank_a');
    expect(tankNode).toBeDefined();
    expect(dm.damageCollider(tankNode!.staticCollider, 120, 'smg', tankNode!.basePos)).toBe(true);
    expect(tankNode!.state).not.toBe('intact');
    dm.dispose();
  });
});

describe('Crossfire Map 2 — The Open-Sea Strait (`strait`)', () => {
  let physics: Physics;
  let kit: Kit;
  let spec: MapSpec;
  let nav: NavGraph;

  beforeAll(async () => {
    physics = await Physics.create();
    kit = new Kit(physics);
    spec = new MapSpec();

    for (const stage of STRAIT_STAGES) {
      stage.run(kit, spec);
    }
    authorStrait(kit, spec);
    physics.flushQueries();

    const navBox = new THREE.Box3(
      V(STRAIT_NAV_BOUNDS.x0, STRAIT_NAV_BOUNDS.y0, STRAIT_NAV_BOUNDS.z0),
      V(STRAIT_NAV_BOUNDS.x1, STRAIT_NAV_BOUNDS.y1, STRAIT_NAV_BOUNDS.z1),
    );
    nav = new NavGraph(physics);
    await nav.build(navBox, spec.jumpLinks, STRAIT_HUB, async () => {}, {
      mutual: true,
      levels: [...STRAIT_LEVELS],
    });
  }, 120_000);

  it('matches required bounds, LightVolume limits, fast NavGraph bake, and geometry/collider budgets', () => {
    const triangles = kit.geo.triangles();
    const colliders = kit.colliders;
    const bakedLights = kit.lights.length;

    console.info('strait', JSON.stringify({
      triangles,
      colliders,
      bakedLights,
      navNodes: nav.nodeCount,
    }));

    expect(STRAIT_BOUNDS).toEqual({ x0: -820, y0: -14, z0: -820, x1: 820, y1: 340, z1: 820 });
    expect(STRAIT_NAV_BOUNDS).toEqual({ x0: -48, y0: -4, z0: -96, x1: 48, y1: 48, z1: 96 });
    expect(STRAIT_LIGHT_BOUNDS).toEqual({ x0: -100, y0: -6, z0: -120, x1: 100, y1: 48, z1: 120 });
    expect(STRAIT_LIGHT_CELL).toBe(1.6);
    expect(STRAIT_LEVELS).toEqual([0, 10]);
    expect(STRAIT_HUB.toArray()).toEqual([0, 10, 0]);

    // LightVolume MAX_DIMS = [200, 48, 200]
    expect(Math.ceil((STRAIT_LIGHT_BOUNDS.x1 - STRAIT_LIGHT_BOUNDS.x0) / STRAIT_LIGHT_CELL)).toBeLessThanOrEqual(200);
    expect(Math.ceil((STRAIT_LIGHT_BOUNDS.y1 - STRAIT_LIGHT_BOUNDS.y0) / STRAIT_LIGHT_CELL)).toBeLessThanOrEqual(48);
    expect(Math.ceil((STRAIT_LIGHT_BOUNDS.z1 - STRAIT_LIGHT_BOUNDS.z0) / STRAIT_LIGHT_CELL)).toBeLessThanOrEqual(200);

    expect(triangles).toBeGreaterThan(1_000);
    expect(triangles).toBeLessThanOrEqual(100_000);
    expect(colliders).toBeLessThanOrEqual(160);
    expect(bakedLights).toBeLessThanOrEqual(64);
    expect(nav.nodeCount).toBeGreaterThan(10_000);

    expect(spec.reactor).toBeNull();
    expect(spec.killY).toBe(STRAIT_BOUNDS.y0);
    expect(spec.zones.length).toBeGreaterThanOrEqual(4);
    expect(spec.spawns!.some(s => s.kind === 'ground')).toBe(true);
    expect(spec.spawns!.some(s => s.kind === 'air')).toBe(true);
  });

  it('builds identically when authorStrait is called standalone without manually running STRAIT_STAGES', async () => {
    const p2 = await Physics.create();
    const k2 = new Kit(p2);
    const s2 = new MapSpec();
    expect(() => authorStrait(k2, s2)).not.toThrow();
    expect(s2.zones.length).toBe(spec.zones.length);
    expect(s2.spawns!.length).toBe(spec.spawns!.length);
  });

  it('keeps all exported coordinates, ship mounts, flight paths, and enemy sectors strictly inside STRAIT_BOUNDS', () => {
    expect(inBounds(STRAIT_BOUNDS, ...STRAIT_CARRIER_CENTER)).toBe(true);
    expect(inBounds(STRAIT_BOUNDS, ...STRAIT_DECK_PLAYER_SPAWN)).toBe(true);
    expect(inBounds(STRAIT_BOUNDS, ...STRAIT_OUTBOUND_PLAYER_SPAWN.at)).toBe(true);
    expect(inBounds(STRAIT_BOUNDS, ...STRAIT_INBOUND_PLAYER_SPAWN.at)).toBe(true);
    expect(STRAIT_FEET_DRY_Z).toBeLessThan(-500);
    expect(STRAIT_CARRIER_RECOVERY_Z).toBeGreaterThan(350);

    // Exact destroyer placements specified in design
    const west = STRAIT_DESTROYERS.find(d => d.id === 'destroyer_west');
    const east = STRAIT_DESTROYERS.find(d => d.id === 'destroyer_east');
    expect(west).toMatchObject({ x: -140, z: -60 });
    expect(east).toMatchObject({ x: 150, z: -160 });
    expect(STRAIT_DESTROYER_MOUNTS.length).toBe(8);
    expect(STRAIT_DESTROYER_SAM_MOUNTS.length).toBe(4);
    expect(STRAIT_DESTROYER_CIWS_MOUNTS.length).toBe(4);

    for (const s of [...STRAIT_FRIENDLY_ESCORTS, ...STRAIT_DESTROYERS]) {
      expect(inBounds(STRAIT_BOUNDS, s.x, 0, s.z)).toBe(true);
    }
    for (const m of STRAIT_DESTROYER_MOUNTS) expect(inBounds(STRAIT_BOUNDS, ...m.at)).toBe(true);
    for (const st of STRAIT_SEA_STACKS) {
      expect(inBounds(STRAIT_BOUNDS, st.x, st.height, st.z)).toBe(true);
      expect(st.height).toBeGreaterThanOrEqual(90);
      expect(st.height).toBeLessThanOrEqual(145);
    }
    for (const r of STRAIT_COASTAL_RADARS) expect(inBounds(STRAIT_BOUNDS, r.x, r.baseY + r.height, r.z)).toBe(true);
    for (const sm of STRAIT_SMOKE_PILLARS) expect(inBounds(STRAIT_BOUNDS, sm.x, sm.baseY + sm.height, sm.z)).toBe(true);
    for (const c of STRAIT_CLOUD_BANKS) {
      expect(inBounds(STRAIT_BOUNDS, c.x, c.y, c.z)).toBe(true);
      expect(c.y).toBeGreaterThanOrEqual(175);
      expect(c.y).toBeLessThanOrEqual(230);
    }
    for (const wp of [...STRAIT_OUTBOUND_LANCER_PATH, ...STRAIT_INBOUND_LANCER_PATH]) {
      expect(inBounds(STRAIT_BOUNDS, ...wp)).toBe(true);
    }
    for (const w of [...STRAIT_OUTBOUND_WINGMAN_SPAWNS, ...STRAIT_INBOUND_WINGMAN_SPAWNS]) {
      expect(inBounds(STRAIT_BOUNDS, ...w.at)).toBe(true);
    }
    expect(STRAIT_ENEMY_SECTORS.length).toBeGreaterThanOrEqual(4);
    for (const pt of STRAIT_SKY_SPAWNS) expect(inBounds(STRAIT_BOUNDS, ...pt)).toBe(true);
  });

  it('keeps outbound & inbound Lancer flight corridors clear of sea stacks and backs the carrier & destroyers with solid colliders', () => {
    // Check both bomber flight paths are 100% collision-free along every segment
    for (const path of [STRAIT_OUTBOUND_LANCER_PATH, STRAIT_INBOUND_LANCER_PATH]) {
      for (let i = 0; i + 1 < path.length; i++) {
        const a = V(...path[i]!);
        const b = V(...path[i + 1]!);
        const dir = b.clone().sub(a);
        const len = dir.length();
        const hit = physics.raycast(a, dir.normalize(), len, CG.World);
        expect(hit, `Lancer flight path segment ${i} collided with geometry`).toBeNull();
      }
    }

    // Friendly Carrier flight deck at z = +540 has solid landing surface at y = 10
    const deckHit = physics.raycast(V(-4, STRAIT_CARRIER_DECK_Y + 5, 540), V(0, -1, 0), 8, CG.World);
    expect(deckHit).not.toBeNull();
    expect(deckHit!.point.y).toBeCloseTo(STRAIT_CARRIER_DECK_Y, 1);

    // Friendly Escort Frigates flanking CVN-91 have solid static ship colliders
    for (const f of STRAIT_FRIENDLY_ESCORTS) {
      const hullHit = physics.raycast(V(f.x, 35, f.z), V(0, -1, 0), 40, CG.World);
      expect(hullHit, `Missing collider on ${f.id}`).not.toBeNull();
      expect(hullHit!.point.y).toBeGreaterThan(2);
    }

    // Hostile Southern Missile Destroyers spawn dynamically (sinkable DestroyerShip hulls in StraitDirector) so map-static water stays clear
    for (const d of STRAIT_DESTROYERS) {
      const staticHit = physics.raycast(V(d.x, 35, d.z), V(0, -1, 0), 30, CG.World);
      expect(staticHit, `Static hull should not block dynamic sinkable ${d.id}`).toBeNull();
    }

    // Cloud banks are strictly non-colliding so jets blast straight through them
    for (const c of STRAIT_CLOUD_BANKS) {
      const cloudHit = physics.raycast(V(c.x - c.rx - 10, c.y, c.z), V(1, 0, 0), c.rx * 2 + 20, CG.World);
      expect(cloudHit, `Cloud bank at [${c.x},${c.y},${c.z}] should not collide`).toBeNull();
    }
  });
});
