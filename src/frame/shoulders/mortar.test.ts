/**
 * Tests for the Mortar Rack shoulder weapon (`shoulders/mortar.ts`): 6-round rack, 0.5 s cadence, 6.5 s reload,
 * HE / WP / Cluster cycling, 25–180 m range clamping, 2.5 s flight time at 100 m, WP burning patches, Cluster
 * 32-bomblet shower, and co-op `remoteNews`.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { Ctx, RayHit } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec } from '../../core/gameplay';
import type { Ac130Rounds } from '../../progression/callins/ac130Rounds';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { Sight } from '../arms/types';
import { activeBombletCount, clearBomblets, updateBomblets } from '../bomblets';
import {
  activeMortarShellCount,
  activeWpPatchCount,
  clearMortarWorld,
  MORTAR_PLUGIN,
  MORTAR_ROUNDS,
  MORTAR_TUNING,
  mortarFlightTime,
  MortarRack,
  MortarShoulder,
  mortarTargetPoint,
  updateMortarWorld,
} from './mortar';
import type { ShoulderUpdateContext } from './types';

const DT = 1 / 60;

interface RecordedBlast {
  at: THREE.Vector3;
  time: number;
  spec: ExplosionSpec;
}

interface MortarHarness {
  ctx: Ctx;
  blasts: RecordedBlast[];
  sounds: string[];
  napalmCalls: { at: THREE.Vector3; radius: number; heat: number }[];
  smokes: { at: THREE.Vector3; color: THREE.ColorRepresentation | undefined }[];
  burned: { uid: number; seconds: number }[];
  news: { kind: string; values: number[] }[];
  preStep: Set<(dt: number) => void>;
  now: { t: number };
}

function makeHarness(opts: {
  groundY?: number;
  enemies?: EnemyInstance[];
  withPreStep?: boolean;
} = {}): MortarHarness {
  const blasts: RecordedBlast[] = [];
  const sounds: string[] = [];
  const napalmCalls: { at: THREE.Vector3; radius: number; heat: number }[] = [];
  const smokes: { at: THREE.Vector3; color: THREE.ColorRepresentation | undefined }[] = [];
  const burned: { uid: number; seconds: number }[] = [];
  const news: { kind: string; values: number[] }[] = [];
  const preStep = new Set<(dt: number) => void>();
  const now = { t: 0 };
  const groundY = opts.groundY ?? 0;
  const enemies = opts.enemies ?? [];

  const raycast = (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null => {
    if (dir.y < -1e-5) {
      const t = (groundY - origin.y) / dir.y;
      if (t >= 0 && t <= maxDist) {
        return {
          point: new THREE.Vector3().copy(origin).addScaledVector(dir, t),
          normal: new THREE.Vector3(0, 1, 0),
          distance: t,
          surface: 'dirt',
          collider: null,
        };
      }
    }
    return null;
  };

  const ctx = {
    audio: { play: (id: string) => sounds.push(id) },
    camera: { addTrauma: () => undefined },
    fx: {
      ring: () => undefined,
      smoke: (at: THREE.Vector3, color?: THREE.ColorRepresentation) => smokes.push({ at: at.clone(), color }),
      sparks: () => undefined,
      chips: () => undefined,
      embers: () => undefined,
      napalm: (at: THREE.Vector3, _n: THREE.Vector3, radius: number, heat: number) => {
        napalmCalls.push({ at: at.clone(), radius, heat });
      },
    },
    combat: {
      explode: (at: THREE.Vector3, spec: ExplosionSpec) => {
        blasts.push({ at: at.clone(), time: now.t, spec: { ...spec } });
      },
    },
    enemies: {
      alive: enemies,
      query: (center: THREE.Vector3, radius: number, out: EnemyInstance[]) => {
        out.length = 0;
        for (const e of enemies) {
          if (e.alive && e.position.distanceTo(center) <= radius) out.push(e);
        }
        return out.length;
      },
      afflict: (e: EnemyInstance, kind: string, seconds: number) => {
        if (kind === 'burn') burned.push({ uid: e.uid, seconds });
      },
    },
    physics: {
      raycast,
      radialImpulse: () => undefined,
      ...(opts.withPreStep ? { preStep } : {}),
    },
    world: {
      nav: { groundHeight: () => groundY },
    },
    render: {
      lights: { flash: () => undefined },
      decals: { add: () => undefined },
    },
  } as unknown as Ctx;

  return { ctx, blasts, sounds, napalmCalls, smokes, burned, news, preStep, now };
}

function makeEnemy(uid: number, x: number, y: number, z: number): EnemyInstance {
  return {
    uid,
    alive: true,
    position: new THREE.Vector3(x, y, z),
    center: new THREE.Vector3(x, y + 1, z),
  } as unknown as EnemyInstance;
}

function makeSight(x: number, y: number, z: number, range = 100): Sight {
  const viewPos = new THREE.Vector3(0, 5, 0);
  const point = new THREE.Vector3(x, y, z);
  const aim = point.clone().sub(viewPos).normalize();
  return {
    view: { position: viewPos } as Sight['view'],
    aim,
    point,
    range,
  };
}

function makeShoulderUpdate(
  h: MortarHarness,
  sight: Sight,
  overrides: Partial<ShoulderUpdateContext> = {},
): ShoulderUpdateContext {
  return {
    ctx: h.ctx,
    rounds: {} as Ac130Rounds,
    slot: 0,
    keyLabel: 'G',
    cycleKeyLabel: '3',
    sight,
    mountPos: out => out.set(1, 5, 0),
    feet: new THREE.Vector3(0, 0, 0),
    torsoYaw: 0,
    held: false,
    pressed: false,
    cyclePressed: false,
    online: true,
    gatherTargets: () => [],
    onMissile: null,
    onNews: (kind, values) => h.news.push({ kind, values }),
    popFreeFlares: () => undefined,
    ...overrides,
  };
}

afterEach(() => {
  clearMortarWorld();
  clearBomblets();
});

describe('MortarRack clock, cycling, range, and flight time', () => {
  it('fires 6 rounds at >= 0.5 s cadence on hold-release, then reloads in 6.5 s', () => {
    const rack = new MortarRack();
    expect(rack.ammo).toBe(6);

    // Rapid hold/release faster than 0.5 s cannot fire a second round until cooldown expires.
    expect(rack.update(DT, true)).toBe(false);
    expect(rack.aiming).toBe(true);
    expect(rack.update(DT, false)).toBe(true);
    expect(rack.ammo).toBe(5);

    // Immediately re-holding & releasing 0.1 s later does not fire yet.
    expect(rack.update(0.1, true)).toBe(false);
    expect(rack.update(0.05, false)).toBe(false);
    expect(rack.ammo).toBe(5);

    // Fire remaining 5 rounds spaced by 0.55 s.
    for (let r = 0; r < 5; r++) {
      rack.update(0.55, true);
      expect(rack.update(DT, false)).toBe(true);
    }
    expect(rack.ammo).toBe(0);
    expect(rack.reloading).toBeCloseTo(MORTAR_TUNING.reload, 2);

    // Advance until reload completes (~6.5 s).
    let elapsed = 0;
    for (; rack.reloading >= 0 && elapsed < 8; elapsed += DT) rack.update(DT, false);
    expect(rack.ammo).toBe(6);
    expect(elapsed).toBeCloseTo(6.5, 1);
  });

  it('cycles HE -> WP -> CLUSTER -> HE on cyclePressed and formats HUD rows', () => {
    const h = makeHarness();
    const mortar = new MortarShoulder(h.ctx);
    expect(mortar.hasCycle).toBe(true);

    const row: GunnerWeapon = { name: '', ammo: 0, max: 0, reload: -1 };
    const sight = makeSight(0, 0, -100, 100);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      mortar.fillRow(row, 'G', '3', true);
      seen.push(row.name);
      mortar.update(DT, makeShoulderUpdate(h, sight, { cyclePressed: true }));
    }
    expect(seen).toEqual([
      'G MORTAR HE // 3',
      'G MORTAR WP // 3',
      'G MORTAR CLUSTER // 3',
      'G MORTAR HE // 3',
    ]);
    expect(MORTAR_ROUNDS).toEqual(['HE', 'WP', 'CLUSTER']);

    mortar.fillRow(row, 'G', '3', false);
    expect(row.name).toBe('G MORTAR // OFFLINE');
    expect(row.ammo).toBe(0);
  });

  it('clamps target range to 25–180 m and scales flight time (~2.5 s at 100 m, clamped 1.2..4.0 s)', () => {
    const h = makeHarness({ groundY: 2 });
    const feet = new THREE.Vector3(0, 2, 0);
    const out = new THREE.Vector3();

    // Too close (10 m) -> clamped to 25 m.
    const nearRange = mortarTargetPoint(h.ctx, feet, makeSight(0, 2, -10, 10), out);
    expect(nearRange).toBe(25);
    expect(out.z).toBeCloseTo(-25, 2);
    expect(out.y).toBeCloseTo(2, 2);

    // Mid range (100 m) -> exact 100 m.
    const midRange = mortarTargetPoint(h.ctx, feet, makeSight(0, 2, -100, 100), out);
    expect(midRange).toBeCloseTo(100, 2);
    expect(out.z).toBeCloseTo(-100, 2);

    // Too far (260 m) -> clamped to 180 m.
    const farRange = mortarTargetPoint(h.ctx, feet, makeSight(0, 2, -260, 260), out);
    expect(farRange).toBe(180);
    expect(out.z).toBeCloseTo(-180, 2);

    // Flight time checks.
    expect(mortarFlightTime(100)).toBeCloseTo(2.5, 3);
    expect(mortarFlightTime(0)).toBeGreaterThanOrEqual(1.2);
    expect(mortarFlightTime(25)).toBeGreaterThanOrEqual(1.2);
    expect(mortarFlightTime(500)).toBeLessThanOrEqual(4.0);
  });
});

describe('Mortar Rack munitions (HE, WP, Cluster) and co-op', () => {
  it('HE round arcs for 2.5 s at 100 m, whistles on descent, and deals 260 damage in 6 m blast', () => {
    const h = makeHarness({ groundY: 0 });
    const mortar = new MortarShoulder(h.ctx);
    const sight = makeSight(0, 0, -100, 100);

    // Hold to aim landing circle, then release to fire HE.
    mortar.update(DT, makeShoulderUpdate(h, sight, { held: true, pressed: true }));
    mortar.update(DT, makeShoulderUpdate(h, sight, { held: false }));

    expect(activeMortarShellCount(h.ctx)).toBe(1);
    expect(h.news.length).toBe(1);
    expect(h.news[0]!.kind).toBe('mortar');
    expect(h.news[0]!.values[0]).toBe(0); // HE index
    expect(h.news[0]!.values[3]).toBeCloseTo(-100, 1);
    expect(h.news[0]!.values[4]).toBeCloseTo(2.5, 2);

    // Step 2.0 s: in flight, descending whistle triggered, not landed yet.
    for (let i = 0; i < Math.round(2.0 / DT); i++) {
      h.now.t += DT;
      mortar.update(DT, makeShoulderUpdate(h, sight));
    }
    expect(h.sounds).toContain('missile_incoming');
    expect(h.blasts.length).toBe(0);

    // Step remaining 0.6 s: impacts right around 2.5 s.
    for (let i = 0; i < Math.round(0.6 / DT); i++) {
      h.now.t += DT;
      mortar.update(DT, makeShoulderUpdate(h, sight));
    }
    expect(activeMortarShellCount(h.ctx)).toBe(0);
    expect(h.blasts.length).toBe(1);
    expect(h.blasts[0]!.spec.kind).toBe('shell');
    expect(h.blasts[0]!.spec.radius).toBe(6);
    expect(h.blasts[0]!.spec.damage).toBe(260);
    expect(h.blasts[0]!.at.z).toBeCloseTo(-100, 1);
  });

  it('WP round creates a 9 m burning patch lasting 14 s with white smoke plume and ignites enemies inside', () => {
    const inside = makeEnemy(1, 3, 0, -96);   // ~5 m from (0, 0, -100) -> inside 9 m patch
    const outside = makeEnemy(2, 15, 0, -100); // 15 m away -> outside 9 m patch
    const h = makeHarness({ groundY: 0, enemies: [inside, outside] });
    const mortar = new MortarShoulder(h.ctx);
    const sight = makeSight(0, 0, -100, 100);

    // Cycle to WP (index 1), hold, release.
    mortar.update(DT, makeShoulderUpdate(h, sight, { cyclePressed: true }));
    expect(mortar.clock.round).toBe('WP');
    mortar.update(DT, makeShoulderUpdate(h, sight, { held: true, pressed: true }));
    mortar.update(DT, makeShoulderUpdate(h, sight, { held: false }));

    // Step 2.7 s for shell landing.
    for (let i = 0; i < Math.round(2.7 / DT); i++) {
      h.now.t += DT;
      mortar.update(DT, makeShoulderUpdate(h, sight));
    }
    expect(activeWpPatchCount(h.ctx)).toBe(1);

    // Step 1.0 s of burning: napalm FX called with radius 9, white smoke emitted, inside enemy burned, outside spared.
    for (let i = 0; i < Math.round(1.0 / DT); i++) {
      h.now.t += DT;
      mortar.update(DT, makeShoulderUpdate(h, sight));
    }
    expect(h.napalmCalls.length).toBeGreaterThan(10);
    expect(h.napalmCalls[0]!.radius).toBe(9);
    expect(h.smokes.some(s => s.color === 0xf4f6f8)).toBe(true);
    expect(h.burned.some(b => b.uid === 1)).toBe(true);
    expect(h.burned.some(b => b.uid === 2)).toBe(false);

    // Step another 13.5 s (total > 14 s): WP patch expires cleanly.
    for (let i = 0; i < Math.round(13.5 / DT); i++) {
      h.now.t += DT;
      mortar.update(DT, makeShoulderUpdate(h, sight));
    }
    expect(activeWpPatchCount(h.ctx)).toBe(0);
  });

  it('Cluster round airbursts 18 m above landing circle and drops 32 circular bomblets rippling over 0.7 s', () => {
    const h = makeHarness({ groundY: 0 });
    const mortar = new MortarShoulder(h.ctx);
    const sight = makeSight(0, 0, -100, 100);

    // Cycle twice to CLUSTER (index 2).
    mortar.update(DT, makeShoulderUpdate(h, sight, { cyclePressed: true }));
    mortar.update(DT, makeShoulderUpdate(h, sight, { cyclePressed: true }));
    expect(mortar.clock.round).toBe('CLUSTER');

    mortar.update(DT, makeShoulderUpdate(h, sight, { held: true, pressed: true }));
    mortar.update(DT, makeShoulderUpdate(h, sight, { held: false }));

    // Step 2.6 s: shell bursts 18 m overhead and releases 32 bomblets.
    for (let i = 0; i < Math.round(2.6 / DT); i++) {
      h.now.t += DT;
      mortar.update(DT, makeShoulderUpdate(h, sight));
    }
    expect(activeMortarShellCount(h.ctx)).toBe(0);
    expect(activeBombletCount(h.ctx)).toBe(32);

    // Step 1.5 s: all 32 bomblets ripple and detonate over 0.7 s across the 18 m circle.
    for (let i = 0; i < Math.round(1.5 / DT); i++) {
      h.now.t += DT;
      mortar.update(DT, makeShoulderUpdate(h, sight));
    }
    expect(activeBombletCount(h.ctx)).toBe(0);
    expect(h.blasts.length).toBe(32);
    expect(h.blasts.every(b => b.spec.radius === 2.4 && b.spec.damage === 70 && b.spec.source === 'frame_mortar_cluster')).toBe(true);

    const times = h.blasts.map(b => b.time);
    const span = Math.max(...times) - Math.min(...times);
    expect(span).toBeGreaterThanOrEqual(0.65);
    expect(span).toBeLessThanOrEqual(0.76);

    // Circular footprint spans ~18 m around (0, 0, -100).
    const maxRadius = Math.max(...h.blasts.map(b => Math.hypot(b.at.x, b.at.z + 100)));
    expect(maxRadius).toBeGreaterThan(5);
    expect(maxRadius).toBeLessThan(12);
  });

  it('plays cosmetic mortar arcs, WP clouds (no burn afflict), and Cluster bomblets on co-op remoteNews', () => {
    const enemy = makeEnemy(7, 0, 0, -60);
    const h = makeHarness({ groundY: 0, enemies: [enemy], withPreStep: true });

    // Remote WP round (roundIdx = 1) at (0, 0, -60), flight 1.5 s.
    MORTAR_PLUGIN.remoteNews?.(h.ctx, 'mortar', [1, 0, 0, -60, 1.5]);
    expect(activeMortarShellCount(h.ctx)).toBe(1);
    expect(h.preStep.size).toBe(1);

    // Advance via preStep hooks (as real co-op Physics does).
    for (let i = 0; i < Math.round(2.5 / DT); i++) {
      h.now.t += DT;
      for (const hook of [...h.preStep]) hook(DT);
    }
    expect(activeWpPatchCount(h.ctx)).toBe(1);
    expect(h.blasts.length).toBe(1);
    expect(h.blasts[0]!.spec.cosmetic).toBe(true);
    // Cosmetic WP must never afflict local enemies.
    expect(h.burned.length).toBe(0);

    // Remote Cluster round (roundIdx = 2).
    MORTAR_PLUGIN.remoteNews?.(h.ctx, 'mortar', [2, 10, 0, -80, 1.2]);
    for (let i = 0; i < Math.round(3.0 / DT); i++) {
      h.now.t += DT;
      for (const hook of [...h.preStep]) hook(DT);
    }
    const clusterBlasts = h.blasts.filter(b => b.spec.source === 'frame_mortar_cluster');
    expect(clusterBlasts.length).toBe(32);
    expect(clusterBlasts.every(b => b.spec.cosmetic === true)).toBe(true);

    // Finish WP cloud lifetime so preStep detaches cleanly.
    for (let i = 0; i < Math.round(14 / DT); i++) {
      h.now.t += DT;
      for (const hook of [...h.preStep]) hook(DT);
    }
    expect(h.preStep.size).toBe(0);

    // Sanity check direct manual world stepping helper.
    updateMortarWorld(DT, h.ctx);
    updateBomblets(DT, h.ctx);
  });
});
