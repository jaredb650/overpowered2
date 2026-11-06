import * as THREE from 'three';
import { clamp, rand } from '../../core/math';
import type { FxCore } from '../core';
import { BLOOD_TONE, CHIP } from '../palette';
import { STAIN_SCALE } from '../stains';
import { chipBurst } from './bursts';

const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Inside this range a burst lands on the lens. */
const POINT_BLANK = 3;

function spatter(core: FxCore, position: THREE.Vector3, amount: number): void {
  const d = core.ctx.render.camera.position.distanceTo(position);
  if (d < POINT_BLANK) core.lens?.splatter(amount * (1 - d / POINT_BLANK));
}

/**
 * A fan of strands leaving one point. Speed varies along the axis and little across it, which is what
 * keeps it a jet: base speed against sideways jitter stays near the first game's 5:1. Strands leave a
 * few milliseconds apart, so they trail each other as a stream instead of arriving as a wall.
 */
function stream(
  core: FxCore, x: number, y: number, z: number, dx: number, dy: number, dz: number, count: number,
  speed: number, jitter: number, half: number, trail: number, drag: number, delay: number, stains: number,
): void {
  const b = core.blood;
  for (let i = 0; i < count; i++) {
    const v = speed * rand(0.72, 1.12);
    // Every other one breaks off as a stretched drop, which keeps a burst from reading as a fan of needles.
    const drop = (i & 1) === 1;
    const w = half * rand(0.6, 1.3) * (drop ? 1.2 : 1);
    const wait = delay + i * 0.014;
    const l = b.add(
      x, y, z, dx * v + rand(-jitter, jitter), dy * v + rand(-jitter, jitter), dz * v + rand(-jitter, jitter),
      w, trail * rand(0.8, 1.2) * (drop ? 0.3 : 1.15), drag * rand(0.8, 1.3), wait,
    );
    if (i < stains) core.stains.book(core.bloodNow + wait + l.time, l, w * STAIN_SCALE);
  }
}

/** A few fat drops that barely leave the wound. They are what falls last and lands closest. */
function drops(
  core: FxCore, x: number, y: number, z: number, dx: number, dy: number, dz: number, count: number,
  speed: number, delay: number,
): void {
  stream(core, x, y, z, dx, dy, dz, count, speed, speed * 0.3, 0.02, 0.022, 0.55, delay, count);
}

/**
 * The tight pressurised stream: one push of the heart. A hard front, then two weaker pulses that do not
 * reach as far, then what is left falling out. `intensity` is pressure, not count, because a gib fires
 * this three times over and its detail has to come from reach and from stains.
 */
export function bloodJet(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, intensity = 1): void {
  const { x, y, z } = position;
  const pressure = Math.sqrt(clamp(intensity, 0.25, 4));
  const b = core.blood.begin(core.bloodNow, core.floorAt(x, y, z), core.wallAlong(x, y, z, dir.x, dir.y, dir.z), BLOOD_TONE.arterial);
  const beats = intensity < 0.75 ? 2 : 3;
  for (let beat = 0; beat < beats; beat++) {
    const v = 8.5 * pressure * (1 - beat * 0.3);
    stream(core, x, y, z, dir.x, dir.y, dir.z, beat === 0 ? 4 : 3, v, v / 5.5, 0.014, 0.15, 1.5, beat * 0.13, 2);
  }
  b.setTone(BLOOD_TONE.venous);
  drops(core, x, y, z, dir.x, dir.y, dir.z, 2, 2.8 * pressure, beats * 0.13);
  b.mist(x, y, z, dir.x * 6, dir.y * 6, dir.z * 6, 0.15 * pressure, 0.26, 7, 0.9);
}

/**
 * A bullet going in. Most of it leaves with the bullet, but the player stands on the side the bullet came
 * from, so a finer back-spatter is what reads. No chips, no flash: a wound does not light up.
 */
export function bloodHit(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, intensity = 1): void {
  const { x, y, z } = position;
  const p = Math.sqrt(clamp(intensity, 0.25, 3));
  const b = core.blood.begin(core.bloodNow, core.floorAt(x, y, z), core.wallAlong(x, y, z, dir.x, dir.y, dir.z), BLOOD_TONE.wound);
  stream(core, x, y, z, dir.x, dir.y, dir.z, 3, 6.5 * p, 1.2, 0.012, 0.09, 2.2, 0, 2);
  stream(core, x, y, z, -dir.x, 0.45 - dir.y, -dir.z, 3, 3.6 * p, 1.7, 0.0095, 0.08, 2.2, 0, 0);
  drops(core, x, y, z, dir.x, dir.y, dir.z, 2, 2.4 * p, 0.03);
  b.mist(x, y, z, -dir.x * 2.2, 0.4 - dir.y * 2.2, -dir.z * 2.2, 0.13 * p, 0.2, 8, 0.85);
}

/** A faint breath of fine drops. It is gone in half a second: blood mist that hangs is a video game effect. */
export function bloodMist(core: FxCore, position: THREE.Vector3, size = 1): void {
  const { x, y, z } = position;
  const b = core.blood.begin(core.bloodNow, -1e6, null, BLOOD_TONE.wound);
  for (let i = 0; i < 3; i++) {
    _v.set(rand(-1, 1), rand(-0.3, 0.6), rand(-1, 1)).normalize().multiplyScalar(rand(0.8, 2));
    b.mist(x, y, z, _v.x, _v.y, _v.z, 0.15 * size, rand(0.35, 0.55), 6, 0.5);
  }
}

/**
 * Whole-body burst. The meat, bone and viscera are real bodies in gore, and gore fires three jets on top
 * of this, so what is left to do here is the sheet of blood thrown off by the blast. `force` is roughly
 * 0..20, the blast force on the body.
 */
export function gibBurst(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, force: number): void {
  const { x, y, z } = position;
  const f = Math.sqrt(clamp(force / 10, 0.4, 1.6));
  const b = core.blood.begin(core.bloodNow, core.floorAt(x, y, z), core.wallAlong(x, y, z, dir.x, dir.y, dir.z), BLOOD_TONE.arterial);
  for (let i = 0; i < 3; i++) {
    _v.set(dir.x + rand(-0.3, 0.3), dir.y + rand(0, 0.35), dir.z + rand(-0.3, 0.3)).normalize();
    stream(core, x, y, z, _v.x, _v.y, _v.z, 5, 11 * f, 2.2, 0.012, 0.1, 1.6, i * 0.02, 3);
  }
  b.setTone(BLOOD_TONE.venous);
  for (let i = 0; i < 6; i++) {
    _v.set(dir.x + rand(-0.8, 0.8), dir.y + rand(0, 0.9), dir.z + rand(-0.8, 0.8)).normalize();
    drops(core, x, y, z, _v.x, _v.y, _v.z, 1, rand(4, 8) * f, i * 0.02);
  }
  for (let i = 0; i < 2; i++) b.mist(x, y, z, dir.x * 5 + rand(-1, 1), dir.y * 5 + rand(0, 2), dir.z * 5 + rand(-1, 1), 0.22, 0.3, 7, 0.8);
  spatter(core, position, 1);
}

/**
 * The signature: 20 yellow chips on the same frame as the triple-layered sound. The chips and the flash
 * are the game's language and they stay exactly as they were. The blood around them is a geyser and a
 * crown of thin strands, and the skull itself is gore's.
 */
export function headBurst(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3): void {
  const { x, y, z } = position;
  chipBurst(core, x, y, z, CHIP.yellow, 20, core.floorAt(x, y, z));
  bloodJet(core, position, UP, 1.3);
  core.blood.setTone(BLOOD_TONE.arterial);
  for (let i = 0; i < 6; i++) {
    _v.set(dir.x * 0.7 + rand(-0.7, 0.7), rand(0.35, 1), dir.z * 0.7 + rand(-0.7, 0.7)).normalize();
    stream(core, x, y, z, _v.x, _v.y, _v.z, 1, rand(5, 9), 0.8, 0.008, 0.08, 1.8, 0, 1);
  }
  core.flashes.star(x, y, z, CHIP.yellow, 0.42, core.now, 0.05, 6, 0.24, 0.7, 0.4, 5);
  spatter(core, position, 0.7);
}
