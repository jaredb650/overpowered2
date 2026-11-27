/**
 * Unit tests for THE FINALS-inspired physics-enabled structural destruction engine (src/world/destruction.ts):
 * armor tier gating, source multipliers, load-bearing support-graph BFS collapse, dynamic body pool cap,
 * kinetic crush, hazard chains, liquidation events, helper builders, and progressive nukeSweep.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Ctx, GameEvents } from '../core/contracts';
import { EventBus } from '../core/events';
import { noop } from '../core/stubs';
import { Physics } from '../physics/Physics';
import {
  buildBarracksCluster,
  buildBoatShedCluster,
  buildCanneryCluster,
  buildCatwalkCluster,
  buildContainerCluster,
  buildEmplacementPlatformCluster,
  buildFiringStepCluster,
  buildFountainCluster,
  buildGateTowerCluster,
  buildMarketHallCluster,
  buildMunitionsShedCluster,
  buildPillboxCluster,
  buildQuayCraneCluster,
  buildShantyHouseCluster,
  buildStaircaseCluster,
  buildTerraceCluster,
  buildTowerCluster,
  buildWallGunPadCluster,
  buildWatchtowerCluster,
  canDamageTier,
  damageMultiplierFor,
  DestructionManager,
  MAX_DYNAMIC_BODIES,
  MAX_SPLINTERS,
  NUKE_SWEEP_SPEED,
  type StructuralClusterSpec,
} from './destruction';
import { canDamageMaterial, canVehicleRamMaterial } from './destructionMaterials';
import {
  buildFieldWatchtowerCluster,
  buildReinforcedBunkerCluster,
  buildTimberShackCluster,
  buildWarHouseCluster,
  buildWarOfficeCluster,
} from './map/endlessWar/buildings';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

let physics: Physics;

beforeAll(async () => {
  physics = await Physics.create();
  physics.addStaticBox(V(0, -0.5, 0), V(250, 0.5, 250), null, 'concrete');
  physics.flushQueries();
}, 60000);

function makeEnv() {
  const events = new EventBus<GameEvents>();
  const feed = vi.fn();
  const hitMarker = vi.fn();
  const audioPlay = vi.fn();
  const explode = vi.fn();
  const award = vi.fn();
  const applyDamage = vi.fn();
  const livingEnemies: { uid: number; alive: boolean; position: THREE.Vector3; center: THREE.Vector3 }[] = [];

  const ctx = {
    physics,
    events,
    fx: noop('fx'),
    audio: { ...noop('audio'), play: audioPlay },
    render: { lights: { flash: vi.fn() }, sweep: vi.fn() },
    hud: { feed, hitMarker },
    combat: { explode },
    progression: { award },
    player: { position: V(0, 0, 50), alive: true },
    camera: { addTrauma: vi.fn() },
    enemies: {
      query: (center: THREE.Vector3, radius: number, out: unknown[]) => {
        out.length = 0;
        for (const e of livingEnemies) {
          if (e.alive && e.center.distanceTo(center) <= radius) out.push(e);
        }
        return out.length;
      },
      applyDamage,
    },
  } as unknown as Ctx;

  const secondaryBlasts: { center: THREE.Vector3; radius: number; amount: number; source: string }[] = [];
  const manager = new DestructionManager(
    ctx,
    () => new THREE.MeshBasicMaterial(),
    (center, radius, amount, source) => secondaryBlasts.push({ center: center.clone(), radius, amount, source }),
  );
  return { ctx, manager, events, feed, hitMarker, audioPlay, explode, award, applyDamage, livingEnemies, secondaryBlasts };
}

function stepPhysics(manager: DestructionManager, frames: number, dt = 1 / 60): void {
  for (let i = 0; i < frames; i++) {
    physics.world.timestep = dt;
    physics.world.step();
    manager.update(dt);
  }
}

describe('armor tier gating and source multipliers', () => {
  it('enforces all 4 material armor tiers accurately', () => {
    // Tier 0: timber — immune to light small arms (AR/SMG/pistol), shredded by .50 cal / HMG / fire / explosives
    for (const blocked of ['smg', 'rifle', 'pistol']) {
      expect(canDamageTier(0, blocked), `tier 0 should block ${blocked}`).toBe(false);
    }
    for (const src of ['piledriver', 'hmg', 'minigun', 'flame', 'rocket', 'satchel', 'frame_rotary_airburst', 'frame_40mm', 'frame_howitzer', 'nuke']) {
      expect(canDamageTier(0, src), `tier 0 vs ${src}`).toBe(true);
    }

    // Tier 1: masonry — blocks small arms and rotary airburst, allows explosives & frame/AC-130 ordnance
    expect(canDamageTier(1, 'smg')).toBe(false);
    expect(canDamageTier(1, 'shotgun')).toBe(false);
    expect(canDamageTier(1, 'frame_rotary_airburst')).toBe(false);
    for (const src of ['satchel', 'rocket', 'mgl', 'grenade', 'c4', 'frame_40mm', 'frame_40mm_ap', 'frame_stomp', 'frame_howitzer', 'tank_cannon', 'ac130_25mm', 'ac130_wp', 'ac130_40mm', 'ac130_40mm_ap', 'ac130_105mm', 'ac130_bomb', 'hazard_chain', 'nuke']) {
      expect(canDamageTier(1, src), `tier 1 vs ${src}`).toBe(true);
    }

    // Tier 2: heavy industrial — blocks hand-held rockets/satchels/mgl/grenade/c4 and rotary airburst
    for (const blocked of ['smg', 'rocket', 'satchel', 'mgl', 'grenade', 'c4', 'frame_rotary_airburst', 'ac130_25mm']) {
      expect(canDamageTier(2, blocked), `tier 2 should block ${blocked}`).toBe(false);
    }
    for (const allowed of ['frame_40mm', 'frame_40mm_ap', 'frame_howitzer', 'frame_stomp', 'frame_charge', 'frame_crush', 'frame_backhand', 'frame_pod', 'tank_cannon', 'ac130_40mm', 'ac130_40mm_ap', 'ac130_105mm', 'ac130_bomb', 'hazard_chain', 'nuke']) {
      expect(canDamageTier(2, allowed), `tier 2 should allow ${allowed}`).toBe(true);
    }

    // Tier 3: reinforced concrete — ONLY frame_howitzer, ac130_105mm, ac130_bomb, nuke, hazard_chain
    for (const blocked of ['smg', 'rocket', 'satchel', 'frame_40mm', 'frame_40mm_ap', 'ac130_40mm', 'ac130_25mm', 'frame_stomp', 'frame_charge', 'frame_crush', 'frame_backhand', 'frame_pod', 'tank_cannon', 'frame_rotary_airburst']) {
      expect(canDamageTier(3, blocked), `tier 3 should block ${blocked}`).toBe(false);
    }
    for (const allowed of ['frame_howitzer', 'ac130_105mm', 'ac130_bomb', 'nuke', 'hazard_chain']) {
      expect(canDamageTier(3, allowed), `tier 3 should allow ${allowed}`).toBe(true);
    }
  });

  it('applies required source multipliers', () => {
    expect(damageMultiplierFor(1, 'satchel')).toBeCloseTo(3.2);
    expect(damageMultiplierFor(2, 'satchel')).toBe(0);
    expect(damageMultiplierFor(3, 'frame_howitzer')).toBeCloseTo(8.0);
    expect(damageMultiplierFor(3, 'ac130_105mm')).toBeCloseTo(8.0);
    expect(damageMultiplierFor(3, 'ac130_bomb')).toBeCloseTo(12.0);
    expect(damageMultiplierFor(2, 'frame_40mm_ap')).toBeCloseTo(2.5);
    expect(damageMultiplierFor(2, 'frame_40mm')).toBeCloseTo(2.2);
    expect(damageMultiplierFor(2, 'ac130_40mm')).toBeCloseTo(2.2);
    expect(damageMultiplierFor(2, 'ac130_40mm_ap')).toBeCloseTo(2.5);
    expect(damageMultiplierFor(2, 'frame_stomp')).toBeCloseTo(4.5);
    expect(damageMultiplierFor(2, 'frame_charge')).toBeCloseTo(4.5);
    expect(damageMultiplierFor(2, 'frame_crush')).toBeCloseTo(4.5);
    expect(damageMultiplierFor(3, 'nuke')).toBeGreaterThanOrEqual(100);
  });

  it('blocks rockets on Tier 2/3 nodes, blocks 40mm on Tier 3, lets Satchel break Tier 1 and Howitzer break Tier 3', () => {
    const { manager, feed, audioPlay } = makeEnv();
    const cluster = manager.addCluster({
      id: 'tier_test',
      kind: 'test',
      nodes: [
        { id: 't1', pos: [0, 1.5, 0], half: [1, 1.5, 1], mat: 'concrete', hp: 300, tier: 1, anchored: true, kind: 'wall' },
        { id: 't2', pos: [10, 1.5, 0], half: [1, 1.5, 1], mat: 'steelDark', hp: 300, tier: 2, anchored: true, kind: 'wall' },
        { id: 't3', pos: [20, 1.5, 0], half: [1, 1.5, 1], mat: 'concreteDark', hp: 600, tier: 3, anchored: true, kind: 'wall' },
      ],
    });

    // Small arms do 0 to Tier 1
    manager.damageCollider(cluster.getNode('t1')!.staticCollider, 500, 'smg');
    expect(cluster.getNode('t1')!.hp).toBe(300);

    // Satchel (3.2x) breaks Tier 1 in one 100-damage blast (320 > 300)
    manager.blast(V(0, 1.5, 0), 4, 100, 'satchel');
    expect(cluster.getNode('t1')!.state).toBe('falling');

    // Rocket & Satchel do 0 damage to Tier 2, emit clang & feed hint
    manager.blast(V(10, 1.5, 0), 4, 500, 'rocket');
    manager.blast(V(10, 1.5, 0), 4, 500, 'satchel');
    expect(cluster.getNode('t2')!.hp).toBe(300);
    expect(cluster.getNode('t2')!.state).toBe('intact');
    expect(audioPlay).toHaveBeenCalledWith('metal_clang', expect.anything());
    expect(feed).toHaveBeenCalled();

    // Frame 40mm breaks Tier 2, but does 0 to Tier 3
    manager.blast(V(10, 1.5, 0), 4, 200, 'frame_40mm');
    expect(cluster.getNode('t2')!.state).toBe('falling');

    manager.blast(V(20, 1.5, 0), 4, 500, 'frame_40mm');
    manager.blast(V(20, 1.5, 0), 4, 500, 'frame_40mm_ap');
    manager.blast(V(20, 1.5, 0), 4, 500, 'frame_stomp');
    expect(cluster.getNode('t3')!.hp).toBe(600);
    expect(cluster.getNode('t3')!.state).toBe('intact');

    // 105mm Howitzer (8.0x) rips right through Tier 3 (100 * 8 = 800 > 600)
    manager.blast(V(20, 1.5, 0), 4, 100, 'frame_howitzer');
    expect(cluster.getNode('t3')!.state).toBe('falling');

    manager.clear();
  });
});

describe('support-graph BFS collapse and physics', () => {
  it('detaches unsupported upper slabs/roofs into tilting then falling dynamic rigid bodies when columns break', () => {
    const { manager, audioPlay } = makeEnv();
    const spec: StructuralClusterSpec = {
      id: 'pavilion',
      tag: 'pavilion.alpha',
      kind: 'pavilion',
      label: 'TEST PAVILION',
      value: 150_000,
      nodes: [
        { id: 'col_l', pos: [-3, 2, 0], half: [0.5, 2, 0.5], mat: 'concrete', hp: 100, tier: 1, anchored: true, kind: 'column' },
        { id: 'col_r', pos: [3, 2, 0], half: [0.5, 2, 0.5], mat: 'concrete', hp: 100, tier: 1, anchored: true, kind: 'column' },
        { id: 'slab', pos: [0, 4.4, 0], half: [3.6, 0.4, 2], mat: 'concreteDark', hp: 500, tier: 1, anchored: false, kind: 'slab' },
        { id: 'roof', pos: [0, 5.4, 0], half: [3.8, 0.3, 2.2], mat: 'rust', hp: 500, tier: 1, anchored: false, kind: 'roof' },
      ],
      links: [
        ['col_l', 'slab'],
        ['col_r', 'slab'],
        ['slab', 'roof'],
      ],
    };

    const cluster = manager.addCluster(spec);
    const slab = cluster.getNode('slab')!;
    const roof = cluster.getNode('roof')!;

    // Break left column of the 2-column pavilion: the slab's CoM now overhangs outside the single remaining
    // column footprint -> 4-pass structural solver tips slab & roof immediately (no floating on 1 leg!)
    manager.blast(V(-3, 2, 0), 2, 200, 'satchel');
    expect(cluster.getNode('col_l')!.state).toBe('falling');
    expect(slab.state).toBe('tilting');
    expect(roof.state).toBe('tilting');
    expect(audioPlay).toHaveBeenCalledWith('metal_groan', expect.anything());

    // At 0.35s both slab & roof are still in the dramatic groan-and-sag phase (0.55-0.90s)
    const roofY0 = roof.mesh!.position.y;
    stepPhysics(manager, 21); // 0.35s
    expect(slab.state).toBe('tilting');
    expect(roof.state).toBe('tilting');

    // Advance past max sagging duration (~0.95s total) -> both release as real dynamic rigid bodies and fall!
    stepPhysics(manager, 42); // +0.70s (1.05s total)
    expect(slab.state).toBe('falling');
    expect(roof.state).toBe('falling');
    expect(slab.dynamicBody).not.toBeNull();
    expect(roof.dynamicBody).not.toBeNull();
    expect(slab.staticCollider).toBeNull();

    // Advance more so gravity pulls the roof down visibly
    stepPhysics(manager, 60);
    expect(roof.mesh!.position.y).toBeLessThan(roofY0 - 0.5);

    manager.clear();
  });

  it('caps active dynamic rigid bodies at MAX_DYNAMIC_BODIES (96)', () => {
    const { manager } = makeEnv();
    const nodes = [];
    for (let i = 0; i < 120; i++) {
      nodes.push({
        id: `n_${i}`,
        pos: [(i % 12) * 2.2, 2 + Math.floor(i / 12) * 2.2, 40] as const,
        half: [0.5, 0.5, 0.5] as const,
        mat: 'concrete' as const,
        hp: 10,
        tier: 0 as const,
        anchored: true,
        kind: 'wall' as const,
      });
    }
    manager.addCluster({ id: 'mass', kind: 'test', nodes });
    manager.blast(V(12, 6, 40), 50, 500, 'nuke');
    expect(manager.activeDynamicBodies).toBeLessThanOrEqual(MAX_DYNAMIC_BODIES);
    expect(manager.activeDynamicBodies).toBe(MAX_DYNAMIC_BODIES);
    manager.clear();
  });

  it('deals lethal kinetic crush damage when a fast falling chunk hits a living enemy', () => {
    const { manager, livingEnemies, applyDamage } = makeEnv();
    const enemy = { uid: 42, alive: true, position: V(60, 0, 0), center: V(60, 1.0, 0) };
    livingEnemies.push(enemy);

    const cluster = manager.addCluster({
      id: 'drop',
      kind: 'test',
      nodes: [
        { id: 'col', pos: [60, 2, 0], half: [0.5, 2, 0.5], mat: 'concrete', hp: 50, tier: 0, anchored: true, kind: 'column' },
        { id: 'slab', pos: [60, 8, 0], half: [2.0, 0.6, 2.0], mat: 'concreteDark', hp: 500, tier: 0, anchored: false, kind: 'slab' },
      ],
      links: [['col', 'slab']],
    });

    manager.blast(V(60, 2, 0), 1.5, 200, 'rocket');
    expect(cluster.getNode('slab')!.state).toBe('tilting');
    // Step ~1.6s so slab releases from tilt and slams down past y=1 at >4.5 m/s
    stepPhysics(manager, 100);
    expect(applyDamage).toHaveBeenCalledWith(
      enemy,
      expect.objectContaining({ amount: 350, type: 'crush', gib: true }),
    );
    manager.clear();
  });

  it('triggers staggered hazard_chain explosions when a hazard node breaks', () => {
    const { manager, explode, secondaryBlasts } = makeEnv();
    const cluster = manager.addCluster({
      id: 'haz_test',
      kind: 'cannery',
      nodes: [
        { id: 'boiler', pos: [90, 1.5, 0], half: [1, 1.5, 1], mat: 'paintRed', hp: 50, tier: 1, anchored: true, kind: 'hazard', hazardRadius: 12, hazardDamage: 300 },
        { id: 'heavy_roof', pos: [90, 5.5, 0], half: [3, 0.4, 3], mat: 'steel', hp: 200, tier: 2, anchored: true, kind: 'roof' },
      ],
    });

    // Rocket breaks Tier 1 boiler (cannot touch Tier 2 roof directly)
    manager.blast(V(90, 1.5, 0), 3, 100, 'rocket');
    expect(cluster.getNode('boiler')!.state).toBe('falling');
    expect(cluster.getNode('heavy_roof')!.state).toBe('intact');
    expect(explode).not.toHaveBeenCalled();

    // Advance 0.16s past the 0.14s stagger -> hazard_chain fires and blows the Tier 2 roof!
    stepPhysics(manager, 10);
    expect(explode).toHaveBeenCalledWith(
      expect.any(THREE.Vector3),
      expect.objectContaining({ source: 'hazard_chain', radius: 12, damage: 300 }),
    );
    expect(secondaryBlasts.length).toBeGreaterThanOrEqual(1);
    expect(cluster.getNode('heavy_roof')!.state).toBe('falling');
    manager.clear();
  });
});

describe('cluster lifecycle, liquidation events, helper builders, and nukeSweep', () => {
  it('supports barracks spawner queries, collapse callbacks, liquidation events, and reset', () => {
    const { manager, events, award } = makeEnv();
    const onCollapse = vi.fn();
    const liquidated: { label: string; value: number; kind: string }[] = [];
    events.on('world:liquidated', e => liquidated.push({ label: e.label, value: e.value, kind: e.kind }));

    const barracksSpec = buildBarracksCluster(V(-50, 0, -50), {
      tag: 'barracks.south',
      label: 'SOUTH BARRACKS',
      value: 145_000,
      onCollapse,
    });
    const cluster = manager.addCluster(barracksSpec);

    expect(cluster.spawnPoint).toBeInstanceOf(THREE.Vector3);
    expect(manager.isClusterAlive('barracks.south')).toBe(true);
    expect(manager.getCluster('barracks.south')).toBe(cluster);
    expect(manager.aliveClusters('barracks')).toEqual([cluster]);

    // Obliterate the barracks with a big blast
    manager.blast(V(-50, 2, -50), 15, 1000, 'satchel');
    expect(cluster.collapsed).toBe(true);
    expect(cluster.destroyedFraction).toBeGreaterThanOrEqual(0.65);
    expect(onCollapse).toHaveBeenCalledWith(cluster);
    expect(liquidated).toContainEqual({ label: 'SOUTH BARRACKS', value: 145_000, kind: 'barracks' });
    expect(award).toHaveBeenCalled();
    expect(manager.isClusterAlive('barracks.south')).toBe(false);
    expect(manager.aliveClusters('barracks')).toEqual([]);

    // Reset restores cluster to intact & alive
    manager.reset();
    expect(manager.isClusterAlive('barracks.south')).toBe(true);
    expect(manager.aliveClusters('barracks')).toHaveLength(1);
    manager.clear();
  });

  it('builds all 6 architectural cluster types cleanly', () => {
    const { manager } = makeEnv();
    const specs = [
      buildBarracksCluster([0, 0, 0], { tag: 'b1' }),
      buildCanneryCluster([30, 0, 0], { tag: 'c1' }),
      buildQuayCraneCluster([60, 0, 0], { tag: 'q1' }),
      buildMarketHallCluster([90, 0, 0], { tag: 'm1' }),
      buildCatwalkCluster([120, 0, 0], { tag: 'w1', length: 16, height: 4.5 }),
      buildEmplacementPlatformCluster([150, 0, 0], { tag: 'e1', height: 3.5 }),
    ];
    for (const spec of specs) {
      const c = manager.addCluster(spec);
      expect(c.nodes.length).toBeGreaterThanOrEqual(5);
      expect(c.nodes.some(n => n.anchored)).toBe(true);
      expect(c.nodes.some(n => !n.anchored)).toBe(true);
    }
    // Quay Crane base legs must be Tier 3 reinforced concrete
    const crane = manager.getCluster('q1')!;
    expect(crane.getNode('base_fl')!.tier).toBe(3);
    expect(crane.getNode('boom_front')!.kind).toBe('craneBoom');
    manager.clear();
  });

  it('builds all 13 new Holdfast architectural cluster types, cleans navProxies on addCluster, and crumbles to 105mm', () => {
    const { manager } = makeEnv();
    const baseColliders = physics.world.colliders.len();
    const terraceSpec = buildTerraceCluster([-34, 0, 25], {
      tag: 't1',
      len: 12,
      depth: 10,
      height: 6,
      navPhysics: physics,
      stair: { ax: -40, y0: 0, az: 21, bx: -40, y1: 6, bz: 29, width: 2.2 },
    });
    const proxyCount = terraceSpec.navProxies?.length ?? 0;
    expect(proxyCount).toBeGreaterThanOrEqual(3);
    expect(physics.world.colliders.len()).toBe(baseColliders + proxyCount);

    const terrace = manager.addCluster(terraceSpec);
    // Proxy colliders must be removed before real destructible colliders are added (no double-stacking)
    expect(physics.world.colliders.len()).toBe(baseColliders + terrace.nodes.length);
    expect(terraceSpec.navProxies).toEqual([]);

    const extraSpecs = [
      buildTowerCluster([-10, 0, 20], { tag: 'tw1', w: 6, d: 6, h: 12 }),
      buildGateTowerCluster([10, 0, 20], { tag: 'gt1' }),
      buildWallGunPadCluster(25, { tag: 'wp1', halfX: 2.8, z0: 18, z1: 23, height: 3, navPhysics: physics, stair: { ax: 22, y0: 0, az: 18, bx: 22, y1: 3, bz: 22, width: 2 } }),
      buildFiringStepCluster({ tag: 'fs1', x0: 35, x1: 47, z0: 19, z1: 22, height: 2, navPhysics: physics, stair: { ax: 35, y0: 0, az: 18, bx: 39, y1: 2, bz: 18, width: 2 } }),
      buildShantyHouseCluster([60, 0, 20], { tag: 'sh1', w: 7, d: 6, h: 3, sandbagFront: true, navPhysics: physics, stair: { ax: 56, y0: 0, az: 18, bx: 56, y1: 3, bz: 22, width: 1.8 } }),
      buildWatchtowerCluster([80, 0, 20], { tag: 'wt1' }),
      buildMunitionsShedCluster([95, 0, 20], { tag: 'ms1' }),
      buildPillboxCluster([110, 0, 20], { tag: 'pb1' }),
      buildFountainCluster([125, 0, 20], { tag: 'fn1' }),
      buildBoatShedCluster(135, 10, 155, 34, 12, { tag: 'bs1' }),
      buildStaircaseCluster({ ax: 160, y0: 0, az: 20, bx: 168, y1: 4, bz: 20, width: 2.4 }, { tag: 'st1', navPhysics: physics, landing: { pos: [169, 3.9, 20], half: [1.2, 0.12, 1.2] } }),
      buildContainerCluster([180, 0, 20], { tag: 'ct1' }),
    ];

    for (const spec of extraSpecs) {
      const c = manager.addCluster(spec);
      expect(c.nodes.length, spec.tag).toBeGreaterThanOrEqual(2);
      expect(c.nodes.some(n => n.anchored), `${spec.tag} anchored`).toBe(true);
    }

    // AC-130 105mm (8.0x) shatters Tier-2 Market Terrace cleanly
    manager.blast(V(-34, 2.5, 25), 14, 120, 'ac130_105mm');
    expect(terrace.collapsed).toBe(true);
    manager.clear();
  });

  it('nukeSweep progressively destroys clusters outward at 115 m/s', () => {
    const { manager } = makeEnv();
    const nearCluster = manager.addCluster(buildEmplacementPlatformCluster(V(20, 0, 0), { tag: 'near' }));
    const farCluster = manager.addCluster(buildQuayCraneCluster(V(150, 0, 0), { tag: 'far' }));

    manager.nukeSweep(V(0, 0, 0), 300);

    // After 0.30s -> shockwave radius = 34.5m: near cluster (20m) is shattered, far cluster (150m) is still intact!
    manager.update(0.30);
    expect(nearCluster.collapsed).toBe(true);
    expect(nearCluster.intactCount).toBe(0);
    expect(farCluster.collapsed).toBe(false);
    expect(farCluster.intactCount).toBe(farCluster.nodes.length);

    // Advance enough time to cross 165m (165 / 115 ≈ 1.44s total -> +1.2s)
    const remainingSec = (170 - 0.30 * NUKE_SWEEP_SPEED) / NUKE_SWEEP_SPEED;
    manager.update(remainingSec);
    expect(farCluster.collapsed).toBe(true);
    expect(farCluster.intactCount).toBe(0);
    expect(manager.activeDynamicBodies).toBeLessThanOrEqual(MAX_DYNAMIC_BODIES);

    manager.clear();
  });
});

describe('next-gen jagged panel fracture, DMM deformation, splinters, and gradual hinged sagging', () => {
  function maxVertexDisplacement(geom: THREE.BufferGeometry, restPos: Float32Array): number {
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    let maxD = 0;
    for (let i = 0; i < pos.count; i++) {
      const o = i * 3;
      const d = Math.hypot(arr[o]! - restPos[o]!, arr[o + 1]! - restPos[o + 1]!, arr[o + 2]! - restPos[o + 2]!);
      if (d > maxD) maxD = d;
    }
    return maxD;
  }

  it('subdivides broad panels into watertight irregular jagged shards and punches localized shoot-through holes', () => {
    const { manager } = makeEnv();
    const cluster = manager.addCluster({
      id: 'fracture_wall',
      kind: 'shanty',
      nodes: [
        {
          id: 'sheet_wall',
          pos: [-110, 2.0, 0],
          half: [3.0, 2.0, 0.14], // 6m x 4m x 0.28m thin broad panel -> auto 3x2 jagged grid
          mat: 'plywood',
          hp: 100,
          tier: 0,
          anchored: true,
          kind: 'wall',
        },
      ],
    });
    physics.flushQueries();

    const cells = cluster.getNodes('sheet_wall');
    expect(cells.length).toBe(6); // 3x2 irregular jagged shard cells
    expect(cells.every(c => c.isFractureCell)).toBe(true);
    expect(cluster.getNode('sheet_wall')).toBe(cells[0]);

    // Watertight intact wall: a dense sweep of rays across the entire panel face must all hit!
    for (const xOff of [-2.4, -1.2, 0.0, 1.2, 2.4]) {
      for (const y of [0.8, 2.0, 3.2]) {
        const hit = physics.raycast(V(-110 + xOff, y, -3), V(0, 0, 1), 6);
        expect(hit, `watertight ray at x=${xOff}, y=${y}`).not.toBeNull();
      }
    }

    // Punch ONLY the top-left cell (row=1, col=0 -> cell index 3) via direct .50 cal collider hit
    const targetCell = cells[3]!;
    const farNeighbor = cells[2]!; // bottom-right cell
    const hitPoint = targetCell.basePos.clone();
    expect(manager.damageCollider(targetCell.staticCollider, 150, 'piledriver', hitPoint)).toBe(true);
    physics.flushQueries();

    // ONLY the punched cell broke away; surrounding jagged cells remain standing!
    expect(targetCell.state).toBe('falling');
    expect(targetCell.staticCollider).toBeNull();
    expect(farNeighbor.state).toBe('intact');
    expect(cluster.intactCount).toBe(5);

    // Bullets & rays now fly cleanly RIGHT THROUGH the punched hole while neighbors still block!
    const holeRay = physics.raycast(V(hitPoint.x, hitPoint.y, -3), V(0, 0, 1), 6);
    expect(holeRay).toBeNull();
    const neighborRay = physics.raycast(V(farNeighbor.basePos.x, farNeighbor.basePos.y, -3), V(0, 0, 1), 6);
    expect(neighborRay).not.toBeNull();

    // Blowing out all 3 bottom-row anchored cells drops the remaining unsupported top cells into sagging!
    for (const bottomCell of [cells[0]!, cells[1]!, cells[2]!]) {
      manager.damageCollider(bottomCell.staticCollider, 200, 'piledriver', bottomCell.basePos);
    }
    expect(cells[4]!.state).toBe('tilting');
    expect(cells[5]!.state).toBe('tilting');

    manager.clear();
  });

  it('visibly bends/twists wood vertices, darkens cracks, and spawns pooled 3D wood splinters on non-lethal hits', () => {
    const { manager, audioPlay } = makeEnv();
    const cluster = manager.addCluster({
      id: 'wood_beam_test',
      kind: 'test',
      nodes: [
        {
          id: 'post',
          pos: [-130, 2.0, 0],
          half: [0.22, 2.0, 0.22], // 4m wooden column -> subdivided 6 segments along Y
          mat: 'plywood',
          hp: 200,
          tier: 0,
          anchored: true,
          kind: 'column',
        },
      ],
    });
    const post = cluster.getNode('post')!;
    expect(post.materialClass).toBe('wood');
    expect(maxVertexDisplacement(post.mesh!.geometry, post.restPositions)).toBe(0);

    // Non-lethal .50 cal hit #1 (drops HP below 85%): bends/twists wood + spawns wood splinters + wood crack audio
    const impact1 = V(-130.22, 2.1, 0);
    manager.damageCollider(post.staticCollider, 50, 'piledriver', impact1);
    expect(post.state).toBe('intact');
    expect(post.hp).toBeLessThan(170);
    const disp1 = maxVertexDisplacement(post.mesh!.geometry, post.restPositions);
    expect(disp1).toBeGreaterThan(0.05);
    expect(manager.splinters.woodSpawned).toBeGreaterThanOrEqual(3);
    expect(manager.activeSplinters).toBeGreaterThan(0);
    expect(manager.activeSplinters).toBeLessThanOrEqual(MAX_SPLINTERS);
    expect(audioPlay).toHaveBeenCalledWith('bone_snap', expect.anything());

    // Non-lethal hit #2 (drops HP below 35%): bends even further & darkens crack zone vertex colors
    manager.damageCollider(post.staticCollider, 55, 'piledriver', impact1);
    const disp2 = maxVertexDisplacement(post.mesh!.geometry, post.restPositions);
    expect(disp2).toBeGreaterThan(disp1);

    const colArr = (post.mesh!.geometry.getAttribute('color') as THREE.BufferAttribute).array as Uint8Array;
    let darkened = false;
    for (let i = 0; i < colArr.length; i += 4) {
      if (colArr[i]! < post.restColors[i]! - 10) {
        darkened = true;
        break;
      }
    }
    expect(darkened).toBe(true);

    // Final lethal hit: launches with burst of 6-10 elongated wood splinters & elastic whip
    const woodBeforeBreak = manager.splinters.woodSpawned;
    manager.damageCollider(post.staticCollider, 100, 'piledriver', impact1);
    expect(post.state).toBe('falling');
    expect(manager.splinters.woodSpawned - woodBeforeBreak).toBeGreaterThanOrEqual(6);
    expect(manager.activeSplinters).toBeLessThanOrEqual(MAX_SPLINTERS);

    // Step splinter simulation and verify splinters advance smoothly
    stepPhysics(manager, 15);
    expect(manager.activeSplinters).toBeLessThanOrEqual(MAX_SPLINTERS);

    manager.clear();
  });

  it('visibly dents metal vertices inward around the local impact point without breaking', () => {
    const { manager } = makeEnv();
    const cluster = manager.addCluster({
      id: 'metal_dent_test',
      kind: 'test',
      nodes: [
        {
          id: 'plate',
          pos: [-150, 2.0, 0],
          half: [1.5, 1.5, 0.2],
          mat: 'steel',
          hp: 400,
          tier: 0,
          anchored: true,
          kind: 'wall',
          fractureGrid: [1, 1], // single panel to inspect denting cleanly
        },
      ],
    });
    const plate = cluster.getNode('plate')!;
    expect(plate.materialClass).toBe('metal');

    // Hit on front (+Z) face near (-0.4, +0.3, +0.2) in local space with .50 cal HMG
    const worldHit = V(-150.4, 2.3, 0.2);
    manager.damageCollider(plate.staticCollider, 140, 'piledriver', worldHit);
    expect(plate.state).toBe('intact');

    const posAttr = plate.mesh!.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    let maxNearDentInward = 0;
    for (let i = 0; i < posAttr.count; i++) {
      const o = i * 3;
      const rx = plate.restPositions[o]!;
      const ry = plate.restPositions[o + 1]!;
      const rz = plate.restPositions[o + 2]!;
      if (Math.hypot(rx - (-0.4), ry - 0.3, rz - 0.2) < 0.75) {
        // Impact came from +Z toward center (-Z direction), so inward dent moves Z negative
        const inward = rz - arr[o + 2]!;
        if (inward > maxNearDentInward) maxNearDentInward = inward;
      }
    }
    expect(maxNearDentInward).toBeGreaterThan(0.05);
    expect(manager.splinters.metalSpawned).toBeGreaterThanOrEqual(1);

    manager.clear();
  });

  it('holds unsupported roofs in gradual hinged sagging for > 0.4s before dropping them for lethal crush damage', () => {
    const { manager, livingEnemies, applyDamage } = makeEnv();
    const enemy = { uid: 99, alive: true, position: V(-170, 0, 0), center: V(-170, 1.0, 0) };
    livingEnemies.push(enemy);

    const cluster = manager.addCluster({
      id: 'sag_crush_tower',
      kind: 'watchtower',
      nodes: [
        { id: 'leg_l', pos: [-172, 2.5, 0], half: [0.3, 2.5, 0.3], mat: 'plywood', hp: 50, tier: 0, anchored: true, kind: 'column' },
        { id: 'leg_r', pos: [-168, 2.5, 0], half: [0.3, 2.5, 0.3], mat: 'plywood', hp: 50, tier: 0, anchored: true, kind: 'column' },
        { id: 'deck', pos: [-170, 5.4, 0], half: [2.4, 0.45, 2.0], mat: 'plywood', hp: 300, tier: 0, anchored: false, kind: 'slab' },
      ],
      links: [
        ['leg_l', 'deck'],
        ['leg_r', 'deck'],
      ],
    });
    const deck = cluster.getNode('deck')!;

    // Knock out both legs -> deck enters gradual 0.55-0.90s hinged groan-and-sag phase
    manager.blast(V(-172, 2.5, 0), 1.5, 100, 'rocket');
    manager.blast(V(-168, 2.5, 0), 1.5, 100, 'rocket');
    expect(deck.state).toBe('tilting');
    expect(deck.tiltDuration).toBeGreaterThanOrEqual(0.55);
    expect(deck.tiltDuration).toBeLessThanOrEqual(0.92);

    const startY = deck.mesh!.position.y;
    const startQuat = deck.mesh!.quaternion.clone();
    const splintersBefore = manager.splinters.totalSpawned;

    // After 0.42s (25 frames): MUST still be in gradual hinged sagging, visibly rotated & sagging downward,
    // and continuously emitting joint-tearing splinters!
    stepPhysics(manager, 25);
    expect(deck.state).toBe('tilting');
    expect(deck.mesh!.position.y).toBeLessThan(startY - 0.05);
    expect(deck.mesh!.quaternion.angleTo(startQuat)).toBeGreaterThan(0.03);
    expect(manager.splinters.totalSpawned).toBeGreaterThan(splintersBefore);

    // Advance another ~1.25s so deck shears free, crashes down, and crushes the enemy underneath!
    stepPhysics(manager, 75);
    expect(deck.state === 'falling' || deck.state === 'settled').toBe(true);
    expect(applyDamage).toHaveBeenCalledWith(
      enemy,
      expect.objectContaining({
        amount: 350,
        type: 'crush',
        source: 'structural_collapse',
        gib: true,
      }),
    );

    manager.clear();
  });

  it('strictly caps pooled 3D splinters at MAX_SPLINTERS (90) under heavy destruction', () => {
    const { manager } = makeEnv();
    const nodes = [];
    for (let i = 0; i < 30; i++) {
      nodes.push({
        id: `w_${i}`,
        pos: [-200 + (i % 6) * 1.5, 1.5 + Math.floor(i / 6) * 1.5, 0] as const,
        half: [0.4, 0.4, 0.4] as const,
        mat: 'plywood' as const,
        hp: 20,
        tier: 0 as const,
        anchored: true,
        kind: 'column' as const,
      });
    }
    manager.addCluster({ id: 'splinter_stress', kind: 'test', nodes });
    manager.blast(V(-196, 4, 0), 25, 200, 'rocket');
    expect(manager.splinters.totalSpawned).toBeGreaterThan(MAX_SPLINTERS);
    expect(manager.activeSplinters).toBeLessThanOrEqual(MAX_SPLINTERS);
    expect(manager.activeSplinters).toBe(MAX_SPLINTERS);
    manager.clear();
    expect(manager.activeSplinters).toBe(0);
  });
});

describe('Destruction Overhaul — Material Matrix, Zero-Floating Solver, Concrete Fracture & Vehicle Ramming', () => {
  it('enforces realistic material-vs-damage rules across all 7 structural materials', () => {
    // Glass: even pistols & SMGs shatter it
    expect(canDamageMaterial('glass', 'pistol')).toBe(true);
    expect(canDamageMaterial('glass', 'rifle')).toBe(true);

    // Drywall: shotguns, HMGs, explosives, and any vehicle ram shred it
    expect(canDamageMaterial('drywall', 'shotgun')).toBe(true);
    expect(canDamageMaterial('drywall', 'hmg')).toBe(true);
    expect(canDamageMaterial('drywall', 'ram_light')).toBe(true);

    // Timber (wooden shacks & watchtowers): immune to assault rifles / SMGs / pistols;
    // shredded by .50 cal (piledriver), HMGs, autocannons, fire, explosives, and medium+ vehicle rams
    expect(canDamageMaterial('timber', 'rifle')).toBe(false);
    expect(canDamageMaterial('timber', 'smg')).toBe(false);
    expect(canDamageMaterial('timber', 'pistol')).toBe(false);
    expect(canDamageMaterial('timber', 'piledriver')).toBe(true);
    expect(canDamageMaterial('timber', 'hmg')).toBe(true);
    expect(canDamageMaterial('timber', 'autocannon')).toBe(true);
    expect(canDamageMaterial('timber', 'rocket')).toBe(true);
    expect(canVehicleRamMaterial('timber', 'light', 14)).toBe(false);
    expect(canVehicleRamMaterial('timber', 'medium', 14)).toBe(true);
    expect(canVehicleRamMaterial('timber', 'heavy', 14)).toBe(true);

    // Masonry (brick houses): immune to small arms & HMGs; breached by explosives, autocannons, heavy tank rams
    expect(canDamageMaterial('masonry', 'rifle')).toBe(false);
    expect(canDamageMaterial('masonry', 'hmg')).toBe(false);
    expect(canDamageMaterial('masonry', 'rocket')).toBe(true);
    expect(canVehicleRamMaterial('masonry', 'medium', 14)).toBe(false);
    expect(canVehicleRamMaterial('masonry', 'heavy', 14)).toBe(true);

    // Poured Concrete (offices & parking garages): immune to small arms, HMGs, .50 cal; blown apart by heavy explosives
    expect(canDamageMaterial('concrete', 'rifle')).toBe(false);
    expect(canDamageMaterial('concrete', 'piledriver')).toBe(false);
    expect(canDamageMaterial('concrete', 'hmg')).toBe(false);
    expect(canDamageMaterial('concrete', 'rocket')).toBe(true);
    expect(canDamageMaterial('concrete', 'tank_cannon')).toBe(true);
    expect(canDamageMaterial('concrete', 'satchel')).toBe(true);

    // Reinforced Concrete (Tier-3 bunkers): immune to small arms, standard rockets, and tank rams; siege ordnance only!
    expect(canDamageMaterial('reinforced_concrete', 'rifle')).toBe(false);
    expect(canDamageMaterial('reinforced_concrete', 'rocket')).toBe(false);
    expect(canDamageMaterial('reinforced_concrete', 'ram_heavy')).toBe(false);
    expect(canVehicleRamMaterial('reinforced_concrete', 'heavy', 18)).toBe(false);
    expect(canDamageMaterial('reinforced_concrete', 'howitzer')).toBe(true);
    expect(canDamageMaterial('reinforced_concrete', 'bomb')).toBe(true);
    expect(canDamageMaterial('reinforced_concrete', 'breach_charge')).toBe(true);
    expect(canDamageMaterial('reinforced_concrete', 'nuke')).toBe(true);
  });

  it('blocks assault rifles from damaging wooden shacks while .50 cal shreds them', () => {
    const { manager } = makeEnv();
    const cluster = manager.addCluster(buildTimberShackCluster('shack_mat_test', -100, 120, 0));
    const wall = cluster.getNode('shack_n')!;
    const startHp = wall.hp;
    const initialNodes = cluster.nodes.length;

    // Assault rifle / SMG cannot scratch the timber shack
    const arRes = manager.damageCollider(wall.staticCollider!, 80, 'rifle', wall.basePos);
    expect(arRes).toBe(true);
    expect(wall.hp).toBe(startHp);
    expect(cluster.nodes.length).toBe(initialNodes);

    // .50 cal (piledriver) punches straight through timber (lazily fracturing & damaging/breaching cells!)
    const fiftyRes = manager.damageCollider(wall.staticCollider!, 80, 'piledriver', wall.basePos);
    expect(fiftyRes).toBe(true);
    const children = cluster.nodes.filter((n) => n.origId === 'shack_n' && n.id !== 'shack_n');
    expect(children.length).toBeGreaterThanOrEqual(2);
    expect(children.some((c) => c.hp < c.maxHp || c.state !== 'intact')).toBe(true);

    manager.clear();
  });

  it('prevents floating watchtowers: 1 broken leg stands, but 2 adjacent or 3 broken legs immediately tip & collapse the deck', () => {
    const { manager } = makeEnv();
    const cluster = manager.addCluster(buildFieldWatchtowerCluster('wt_zero_float', -40, 120, 0));
    const deck = cluster.getNode('deck')!;
    const roof = cluster.getNode('roof')!;

    // Break 1 stilt (stilt_fl) -> 3 remaining stilts still form a stable triangle supporting the center of mass!
    const stiltFL = cluster.getNode('stilt_fl')!;
    manager.damageCollider(stiltFL.staticCollider!, 500, 'hmg', stiltFL.basePos);
    expect(stiltFL.state).not.toBe('intact');
    expect(deck.state).toBe('intact');
    expect(roof.state).toBe('intact');

    // Break an adjacent stilt (stilt_fr) -> both front stilts gone! CoM now lies completely outside the 2-rear-leg support hull -> tips & collapses!
    const stiltFR = cluster.getNode('stilt_fr')!;
    manager.damageCollider(stiltFR.staticCollider!, 500, 'hmg', stiltFR.basePos);
    expect(stiltFR.state).not.toBe('intact');
    expect(deck.state === 'tilting' || deck.state === 'falling').toBe(true);
    expect(roof.state === 'tilting' || roof.state === 'falling').toBe(true);

    manager.clear();

    // Also verify 3 legs broken (even non-adjacent first, then 3rd) guarantees total collapse
    const cluster2 = manager.addCluster(buildFieldWatchtowerCluster('wt_three_legs', 0, 120, 0));
    const deck2 = cluster2.getNode('deck')!;
    for (const id of ['stilt_fl', 'stilt_br', 'stilt_fr']) {
      const leg = cluster2.getNode(id)!;
      if (leg.staticCollider) {
        manager.damageCollider(leg.staticCollider, 500, 'hmg', leg.basePos);
      }
    }
    expect(deck2.state === 'tilting' || deck2.state === 'falling').toBe(true);

    manager.clear();
  });

  it('lazily fractures poured-concrete office walls around explosive impact points with exposed rebar cores', () => {
    const { manager } = makeEnv();
    const cluster = manager.addCluster(buildWarOfficeCluster('office_fracture_test', 45, 120, 0, 2));
    const sill = cluster.getNode('side_sill_f0_e')!;
    expect(sill.spec.lazyFracture).toBe(true);
    expect(sill.spec.structuralMaterial).toBe('concrete');

    const initialNodeCount = cluster.nodes.length;
    const startHp = sill.hp;

    // Small arms must be blocked on poured concrete
    const arHit = manager.damageCollider(sill.staticCollider!, 120, 'rifle', sill.basePos);
    expect(arHit).toBe(true);
    expect(sill.hp).toBe(startHp);
    expect(cluster.nodes.length).toBe(initialNodeCount);

    // Heavy explosive hit triggers lazy localized fracture around the hit point into jagged concrete + rebar cells!
    const impactPt = sill.basePos.clone().add(V(0, 0, 1.2));
    const rocketHit = manager.damageCollider(sill.staticCollider!, 250, 'tank_cannon', impactPt);
    expect(rocketHit).toBe(true);
    expect(cluster.nodes.length).toBeGreaterThan(initialNodeCount);

    // Verify spawned fracture cells were created with concrete rebar fracture metadata
    const fractureChildren = cluster.nodes.filter((n) => n.origId === 'side_sill_f0_e' && n.id !== 'side_sill_f0_e');
    expect(fractureChildren.length).toBeGreaterThanOrEqual(2);

    manager.clear();
  });

  it('lets heavy tanks smash straight through drywall/masonry houses while deflecting off Tier-3 reinforced bunkers', () => {
    const { manager } = makeEnv();

    // 1) Heavy tank smashing into a 2-story brick house wall -> breaches cleanly with high speed retention!
    const house = manager.addCluster(buildWarHouseCluster('house_ram_test', 95, 120, 0, { style: 'brick' }));
    const houseWall = house.getNode('h_wall_f0_e')!;
    const hitPt = houseWall.basePos.clone();
    const ramDir = V(-1, 0, 0);

    // Light jeep bounces off masonry house wall
    const lightRes = manager.tryVehicleRam(houseWall.staticCollider!, 'light', 14, hitPt, ramDir);
    expect(lightRes.hit).toBe(true);
    expect(lightRes.breached).toBe(false);
    expect(lightRes.speedRetain).toBe(0);
    expect(houseWall.state).toBe('intact');

    // Heavy MBT smashes right through the masonry house wall!
    const tankHouseRes = manager.tryVehicleRam(houseWall.staticCollider!, 'heavy', 14, hitPt, ramDir);
    expect(tankHouseRes.hit).toBe(true);
    expect(tankHouseRes.breached).toBe(true);
    expect(tankHouseRes.speedRetain).toBeGreaterThan(0.6);
    expect(houseWall.state).not.toBe('intact');

    // 2) Heavy tank ramming a Tier-3 reinforced concrete bunker -> hard deflect (breached: false, speedRetain: 0)!
    const bunker = manager.addCluster(buildReinforcedBunkerCluster('bunker_ram_test', 135, 120, 0, true));
    const bunkerWall = bunker.getNode('bk_w')!;
    const bHitPt = bunkerWall.basePos.clone();
    const tankBunkerRes = manager.tryVehicleRam(bunkerWall.staticCollider!, 'heavy', 18, bHitPt, V(1, 0, 0));
    expect(tankBunkerRes.hit).toBe(true);
    expect(tankBunkerRes.breached).toBe(false);
    expect(tankBunkerRes.speedRetain).toBe(0);
    expect(bunkerWall.state).toBe('intact');
    expect(bunkerWall.hp).toBe(1400);

    manager.clear();
  });
});


