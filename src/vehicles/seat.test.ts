import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx, RayHit } from '../core/contracts';
import { GunnerSeat, type SeatPlan, type SeatRig } from './seat';

const PLAN: SeatPlan = {
  label: 'TEST', tone: 'door', seconds: 30, fov: 70, zoomFov: 40, aimZooms: true, arcCenter: Math.PI / 2, arcHalf: 1.2,
  pitchMin: -1.2, pitchMax: -0.3, lock: 1, roll: 1, eye: [0, 0.3, 0.7], reach: 400, grade: 'thermal', enemyColor: '#ff0000',
  grace: 2, shake: 0.5,
};

interface Log {
  unparked: number[];
  grades: (string | null)[];
  zoom: (number | null)[];
  seats: unknown[];
  panels: unknown[];
  flashes: number;
}

let log: Log;
const look = { x: 0, y: 0 };
const aimDown = { held: false };

/** A floor at y = 0 and nothing else. */
function floorRay(origin: THREE.Vector3, dir: THREE.Vector3, max: number, _mask: number, out: RayHit): boolean {
  if (dir.y >= 0) return false;
  const t = -origin.y / dir.y;
  if (t > max) return false;
  out.point.copy(origin).addScaledVector(dir, t);
  out.distance = t;
  return true;
}

function seated(plan: SeatPlan = PLAN): { seat: GunnerSeat; rig: SeatRig } {
  const ctx = {
    input: { frameLook: look, isDown: () => aimDown.held, pressed: () => false },
    player: {
      sensitivity: 0.002, lookScale: 1, invertY: false, grounded: true, position: new THREE.Vector3(),
      park() {}, unpark: (g: number) => log.unparked.push(g),
    },
    camera: { setSeat: (v: unknown) => log.seats.push(v), setZoom: (f: number | null) => log.zoom.push(f), syncSeat() {} },
    hud: { seat: (p: unknown) => log.panels.push(p) },
    render: { highlight() {}, post: { flash: () => log.flashes++ } },
    enemies: { alive: [] },
    physics: { raycastInto: floorRay },
    world: { objects: { hazardAt: () => null }, nav: { nearest: () => false }, playerSpawns: [] },
  } as unknown as Ctx;
  const rig = {
    seat: null, prisoners: new Set<number>(), shell: { show() {}, hide() {}, update() {} }, hud: { open() {} },
    holdGrade: (g: string | null) => log.grades.push(g),
  } as unknown as SeatRig;
  const seat = new GunnerSeat(ctx, rig, plan);
  seat.board();
  return { seat, rig };
}

/** Nose along +Z, flying level. */
const level = new THREE.Quaternion();

beforeEach(() => {
  log = { unparked: [], grades: [], zoom: [], seats: [], panels: [], flashes: 0 };
  look.x = look.y = 0;
  aimDown.held = false;
});

describe('GunnerSeat aim', () => {
  it('starts on the target it was told to look at', () => {
    const { seat } = seated();
    const pivot = new THREE.Vector3(0, 30, 0);
    seat.sit(new THREE.Vector3(40, 0, 0), pivot);
    seat.update(1 / 60, level, pivot);
    expect(seat.aim.x).toBeGreaterThan(0.7);
    expect(seat.aim.y).toBeLessThan(0);
  });

  it('holds its spot on the ground while the aircraft flies past', () => {
    const { seat } = seated();
    const pivot = new THREE.Vector3(0, 30, 0);
    seat.sit(new THREE.Vector3(40, 0, 0), pivot);
    seat.update(1 / 60, level, pivot);
    const spot = seat.point.clone();
    for (let i = 0; i < 120; i++) {
      pivot.z += 12 / 60;
      seat.update(1 / 60, level, pivot);
    }
    // The eye swings with the aim, so one correction a frame leaves about 1% of the distance flown.
    expect(seat.point.distanceTo(spot)).toBeLessThan(0.5);
  });

  it('drifts with the aircraft when there is no lock', () => {
    const { seat } = seated({ ...PLAN, lock: 0 });
    const pivot = new THREE.Vector3(0, 30, 0);
    seat.sit(new THREE.Vector3(40, 0, 0), pivot);
    seat.update(1 / 60, level, pivot);
    const spot = seat.point.clone();
    for (let i = 0; i < 120; i++) {
      pivot.z += 12 / 60;
      seat.update(1 / 60, level, pivot);
    }
    expect(seat.point.distanceTo(spot)).toBeGreaterThan(20);
  });

  it('stops at the end of its arc, measured from the door and not the nose', () => {
    const { seat } = seated();
    const pivot = new THREE.Vector3(0, 30, 0);
    seat.sit(new THREE.Vector3(40, 0, 0), pivot);
    look.x = 5000;
    seat.update(1 / 60, level, pivot);
    look.x = 0;
    // Nose +Z is yaw pi, and the left door is a quarter turn further on.
    const middle = Math.PI + Math.PI / 2;
    expect(Math.abs(Math.sin((seat.yaw - middle) / 2) * 2)).toBeCloseTo(2 * Math.sin(1.2 / 2), 4);
  });

  it('turns with the aircraft, so the arc swings round with the door', () => {
    const { seat } = seated({ ...PLAN, lock: 0 });
    const pivot = new THREE.Vector3(0, 30, 0);
    seat.sit(new THREE.Vector3(40, 0, 0), pivot);
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    seat.update(1 / 60, turned, pivot);
    expect(seat.aim.x).toBeLessThan(0.45);
  });

  it('will not point above its stop or below its floor', () => {
    const { seat } = seated();
    const pivot = new THREE.Vector3(0, 30, 0);
    seat.sit(new THREE.Vector3(40, 0, 0), pivot);
    look.y = -5000;
    seat.update(1 / 60, level, pivot);
    expect(seat.pitch).toBeCloseTo(PLAN.pitchMax, 6);
    look.y = 5000;
    seat.update(1 / 60, level, pivot);
    expect(seat.pitch).toBeCloseTo(PLAN.pitchMin, 6);
  });

  it('rolls the view looking along a bank, and not looking out of the side of it', () => {
    const bank = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.3);
    const pivot = new THREE.Vector3(0, 30, 0);

    const side = seated({ ...PLAN, lock: 0 }).seat;
    side.sit(new THREE.Vector3(40, 0, 0), pivot);
    side.update(1 / 60, bank, pivot);
    expect(Math.abs(side.view.roll)).toBeLessThan(0.15);

    const ahead = seated({ ...PLAN, lock: 0, arcCenter: 0 }).seat;
    ahead.sit(new THREE.Vector3(0, 0, 40), pivot);
    ahead.update(1 / 60, bank, pivot);
    expect(Math.abs(ahead.view.roll)).toBeGreaterThan(0.2);
  });

  it('counts down only what it is given, and zooms on the key', () => {
    const { seat } = seated();
    const pivot = new THREE.Vector3(0, 30, 0);
    seat.sit(new THREE.Vector3(40, 0, 0), pivot);
    seat.update(0.5, level, pivot);
    expect(seat.left).toBeCloseTo(29.5, 6);
    aimDown.held = true;
    seat.update(0.01, level, pivot);
    expect(log.zoom.at(-1)).toBe(PLAN.zoomFov);
    aimDown.held = false;
    seat.update(0.01, level, pivot);
    expect(log.zoom.at(-1)).toBe(PLAN.fov);
  });
});

describe('GunnerSeat exit', () => {
  it('undoes everything it did, from any stage', () => {
    for (const sit of [false, true]) {
      log = { unparked: [], grades: [], zoom: [], seats: [], panels: [], flashes: 0 };
      const { seat, rig } = seated();
      if (sit) seat.sit(new THREE.Vector3(40, 0, 0), new THREE.Vector3(0, 30, 0));
      seat.leave();
      expect(rig.seat).toBeNull();
      expect(log.seats.at(-1)).toBeNull();
      expect(log.panels.at(-1)).toBeNull();
      expect(log.zoom.at(-1)).toBeNull();
      expect(log.grades.at(-1)).toBeNull();
      expect(log.unparked).toEqual([PLAN.grace]);
    }
  });

  it('can be left twice and only hands back once', () => {
    const { seat } = seated();
    seat.leave();
    seat.leave();
    seat.leave(true);
    expect(log.unparked).toEqual([PLAN.grace]);
  });

  it('gives no grace and no flash to a new run', () => {
    const { seat } = seated();
    const before = log.flashes;
    seat.leave(true);
    expect(log.unparked).toEqual([0]);
    expect(log.flashes).toBe(before);
  });

  it('leaves the grade to the perks when it never held one', () => {
    const { seat } = seated({ ...PLAN, grade: null });
    seat.sit(new THREE.Vector3(40, 0, 0), new THREE.Vector3(0, 30, 0));
    seat.leave();
    expect(log.grades).toEqual([]);
  });
});
