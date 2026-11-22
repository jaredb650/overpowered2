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
  buildCanneryCluster,
  buildCatwalkCluster,
  buildEmplacementPlatformCluster,
  buildMarketHallCluster,
  buildQuayCraneCluster,
  canDamageTier,
  damageMultiplierFor,
  DestructionManager,
  MAX_DYNAMIC_BODIES,
  NUKE_SWEEP_SPEED,
  type StructuralClusterSpec,
} from './destruction';

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
    // Tier 0: timber — damaged by everything
    for (const src of ['smg', 'shotgun', 'sword', 'rocket', 'satchel', 'frame_rotary_airburst', 'frame_40mm', 'frame_howitzer', 'nuke']) {
      expect(canDamageTier(0, src), `tier 0 vs ${src}`).toBe(true);
    }

    // Tier 1: masonry — blocks small arms and rotary airburst, allows explosives & frame ordnance
    expect(canDamageTier(1, 'smg')).toBe(false);
    expect(canDamageTier(1, 'shotgun')).toBe(false);
    expect(canDamageTier(1, 'frame_rotary_airburst')).toBe(false);
    for (const src of ['satchel', 'rocket', 'mgl', 'grenade', 'c4', 'frame_40mm', 'frame_40mm_ap', 'frame_stomp', 'frame_howitzer', 'tank_cannon', 'hazard_chain', 'nuke']) {
      expect(canDamageTier(1, src), `tier 1 vs ${src}`).toBe(true);
    }

    // Tier 2: heavy industrial — blocks hand-held rockets/satchels/mgl/grenade/c4 and rotary airburst
    for (const blocked of ['smg', 'rocket', 'satchel', 'mgl', 'grenade', 'c4', 'frame_rotary_airburst']) {
      expect(canDamageTier(2, blocked), `tier 2 should block ${blocked}`).toBe(false);
    }
    for (const allowed of ['frame_40mm', 'frame_40mm_ap', 'frame_howitzer', 'frame_stomp', 'frame_charge', 'frame_crush', 'frame_backhand', 'frame_pod', 'tank_cannon', 'hazard_chain', 'nuke']) {
      expect(canDamageTier(2, allowed), `tier 2 should allow ${allowed}`).toBe(true);
    }

    // Tier 3: reinforced concrete — ONLY frame_howitzer, nuke, hazard_chain
    for (const blocked of ['smg', 'rocket', 'satchel', 'frame_40mm', 'frame_40mm_ap', 'frame_stomp', 'frame_charge', 'frame_crush', 'frame_backhand', 'frame_pod', 'tank_cannon', 'frame_rotary_airburst']) {
      expect(canDamageTier(3, blocked), `tier 3 should block ${blocked}`).toBe(false);
    }
    for (const allowed of ['frame_howitzer', 'nuke', 'hazard_chain']) {
      expect(canDamageTier(3, allowed), `tier 3 should allow ${allowed}`).toBe(true);
    }
  });

  it('applies required source multipliers', () => {
    expect(damageMultiplierFor(1, 'satchel')).toBeCloseTo(3.2);
    expect(damageMultiplierFor(2, 'satchel')).toBe(0);
    expect(damageMultiplierFor(3, 'frame_howitzer')).toBeCloseTo(8.0);
    expect(damageMultiplierFor(2, 'frame_40mm_ap')).toBeCloseTo(2.5);
    expect(damageMultiplierFor(2, 'frame_40mm')).toBeCloseTo(2.2);
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

    // Break left column only: right column still supports slab & roof!
    manager.blast(V(-3, 2, 0), 2, 200, 'satchel');
    expect(cluster.getNode('col_l')!.state).toBe('falling');
    expect(slab.state).toBe('intact');
    expect(roof.state).toBe('intact');

    // Break right column: slab & roof lose all paths to anchored nodes -> enter tilting warning phase!
    manager.blast(V(3, 2, 0), 2, 200, 'satchel');
    expect(slab.state).toBe('tilting');
    expect(roof.state).toBe('tilting');
    expect(audioPlay).toHaveBeenCalledWith('metal_groan', expect.anything());

    // Advance past max tilt warning duration (0.35s) -> both release as real dynamic rigid bodies and fall!
    const roofY0 = roof.mesh!.position.y;
    stepPhysics(manager, 30); // 0.5s
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
