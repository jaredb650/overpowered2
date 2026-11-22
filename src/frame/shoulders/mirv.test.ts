/** MIRV Launcher shoulder plug-in & model tests. */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx, RayHit } from '../../core/contracts';
import type { EnemyInstance, MissileTarget, ProjectileSpec } from '../../core/gameplay';
import type { Ac130Rounds } from '../../progression/callins/ac130Rounds';
import type { MechKind } from '../../progression/callins/link';
import { ModelBuilder } from '../../progression/modelkit';
import type { GunnerWeapon } from '../../vehicles/hud';
import { buildMirv, SHOULDER_MIRV } from '../models/shoulder-mirv';
import { assignMirvTargets, MIRV, MIRV_PLUGIN, MirvShoulder, solveMirvMarker } from './mirv';
import type { ShoulderUpdateContext } from './types';

const DT = 1 / 60;

function makeEnemy(uid: number, x: number, z: number, alive = true, y = 0): EnemyInstance {
  return {
    uid,
    alive,
    position: new THREE.Vector3(x, y, z),
    center: new THREE.Vector3(x, y + 1.2, z),
  } as unknown as EnemyInstance;
}

interface MockMirvEnv {
  ctx: Ctx;
  spawned: ProjectileSpec[];
  sounds: string[];
  rings: number;
  news: { kind: MechKind; values: number[] }[];
  setRaycast: (fn: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => RayHit | null) => void;
  enemies: EnemyInstance[];
}

function makeEnv(enemies: EnemyInstance[] = []): MockMirvEnv {
  const spawned: ProjectileSpec[] = [];
  const sounds: string[] = [];
  const news: { kind: MechKind; values: number[] }[] = [];
  let rings = 0;
  let rayFn: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => RayHit | null = () => null;

  const ctx = {
    audio: {
      play: (id: string) => sounds.push(id),
    },
    camera: {
      addTrauma: vi.fn(),
    },
    fx: {
      smoke: vi.fn(),
      sparks: vi.fn(),
      ring: () => { rings++; },
    },
    render: {
      lights: { flash: vi.fn() },
    },
    physics: {
      raycast: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => rayFn(origin, dir, maxDist),
    },
    enemies: {
      alive: enemies,
      query: (at: THREE.Vector3, radius: number, out: EnemyInstance[]) => {
        out.length = 0;
        for (const e of enemies) {
          if (e.alive && e.position.distanceTo(at) <= radius) out.push(e);
        }
        return out.length;
      },
      vehicles: null,
    },
    combat: {
      spawnProjectile: (spec: ProjectileSpec) => {
        spawned.push({
          ...spec,
          origin: spec.origin.clone(),
          velocity: spec.velocity.clone(),
          explosion: spec.explosion ? { ...spec.explosion } : undefined,
        });
      },
      explode: vi.fn(),
    },
  } as unknown as Ctx;

  return {
    ctx,
    spawned,
    sounds,
    get rings() { return rings; },
    news,
    setRaycast: fn => { rayFn = fn; },
    enemies,
  };
}

function makeUpdateCtx(
  env: MockMirvEnv,
  overrides: Partial<ShoulderUpdateContext> = {},
): ShoulderUpdateContext {
  return {
    ctx: env.ctx,
    rounds: {} as Ac130Rounds,
    slot: 0,
    keyLabel: 'G',
    cycleKeyLabel: '3',
    sight: {
      view: { position: new THREE.Vector3(0, 6, 0) } as ShoulderUpdateContext['sight']['view'],
      aim: new THREE.Vector3(0, -0.1, -1).normalize(),
      point: new THREE.Vector3(0, 0, -60),
      range: 60,
    },
    mountPos: out => out.set(1.5, 6.2, 0.2),
    feet: new THREE.Vector3(0, 0, 0),
    torsoYaw: 0,
    held: false,
    pressed: false,
    cyclePressed: false,
    online: true,
    gatherTargets: () => [],
    onMissile: null,
    onNews: (kind, values) => env.news.push({ kind, values: [...values] }),
    popFreeFlares: () => undefined,
    ...overrides,
  };
}

describe('MIRV Launcher', () => {
  it('projects a ground marker up to 200 m, rejects beyond 200 m, and drops wall hits to the floor', () => {
    const out = new THREE.Vector3();
    const origin = new THREE.Vector3(0, 6, 0);
    const aim = new THREE.Vector3(0, -0.05, -1).normalize();

    // Ground hit at 180 m (<= 200 m): valid.
    const physics180 = {
      raycast: (_o: THREE.Vector3, _d: THREE.Vector3, maxDist: number): RayHit | null => {
        expect(maxDist).toBe(200);
        return { point: new THREE.Vector3(0, 0, -180), normal: new THREE.Vector3(0, 1, 0), distance: 180, surface: 'concrete', collider: null };
      },
    } as unknown as Ctx['physics'];
    expect(solveMirvMarker(physics180, origin, aim, out)).toBe(true);
    expect(out.z).toBe(-180);

    // Beyond 200 m / sky (raycast returns null within 200 m): invalid.
    const physicsMiss = { raycast: () => null } as unknown as Ctx['physics'];
    expect(solveMirvMarker(physicsMiss, origin, aim, out)).toBe(false);

    // Steep vertical wall hit drops down to the floor beneath it.
    let call = 0;
    const physicsWall = {
      raycast: (_o: THREE.Vector3, dir: THREE.Vector3): RayHit | null => {
        call++;
        if (call === 1) {
          return { point: new THREE.Vector3(0, 8, -90), normal: new THREE.Vector3(0, 0, 1), distance: 90, surface: 'concrete', collider: null };
        }
        expect(dir.y).toBe(-1);
        return { point: new THREE.Vector3(0, 0, -89.4), normal: new THREE.Vector3(0, 1, 0), distance: 8, surface: 'concrete', collider: null };
      },
    } as unknown as Ctx['physics'];
    expect(solveMirvMarker(physicsWall, origin, aim, out)).toBe(true);
    expect(out.y).toBe(0);
    expect(out.z).toBeCloseTo(-89.4, 2);
  });

  it('assigns 8 sub-missiles round-robin within 22 m (max 2 per enemy) and fills remaining slots in a clean ring', () => {
    const marker = new THREE.Vector3(0, 0, -60);

    // 0 enemies -> 8 evenly spaced ring points at radius 8 m around marker.
    const ringOnly = assignMirvTargets([], marker);
    expect(ringOnly).toHaveLength(8);
    expect(ringOnly.every(a => a.enemy === null)).toBe(true);
    for (const a of ringOnly) {
      expect(Math.hypot(a.point.x - marker.x, a.point.z - marker.z)).toBeCloseTo(MIRV.ringRadius, 3);
    }

    // 2 alive enemies inside 22 m + 1 dead inside + 1 alive outside (25 m) -> 2 each on the 2 alive + 4 ring points.
    const e1 = makeEnemy(1, 3, -60);
    const e2 = makeEnemy(2, -10, -60);
    const dead = makeEnemy(3, 1, -60, false);
    const far = makeEnemy(4, 25, -60, true);
    const partial = assignMirvTargets([far, dead, e2, e1], marker);
    expect(partial).toHaveLength(8);
    expect(partial.slice(0, 4).map(a => a.enemy)).toEqual([e1, e2, e1, e2]);
    expect(partial.slice(4).every(a => a.enemy === null)).toBe(true);

    // 5 alive enemies inside 22 m -> round-robin: first 3 get 2, remaining 2 get 1 (total 8, no ring spares).
    const five = [0, 1, 2, 3, 4].map(i => makeEnemy(i, i * 2, -60));
    const fiveAssign = assignMirvTargets(five, marker);
    expect(fiveAssign).toHaveLength(8);
    expect(fiveAssign.map(a => a.enemy)).toEqual([five[0], five[1], five[2], five[3], five[4], five[0], five[1], five[2]]);

    // 10 alive enemies inside 22 m -> 8 different nearest enemies (1 each).
    const ten = Array.from({ length: 10 }, (_, i) => makeEnemy(i, i * 1.8, -60));
    const tenAssign = assignMirvTargets(ten, marker);
    expect(tenAssign).toHaveLength(8);
    expect(new Set(tenAssign.map(a => a.enemy)).size).toBe(8);
  });

  it('climbs vertically to +70 m, dives steeply, splits at 25 m into 8 homing 5 m / 220 dmg sub-missiles, and reloads in 11 s', () => {
    const enemies = [makeEnemy(1, 2, -70), makeEnemy(2, -4, -72), makeEnemy(3, 5, -68)];
    const env = makeEnv(enemies);
    // Floor at y = 0 only when aiming downward toward the marker.
    env.setRaycast((origin, dir, maxDist) => {
      if (dir.y >= 0) return null;
      const t = (0 - origin.y) / dir.y;
      if (t < 0 || t > maxDist) return null;
      return {
        point: origin.clone().addScaledVector(dir, t),
        normal: new THREE.Vector3(0, 1, 0),
        distance: t,
        surface: 'concrete',
        collider: null,
      };
    });

    const mirv = MIRV_PLUGIN.create(env.ctx) as MirvShoulder;
    const aimToMarker = new THREE.Vector3(0, 0, -70).sub(new THREE.Vector3(0, 6, 0)).normalize();
    const row: GunnerWeapon = { name: '', ammo: 0, max: 1, reload: -1 };

    // Ready HUD state.
    mirv.fillRow(row, 'G', '3', true);
    expect(row.ammo).toBe(1);
    expect(row.name).toContain('MIRV');

    // Hold to mark.
    mirv.update(DT, makeUpdateCtx(env, {
      held: true,
      pressed: true,
      sight: { view: { position: new THREE.Vector3(0, 6, 0) } as ShoulderUpdateContext['sight']['view'], aim: aimToMarker, point: new THREE.Vector3(0, 0, -70), range: 70 },
    }));
    expect(mirv.aiming).toBe(true);
    expect(mirv.valid).toBe(true);
    expect(mirv.marker.z).toBeCloseTo(-70, 1);

    // Release to launch straight UP.
    mirv.update(DT, makeUpdateCtx(env, { held: false }));
    expect(mirv.aiming).toBe(false);
    expect(mirv.reloadLeft).toBeCloseTo(11, 2);
    expect(env.news[0]).toEqual({
      kind: 'mirv',
      values: [1.5, 6.2, 0.2, expect.closeTo(0, 1), expect.closeTo(0, 1), expect.closeTo(-70, 1)],
    });

    const bus = mirv.buses[0]!;
    expect(bus.live).toBe(true);
    expect(bus.phase).toBe('climb');
    expect(bus.vel.x).toBe(0);
    expect(bus.vel.z).toBe(0);
    expect(bus.vel.y).toBeGreaterThan(0);

    // Step through climb -> verify apex reaches >= 70 m above launch elevation and transitions to dive.
    let peakY = 0;
    let sawDive = false;
    let splitY = -1;
    let elapsed = 0;
    for (let i = 0; i < 600; i++) {
      elapsed += DT;
      mirv.update(DT, makeUpdateCtx(env, { held: false }));
      if (bus.live) {
        if (bus.pos.y > peakY) peakY = bus.pos.y;
        if (bus.phase === 'dive') sawDive = true;
      }
      if (env.spawned.length > 0 && splitY < 0) {
        splitY = env.spawned[0]!.origin.y;
        break;
      }
    }

    expect(peakY).toBeGreaterThanOrEqual(70);
    expect(sawDive).toBe(true);
    expect(bus.live).toBe(false);
    // Split occurred cleanly around 25 m above the y = 0 ground marker.
    expect(splitY).toBeGreaterThanOrEqual(23);
    expect(splitY).toBeLessThanOrEqual(26.5);

    // Exactly 8 homing sub-missiles spawned with 5 m blast, 220 dmg, kind 'rocket', source 'frame_mirv'.
    expect(env.spawned).toHaveLength(8);
    for (const s of env.spawned) {
      expect(s.kind).toBe('rocket');
      expect(s.source).toBe('frame_mirv');
      expect(s.damage).toBe(220);
      expect(s.turnRate).toBeGreaterThan(5);
      expect(s.target).not.toBeNull();
      expect(s.explosion?.radius).toBe(5);
      expect(s.explosion?.damage).toBe(220);
      expect(s.explosion?.kind).toBe('rocket');
    }
    // 3 enemies -> 2 each (6 enemy-assigned) + 2 ring spares.
    const enemyTargets = env.spawned.filter(s => enemies.includes(s.target as EnemyInstance));
    expect(enemyTargets).toHaveLength(6);

    // Reload blocks firing before 11 s and completes at 11 s.
    mirv.fillRow(row, 'G', '3', true);
    expect(row.ammo).toBe(0);
    expect(row.reload).toBeGreaterThan(0);

    for (; elapsed < 11.2; elapsed += DT) {
      mirv.idleUpdate(DT);
    }
    expect(mirv.reloadLeft).toBe(0);
    mirv.fillRow(row, 'G', '3', true);
    expect(row.ammo).toBe(1);
    expect(row.reload).toBe(-1);
  });

  it('plays cosmetic climb/dive and 8-split sequence in co-op remoteNews', () => {
    const env = makeEnv([makeEnemy(1, 0, -50)]);

    // Launch news (6 values): spawns cosmetic climbing/diving bus missile.
    MIRV_PLUGIN.remoteNews?.(env.ctx, 'mirv', [1.5, 6.2, 0.2, 0, 0, -50]);
    expect(env.spawned).toHaveLength(1);
    expect(env.spawned[0]!.ghost).toBe(true);
    expect(env.spawned[0]!.velocity.y).toBeGreaterThan(0);
    expect((env.spawned[0]!.target as MissileTarget).center.y).toBeCloseTo(25, 1);

    // Split news (phase = 1): spawns 8 cosmetic sub-missiles with cosmetic 5 m / 220 dmg blasts.
    MIRV_PLUGIN.remoteNews?.(env.ctx, 'mirv', [1, 0, 25, -50, 0, 0, -50]);
    expect(env.spawned).toHaveLength(9);
    const subs = env.spawned.slice(1);
    expect(subs).toHaveLength(8);
    for (const s of subs) {
      expect(s.ghost).toBe(true);
      expect(s.source).toBe('frame_mirv');
      expect(s.explosion?.cosmetic).toBe(true);
      expect(s.explosion?.radius).toBe(5);
      expect(s.explosion?.damage).toBe(220);
    }
  });

  it('builds the vertical-launch MIRV 3D shoulder model with solid and glow geometry', () => {
    expect(SHOULDER_MIRV).toBe(buildMirv);
    const b = new ModelBuilder();
    buildMirv(b);
    const solid = b.solidGeometry();
    const glow = b.glowGeometry();
    expect(solid).not.toBeNull();
    expect(glow).not.toBeNull();
    expect(solid!.getAttribute('position').count).toBeGreaterThan(200);
    expect(glow!.getAttribute('position').count).toBeGreaterThan(50);
  });
});
