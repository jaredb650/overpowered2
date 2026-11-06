import * as THREE from 'three';
import { rand } from '../../core/math';
import type { FxCore } from '../core';
import type { ChipShape } from '../layers/chips';
import type { Rgb } from '../layers/shared';

const TUMBLE = 7;

const _v = new THREE.Vector3();

/**
 * Writes one launch velocity for the dome into _v: uniform in a box with its far corners knocked off.
 * The first game sampled the raw box, and with thousands of bigger chips that shows up as a literal
 * rectangle in the air, so only the corners are rejected. It stays a squared-off upward dome with
 * nothing heading down at spawn.
 */
function dome(h: number, v: number): void {
  let a: number, b: number, c: number;
  do {
    a = rand(-1, 1);
    b = rand(-1, 1);
    c = Math.random();
  } while (a * a + b * b + c * c > 1.35);
  _v.set(a * h, c * v, b * h);
}

/**
 * The first game's createExplosion, the workhorse behind most of what players read as blood, impact
 * and fire. Life is fixed, so the whole burst reaches zero on one frame.
 */
export function chipBurst(
  core: FxCore, x: number, y: number, z: number, color: Rgb, count: number, floor: number,
  speed = 1, size = 1, shape: ChipShape = 'gem',
): void {
  const chips = core.chips.begin(shape, color, core.birth, 1, -20, floor);
  const h = 5 * speed;
  const v = 10 * speed;
  const r = 0.1 * size;
  for (let i = 0; i < count; i++) {
    dome(h, v);
    chips.add(x, y, z, _v.x, _v.y, _v.z, r, rand(-TUMBLE, TUMBLE), rand(-TUMBLE, TUMBLE), rand(-TUMBLE, TUMBLE));
  }
}

/** The 2.5x size, 1.8x speed, 1.5x life mode behind Hellfire's 360-chip monster. */
export function hellfireBurst(
  core: FxCore, x: number, y: number, z: number, color: Rgb, count: number, floor: number,
  speed = 1, size = 1,
): void {
  const chips = core.chips.begin('gem', color, core.birth, 1.5, -20, floor);
  const h = 9 * speed;
  const v = 18 * speed;
  for (let i = 0; i < count; i++) {
    const r = (0.1 + Math.random() * 0.3) * 2.5 * size;
    dome(h, v);
    chips.add(x, y, z, _v.x, _v.y, _v.z, r, rand(-TUMBLE, TUMBLE), rand(-TUMBLE, TUMBLE), rand(-TUMBLE, TUMBLE));
  }
}

const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _world = new THREE.Vector3(0, 1, 0);
const _alt = new THREE.Vector3(1, 0, 0);

/** Writes two unit vectors perpendicular to `n`. */
export function tangents(n: THREE.Vector3, t: THREE.Vector3, b: THREE.Vector3): void {
  t.crossVectors(Math.abs(n.y) > 0.9 ? _alt : _world, n).normalize();
  b.crossVectors(n, t);
}

/** The same box-sampled dome, opened around a surface normal so wall hits burst out of the wall. */
export function chipDome(
  core: FxCore, x: number, y: number, z: number, n: THREE.Vector3, color: Rgb, count: number, floor: number,
  speed = 1, size = 1, shape: ChipShape = 'gem', life = 1,
): void {
  tangents(n, _t, _b);
  const chips = core.chips.begin(shape, color, core.birth, life, -20, floor);
  const h = 5 * speed;
  const v = 10 * speed;
  const r = 0.1 * size;
  for (let i = 0; i < count; i++) {
    dome(h, v);
    chips.add(
      x, y, z,
      _t.x * _v.x + _b.x * _v.z + n.x * _v.y,
      _t.y * _v.x + _b.y * _v.z + n.y * _v.y,
      _t.z * _v.x + _b.z * _v.z + n.z * _v.y,
      r, rand(-TUMBLE, TUMBLE), rand(-TUMBLE, TUMBLE), rand(-TUMBLE, TUMBLE),
    );
  }
}

/** Fast, heavy sparks in a cone around `dir`. `spread` is the sideways speed as a fraction of `speed`. */
export function sparkCone(
  core: FxCore, x: number, y: number, z: number, dx: number, dy: number, dz: number, color: Rgb,
  count: number, floor: number, speed: number, spread: number, width = 0.022, life = 0.5,
): void {
  const s = core.streaks.begin(color, core.birth, life, -20, floor, 0.028, 1.2);
  for (let i = 0; i < count; i++) {
    const v = speed * rand(0.45, 1);
    const j = speed * spread;
    s.add(x, y, z, dx * v + rand(-j, j), dy * v + rand(-j, j), dz * v + rand(-j, j), width * rand(0.7, 1.2));
  }
}
