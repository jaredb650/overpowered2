/**
 * Unit tests for the Distraint Frame Red Beam arm weapon, 3-wall piercing trace, bossHit cap,
 * pooled Red Beam FX auto-cleanup, co-op remoteNews playback, and 3D emitter model.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx, DamageInfo, LoopHandle, RayHit } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import type { Ac130Rounds } from '../../progression/callins/ac130Rounds';
import type { MechKind } from '../../progression/callins/link';
import { ModelBuilder } from '../../progression/modelkit';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { Raycaster } from '../../weapons/penetration';
import { activeRedBeamCount, stepRedBeamPool } from '../../fx/recipes/redBeam';
import { BEAM_ARM } from '../models/beam';
import { BEAM_PLUGIN, makeBeamTrace, RED_BEAM, RedBeamArmGun, RedBeamClock, traceBeamSegments } from './beam';
import type { Arm, ArmUpdateContext, Sight } from './types';

const DT = 1 / 60;

interface MockHarness {
  ctx: Ctx;
  scene: THREE.Scene;
  time: { elapsed: number };
  loops: { id: string; stopped: boolean; pitch: number; volume: number }[];
  played: string[];
  damages: { enemy: EnemyInstance; info: DamageInfo }[];
  afflictions: { enemy: EnemyInstance; kind: string; seconds: number }[];
  kicks: number;
  traumas: number;
  news: { kind: MechKind; values: number[] }[];
  beamCalls: { from: THREE.Vector3; to: THREE.Vector3; width?: number; seconds?: number }[];
  makeUpdate: (overrides?: Partial<ArmUpdateContext>) => ArmUpdateContext;
}

function makeEnemy(uid: number, x: number, z: number, opts?: { isBoss?: boolean; health?: number }): EnemyInstance {
  return {
    uid,
    id: opts?.isBoss ? 'titan' : 'trooper',
    alive: true,
    isBoss: opts?.isBoss ?? false,
    health: opts?.health ?? (opts?.isBoss ? 5000 : 100),
    maxHealth: opts?.health ?? (opts?.isBoss ? 5000 : 100),
    armor: 0,
    position: new THREE.Vector3(x, 0, z),
    center: new THREE.Vector3(x, 1.2, z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    score: 100,
    frozen: 0,
    burning: 0,
    machine: false,
  } as unknown as EnemyInstance;
}

/** Builds a raycaster with thin or thick axis-aligned walls perpendicular to -Z at given `z` planes. */
function makeWallRaycaster(wallZs: readonly number[], thickness = 0): Raycaster {
  return {
    raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null {
      if (Math.abs(dir.z) < 1e-6) return null;
      let bestDist = Infinity;
      let bestZ = 0;
      let bestNormalZ = 1;
      for (const wz of wallZs) {
        if (thickness > 0) {
          // Solid slab occupying [wz - thickness, wz].
          const zMax = wz;
          const zMin = wz - thickness;
          if (origin.z >= zMin && origin.z <= zMax) {
            return {
              point: origin.clone(),
              normal: new THREE.Vector3(0, 0, dir.z < 0 ? 1 : -1),
              distance: 0,
              surface: 'concrete',
              collider: null,
            };
          }
          const faceZ = dir.z < 0 ? zMax : zMin;
          const t = (faceZ - origin.z) / dir.z;
          if (t > 0 && t <= maxDist && t < bestDist) {
            bestDist = t;
            bestZ = faceZ;
            bestNormalZ = dir.z < 0 ? 1 : -1;
          }
        } else {
          const t = (wz - origin.z) / dir.z;
          if (t > 0 && t <= maxDist && t < bestDist) {
            bestDist = t;
            bestZ = wz;
            bestNormalZ = dir.z < 0 ? 1 : -1;
          }
        }
      }
      if (bestDist === Infinity) return null;
      return {
        point: new THREE.Vector3(origin.x + dir.x * bestDist, origin.y + dir.y * bestDist, bestZ),
        normal: new THREE.Vector3(0, 0, bestNormalZ),
        distance: bestDist,
        surface: 'concrete',
        collider: null,
      };
    },
  };
}

function makeHarness(opts?: { enemies?: EnemyInstance[]; raycaster?: Raycaster }): MockHarness {
  const scene = new THREE.Scene();
  const time = { elapsed: 0 };
  const loops: MockHarness['loops'] = [];
  const played: string[] = [];
  const damages: MockHarness['damages'] = [];
  const afflictions: MockHarness['afflictions'] = [];
  const news: MockHarness['news'] = [];
  const beamCalls: MockHarness['beamCalls'] = [];
  let kicks = 0;
  let traumas = 0;

  const alive = opts?.enemies ?? [];
  const raycaster = opts?.raycaster ?? { raycast: () => null };

  const ctx = {
    time,
    player: { eye: new THREE.Vector3(0, 5, 0), position: new THREE.Vector3(0, 0, 0) },
    audio: {
      play: (id: string) => { played.push(id); },
      startLoop: (id: string) => {
        const entry = { id, stopped: false, pitch: 1, volume: 1 };
        loops.push(entry);
        const handle: LoopHandle = {
          get alive() { return !entry.stopped; },
          stop: () => { entry.stopped = true; },
          setPitch: (p: number) => { entry.pitch = p; },
          setVolume: (v: number) => { entry.volume = v; },
          setPosition: () => undefined,
        };
        return handle;
      },
    },
    camera: {
      addTrauma: () => { traumas++; },
      kick: () => { kicks++; },
      fovPunch: () => undefined,
    },
    hud: {
      hitMarker: () => undefined,
    },
    fx: {
      beam: (from: THREE.Vector3, to: THREE.Vector3, _kind: string, width?: number, seconds?: number) => {
        beamCalls.push({ from: from.clone(), to: to.clone(), width, seconds });
      },
      ring: () => undefined,
      sparks: () => undefined,
      embers: () => undefined,
      heatShimmer: () => undefined,
      inhale: () => undefined,
      arc: () => undefined,
    },
    render: {
      scene,
      lights: { flash: () => undefined },
      decals: { add: () => undefined },
      post: { flash: () => undefined, chromatic: () => undefined, radialBlur: () => undefined },
    },
    physics: {
      raycast: raycaster.raycast,
      radialImpulse: () => undefined,
    },
    combat: {},
    enemies: {
      alive,
      query(center: THREE.Vector3, radius: number, out: EnemyInstance[]): number {
        out.length = 0;
        for (const e of alive) {
          if (e.position.distanceTo(center) <= radius) out.push(e);
        }
        return out.length;
      },
      applyDamage(e: EnemyInstance, d: DamageInfo) {
        damages.push({ enemy: e, info: { ...d, point: d.point.clone(), dir: d.dir.clone() } });
        e.health -= d.amount;
        const killed = e.health <= 0;
        if (killed) e.alive = false;
        return { dealt: d.amount, killed, headshot: false, severed: [], blocked: false };
      },
      afflict(e: EnemyInstance, kind: string, seconds: number) {
        afflictions.push({ enemy: e, kind, seconds });
      },
      vehicles: null,
    },
    world: { objects: { damageExplosivesInRadius: () => undefined } },
  } as unknown as Ctx;

  const arm: Arm = {
    muzzle: out => out.set(1.2, 4.2, -3.5),
    bore: out => out.set(0, 0, -1),
    turn: () => undefined,
    recoil: () => undefined,
  };
  const sight: Sight = {
    view: { position: new THREE.Vector3(0, 1.2, 0) } as Sight['view'],
    aim: new THREE.Vector3(0, 0, -1),
    point: new THREE.Vector3(0, 1.2, -60),
    range: 60,
  };

  const makeUpdate = (overrides?: Partial<ArmUpdateContext>): ArmUpdateContext => ({
    ctx,
    rounds: {} as Ac130Rounds,
    arm,
    side: 'right',
    button: 'RMB',
    cycleKey: '2',
    sight,
    held: false,
    pressed: false,
    cyclePressed: false,
    reloadPressed: false,
    recoilMult: 1,
    onShell: null,
    onNews: (kind, values) => { news.push({ kind, values: [...values] }); },
    ...overrides,
  });

  return {
    ctx,
    scene,
    time,
    loops,
    played,
    damages,
    afflictions,
    get kicks() { return kicks; },
    get traumas() { return traumas; },
    news,
    beamCalls,
    makeUpdate,
  };
}

describe('RedBeamClock', () => {
  it('takes 1.6 s to reach full charge and slows walkSpeedMult to 0.6 only while charging', () => {
    const c = new RedBeamClock();
    expect(c.walkSpeedMult).toBe(1);
    expect(c.heat).toBe(0);

    // Hold for 0.8 s -> 50% charge, walkSpeedMult === 0.6.
    for (let i = 0; i < 48; i++) c.update(DT, true);
    expect(c.charge).toBeCloseTo(0.5, 2);
    expect(c.heat).toBeCloseTo(0.5, 2);
    expect(c.walkSpeedMult).toBe(0.6);
    expect(c.firing).toBe(false);

    // Hold another 0.8 s (1.6 s total) -> full charge 1.0, still holding until release.
    for (let i = 0; i < 48; i++) c.update(DT, true);
    expect(c.charge).toBe(1);
    expect(c.walkSpeedMult).toBe(0.6);
    expect(c.firing).toBe(false);
  });

  it('early release fires nothing, keeps half charge for 2.0 s, resumes if re-held, and decays after 2.0 s', () => {
    const c = new RedBeamClock();
    // Charge to 80% (1.28 s).
    c.update(1.28, true);
    expect(c.charge).toBeCloseTo(0.8, 3);

    // Early release: does NOT fire, halves charge to 0.4, walkSpeedMult restores to 1.
    c.update(DT, false);
    expect(c.firing).toBe(false);
    expect(c.releasedEarly).toBe(true);
    expect(c.charge).toBeCloseTo(0.4, 3);
    expect(c.walkSpeedMult).toBe(1);

    // Hold still for 1.9 s: kept half charge remains intact throughout the 2.0 s window.
    c.update(1.9, false);
    expect(c.charge).toBeCloseTo(0.4, 3);

    // Past 2.0 s (add another 0.3 s -> 0.2 s into decay): charge decays smoothly toward 0.
    c.update(0.3, false);
    expect(c.charge).toBeLessThan(0.4);
    c.update(1.0, false);
    expect(c.charge).toBe(0);

    // Early release then resume within 2.0 s: continues charging from the kept half!
    c.update(0.8, true); // 0.5 charge
    c.update(DT, false); // early release -> 0.25 kept
    expect(c.charge).toBeCloseTo(0.25, 3);
    c.update(1.0, false); // still inside 2.0 s window -> still 0.25
    expect(c.charge).toBeCloseTo(0.25, 3);
    c.update(0.4, true); // +0.25 -> 0.50
    expect(c.charge).toBeCloseTo(0.5, 2);
  });

  it('fires for 1.0 s on full-charge release and then enters a 9.0 s cooldown', () => {
    const c = new RedBeamClock();
    c.update(RED_BEAM.chargeTime, true);
    expect(c.charge).toBe(1);

    // Release -> fires immediately.
    c.update(DT, false);
    expect(c.firedNow).toBe(true);
    expect(c.firing).toBe(true);
    expect(c.walkSpeedMult).toBe(1);

    // Still firing at 0.95 s.
    c.update(0.95, false);
    expect(c.firing).toBe(true);
    expect(c.onCooldown).toBe(false);

    // Completes 1.0 s beam and enters 9.0 s cooldown.
    c.update(0.06, false);
    expect(c.endedBeamNow).toBe(true);
    expect(c.firing).toBe(false);
    expect(c.onCooldown).toBe(true);
    expect(c.cooldown).toBeCloseTo(9.0, 2);
    expect(c.cooldownProgress).toBeCloseTo(0, 2);

    // Holding trigger during cooldown cannot charge.
    c.update(4.5, true);
    expect(c.charge).toBe(0);
    expect(c.charging).toBe(false);
    expect(c.cooldown).toBeCloseTo(4.5, 2);
    expect(c.cooldownProgress).toBeCloseTo(0.5, 2);

    // Finishes 9.0 s cooldown and becomes ready again.
    c.update(4.6, false);
    expect(c.onCooldown).toBe(false);
    expect(c.cooldownProgress).toBe(-1);
    c.update(0.8, true);
    expect(c.charge).toBeCloseTo(0.5, 2);
  });
});

describe('traceBeamSegments (3-wall pierce & 180 m max range)', () => {
  const origin = new THREE.Vector3(0, 1.2, 0);
  const dir = new THREE.Vector3(0, 0, -1);

  it('extends to 180 m with no walls', () => {
    const trace = traceBeamSegments({ raycast: () => null }, origin, dir, RED_BEAM.range, RED_BEAM.maxWalls, makeBeamTrace());
    expect(trace.reach).toBeCloseTo(180, 2);
    expect(trace.end.z).toBeCloseTo(-180, 2);
    expect(trace.wallsPierced).toBe(0);
    expect(trace.hitFinalWall).toBe(false);
  });

  it('pierces up to 3 thin walls and stops cleanly on the 4th wall', () => {
    const ray = makeWallRaycaster([-20, -50, -90, -130], 0);
    const trace = traceBeamSegments(ray, origin, dir, RED_BEAM.range, RED_BEAM.maxWalls, makeBeamTrace());
    expect(trace.wallsPierced).toBe(3);
    expect(trace.wallCount).toBe(4);
    expect(trace.hitFinalWall).toBe(true);
    expect(trace.end.z).toBeCloseTo(-130, 1);
    expect(trace.reach).toBeCloseTo(130, 1);
  });

  it('pierces up to 3 solid concrete walls (0.8 m thick) and continues to 180 m when no 4th wall exists', () => {
    const ray = makeWallRaycaster([-25, -60, -100], 0.8);
    const trace = traceBeamSegments(ray, origin, dir, RED_BEAM.range, RED_BEAM.maxWalls, makeBeamTrace());
    expect(trace.wallsPierced).toBe(3);
    expect(trace.hitFinalWall).toBe(false);
    expect(trace.reach).toBeCloseTo(180, 1);
  });
});

describe('RedBeamArmGun combat, HUD, recoilMult, silence/reset, and co-op remoteNews', () => {
  it('vaporizes regular enemies, ignites survivors at ~2.4 m outer edge, and hits bosses for 900 once via bossHit', () => {
    const grunt = makeEnemy(1, 0.3, -25, { isBoss: false, health: 120 });
    const edgeSurvivor = makeEnemy(2, 1.8, -30, { isBoss: false, health: 120 });
    const safeBystander = makeEnemy(3, 4.0, -30, { isBoss: false, health: 120 });
    const boss = makeEnemy(4, 0, -45, { isBoss: true, health: 4000 });

    const h = makeHarness({ enemies: [grunt, edgeSurvivor, safeBystander, boss] });
    const gun = BEAM_PLUGIN.create(h.ctx) as RedBeamArmGun;

    // Charge to full (1.6 s) and release to fire the full 1.0 s beam.
    gun.update(1.6, h.makeUpdate({ held: true }));
    gun.update(DT, h.makeUpdate({ held: false }));
    for (let i = 0; i < 65; i++) {
      h.time.elapsed += DT;
      gun.update(DT, h.makeUpdate({ held: false }));
    }

    // Grunt was vaporized with vaporize: true.
    expect(grunt.alive).toBe(false);
    const gruntHits = h.damages.filter(d => d.enemy === grunt);
    expect(gruntHits.length).toBe(1);
    expect(gruntHits[0]!.info.amount).toBe(9999);
    expect(gruntHits[0]!.info.vaporize).toBe(true);

    // Boss took exactly 900 damage ONCE across all ~12 beam ticks (via bossHit), and caught fire.
    const bossHits = h.damages.filter(d => d.enemy === boss);
    expect(bossHits.length).toBe(1);
    expect(bossHits[0]!.info.amount).toBe(900);
    expect(boss.health).toBe(3100);
    expect(h.afflictions.some(a => a.enemy === boss && a.kind === 'burn')).toBe(true);

    // Outer edge survivor (~1.8 m <= 2.4 m) was NOT vaporized, and was set on fire.
    expect(edgeSurvivor.alive).toBe(true);
    expect(h.damages.filter(d => d.enemy === edgeSurvivor).length).toBe(0);
    expect(h.afflictions.some(a => a.enemy === edgeSurvivor && a.kind === 'burn')).toBe(true);

    // Bystander at 4.0 m was untouched.
    expect(h.damages.filter(d => d.enemy === safeBystander).length).toBe(0);
    expect(h.afflictions.some(a => a.enemy === safeBystander)).toBe(false);

    // Emitted co-op wire note `beam` with [mx, my, mz, ex, ey, ez, 1.0].
    expect(h.news.length).toBe(1);
    expect(h.news[0]!.kind).toBe('beam');
    expect(h.news[0]!.values.length).toBe(7);
    expect(h.news[0]!.values[6]).toBe(1.0);
  });

  it('respects u.recoilMult === 0 (Spider Legs noRecoil) and updates HUD row through all states', () => {
    const h = makeHarness();
    const gun = BEAM_PLUGIN.create(h.ctx) as RedBeamArmGun;
    const row: GunnerWeapon = { name: '', ammo: 0, max: 100, reload: -1 };

    // READY
    gun.fillRow(row, 'RMB');
    expect(row.name).toBe('RMB RED BEAM [READY]');
    expect(row.reload).toBe(-1);

    // CHARGING 50%
    gun.update(0.8, h.makeUpdate({ held: true, recoilMult: 0 }));
    gun.fillRow(row, 'RMB');
    expect(row.name).toBe('RMB RED BEAM [CHARGING 50%]');
    expect(row.reload).toBe(-1);

    // Full charge & fire with recoilMult = 0 -> zero camera kick / trauma.
    gun.update(0.85, h.makeUpdate({ held: true, recoilMult: 0 }));
    gun.update(DT, h.makeUpdate({ held: false, recoilMult: 0 }));
    gun.fillRow(row, 'RMB');
    expect(row.name).toBe('RMB RED BEAM [FIRING]');
    expect(row.reload).toBe(-1);
    expect(h.kicks).toBe(0);
    expect(h.traumas).toBe(0);

    // Complete 1.0 s beam -> COOLDOWN with row.reload in 0..1.
    gun.update(1.05, h.makeUpdate({ held: false, recoilMult: 0 }));
    gun.fillRow(row, 'RMB');
    expect(row.name).toBe('RMB RED BEAM [COOLDOWN]');
    expect(row.reload).toBeGreaterThanOrEqual(0);
    expect(row.reload).toBeLessThanOrEqual(1);
  });

  it('silence() stops active charge and beam audio loops immediately, and reset() restores ready state', () => {
    const h = makeHarness();
    const gun = BEAM_PLUGIN.create(h.ctx) as RedBeamArmGun;

    // Start charging -> charge hum loop active.
    gun.update(0.5, h.makeUpdate({ held: true }));
    expect(h.loops.some(l => l.id === 'railgun_charge_loop' && !l.stopped)).toBe(true);
    gun.silence();
    expect(h.loops.every(l => l.stopped)).toBe(true);

    // Complete charge & fire -> beam loops active.
    gun.update(1.2, h.makeUpdate({ held: true }));
    gun.update(DT, h.makeUpdate({ held: false }));
    expect(gun.firing).toBe(true);
    expect(h.loops.some(l => l.id === 'lance_beam_loop' && !l.stopped)).toBe(true);
    expect(h.loops.some(l => l.id === 'orbital_beam_loop' && !l.stopped)).toBe(true);

    gun.silence();
    expect(h.loops.every(l => l.stopped)).toBe(true);

    // Reset restores full ready state.
    gun.reset();
    expect(gun.firing).toBe(false);
    expect(gun.heat).toBe(0);
    expect(gun.walkSpeedMult).toBe(1);
    expect(gun.clock.onCooldown).toBe(false);
  });

  it('remoteNews plays the pooled 1.0 s red beam visual & audio on teammates screens and auto-cleans up after 1.0 s', () => {
    const h = makeHarness();
    h.time.elapsed = 10.0;

    BEAM_PLUGIN.remoteNews?.(h.ctx, 'beam', [1, 4, -3, 1, 4, -120, 1.0]);

    expect(h.beamCalls.length).toBe(1);
    expect(h.beamCalls[0]!.width).toBeCloseTo(1.4, 2);
    expect(h.beamCalls[0]!.seconds).toBe(1.0);
    expect(h.played).toContain('lance_thunder');
    expect(h.played).toContain('orbital_strike');
    expect(activeRedBeamCount(h.ctx)).toBe(1);

    // Halfway through (0.5 s): still active.
    h.time.elapsed = 10.5;
    stepRedBeamPool(h.ctx);
    expect(activeRedBeamCount(h.ctx)).toBe(1);

    // Past 1.0 s: automatically cleaned up and returned to the pool.
    h.time.elapsed = 11.05;
    stepRedBeamPool(h.ctx);
    expect(activeRedBeamCount(h.ctx)).toBe(0);
  });

  it('BEAM_ARM builds valid solid and glow emitter geometries with no errors', () => {
    const fixed = new ModelBuilder();
    const moving = new ModelBuilder();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    BEAM_ARM.build(fixed);
    BEAM_ARM.moving(moving);
    spy.mockRestore();

    const fixedSolid = fixed.solidGeometry();
    const fixedGlow = fixed.glowGeometry();
    const movingSolid = moving.solidGeometry();
    const movingGlow = moving.glowGeometry();

    expect(fixedSolid).not.toBeNull();
    expect(fixedGlow).not.toBeNull();
    expect(movingSolid).not.toBeNull();
    expect(movingGlow).not.toBeNull();
    expect(BEAM_ARM.muzzle[2]).toBeLessThan(-3);
  });

  it('uses Combat.strike with vaporize: true and pierces: true when concrete Combat is present', () => {
    const grunt = makeEnemy(10, 0, -20, { isBoss: false, health: 100 });
    const h = makeHarness({ enemies: [grunt] });
    const strikeCalls: { enemy: EnemyInstance; amount: number; vaporize: boolean; pierces: boolean; type: string; source: string }[] = [];
    const scratchOpts = {
      type: 'fire', source: '', force: 0, severMult: 1, headshotMult: 2, gib: false,
      slicePlaneNormal: undefined, explosionId: undefined, killStop: 0, quiet: false,
      reach: undefined, blastKind: undefined, charge: undefined, pierces: false, vaporize: false,
      load: undefined, armour: undefined,
    };
    (h.ctx as unknown as { combat: Record<string, unknown> }).combat = {
      strikeOptions: (type: string, source: string) => {
        scratchOpts.type = type;
        scratchOpts.source = source;
        scratchOpts.pierces = false;
        scratchOpts.vaporize = false;
        return scratchOpts;
      },
      strike: (enemy: EnemyInstance, _pt: THREE.Vector3, _n: THREE.Vector3, _d: THREE.Vector3, _b: unknown, _r: unknown, amount: number, o: typeof scratchOpts) => {
        strikeCalls.push({ enemy, amount, vaporize: o.vaporize, pierces: o.pierces, type: o.type, source: o.source });
        enemy.alive = false;
        return { dealt: amount, killed: true, headshot: false, severed: [], blocked: false };
      },
    };

    const gun = BEAM_PLUGIN.create(h.ctx) as RedBeamArmGun;
    gun.update(1.6, h.makeUpdate({ held: true }));
    gun.update(DT, h.makeUpdate({ held: false }));

    expect(strikeCalls.length).toBe(1);
    expect(strikeCalls[0]!.enemy).toBe(grunt);
    expect(strikeCalls[0]!.amount).toBe(9999);
    expect(strikeCalls[0]!.vaporize).toBe(true);
    expect(strikeCalls[0]!.pierces).toBe(true);
    expect(strikeCalls[0]!.type).toBe('fire');
    expect(strikeCalls[0]!.source).toBe('frame_beam');
  });
});
