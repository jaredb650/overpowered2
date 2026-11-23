/**
 * Unit tests for the 30 mm three-barrel Explosive Rotary Cannon (`vulcan30.ts` & `models/vulcan30.ts`):
 * spin-up, 24.5 rds/s cadence, overheat & vent lockout, independent per-arm HE/AP/FLAK cycling,
 * zero-spread round mechanics, silence/reset, co-op remote playback, and 3D model build sanity.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx, LoopHandle } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec, ShotResult, ShotSpec } from '../../core/gameplay';
import { AC130 } from '../../progression/callins/ac130Data';
import type { Ac130Rounds } from '../../progression/callins/ac130Rounds';
import type { MechKind } from '../../progression/callins/link';
import { ModelBuilder } from '../../progression/modelkit';
import type { GunnerWeapon } from '../../vehicles/hud';
import { VULCAN30_ARM } from '../models/vulcan30';
import { FrameGuns } from '../weapons';
import type { Arm, ArmRemoteState, ArmUpdateContext, Sight } from './types';
import { VULCAN30, VULCAN30_PLUGIN, Vulcan30, Vulcan30ArmGun } from './vulcan30';

const DT = 1 / 60;
const B = AC130.bofors;

interface MockHarness {
  ctx: Ctx;
  rounds: Ac130Rounds;
  arm: Arm;
  sight: Sight;
  down: Set<string>;
  pressed: Set<string>;
  shots: { origin: THREE.Vector3; dir: THREE.Vector3; spec: ShotSpec }[];
  explosions: { at: THREE.Vector3; spec: ExplosionSpec }[];
  callouts: string[];
  sounds: { id: string; opts?: unknown }[];
  loops: { id: string; stopped: boolean; stopCalls: number; pitches: number[] }[];
  tracers: { from: THREE.Vector3; to: THREE.Vector3; kind: string }[];
  fxExplosions: { at: THREE.Vector3; kind: string }[];
  flashes: number;
  turns: number[];
  recoils: number[];
  trauma: number;
  kicks: number;
  news: { kind: MechKind; values: number[] }[];
  setWallDistance: (dist: number | null) => void;
  setEnemies: (positions: [number, number, number][]) => void;
}

function makeHarness(): MockHarness {
  const down = new Set<string>();
  const pressed = new Set<string>();
  const shots: MockHarness['shots'] = [];
  const explosions: MockHarness['explosions'] = [];
  const callouts: string[] = [];
  const sounds: MockHarness['sounds'] = [];
  const loops: MockHarness['loops'] = [];
  const tracers: MockHarness['tracers'] = [];
  const fxExplosions: MockHarness['fxExplosions'] = [];
  const turns: number[] = [];
  const recoils: number[] = [];
  const news: MockHarness['news'] = [];
  let wallDistance: number | null = 35;
  let enemiesList: EnemyInstance[] = [];

  const harness: MockHarness = {
    ctx: null as unknown as Ctx,
    rounds: null as unknown as Ac130Rounds,
    arm: {
      muzzle: out => out.set(-1.75, 4.0, -4.0),
      bore: out => out.set(0, 0, -1),
      turn: rad => { turns.push(rad); },
      recoil: m => { recoils.push(m); },
    },
    sight: {
      view: { position: new THREE.Vector3(0, 5.2, 0) } as Sight['view'],
      aim: new THREE.Vector3(0, 0, -1),
      point: new THREE.Vector3(0, 5.2, -35),
      range: 35,
    },
    down,
    pressed,
    shots,
    explosions,
    callouts,
    sounds,
    loops,
    tracers,
    fxExplosions,
    flashes: 0,
    turns,
    recoils,
    trauma: 0,
    kicks: 0,
    news,
    setWallDistance: dist => { wallDistance = dist; },
    setEnemies: positions => {
      enemiesList = positions.map(([x, y, z], uid) => ({
        uid,
        alive: true,
        position: new THREE.Vector3(x, y - 1, z),
        center: new THREE.Vector3(x, y, z),
      }) as unknown as EnemyInstance);
    },
  };

  harness.ctx = {
    input: {
      isDown: (a: string) => down.has(a),
      pressed: (a: string) => pressed.has(a),
    },
    audio: {
      play: (id: string, opts?: unknown) => { sounds.push({ id, opts }); },
      startLoop: (id: string): LoopHandle => {
        const entry = { id, stopped: false, stopCalls: 0, pitches: [] as number[] };
        loops.push(entry);
        return {
          stop: () => {
            entry.stopped = true;
            entry.stopCalls++;
          },
          setPitch: (p: number) => {
            entry.pitches.push(p);
          },
          setVolume: () => undefined,
          setPosition: () => undefined,
          alive: true,
        };
      },
    },
    hud: {
      callout: (text: string) => { callouts.push(text); },
    },
    fx: {
      muzzleFlash: () => { harness.flashes++; },
      tracer: (from: THREE.Vector3, to: THREE.Vector3, kind: string) => {
        tracers.push({ from: from.clone(), to: to.clone(), kind });
      },
      explosion: (at: THREE.Vector3, opts: { kind: string }) => {
        fxExplosions.push({ at: at.clone(), kind: opts.kind });
      },
      impact: () => undefined,
      ring: () => undefined,
      sparks: () => undefined,
      smoke: () => undefined,
      shellCasing: () => undefined,
    },
    camera: {
      addTrauma: (amount: number) => { harness.trauma += amount; },
      kick: () => { harness.kicks++; },
    },
    combat: {
      fireRay: (origin: THREE.Vector3, dir: THREE.Vector3, spec: ShotSpec): ShotResult => {
        shots.push({ origin: origin.clone(), dir: dir.clone(), spec: { ...spec } });
        const dist = wallDistance ?? (spec.maxDistance ?? VULCAN30.range);
        return {
          hitEnemy: false,
          headshot: false,
          killed: false,
          kills: 0,
          end: origin.clone().addScaledVector(dir, dist),
        };
      },
      explode: (at: THREE.Vector3, spec: ExplosionSpec) => {
        explosions.push({ at: at.clone(), spec: { ...spec } });
      },
      spawnProjectile: () => undefined,
    },
    enemies: {
      get alive() { return enemiesList; },
      query: () => 0,
      vehicles: null,
    },
    physics: {
      raycast: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => {
        if (wallDistance === null || wallDistance > maxDist) return null;
        return {
          point: origin.clone().addScaledVector(dir, wallDistance),
          normal: new THREE.Vector3(0, 0, 1),
          distance: wallDistance,
          surface: 'concrete',
          collider: null,
        };
      },
      raycastInto: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, _mask: number, out: {
        point: THREE.Vector3; normal: THREE.Vector3; distance: number; surface: string;
      }) => {
        if (wallDistance === null || wallDistance > maxDist) return false;
        out.point.copy(origin).addScaledVector(dir, wallDistance);
        out.normal.set(0, 0, 1);
        out.distance = wallDistance;
        out.surface = 'concrete';
        return true;
      },
    },
    world: {
      objects: {
        damageExplosivesInRadius: vi.fn(),
      },
    },
  } as unknown as Ctx;

  harness.rounds = {
    onImpact: null,
    fire: () => undefined,
    flash: () => undefined,
    update: () => undefined,
    clear: () => undefined,
  } as unknown as Ac130Rounds;

  return harness;
}

function makeUpdateCtx(
  h: MockHarness,
  overrides: Partial<ArmUpdateContext> = {},
): ArmUpdateContext {
  return {
    ctx: h.ctx,
    rounds: h.rounds,
    arm: h.arm,
    side: 'left',
    button: 'LMB',
    cycleKey: '1',
    sight: h.sight,
    held: false,
    pressed: false,
    cyclePressed: false,
    reloadPressed: false,
    recoilMult: 1,
    onShell: null,
    onNews: (kind, values) => { h.news.push({ kind, values: [...values] }); },
    ...overrides,
  };
}

describe('Vulcan30 clock', () => {
  it('spins up for 0.35 s before firing, then maintains 24.5 rounds/s cadence', () => {
    const v = new Vulcan30();
    let firstAt = -1;
    for (let step = 1; step <= 60; step++) {
      const t = step * DT;
      const n = v.update(DT, true);
      if (t < 0.33) expect(n).toBe(0);
      if (n > 0 && firstAt < 0) {
        firstAt = t;
        break;
      }
    }
    expect(firstAt).toBeGreaterThanOrEqual(0.34);
    expect(firstAt).toBeLessThanOrEqual(0.37);
    expect(v.firing).toBe(true);

    // Measure 1 full second of steady firing after spin-up: 24.5 rounds/s.
    let roundsInSecond = 0;
    for (let i = 0; i < 60; i++) roundsInSecond += v.update(DT, true);
    expect(roundsInSecond).toBeGreaterThanOrEqual(23);
    expect(roundsInSecond).toBeLessThanOrEqual(26);

    // Releasing trigger stops firing and spins barrels down.
    expect(v.update(DT, false)).toBe(0);
    expect(v.firing).toBe(false);
    const spinAfterRelease = v.spin;
    v.update(0.25, false);
    expect(v.spin).toBeLessThan(spinAfterRelease);
  });

  it('overheats after ~5.0 s of continuous fire and locks out for 2.5 s while venting', () => {
    const v = new Vulcan30();
    // Spin up first.
    let spinTime = 0;
    let totalRounds = 0;
    while (!v.firing && spinTime < 1) {
      totalRounds += v.update(DT, true);
      spinTime += DT;
    }

    // Fire continuously until overheat.
    let fireTime = 0;
    let sawOverheatedNow = false;
    while (!v.heat.overheated && fireTime < 15) {
      totalRounds += v.update(DT, true);
      fireTime += DT;
      if (v.overheatedNow) sawOverheatedNow = true;
    }
    expect(sawOverheatedNow).toBe(true);
    expect(v.heat.overheated).toBe(true);
    expect(fireTime).toBeGreaterThan(4.6);
    expect(fireTime).toBeLessThan(5.4);
    expect(totalRounds).toBeGreaterThanOrEqual(122);
    expect(totalRounds).toBeLessThanOrEqual(125);

    // Locked out for 2.5 s vent even while holding trigger.
    let ventTime = 0;
    while (v.heat.overheated && ventTime < 6) {
      expect(v.update(DT, true)).toBe(0);
      expect(v.firing).toBe(false);
      ventTime += DT;
    }
    expect(ventTime).toBeGreaterThan(2.35);
    expect(ventTime).toBeLessThan(2.65);
    expect(v.heat.value).toBe(0);
  });

  it('cools off trigger when not overheated', () => {
    const v = new Vulcan30();
    for (let i = 0; i < 120; i++) v.update(DT, true);
    const hot = v.heat.value;
    expect(hot).toBeGreaterThan(0.2);
    for (let i = 0; i < 60; i++) v.update(DT, false);
    expect(v.heat.value).toBeCloseTo(Math.max(0, hot - VULCAN30.cool), 2);
  });

  it('cycles HE -> AP -> FLAK -> HE', () => {
    const v = new Vulcan30();
    expect(v.round).toBe('g40');
    expect(v.roundLabel).toBe('HE');
    expect(v.cycle()).toBe('ap');
    expect(v.roundLabel).toBe('AP');
    expect(v.cycle()).toBe('flak');
    expect(v.roundLabel).toBe('FLAK');
    expect(v.cycle()).toBe('g40');
    expect(v.roundLabel).toBe('HE');
  });
});

describe('Vulcan30ArmGun cycling, HUD, and per-arm independence', () => {
  it('cycles ONLY on cyclePressed (never reloadPressed) and formats side-prefixed callouts & HUD row', () => {
    const h = makeHarness();
    const gun = new Vulcan30ArmGun(h.ctx);
    const row: GunnerWeapon = { name: '', ammo: 0, max: 0, reload: -1 };

    gun.fillRow(row, 'LMB', '1');
    expect(row.name).toBe('LMB 30MM HE // 1');
    expect(row.ammo).toBe(100);
    expect(row.max).toBe(100);
    expect(row.reload).toBe(-1);

    // Pressing R (`reloadPressed`) must NOT cycle ammo.
    gun.update(DT, makeUpdateCtx(h, { reloadPressed: true }));
    expect(gun.clock.round).toBe('g40');
    expect(h.callouts).toEqual([]);

    // Tap cyclePressed cycles HE -> AP -> FLAK -> HE with side-prefixed callout.
    gun.update(DT, makeUpdateCtx(h, { cyclePressed: true, side: 'left' }));
    expect(gun.clock.round).toBe('ap');
    gun.fillRow(row, 'LMB', '1');
    expect(row.name).toBe('LMB 30MM AP // 1');

    gun.update(DT, makeUpdateCtx(h, { cyclePressed: true, side: 'left' }));
    expect(gun.clock.round).toBe('flak');
    gun.fillRow(row, 'LMB', '1');
    expect(row.name).toBe('LMB 30MM FLAK // 1');

    gun.update(DT, makeUpdateCtx(h, { cyclePressed: true, side: 'left' }));
    expect(gun.clock.round).toBe('g40');

    expect(h.callouts).toEqual([
      'LEFT 30MM // AP',
      'LEFT 30MM // FLAK',
      'LEFT 30MM // HE',
    ]);
  });

  it('runs independently on left (key 1) and right (key 2) arms via FrameGuns', () => {
    const h = makeHarness();
    const guns = new FrameGuns(h.ctx, h.rounds, h.arm, h.arm, out => out.set(1, 5, 0));
    guns.fitArms('vulcan30', 'vulcan30');

    expect(guns.rows[0]!.name).toBe('LMB 30MM HE // 1');
    expect(guns.rows[1]!.name).toBe('RMB 30MM HE // 2');

    // Tap 1 cycles ONLY left arm.
    h.pressed.add('weapon1');
    guns.update(DT, h.sight);
    h.pressed.clear();
    expect(guns.rows[0]!.name).toBe('LMB 30MM AP // 1');
    expect(guns.rows[1]!.name).toBe('RMB 30MM HE // 2');
    expect(h.callouts).toContain('LEFT 30MM // AP');

    // Tap 2 twice cycles ONLY right arm to FLAK.
    h.pressed.add('weapon2');
    guns.update(DT, h.sight);
    guns.update(DT, h.sight);
    h.pressed.clear();
    expect(guns.rows[0]!.name).toBe('LMB 30MM AP // 1');
    expect(guns.rows[1]!.name).toBe('RMB 30MM FLAK // 2');
    expect(h.callouts).toContain('RIGHT 30MM // FLAK');

    // Tap R ignores both arms.
    h.pressed.add('reload');
    guns.update(DT, h.sight);
    h.pressed.clear();
    expect(guns.rows[0]!.name).toBe('LMB 30MM AP // 1');
    expect(guns.rows[1]!.name).toBe('RMB 30MM FLAK // 2');
  });

  it('reports heat 0..1 and vent reload progress in HUD row during overheat', () => {
    const h = makeHarness();
    const gun = new Vulcan30ArmGun(h.ctx);
    const row: GunnerWeapon = { name: '', ammo: 0, max: 0, reload: -1 };

    // Drive into overheat.
    for (let i = 0; i < 400 && !gun.clock.heat.overheated; i++) {
      gun.update(DT, makeUpdateCtx(h, { held: true }));
    }
    expect(gun.clock.heat.overheated).toBe(true);
    expect(gun.heat).toBeGreaterThan(0.9);
    expect(h.sounds.some(s => s.id === 'steam_burst')).toBe(true);

    // Step partway through vent.
    for (let i = 0; i < 60; i++) gun.update(DT, makeUpdateCtx(h, { held: false }));
    gun.fillRow(row, 'LMB', '1');
    expect(row.reload).toBeGreaterThan(0.2);
    expect(row.reload).toBeLessThan(0.8);
    expect(row.ammo).toBeGreaterThan(0);
    expect(row.ammo).toBeLessThan(100);
  });
});

describe('Vulcan30ArmGun round mechanics (HE / AP / FLAK) & zero spread', () => {
  function spinUpAndFireOne(h: MockHarness, gun: Vulcan30ArmGun, overrides: Partial<ArmUpdateContext> = {}): void {
    h.shots.length = 0;
    h.explosions.length = 0;
    h.tracers.length = 0;
    h.news.length = 0;
    for (let i = 0; i < 30 && h.news.length === 0; i++) {
      gun.update(DT, makeUpdateCtx(h, { held: true, ...overrides }));
    }
  }

  it('HE fires straight down the crosshair (zero spread) with 60% radius and 45% damage of 40 mm HE', () => {
    const h = makeHarness();
    h.sight.aim.set(0.2, -0.1, -0.9746794).normalize();
    const gun = new Vulcan30ArmGun(h.ctx);

    spinUpAndFireOne(h, gun);
    expect(h.shots.length).toBe(1);
    expect(h.shots[0]!.dir.dot(h.sight.aim)).toBeCloseTo(1, 6);
    expect(h.shots[0]!.spec.tracer).toBe('hellfire');

    expect(h.explosions.length).toBe(1);
    expect(h.explosions[0]!.spec.radius).toBeCloseTo(B.he.radius * 0.6, 4);
    expect(h.explosions[0]!.spec.damage).toBeCloseTo(B.he.damage * 0.45, 4);
    expect(h.turns.some(rad => rad > 0)).toBe(true);
    expect(h.recoils.length).toBeGreaterThan(0);
    expect(h.trauma).toBeGreaterThan(0);
    expect(h.kicks).toBeGreaterThan(0);
  });

  it('AP fires straight down the crosshair (zero spread) with penetrate=2, bodyCost=1, armorPiercing, and no HE blast', () => {
    const h = makeHarness();
    h.sight.aim.set(-0.15, 0.05, -0.98742088).normalize();
    const gun = new Vulcan30ArmGun(h.ctx);
    gun.clock.cycle(); // HE -> AP

    spinUpAndFireOne(h, gun, { recoilMult: 0 });
    expect(h.shots.length).toBe(1);
    const shot = h.shots[0]!;
    expect(shot.dir.dot(h.sight.aim)).toBeCloseTo(1, 6);
    expect(shot.spec.penetrate).toBe(2);
    expect(shot.spec.bodyCost).toBe(1);
    expect(shot.spec.armorPiercing).toBe(true);
    expect(shot.spec.damage).toBe(VULCAN30.ap.damage);
    expect(shot.spec.tracer).toBe('ap');
    expect(h.explosions.length).toBe(0);
    // recoilMult = 0 (Spider Legs) suppresses camera kick/trauma while preserving arm barrel recoil.
    expect(h.trauma).toBe(0);
    expect(h.kicks).toBe(0);
    expect(h.recoils.length).toBeGreaterThan(0);
  });

  it('FLAK proximity-detonates ahead of enemies and fires 60% of 40 mm flak pellets', () => {
    const h = makeHarness();
    h.setWallDistance(null);
    h.setEnemies([[0, 5.2, -25]]);
    const gun = new Vulcan30ArmGun(h.ctx);
    gun.clock.cycle(); // HE -> AP
    gun.clock.cycle(); // AP -> FLAK

    spinUpAndFireOne(h, gun);
    // Proximity burst ahead of enemy at z = -25 (origin at z = 0, dir = -Z).
    expect(h.explosions.length).toBe(1);
    expect(h.explosions[0]!.at.z).toBeGreaterThan(-25);
    expect(h.explosions[0]!.at.z).toBeLessThan(-20);
    // 60% of 40 mm flak pellets = Math.round(14 * 0.6) = 8 pellets.
    const expectedPellets = Math.round(B.flak.pellets * 0.6);
    expect(h.shots.length).toBe(expectedPellets);
    for (const s of h.shots) {
      expect(s.spec.type).toBe('pellet');
      expect(s.origin.distanceTo(h.explosions[0]!.at)).toBeLessThan(0.01);
    }
  });
});

describe('Vulcan30ArmGun silence, reset, and co-op remote playback', () => {
  it('silence() stops all active loops cleanly and reset() restores full ready state', () => {
    const h = makeHarness();
    const gun = new Vulcan30ArmGun(h.ctx);
    gun.clock.cycle(); // AP
    for (let i = 0; i < 40; i++) gun.update(DT, makeUpdateCtx(h, { held: true }));
    expect(h.loops.length).toBeGreaterThanOrEqual(2);
    expect(gun.heat).toBeGreaterThan(0);

    gun.silence();
    expect(h.loops.every(l => l.stopped)).toBe(true);
    expect(() => gun.silence()).not.toThrow();

    gun.reset();
    expect(gun.heat).toBe(0);
    expect(gun.firing).toBe(false);
    expect(gun.clock.spin).toBe(0);
    expect(gun.clock.round).toBe('g40');
    expect(gun.clock.heat.overheated).toBe(false);
  });

  it('emits vulcan30 co-op news and plays back remoteFiring & remoteNews for HE, AP, and FLAK without throwing', () => {
    const h = makeHarness();
    const gun = new Vulcan30ArmGun(h.ctx);
    for (let i = 0; i < 30 && h.news.length === 0; i++) {
      gun.update(DT, makeUpdateCtx(h, { held: true }));
    }
    expect(h.news.length).toBeGreaterThanOrEqual(1);
    expect(h.news[0]!.kind).toBe('vulcan30');
    expect(h.news[0]!.values.length).toBe(8);
    expect(h.news[0]!.values[0]).toBe(0); // HE

    // Remote continuous firing playback.
    const remoteHarness = makeHarness();
    const state: ArmRemoteState = { accum: 0, fired: 0 };
    expect(() => {
      for (let i = 0; i < 20; i++) {
        VULCAN30_PLUGIN.remoteFiring?.(remoteHarness.ctx, remoteHarness.arm, 'left', DT, state);
      }
    }).not.toThrow();
    expect(remoteHarness.turns.length).toBe(20);
    expect(remoteHarness.recoils.length).toBeGreaterThan(0);
    expect(remoteHarness.flashes).toBeGreaterThan(0);
    expect(remoteHarness.tracers.length).toBeGreaterThan(0);

    // Remote news playback for HE (0), AP (1), FLAK (2), non-burst sky shot, and malformed packets.
    const newsHarness = makeHarness();
    expect(() => {
      VULCAN30_PLUGIN.remoteNews?.(newsHarness.ctx, 'vulcan30', [0, -1, 4, -4, 0, 2, -30, 1]);
      VULCAN30_PLUGIN.remoteNews?.(newsHarness.ctx, 'vulcan30', [1, -1, 4, -4, 0, 2, -45, 1]);
      VULCAN30_PLUGIN.remoteNews?.(newsHarness.ctx, 'vulcan30', [2, -1, 4, -4, 0, 2, -25, 1]);
      VULCAN30_PLUGIN.remoteNews?.(newsHarness.ctx, 'vulcan30', [0, -1, 4, -4, 0, 80, -400, 0]);
      // Wrong kind / truncated payloads ignored safely.
      VULCAN30_PLUGIN.remoteNews?.(newsHarness.ctx, 'beam', [0, 1, 2, 3, 4, 5, 6]);
      VULCAN30_PLUGIN.remoteNews?.(newsHarness.ctx, 'vulcan30', [0, 1, 2]);
    }).not.toThrow();

    expect(newsHarness.tracers.some(t => t.kind === 'hellfire')).toBe(true);
    expect(newsHarness.tracers.some(t => t.kind === 'ap')).toBe(true);
    expect(newsHarness.tracers.some(t => t.kind === 'api')).toBe(true);
    expect(newsHarness.fxExplosions.length).toBe(2); // HE + FLAK bursts (not AP, not sky shot)
  });
});

describe('VULCAN30_ARM 3D model', () => {
  it('builds fixed receiver and moving 3-barrel cluster with valid geometry and forward muzzle', () => {
    const fixed = new ModelBuilder();
    VULCAN30_ARM.build(fixed);
    const moving = new ModelBuilder();
    VULCAN30_ARM.moving(moving);

    const fixedSolid = fixed.solidGeometry();
    const fixedGlow = fixed.glowGeometry();
    const movingSolid = moving.solidGeometry();
    const movingGlow = moving.glowGeometry();

    expect(fixedSolid).not.toBeNull();
    expect(fixedSolid!.getAttribute('position').count).toBeGreaterThan(200);
    expect(fixedGlow).not.toBeNull();
    expect(movingSolid).not.toBeNull();
    expect(movingSolid!.getAttribute('position').count).toBeGreaterThan(400);
    expect(movingGlow).not.toBeNull();
    for (const geo of [fixedSolid!, fixedGlow!, movingSolid!, movingGlow!]) {
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getX(i))).toBe(true);
        expect(Number.isFinite(pos.getY(i))).toBe(true);
        expect(Number.isFinite(pos.getZ(i))).toBe(true);
      }
      geo.computeBoundingBox();
      expect(geo.boundingBox).not.toBeNull();
    }
    // Moving barrel assembly extends forward toward the muzzle along -Z.
    expect(movingSolid!.boundingBox!.min.z).toBeLessThan(-2.8);
    expect(VULCAN30_ARM.muzzle[2]).toBeLessThan(-2.5);
    expect(VULCAN30_ARM.follow).toBeGreaterThan(0);
    expect(VULCAN30_ARM.return).toBeGreaterThan(0);
  });
});
