/**
 * Unit tests for Distraint Frame v2 Ranged Arm Weapons:
 *   - Heavy Incinerator (`flamer.ts` + `models/flamer.ts`)
 *   - Plasma Scatter Rifle (`plasma.ts` + `models/plasma.ts`)
 *   - Linear Rail Rifle (`rail.ts` + `models/rail.ts`)
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx, DamageInfo, LoopHandle, RayHit } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import type { Ac130Rounds } from '../../progression/callins/ac130Rounds';
import type { MechKind } from '../../progression/callins/link';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import type { GunSpec } from '../../vehicles/guns';
import type { GunnerWeapon } from '../../vehicles/hud';
import type { Raycaster } from '../../weapons/penetration';
import { BUREAU_PALETTE } from '../models/palette';
import { FLAMER_ARM } from '../models/flamer';
import { PLASMA_ARM } from '../models/plasma';
import { RAIL_ARM } from '../models/rail';
import { FLAMER, FLAMER_PLUGIN, FlamerArmGun } from './flamer';
import { PLASMA, PLASMA_PLUGIN, PlasmaArmGun } from './plasma';
import { RAIL, RAIL_PLUGIN, RailArmGun, traceRailShot } from './rail';
import type { Arm, ArmUpdateContext, Sight } from './types';

const DT = 1 / 60;

function makeEnemy(uid: number, x: number, z: number, opts?: { health?: number; isBoss?: boolean; y?: number }): EnemyInstance {
  const y = opts?.y ?? 0;
  return {
    uid,
    id: opts?.isBoss ? 'titan' : 'trooper',
    alive: true,
    isBoss: opts?.isBoss ?? false,
    health: opts?.health ?? 2000,
    maxHealth: opts?.health ?? 2000,
    armor: 0,
    position: new THREE.Vector3(x, y, z),
    center: new THREE.Vector3(x, y + 1.2, z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    score: 100,
    frozen: 0,
    burning: 0,
    machine: false,
  } as unknown as EnemyInstance;
}

/** Raycaster with solid slabs perpendicular to -Z occupying `[wz - thickness, wz]`. */
function makeWallRaycaster(wallZs: readonly number[], thickness = 0): Raycaster & {
  raycastInto: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, mask: number, out: RayHit) => boolean;
} {
  const raycast = (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null => {
    if (Math.abs(dir.z) < 1e-6) return null;
    let bestDist = Infinity;
    let bestZ = 0;
    let bestNormalZ = 1;
    for (const wz of wallZs) {
      if (thickness > 0) {
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
  };

  return {
    raycast,
    raycastInto(origin, dir, maxDist, _mask, out) {
      const h = raycast(origin, dir, maxDist);
      if (!h) return false;
      out.point.copy(h.point);
      out.normal.copy(h.normal);
      out.distance = h.distance;
      out.surface = h.surface;
      out.collider = h.collider;
      return true;
    },
  };
}

interface Harness {
  ctx: Ctx;
  damages: { enemy: EnemyInstance; info: DamageInfo }[];
  afflictions: { enemy: EnemyInstance; kind: string; seconds: number }[];
  loops: { id: string; stopped: boolean; pitch: number; volume: number }[];
  played: string[];
  napalmBursts: { center: THREE.Vector3; velocity: THREE.Vector3; source: string; radius: number }[];
  arcs: { from: THREE.Vector3; to: THREE.Vector3 }[];
  vaporRings: number;
  rings: number;
  flames: number;
  smokes: number;
  tracers: number;
  beams: number;
  recoils: number[];
  traumas: number[];
  activeStates: { amount: number; mode: number | undefined }[];
  news: { kind: MechKind; values: number[] }[];
  makeUpdate: (overrides?: Partial<ArmUpdateContext>) => ArmUpdateContext;
}

function makeHarness(opts?: {
  enemies?: EnemyInstance[];
  raycaster?: ReturnType<typeof makeWallRaycaster>;
  muzzlePos?: THREE.Vector3;
  aimDir?: THREE.Vector3;
}): Harness {
  const enemies = opts?.enemies ?? [];
  const raycaster = opts?.raycaster ?? makeWallRaycaster([]);
  const muzzlePos = opts?.muzzlePos ?? new THREE.Vector3(0, 1.2, 0);
  const aimDir = (opts?.aimDir ?? new THREE.Vector3(0, 0, -1)).clone().normalize();

  const damages: Harness['damages'] = [];
  const afflictions: Harness['afflictions'] = [];
  const loops: Harness['loops'] = [];
  const played: string[] = [];
  const napalmBursts: Harness['napalmBursts'] = [];
  const arcs: Harness['arcs'] = [];
  const recoils: number[] = [];
  const traumas: number[] = [];
  const activeStates: Harness['activeStates'] = [];
  const news: Harness['news'] = [];

  const harness: Harness = {
    ctx: null as unknown as Ctx,
    damages,
    afflictions,
    loops,
    played,
    napalmBursts,
    arcs,
    vaporRings: 0,
    rings: 0,
    flames: 0,
    smokes: 0,
    tracers: 0,
    beams: 0,
    recoils,
    traumas,
    activeStates,
    news,
    makeUpdate: () => null as unknown as ArmUpdateContext,
  };

  const ctx = {
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
      addTrauma: (t: number) => { traumas.push(t); },
      kick: () => undefined,
      fovPunch: () => undefined,
    },
    hud: {
      hitMarker: () => undefined,
    },
    combat: {
      napalmBurst: (center: THREE.Vector3, velocity: THREE.Vector3, source: string, radius: number) => {
        napalmBursts.push({ center: center.clone(), velocity: velocity.clone(), source, radius });
      },
    },
    physics: {
      raycast: raycaster.raycast,
      raycastInto: raycaster.raycastInto,
    },
    enemies: {
      alive: enemies,
      query: (center: THREE.Vector3, radius: number, out: EnemyInstance[]) => {
        out.length = 0;
        const r2 = (radius + 1) * (radius + 1);
        for (const e of enemies) {
          if (!e.alive) continue;
          if (e.center.distanceToSquared(center) <= r2) out.push(e);
        }
        return out.length;
      },
      applyDamage: (enemy: EnemyInstance, info: DamageInfo) => {
        damages.push({
          enemy,
          info: { ...info, point: info.point.clone(), dir: info.dir.clone() },
        });
        enemy.health -= info.amount;
        const killed = enemy.health <= 0;
        if (killed) enemy.alive = false;
        return { killed, damage: info.amount };
      },
      afflict: (enemy: EnemyInstance, kind: string, seconds: number) => {
        afflictions.push({ enemy, kind, seconds });
      },
    },
    fx: {
      muzzleFlash: () => undefined,
      tracer: () => { harness.tracers++; },
      impact: () => undefined,
      ring: () => { harness.rings++; },
      vaporRing: () => { harness.vaporRings++; },
      sparks: () => undefined,
      smoke: () => { harness.smokes++; },
      beam: () => { harness.beams++; },
      arc: (from: THREE.Vector3, to: THREE.Vector3) => { arcs.push({ from: from.clone(), to: to.clone() }); },
      flame: () => { harness.flames++; },
      embers: () => undefined,
      napalmSplash: () => undefined,
    },
    render: {
      lights: { flash: () => undefined },
    },
    world: {
      nav: { groundHeight: () => 0 },
      objects: { damageExplosivesInRadius: () => undefined },
    },
  } as unknown as Ctx;

  const arm: Arm = {
    muzzle: out => out.copy(muzzlePos),
    bore: out => out.copy(aimDir),
    turn: () => undefined,
    recoil: m => { recoils.push(m); },
    setActive: (amount, mode) => { activeStates.push({ amount, mode }); },
  };

  const sight: Sight = {
    view: { position: muzzlePos.clone(), yaw: 0, pitch: 0, roll: 0, shake: 0 },
    aim: aimDir.clone(),
    point: muzzlePos.clone().addScaledVector(aimDir, 80),
    range: 80,
  };

  harness.ctx = ctx;
  harness.makeUpdate = (overrides?: Partial<ArmUpdateContext>): ArmUpdateContext => ({
    ctx,
    rounds: { flash: () => undefined } as unknown as Ac130Rounds,
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
    energyMult: 1,
    feet: new THREE.Vector3(0, 0, 0),
    torsoYaw: 0,
    onShell: null,
    onNews: (kind, values) => { news.push({ kind, values: [...values] }); },
    ...overrides,
  });

  return harness;
}

function emptyRow(): GunnerWeapon {
  return { name: '', ammo: 0, max: 0, reload: -1, selected: false };
}

function assertFiniteGeometry(geo: THREE.BufferGeometry | null, label: string): number {
  expect(geo, `${label} geometry should exist`).not.toBeNull();
  const pos = geo!.getAttribute('position');
  expect(pos.count, `${label} should have vertices`).toBeGreaterThan(0);
  for (let i = 0; i < pos.count; i++) {
    expect(Number.isFinite(pos.getX(i)), `${label} X finite`).toBe(true);
    expect(Number.isFinite(pos.getY(i)), `${label} Y finite`).toBe(true);
    expect(Number.isFinite(pos.getZ(i)), `${label} Z finite`).toBe(true);
  }
  return pos.count;
}

// =============================================================================================
// 1. Heavy Incinerator (`flamer`)
// =============================================================================================

describe('Heavy Incinerator (flamer)', () => {
  it('burns continuously at 145 DPS in STREAM mode, consumes 18 fuel/s, plays flame_loop, and drops napalm pools every 0.45 s', () => {
    const target = makeEnemy(1, 0, -22, { health: 2000 }); // 22 m (within 26 m STREAM reach)
    const h = makeHarness({ enemies: [target] });
    const gun = FLAMER_PLUGIN.create(h.ctx) as FlamerArmGun;

    // Spray for 1.0 s (60 frames).
    for (let i = 0; i < 60; i++) {
      gun.update(DT, h.makeUpdate({ held: true, pressed: i === 0 }));
    }

    expect(gun.firing).toBe(true);
    expect(gun.clock.fuel).toBeCloseTo(100 - FLAMER.burnRate * 1.0, 1);
    expect(h.loops.some(l => l.id === 'flame_loop' && !l.stopped)).toBe(true);
    expect(h.flames).toBeGreaterThan(60);
    expect(h.smokes).toBeGreaterThan(0);
    expect(h.activeStates.at(-1)?.amount).toBe(1);

    // 145 DPS over 1.0 s + initial ignite tick -> target took ~145..160 dmg and was set on fire.
    const totalDmg = h.damages.reduce((s, d) => s + d.info.amount, 0);
    expect(totalDmg).toBeGreaterThanOrEqual(140);
    expect(totalDmg).toBeLessThanOrEqual(165);
    expect(h.afflictions.some(a => a.enemy === target && a.kind === 'burn')).toBe(true);

    // Napalm pools laid every 0.45 s -> at 0.45 s and 0.90 s = 2 calls in 1.0 s!
    expect(h.napalmBursts.length).toBe(2);
    expect(h.napalmBursts[0]!.source).toBe('frame_flamer');

    // Release trigger: loop stops and pilot igniter drops to 0.2 idle glow.
    gun.update(DT, h.makeUpdate({ held: false }));
    expect(gun.firing).toBe(false);
    expect(h.loops[0]!.stopped).toBe(true);
    expect(h.activeStates.at(-1)?.amount).toBe(0.2);
  });

  it('reloads in 2.6 s automatically when fuel runs dry and on manual R', () => {
    const h = makeHarness();
    const gun = FLAMER_PLUGIN.create(h.ctx) as FlamerArmGun;

    // Burn 2 s (36 fuel spent -> 64 remaining), then press manual R.
    for (let i = 0; i < 120; i++) gun.update(DT, h.makeUpdate({ held: true }));
    expect(gun.clock.fuel).toBeCloseTo(64, 1);

    gun.update(DT, h.makeUpdate({ reloadPressed: true }));
    expect(gun.clock.reloading).toBe(true);
    expect(gun.clock.fuel).toBe(0);

    // Advance 2.65 s -> fully refilled to 100.
    for (let i = 0; i < 160; i++) gun.update(DT, h.makeUpdate());
    expect(gun.clock.reloading).toBe(false);
    expect(gun.clock.fuel).toBe(100);

    // Now burn the full 100-unit tank (~5.56 s at 18/s) to trigger automatic empty reload.
    for (let i = 0; i < 340; i++) gun.update(DT, h.makeUpdate({ held: true }));
    expect(gun.clock.reloading).toBe(true);
    expect(gun.firing).toBe(false);
  });

  it('toggles STREAM vs WIDE via cyclePressed and WIDE sweeps a 40° 15 m deluge at 115 DPS', () => {
    // Wide-angle swarm target at 11 m forward, 3.2 m right (~16° off axis -> outside STREAM 7° half-angle, inside WIDE 20° half-angle).
    const flanker = makeEnemy(2, 3.2, -11, { health: 2000 });
    const farTarget = makeEnemy(3, 0, -22, { health: 2000 }); // outside WIDE 15 m reach
    const h = makeHarness({ enemies: [flanker, farTarget] });
    const gun = FLAMER_PLUGIN.create(h.ctx) as FlamerArmGun;

    // Toggle STREAM -> WIDE.
    gun.update(DT, h.makeUpdate({ cyclePressed: true }));
    expect(gun.clock.mode).toBe('wide');
    const row = emptyRow();
    gun.fillRow(row, 'RMB', '2');
    expect(row.name).toContain('WIDE');

    // Spray for 1.0 s in WIDE mode.
    for (let i = 0; i < 60; i++) {
      gun.update(DT, h.makeUpdate({ held: true, pressed: i === 0 }));
    }

    const flankerDmg = h.damages.filter(d => d.enemy === flanker).reduce((s, d) => s + d.info.amount, 0);
    const farDmg = h.damages.filter(d => d.enemy === farTarget).reduce((s, d) => s + d.info.amount, 0);
    expect(flankerDmg).toBeGreaterThanOrEqual(110);
    expect(flankerDmg).toBeLessThanOrEqual(130);
    expect(farDmg).toBe(0);
  });
});

// =============================================================================================
// 2. Plasma Scatter Rifle (`plasma`)
// =============================================================================================

describe('Plasma Scatter Rifle (plasma)', () => {
  it('fires a 58 m/s tap orb (120 * energyMult dmg) that spawns a lingering 4.8 m dome dealing 85 * energyMult DPS for 2.2 s', () => {
    const target = makeEnemy(10, 0, -14, { health: 2000 });
    const bystander = makeEnemy(11, 3.8, -14, { health: 2000 }); // 3.8 m from impact (outside 2.6 m burst, inside 4.8 m dome!)
    const h = makeHarness({ enemies: [target, bystander] });
    const gun = PLASMA_PLUGIN.create(h.ctx) as PlasmaArmGun;

    // Tap fire with energyMult = 1.25.
    gun.update(DT, h.makeUpdate({ pressed: true, held: false, energyMult: 1.25 }));
    expect(gun.clock.cells).toBe(15);
    expect(gun.activeOrbCount).toBe(1);

    // Step 0.35 s so the 58 m/s orb covers 14 m (~0.24 s) and detonates on target.
    for (let i = 0; i < 21; i++) {
      gun.update(DT, h.makeUpdate({ energyMult: 1.25 }));
    }
    expect(gun.activeOrbCount).toBe(0);
    expect(gun.activeDomeCount).toBe(1);

    // Direct impact damage = 120 * 1.25 = 150 on target.
    const impactHits = h.damages.filter(d => d.enemy === target && d.info.source === 'frame_plasma');
    expect(impactHits.length).toBe(1);
    expect(impactHits[0]!.info.amount).toBeCloseTo(150, 2);

    // Step another 2.4 s so the lingering 2.2 s plasma dome runs to full completion and expires.
    for (let i = 0; i < 145; i++) {
      gun.update(DT, h.makeUpdate({ energyMult: 1.25 }));
    }
    expect(gun.activeDomeCount).toBe(0);

    // Dome dealt 85 * 1.25 = 106.25 DPS over 2.2 s (~233.75 total) to BOTH target and bystander!
    const bystanderDomeDmg = h.damages
      .filter(d => d.enemy === bystander && d.info.source === 'frame_plasma_dome')
      .reduce((s, d) => s + d.info.amount, 0);
    expect(bystanderDomeDmg).toBeCloseTo(85 * 1.25 * 2.2, 0);
    expect(h.rings).toBeGreaterThan(5);
    expect(h.tracers).toBeGreaterThan(5);
  });

  it('charges in 0.65 s and releases a 3-orb horizontal fan (-8°, 0°, +8°) consuming 3 cells and spawning 3 domes', () => {
    // Wall at z = -20 catches all 3 spread orbs simultaneously.
    const h = makeHarness({ raycaster: makeWallRaycaster([-20], 0.5) });
    const gun = PLASMA_PLUGIN.create(h.ctx) as PlasmaArmGun;

    // Hold trigger for 0.7 s (42 frames >= 0.65 s).
    for (let i = 0; i < 42; i++) {
      gun.update(DT, h.makeUpdate({ held: true, pressed: i === 0 }));
    }
    expect(gun.clock.charge).toBe(1);
    expect(h.activeStates.at(-1)?.amount).toBeCloseTo(1, 2);

    // Release -> launches 3 orbs in horizontal fan, consumes 3 cells (16 -> 13).
    gun.update(DT, h.makeUpdate({ held: false }));
    expect(gun.clock.cells).toBe(13);
    expect(gun.activeOrbCount).toBe(3);

    // Verify horizontal fan directions diverge cleanly along X (-8°, 0°, +8°).
    const activeOrbs = gun.orbs.filter(o => o.active);
    const vxValues = activeOrbs.map(o => o.vel.x).sort((a, b) => a - b);
    expect(vxValues[0]!).toBeLessThan(-6);
    expect(Math.abs(vxValues[1]!)).toBeLessThan(0.5);
    expect(vxValues[2]!).toBeGreaterThan(6);
    expect(activeOrbs[0]!.impactDamage).toBeCloseTo(PLASMA.chargedImpactDamage, 2);

    // Step 0.5 s until all 3 orbs hit the wall at z = -20 and expand into 3 plasma domes.
    for (let i = 0; i < 30; i++) gun.update(DT, h.makeUpdate());
    expect(gun.activeOrbCount).toBe(0);
    expect(gun.activeDomeCount).toBe(3);

    // Manual reload takes 2.2 s.
    gun.update(DT, h.makeUpdate({ reloadPressed: true }));
    expect(gun.clock.reloading).toBe(true);
    for (let i = 0; i < 135; i++) gun.update(DT, h.makeUpdate());
    expect(gun.clock.reloading).toBe(false);
    expect(gun.clock.cells).toBe(PLASMA.cells);
  });
});

// =============================================================================================
// 3. Linear Rail Rifle (`rail`)
// =============================================================================================

describe('Linear Rail Rifle (rail)', () => {
  it('tap fires 220 dmg slugs (severMult 2.0) piercing up to 3 enemies in a line in SABOT mode with 0.55 s cadence', () => {
    const e1 = makeEnemy(21, 0, -10, { health: 1000 });
    const e2 = makeEnemy(22, 0, -18, { health: 1000 });
    const e3 = makeEnemy(23, 0, -26, { health: 1000 });
    const e4 = makeEnemy(24, 0, -34, { health: 1000 }); // 4th enemy in line should NOT be pierced by tap shot
    const h = makeHarness({ enemies: [e4, e2, e1, e3] });
    const gun = RAIL_PLUGIN.create(h.ctx) as RailArmGun;

    gun.update(DT, h.makeUpdate({ pressed: true, held: false }));
    expect(gun.clock.rounds).toBe(9);
    expect(h.damages.map(d => d.enemy.uid)).toEqual([21, 22, 23]);
    for (const d of h.damages) {
      expect(d.info.amount).toBe(220);
      expect(d.info.severMult).toBe(2.0);
    }
    expect(h.beams).toBe(1);
    expect(h.rings).toBeGreaterThanOrEqual(3);

    // Immediate tap inside 0.55 s cadence does not fire.
    gun.update(DT, h.makeUpdate({ pressed: true, held: false }));
    expect(gun.clock.rounds).toBe(9);

    // Wait 0.56 s -> ready again.
    for (let i = 0; i < 34; i++) gun.update(DT, h.makeUpdate());
    gun.update(DT, h.makeUpdate({ pressed: true, held: false }));
    expect(gun.clock.rounds).toBe(8);
  });

  it('charges in 0.9 s (0.75x walk speed at full), fires 620+ dmg Hyper-Piercing Sabot through 4.0 m cover & all enemies', () => {
    // 3.5 m solid wall occupying z in [-18.5, -15]; 4 enemies behind it!
    const wallRaycaster = makeWallRaycaster([-15], 3.5);
    const enemies = [
      makeEnemy(31, 0, -8, { health: 2000 }),
      makeEnemy(32, 0, -24, { health: 2000 }),
      makeEnemy(33, 0, -32, { health: 2000 }),
      makeEnemy(34, 0, -40, { health: 2000 }),
      makeEnemy(35, 0, -48, { health: 2000 }),
    ];
    const h = makeHarness({ enemies, raycaster: wallRaycaster });
    const gun = RAIL_PLUGIN.create(h.ctx) as RailArmGun;

    // Hold for 0.95 s (57 frames >= 0.9 s).
    for (let i = 0; i < 57; i++) {
      gun.update(DT, h.makeUpdate({ held: true, pressed: i === 0, energyMult: 1.1 }));
    }
    expect(gun.clock.holdingFull).toBe(true);
    expect(gun.walkSpeedMult).toBe(0.75);

    // Release -> Hyper-Piercing Sabot penetrates the 3.5 m wall and strikes ALL 5 enemies!
    gun.update(DT, h.makeUpdate({ held: false, energyMult: 1.1 }));
    expect(gun.walkSpeedMult).toBe(1);
    expect(h.damages.length).toBe(5);
    for (const d of h.damages) {
      expect(d.info.amount).toBeCloseTo(620 * 1.1, 2);
      expect(d.info.amount).toBeGreaterThan(600);
    }
    expect(h.vaporRings).toBeGreaterThanOrEqual(6);
    expect(h.traumas.at(-1)).toBeCloseTo(0.45, 3);
    expect(h.recoils.at(-1)).toBeCloseTo(0.7, 3);

    // Verify 4.0 m exact wall is pierced, while 5.0 m bunker wall blocks traceRailShot.
    const exact4m = traceRailShot(makeWallRaycaster([-15], 4.0), new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, -1), true);
    expect(exact4m.piercedWall).toBe(true);
    expect(exact4m.reach).toBe(RAIL.range);

    const thick5m = traceRailShot(makeWallRaycaster([-15], 5.0), new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, -1), true);
    expect(thick5m.piercedWall).toBe(false);
    expect(thick5m.reach).toBeCloseTo(15, 1);
  });

  it('toggles SABOT vs ARC mode and chains 140 dmg shock to 2 nearby enemies on hit in ARC mode', () => {
    const primary = makeEnemy(41, 0, -15, { health: 1000 });
    const near1 = makeEnemy(42, 3.5, -16, { health: 1000 });
    const near2 = makeEnemy(43, -4.5, -14, { health: 1000 });
    const near3 = makeEnemy(44, 8.0, -16, { health: 1000 }); // 3rd nearby should NOT be chained (cap 2)
    const h = makeHarness({ enemies: [primary, near3, near2, near1] });
    const gun = RAIL_PLUGIN.create(h.ctx) as RailArmGun;

    // Toggle SABOT -> ARC via cyclePressed.
    gun.update(DT, h.makeUpdate({ cyclePressed: true }));
    expect(gun.clock.mode).toBe('arc');
    const row = emptyRow();
    gun.fillRow(row, 'RMB', '2');
    expect(row.name).toContain('ARC');

    // Tap fire hits primary (220) and chains 140 shock to the 2 nearest bystanders (42 & 43).
    gun.update(DT, h.makeUpdate({ pressed: true, held: false }));
    const primaryHit = h.damages.find(d => d.enemy.uid === 41);
    const arcHits = h.damages.filter(d => d.info.source === 'frame_rail_arc');
    expect(primaryHit?.info.amount).toBe(220);
    expect(arcHits.map(d => d.enemy.uid)).toEqual([42, 43]);
    for (const ah of arcHits) {
      expect(ah.info.amount).toBe(140);
      expect(ah.info.type).toBe('shock');
    }
    expect(h.arcs.length).toBe(2);

    // Reload takes 2.4 s.
    gun.update(DT, h.makeUpdate({ reloadPressed: true }));
    expect(gun.clock.reloading).toBe(true);
    for (let i = 0; i < 146; i++) gun.update(DT, h.makeUpdate());
    expect(gun.clock.reloading).toBe(false);
    expect(gun.clock.rounds).toBe(RAIL.rounds);
  });
});

// =============================================================================================
// 4. Sculpted 3D Models (`FLAMER_ARM`, `PLASMA_ARM`, `RAIL_ARM`)
// =============================================================================================

describe('v2 Ranged 3D Arm Models', () => {
  const models: readonly (readonly [string, GunSpec])[] = [
    ['FLAMER_ARM', FLAMER_ARM],
    ['PLASMA_ARM', PLASMA_ARM],
    ['RAIL_ARM', RAIL_ARM],
  ];

  it.each(models)('%s builds finite solid/moving/extra geometry with a forward muzzle', (label, spec) => {
    const fixed = new ModelBuilder();
    spec.build(fixed);
    const moving = new ModelBuilder();
    spec.moving(moving);

    const fixedVerts = assertFiniteGeometry(fixed.solidGeometry(), `${label}.fixed.solid`);
    const movingVerts = assertFiniteGeometry(moving.solidGeometry(), `${label}.moving.solid`);
    expect(fixedVerts).toBeGreaterThan(200);
    expect(movingVerts).toBeGreaterThan(150);

    // Glow geometries (if present) must also be finite.
    if (fixed.glowGeometry()) assertFiniteGeometry(fixed.glowGeometry(), `${label}.fixed.glow`);
    if (moving.glowGeometry()) assertFiniteGeometry(moving.glowGeometry(), `${label}.moving.glow`);

    // Muzzle must point forward along -Z.
    expect(spec.muzzle[2]).toBeLessThan(-2.0);
    expect(spec.follow).toBeGreaterThan(0);
    expect(spec.return).toBeGreaterThan(0);

    // Extra articulated glow/flame attachment builds cleanly and responds to setActive without NaN.
    expect(spec.extra).toBeTypeOf('function');
    const mockMats = {
      solid: new THREE.MeshStandardMaterial(),
      glow: new THREE.MeshBasicMaterial(),
      nearby: new THREE.MeshStandardMaterial(),
      group: vi.fn(),
    } as unknown as ModelMaterials;
    const extra = spec.extra!(mockMats, BUREAU_PALETTE);
    expect(extra.group.children.length).toBeGreaterThan(0);

    extra.setActive?.(0, 0);
    extra.setActive?.(0.5, 0);
    extra.setActive?.(1, 1);

    extra.group.traverse(obj => {
      const m = obj as THREE.Mesh;
      if (m.geometry) assertFiniteGeometry(m.geometry, `${label}.extra`);
      expect(Number.isFinite(obj.scale.x) && Number.isFinite(obj.scale.y) && Number.isFinite(obj.scale.z)).toBe(true);
    });
  });

  it('RAIL_ARM has an extended ~3.2 m barrel silhouette with forward muzzle past -3.8 m', () => {
    const moving = new ModelBuilder();
    RAIL_ARM.moving(moving);
    const geo = moving.solidGeometry()!;
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const lengthZ = box.max.z - box.min.z;
    expect(lengthZ).toBeGreaterThanOrEqual(3.1);
    expect(RAIL_ARM.muzzle[2]).toBeLessThan(-3.9);
  });
});
