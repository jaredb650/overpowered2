/**
 * The Frame as a seat whose mount walks: the body parked and carried in the cockpit, every hit the Frame's, the view held
 * in the legs' arc, no way out, and everything given back on the way out. Real Rapier under the walker; the rest stands in.
 */
import * as THREE from 'three';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Ctx, PlayerDamage } from '../core/contracts';
import { wrapAngle } from '../core/math';
import { Physics } from '../physics/Physics';
import { ModelMaterials } from '../progression/modelkit';
import type { SeatRig } from '../vehicles/seat';
import { ROUND_KINDS } from '../progression/callins/ac130Rounds';
import { FRAME } from './data';
import { defaultLoadout, fitPart, kitIds } from './loadout';
import { MECH_POSE } from './puppet';
import { Frame, solveSlamMarker } from './seat';

const DT = 1 / 60;

/** Anything not given is a function that returns itself, so the Frame can call into any system it likes. */
const sink: unknown = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : sink), apply: () => sink });

function stub<T>(o: Record<string, unknown>): T {
  return new Proxy(o, {
    get(t, k) {
      if (!(k in t)) return sink;
      const v = t[k as string];
      return v && typeof v === 'object' && v.constructor === Object ? stub(v as Record<string, unknown>) : v;
    },
  }) as T;
}

let physics: Physics;
let frame: Frame;
let rig: SeatRig;
const keys = { down: new Set<string>(), pressed: new Set<string>() };
const look = { x: 0, y: 0 };
const log = { parked: [] as { feet: THREE.Vector3; exposed: boolean }[], carried: [] as THREE.Vector3[], unparked: 0, teleported: 0 };
const player = {
  position: new THREE.Vector3(), alive: true, sensitivity: 0.002, lookScale: 1, invertY: false, grounded: true,
  interceptor: null as ((d: PlayerDamage) => boolean) | null,
  park: (feet: THREE.Vector3, exposed = false) => log.parked.push({ feet: feet.clone(), exposed }),
  unpark: () => log.unparked++,
  carry: (feet: THREE.Vector3) => log.carried.push(feet.clone()),
  teleport: (at: THREE.Vector3) => {
    player.position.copy(at);
    log.teleported++;
  },
};

beforeAll(async () => {
  physics = await Physics.create();
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(100, 0.5, 100), null, 'concrete');
  physics.flushQueries();
  const ctx = stub<Ctx>({
    physics,
    player,
    input: {
      frameLook: look, isDown: (a: string) => keys.down.has(a), pressed: (a: string) => keys.pressed.has(a), labelFor: (a: string) => a,
    },
    render: {
      scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(84, 1.6, 0.05, 2000), materials: { patch: (m: THREE.Material) => m },
      renderer: { domElement: { clientHeight: 900, style: {} } },
    },
    world: { bounds: new THREE.Box3(new THREE.Vector3(-100, -1, -100), new THREE.Vector3(100, 30, 100)), nav: { nearest: () => false } },
    enemies: { alive: [], query: () => 0, vehicles: null },
    events: { on: () => () => undefined },
  });
  rig = {
    seat: null, get occupied() { return rig.seat !== null; },
    prisoners: new Set<number>(), shell: { show() {}, hide() {}, update() {} }, hud: { open() {} }, holdGrade() {},
  } as unknown as SeatRig;
  frame = new Frame(ctx, new ModelMaterials(ctx), rig, () => undefined);
});

beforeEach(() => {
  frame.clear();
  keys.down.clear();
  keys.pressed.clear();
  look.x = look.y = 0;
  log.parked.length = log.carried.length = 0;
  log.unparked = log.teleported = 0;
  player.position.set(0, 0, 0);
  frame.board(new THREE.Vector3(0, 0, 0), 0);
});

const frames = (n: number) => {
  for (let i = 0; i < n; i++) frame.update(DT);
};

describe('boarding', () => {
  it('parks the body where the hits still reach it, and routes hits into the 4000 HP armored hull', () => {
    expect(log.parked).toHaveLength(1);
    expect(log.parked[0]!.exposed).toBe(true);
    expect(frame.occupied).toBe(true);
    expect(frame.deployed).toBe(true);
    expect(rig.seat).not.toBeNull();
    expect(rig.seat!.noWayOut).toBe(false);
    expect(player.interceptor).not.toBeNull();
    expect(frame.health).toBe(FRAME.hull.maxHealth);
    // Small arms are heavily mitigated by the armor plates.
    expect(player.interceptor!({ amount: 500, type: 'bullet', source: 'test' })).toBe(true);
    expect(frame.health).toBeCloseTo(FRAME.hull.maxHealth - 500 * FRAME.hull.bulletMult, 1);
    // Hits from behind into the reactor slats deal 1.5x damage.
    const beforeRear = frame.health;
    expect(player.interceptor!({ amount: 200, type: 'explosive', source: 'rocket', from: new THREE.Vector3(0, 2, 10) })).toBe(true);
    expect(beforeRear - frame.health).toBeCloseTo(200 * FRAME.hull.rearMult, 1);
  });

  it('carries the body in the cockpit every frame, the eye at 5.2 m over the feet, as it walks', () => {
    keys.down.add('forward');
    frames(120);
    expect(log.carried).toHaveLength(120);
    const body = log.carried[119]!;
    const feet = frame.walker.feet;
    expect(feet.z).toBeLessThan(-5);
    // The body's own eye (1.6 m over its feet) is the Frame's: 5.2 m up, give or take the stride's dip.
    expect(body.y + 1.6 - feet.y).toBeGreaterThan(FRAME.eye - 0.3);
    expect(body.y + 1.6 - feet.y).toBeLessThan(FRAME.eye + 0.3);
    expect(Math.hypot(body.x - feet.x, body.z - feet.z)).toBeLessThan(FRAME.podAhead + 0.2);
    // And the view is that eye.
    expect(rig.seat!.view.position.distanceTo(body.clone().setY(body.y + 1.6))).toBeLessThan(0.01);
  });
});

describe('the view', () => {
  it('is held within 80 degrees of the legs, and the mouse past the edge drags them round', () => {
    // A long sweep to the left, faster than the legs can turn.
    look.x = -40;
    frames(60);
    const seat = rig.seat!;
    const off = wrapAngle(seat.yaw - frame.walker.legYaw);
    expect(Math.abs(off)).toBeLessThanOrEqual(FRAME.turn.arc + 1e-6);
    expect(frame.walker.legYaw).toBeGreaterThan(0.5);
    // The seat's view and the walker's agree, so the cockpit is posed where the camera is.
    expect(wrapAngle(seat.yaw - frame.walker.viewYaw)).toBeCloseTo(0, 6);
  });
});

describe('the way out and re-boarding', () => {
  it('E disembarks cleanly beside the parked mech and E beside it climbs back in with health preserved', () => {
    // Take some hull damage first so we can verify persistence across exit/re-board.
    player.interceptor!({ amount: 500, type: 'explosive', source: 'rocket' });
    const damagedHp = frame.health;
    expect(damagedHp).toBe(FRAME.hull.maxHealth - 500);
    // Advance past the 0.25 s interact guard, then press E to disembark.
    frames(20);
    keys.pressed.add('interact');
    frames(1);
    keys.pressed.clear();
    expect(frame.occupied).toBe(false);
    expect(frame.deployed).toBe(true);
    expect(frame.parked).toBe(true);
    expect(log.unparked).toBe(1);
    expect(log.teleported).toBe(1);
    expect(player.interceptor).toBeNull();
    // Advance past guard and press E beside the parked mech to climb back in.
    frames(20);
    keys.pressed.add('interact');
    frames(1);
    keys.pressed.clear();
    expect(frame.occupied).toBe(true);
    expect(frame.health).toBe(damagedHp);
    expect(player.interceptor).not.toBeNull();
  });

  it('gives everything back when the seat is emptied from outside: death, a new run', () => {
    rig.seat!.leave();
    frames(1);
    expect(frame.occupied).toBe(false);
    expect(log.unparked).toBe(1);
    expect(player.interceptor).toBeNull();
    frames(10);
    expect(log.carried).toHaveLength(0);
  });

  it('explodes and safely ejects the pilot when hull health hits zero', () => {
    player.interceptor!({ amount: FRAME.hull.maxHealth + 500, type: 'explosive', source: 'tank' });
    expect(frame.health).toBe(0);
    expect(frame.occupied).toBe(false);
    expect(frame.deployed).toBe(false);
    expect(log.teleported).toBe(1);
    expect(player.interceptor).toBeNull();
  });

  it('leaves by a script with the body put down beside it, keeping the Frame parked', () => {
    frame.leave();
    expect(frame.occupied).toBe(false);
    expect(frame.deployed).toBe(true);
    expect(log.unparked).toBe(1);
    expect(log.teleported).toBe(1);
    expect(player.interceptor).toBeNull();
  });
});

describe('the loadout', () => {
  it('boards the standard Frame unless told otherwise: the rotary left, the 40 mm right, the pod on', () => {
    expect(frame.loadout).toEqual(defaultLoadout());
    expect(frame.guns.left.kind).toBe('rotary');
    expect(frame.guns.right.kind).toBe('cannon40');
    expect(frame.armWeapon).toBe('cannon40');
    expect(frame.guns.podOnline).toBe(true);
    expect(rig.seat!.status).toBe('ROTARY 20MM AP · 40MM HE');
  });

  it('builds a call-in from its loadout, each arm on its side, and tells the other players the parts with every pose', () => {
    const poses: number[][] = [];
    const shells: number[][] = [];
    frame.net = { pose: v => { if (v) poses.push(v); }, news: (k, v) => { if (k === 'shell' && v) shells.push(v); } };
    const kit = fitPart(fitPart(defaultLoadout(), 'cannonL'), 'howitzerR');
    frame.board(new THREE.Vector3(0, 0, 0), 0, Infinity, false, kit);
    expect(frame.loadout).toEqual(kit);
    expect(frame.guns.left.kind).toBe('cannon40');
    expect(frame.guns.right.kind).toBe('howitzer105');
    // LMB: a 40 mm from the left arm, said as the left's.
    keys.down.add('fire');
    frames(2);
    keys.down.delete('fire');
    expect(shells).toHaveLength(1);
    expect(shells[0]![8]).toBe(0);
    // RMB: the 105 mm, from the right.
    keys.down.add('aim');
    frames(2);
    keys.down.delete('aim');
    expect(shells).toHaveLength(2);
    expect(shells[1]![0]).toBe(ROUND_KINDS.indexOf('g105'));
    expect(shells[1]![8]).toBe(1);
    frames(30);
    const last = poses[poses.length - 1]!;
    expect(last.slice(MECH_POSE)).toEqual(kitIds(kit));
    expect(rig.seat!.status).toBe('40MM HE · 105MM HOWITZER');
    // Foreclosure's upgrade swaps only the right arm, and the next pose says so.
    frame.installWeapon('cannon40', true);
    expect(frame.loadout.rightArm).toBe('cannonR');
    expect(frame.loadout.leftArm).toBe('cannonL');
    frame.net = null;
  });
});

describe('third-person view', () => {
  it('toggles cleanly between 1P cockpit and 3P over-the-shoulder chase camera with HUD updates', () => {
    expect(frame.thirdPerson).toBe(false);
    frames(2);
    const firstPersonPos = rig.seat!.view.position.clone();
    frame.toggleThirdPerson();
    expect(frame.thirdPerson).toBe(true);
    frames(15);
    const thirdPersonPos = rig.seat!.view.position.clone();
    // Looking down -Z (yaw = 0): 3P camera sits behind (+Z) and slightly right (+X) of the cockpit eye.
    expect(thirdPersonPos.z - firstPersonPos.z).toBeGreaterThan(7);
    expect(thirdPersonPos.x - firstPersonPos.x).toBeGreaterThan(0.5);
    expect(rig.seat!.status).toContain('· 3P');
    expect(rig.seat!.hintText).toContain('X VIEW (3P)');
    // Toggling back snaps right back to 1P cockpit eye.
    frame.toggleThirdPerson();
    expect(frame.thirdPerson).toBe(false);
    frames(2);
    expect(rig.seat!.view.position.distanceTo(firstPersonPos)).toBeLessThan(0.2);
    expect(rig.seat!.status).not.toContain('· 3P');
  });
});

describe('Pile-Driver aimed angled slam', () => {
  it('solveSlamMarker paints walkable ground along aim, clamps far targets, and falls back smoothly when aiming at sky', () => {
    const out = new THREE.Vector3();
    const feet = new THREE.Vector3(0, 8, 0);
    const origin = new THREE.Vector3(0, 12, 0);
    // Downward-forward aim hits the y = 0 floor ahead (-Z).
    const aimDown = new THREE.Vector3(0, -0.5, -0.866).normalize();
    expect(solveSlamMarker(physics, origin, aimDown, feet, out)).toBe(true);
    expect(out.y).toBeCloseTo(0, 1);
    expect(out.z).toBeLessThan(-10);
    // Far aim gets clamped within maxHoriz (25 m test limit).
    expect(solveSlamMarker(physics, origin, new THREE.Vector3(0, -0.05, -0.998).normalize(), feet, out, 90, 25)).toBe(true);
    expect(Math.hypot(out.x - feet.x, out.z - feet.z)).toBeLessThanOrEqual(25.1);
    // Aiming into open sky projects down onto reachable floor ahead instead of failing.
    expect(solveSlamMarker(physics, origin, new THREE.Vector3(0, 0.7, -0.714).normalize(), feet, out, 58, 42)).toBe(true);
    expect(out.y).toBeCloseTo(0, 1);
    expect(out.z).toBeLessThan(-10);
  });

  it('holds C/Ctrl mid-air with Pile-Driver legs to paint target and hover-brake, then releases to angled dive-slam forward', () => {
    const heavyKit = fitPart(defaultLoadout(), 'legsHeavy');
    frame.board(new THREE.Vector3(0, 0, 0), 0, Infinity, false, heavyKit);
    expect(rig.seat!.hintText).toContain('AIM SLAM');

    // Lift off with jump jets.
    keys.down.add('jump');
    frames(35);
    keys.down.delete('jump');
    expect(frame.walker.grounded).toBe(false);
    expect(frame.walker.clearance()).toBeGreaterThan(1.2);

    // Pitch slightly downward so crosshair aims at the floor ahead, then hold C/Ctrl ('slide').
    rig.seat!.pitch = -0.35;
    keys.down.add('slide');
    keys.pressed.add('slide');
    frames(1);
    keys.pressed.clear();
    frames(14);
    expect(frame.slamAiming).toBe(true);
    expect(frame.walker.stomping).toBe(false);
    expect(frame.slamTarget.z).toBeLessThan(-5);
    expect(rig.seat!.status).toContain('SLAM LOCKED');

    // Release C/Ctrl to rocket diagonally into the painted ground target.
    const paintedZ = frame.slamTarget.z;
    keys.down.delete('slide');
    frames(1);
    expect(frame.slamAiming).toBe(false);
    expect(frame.walker.stomping).toBe(true);
    expect(frame.walker.stompTargeted).toBe(true);

    // Advance until touchdown; mech should land well forward toward the painted target.
    for (let i = 0; i < 90 && !frame.walker.grounded; i++) frames(1);
    expect(frame.walker.grounded).toBe(true);
    expect(frame.walker.stompTargeted).toBe(false);
    expect(frame.walker.feet.z).toBeLessThan(-4);
    expect(Math.abs(frame.walker.feet.z - paintedZ)).toBeLessThan(6);
  });
});

