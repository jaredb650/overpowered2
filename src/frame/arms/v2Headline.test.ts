/**
 * Unit tests for the Distraint Frame Overhaul v2 Headline Arm Weapons & 3D Models:
 *   1. 60 mm Dual-Mode Grenade Launcher (`grenade.ts` + `models/grenade.ts`)
 *   2. Plasma Energy Sword (`sword.ts` + `models/sword.ts`)
 *   3. Hydraulic Pile Bunker (`bunker.ts` + `models/bunker.ts`)
 *   4. Armored Energy Shield (`shield.ts` + `models/shield.ts`)
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx, DamageInfo, LoopHandle, RayHit } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec } from '../../core/gameplay';
import type { Ac130Rounds } from '../../progression/callins/ac130Rounds';
import type { MechKind } from '../../progression/callins/link';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import type { GunnerWeapon } from '../../vehicles/hud';
import { BUREAU_PALETTE } from '../models/palette';
import { GRENADE_ARM } from '../models/grenade';
import { SWORD_ARM } from '../models/sword';
import { BUNKER_ARM } from '../models/bunker';
import { SHIELD_ARM } from '../models/shield';
import { GRENADE_LAUNCHER, GRENADE_PLUGIN, GrenadeArmGun } from './grenade';
import { PLASMA_SWORD, SWORD_PLUGIN, SwordArmGun } from './sword';
import { BUNKER_PLUGIN, BunkerArmGun, PILE_BUNKER } from './bunker';
import { ENERGY_SHIELD, SHIELD_PLUGIN, ShieldArmGun } from './shield';
import type { Arm, ArmUpdateContext, Sight } from './types';

function makeEnemy(uid: number, x: number, z: number, opts?: { health?: number; y?: number }): EnemyInstance {
  const y = opts?.y ?? 0;
  return {
    uid,
    id: 'trooper',
    alive: true,
    isBoss: false,
    health: opts?.health ?? 200,
    maxHealth: opts?.health ?? 200,
    armor: 0,
    position: new THREE.Vector3(x, y, z),
    center: new THREE.Vector3(x, y + 1.4, z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    score: 100,
    frozen: 0,
    burning: 0,
    machine: false,
  } as unknown as EnemyInstance;
}

interface TestHarness {
  ctx: Ctx;
  damages: { enemy: EnemyInstance; info: DamageInfo }[];
  explosions: { pos: THREE.Vector3; spec: ExplosionSpec }[];
  napalms: { pos: THREE.Vector3; vel: THREE.Vector3; source: string; radius: number }[];
  radialImpulses: { pos: THREE.Vector3; radius: number; strength: number }[];
  vehicleBlows: { pos: THREE.Vector3; radius: number; damage: number; source: string }[];
  lunges: { dir: THREE.Vector3; speed: number; duration: number }[];
  turns: number[];
  recoils: number[];
  poses: { yaw: number; pitch: number; roll: number; extendZ?: number }[];
  actives: { amount: number; mode?: number }[];
  traumas: number[];
  played: string[];
  callouts: string[];
  news: { kind: MechKind; values: number[] }[];
  makeUpdate: (overrides?: Partial<ArmUpdateContext>) => ArmUpdateContext;
}

function makeHarness(opts?: {
  enemies?: EnemyInstance[];
  wallZ?: number;
  floorY?: number;
}): TestHarness {
  const enemiesList = opts?.enemies ?? [];
  const damages: TestHarness['damages'] = [];
  const explosions: TestHarness['explosions'] = [];
  const napalms: TestHarness['napalms'] = [];
  const radialImpulses: TestHarness['radialImpulses'] = [];
  const vehicleBlows: TestHarness['vehicleBlows'] = [];
  const lunges: TestHarness['lunges'] = [];
  const turns: number[] = [];
  const recoils: number[] = [];
  const poses: TestHarness['poses'] = [];
  const actives: TestHarness['actives'] = [];
  const traumas: number[] = [];
  const played: string[] = [];
  const callouts: string[] = [];
  const news: TestHarness['news'] = [];

  const raycastWorld = (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null => {
    let bestT = Infinity;
    let bestNormal = new THREE.Vector3(0, 1, 0);

    if (opts?.wallZ !== undefined && Math.abs(dir.z) > 1e-6) {
      const t = (opts.wallZ - origin.z) / dir.z;
      if (t >= 0 && t <= maxDist && t < bestT) {
        bestT = t;
        bestNormal = new THREE.Vector3(0, 0, dir.z < 0 ? 1 : -1);
      }
    }
    if (opts?.floorY !== undefined && dir.y < -1e-6) {
      const t = (opts.floorY - origin.y) / dir.y;
      if (t >= 0 && t <= maxDist && t < bestT) {
        bestT = t;
        bestNormal = new THREE.Vector3(0, 1, 0);
      }
    }
    if (bestT === Infinity) return null;
    return {
      point: origin.clone().addScaledVector(dir, bestT),
      normal: bestNormal,
      distance: bestT,
      surface: 'concrete',
      collider: null,
    };
  };

  const ctx = {
    audio: {
      play: (id: string) => { played.push(id); },
      startLoop: () => {
        let alive = true;
        const handle: LoopHandle = {
          get alive() { return alive; },
          stop: () => { alive = false; },
          setPitch: () => undefined,
          setVolume: () => undefined,
          setPosition: () => undefined,
        };
        return handle;
      },
    },
    camera: {
      addTrauma: (a: number) => { traumas.push(a); },
      kick: () => undefined,
      fovPunch: () => undefined,
    },
    hud: {
      hitMarker: () => undefined,
      callout: (msg: string) => { callouts.push(msg); },
    },
    fx: {
      muzzleFlash: () => undefined,
      tracer: () => undefined,
      explosion: () => undefined,
      ring: () => undefined,
      sparks: () => undefined,
      smoke: () => undefined,
      chips: () => undefined,
      slash: () => undefined,
      beam: () => undefined,
      flame: () => undefined,
      embers: () => undefined,
      slam: () => undefined,
      dashStreaks: () => undefined,
      heatShimmer: () => undefined,
    },
    render: {
      scene: new THREE.Scene(),
      lights: { flash: () => undefined },
      decals: { add: () => undefined },
      post: { radialBlur: () => undefined, chromatic: () => undefined, flash: () => undefined },
    },
    physics: {
      raycast: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => raycastWorld(origin, dir, maxDist),
      raycastInto: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, _mask: number, out: RayHit) => {
        const hit = raycastWorld(origin, dir, maxDist);
        if (!hit) return false;
        out.point.copy(hit.point);
        out.normal.copy(hit.normal);
        out.distance = hit.distance;
        out.surface = hit.surface;
        out.collider = hit.collider;
        return true;
      },
      radialImpulse: (pos: THREE.Vector3, radius: number, strength: number) => {
        radialImpulses.push({ pos: pos.clone(), radius, strength });
      },
    },
    world: {
      objects: {
        damageExplosivesInRadius: () => undefined,
      },
    },
    combat: {
      explode: (pos: THREE.Vector3, spec: ExplosionSpec) => {
        explosions.push({ pos: pos.clone(), spec: { ...spec } });
      },
      napalmBurst: (pos: THREE.Vector3, vel: THREE.Vector3, source: string, radius: number) => {
        napalms.push({ pos: pos.clone(), vel: vel.clone(), source, radius });
      },
      batGrenade: () => null,
      puntEnemyGrenades: () => 0,
    },
    enemies: {
      alive: enemiesList,
      query: (center: THREE.Vector3, radius: number, out: EnemyInstance[]) => {
        out.length = 0;
        for (const e of enemiesList) {
          if (e.alive && e.center.distanceTo(center) <= radius + 1.5) out.push(e);
        }
        return out.length;
      },
      applyDamage: (enemy: EnemyInstance, info: DamageInfo) => {
        const cloned: DamageInfo = {
          ...info,
          point: info.point.clone(),
          dir: info.dir.clone(),
          slicePlaneNormal: info.slicePlaneNormal?.clone(),
        };
        damages.push({ enemy, info: cloned });
        enemy.health -= info.amount;
        const killed = enemy.health <= 0;
        if (killed) enemy.alive = false;
        return { dealt: info.amount, killed, headshot: false, blocked: false, sever: false };
      },
      vehicles: {
        frameBlow: (pos: THREE.Vector3, radius: number, damage: number, _dir: THREE.Vector3, source: string) => {
          vehicleBlows.push({ pos: pos.clone(), radius, damage, source });
          return 1;
        },
      },
    },
  } as unknown as Ctx;

  const arm: Arm = {
    muzzle: out => out.set(1.5, 2.5, -2.5),
    bore: out => out.set(0, 0, -1),
    turn: radians => { turns.push(radians); },
    recoil: metres => { recoils.push(metres); },
    setPose: (yaw, pitch, roll, extendZ) => { poses.push({ yaw, pitch, roll, extendZ }); },
    setActive: (amount, mode) => { actives.push({ amount, mode }); },
  };

  const sight: Sight = {
    view: { position: new THREE.Vector3(0, 2.5, 0), yaw: 0, pitch: 0, roll: 0, shake: 1 },
    aim: new THREE.Vector3(0, 0, -1),
    point: new THREE.Vector3(0, 2.5, -24),
    range: 24,
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
    energyMult: 1,
    feet: new THREE.Vector3(0, 0, 0),
    torsoYaw: 0,
    lungeImpulse: (dir, speed, duration) => {
      lunges.push({ dir: dir.clone(), speed, duration });
    },
    onShell: null,
    onNews: (kind, values) => { news.push({ kind, values }); },
    ...overrides,
  });

  return {
    ctx,
    damages,
    explosions,
    napalms,
    radialImpulses,
    vehicleBlows,
    lunges,
    turns,
    recoils,
    poses,
    actives,
    traumas,
    played,
    callouts,
    news,
    makeUpdate,
  };
}

// ---------------------------------------------------------------------------------------------
// 1. 60 mm Dual-Mode Grenade Launcher
// ---------------------------------------------------------------------------------------------
describe('60 mm Dual-Mode Grenade Launcher (grenade)', () => {
  it('fires HE arcing grenades that detonate with 7.5 m blast, 240 dmg, knockback, and index the 6-round drum', () => {
    const h = makeHarness({ wallZ: -20 });
    const gun = GRENADE_PLUGIN.create(h.ctx) as GrenadeArmGun;

    // Fire 1 HE round.
    gun.update(1 / 60, h.makeUpdate({ held: true, pressed: true }));
    expect(gun.clock.mag.ammo).toBe(5);
    expect(h.turns).toHaveLength(1);
    expect(h.turns[0]).toBeCloseTo(Math.PI / 3, 5);
    expect(gun.activeProjectiles).toBe(1);

    // Step flight until the shell impacts the wall at z = -20.
    for (let i = 0; i < 60 && gun.activeProjectiles > 0; i++) {
      gun.update(1 / 60, h.makeUpdate());
    }
    expect(gun.activeProjectiles).toBe(0);
    expect(h.explosions).toHaveLength(1);
    expect(h.explosions[0]!.spec.radius).toBe(GRENADE_LAUNCHER.he.radius);
    expect(h.explosions[0]!.spec.damage).toBe(GRENADE_LAUNCHER.he.blastDamage);
    expect(h.radialImpulses[0]!.strength).toBe(GRENADE_LAUNCHER.he.force);
    expect(h.napalms).toHaveLength(0);
  });

  it('toggles cleanly to NAPALM via cyclePressed and triggers combat.napalmBurst on impact', () => {
    const h = makeHarness({ wallZ: -18 });
    const gun = GRENADE_PLUGIN.create(h.ctx) as GrenadeArmGun;

    // Tap mode toggle (`1` / `2`).
    gun.update(1 / 60, h.makeUpdate({ cyclePressed: true }));
    expect(gun.clock.mode).toBe('NAPALM');
    expect(h.played).toContain('reload_bolt');
    expect(h.callouts.some(c => c.includes('NAPALM'))).toBe(true);

    // Fire 1 NAPALM round and step to impact.
    gun.update(1 / 60, h.makeUpdate({ held: true, pressed: true }));
    for (let i = 0; i < 60 && gun.activeProjectiles > 0; i++) {
      gun.update(1 / 60, h.makeUpdate());
    }

    expect(h.napalms).toHaveLength(1);
    expect(h.napalms[0]!.source).toBe('frame_grenade_napalm');
    expect(h.napalms[0]!.radius).toBe(GRENADE_LAUNCHER.napalm.napalmRadius);

    // Verify HUD row format.
    const row: GunnerWeapon = { name: '', ammo: 0, max: 0 };
    gun.fillRow(row, 'RMB', '2');
    expect(row.name).toBe('RMB 60MM GL [NAPALM] // 2');
    expect(row.ammo).toBe(5);
    expect(row.max).toBe(6);
  });

  it('supports 6-round drum capacity and manual R reload when partially spent', () => {
    const h = makeHarness({ floorY: 0 });
    const gun = GRENADE_PLUGIN.create(h.ctx) as GrenadeArmGun;

    // Reloading at full 6/6 does nothing.
    gun.update(1 / 60, h.makeUpdate({ reloadPressed: true }));
    expect(gun.clock.mag.reloading).toBeLessThan(0);

    // Fire 2 rounds respecting 0.62 s interval.
    gun.update(0.016, h.makeUpdate({ held: true, pressed: true }));
    expect(gun.clock.mag.ammo).toBe(5);
    gun.update(0.3, h.makeUpdate({ held: true }));
    expect(gun.clock.mag.ammo).toBe(5); // still inside 0.62 s fire interval
    gun.update(0.35, h.makeUpdate({ held: true }));
    expect(gun.clock.mag.ammo).toBe(4);

    // Trigger manual R reload at 4/6.
    gun.update(0.016, h.makeUpdate({ reloadPressed: true }));
    expect(gun.clock.mag.reloading).toBeGreaterThan(0);
    expect(gun.clock.mag.ammo).toBe(0);

    // Finish 2.6 s drum reload.
    gun.update(2.7, h.makeUpdate());
    expect(gun.clock.mag.ammo).toBe(6);
    expect(gun.clock.mag.reloading).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Plasma Energy Sword
// ---------------------------------------------------------------------------------------------
describe('Plasma Energy Sword (sword)', () => {
  it('executes 3-hit directional melee combo with escalating damage, lunge, pose, and capped slicePlaneNormal', () => {
    const enemies = Array.from({ length: 6 }, (_, i) =>
      makeEnemy(i + 1, (i - 2.5) * 0.8, -5.0, { health: 200 }),
    );
    const h = makeHarness({ enemies });
    const gun = SWORD_PLUGIN.create(h.ctx) as SwordArmGun;

    // Hit 1: tap press & release (< 0.45 s) -> 340 dmg, max 4 slices on 6 enemies.
    gun.update(0.05, h.makeUpdate({ side: 'left', button: 'LMB', cycleKey: '1', pressed: true, held: true }));
    gun.update(0.05, h.makeUpdate({ side: 'left', button: 'LMB', cycleKey: '1', held: false }));

    expect(h.damages).toHaveLength(6);
    expect(h.damages[0]!.info.amount).toBe(PLASMA_SWORD.combo[0].damage);
    expect(h.damages[0]!.info.severMult).toBe(PLASMA_SWORD.severMult);
    const slicedCount = h.damages.filter(d => d.info.slicePlaneNormal !== undefined).length;
    expect(slicedCount).toBe(PLASMA_SWORD.maxSlicesPerSwing);
    expect(h.lunges).toHaveLength(1);
    expect(h.lunges[0]!.speed).toBe(26);
    expect(h.lunges[0]!.duration).toBeCloseTo(0.22, 4);
    expect(h.poses.length).toBeGreaterThan(0);
    expect(h.actives.some(a => a.amount === 1)).toBe(true);

    // Wait combo cadence (0.38 s) and place a sturdy enemy for Hit 2 & Hit 3 damage escalation.
    const boss = makeEnemy(99, 0, -5.0, { health: 5000 });
    enemies.push(boss);
    h.damages.length = 0;

    gun.update(0.4, h.makeUpdate({ side: 'left' }));
    // Hit 2 -> 380 dmg.
    gun.update(0.05, h.makeUpdate({ side: 'left', pressed: true, held: true }));
    gun.update(0.05, h.makeUpdate({ side: 'left', held: false }));
    expect(h.damages).toHaveLength(1);
    expect(h.damages[0]!.info.amount).toBe(380);

    // Wait cadence and execute Hit 3 -> 520 dmg finisher.
    gun.update(0.4, h.makeUpdate({ side: 'left' }));
    gun.update(0.05, h.makeUpdate({ side: 'left', pressed: true, held: true }));
    gun.update(0.05, h.makeUpdate({ side: 'left', held: false }));
    expect(h.damages).toHaveLength(2);
    expect(h.damages[1]!.info.amount).toBe(520);
  });

  it('launches piercing Wave Cleave on >= 0.45 s charge release and scales damage by energyMult', () => {
    const lineEnemies = [
      makeEnemy(1, 0, -8, { health: 100 }),
      makeEnemy(2, 1.2, -16, { health: 100 }),
      makeEnemy(3, -1.0, -24, { health: 100 }),
    ];
    const h = makeHarness({ enemies: lineEnemies });
    const gun = SWORD_PLUGIN.create(h.ctx) as SwordArmGun;

    // Hold >= 0.45 s in CLEAVE mode (default) with energyMult = 1.2.
    gun.update(0.05, h.makeUpdate({ side: 'left', pressed: true, held: true, energyMult: 1.2 }));
    gun.update(0.45, h.makeUpdate({ side: 'left', held: true, energyMult: 1.2 }));
    gun.update(0.016, h.makeUpdate({ side: 'left', held: false, energyMult: 1.2 }));

    expect(gun.activeWaves).toBe(1);
    expect(gun.heatValue).toBeGreaterThanOrEqual(PLASMA_SWORD.cleaveHeat - 2);

    // Step wave forward across its 28 m travel.
    for (let i = 0; i < 45 && gun.activeWaves > 0; i++) {
      gun.update(0.02, h.makeUpdate({ side: 'left', energyMult: 1.2 }));
    }
    expect(gun.activeWaves).toBe(0);
    expect(h.damages).toHaveLength(3);
    for (const d of h.damages) {
      expect(d.info.amount).toBe(Math.round(PLASMA_SWORD.cleave.damage * 1.2));
      expect(d.info.slicePlaneNormal).toBeDefined();
      expect(d.info.severMult).toBe(PLASMA_SWORD.severMult);
    }
  });

  it('switches to IMPALE mode via cyclePressed and executes high-speed 18 m jet-lunge stab', () => {
    const target = makeEnemy(1, 0, -14, { health: 1000 });
    const h = makeHarness({ enemies: [target] });
    const gun = SWORD_PLUGIN.create(h.ctx) as SwordArmGun;

    // Cycle mode CLEAVE -> IMPALE.
    gun.update(0.016, h.makeUpdate({ side: 'left', cyclePressed: true }));
    expect(gun.mode).toBe('IMPALE');

    // Charge >= 0.45 s and release.
    gun.update(0.05, h.makeUpdate({ side: 'left', pressed: true, held: true, energyMult: 1.25 }));
    gun.update(0.45, h.makeUpdate({ side: 'left', held: true, energyMult: 1.25 }));
    gun.update(0.016, h.makeUpdate({ side: 'left', held: false, energyMult: 1.25 }));

    expect(h.lunges).toHaveLength(1);
    expect(h.lunges[0]!.speed).toBe(46);
    expect(h.lunges[0]!.duration).toBeCloseTo(0.32, 4);
    expect(h.damages).toHaveLength(1);
    expect(h.damages[0]!.info.amount).toBe(Math.round(PLASMA_SWORD.impale.damage * 1.25));
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Hydraulic Pile Bunker
// ---------------------------------------------------------------------------------------------
describe('Hydraulic Pile Bunker (bunker)', () => {
  it('delivers quick 260 dmg shove-jab on tap (< 0.5 s) with 0.65 s cooldown', () => {
    const target = makeEnemy(1, 0, -4.2, { health: 1000 });
    const h = makeHarness({ enemies: [target] });
    const gun = BUNKER_PLUGIN.create(h.ctx) as BunkerArmGun;

    gun.update(0.1, h.makeUpdate({ side: 'left', pressed: true, held: true }));
    gun.update(0.1, h.makeUpdate({ side: 'left', held: false }));

    expect(h.damages).toHaveLength(1);
    expect(h.damages[0]!.info.amount).toBe(PILE_BUNKER.jab.damage);
    expect(h.damages[0]!.info.force).toBe(PILE_BUNKER.jab.force);
    expect(gun.cooldownRemaining).toBeCloseTo(PILE_BUNKER.jab.cooldown, 3);
    expect(h.lunges).toHaveLength(0);
  });

  it('fires 920 dmg explosive Pile Bunker Drive on hold >= 0.5 s with lunge, vehicle 2x blow, trauma 0.75, and 2.2 s cooldown', () => {
    const target = makeEnemy(1, 0, -5.2, { health: 1500 });
    const h = makeHarness({ enemies: [target] });
    const gun = BUNKER_PLUGIN.create(h.ctx) as BunkerArmGun;

    gun.update(0.1, h.makeUpdate({ side: 'left', pressed: true, held: true }));
    gun.update(0.45, h.makeUpdate({ side: 'left', held: true }));
    expect(gun.chargedArmed).toBe(true);

    gun.update(0.016, h.makeUpdate({ side: 'left', held: false }));

    expect(h.damages).toHaveLength(1);
    expect(h.damages[0]!.info.amount).toBe(920);
    expect(h.damages[0]!.info.force).toBe(220);
    expect(h.damages[0]!.info.armorPiercing).toBe(true);
    expect(h.lunges).toHaveLength(1);
    expect(h.lunges[0]!.speed).toBe(32);
    expect(h.vehicleBlows).toHaveLength(1);
    expect(h.vehicleBlows[0]!.damage).toBe(920 * 2);
    expect(h.recoils).toContain(-1.6);
    expect(h.traumas).toContain(0.75);
    expect(gun.cooldownRemaining).toBeCloseTo(PILE_BUNKER.drive.cooldown, 3);

    // Cannot fire again while on 2.2 s cooldown.
    gun.update(0.5, h.makeUpdate({ side: 'left', pressed: true, held: true }));
    gun.update(0.016, h.makeUpdate({ side: 'left', held: false }));
    expect(h.damages).toHaveLength(1);

    // Ready again after cooldown elapses.
    gun.update(1.8, h.makeUpdate({ side: 'left' }));
    expect(gun.cooldownRemaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Armored Energy Shield
// ---------------------------------------------------------------------------------------------
describe('Armored Energy Shield (shield)', () => {
  it('activates Perfect Guard (0.95 DR for 0.5 s) then drops to 0.80 DR, and clears shieldState on release', () => {
    const h = makeHarness();
    const gun = SHIELD_PLUGIN.create(h.ctx) as ShieldArmGun;

    expect(gun.shieldState).toBeUndefined();

    // Raise shield -> immediately in Perfect Guard window.
    gun.update(0.05, h.makeUpdate({ side: 'left', pressed: true, held: true }));
    expect(gun.shieldState).toBeDefined();
    expect(gun.shieldState!.active).toBe(true);
    expect(gun.shieldState!.perfect).toBe(true);
    expect(gun.shieldState!.reduction).toBe(0.95);
    expect(gun.shieldState!.side).toBe('left');
    expect(h.actives.at(-1)?.amount).toBe(1);
    expect(h.poses.at(-1)?.yaw).toBeCloseTo(-0.55, 3);

    // Still Perfect Guard at 0.35 s total.
    gun.update(0.30, h.makeUpdate({ side: 'left', held: true }));
    expect(gun.shieldState!.perfect).toBe(true);
    expect(gun.shieldState!.reduction).toBe(0.95);

    // Past 0.5 s -> normal guard (0.80 DR, perfect = false).
    gun.update(0.25, h.makeUpdate({ side: 'left', held: true }));
    expect(gun.shieldState!.perfect).toBe(false);
    expect(gun.shieldState!.reduction).toBe(0.80);
    expect(h.actives.at(-1)?.amount).toBeCloseTo(0.72, 2);

    // Release -> shieldState clears immediately.
    gun.update(0.05, h.makeUpdate({ side: 'left', held: false }));
    expect(gun.shieldState).toBeUndefined();
    expect(h.actives.at(-1)?.amount).toBe(0);
  });

  it('triggers 2.5 s overheat lockout at 100 heat and clears shieldState until vented', () => {
    const h = makeHarness();
    const gun = SHIELD_PLUGIN.create(h.ctx) as ShieldArmGun;

    // Hold for 8 s (> 100 / 14 = 7.14 s) to overheat.
    for (let i = 0; i < 80; i++) {
      gun.update(0.1, h.makeUpdate({ side: 'left', pressed: i === 0, held: true }));
    }
    expect(gun.overheated).toBe(true);
    expect(gun.shieldState).toBeUndefined();
    expect(gun.lockoutTimer).toBeGreaterThan(0);

    // Holding during lockout cannot raise shield.
    gun.update(0.5, h.makeUpdate({ side: 'left', held: true }));
    expect(gun.shieldState).toBeUndefined();

    // After 2.5 s vent lockout, shield can be raised again cleanly.
    gun.update(2.2, h.makeUpdate({ side: 'left', held: false }));
    expect(gun.overheated).toBe(false);
    gun.update(0.05, h.makeUpdate({ side: 'left', pressed: true, held: true }));
    expect(gun.shieldState?.active).toBe(true);
    expect(gun.shieldState?.perfect).toBe(true);
  });

  it('supports BUCKLER mode toggle (0.7 s PG) and Shield Bash pulse while guarding', () => {
    const enemy = makeEnemy(1, 0, -4.5, { health: 500 });
    const h = makeHarness({ enemies: [enemy] });
    const gun = SHIELD_PLUGIN.create(h.ctx) as ShieldArmGun;

    // Toggle STANDARD -> BUCKLER while idle.
    gun.update(0.016, h.makeUpdate({ side: 'left', cyclePressed: true }));
    expect(gun.mode).toBe('BUCKLER');

    // Raise shield and check 0.6 s is still inside BUCKLER's 0.7 s Perfect Guard window.
    gun.update(0.05, h.makeUpdate({ side: 'left', pressed: true, held: true }));
    gun.update(0.55, h.makeUpdate({ side: 'left', held: true }));
    expect(gun.shieldState?.perfect).toBe(true);

    // Tap cycle key while guarding -> fires Shield Bash (180 dmg, 160 force, +20 heat).
    const heatBefore = gun.heatValue;
    gun.update(0.016, h.makeUpdate({ side: 'left', held: true, cyclePressed: true }));
    expect(h.damages).toHaveLength(1);
    expect(h.damages[0]!.info.amount).toBe(ENERGY_SHIELD.bash.damage);
    expect(h.damages[0]!.info.force).toBe(ENERGY_SHIELD.bash.force);
    expect(gun.heatValue).toBeGreaterThanOrEqual(heatBefore + ENERGY_SHIELD.bash.heatCost);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Sculpted 3D Models Verification
// ---------------------------------------------------------------------------------------------
describe('v2 Headline Arm 3D Models (GRENADE_ARM, SWORD_ARM, BUNKER_ARM, SHIELD_ARM)', () => {
  const mockMaterials = {
    solid: new THREE.MeshStandardMaterial(),
    glow: new THREE.MeshBasicMaterial(),
    nearby: new THREE.MeshStandardMaterial(),
    group: vi.fn(),
  } as unknown as ModelMaterials;

  const SPECS = [
    ['GRENADE_ARM', GRENADE_ARM],
    ['SWORD_ARM', SWORD_ARM],
    ['BUNKER_ARM', BUNKER_ARM],
    ['SHIELD_ARM', SHIELD_ARM],
  ] as const;

  for (const [label, spec] of SPECS) {
    it(`${label} builds valid non-empty fixed & moving geometry and dynamic extra handle`, () => {
      const fixed = new ModelBuilder();
      spec.build(fixed);
      const fixedGeo = fixed.solidGeometry();
      expect(fixedGeo).not.toBeNull();
      expect(fixedGeo!.getAttribute('position').count).toBeGreaterThan(100);
      expect(fixedGeo!.getAttribute('normal').count).toBe(fixedGeo!.getAttribute('position').count);

      const moving = new ModelBuilder();
      spec.moving(moving);
      const movingGeo = moving.solidGeometry();
      expect(movingGeo).not.toBeNull();
      expect(movingGeo!.getAttribute('position').count).toBeGreaterThan(24);

      expect(spec.extra).toBeTypeOf('function');
      const extra = spec.extra!(mockMaterials, BUREAU_PALETTE);
      expect(extra.group).toBeInstanceOf(THREE.Group);
      expect(extra.group.children.length).toBeGreaterThan(0);
      expect(extra.setActive).toBeTypeOf('function');

      // Exercise setActive across full range & modes without throwing.
      extra.setActive!(0, 0);
      extra.setActive!(0.5, 0);
      extra.setActive!(1, 0);
      extra.setActive!(1, 1);

      fixedGeo!.dispose();
      movingGeo!.dispose();
    });
  }
});
