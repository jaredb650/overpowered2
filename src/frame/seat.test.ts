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
import { FRAME } from './data';
import { Frame } from './seat';

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
  position: new THREE.Vector3(), sensitivity: 0.002, lookScale: 1, invertY: false, grounded: true,
  interceptor: null as ((d: PlayerDamage) => boolean) | null,
  park: (feet: THREE.Vector3, exposed = false) => log.parked.push({ feet: feet.clone(), exposed }),
  unpark: () => log.unparked++,
  carry: (feet: THREE.Vector3) => log.carried.push(feet.clone()),
  teleport: () => log.teleported++,
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
  rig = { seat: null, prisoners: new Set<number>(), shell: { show() {}, hide() {}, update() {} }, hud: { open() {} }, holdGrade() {} } as unknown as SeatRig;
  frame = new Frame(ctx, new ModelMaterials(ctx), rig, () => undefined);
});

beforeEach(() => {
  frame.clear();
  keys.down.clear();
  keys.pressed.clear();
  look.x = look.y = 0;
  log.parked.length = log.carried.length = 0;
  log.unparked = log.teleported = 0;
  frame.board(new THREE.Vector3(0, 0, 0), 0);
});

const frames = (n: number) => {
  for (let i = 0; i < n; i++) frame.update(DT);
};

describe('boarding', () => {
  it('parks the body where the hits still reach it, and gives every one of them to the Frame', () => {
    expect(log.parked).toHaveLength(1);
    expect(log.parked[0]!.exposed).toBe(true);
    expect(frame.occupied).toBe(true);
    expect(rig.seat).not.toBeNull();
    expect(rig.seat!.noWayOut).toBe(true);
    expect(player.interceptor).not.toBeNull();
    expect(player.interceptor!({ amount: 500, type: 'bullet', source: 'test' })).toBe(true);
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

describe('the way out', () => {
  it('has no key', () => {
    keys.pressed.add('interact');
    frames(5);
    expect(frame.occupied).toBe(true);
    expect(log.unparked).toBe(0);
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

  it('puts the player out beside it when a call-in\'s seconds run down', () => {
    frame.board(new THREE.Vector3(0, 0, 0), 0, 1);
    log.teleported = 0;
    frames(50);
    expect(frame.occupied).toBe(true);
    frames(20);
    expect(frame.occupied).toBe(false);
    expect(log.teleported).toBe(1);
    expect(player.interceptor).toBeNull();
  });

  it('leaves by a script with the body put down beside it', () => {
    frame.leave();
    expect(frame.occupied).toBe(false);
    expect(log.unparked).toBe(1);
    expect(log.teleported).toBe(1);
    expect(player.interceptor).toBeNull();
  });
});
