/**
 * Brine Central Reserve & Coastal Elevated Expressway ("Bank Run", Mission 4) map verification:
 * builds the real map with Rapier physics, Kit, MapSpec, and multi-level NavGraph, verifying:
 * - Hard geometry, static collider, baked-light, and LightVolume budgets
 * - Tier-1 destructible `bank.skylight` StructuralClusterSpec damageable by 'satchel' & 'breach_charge'
 * - Breakable glass teller panes in the Grand Banking Hall
 * - Clean mutual multi-level NavGraph connectivity from BANK_HUB ([0, 0, 8]) to Rooftop Helipad,
 *   Mezzanine Security Office, Vault Antechamber, Bullion Vault Interior, Front Plaza, and all key spawns
 * - Physically open skylight shaft below SKYLIGHT_CENTER (raycast from [0, 13.4, 2] hits y = 0 floor)
 * - Unobstructed Vault Door aperture & static Coastal Elevated Expressway deck physics
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CG } from '../../core/contracts';
import { Physics } from '../../physics/Physics';
import { canDamageTier } from '../destruction';
import { Kit } from '../kit/kit';
import { NavGraph } from '../nav';
import {
  authorBank,
  BANK_BOUNDS,
  BANK_HUB,
  BANK_KILL_Y,
  BANK_LEVELS,
  BANK_LIGHT_BOUNDS,
  BANK_LIGHT_CELL,
  BANK_STAGES,
  DRILL_FLOOR_POS,
  GOLD_PALLETS,
  GROUND_SPAWNS,
  HIGHWAY_LANES,
  HIGHWAY_ORIGIN,
  HUMVEE_PARK_POS,
  LV,
  MGL_RACK_POS,
  PICKUP_SPOTS,
  PLAYER_SPAWNS,
  ROOF_HELIPAD,
  SABOT_RACK_POS,
  SKYLIGHT_BOUNDS,
  SKYLIGHT_CENTER,
} from './bank';
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

  for (const stage of BANK_STAGES) {
    stage.run(kit, spec);
  }
  authorBank(kit, spec);
  physics.flushQueries();

  const bounds = new THREE.Box3(
    V(BANK_BOUNDS.x0, BANK_BOUNDS.y0, BANK_BOUNDS.z0),
    V(BANK_BOUNDS.x1, BANK_BOUNDS.y1, BANK_BOUNDS.z1),
  );
  nav = new NavGraph(physics);
  await nav.build(bounds, spec.jumpLinks, BANK_HUB, async () => {}, {
    mutual: true,
    levels: BANK_LEVELS,
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

describe('Brine Central Reserve (Bank Run) map', () => {
  it('stays well inside triangle, static collider, baked-light, NavGraph, and LightVolume budgets', () => {
    const triangles = kit.geo.triangles();
    const colliders = kit.colliders;
    const bakedLights = kit.lights.length;

    console.info('bank', JSON.stringify({
      triangles,
      colliders,
      bakedLights,
      breakables: spec.breakables.length,
      clusters: spec.destructionClusters.length,
      navNodes: nav.nodeCount,
    }));

    expect(triangles).toBeGreaterThan(4_000);
    expect(triangles).toBeLessThan(400_000);
    expect(colliders).toBeLessThan(950);
    expect(bakedLights).toBeGreaterThanOrEqual(12);
    expect(bakedLights).toBeLessThanOrEqual(60);

    // Exact shared coordinate contract
    expect(spec.killY).toBe(BANK_KILL_Y);
    expect(BANK_LEVELS).toEqual([-1.5, 0, 5.5, 14]);
    expect(BANK_HUB.toArray()).toEqual([0, 0, 8]);

    // NavGraph hard Y limits: TOP_Y = 118, BOTTOM_Y = -19
    expect(BANK_BOUNDS.y1).toBeLessThanOrEqual(118);
    expect(BANK_BOUNDS.y0).toBeGreaterThanOrEqual(-19);

    // LightVolume hard limits: MAX_DIMS = [200, 48, 200] at BANK_LIGHT_CELL = 1.5
    const lx = BANK_LIGHT_BOUNDS.x1 - BANK_LIGHT_BOUNDS.x0;
    const ly = BANK_LIGHT_BOUNDS.y1 - BANK_LIGHT_BOUNDS.y0;
    const lz = BANK_LIGHT_BOUNDS.z1 - BANK_LIGHT_BOUNDS.z0;
    expect(Math.ceil(lx / BANK_LIGHT_CELL)).toBeLessThanOrEqual(200);
    expect(Math.ceil(ly / BANK_LIGHT_CELL)).toBeLessThanOrEqual(48);
    expect(Math.ceil(lz / BANK_LIGHT_CELL)).toBeLessThanOrEqual(200);

    // Required views exported
    for (const v of ['overview', 'roof', 'skylight', 'atrium', 'mezzanine', 'vaultDoor', 'vault', 'plaza', 'highway']) {
      expect(spec.views[v], `Missing spec.views.${v}`).toBeDefined();
    }
  });

  it('registers Tier-1 destructible bank.skylight cluster and breakable teller glass panes', () => {
    const skylight = spec.destructionClusters.find(c => c.tag === 'bank.skylight');
    expect(skylight).toBeDefined();
    expect(skylight!.id).toBe('bank.skylight');
    expect(skylight!.kind).toBe('skylight');
    expect(skylight!.label).toBe('ATRIUM SKYLIGHT DOME');
    expect(skylight!.value).toBe(85_000);
    expect(skylight!.nodes.length).toBeGreaterThanOrEqual(5);

    for (const node of skylight!.nodes) {
      expect(node.tier).toBe(1);
    }
    expect(canDamageTier(1, 'satchel')).toBe(true);
    expect(canDamageTier(1, 'breach_charge')).toBe(true);

    // Breakable glass teller panes in the Grand Banking Hall (west & east teller counters)
    const tellerPanes = spec.breakables.filter(
      b => b.kind === 'pane' && !b.flat && b.y > 1.0 && b.y < 3.5 && Math.abs(Math.abs(b.x) - 14.25) < 1.0,
    );
    expect(tellerPanes.length).toBeGreaterThanOrEqual(8);
  });

  it('leaves an open skylight drop shaft straight down to the y = 0 banking hall floor and solid expressway deck physics', () => {
    // Raycast straight down from [0, 13.4, 2] (just beneath SKYLIGHT_CENTER = [0, 14, 2]) must hit y = 0 hall floor!
    const shaftOrigin = V(SKYLIGHT_CENTER[0], LV.roof - 0.6, SKYLIGHT_CENTER[2]);
    const shaftHit = physics.raycast(shaftOrigin, V(0, -1, 0), 20, CG.World);
    expect(shaftHit).not.toBeNull();
    expect(shaftHit!.point.y).toBeCloseTo(LV.hall, 1);

    // Also verify all 4 inner corners of SKYLIGHT_BOUNDS drop cleanly to y = 0
    for (const [cx, cz] of [
      [SKYLIGHT_BOUNDS.x0 + 0.8, SKYLIGHT_BOUNDS.z0 + 0.8],
      [SKYLIGHT_BOUNDS.x1 - 0.8, SKYLIGHT_BOUNDS.z0 + 0.8],
      [SKYLIGHT_BOUNDS.x0 + 0.8, SKYLIGHT_BOUNDS.z1 - 0.8],
      [SKYLIGHT_BOUNDS.x1 - 0.8, SKYLIGHT_BOUNDS.z1 - 0.8],
    ] as const) {
      const hit = physics.raycast(V(cx, LV.roof - 0.6, cz), V(0, -1, 0), 20, CG.World);
      expect(hit).not.toBeNull();
      expect(hit!.point.y).toBeCloseTo(LV.hall, 1);
    }

    // Vault doorway aperture at z = -32 is unobstructed horizontally for VaultDrill
    const vaultRay = physics.raycast(V(0, LV.vault + 1.5, -28), V(0, 0, -1), 10, CG.World);
    expect(vaultRay).toBeNull();

    // Offset Coastal Elevated Expressway static asphalt deck at y = 12 has real road physics across all 4 lanes
    for (const laneX of HIGHWAY_LANES) {
      const roadHit = physics.raycast(V(laneX, HIGHWAY_ORIGIN[1] + 2, 0), V(0, -1, 0), 5, CG.World);
      expect(roadHit).not.toBeNull();
      expect(roadHit!.point.y).toBeCloseTo(LV.highway, 1);
    }
  });

  it('mutually connects Rooftop, Mezzanine, Grand Hall, Vault Antechamber, Bullion Vault, and Plaza to BANK_HUB', () => {
    expect(nav.nodeCount).toBeGreaterThan(2000);
    expect(onNav(BANK_HUB)).toBe(true);

    const checkpoints: { label: string; p: THREE.Vector3 }[] = [
      { label: 'rooftop_helipad', p: V(ROOF_HELIPAD[0], ROOF_HELIPAD[1], ROOF_HELIPAD[2]) },
      { label: 'rooftop_north', p: V(0, LV.roof, -12) },
      { label: 'mezzanine_security_office', p: V(SABOT_RACK_POS[0], SABOT_RACK_POS[1], SABOT_RACK_POS[2]) },
      { label: 'mezzanine_east_gallery', p: V(20, LV.mezz, 6) },
      { label: 'mezzanine_north_balcony', p: V(0, LV.mezz, -13) },
      { label: 'vault_antechamber', p: V(0, LV.vault, -26) },
      { label: 'vault_drill_floor', p: V(DRILL_FLOOR_POS[0], DRILL_FLOOR_POS[1], DRILL_FLOOR_POS[2]) },
      { label: 'vault_guard_cage', p: V(MGL_RACK_POS[0], MGL_RACK_POS[1], MGL_RACK_POS[2]) },
      { label: 'vault_west_swat_corridor', p: V(-22, LV.vault, -26) },
      { label: 'vault_east_swat_corridor', p: V(22, LV.vault, -26) },
      { label: 'bullion_vault_interior', p: V(0, LV.vault, -38) },
      { label: 'front_plaza_humvee', p: V(HUMVEE_PARK_POS[0], HUMVEE_PARK_POS[1], HUMVEE_PARK_POS[2]) },
    ];

    const broken: string[] = [];
    for (const c of checkpoints) {
      if (!onNav(c.p)) {
        broken.push(`${c.label} off nav`);
        continue;
      }
      const dTo = route(c.p, BANK_HUB);
      const dFrom = route(BANK_HUB, c.p);
      if (!(dTo < 500)) broken.push(`${c.label} cannot reach hub (${dTo})`);
      if (!(dFrom < 500)) broken.push(`hub cannot reach ${c.label} (${dFrom})`);
    }

    // Verify every authored GROUND_SPAWN, PLAYER_SPAWN, PICKUP_SPOT, and GOLD_PALLET sits on the nav graph
    for (const [x, y, z, zone] of GROUND_SPAWNS) {
      if (!onNav(V(x, y, z))) broken.push(`spawn [${x},${y},${z}] (${zone}) off nav`);
    }
    for (const s of PLAYER_SPAWNS) {
      if (!onNav(V(s.x, s.y, s.z))) broken.push(`playerSpawn [${s.x},${s.y},${s.z}] off nav`);
    }
    for (const [x, y, z] of PICKUP_SPOTS) {
      if (!onNav(V(x, y, z))) broken.push(`pickup [${x},${y},${z}] off nav`);
    }
    for (const pallet of GOLD_PALLETS) {
      const [x, y, z] = pallet.pos;
      if (!onNav(V(x, y, z))) broken.push(`pallet ${pallet.id} [${x},${y},${z}] off nav`);
    }

    expect(broken).toEqual([]);
  });
});
