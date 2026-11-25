/**
 * Unit tests for Overhaul v2 Legs, Engines, Core Expansions, and sculpted 3D models:
 * - Gaits: Mag-Skiff Hover Hull (`hover`), Drift-Wheel Rig (`wheels`), Aero-Quad Legs (`aeroQuad`)
 * - Drives: Blink-Step Booster (`blink`), Redline Surge Reactor (`redline`), Assault-Ram Drive (`assault`)
 * - Core Expansions: Breacher Nova (`nova`), Aegis Barrier (`aegis`), Bunker Dome (`dome`), Last-Stand Fuse (`terminal`)
 * - 3D Models: `legs-hover`, `legs-wheels`, `legs-aeroquad`, `engine-v2` (`blink`/`redline`/`assault`), `ExpansionVisuals`
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Ctx, DamageInfo } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { Physics } from '../../physics/Physics';
import { ModelMaterials } from '../../progression/modelkit';
import type { GunnerWeapon } from '../../vehicles/hud';
import { FRAME_PLACES } from '../cockpit';
import { Walker, type WalkerIntent } from '../controller';
import { FRAME } from '../data';
import { AEGIS_EXPANSION, AEGIS_DURATION, AEGIS_SHIELD_HP } from '../expansions/aegis';
import { DOME_EXPANSION, DOME_DURATION, DOME_HP } from '../expansions/dome';
import { NOVA_EXPANSION, NOVA_DAMAGE, NOVA_KNOCKBACK, NOVA_VISUAL_SECONDS } from '../expansions/nova';
import {
  TERMINAL_EXPANSION, TERMINAL_BLAST_DAMAGE, TERMINAL_DURATION, TERMINAL_REFILL_SECONDS, TERMINAL_SHIELD_HP,
} from '../expansions/terminal';
import type { ExpansionContext } from '../expansions/types';
import { ExpansionVisuals } from '../expansions/visuals';
import { buildEngineV2Visual } from '../models/engine-v2';
import { buildAeroQuadLegs } from '../models/legs-aeroquad';
import { buildHoverLegs } from '../models/legs-hover';
import { buildWheelLegs } from '../models/legs-wheels';
import { BUREAU_PALETTE, FRAME_PALETTES } from '../models/palette';
import { ASSAULT_FUEL_BURN_FRACTION, ASSAULT_SPEED } from './drive/assault';
import { BLINK_CHARGES, BLINK_REFILL, BLINK_SPEED } from './drive/blink';
import { REDLINE_BUFF_SECONDS, REDLINE_STALL_SECONDS, REDLINE_SURGE_SHARE } from './drive/redline';

const DT = 1 / 60;
let physics: Physics;
let placed: RAPIER.Collider[] = [];

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const h = new THREE.Vector3((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
  placed.push(physics.addStaticBox(c, h, null, 'concrete'));
  physics.flushQueries();
}

const floor = () => box(-300, -1, -300, 300, 0, 300);

const idle = (): WalkerIntent => ({
  moveX: 0,
  moveZ: 0,
  viewYaw: 0,
  jet: false,
  stomp: false,
  charge: false,
  chargeHeld: false,
  viewPitch: 0,
});

function makeWalker(x = 0, z = 0, yaw = 0): Walker {
  const w = new Walker(physics, 0);
  w.place(new THREE.Vector3(x, 0.5, z), yaw);
  return w;
}

function run(w: Walker, seconds: number, intent: WalkerIntent, each?: (t: number) => void): void {
  const steps = Math.max(1, Math.round(seconds / DT));
  for (let i = 0; i < steps; i++) {
    w.update(DT, intent);
    intent.stomp = false;
    intent.charge = false;
    each?.((i + 1) * DT);
  }
}

function makeMaterials(): ModelMaterials {
  const ctx = {
    render: { materials: { patch: <T extends THREE.Material>(m: T): T => m } },
  } as unknown as Ctx;
  return new ModelMaterials(ctx);
}

function assertValidGeometry(group: THREE.Group | undefined): number {
  expect(group).toBeDefined();
  let verts = 0;
  group!.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    expect(pos).toBeDefined();
    expect(pos.count).toBeGreaterThan(0);
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true);
      expect(Number.isFinite(pos.getY(i))).toBe(true);
      expect(Number.isFinite(pos.getZ(i))).toBe(true);
    }
    verts += pos.count;
  });
  expect(verts).toBeGreaterThan(0);
  return verts;
}

interface MockEnemy {
  uid: number;
  alive: boolean;
  position: THREE.Vector3;
  center: THREE.Vector3;
  hits: Array<{ amount: number; force: number; source: string }>;
}

function makeMockEnemy(uid: number, x: number, y: number, z: number): MockEnemy {
  const pos = new THREE.Vector3(x, y, z);
  return { uid, alive: true, position: pos, center: pos.clone().add(new THREE.Vector3(0, 1, 0)), hits: [] };
}

function makeExpansionEnv(enemies: MockEnemy[] = []) {
  const news: Array<{ kind: string; values: number[] }> = [];
  const damageExplosives = vi.fn();
  const clearSapper = vi.fn(() => true);
  const feed = vi.fn();
  const callout = vi.fn();

  const ctx = {
    enemies: {
      query(center: THREE.Vector3, radius: number, out: EnemyInstance[]) {
        out.length = 0;
        for (const e of enemies) {
          if (Math.hypot(e.position.x - center.x, e.position.z - center.z) <= radius + 0.5) {
            out.push(e as unknown as EnemyInstance);
          }
        }
        return out.length;
      },
      applyDamage(e: EnemyInstance, info: DamageInfo) {
        const m = e as unknown as MockEnemy;
        m.hits.push({ amount: info.amount, force: info.force, source: info.source });
      },
    },
    world: { objects: { damageExplosivesInRadius: damageExplosives } },
    fx: { ring: vi.fn(), slam: vi.fn(), sparks: vi.fn() },
    audio: { play: vi.fn() },
    render: { lights: { flash: vi.fn() }, post: { flash: vi.fn() } },
    camera: { addTrauma: vi.fn() },
    hud: { feed, callout },
  } as unknown as Ctx;

  const feet = new THREE.Vector3(10, 0, -5);
  const u: ExpansionContext = {
    ctx,
    feet,
    torsoYaw: 0,
    popSmoke: () => false,
    clearSapper,
    onNews: (kind, values) => news.push({ kind, values }),
  };

  return { ctx, u, feet, news, damageExplosives, clearSapper, feed, callout };
}

beforeAll(async () => {
  physics = await Physics.create();
});

afterEach(() => {
  for (const c of placed) physics.world.removeCollider(c, false);
  placed = [];
  physics.flushQueries();
});

// -------------------------------------------------------------------------------------------------
// 1. V2 Leg Gaits
// -------------------------------------------------------------------------------------------------

describe('v2 leg gaits', () => {
  it('Hover gait: omnidirectional full-speed strafe, light drift momentum, and repulsorPulseOnStomp', () => {
    floor();
    const w = makeWalker();
    w.setMovement('hover', 'jets');
    w.speedScale = 1.3;
    w.strafeScale = 1.3;

    // Omnidirectional strafe reaches full forward hover speed (7 * 1.3 = 9.1 m/s).
    run(w, 0.5, { ...idle(), moveX: 1 });
    expect(w.speed).toBeCloseTo(FRAME.walk.forward * 1.3, 1);

    // Releasing keys keeps light drift momentum instead of stopping dead immediately.
    run(w, 0.2, idle());
    expect(w.speed).toBeGreaterThan(4.0);
    run(w, 0.8, idle());
    expect(w.speed).toBeCloseTo(0, 1);

    // C/Ctrl triggers downward repulsor crush pulse instead of stomp.
    w.update(DT, { ...idle(), stomp: true });
    expect(w.said.repulsorPulsed).toBe(true);
    expect(w.stomping).toBe(false);
  });

  it('Wheels gait: blistering ground speed and powerslide momentum retention on sharp turns', () => {
    floor();
    const w = makeWalker();
    w.setMovement('wheels', 'jets');
    w.speedScale = 1.6;
    w.turnScale = 1.35;

    // Accelerate straight ahead to blistering high speed (> 11.5 m/s).
    run(w, 0.7, { ...idle(), moveZ: 1 });
    const peak = w.speed;
    expect(peak).toBeGreaterThan(11.5);

    // Snap into a 90° lateral turn: powerslide preserves high drift speed (> 9 m/s) while carving sideways.
    run(w, 0.25, { ...idle(), moveX: 1 });
    expect(w.speed).toBeGreaterThan(9.5);
    expect(w.velocity.x).toBeGreaterThan(3.0);
    expect(w.velocity.z).toBeLessThan(-3.0);
  });

  it('Aero-Quad gait: mid-air airGlide locks altitude at half fuel drain and glides at 14 m/s', () => {
    floor();
    const w = makeWalker();
    w.setMovement('aeroQuad', 'jets');
    w.speedScale = 1.15;
    w.jumpScale = 1.25;

    // Put walker in mid-air after jump apex and hold Space + Strafe Right.
    w.feet.set(0, 10, 0);
    w.grounded = false;
    w.boost = 0;
    w.velocity.set(0, -1, 0);
    const fuelStart = w.fuel;
    let hoveredTicks = 0;

    run(w, 1.0, { ...idle(), jet: true, moveX: 1 }, () => {
      if (w.aeroHovering) hoveredTicks++;
    });

    expect(hoveredTicks).toBeGreaterThan(55);
    expect(w.aeroHovering).toBe(true);
    // Altitude held nearly level around 10 m.
    expect(Math.abs(w.feet.y - 10)).toBeLessThan(0.5);
    // Sustained 14 m/s horizontal glide speed.
    expect(w.speed).toBeCloseTo(14, 0);
    // Half normal fuel drain (~0.5 s of fuel used over 1.0 s of hover).
    expect(fuelStart - w.fuel).toBeCloseTo(0.5, 1);

    // Releasing Space exits aeroHovering cleanly and gravity resumes.
    run(w, 0.25, idle());
    expect(w.aeroHovering).toBe(false);
    expect(w.velocity.y).toBeLessThan(-3);
  });
});

// -------------------------------------------------------------------------------------------------
// 2. V2 Engine Drives
// -------------------------------------------------------------------------------------------------

describe('v2 engine drives', () => {
  it('Blink-Step drive: 3 fast charges, 1.1 s recharge, 42 m/s omnidirectional burst & dashDir', () => {
    floor();
    const w = makeWalker();
    w.setMovement('walker', 'blink');

    expect(w.maxCharges).toBe(BLINK_CHARGES);
    expect(w.charges).toBe(3);

    // Omnidirectional strafe-right quick-boost on Shift.
    w.update(DT, { ...idle(), moveX: 1, charge: true });
    expect(w.charges).toBe(2);
    expect(w.said.charged).toBe(true);
    expect(w.velocity.x).toBeCloseTo(BLINK_SPEED, 1);
    expect(w.dashDirX).toBeCloseTo(1, 2);
    expect(w.dashDirZ).toBeCloseTo(0, 2);

    // After 0.18 s blink finishes, velocity drops smoothly back to walk speed.
    run(w, 0.25, idle());
    expect(w.charging).toBe(0);

    // Default forward blink when no WASD is held.
    w.update(DT, { ...idle(), charge: true });
    expect(w.charges).toBe(1);
    expect(w.velocity.z).toBeCloseTo(-BLINK_SPEED, 1);
    expect(w.dashDirX).toBeCloseTo(0, 2);
    expect(w.dashDirZ).toBeCloseTo(-1, 2);

    // Recharges 1 charge after 1.1 s.
    run(w, BLINK_REFILL + 0.05, idle());
    expect(w.charges).toBeGreaterThanOrEqual(2);
  });

  it('Redline Surge drive: slow 0.45x partial regen, and 0% fuel -> 0.35 s stall -> 75% surge + redlineBuff', () => {
    floor();
    const w = makeWalker();
    w.fuelScale = 1.8;
    w.setMovement('walker', 'redline');

    // Partial regen on ground is slower (0.45x standard).
    w.fuel = w.maxFuel * 0.5;
    w.onGround = 1;
    const beforeRegen = w.fuel;
    run(w, 1.0, idle());
    const expectedGain = (w.maxFuel / FRAME.jet.refill) * 0.45;
    expect(w.fuel - beforeRegen).toBeCloseTo(expectedGain, 1);

    // Drain fuel all the way to 0% in mid-air to trigger Redline Surge!
    w.feet.set(0, 12, 0);
    w.grounded = false;
    w.fuel = 0.05;
    w.redlineBuff = 0;

    // Drain last 0.05 s -> enters 0.35 s stall with fuel at 0.
    run(w, 0.12, { ...idle(), jet: true });
    expect(w.fuel).toBe(0);
    expect(w.redlineBuff).toBe(0);

    // Finish the 0.35 s stall -> surges instantly to 75% maxFuel and sets redlineBuff ~ 4.5 s!
    run(w, REDLINE_STALL_SECONDS, idle());
    expect(w.fuel).toBeCloseTo(w.maxFuel * REDLINE_SURGE_SHARE, 1);
    expect(w.redlineBuff).toBeGreaterThan(REDLINE_BUFF_SECONDS - 0.3);
    expect(w.redlineBuff).toBeLessThanOrEqual(REDLINE_BUFF_SECONDS);
  });

  it('Assault-Ram drive: holding Shift engages 28 m/s assaultBoosting and burns 24%/s fuel', () => {
    floor();
    const w = makeWalker();
    w.fuelScale = 1.25;
    w.setMovement('walker', 'assault');

    const startFuel = w.fuel;
    run(w, 1.0, { ...idle(), chargeHeld: true, moveX: 0.5 });

    expect(w.assaultBoosting).toBe(true);
    expect(w.velocity.z).toBeCloseTo(-ASSAULT_SPEED, 1);
    expect(w.velocity.x).toBeGreaterThan(2.5);
    expect(startFuel - w.fuel).toBeCloseTo(w.maxFuel * ASSAULT_FUEL_BURN_FRACTION, 1);

    // Releasing Shift exits Assault Boost cleanly.
    run(w, 0.1, idle());
    expect(w.assaultBoosting).toBe(false);
    expect(w.charging).toBe(0);
  });
});

// -------------------------------------------------------------------------------------------------
// 3. Core Expansions
// -------------------------------------------------------------------------------------------------

describe('v2 core expansions', () => {
  it('Breacher Nova: 16 m 480-dmg blast + 180 knockback, sapper clear, prop blast, 1->0 visual, wire news', () => {
    const near = makeMockEnemy(1, 18, 0, -5); // 8 m away
    const far = makeMockEnemy(2, 35, 0, -5);  // 25 m away (outside 16 m)
    const { ctx, u, news, damageExplosives, clearSapper } = makeExpansionEnv([near, far]);

    const exp = NOVA_EXPANSION.create(ctx);
    expect(exp.trigger(u)).toBe(true);
    expect(clearSapper).toHaveBeenCalledTimes(1);
    expect(damageExplosives).toHaveBeenCalledTimes(1);
    expect(near.hits).toHaveLength(1);
    expect(near.hits[0]!.amount).toBe(NOVA_DAMAGE);
    expect(near.hits[0]!.force).toBe(NOVA_KNOCKBACK);
    expect(far.hits).toHaveLength(0);

    expect(exp.visual.novaProgress).toBe(1);
    expect(news).toEqual([{ kind: 'expansion', values: [1, 10, 0, -5] }]);

    // Animates `1 -> 0` over 0.65 s.
    exp.update(NOVA_VISUAL_SECONDS * 0.5, u);
    expect(exp.visual.novaProgress).toBeCloseTo(0.5, 2);
    exp.update(NOVA_VISUAL_SECONDS * 0.6, u);
    expect(exp.visual.novaProgress).toBe(0);

    // Refills 1 spent charge over 20 s.
    const row: GunnerWeapon = { name: '', ammo: 0, max: 0, reload: -1 };
    exp.fillRow(row);
    expect(row.ammo).toBe(1);
    expect(row.max).toBe(2);
    exp.idleUpdate(20.1);
    exp.fillRow(row);
    expect(row.ammo).toBe(2);
  });

  it('Aegis Barrier: 1800 HP mobile shield over 8 s, clears sappers, absorbs until broken or expired', () => {
    const { ctx, u, news, clearSapper } = makeExpansionEnv();
    const exp = AEGIS_EXPANSION.create(ctx);

    expect(exp.trigger(u)).toBe(true);
    expect(clearSapper).toHaveBeenCalledTimes(1);
    expect(exp.visual.aegisAlpha).toBe(1);
    expect(news).toEqual([{ kind: 'expansion', values: [2, 10, 0, -5] }]);

    // Absorbs 1000 of 1800 HP cleanly.
    expect(exp.absorbDamage!(1000, 3000, undefined, u)).toBe(0);
    expect(exp.visual.aegisAlpha).toBeGreaterThan(0.5);

    // Next 1000 hit shatters remaining 800 HP and passes 200 through.
    expect(exp.absorbDamage!(1000, 3000, undefined, u)).toBe(200);
    expect(exp.visual.aegisAlpha).toBe(0);

    // Second charge expires after 8 s.
    exp.update(0.6, u);
    expect(exp.trigger(u)).toBe(true);
    exp.update(AEGIS_DURATION + 0.1, u);
    expect(exp.visual.aegisAlpha).toBe(0);
    expect(exp.absorbDamage!(500, 3000, undefined, u)).toBe(500);
    expect(AEGIS_SHIELD_HP).toBe(1800);
  });

  it('Bunker Dome: stationary 11 m 3200 HP dome blocks outside fire inside radius only', () => {
    const { ctx, u, feet, news } = makeExpansionEnv();
    const exp = DOME_EXPANSION.create(ctx);

    expect(exp.trigger(u)).toBe(true);
    expect(exp.visual.domePos).not.toBeNull();
    expect(exp.visual.domePos!.x).toBe(10);
    expect(exp.visual.domeAlpha).toBe(1);
    expect(news).toEqual([{ kind: 'expansion', values: [3, 10, 0, -5] }]);

    const outsideAttacker = new THREE.Vector3(35, 2, -5); // 25 m from dome center
    const insideAttacker = new THREE.Vector3(14, 2, -5);  // 4 m from dome center

    // Mech inside dome + outside attacker -> blocked completely!
    expect(exp.absorbDamage!(1200, 3000, outsideAttacker, u)).toBe(0);

    // Mech inside dome + inside attacker -> NOT blocked!
    expect(exp.absorbDamage!(400, 3000, insideAttacker, u)).toBe(400);

    // Mech walks outside 11 m radius -> outside fire is NOT blocked!
    feet.set(26, 0, -5);
    expect(exp.absorbDamage!(400, 3000, outsideAttacker, u)).toBe(400);

    // Mech steps back inside -> absorbs remaining 2000 HP and collapses on 2500 hit (500 overflow).
    feet.set(12, 0, -5);
    expect(exp.absorbDamage!(2500, 3000, outsideAttacker, u)).toBe(500);
    expect(exp.visual.domePos).toBeNull();
    expect(exp.visual.domeAlpha).toBe(0);

    // Second charge expires after 14 s.
    exp.update(0.6, u);
    expect(exp.trigger(u)).toBe(true);
    exp.update(DOME_DURATION + 0.1, u);
    expect(exp.visual.domePos).toBeNull();
    expect(DOME_HP).toBe(3200);
  });

  it('Last-Stand Fuse: passive manual Q ignored, auto-triggers on lethal hit clamping HP to 1 + 2500 HP shield + 10 m blast', () => {
    const near = makeMockEnemy(1, 15, 0, -5); // 5 m away
    const far = makeMockEnemy(2, 26, 0, -5);  // 16 m away (outside 10 m)
    const { ctx, u, news } = makeExpansionEnv([near, far]);
    const exp = TERMINAL_EXPANSION.create(ctx);

    // Manual Q never wastes the passive fuse.
    expect(exp.trigger(u)).toBe(false);
    expect(exp.visual.terminalActive).toBe(false);

    // Non-lethal hit passes through untouched.
    expect(exp.absorbDamage!(300, 1000, undefined, u)).toBe(300);
    expect(exp.visual.terminalActive).toBe(false);

    // Lethal hit (900 dmg at 400 HP) auto-triggers Last-Stand Fuse!
    const remaining = exp.absorbDamage!(900, 400, undefined, u);
    expect(remaining).toBe(399); // Leaves hull at 400 - 399 = 1 HP!
    expect(exp.visual.terminalActive).toBe(true);
    expect(exp.visual.aegisAlpha).toBe(1);
    expect(news).toEqual([{ kind: 'expansion', values: [4, 10, 0, -5] }]);

    // Blasts enemies within 10 m for 250 dmg.
    expect(near.hits).toHaveLength(1);
    expect(near.hits[0]!.amount).toBe(TERMINAL_BLAST_DAMAGE);
    expect(far.hits).toHaveLength(0);

    // Subsequent hits during the 5.5 s window are absorbed by the 2500 HP crimson emergency shield.
    expect(exp.absorbDamage!(1500, 1, undefined, u)).toBe(0);
    expect(exp.absorbDamage!(1200, 1, undefined, u)).toBe(200); // 1000 absorbed, 200 overflow
    expect(exp.visual.terminalActive).toBe(false);

    // Recharges after 45 s.
    exp.idleUpdate(TERMINAL_REFILL_SECONDS + 0.1);
    expect(exp.absorbDamage!(500, 100, undefined, u)).toBe(99);
    expect(exp.visual.terminalActive).toBe(true);
    exp.update(TERMINAL_DURATION + 0.1, u);
    expect(exp.visual.terminalActive).toBe(false);
    expect(TERMINAL_SHIELD_HP).toBe(2500);
  });
});

// -------------------------------------------------------------------------------------------------
// 4. Sculpted 3D Models & Expansion Visuals
// -------------------------------------------------------------------------------------------------

describe('v2 3D leg, engine, and expansion visuals', () => {
  it('builds and poses all 3 new leg 3D models cleanly across liveries', () => {
    const mat = makeMaterials();

    const hover = buildHoverLegs(mat, FRAME_PLACES.hips, FRAME_PALETTES.arctic);
    expect(assertValidGeometry(hover.group)).toBeGreaterThan(200);
    hover.pose(1.2, 0.8, -0.1, 0, 0, 0, false, false, { hovering: true, dt: 0.016, speed: 9, turnRate: 0.8 });
    hover.pose(2.4, 0, 0, 0.5, 0, 0, true, false, { hovering: false, dt: 0.016, speed: 0 });

    const wheels = buildWheelLegs(mat, FRAME_PLACES.hips, FRAME_PALETTES.rust);
    expect(assertValidGeometry(wheels.group)).toBeGreaterThan(300);
    wheels.pose(0.5, 1.0, 0, 0, 0, 0, false, false, { dt: 0.1, speed: 12, turnRate: 1.2 });
    wheels.pose(1.0, 0, 0, 0, 0, 0, true, false, { dt: 0.1, speed: 0, turnRate: 0 });

    const aero = buildAeroQuadLegs(mat, FRAME_PLACES.hips, FRAME_PALETTES.crimson);
    expect(assertValidGeometry(aero.group)).toBeGreaterThan(250);
    aero.pose(0.5, 1.0, 0, 0, 0, 0, false, false, { hovering: false, dt: 0.1 });
    aero.pose(1.0, 0.5, 0, 0, 0, 0, false, false, { hovering: true, dt: 0.25 });
    aero.pose(1.5, 0.5, 0, 0, 0, 0, false, true, { hovering: false, dt: 0.1 });
  });

  it('builds and poses all 3 v2 engine 3D models cleanly (blink, redline, assault)', () => {
    const mat = makeMaterials();

    for (const kind of ['blink', 'redline', 'assault'] as const) {
      const vis = buildEngineV2Visual(kind, mat, BUREAU_PALETTE);
      expect(vis).not.toBeNull();
      expect(assertValidGeometry(vis!.group)).toBeGreaterThan(150);
      vis!.pose(0.05, false, false, false, false, 0, false, { charging: false, redline: 0, dashDirX: 0, dashDirZ: 0 });
      vis!.pose(0.05, true, true, false, true, 1.2, false, { charging: true, redline: 1, dashDirX: 1, dashDirZ: -1 });
      vis!.pose(0.05, true, false, false, false, 2.0, true, { charging: false, redline: 0.5 });
    }
    expect(buildEngineV2Visual('jets', mat)).toBeNull();
  });

  it('builds and syncs ExpansionVisuals for Nova, Aegis, Terminal, and stationary 11 m Bunker Dome', () => {
    const scene = new THREE.Scene();
    const visuals = new ExpansionVisuals(scene);

    expect(assertValidGeometry(visuals.root)).toBeGreaterThan(100);
    expect(assertValidGeometry(visuals.domeGroup)).toBeGreaterThan(100);
    expect(scene.children).toContain(visuals.domeGroup);

    visuals.setPalette(FRAME_PALETTES.arctic);

    // Nova expanding shock sphere
    visuals.sync({ novaProgress: 0.8, aegisAlpha: 0, terminalActive: false, domePos: null, domeAlpha: 0 }, 0.05, false);
    expect(visuals.domeGroup.visible).toBe(false);

    // Mobile Aegis -> Crimson Terminal -> Stationary 11 m Dome
    const domePos = new THREE.Vector3(4, 0, -9);
    visuals.sync({ novaProgress: 0, aegisAlpha: 0.9, terminalActive: false, domePos, domeAlpha: 0.85 }, 0.05, false);
    expect(visuals.domeGroup.visible).toBe(true);
    expect(visuals.domeGroup.position.x).toBe(4);
    expect(visuals.domeGroup.position.z).toBe(-9);

    visuals.sync({ novaProgress: 0, aegisAlpha: 1, terminalActive: true, domePos: null, domeAlpha: 0 }, 0.05, true);
    expect(visuals.domeGroup.visible).toBe(false);

    visuals.hide();
    expect(visuals.domeGroup.visible).toBe(false);
  });
});
