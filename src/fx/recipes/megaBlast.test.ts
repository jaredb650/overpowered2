import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx, DamageInfo, PlayOptions } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec } from '../../core/gameplay';
import {
  activeMegaBlastCount,
  MEGA_BLAST,
  megaBlast,
  resetMegaBlasts,
  stepMegaBlasts,
  visibleMegaBlastMeshes,
} from './megaBlast';

interface MockEnemy {
  uid: number;
  alive: boolean;
  isBoss: boolean;
  center: THREE.Vector3;
  velocity: THREE.Vector3;
}

interface RecordedDamage {
  time: number;
  uid: number;
  amount: number;
  force: number;
  vaporize: boolean;
  source: string;
}

interface RecordedAudio {
  time: number;
  id: string;
  delay: number;
  hasPosition: boolean;
  volume: number;
}

interface RecordedBreakable {
  time: number;
  radius: number;
  damage: number;
  source: string;
}

interface RecordedShake {
  time: number;
  trauma: number;
}

function makeEnemy(uid: number, x: number, isBoss = false): MockEnemy {
  return {
    uid,
    alive: true,
    isBoss,
    center: new THREE.Vector3(x, 1, 0),
    velocity: new THREE.Vector3(),
  };
}

function createHarness(opts?: { playerX?: number; parked?: boolean; enemies?: MockEnemy[] }) {
  const scene = new THREE.Scene();
  const preStep = new Set<(dt: number) => void>();
  const enemies = opts?.enemies ?? [];
  const stateHandlers: Array<(e: { to: string }) => void> = [];

  let clock = 0;

  const damages: RecordedDamage[] = [];
  const explodes: Array<{ time: number; at: THREE.Vector3; spec: ExplosionSpec }> = [];
  const audioPlays: RecordedAudio[] = [];
  const breakables: RecordedBreakable[] = [];
  const shakes: RecordedShake[] = [];
  const lightFlashes: Array<{ time: number; at: THREE.Vector3; color: number; intensity: number; radius: number }> = [];
  const postFlashes: unknown[] = [];
  const decals: string[] = [];
  const dustHits: THREE.Vector3[] = [];
  const smokeHits: THREE.Vector3[] = [];
  const chipHits: THREE.Vector3[] = [];
  const playerPushes: THREE.Vector3[] = [];

  const dynamicBodies: Array<{
    handle: number;
    pos: { x: number; y: number; z: number };
    mass: () => number;
    isDynamic: () => boolean;
    translation: () => { x: number; y: number; z: number };
    applyImpulse: ReturnType<typeof vi.fn>;
  }> = [];

  const playerPos = new THREE.Vector3(opts?.playerX ?? 100, 1.7, 0);

  const ctx = {
    time: {
      get elapsed() {
        return clock;
      },
    },
    events: {
      on(event: string, fn: (e: { to: string }) => void) {
        if (event === 'game:state') stateHandlers.push(fn);
        return () => {};
      },
    },
    render: {
      scene,
      camera: { position: playerPos.clone() },
      lights: {
        flash: vi.fn((at: THREE.Vector3, color: number, intensity: number, radius: number) => {
          lightFlashes.push({ time: clock, at: at.clone(), color, intensity, radius });
        }),
      },
      decals: {
        add: vi.fn((kind: string) => {
          decals.push(kind);
        }),
      },
      post: {
        flash: vi.fn((...args: unknown[]) => {
          postFlashes.push(args);
        }),
        chromatic: vi.fn(),
        radialBlur: vi.fn(),
      },
    },
    player: {
      alive: true,
      parked: opts?.parked ?? false,
      position: playerPos,
      eye: playerPos,
      push: vi.fn((v: THREE.Vector3) => {
        playerPushes.push(v.clone());
      }),
      launch: vi.fn((v: THREE.Vector3) => {
        playerPushes.push(v.clone());
      }),
    },
    camera: {
      addTrauma: vi.fn((trauma: number) => {
        shakes.push({ time: clock, trauma });
      }),
      kick: vi.fn(),
      fovPunch: vi.fn(),
    },
    combat: {
      explode: vi.fn((at: THREE.Vector3, spec: ExplosionSpec) => {
        explodes.push({ time: clock, at: at.clone(), spec: { ...spec } });
      }),
    },
    enemies: {
      query: vi.fn((center: THREE.Vector3, radius: number, out: EnemyInstance[]) => {
        out.length = 0;
        for (const e of enemies) {
          if (e.alive && e.center.distanceTo(center) <= radius) {
            out.push(e as unknown as EnemyInstance);
          }
        }
        return out.length;
      }),
      applyDamage: vi.fn((e: EnemyInstance, dmg: DamageInfo) => {
        damages.push({
          time: clock,
          uid: e.uid,
          amount: dmg.amount,
          force: dmg.force,
          vaporize: dmg.vaporize === true,
          source: dmg.source ?? '',
        });
        if (dmg.vaporize) {
          (e as unknown as MockEnemy).alive = false;
        }
      }),
    },
    world: {
      objects: {
        damageExplosivesInRadius: vi.fn((_at: THREE.Vector3, radius: number, damage: number, source?: string) => {
          breakables.push({ time: clock, radius, damage, source: source ?? '' });
        }),
      },
    },
    physics: {
      preStep,
      raycastInto: vi.fn((origin: THREE.Vector3, _dir: THREE.Vector3, _max: number, _mask: number, out: { point: THREE.Vector3; normal: THREE.Vector3; distance: number }) => {
        out.point.set(origin.x, 0, origin.z);
        out.normal.set(0, 1, 0);
        out.distance = origin.y;
        return true;
      }),
      radialImpulse: vi.fn(),
      R: {
        Ball: class {
          constructor(public radius: number) {}
        },
      },
      world: {
        intersectionsWithShape: vi.fn(
          (
            center: THREE.Vector3,
            _rot: unknown,
            shape: { radius: number },
            cb: (collider: { parent: () => unknown }) => boolean,
          ) => {
            for (const b of dynamicBodies) {
              const d = Math.hypot(b.pos.x - center.x, b.pos.z - center.z);
              if (d <= shape.radius) {
                cb({ parent: () => b });
              }
            }
          },
        ),
      },
    },
    fx: {
      sparks: vi.fn(),
      embers: vi.fn(),
      heatShimmer: vi.fn(),
      ring: vi.fn(),
      dust: vi.fn((p: THREE.Vector3) => {
        dustHits.push(p.clone());
      }),
      smoke: vi.fn((p: THREE.Vector3) => {
        smokeHits.push(p.clone());
      }),
      chips: vi.fn((p: THREE.Vector3) => {
        chipHits.push(p.clone());
      }),
    },
    audio: {
      play: vi.fn((id: string, options?: PlayOptions) => {
        audioPlays.push({
          time: clock,
          id,
          delay: options?.delay ?? 0,
          hasPosition: options?.position !== undefined,
          volume: options?.volume ?? 1,
        });
      }),
    },
  } as unknown as Ctx;

  function addDynamicBody(handle: number, x: number, mass = 2) {
    const body = {
      handle,
      pos: { x, y: 1, z: 0 },
      mass: () => mass,
      isDynamic: () => true,
      translation: () => body.pos,
      applyImpulse: vi.fn(),
    };
    dynamicBodies.push(body);
    return body;
  }

  /** Steps the simulation via the automatically registered `ctx.physics.preStep` hooks. */
  function advance(seconds: number, dt = 0.02): void {
    let rem = seconds;
    while (rem > 1e-6) {
      const h = Math.min(rem, dt);
      rem -= h;
      clock += h;
      for (const fn of Array.from(preStep)) fn(h);
    }
  }

  function emitGameState(to: string): void {
    for (const fn of stateHandlers) fn({ to });
  }

  return {
    ctx,
    scene,
    preStep,
    damages,
    explodes,
    audioPlays,
    breakables,
    shakes,
    lightFlashes,
    postFlashes,
    decals,
    dustHits,
    smokeHits,
    chipHits,
    playerPushes,
    addDynamicBody,
    advance,
    emitGameState,
  };
}

describe('megaBlast', () => {
  it('fires core kill blast + core vaporization (<10 m, non-boss only) with NO full-screen white-out', () => {
    const closeGrunt = makeEnemy(1, 6, false);
    const closeBoss = makeEnemy(2, 7, true);
    const midGrunt = makeEnemy(3, 18, false);
    const h = createHarness({ playerX: 110, enemies: [closeGrunt, closeBoss, midGrunt] });

    megaBlast(h.ctx, new THREE.Vector3(0, 1, 0), 1, { source: 'heavyMissile' });

    // Core kill blast delegates to Combat.explode with 26 m kill radius, 1400 dmg, instakill, 0.55 selfDamage, and 0 instant shake.
    expect(h.explodes).toHaveLength(1);
    const spec = h.explodes[0]!.spec;
    expect(spec.radius).toBe(MEGA_BLAST.killRadius);
    expect(spec.damage).toBe(MEGA_BLAST.coreDamage);
    expect(spec.instakill).toBe(true);
    expect(spec.selfDamage).toBe(MEGA_BLAST.selfDamage);
    expect(spec.shake).toBe(0);
    expect(spec.worldObject).toBe(true);
    expect(spec.source).toBe('heavyMissile');

    // Non-boss enemy inside 10 m is vaporized; boss inside 10 m is NOT vaporized; 18 m enemy is handled by Combat.explode.
    expect(h.damages).toHaveLength(1);
    expect(h.damages[0]!.uid).toBe(1);
    expect(h.damages[0]!.vaporize).toBe(true);
    expect(closeGrunt.alive).toBe(false);
    expect(closeBoss.alive).toBe(true);

    // Core breakables inside 26 m destroyed on impact.
    expect(h.breakables).toHaveLength(1);
    expect(h.breakables[0]!.radius).toBe(26);

    // NO full-screen white-out flash (render.post.flash must never be called).
    expect(h.postFlashes).toHaveLength(0);

    // Hard warm-white flash light + decals + stage 1 visible mesh on frame 0.
    expect(h.lightFlashes.length).toBeGreaterThanOrEqual(2);
    expect(h.decals).toContain('scorch');
    expect(h.decals).toContain('crack');
    expect(visibleMegaBlastMeshes(h.ctx)).toBeGreaterThanOrEqual(1);
  });

  it('times outer enemy knockdowns and dynamic body flings to physical wave arrival out to 70 m', () => {
    const coreEnemy = makeEnemy(10, 15);
    const waveEnemyNear = makeEnemy(20, 35);
    const waveEnemyFar = makeEnemy(30, 60);
    const outsideEnemy = makeEnemy(40, 80);

    const h = createHarness({
      playerX: 120,
      enemies: [coreEnemy, waveEnemyNear, waveEnemyFar, outsideEnemy],
    });
    const bodyNear = h.addDynamicBody(101, 35);
    const bodyFar = h.addDynamicBody(102, 62);
    const bodyOut = h.addDynamicBody(103, 82);

    megaBlast(h.ctx, new THREE.Vector3(0, 0, 0), 1);

    // At t = 0, outer enemies (35 m, 60 m) have NOT been hit by the pressure wave.
    expect(h.damages.find(d => d.uid === 20)).toBeUndefined();
    expect(h.damages.find(d => d.uid === 30)).toBeUndefined();
    expect(bodyNear.applyImpulse).not.toHaveBeenCalled();

    // At t = 0.25 s (wave at ~21.25 m), still neither outer enemy nor 35 m body is hit.
    h.advance(0.25);
    expect(h.damages.find(d => d.uid === 20)).toBeUndefined();
    expect(h.damages.find(d => d.uid === 30)).toBeUndefined();
    expect(bodyNear.applyImpulse).not.toHaveBeenCalled();

    // Advance to t = 0.50 s (wave at ~42.5 m): 35 m enemy & body hit; 60 m enemy & body still untouched.
    h.advance(0.25);
    const hitNear = h.damages.find(d => d.uid === 20);
    expect(hitNear).toBeDefined();
    expect(hitNear!.time).toBeGreaterThanOrEqual(35 / MEGA_BLAST.waveSpeed - 0.02);
    expect(hitNear!.vaporize).toBe(false);
    expect(waveEnemyNear.velocity.x).toBeGreaterThan(5);
    expect(waveEnemyNear.velocity.y).toBeGreaterThan(2);
    expect(bodyNear.applyImpulse).toHaveBeenCalledTimes(1);
    expect(h.damages.find(d => d.uid === 30)).toBeUndefined();
    expect(bodyFar.applyImpulse).not.toHaveBeenCalled();

    // Advance to t = 0.90 s (wave reaches full 70 m): 60 m enemy & 62 m body hit strictly later; 80 m untouched.
    h.advance(0.4);
    const hitFar = h.damages.find(d => d.uid === 30);
    expect(hitFar).toBeDefined();
    expect(hitFar!.time).toBeGreaterThan(hitNear!.time);
    expect(hitFar!.time).toBeGreaterThanOrEqual(60 / MEGA_BLAST.waveSpeed - 0.02);
    expect(bodyFar.applyImpulse).toHaveBeenCalledTimes(1);

    // Core enemy (15 m) was not double-hit by outer wave; 80 m enemy & 82 m body were outside 70 m.
    expect(h.damages.find(d => d.uid === 10)).toBeUndefined();
    expect(h.damages.find(d => d.uid === 40)).toBeUndefined();
    expect(bodyOut.applyImpulse).not.toHaveBeenCalled();
  });

  it('delays player camera shake until pressure-wave arrival (later at 35 m than at 10 m, still shakes in mech)', () => {
    const hClose = createHarness({ playerX: 10 });
    const hMid = createHarness({ playerX: 35 });
    const hMech = createHarness({ playerX: 42.5, parked: true });
    const hFar = createHarness({ playerX: 100 });

    const origin = new THREE.Vector3(0, 0, 0);
    megaBlast(hClose.ctx, origin, 1);
    megaBlast(hMid.ctx, origin, 1);
    megaBlast(hMech.ctx, origin, 1);
    megaBlast(hFar.ctx, origin, 1);

    // None of them receive camera shake on frame 0.
    expect(hClose.shakes).toHaveLength(0);
    expect(hMid.shakes).toHaveLength(0);
    expect(hMech.shakes).toHaveLength(0);
    expect(hFar.shakes).toHaveLength(0);

    // Step 1.5 s so all four arrivals complete (10/85=0.12s, 35/85=0.41s, 42.5/85=0.50s, 100/85=1.18s).
    hClose.advance(1.5, 0.01);
    hMid.advance(1.5, 0.01);
    hMech.advance(1.5, 0.01);
    hFar.advance(1.5, 0.01);

    expect(hClose.shakes).toHaveLength(1);
    expect(hMid.shakes).toHaveLength(1);
    expect(hMech.shakes).toHaveLength(1);
    expect(hFar.shakes).toHaveLength(1);

    // Arrival times scale monotonically with distance at ~85 m/s.
    expect(hMid.shakes[0]!.time).toBeGreaterThan(hClose.shakes[0]!.time);
    expect(hMech.shakes[0]!.time).toBeGreaterThan(hMid.shakes[0]!.time);
    expect(hFar.shakes[0]!.time).toBeGreaterThan(hMech.shakes[0]!.time);
    expect(hMid.shakes[0]!.time).toBeCloseTo(35 / MEGA_BLAST.waveSpeed, 1);
    expect(hFar.shakes[0]!.time).toBeCloseTo(100 / MEGA_BLAST.waveSpeed, 1);

    // On-foot player in 26..55 m zone gets physically shoved; parked mech pilot gets shake without foot push.
    expect(hMid.playerPushes).toHaveLength(1);
    expect(hMech.playerPushes).toHaveLength(0);
    expect(hFar.playerPushes).toHaveLength(0);
  });

  it('shatters breakables in progressive rings, flickers lights, lifts perimeter dust, and plays delayed sound', () => {
    const h = createHarness({ playerX: 102 });
    const origin = new THREE.Vector3(0, 0, 0);

    megaBlast(h.ctx, origin, 1);

    // Acoustic deep boom scheduled with dist / 340 delay at t = 0.
    const dist = Math.hypot(102, 1.7);
    const distant = h.audioPlays.find(a => a.id === 'explosion_distant');
    const tank = h.audioPlays.find(a => a.id === 'explosion_tank');
    expect(tank).toBeDefined();
    expect(tank!.hasPosition).toBe(true);
    expect(distant).toBeDefined();
    expect(distant!.hasPosition).toBe(false);
    expect(distant!.delay).toBeCloseTo(dist / MEGA_BLAST.soundSpeed, 3);

    // Advance past full wave expansion + viewer arrival (102 / 85 = 1.2 s).
    h.advance(1.6, 0.02);

    // Breakables shattered progressively from 26 m out to 70 m in strictly increasing radius & time.
    expect(h.breakables.length).toBeGreaterThanOrEqual(5);
    expect(h.breakables[0]!.radius).toBe(26);
    expect(h.breakables[h.breakables.length - 1]!.radius).toBeCloseTo(70, 5);
    for (let i = 1; i < h.breakables.length; i++) {
      expect(h.breakables[i]!.radius).toBeGreaterThan(h.breakables[i - 1]!.radius);
      expect(h.breakables[i]!.time).toBeGreaterThan(h.breakables[i - 1]!.time);
    }

    // Light flicker pulses fired along expanding wave rings + around player on arrival.
    expect(h.lightFlashes.length).toBeGreaterThanOrEqual(8);

    // Ground dust, smoke, and debris chips lifted along the dome perimeter.
    expect(h.dustHits.length).toBeGreaterThan(20);
    expect(h.smokeHits.length).toBeGreaterThan(10);
    expect(h.chipHits.length).toBeGreaterThan(10);

    // Pressure-wave impact boom + trailing debris rain & crumble triggered on wave arrival.
    expect(h.audioPlays.some(a => a.id === 'vehicle_explode' && a.time >= 1.1)).toBe(true);
    expect(h.audioPlays.some(a => a.id === 'explosion_debris' && a.delay > 0)).toBe(true);
    expect(h.audioPlays.some(a => a.id === 'concrete_crumble' && a.delay > 0)).toBe(true);

    // Still zero full-screen white-out flashes throughout the entire lifetime.
    expect(h.postFlashes).toHaveLength(0);
  });

  it('applies zero damage in cosmetic mode while keeping visuals, delayed shake, and audio', () => {
    const nearEnemy = makeEnemy(1, 5);
    const waveEnemy = makeEnemy(2, 40);
    const h = createHarness({ playerX: 40, enemies: [nearEnemy, waveEnemy] });

    megaBlast(h.ctx, new THREE.Vector3(0, 0, 0), 1, { cosmetic: true });
    h.advance(1.0, 0.02);

    expect(h.explodes).toHaveLength(0);
    expect(h.damages).toHaveLength(0);
    expect(h.breakables).toHaveLength(0);
    expect(nearEnemy.alive).toBe(true);
    expect(waveEnemy.alive).toBe(true);

    // Visuals, delayed shake, and audio still played.
    expect(visibleMegaBlastMeshes(h.ctx)).toBeGreaterThan(0);
    expect(h.shakes).toHaveLength(1);
    expect(h.audioPlays.length).toBeGreaterThanOrEqual(3);
  });

  it('scales radii, damage, and wave reach cleanly with the scale parameter', () => {
    const distantEnemy = makeEnemy(7, 110);
    const h = createHarness({ playerX: 160, enemies: [distantEnemy] });

    megaBlast(h.ctx, new THREE.Vector3(0, 0, 0), 2);

    expect(h.explodes[0]!.spec.radius).toBe(52);
    expect(h.explodes[0]!.spec.damage).toBe(2800);

    // At t = 0.9 s (wave at 76.5 m), enemy at 110 m is not yet reached.
    h.advance(0.9, 0.02);
    expect(h.damages.find(d => d.uid === 7)).toBeUndefined();

    // At t = 1.6 s (wave at 136 m <= 140 m max), enemy at 110 m has been hit!
    h.advance(0.7, 0.02);
    const hit = h.damages.find(d => d.uid === 7);
    expect(hit).toBeDefined();
    expect(hit!.time).toBeGreaterThanOrEqual(110 / MEGA_BLAST.waveSpeed - 0.02);
  });

  it('runs all four visual stages, pools/caps concurrent blasts, and cleans up completely after completion', () => {
    const h = createHarness({ playerX: 90 });
    const origin = new THREE.Vector3(0, 0, 0);

    megaBlast(h.ctx, origin, 1);

    // Fixed pool of poolCap * 5 shader meshes added to scene once.
    const expectedMeshes = MEGA_BLAST.poolCap * 5;
    expect(h.scene.children).toHaveLength(expectedMeshes);
    expect(h.preStep.size).toBe(1);
    expect(activeMegaBlastCount(h.ctx)).toBe(1);

    const meshByName = (name: string) => h.scene.children.find(c => c.name === name)!;

    // Stage 1 (t = 0): flash visible; dome/torus/column not yet active.
    expect(meshByName('fx.megaBlast.flash.0').visible).toBe(true);
    expect(meshByName('fx.megaBlast.dome.0').visible).toBe(false);

    // Stage 2 + 3 + 4 (t = 0.4 s): flash gone, dome + refraction + rolling dust torus + squat column visible.
    h.advance(0.4, 0.02);
    expect(meshByName('fx.megaBlast.flash.0').visible).toBe(false);
    expect(meshByName('fx.megaBlast.dome.0').visible).toBe(true);
    expect(meshByName('fx.megaBlast.refract.0').visible).toBe(true);
    expect(meshByName('fx.megaBlast.torus.0').visible).toBe(true);
    expect(meshByName('fx.megaBlast.column.0').visible).toBe(true);
    const risingColHeight = meshByName('fx.megaBlast.column.0').scale.y;

    // Peak fireball column (~t = 1.3 s): short & fat (~28 m tall vs ~48 m diameter), higher than at t = 0.4 s.
    h.advance(0.9, 0.02);
    const peakColHeight = meshByName('fx.megaBlast.column.0').scale.y;
    const peakColWidth = meshByName('fx.megaBlast.column.0').scale.x;
    expect(peakColHeight).toBeGreaterThan(risingColHeight);
    expect(peakColWidth * 2).toBeGreaterThan(peakColHeight);

    // Stage 4 collapse (t = 3.0 s): dome & torus done; squat column has slumped downward into a lower dark cloud.
    h.advance(1.7, 0.02);
    expect(meshByName('fx.megaBlast.dome.0').visible).toBe(false);
    expect(meshByName('fx.megaBlast.refract.0').visible).toBe(false);
    expect(meshByName('fx.megaBlast.torus.0').visible).toBe(false);
    expect(meshByName('fx.megaBlast.column.0').visible).toBe(true);
    expect(meshByName('fx.megaBlast.column.0').scale.y).toBeLessThan(peakColHeight * 0.88);

    // Past full duration (t = 4.2 s): zero active blasts, zero visible meshes, preStep hook detached.
    h.advance(1.2, 0.02);
    expect(activeMegaBlastCount(h.ctx)).toBe(0);
    expect(visibleMegaBlastMeshes(h.ctx)).toBe(0);
    expect(h.preStep.size).toBe(0);

    // Firing 6 concurrent blasts caps at poolCap (4) and allocates zero additional scene children.
    for (let i = 0; i < 6; i++) {
      megaBlast(h.ctx, new THREE.Vector3(i * 15, 0, 0), 1);
      stepMegaBlasts(h.ctx, 0.05);
    }
    expect(activeMegaBlastCount(h.ctx)).toBe(MEGA_BLAST.poolCap);
    expect(h.scene.children).toHaveLength(expectedMeshes);

    // Returning to menu cleans up everything immediately.
    h.emitGameState('menu');
    expect(activeMegaBlastCount(h.ctx)).toBe(0);
    expect(visibleMegaBlastMeshes(h.ctx)).toBe(0);
    expect(h.preStep.size).toBe(0);

    // Explicit resetMegaBlasts is safe when already idle.
    resetMegaBlasts(h.ctx);
    expect(activeMegaBlastCount(h.ctx)).toBe(0);
  });
});
