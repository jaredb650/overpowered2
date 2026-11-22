/** Tests for the FPV Drone Hive shoulder plug-in and its 3D model. */
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { Ctx, LoopHandle } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec } from '../../core/gameplay';
import type { MechKind } from '../../progression/callins/link';
import { ModelBuilder } from '../../progression/modelkit';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { Projectile } from '../../weapons/Projectiles';
import { buildFpvHive, SHOULDER_FPV } from '../models/shoulder-fpv';
import {
  activeFpvDroneCount,
  damageFpvDrone,
  damageFpvDronesInRadius,
  FPV_BLAST_DAMAGE,
  FPV_BLAST_RADIUS,
  FPV_DRONE_HP,
  FPV_LAUNCH_STAGGER,
  FPV_MAX_GLOBAL,
  FPV_MAX_PER_MECH,
  FPV_MAX_STOCK,
  FPV_PLUGIN,
  FPV_REBUILD_SECONDS,
  FPV_SEARCH_RADIUS,
  FPV_SPEED,
  fpvDronePool,
  FpvHiveShoulder,
  resetFpvGlobalPool,
  stepRemoteFpvDrones,
} from './fpv';
import type { ShoulderUpdateContext } from './types';

const DT = 1 / 60;

function makeEnemy(uid: number, x: number, y: number, z: number): EnemyInstance {
  return {
    uid,
    id: 'trooper',
    char: null as unknown as EnemyInstance['char'],
    position: new THREE.Vector3(x, y - 1, z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    health: 100,
    maxHealth: 100,
    armor: 0,
    alive: true,
    score: 100,
    center: new THREE.Vector3(x, y, z),
    isBoss: false,
    frozen: 0,
    burning: 0,
    machine: false,
  };
}

function makeHarness(enemiesList: EnemyInstance[] = []) {
  const blasts: { at: THREE.Vector3; spec: ExplosionSpec }[] = [];
  const sounds: string[] = [];
  const loopsStopped: number[] = [];
  const sparks: THREE.Vector3[] = [];
  const news: { kind: MechKind; values: number[] }[] = [];
  const enemyProjectiles: Projectile[] = [];
  let wallHit: { point: THREE.Vector3; normal: THREE.Vector3; distance: number } | null = null;
  let loopCount = 0;

  const ctx = {
    combat: {
      explode: (at: THREE.Vector3, spec: ExplosionSpec) => {
        blasts.push({ at: at.clone(), spec: { ...spec } });
      },
      projectiles: { active: enemyProjectiles },
    },
    enemies: {
      alive: enemiesList,
      query: (origin: THREE.Vector3, radius: number, out: EnemyInstance[]) => {
        out.length = 0;
        const r2 = radius * radius;
        for (const e of enemiesList) {
          if (e.alive && e.center.distanceToSquared(origin) <= r2) out.push(e);
        }
        return out.length;
      },
      raycast: () => null,
    },
    physics: {
      raycast: () => wallHit,
      preStep: new Set<(dt: number) => void>(),
    },
    fx: {
      sparks: (pos: THREE.Vector3) => sparks.push(pos.clone()),
      smoke: () => undefined,
    },
    audio: {
      play: (id: string) => sounds.push(id),
      startLoop: (): LoopHandle => {
        const id = ++loopCount;
        return {
          alive: true,
          setVolume: () => undefined,
          setPitch: () => undefined,
          setPosition: () => undefined,
          stop: () => { loopsStopped.push(id); },
        };
      },
    },
    render: {
      scene: new THREE.Scene(),
    },
    events: {
      on: () => () => undefined,
    },
  } as unknown as Ctx;

  const makeUpdate = (opts?: {
    pressed?: boolean;
    held?: boolean;
    online?: boolean;
    aim?: THREE.Vector3;
    point?: THREE.Vector3;
    mount?: THREE.Vector3;
  }): ShoulderUpdateContext => ({
    ctx,
    rounds: null as unknown as ShoulderUpdateContext['rounds'],
    slot: 0,
    keyLabel: 'G',
    cycleKeyLabel: '3',
    sight: {
      view: { position: new THREE.Vector3(0, 5, 0) } as ShoulderUpdateContext['sight']['view'],
      aim: opts?.aim ?? new THREE.Vector3(0, 0, -1),
      point: opts?.point ?? new THREE.Vector3(0, 1, -40),
      range: 40,
    },
    mountPos: out => out.copy(opts?.mount ?? new THREE.Vector3(1.5, 6.0, 0)),
    feet: new THREE.Vector3(0, 0, 0),
    torsoYaw: 0,
    held: opts?.held ?? false,
    pressed: opts?.pressed ?? false,
    cyclePressed: false,
    online: opts?.online ?? true,
    gatherTargets: () => [],
    onMissile: null,
    onNews: (kind, values) => news.push({ kind, values }),
    popFreeFlares: () => undefined,
  });

  return {
    ctx,
    blasts,
    sounds,
    loopsStopped,
    sparks,
    news,
    enemyProjectiles,
    setWall: (hit: typeof wallHit) => { wallHit = hit; },
    makeUpdate,
  };
}

afterEach(() => {
  resetFpvGlobalPool();
});

describe('FPV Drone Hive shoulder plug-in', () => {
  it('holds 4 drones, launches all 4 staggered 0.15 s apart, and caps 4 active per mech', () => {
    const enemies = [
      makeEnemy(1, -12, 1, -45),
      makeEnemy(2, -4, 1, -45),
      makeEnemy(3, 4, 1, -45),
      makeEnemy(4, 12, 1, -45),
    ];
    const h = makeHarness(enemies);
    const hive = FPV_PLUGIN.create(h.ctx) as FpvHiveShoulder;

    expect(hive.stock).toBe(FPV_MAX_STOCK);
    expect(hive.activeCount).toBe(0);

    // Press launches drone #1 immediately and queues 3 more.
    hive.update(DT, h.makeUpdate({ pressed: true }));
    expect(hive.activeCount).toBe(1);
    expect(hive.stock).toBe(3);

    // Before 0.15 s elapses, still only 1 launched.
    for (let i = 0; i < 7; i++) hive.update(DT, h.makeUpdate());
    expect(hive.activeCount).toBe(1);

    // Step across the full 0.45 s stagger window; all 4 launch.
    for (let t = 0; t < FPV_LAUNCH_STAGGER * 3 + 0.05; t += DT) {
      hive.update(DT, h.makeUpdate());
    }
    expect(hive.activeCount).toBe(FPV_MAX_PER_MECH);
    expect(hive.stock).toBe(0);
    expect(h.news.filter(n => n.kind === 'fpv')).toHaveLength(4);
    expect(h.news[0]!.values).toHaveLength(6);
  });

  it('rebuilds 1 drone every 4.0 s, including while parked via idleUpdate', () => {
    const h = makeHarness([]);
    const hive = FPV_PLUGIN.create(h.ctx) as FpvHiveShoulder;

    // Launch all 4 and retire them so stock is 0.
    hive.update(DT, h.makeUpdate({ pressed: true }));
    for (let t = 0; t < 0.6; t += DT) hive.update(DT, h.makeUpdate());
    expect(hive.stock).toBe(0);

    // Clear active airborne drones, then rebuild via idleUpdate.
    for (const d of fpvDronePool()) if (d.active) damageFpvDrone(d, FPV_DRONE_HP);

    const row: GunnerWeapon = { name: '', ammo: 0, max: 0, reload: -1 };
    hive.fillRow(row, 'G', '3', true);
    expect(row.max).toBe(4);
    expect(row.ammo).toBe(0);
    expect(row.reload).toBeGreaterThanOrEqual(0);

    // After 4.0 s parked, 1 drone rebuilt.
    for (let i = 0; i < 240; i++) hive.idleUpdate(DT);
    expect(hive.stock).toBe(1);

    // After another 12.0 s parked, full stock of 4 (never exceeds 4).
    for (let i = 0; i < 720; i++) hive.idleUpdate(DT);
    expect(hive.stock).toBe(4);
    hive.idleUpdate(5);
    expect(hive.stock).toBe(4);
    hive.fillRow(row, 'G', '3', true);
    expect(row.ammo).toBe(4);
    expect(row.reload).toBe(-1);
  });

  it('assigns distinct alive enemies within 60 m (no stacking unless fewer enemies exist) and ignores enemies beyond 60 m', () => {
    const enemies = [
      makeEnemy(10, -10, 1, -30),
      makeEnemy(20, 0, 1, -35),
      makeEnemy(30, 10, 1, -30),
      makeEnemy(40, 20, 1, -35),
      makeEnemy(50, 0, 1, -90), // out of 60 m search radius
    ];
    const h = makeHarness(enemies);
    const hive = FPV_PLUGIN.create(h.ctx) as FpvHiveShoulder;

    hive.update(DT, h.makeUpdate({ pressed: true }));
    for (let t = 0; t < 0.5; t += DT) hive.update(DT, h.makeUpdate());

    const active = fpvDronePool().filter(d => d.active);
    expect(active).toHaveLength(4);
    const uids = active.map(d => d.target?.uid);
    // All 4 distinct, none targeting uid 50 (> 60 m).
    expect(new Set(uids).size).toBe(4);
    expect(uids).not.toContain(50);

    // With only 2 enemies in range, 4 drones split 2 and 2 instead of stacking all 4 on one.
    hive.reset();
    const pair = [makeEnemy(1, -8, 1, -40), makeEnemy(2, 8, 1, -40)];
    const h2 = makeHarness(pair);
    const hive2 = FPV_PLUGIN.create(h2.ctx) as FpvHiveShoulder;
    hive2.update(DT, h2.makeUpdate({ pressed: true }));
    for (let t = 0; t < 0.5; t += DT) hive2.update(DT, h2.makeUpdate());
    const counts = new Map<number, number>();
    for (const d of fpvDronePool()) {
      if (d.active && d.target) counts.set(d.target.uid, (counts.get(d.target.uid) ?? 0) + 1);
    }
    expect(counts.get(1)).toBe(2);
    expect(counts.get(2)).toBe(2);

    // Enemy strictly beyond 60 m is not locked.
    hive2.reset();
    const farOnly = [makeEnemy(99, 0, 1, -(FPV_SEARCH_RADIUS + 15))];
    const h3 = makeHarness(farOnly);
    const hive3 = FPV_PLUGIN.create(h3.ctx) as FpvHiveShoulder;
    hive3.update(DT, h3.makeUpdate({ pressed: true }));
    const first = fpvDronePool().find(d => d.active)!;
    expect(first.target).toBeNull();
  });

  it('prefers alive enemies nearest the crosshair ray / sight point when holding the shoulder key', () => {
    // Enemy 1 is much closer to the mech (12 m away off to the right),
    // Enemy 2 is 40 m ahead dead-center on the crosshair.
    const nearOffAxis = makeEnemy(1, 12, 1, -4);
    const onCrosshair = makeEnemy(2, 0, 1, -40);
    const h = makeHarness([nearOffAxis, onCrosshair]);
    const hive = FPV_PLUGIN.create(h.ctx) as FpvHiveShoulder;

    hive.update(DT, h.makeUpdate({
      pressed: true,
      held: true,
      aim: new THREE.Vector3(0, -0.1, -1).normalize(),
      point: new THREE.Vector3(0, 1, -40),
    }));

    const first = fpvDronePool().find(d => d.active)!;
    expect(first.target?.uid).toBe(2);
  });

  it('flies at 28 m/s and detonates on target contact for 4 m radius and 200 damage (kind grenade, source frame_fpv)', () => {
    const target = makeEnemy(7, 0, 1, -30);
    const h = makeHarness([target]);
    const hive = FPV_PLUGIN.create(h.ctx) as FpvHiveShoulder;

    hive.update(DT, h.makeUpdate({ pressed: true }));
    const drone = fpvDronePool().find(d => d.active)!;
    expect(drone.vel.length()).toBeCloseTo(FPV_SPEED, 3);

    // Step until contact (~1.2 s at 28 m/s over ~30 m).
    for (let t = 0; t < 2.2 && h.blasts.length === 0; t += DT) {
      hive.update(DT, h.makeUpdate());
    }
    expect(h.blasts.length).toBeGreaterThanOrEqual(1);
    const blast = h.blasts[0]!;
    expect(blast.spec.radius).toBe(FPV_BLAST_RADIUS);
    expect(blast.spec.damage).toBe(FPV_BLAST_DAMAGE);
    expect(blast.spec.kind).toBe('grenade');
    expect(blast.spec.source).toBe('frame_fpv');
    expect(blast.at.distanceTo(target.center)).toBeLessThan(2.0);
  });

  it('is shootable with 20 HP and pops in sparks without warhead blast when shot down', () => {
    const target = makeEnemy(1, 0, 1, -50);
    const h = makeHarness([target]);
    const hive = FPV_PLUGIN.create(h.ctx) as FpvHiveShoulder;

    hive.update(DT, h.makeUpdate({ pressed: true }));
    const drone = fpvDronePool().find(d => d.active)!;
    expect(drone.hp).toBe(FPV_DRONE_HP);

    // 10 damage leaves it alive at 10 HP.
    expect(damageFpvDrone(drone, 10)).toBe(false);
    expect(drone.active).toBe(true);
    expect(drone.hp).toBe(10);

    // Another 10 damage destroys it mid-air without detonating the 200-dmg warhead.
    expect(damageFpvDrone(drone, 10)).toBe(true);
    expect(drone.active).toBe(false);
    expect(h.blasts).toHaveLength(0);
    expect(h.sparks.length).toBeGreaterThan(0);
    expect(h.sounds).toContain('drone_crash');
    expect(h.loopsStopped.length).toBeGreaterThan(0);

    // Also verify nearby blast / enemy projectile shootdown path.
    hive.reset();
    hive.update(DT, h.makeUpdate({ pressed: true }));
    const d2 = fpvDronePool().find(d => d.active)!;
    expect(damageFpvDronesInRadius(d2.pos.clone(), 3, 25)).toBe(1);
    expect(d2.active).toBe(false);
    expect(h.blasts).toHaveLength(0);
  });

  it('enforces the global 16-drone cap across co-op mechs and supports remoteNews cosmetic drones', () => {
    const enemies = Array.from({ length: 20 }, (_, i) => makeEnemy(i + 1, (i - 10) * 2, 1, -45));
    const hives: { hive: FpvHiveShoulder; h: ReturnType<typeof makeHarness> }[] = [];

    // 4 mechs launching 4 drones each fill the 16-drone global cap; a 5th mech is capped at 0.
    for (let m = 0; m < 4; m++) {
      const h = makeHarness(enemies);
      const hive = FPV_PLUGIN.create(h.ctx) as FpvHiveShoulder;
      hives.push({ hive, h });
      hive.update(DT, h.makeUpdate({ pressed: true }));
    }
    for (let t = 0; t < 0.6; t += DT) {
      for (const entry of hives) entry.hive.update(DT, entry.h.makeUpdate());
    }
    expect(activeFpvDroneCount()).toBe(FPV_MAX_GLOBAL);

    const h5 = makeHarness(enemies);
    const hive5 = FPV_PLUGIN.create(h5.ctx) as FpvHiveShoulder;
    hive5.update(DT, h5.makeUpdate({ pressed: true }));
    for (let t = 0; t < 0.5; t += DT) hive5.update(DT, h5.makeUpdate());
    expect(activeFpvDroneCount()).toBe(FPV_MAX_GLOBAL);
    expect(hive5.activeCount).toBe(0);

    // Silence stops rotor loops cleanly.
    hives[0]!.hive.silence();
    expect(hives[0]!.h.loopsStopped.length).toBeGreaterThanOrEqual(4);

    // Remote cosmetic drone flies from launch to target and plays cosmetic explosion.
    resetFpvGlobalPool();
    const rh = makeHarness([]);
    FPV_PLUGIN.remoteNews?.(rh.ctx, 'fpv', [0, 6, 0, 0, 1, -20]);
    expect(activeFpvDroneCount()).toBe(1);
    for (let t = 0; t < 2.0 && activeFpvDroneCount() > 0; t += DT) {
      stepRemoteFpvDrones(DT);
    }
    expect(activeFpvDroneCount()).toBe(0);
    expect(rh.blasts).toHaveLength(1);
    expect(rh.blasts[0]!.spec.cosmetic).toBe(true);
  });

  it('builds a valid 3D honeycomb hive model with solid and glow geometry', () => {
    const b = new ModelBuilder();
    SHOULDER_FPV(b);
    expect(SHOULDER_FPV).toBe(buildFpvHive);
    expect(b.solidGeometry()).not.toBeNull();
    expect(b.glowGeometry()).not.toBeNull();
  });
});
