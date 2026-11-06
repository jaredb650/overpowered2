/**
 * A fixed flight: a mission's ride, along marks, hovering where it is told to. Like `OrbitPath` this is a pure function of time, so any
 * moment of it can be read without simulating it.
 *
 * It flies a smooth curve through the marks, with the nose along the curve. It slows into a hover and picks up speed out of one.
 */
import * as THREE from 'three';
import { clamp } from '../core/math';

export interface FlightMark {
  x: number;
  y: number;
  z: number;
  /** Seconds it hovers here. */
  hold: number;
  /** The mission's name for it. */
  name: string;
  /** The aircraft takes a hit here, and flies the rest of the way burning. */
  hit: boolean;
}

export interface Flight {
  readonly marks: readonly FlightMark[];
  /** It has got to a mark. */
  reached(name: string): void;
}

interface Leg {
  /** Curve parameter at each end. */
  from: number;
  to: number;
  start: number;
  seconds: number;
  easeIn: boolean;
  easeOut: boolean;
}

/** A leg that has to slow down takes this much longer than its length at full speed. */
const EASED = 1.45;
/** Radians of roll per radian a second of turn. */
const BANK = 0.9;
const MAX_ROLL = 0.28;
const AHEAD = 0.004;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export class FlightPath {
  /** Seconds in, when the last mark is reached. */
  readonly ends: number;
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly legs: Leg[] = [];
  private readonly arrivals: number[] = [];

  constructor(marks: readonly FlightMark[], speed: number) {
    this.curve = new THREE.CatmullRomCurve3(marks.map(m => new THREE.Vector3(m.x, m.y, m.z)), false, 'centripetal');
    const last = Math.max(marks.length - 1, 1);
    let clock = 0;
    this.arrivals.push(0);
    for (let i = 0; i + 1 < marks.length; i++) {
      const a = marks[i]!;
      const b = marks[i + 1]!;
      const easeIn = a.hold > 0 || i === 0;
      const easeOut = b.hold > 0 || i + 2 === marks.length;
      const metres = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const seconds = (metres / speed) * (easeIn || easeOut ? EASED : 1);
      clock += a.hold;
      this.legs.push({ from: i / last, to: (i + 1) / last, start: clock, seconds, easeIn, easeOut });
      clock += seconds;
      this.arrivals.push(clock);
    }
    this.ends = clock + (marks[marks.length - 1]?.hold ?? 0);
  }

  /** When it gets to mark `index`. */
  arrival(index: number): number {
    return this.arrivals[index] ?? this.ends;
  }

  /** Where on the curve it is at `t`. */
  private parameter(t: number): number {
    const { legs } = this;
    for (let i = legs.length - 1; i >= 0; i--) {
      const leg = legs[i]!;
      if (t < leg.start) continue;
      const s = clamp((t - leg.start) / leg.seconds);
      const eased = leg.easeIn && leg.easeOut ? s * s * (3 - 2 * s) : leg.easeOut ? 1 - (1 - s) * (1 - s) : leg.easeIn ? s * s : s;
      return leg.from + (leg.to - leg.from) * eased;
    }
    return 0;
  }

  at(t: number, out: THREE.Vector3): THREE.Vector3 {
    return this.curve.getPoint(this.parameter(t), out);
  }

  /** Along the curve, and level: a hover keeps the nose where it was when it stopped. */
  heading(t: number, out: THREE.Vector3): THREE.Vector3 {
    const u = Math.min(this.parameter(t), 1 - AHEAD);
    this.curve.getPoint(u, _a);
    this.curve.getPoint(u + AHEAD, _b);
    return out.subVectors(_b, _a).setY(0).normalize();
  }

  /** Into the bend. Negative dips the left wing, as `Airframe.fly` takes it. */
  roll(t: number): number {
    this.heading(t, _a);
    this.heading(t + 0.5, _c);
    const turn = Math.atan2(_a.z * _c.x - _a.x * _c.z, _a.x * _c.x + _a.z * _c.z) / 0.5;
    return clamp(-turn * BANK, -MAX_ROLL, MAX_ROLL);
  }
}
