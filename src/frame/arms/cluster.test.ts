/**
 * Tests for the Bomblet Cannon arm weapon (`arms/cluster.ts`) and shared wall-bouncing `bombletCarpet` (`bomblets.ts`).
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { Ctx, RayHit } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec } from '../../core/gameplay';
import type { Ac130Rounds } from '../../progression/callins/ac130Rounds';
import type { GunnerWeapon } from '../../vehicles/hud';
import {
  activeBombletCount,
  BOMBLET_RESTITUTION,
  bombletCarpet,
  clearBomblets,
  reflectBombletVelocity,
  updateBomblets,
} from '../bomblets';
import { CLUSTER_PLUGIN, CLUSTER_SPEC, CLUSTER_TUNING, ClusterArmGun, ClusterCannon, clusterBurstPoint } from './cluster';
import type { Arm, ArmUpdateContext, Sight } from './types';

const DT = 1 / 60;

interface RecordedBlast {
  at: THREE.Vector3;
  time: number;
  spec: ExplosionSpec;
}

interface MockHarness {
  ctx: Ctx;
  blasts: RecordedBlast[];
  sounds: string[];
  rings: THREE.Vector3[];
  tracers: { from: THREE.Vector3; to: THREE.Vector3 }[];
  traumas: number[];
  kicks: number[];
  recoils: number[];
  news: { kind: string; values: number[] }[];
  preStep: Set<(dt: number) => void>;
  arm: Arm;
  sight: Sight;
  rounds: Ac130Rounds;
  now: { t: number };
}

function makeHarness(opts: {
  wallAt?: number | null;
  wallNormal?: THREE.Vector3;
  floorY?: number;
  enemies?: EnemyInstance[];
  withPreStep?: boolean;
} = {}): MockHarness {
  const blasts: RecordedBlast[] = [];
  const sounds: string[] = [];
  const rings: THREE.Vector3[] = [];
  const tracers: { from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  const traumas: number[] = [];
  const kicks: number[] = [];
  const recoils: number[] = [];
  const news: { kind: string; values: number[] }[] = [];
  const preStep = new Set<(dt: number) => void>();
  const now = { t: 0 };
  const floorY = opts.floorY ?? 0;
  const wallAt = opts.wallAt ?? null; // wall plane at z = -wallAt
  const wallNormal = opts.wallNormal ?? new THREE.Vector3(0, 0, 1);

  const raycast = (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null => {
    let bestT = Infinity;
    let bestN: THREE.Vector3 | null = null;

    if (wallAt !== null && Math.abs(dir.z) > 1e-5) {
      const tWall = (-wallAt - origin.z) / dir.z;
      if (tWall >= 0 && tWall <= maxDist && tWall < bestT) {
        bestT = tWall;
        bestN = wallNormal;
      }
    }
    if (dir.y < -1e-5) {
      const tFloor = (floorY - origin.y) / dir.y;
      if (tFloor >= 0 && tFloor <= maxDist && tFloor < bestT) {
        bestT = tFloor;
        bestN = new THREE.Vector3(0, 1, 0);
      }
    }
    if (!bestN) return null;
    return {
      point: new THREE.Vector3().copy(origin).addScaledVector(dir, bestT),
      normal: bestN.clone(),
      distance: bestT,
      surface: 'concrete',
      collider: null,
    };
  };

  const ctx = {
    audio: { play: (id: string) => sounds.push(id) },
    camera: {
      addTrauma: (v: number) => traumas.push(v),
      kick: (p: number) => kicks.push(p),
    },
    fx: {
      muzzleFlash: () => undefined,
      tracer: (from: THREE.Vector3, to: THREE.Vector3) => tracers.push({ from: from.clone(), to: to.clone() }),
      ring: (at: THREE.Vector3) => rings.push(at.clone()),
      smoke: () => undefined,
      sparks: () => undefined,
      shellCasing: () => undefined,
    },
    combat: {
      explode: (at: THREE.Vector3, spec: ExplosionSpec) => {
        blasts.push({ at: at.clone(), time: now.t, spec: { ...spec } });
      },
    },
    enemies: {
      alive: opts.enemies ?? [],
      raycast: () => null,
      query: () => 0,
    },
    physics: {
      raycast,
      radialImpulse: () => undefined,
      ...(opts.withPreStep ? { preStep } : {}),
    },
    render: {
      lights: { flash: () => undefined },
    },
  } as unknown as Ctx;

  const arm: Arm = {
    muzzle: out => out.set(0, 3, 0),
    bore: out => out.set(0, 0, -1),
    turn: () => undefined,
    recoil: m => recoils.push(m),
  };

  const sight: Sight = {
    view: { position: new THREE.Vector3(0, 5, 0) } as Sight['view'],
    aim: new THREE.Vector3(0, 0, -1),
    point: new THREE.Vector3(0, 3, -40),
    range: 40,
  };

  const rounds = {
    flash: () => undefined,
  } as unknown as Ac130Rounds;

  return { ctx, blasts, sounds, rings, tracers, traumas, kicks, recoils, news, preStep, arm, sight, rounds, now };
}

function makeEnemy(uid: number, x: number, y: number, z: number): EnemyInstance {
  return {
    uid,
    alive: true,
    position: new THREE.Vector3(x, y - 1, z),
    center: new THREE.Vector3(x, y, z),
  } as unknown as EnemyInstance;
}

function makeUpdate(h: MockHarness, overrides: Partial<ArmUpdateContext> = {}): ArmUpdateContext {
  return {
    ctx: h.ctx,
    rounds: h.rounds,
    arm: h.arm,
    side: 'right',
    button: 'RMB',
    cycleKey: '2',
    sight: h.sight,
    held: false,
    pressed: false,
    cyclePressed: false,
    reloadPressed: false,
    recoilMult: 1,
    onShell: null,
    onNews: (kind, values) => h.news.push({ kind, values }),
    ...overrides,
  };
}

afterEach(() => {
  clearBomblets();
});

describe('Bomblet Cannon standoff fuze', () => {
  it('bursts 7 m short of the first world surface along its aim line', () => {
    const h = makeHarness({ wallAt: 30 });
    const out = new THREE.Vector3();
    const dist = clusterBurstPoint(h.ctx, new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 0, -1), out);
    expect(dist).toBeCloseTo(23, 3);
    expect(out.z).toBeCloseTo(-23, 3);
  });

  it('bursts 7 m short of the first enemy body when closer than the wall', () => {
    const h = makeHarness({ wallAt: 50, enemies: [makeEnemy(1, 0.8, 3, -20), makeEnemy(2, 0, 3, -35)] });
    const out = new THREE.Vector3();
    const dist = clusterBurstPoint(h.ctx, new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 0, -1), out);
    expect(dist).toBeCloseTo(13, 3);
    expect(out.z).toBeCloseTo(-13, 3);
  });

  it('clamps burst distance to at least 2 m from the muzzle on point-blank obstacles', () => {
    const h = makeHarness({ wallAt: 4 });
    const out = new THREE.Vector3();
    const dist = clusterBurstPoint(h.ctx, new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 0, -1), out);
    expect(dist).toBe(CLUSTER_TUNING.minBurst);
    expect(out.z).toBeCloseTo(-2, 3);
  });
});

describe('bombletCarpet physics and 0.7 s ripple', () => {
  it('throws 28 bomblets ahead and ripples detonations across 0.7 s (never all on one frame)', () => {
    const h = makeHarness({ floorY: 0 });
    const origin = new THREE.Vector3(0, 3, -10);
    const dir = new THREE.Vector3(0, 0, -1);

    bombletCarpet(h.ctx, origin, dir, CLUSTER_SPEC);
    expect(activeBombletCount(h.ctx)).toBe(28);

    // Step across 1.5 s at 60 Hz.
    for (let i = 0; i < 90; i++) {
      h.now.t += DT;
      updateBomblets(DT, h.ctx);
    }

    expect(activeBombletCount(h.ctx)).toBe(0);
    expect(h.blasts.length).toBe(28);
    expect(h.blasts.every(b => b.spec.radius === 2.4 && b.spec.damage === 70 && b.spec.source === 'frame_cluster')).toBe(true);

    const times = h.blasts.map(b => b.time);
    const span = Math.max(...times) - Math.min(...times);
    expect(span).toBeGreaterThanOrEqual(0.65);
    expect(span).toBeLessThanOrEqual(0.76);
    // Must ripple across many frames, not pop on a single frame.
    const uniqueFrames = new Set(times.map(t => Math.round(t * 60)));
    expect(uniqueFrames.size).toBeGreaterThanOrEqual(18);

    // Forward carpet footprint covers ahead of origin along -Z with lateral spread.
    const minZ = Math.min(...h.blasts.map(b => b.at.z));
    const maxZ = Math.max(...h.blasts.map(b => b.at.z));
    const widthX = Math.max(...h.blasts.map(b => b.at.x)) - Math.min(...h.blasts.map(b => b.at.x));
    expect(maxZ).toBeLessThan(origin.z);
    expect(origin.z - minZ).toBeGreaterThan(6);
    expect(widthX).toBeGreaterThan(4);
  });

  it('bounces once off walls with restitution ~0.45 before settling on the ground', () => {
    // Pure reflection math check.
    const v = new THREE.Vector3(0, 0, -20);
    reflectBombletVelocity(v, new THREE.Vector3(0, 0, 1), BOMBLET_RESTITUTION);
    expect(v.z).toBeCloseTo(20 * BOMBLET_RESTITUTION, 3);

    // End-to-end wall bounce: wall right in front of origin at z = -3.
    const h = makeHarness({ wallAt: 3, floorY: 0 });
    bombletCarpet(h.ctx, new THREE.Vector3(0, 2.5, 0), new THREE.Vector3(0, 0, -1), {
      ...CLUSTER_SPEC,
      count: 6,
      length: 14,
      width: 2,
      ripple: 0.3,
    });

    for (let i = 0; i < 60; i++) {
      h.now.t += DT;
      updateBomblets(DT, h.ctx);
    }

    expect(h.blasts.length).toBe(6);
    // Every bomblet must stay on the near side of the wall (z >= -3.01) after bouncing back.
    for (const b of h.blasts) {
      expect(b.at.z).toBeGreaterThan(-3.05);
      expect(b.at.y).toBeGreaterThanOrEqual(-0.05);
    }
  });

  it('auto-attaches to physics.preStep and detaches cleanly once all bomblets finish', () => {
    const h = makeHarness({ floorY: 0, withPreStep: true });
    expect(h.preStep.size).toBe(0);

    bombletCarpet(h.ctx, new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 0, -1), { ...CLUSTER_SPEC, count: 4, ripple: 0.2 });
    expect(h.preStep.size).toBe(1);

    for (let i = 0; i < 60; i++) {
      h.now.t += DT;
      for (const hook of [...h.preStep]) hook(DT);
    }
    expect(h.blasts.length).toBe(4);
    expect(h.preStep.size).toBe(0);
  });
});

describe('ClusterArmGun clock, recoil, HUD, and co-op remoteNews', () => {
  it('fires 1 shell, auto-reloads in 3.6 s, ignores ammo cycling, and scales recoil by recoilMult', () => {
    const h = makeHarness({ wallAt: 32, floorY: 0 });
    const gun = new ClusterArmGun(h.ctx);
    const row: GunnerWeapon = { name: '', ammo: 0, max: 0, reload: -1 };

    gun.fillRow(row, 'RMB');
    expect(row.name).toBe('RMB BOMBLET CANNON');
    expect(row.ammo).toBe(1);
    expect(row.max).toBe(1);
    expect(row.reload).toBe(-1);

    // Fire with recoilMult = 0 (Spider Legs steady platform): no camera kick or trauma.
    gun.update(DT, makeUpdate(h, { held: true, pressed: true, cyclePressed: true, recoilMult: 0 }));
    expect(gun.clock.mag.ammo).toBe(0);
    expect(gun.clock.mag.reloading).toBeCloseTo(CLUSTER_TUNING.reload, 2);
    expect(h.traumas.length).toBe(0);
    expect(h.kicks.length).toBe(0);
    expect(h.recoils.length).toBe(1);
    expect(h.tracers.length).toBe(1);
    expect(h.tracers[0]!.to.z).toBeCloseTo(-25, 2); // 32 m wall - 7 m standoff

    // Emits co-op 'cluster' news with burst position and direction.
    expect(h.news.length).toBe(1);
    expect(h.news[0]!.kind).toBe('cluster');
    expect(h.news[0]!.values.length).toBe(6);
    expect(h.news[0]!.values[2]).toBeCloseTo(-25, 2);

    // Step 3.5 s: still reloading; dry press plays dry click.
    for (let i = 0; i < Math.floor(3.4 / DT); i++) {
      h.now.t += DT;
      gun.update(DT, makeUpdate(h));
    }
    expect(gun.clock.mag.ammo).toBe(0);
    gun.fillRow(row, 'RMB');
    expect(row.reload).toBeGreaterThan(0.8);
    expect(h.blasts.length).toBe(28); // All 28 bomblets from shot 1 have rippled out.

    // Finish reload (~3.6 s total) and fire again with recoilMult = 1.
    for (let i = 0; i < Math.ceil(0.3 / DT); i++) {
      h.now.t += DT;
      gun.update(DT, makeUpdate(h));
    }
    expect(gun.clock.mag.ammo).toBe(1);
    expect(gun.clock.mag.ready).toBe(true);

    gun.update(DT, makeUpdate(h, { held: true, pressed: true, recoilMult: 1 }));
    expect(h.traumas.length).toBe(1);
    expect(h.kicks.length).toBe(1);
  });

  it('pure ClusterCannon clock auto-reloads in 3.6 s', () => {
    const c = new ClusterCannon();
    expect(c.mag.take()).toBe(true);
    expect(c.mag.ammo).toBe(0);
    let t = 0;
    for (; c.mag.reloading >= 0 && t < 5; t += DT) c.mag.update(DT);
    expect(c.mag.ammo).toBe(1);
    expect(t).toBeCloseTo(3.6, 1);
  });

  it('plays cosmetic airburst FX and 28 cosmetic bomblets on co-op remoteNews', () => {
    const h = makeHarness({ floorY: 0 });
    CLUSTER_PLUGIN.remoteNews?.(h.ctx, 'cluster', [2, 4, -20, 0, 0, -1]);

    expect(h.rings.length).toBe(1);
    expect(h.rings[0]!.z).toBeCloseTo(-20, 3);
    expect(activeBombletCount(h.ctx)).toBe(28);

    for (let i = 0; i < 90; i++) {
      h.now.t += DT;
      updateBomblets(DT, h.ctx);
    }

    expect(h.blasts.length).toBe(28);
    expect(h.blasts.every(b => b.spec.cosmetic === true)).toBe(true);
  });
});
