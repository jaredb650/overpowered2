/**
 * Stage 1 Map Geometry & Parkour Proof for `openmind` (Deprecation / Form 7742-A).
 *
 * Authors the full OpenMind HQ & Grand Boulevard map into real Rapier physics, builds `Objects`
 * (`DestructionManager` + `Breakables`) and `NavGraph`, verifies engine budgets (`LightVolume`
 * dimensions <= [200, 48, 200], `NavGraph` elevations inside -19..118, triangle/collider/light caps),
 * and proves every parkour obstacle, Gaff grapple anchor, shutter slide, glass chimney climb,
 * breakable glass curtain wall, datacenter cluster, and downtown destruction cluster.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Doors } from '../../../campaign/doors';
import { PARKOUR } from '../../../campaign/parkour';
import { type Action, CG, type Ctx } from '../../../core/contracts';
import { HARPOON } from '../../../weapons/harpoon';
import { Kit } from '../../kit/kit';
import { NavGraph } from '../../nav';
import { Objects } from '../../objects';
import { registerDestructionNavProxies } from '../../destruction';
import { MapSpec } from '../spec';
import { MARKS as DEPRECATION_MARKS } from '../../../campaign/missions/deprecation.places';
import {
  authorOpenmind,
  BOULEVARD,
  DATACENTER,
  ELEVATOR_SHAFT,
  GRAPPLE_ANCHORS,
  GROUND_SPAWNS,
  LV,
  OFFICE,
  OPENMIND_BOUNDS,
  OPENMIND_HUB,
  OPENMIND_LEVELS,
  OPENMIND_LIGHT_BOUNDS,
  OPENMIND_LIGHT_CELL,
  OPENMIND_STAGES,
  PARKOUR_GEOM,
  PLAYER_SPAWNS,
  ZIPLINES,
} from './index';

type Game = Awaited<ReturnType<typeof import('../../../player/testkit/headless').createHeadlessGame>>;
type Rig = ReturnType<typeof import('../outpost/proof').rigOf>;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);
const DT = 1 / 60;
const ALL_ACTIONS: readonly Action[] = ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide'];
const SOUTH = Math.PI;
const EAST = -Math.PI / 2;

let game: Game;
let rig: Rig;
let physics: Ctx['physics'];
let kit: Kit;
let spec: MapSpec;
let objects: Objects;
let nav: NavGraph;
let triangles = 0;

beforeAll(async () => {
  const paint: unknown = new Proxy({}, { get: (_, key) => (key === 'measureText' ? () => ({ width: 100 }) : () => undefined), set: () => true });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => paint, style: {}, width: 0, height: 0 }) });

  const { createHeadlessGame } = await import('../../../player/testkit/headless');
  const proof = await import('../outpost/proof');

  game = await createHeadlessGame(() => {});
  (game.ctx as unknown as { weapons: unknown }).weapons = { occupy: () => {} };
  const ctxAny = game.ctx as unknown as Record<string, unknown>;
  if (!ctxAny.enemies) ctxAny.enemies = {};
  if (!ctxAny.audio) ctxAny.audio = { play: () => {} };
  if (!ctxAny.fx) ctxAny.fx = { dust: () => {} };
  if (!ctxAny.camera) ctxAny.camera = { addTrauma: () => {} };
  physics = game.ctx.physics;

  // Stub minimal world material factory & scene so Objects / Doors build cleanly headless.
  const stubMat = new THREE.MeshStandardMaterial({ color: 0x8899aa });
  const renderStub = game.ctx.render as unknown as {
    scene: THREE.Scene;
    materials: { world: () => THREE.Material };
  };
  if (!renderStub.scene) renderStub.scene = new THREE.Scene();
  renderStub.materials = { world: () => stubMat };

  kit = new Kit(physics);
  spec = new MapSpec();

  for (const stage of OPENMIND_STAGES) {
    stage.run(kit, spec);
  }
  authorOpenmind(kit, spec);

  triangles = kit.geo.triangles();
  objects = new Objects(game.ctx, spec, kit, () => stubMat);
  physics.step(DT);

  nav = new NavGraph(physics);
  const bounds = new THREE.Box3(
    V(OPENMIND_BOUNDS.x0, OPENMIND_BOUNDS.y0, OPENMIND_BOUNDS.z0),
    V(OPENMIND_BOUNDS.x1, OPENMIND_BOUNDS.y1, OPENMIND_BOUNDS.z1),
  );
  const releaseProxies = registerDestructionNavProxies(physics, spec.destructionClusters);
  try {
    await nav.build(bounds, spec.jumpLinks, OPENMIND_HUB, async () => {}, { mutual: true, levels: OPENMIND_LEVELS });
  } finally {
    releaseProxies();
  }
  objects.walls.attach(nav);
  objects.props.attach(nav);
  objects.destruction.attachNav(nav);
  for (const c of spec.destructionClusters) objects.destruction.addCluster(c);
  (objects.destruction as { flushBatches?: () => void }).flushBatches?.();
  (physics as unknown as { flushQueries(): void }).flushQueries();

  rig = proof.rigOf(game);
}, 120000);

const hold = (a: Action, down = true) => rig.input.simulate(a, down);
const tap = (a: Action) => { hold(a); rig.step(); hold(a, false); };
const frames = (n: number) => { for (let i = 0; i < n; i++) rig.step(); };
const until = (done: () => boolean, seconds: number): boolean => {
  for (let t = 0; t < seconds; t += DT) {
    if (done()) return true;
    rig.step();
  }
  return done();
};
function placePlayer(x: number, y: number, z: number, yaw: number): void {
  for (const a of ALL_ACTIONS) hold(a, false);
  rig.input.consumeLook();
  rig.player.reset();
  rig.player.teleport(V(x, y + 0.05, z), yaw);
  frames(4);
}

describe('openmind map — Stage 1 geometry, budgets & parkour proof', () => {
  it('authors cleanly within LightVolume, NavGraph, triangle, collider, and light budgets', () => {
    // 1. LightVolume MAX_DIMS = [200, 48, 200] check at OPENMIND_LIGHT_CELL (1.6 m)
    const sizeX = OPENMIND_LIGHT_BOUNDS.x1 - OPENMIND_LIGHT_BOUNDS.x0;
    const sizeY = OPENMIND_LIGHT_BOUNDS.y1 - OPENMIND_LIGHT_BOUNDS.y0;
    const sizeZ = OPENMIND_LIGHT_BOUNDS.z1 - OPENMIND_LIGHT_BOUNDS.z0;
    const nx = Math.ceil(sizeX / OPENMIND_LIGHT_CELL);
    const ny = Math.ceil(sizeY / OPENMIND_LIGHT_CELL);
    const nz = Math.ceil(sizeZ / OPENMIND_LIGHT_CELL);
    expect([nx, ny, nz]).toEqual([140, 44, 200]);
    expect(nx).toBeLessThanOrEqual(200);
    expect(ny).toBeLessThanOrEqual(48);
    expect(nz).toBeLessThanOrEqual(200);

    // 2. NavGraph elevation envelope (-19..118) & live node population across all zones
    for (const lvl of OPENMIND_LEVELS) {
      expect(lvl).toBeGreaterThan(-19);
      expect(lvl).toBeLessThan(118);
    }
    expect(nav.nodeCount).toBeGreaterThan(8000);
    let minNavY = Infinity;
    let maxNavY = -Infinity;
    for (let i = 0; i < nav.nodeCount; i++) {
      const y = nav.py[i]!;
      if (y < minNavY) minNavY = y;
      if (y > maxNavY) maxNavY = y;
    }
    expect(minNavY).toBeGreaterThan(-19);
    expect(maxNavY).toBeLessThan(118);

    // 3. Rendering & physics budgets
    expect(triangles).toBeGreaterThan(5000);
    expect(triangles).toBeLessThan(400000);
    expect(kit.colliders).toBeLessThan(950);
    expect(kit.lights.length).toBeLessThan(140);
    expect(spec.zones.length).toBeGreaterThanOrEqual(10);
    expect(spec.playerSpawns.length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(spec.views).length).toBeGreaterThanOrEqual(10);

    console.info('openmind', JSON.stringify({
      lightDims: [nx, ny, nz],
      triangles,
      colliders: kit.colliders,
      lights: kit.lights.length,
      navNodes: nav.nodeCount,
      breakables: spec.breakables.length,
      clusters: objects.destruction.allClusters().length,
    }));
  });

  it('places every Tower 1 HVAC vault strictly inside vault spec (1.05 m high, 1.4 m deep)', () => {
    expect(PARKOUR_GEOM.hvacVaults.length).toBe(3);
    for (const h of PARKOUR_GEOM.hvacVaults) {
      expect(h.height).toBeCloseTo(1.05, 5);
      expect(h.height).toBeGreaterThanOrEqual(0.5);
      expect(h.height).toBeLessThanOrEqual(1.35);
      expect(h.depth).toBeCloseTo(1.4, 5);
      const hit = physics.raycast(V(h.x, h.y + 3, h.z), DOWN, 4, CG.World);
      expect(hit, `HVAC at ${h.x},${h.z}`).not.toBeNull();
      expect(hit!.point.y).toBeCloseTo(h.y + h.height, 1);
    }
  });

  it('verifies Canyon Zipline snap point and every Gaff grapple crane anchor within HARPOON.maxRange (160 m)', () => {
    const zip = ZIPLINES[0]!;
    expect(zip.snapAt).toBeCloseTo(0.65, 5);

    // Position along Canyon Zipline when Ram snaps the far pylon at t = 0.65
    const t = zip.snapAt!;
    const snapPos = V(
      zip.start[0] + (zip.end[0] - zip.start[0]) * t,
      zip.start[1] + (zip.end[1] - zip.start[1]) * t,
      zip.start[2] + (zip.end[2] - zip.start[2]) * t,
    );
    const rescue = GRAPPLE_ANCHORS.find(a => a.id === 'tower2_rescue_crane')!;
    const rescuePos = V(...rescue.pos);
    const rescueDist = snapPos.distanceTo(rescuePos);
    expect(rescueDist).toBeLessThan(HARPOON.maxRange);
    expect(rescueDist).toBeLessThan(35);

    // Real Rapier raycast from snap point straight to Tower 2 Rescue Crane beam hits cleanly!
    const toRescue = rescuePos.clone().sub(snapPos).normalize();
    const hitRescue = physics.raycast(snapPos, toRescue, rescueDist + 2, CG.World);
    expect(hitRescue).not.toBeNull();
    expect(hitRescue!.distance).toBeLessThanOrEqual(rescueDist + 1.5);

    // Gaff Slingshot Canyon: Tower 2 lip -> Boom 1 -> Boom 2 -> Tower 3 lip (all well inside HARPOON.maxRange)
    const boom1 = GRAPPLE_ANCHORS.find(a => a.id === 'canyon_crane_1')!;
    const boom2 = GRAPPLE_ANCHORS.find(a => a.id === 'canyon_crane_2')!;
    const t2Lip = V(4, LV.tower2 + 1.6, -96);
    const b1Pos = V(...boom1.pos);
    const b2Pos = V(...boom2.pos);
    const t3Lip = V(6, LV.tower2 + 1.6, -58);

    expect(t2Lip.distanceTo(b1Pos)).toBeLessThan(HARPOON.maxRange);
    expect(b1Pos.distanceTo(b2Pos)).toBeLessThan(HARPOON.maxRange);
    expect(b2Pos.distanceTo(t3Lip)).toBeLessThan(HARPOON.maxRange);

    const hitB1 = physics.raycast(t2Lip, b1Pos.clone().sub(t2Lip).normalize(), t2Lip.distanceTo(b1Pos) + 2, CG.World);
    expect(hitB1).not.toBeNull();
    const hitB2 = physics.raycast(b1Pos.clone().add(V(0, -1.2, 0)), b2Pos.clone().sub(b1Pos.clone().add(V(0, -1.2, 0))).normalize(), b1Pos.distanceTo(b2Pos) + 2, CG.World);
    expect(hitB2).not.toBeNull();

    // Spire Plaza Stage 3B Gaff anchors hit cleanly from Plaza floor!
    const plazaEye = V(0, 1.6, 140);
    for (const a of GRAPPLE_ANCHORS.filter(x => x.section === 'boss_stage3')) {
      const target = V(...a.pos);
      expect(plazaEye.distanceTo(target)).toBeLessThan(HARPOON.maxRange);
      const hit = physics.raycast(plazaEye, target.clone().sub(plazaEye).normalize(), plazaEye.distanceTo(target) + 2, CG.World);
      expect(hit, a.id).not.toBeNull();
    }
  });

  it('builds the 26 m unbroken glass wall-run facade across the exact PARKOUR.wallRun.gap (22 m)', () => {
    const c = PARKOUR_GEOM.canyon;
    expect(c.mainGap).toBe(38);
    expect(c.wallRunFarLipZ - c.wallRunNearLipZ).toBeCloseTo(PARKOUR.wallRun.gap, 5);
    expect(c.wallRunPanel.z1 - c.wallRunPanel.z0).toBeCloseTo(26, 5);

    // Every metre along the 26 m glass facade must hit the SAME single unbroken collider handle (zero seams!).
    let handle: number | null = null;
    for (let z = c.wallRunPanel.z0 + 0.5; z <= c.wallRunPanel.z1 - 0.5; z += 1.0) {
      const hit = physics.raycast(V(11.5, LV.tower2 + 2.0, z), V(1, 0, 0), 3.0, CG.World);
      expect(hit, `glass wall-run at z=${z}`).not.toBeNull();
      expect(hit!.surface).toBe('glass');
      expect(hit!.collider).not.toBeNull();
      if (handle === null) handle = hit!.collider!.handle;
      else expect(hit!.collider!.handle).toBe(handle);
    }
  });

  it('builds the Tower 3 closing shutter to PARKOUR.slide specs and passes real Player slide proof', () => {
    const sh = PARKOUR_GEOM.shutter;
    expect(sh.height).toBeCloseTo(PARKOUR.slide.doorHeight, 5);
    expect(sh.closeSeconds).toBeCloseTo(PARKOUR.slide.closeSeconds, 5);
    expect(sh.triggerRange).toBeCloseTo(PARKOUR.slide.triggerRange, 5);

    // Verify physical opening width (4.4 m) and height (3.6 m) in Rapier.
    const leftHit = physics.raycast(V(sh.x, sh.y + 1.5, sh.z), V(-1, 0, 0), 10, CG.World);
    const rightHit = physics.raycast(V(sh.x, sh.y + 1.5, sh.z), V(1, 0, 0), 10, CG.World);
    const topHit = physics.raycast(V(sh.x, sh.y + 1.0, sh.z), V(0, 1, 0), 10, CG.World);
    expect(leftHit!.distance + rightHit!.distance).toBeCloseTo(sh.width, 1);
    expect(1.0 + topHit!.distance).toBeCloseTo(sh.height, 1);

    // Live Player + Doors proof: a plain run is stopped by the closing shutter, while a slide goes cleanly under!
    const doors = new Doors(game.ctx);
    const doorDef = {
      at: [sh.x, sh.y, sh.z] as const,
      width: sh.width,
      height: sh.height,
      yaw: 0,
      kind: 'shutter' as const,
      start: 1,
      seconds: sh.closeSeconds,
    };

    const runAttempt = (slideAtDist: number | null): boolean => {
      doors.set('tower3_shutter', doorDef, 1, 0, () => {});
      placePlayer(sh.x, sh.y, sh.z - sh.triggerRange - 0.8, SOUTH);
      hold('forward');
      until(() => rig.player.position.z >= sh.z - sh.triggerRange, 2);
      doors.set('tower3_shutter', doorDef, 0, sh.closeSeconds, () => {});
      let slid = false;
      let through = false;
      for (let t = 0; t < 4 && !through; t += DT) {
        const dist = sh.z - rig.player.position.z;
        if (slideAtDist !== null && !slid && dist <= slideAtDist) {
          slid = true;
          hold('slide');
        }
        rig.step();
        doors.update(DT);
        through = rig.player.position.z > sh.z + 1.0;
      }
      for (const a of ALL_ACTIONS) hold(a, false);
      return through;
    };

    expect(runAttempt(null)).toBe(false);  // Standing run stopped by closing shutter
    expect(runAttempt(6)).toBe(true);      // Slide in last 6 m clears underneath!
    doors.set('tower3_shutter', doorDef, 1, 0, () => {});
  });

  it('builds the Tower 3 twin-glass chimney to PARKOUR.stacks.chimney and passes real Player chimney climb', () => {
    const ch = PARKOUR_GEOM.chimney;
    expect(ch.x1 - ch.x0).toBeCloseTo(PARKOUR.stacks.chimney.width, 5);
    expect(ch.midY - ch.baseY).toBeCloseTo(PARKOUR.stacks.chimney.rise, 5);
    expect(ch.topY - ch.midY).toBeCloseTo(PARKOUR.stacks.chimney.rise, 5);

    // Inner glass liners must be climbable; outer north tower face must refuse climb!
    const midZ = (ch.z0 + ch.z1) / 2;
    const westLiner = physics.raycast(V(0, ch.baseY + 3, midZ), V(-1, 0, 0), 2, CG.World);
    const eastLiner = physics.raycast(V(0, ch.baseY + 3, midZ), V(1, 0, 0), 2, CG.World);
    expect(westLiner && physics.climbable(westLiner.collider)).toBe(true);
    expect(eastLiner && physics.climbable(eastLiner.collider)).toBe(true);
    const outerFace = physics.raycast(V(-5, ch.baseY + 3, ch.z0 - 1.5), V(0, 0, 1), 3, CG.World);
    expect(outerFace && physics.climbable(outerFace.collider)).toBe(false);

    // Live headless Player climbs wall-to-wall up the 1.5 m glass chimney from y = 38 to Launch Deck y = 48.4!
    type ClimbBody = Rig['player'] & { climbing: boolean; clinging: boolean };
    const body = rig.player as ClimbBody;
    placePlayer(0, ch.baseY, midZ, EAST);
    hold('forward');
    tap('jump');
    let climbs = 0;
    for (let i = 0; i < 16 && body.position.y < ch.topY - 0.15; i++) {
      if (!until(() => body.climbing || body.position.y >= ch.topY - 0.15, 1.2)) break;
      if (body.position.y >= ch.topY - 0.15) break;
      climbs++;
      until(() => !body.climbing, 1.0);
      if (body.position.y >= ch.topY - 0.15) break;
      tap('jump');
    }
    hold('forward', false);
    until(() => body.position.y >= ch.topY - 0.15 && body.grounded, 1.5);
    expect(climbs).toBeGreaterThanOrEqual(2);
    expect(body.position.y).toBeGreaterThan(ch.topY - 0.25);
  });

  it('wires OpenMind HQ 14m x 6m breakable glass curtain wall, floor skylight, and clear 6x6 Freight Elevator Shaft', () => {
    const cw = OFFICE.curtainWall;
    expect(cw.width).toBe(14);
    expect(cw.height).toBe(6);

    // All 14 curtain wall panes registered as `pane` breakables at z ~ -12 across x in [-7, +7], y in [42, 48]
    const curtainPanes = spec.breakables.filter(
      b => b.kind === 'pane' && !b.flat && Math.abs(b.z - cw.z) < 0.3 && b.x > cw.x0 && b.x < cw.x1 && b.y > cw.y0 && b.y < cw.y1,
    );
    expect(curtainPanes.length).toBe(cw.panesX * cw.panesY);

    // Launch crane aim ray reaches the glass curtain wall cleanly with zero solid wall blocking it!
    const launchTip = V(0, PARKOUR_GEOM.launchCrane.tipY + 1.2, PARKOUR_GEOM.launchCrane.z1);
    const hitGlass = physics.raycast(launchTip, V(0, -0.1, 1).normalize(), 8, CG.World);
    expect(hitGlass).not.toBeNull();
    expect(hitGlass!.surface).toBe('glass');

    // Breakable flat skylight panes in the y = 42 Executive Floor slab (9 panes over 6 m x 6 m)
    const skylightPanes = spec.breakables.filter(
      b => b.kind === 'pane' && b.flat && Math.abs(b.y - OFFICE.skylight.y) < 0.2,
    );
    expect(skylightPanes.length).toBe(9);

    // Freight Elevator Shaft (6 m x 6 m) is unobstructed vertically from Mezzanine (34) down to grate (-1.4)
    const sh = ELEVATOR_SHAFT;
    expect(sh.x1 - sh.x0).toBe(6);
    expect(sh.z1 - sh.z0).toBe(6);
    const dropHit = physics.raycast(V(sh.cx, sh.topY - 0.5, sh.cz), DOWN, sh.topY - sh.bottomY, CG.World);
    expect(dropHit).not.toBeNull();
    // Should pass all the way through y=34..0 down to the breakable vault ceiling grate at y = -1.4!
    expect(dropHit!.point.y).toBeCloseTo(sh.grateY, 0);
  });

  it('wires Sub-Level 4 Datacenter racks, 4 Air-Gap Pylons, Breakout Bulkhead, and all Downtown Destruction Clusters', () => {
    // Datacenter racks across 3 Compute Clusters (68 racks in vault + 14 test racks in Mezzanine)
    const vaultRacks = spec.breakables.filter(b => b.kind === 'rack' && Math.abs(b.y - DATACENTER.floorY) < 0.2);
    expect(vaultRacks.length).toBeGreaterThanOrEqual(60);

    // Concrete breakout ramp smoothly climbs from y = -6 to y = 0
    const rampMid = physics.raycast(V(0, 2, 10), DOWN, 10, CG.World);
    expect(rampMid).not.toBeNull();
    expect(rampMid!.point.y).toBeCloseTo(-3.0, 0.2);

    // Verify EVERY required DestructionManager cluster tag is registered & alive!
    const d = objects.destruction;
    const expectedTags = [
      // Datacenter Air-Gap Pylons + Breakout Bulkhead
      'vault.pylon.0', 'vault.pylon.1', 'vault.pylon.2', 'vault.pylon.3',
      'vault.breakoutBulkhead',
      // Plaza Garage glass fountain hatch
      'plaza.fountainHatch',
      // Grand Boulevard storefronts & colonnades
      'blvd.west1', 'blvd.west2', 'blvd.west3', 'blvd.east1', 'blvd.east2',
      // Pedestrian Skybridge
      'blvd.skybridge',
      // 4 Civic Intersection stagger-column corner office buildings
      'corner.nw', 'corner.ne', 'corner.sw', 'corner.se',
      // 3 Civic Spire Plaza Grid Substations
      'substation.0', 'substation.1', 'substation.2',
    ];
    for (const tag of expectedTags) {
      expect(d.isClusterAlive(tag), `cluster ${tag}`).toBe(true);
    }

    // Pedestrian Skybridge leaves >= 8.0 m clearance for the 6.4 m Distraint Frame underneath!
    const sbClear = physics.raycast(V(0, 0.5, BOULEVARD.skybridge.z), V(0, 1, 0), 14, CG.World);
    expect(sbClear).not.toBeNull();
    expect(sbClear!.point.y).toBeGreaterThanOrEqual(8.3);
  });

  it('passes real Player HVAC vault, 22 m glass wall-run crossing, and grounded NavGraph spawns', () => {
    // 1. Live Player HVAC vault on Tower 1 (running EAST +X along the rooftop sightline)
    const EAST = -Math.PI / 2;
    const h = PARKOUR_GEOM.hvacVaults[0]!;
    placePlayer(h.x - 5.0, h.y, h.z, EAST);
    hold('forward');
    let vaulted = false;
    for (let t = 0; t < 2.5; t += DT) {
      if (rig.player.position.x >= h.x - 1.8 && rig.player.position.x <= h.x - 0.8 && rig.player.grounded) {
        tap('jump');
      }
      rig.step();
      if (rig.player.position.y > h.y + h.height - 0.15) vaulted = true;
      if (rig.player.position.x > h.x + h.depth / 2 + 0.5 && rig.player.grounded) break;
    }
    for (const a of ALL_ACTIONS) hold(a, false);
    expect(vaulted, 'Player clears HVAC top').toBe(true);
    expect(rig.player.position.x, 'Player lands beyond HVAC').toBeGreaterThan(h.x + h.depth / 2 + 0.3);

    // 2. Live Player wall-run across the 22 m glass facade gap (z = -88..-66) from Tower 2 east finger to Tower 3 east finger!
    // Facing SOUTH (+Z), EAST (+X, where the glass wall sits at x = 13.0) is to the player's LEFT.
    const c = PARKOUR_GEOM.canyon;
    placePlayer(11.8, LV.tower2, c.wallRunNearLipZ - 6.0, SOUTH);
    hold('forward');
    let wallRan = false;
    let jumpedOffLip = false;
    for (let t = 0; t < 3.5; t += DT) {
      const p = rig.player.position;
      if (!jumpedOffLip && p.z >= c.wallRunNearLipZ - 1.2) {
        jumpedOffLip = true;
        hold('left');
        tap('jump');
      }
      if (rig.player.wallRunning) {
        wallRan = true;
        hold('left', false);
      }
      rig.step();
      if (p.z > c.wallRunFarLipZ + 1.5 && rig.player.grounded) break;
    }
    for (const a of ALL_ACTIONS) hold(a, false);
    expect(wallRan, 'Player engages glass wall-run').toBe(true);
    expect(rig.player.position.z, 'Player clears 22 m wall-run gap onto Tower 3').toBeGreaterThan(c.wallRunFarLipZ);
    expect(rig.player.position.y, 'Player lands on Tower 3 deck').toBeGreaterThanOrEqual(LV.tower2 - 0.4);

    // 3. Every player spawn & ground enemy spawn sits on a solid floor and is connected to NavGraph!
    const nearest = V(0, 0, 0);
    for (const sp of PLAYER_SPAWNS) {
      const floorHit = physics.raycast(V(sp.x, sp.y + 1.0, sp.z), DOWN, 2.0, CG.World);
      expect(floorHit, `playerSpawn (${sp.x},${sp.y},${sp.z}) floor`).not.toBeNull();
      expect(floorHit!.point.y).toBeCloseTo(sp.y, 0);
      expect(nav.nearest(V(sp.x, sp.y + 0.2, sp.z), 3.0, nearest), `playerSpawn nav (${sp.x},${sp.y},${sp.z})`).toBe(true);
    }
    for (const [x, y, z, tag] of GROUND_SPAWNS) {
      const floorHit = physics.raycast(V(x, y + 1.0, z), DOWN, 2.0, CG.World);
      expect(floorHit, `groundSpawn ${tag} (${x},${y},${z}) floor`).not.toBeNull();
      expect(floorHit!.point.y).toBeCloseTo(y, 0);
      expect(nav.nearest(V(x, y + 0.2, z), 3.5, nearest), `groundSpawn nav ${tag} (${x},${y},${z})`).toBe(true);
    }
  });

  it('keeps every Deprecation campaign enemy spawn mark (including Tower 3 chimney defenders) clear of solid geometry', () => {
    const ENEMY_MARKS = [
      't1.guardA', 't1.guardB',
      't2.guardA', 't2.guardB', 't2.sniper',
      't3.defenderA', 't3.defenderB',
      'office.guardA', 'office.guardB', 'office.riot', 'office.mezzA', 'office.mezzB',
      'elev.qrfA', 'elev.qrfB',
      'vault.guardA', 'vault.guardB', 'vault.catwalkA', 'vault.catwalkB', 'vault.sniper',
      'plaza.guardA', 'plaza.guardB',
      'blvd.troopW', 'blvd.troopE',
      'inter.guardW', 'inter.guardE',
      'spire.catwalkW',
    ] as const;

    const CARDINALS = [V(1, 0, 0), V(-1, 0, 0), V(0, 0, 1), V(0, 0, -1)];
    for (const key of ENEMY_MARKS) {
      const mark = DEPRECATION_MARKS[key];
      expect(mark, `mark ${key}`).toBeDefined();
      const [x, y, z] = mark!.at;

      // 1. Solid walkable floor right beneath feet
      const floorHit = physics.raycast(V(x, y + 1.0, z), DOWN, 1.8, CG.World);
      expect(floorHit, `${key} floor`).not.toBeNull();
      expect(Math.abs(floorHit!.point.y - y), `${key} floor y (${floorHit!.point.y} vs ${y})`).toBeLessThan(0.35);

      // 2. Headroom: ray upward from ankle to head must not hit solid world geometry
      const headHit = physics.raycast(V(x, y + 0.15, z), V(0, 1, 0), 1.8, CG.World);
      expect(headHit, `${key} headroom blocked at y=${headHit?.point.y}`).toBeNull();

      // 3. Horizontal body clearance at chest height (0.55 m radius in all 4 directions)
      for (const dir of CARDINALS) {
        const sideHit = physics.raycast(V(x, y + 1.0, z), dir, 0.55, CG.World);
        expect(sideHit, `${key} embedded horizontally (${dir.x},${dir.z})`).toBeNull();
      }
    }
  });
});
