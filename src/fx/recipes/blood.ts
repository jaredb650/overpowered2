import * as THREE from 'three';
import type { BloodPuffKind } from '../../core/contracts';
import { clamp, rand } from '../../core/math';
import type { FxCore } from '../core';
import { BLOOD_TONE } from '../palette';
import { STAIN_SCALE } from '../stains';

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
  b.mist(x, y, z, dir.x * 6, dir.y * 6, dir.z * 6, 0.15 * pressure, 0.26, 7, 0.6);
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
  stream(core, x, y, z, dir.x * -0.7, 0.75 - dir.y * 0.7, dir.z * -0.7, 3, 4.6 * p, 1.1, 0.0095, 0.08, 1.8, 0, 3);
  drops(core, x, y, z, dir.x, dir.y, dir.z, 2, 2.4 * p, 0.03);
  b.mist(x, y, z, -dir.x * 2.0, 0.45 - dir.y * 2.0, -dir.z * 2.0, 0.18 * p, 0.32, 6.5, 0.68);
}

/**
 * High-speed razor-thin blood needles flung outward on frames 0-3 (the initial ballistic whip ahead of a
 * real blood mist burst). Pre-led slightly along flight so they whip clearly past the splash silhouette on
 * frame 1 and brake midair under high drag.
 */
function burstStreaks(
  core: FxCore, x: number, y: number, z: number, dx: number, dy: number, dz: number,
  count: number, speed: number, spread: number, half: number, drag: number, lifeMin = 0.12, lifeMax = 0.22, lead = 0.012,
): void {
  const b = core.blood;
  for (let i = 0; i < count; i++) {
    const v = speed * rand(0.65, 1.35);
    const vx = dx * v + rand(-spread, spread);
    const vy = dy * v + rand(-spread * 0.55, spread * 0.88);
    const vz = dz * v + rand(-spread, spread);
    const dtLead = lead * rand(0.5, 1.2);
    b.add(
      x + vx * dtLead, y + vy * dtLead, z + vz * dtLead, vx, vy, vz,
      half * rand(0.70, 1.25), rand(0.032, 0.058), drag * rand(0.85, 1.25), i * 0.001, rand(lifeMin, lifeMax),
    );
  }
}

/** User-configurable scale multipliers (0.25..2.0) for blood puffs overall and per trauma event. */
export const BLOOD_PUFF_SCALE: Record<'overall' | BloodPuffKind, number> = {
  overall: 1,
  bullet: 1,
  shotgun: 1,
  headshot: 1,
  headburst: 1,
  limb: 1,
  blowout: 1,
  gib: 1,
};

/** Effective blood puff size multiplier for an event kind (overall × per-event). */
export function bloodPuffMult(kind?: BloodPuffKind): number {
  return BLOOD_PUFF_SCALE.overall * (kind ? BLOOD_PUFF_SCALE[kind] : 1);
}

/**
 * The impact blood burst: sharp liquid tendrils tearing outward and breaking into droplets, fast frame-0 kinetic
 * needles, velocity-stretched directional splatter cones, and sculpted billowing dark-crimson mist clouds scaled to
 * the trauma class (`bullet`, `shotgun`, `headshot`, `headburst`, `limb`, `blowout`, or a gigantic pasted `gib` cloud).
 */
export function bloodPuff(
  core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, weight = 0.3, scale = 1, kind: BloodPuffKind = 'bullet',
): void {
  if (puffFrame !== core.bloodNow) {
    puffFrame = core.bloodNow;
    puffs = 0;
  }
  const major = kind === 'blowout' || kind === 'gib';
  if (!major && puffs >= PUFF.perFrame) return;
  if (!major) puffs++;

  const mult = bloodPuffMult(kind);
  const spreadMult = clamp(0.45 + 0.55 * mult, 0.45, 1.85);
  const w = clamp(weight, 0, 1);
  const half = (PUFF.half + PUFF.heavy * w) * scale * mult;
  const life = PUFF.life + PUFF.lifeHeavy * w;
  const mistOpacity = clamp((0.44 + 0.14 * w) * clamp(scale, 0.85, 1.15), 0.36, 0.60);
  // Stand slightly off the skin toward the gun so the body mesh never clips half of the entry burst.
  const off = PUFF.off + half * 0.22;
  const x = position.x - dir.x * off;
  const y = position.y - dir.y * off;
  const z = position.z - dir.z * off;
  const v = PUFF.drift * (0.75 + 0.65 * w);
  const arterial = kind === 'headshot' || kind === 'headburst' || kind === 'limb' || major;
  const b = core.blood.begin(core.bloodNow, -1e6, null, arterial ? BLOOD_TONE.arterial : BLOOD_TONE.wound);

  if (kind === 'gib') {
    // Big whole-body gib / pasted detonation: sweeping ~3.5-4.5 m asymmetric billowing dark-oxblood mist cloud
    // with torn liquid blood webs ripping outward, discrete teardrop splatter cones, and frame-0 kinetic needles.
    const gScale = clamp(scale, 0.85, 1.45) * mult;
    // 1) Central & radial torn liquid blood webs (sharp dark tendrils shattering into crisp flying droplets).
    b.splash(position.x, position.y, position.z, dir.x * 2.6 * spreadMult, 0.95 * spreadMult, dir.z * 2.6 * spreadMult, 0.90 * gScale, 0.46, 4.0, 0.96, 0);
    for (let i = 0; i < 5; i++) {
      _v.set(rand(-1, 1), rand(-0.18, 0.85), rand(-1, 1)).normalize();
      const spd = rand(2.4, 5.4) * spreadMult;
      b.setTone(i % 2 === 0 ? BLOOD_TONE.arterial : BLOOD_TONE.venous);
      b.splash(
        position.x + _v.x * rand(0.10, 0.40) * spreadMult,
        position.y + _v.y * rand(0.06, 0.34) * spreadMult,
        position.z + _v.z * rand(0.10, 0.40) * spreadMult,
        _v.x * spd + dir.x * 1.8 * spreadMult, _v.y * spd + 0.75 * spreadMult, _v.z * spd + dir.z * 1.8 * spreadMult,
        rand(0.58, 0.96) * gScale, rand(0.36, 0.60), rand(3.8, 5.2), rand(0.86, 0.98), i * 0.007,
      );
    }
    // 2) Inner dark oxblood core billows — low per-puff opacity so overlapping 3D folds stay sculpted and velvety.
    for (let i = 0; i < 3; i++) {
      _v.set(rand(-1, 1), rand(-0.08, 0.70), rand(-1, 1)).normalize();
      const spd = rand(1.0, 2.2) * spreadMult;
      b.setTone(i === 0 ? BLOOD_TONE.venous : BLOOD_TONE.wound);
      b.puff(
        position.x + _v.x * rand(0.12, 0.36) * spreadMult,
        position.y + _v.y * rand(0.08, 0.32) * spreadMult,
        position.z + _v.z * rand(0.12, 0.36) * spreadMult,
        _v.x * spd + dir.x * 1.2 * spreadMult, _v.y * spd + 0.55 * spreadMult, _v.z * spd + dir.z * 1.2 * spreadMult,
        rand(0.72, 1.04) * gScale, rand(1.25, 1.75), rand(2.4, 3.2), rand(0.36, 0.48), i * 0.014,
      );
    }
    // 3) Mid billowing crimson plumes expanding outward into a full ~3.5-4.5 m pasted cloud.
    for (let i = 0; i < 6; i++) {
      _v.set(rand(-1, 1), rand(-0.10, 0.80), rand(-1, 1)).normalize();
      const spd = rand(2.2, 5.0) * spreadMult;
      b.setTone(i % 3 === 0 ? BLOOD_TONE.arterial : BLOOD_TONE.wound);
      b.puff(
        position.x + _v.x * rand(0.22, 0.65) * spreadMult,
        position.y + _v.y * rand(0.12, 0.48) * spreadMult,
        position.z + _v.z * rand(0.22, 0.65) * spreadMult,
        _v.x * spd + dir.x * 2.0 * spreadMult, _v.y * spd + 0.75 * spreadMult, _v.z * spd + dir.z * 2.0 * spreadMult,
        rand(0.76, 1.16) * gScale, rand(1.35, 1.95), rand(2.4, 3.4), rand(0.30, 0.44), 0.01 + i * 0.015,
      );
    }
    // 4) Outer wispy vapor plumes curling upward without towering over corridors.
    for (let i = 0; i < 4; i++) {
      _v.set(rand(-1, 1), rand(0.14, 0.92), rand(-1, 1)).normalize();
      const spd = rand(1.8, 3.8) * spreadMult;
      b.setTone(i % 2 === 0 ? BLOOD_TONE.wound : BLOOD_TONE.venous);
      b.puff(
        position.x + _v.x * rand(0.34, 0.82) * spreadMult,
        position.y + rand(0.18, 0.60) * spreadMult,
        position.z + _v.z * rand(0.34, 0.82) * spreadMult,
        _v.x * spd + dir.x * 1.4 * spreadMult, _v.y * spd + rand(0.75, 1.65) * spreadMult, _v.z * spd + dir.z * 1.4 * spreadMult,
        rand(0.84, 1.24) * gScale, rand(1.50, 2.20), rand(2.2, 3.0), rand(0.24, 0.34), 0.02 + i * 0.018,
      );
    }
    // 5) Discrete directional droplet splatter cones & razor-sharp frame-0 radial kinetic blood needles.
    b.setTone(BLOOD_TONE.arterial);
    for (let i = 0; i < 5; i++) {
      _v.set(rand(-1, 1), rand(-0.15, 0.75), rand(-1, 1)).normalize().addScaledVector(dir, 0.55).normalize();
      const spd = rand(7.5, 12.2) * spreadMult;
      b.mist(
        position.x + _v.x * 0.22 * spreadMult, position.y + 0.10 + _v.y * 0.22 * spreadMult, position.z + _v.z * 0.22 * spreadMult,
        _v.x * spd, _v.y * spd + 0.65, _v.z * spd,
        rand(0.28, 0.46) * gScale, rand(0.34, 0.54), rand(4.2, 5.4), rand(0.82, 0.94), i * 0.006,
      );
    }
    burstStreaks(core, position.x, position.y + 0.12, position.z, dir.x * 0.35, 0.28, dir.z * 0.35, 20, 16.0, 12.0, 0.0068 * clamp(mult, 0.5, 1.5), 6.8, 0.13, 0.24, 0.016);
    return;
  }

  if (kind === 'blowout') {
    // Torso blowout: huge directional arterial liquid rupture + billowing exit cloud erupting out the cavity.
    const bScale = clamp(scale, 1.0, 2.1) * mult;
    b.splash(position.x + dir.x * 0.12, position.y + dir.y * 0.12, position.z + dir.z * 0.12, dir.x * 5.6 * spreadMult, dir.y * 5.6 * spreadMult + 0.65, dir.z * 5.6 * spreadMult, 0.82 * bScale, 0.44, 4.0, 0.96, 0);
    for (let i = 0; i < 3; i++) {
      const spd = rand(4.0, 8.2) * spreadMult;
      b.setTone(i === 0 ? BLOOD_TONE.arterial : BLOOD_TONE.venous);
      b.splash(
        position.x + (dir.x * rand(0.16, 0.54) + rand(-0.22, 0.22)) * spreadMult,
        position.y + (dir.y * rand(0.10, 0.38) + rand(-0.16, 0.22)) * spreadMult,
        position.z + (dir.z * rand(0.16, 0.54) + rand(-0.22, 0.22)) * spreadMult,
        dir.x * spd + rand(-2.4, 2.4) * spreadMult, dir.y * spd + rand(-0.4, 1.8) * spreadMult, dir.z * spd + rand(-2.4, 2.4) * spreadMult,
        rand(0.56, 0.98) * bScale, rand(0.36, 0.58), rand(3.8, 5.2), rand(0.86, 0.96), i * 0.010,
      );
    }
    for (let i = 0; i < 8; i++) {
      const spd = rand(2.8, 7.2) * spreadMult;
      b.setTone(i < 2 ? BLOOD_TONE.venous : i < 5 ? BLOOD_TONE.wound : BLOOD_TONE.arterial);
      b.puff(
        position.x + (dir.x * rand(0.18, 0.82) + rand(-0.30, 0.30)) * spreadMult,
        position.y + (dir.y * rand(0.12, 0.60) + rand(-0.22, 0.36)) * spreadMult,
        position.z + (dir.z * rand(0.18, 0.82) + rand(-0.30, 0.30)) * spreadMult,
        dir.x * spd + rand(-2.4, 2.4) * spreadMult, dir.y * spd + rand(0.15, 2.4) * spreadMult, dir.z * spd + rand(-2.4, 2.4) * spreadMult,
        rand(0.70, 1.32) * bScale, rand(1.15, 1.85), rand(2.2, 3.4), rand(0.32, 0.48), i * 0.015,
      );
    }
    b.setTone(BLOOD_TONE.arterial);
    for (let i = 0; i < 4; i++) {
      const spd = rand(8.5, 13.5) * spreadMult;
      b.mist(
        position.x + dir.x * 0.32 * spreadMult, position.y + dir.y * 0.32 * spreadMult, position.z + dir.z * 0.32 * spreadMult,
        dir.x * spd + rand(-2.4, 2.4) * spreadMult, dir.y * spd + rand(-0.7, 1.5) * spreadMult, dir.z * spd + rand(-2.4, 2.4) * spreadMult,
        rand(0.32, 0.50) * bScale, rand(0.34, 0.56), rand(3.8, 5.0), rand(0.82, 0.94), i * 0.008,
      );
    }
    burstStreaks(core, position.x, position.y, position.z, dir.x, dir.y + 0.14, dir.z, 16, 17.5, 7.5, 0.0068 * clamp(mult, 0.5, 1.5), 6.2, 0.14, 0.24, 0.016);
    return;
  }

  // Primary entry burst: crisp liquid blood tendrils tearing outward (Record 0) + wispy dark-oxblood mist behind it.
  b.splash(x, y, z, -dir.x * (v * 1.15) + rand(-0.5, 0.5), 0.35 - dir.y * v, -dir.z * (v * 1.15) + rand(-0.5, 0.5), half * 1.05, life * 0.72, PUFF.drag * 0.9, 0.94);
  b.setTone(BLOOD_TONE.wound);
  b.puff(x, y, z, -dir.x * (v * 0.85) + rand(-0.35, 0.35), 0.38 - dir.y * (v * 0.85), -dir.z * (v * 0.85) + rand(-0.35, 0.35), half * 1.18, life * 1.25, PUFF.drag * 0.70, mistOpacity, 0.006);

  if (kind === 'headshot' || kind === 'headburst' || kind === 'limb') {
    // Headshots, head bursts, and limb bursts erupt in a sharp arterial tendril crown + billowing oxblood mist + directional exit cone.
    b.setTone(BLOOD_TONE.arterial);
    b.splash(
      position.x + dir.x * 0.14, position.y + 0.08, position.z + dir.z * 0.14,
      dir.x * (v * 2.2) + rand(-0.8, 0.8), 1.35 + rand(0, 0.7), dir.z * (v * 2.2) + rand(-0.8, 0.8),
      half * 1.30, life * 0.88, 4.4, 0.96, 0.008,
    );
    for (let i = 0; i < 2; i++) {
      b.setTone(i === 0 ? BLOOD_TONE.arterial : BLOOD_TONE.venous);
      b.puff(
        position.x + dir.x * rand(0.08, 0.28) + rand(-0.12, 0.12), position.y + 0.08 + rand(0, 0.16), position.z + dir.z * rand(0.08, 0.28) + rand(-0.12, 0.12),
        dir.x * (v * 1.6) + rand(-1.0, 1.0), 1.15 + rand(0.1, 0.85), dir.z * (v * 1.6) + rand(-1.0, 1.0),
        half * rand(1.18, 1.52), life * rand(1.45, 1.85), 3.4, mistOpacity * 0.88, 0.012 + i * 0.015,
      );
    }
    b.setTone(BLOOD_TONE.arterial);
    b.mist(position.x + dir.x * 0.24, position.y + 0.06, position.z + dir.z * 0.24, dir.x * 10.5 + rand(-1.2, 1.2), 1.5 + dir.y * 5.5, dir.z * 10.5 + rand(-1.2, 1.2), half * 0.56, 0.36, 4.4, 0.90, 0.005);
    burstStreaks(core, x, y, z, dir.x * 0.65, 0.55 + dir.y * 0.25, dir.z * 0.65, 11, 13.5 + 3.0 * w, 6.2, 0.0055 * clamp(mult, 0.5, 1.5), 7.2, 0.12, 0.20, 0.012);
    return;
  }

  if (kind === 'shotgun') {
    // Shotgun blasts tear out a broad multi-lobe liquid splash crown, wide exit splatter cone, and billowing mist.
    if (scale >= 0.9) {
      for (let i = 0; i < 2; i++) {
        b.setTone(i === 0 ? BLOOD_TONE.arterial : BLOOD_TONE.venous);
        b.splash(
          x + rand(-0.16, 0.16), y + rand(-0.12, 0.16), z + rand(-0.16, 0.16),
          -dir.x * (v * 0.95) + rand(-1.6, 1.6), 0.45 + rand(-0.4, 0.9), -dir.z * (v * 0.95) + rand(-1.6, 1.6),
          half * rand(0.98, 1.32), life * rand(0.75, 1.0), 4.8, 0.92, 0.008 * (i + 1),
        );
        b.puff(
          x + rand(-0.18, 0.18), y + rand(-0.14, 0.18), z + rand(-0.18, 0.18),
          -dir.x * (v * 0.85) + rand(-1.5, 1.5), 0.48 + rand(-0.35, 0.85), -dir.z * (v * 0.85) + rand(-1.5, 1.5),
          half * rand(1.05, 1.44), life * rand(1.35, 1.75), 3.6, mistOpacity * 0.86, 0.014 * (i + 1),
        );
      }
      b.setTone(BLOOD_TONE.arterial);
      b.mist(position.x + dir.x * 0.26, position.y, position.z + dir.z * 0.26, dir.x * 10.2 + rand(-1.6, 1.6), 0.55 + dir.y * 5.0, dir.z * 10.2 + rand(-1.6, 1.6), half * 0.58, 0.36, 4.5, 0.88, 0.005);
      burstStreaks(core, x, y, z, dir.x * 0.55, 0.32 + dir.y * 0.2, dir.z * 0.55, 11, 13.5, 6.8, 0.0056 * clamp(mult, 0.5, 1.5), 7.2, 0.12, 0.20, 0.012);
    }
    return;
  }

  // Standard / heavy bullet hit: frame-0 kinetic needles + directional teardrop splatter cone + exit bloom on heavier rounds.
  b.setTone(BLOOD_TONE.arterial);
  const streakCount = w >= 0.5 ? 8 : 5;
  burstStreaks(core, position.x, position.y, position.z, dir.x * 0.65, 0.32 + dir.y * 0.30, dir.z * 0.65, streakCount, 11.5 + 4.0 * w, 4.8 + 2.8 * w, (0.0046 + 0.0018 * w) * clamp(mult, 0.5, 1.5), 7.6, 0.11, 0.19, 0.012);
  b.mist(position.x + dir.x * 0.18, position.y + dir.y * 0.18, position.z + dir.z * 0.18, dir.x * (7.2 + 3.2 * w), 0.35 + dir.y * 4.5, dir.z * (7.2 + 3.2 * w), half * 0.54, 0.28 + 0.12 * w, 4.8, 0.86, 0.004);
  if (w >= 0.45) {
    // Heavy / rifle rounds punch a directional liquid splash + billowing mist + wide teardrop spray cone out the far side.
    const ex = position.x + dir.x * 0.20;
    const ey = position.y + dir.y * 0.20;
    const ez = position.z + dir.z * 0.20;
    b.splash(ex, ey, ez, dir.x * (v * 2.3), dir.y * (v * 2.3) + 0.45, dir.z * (v * 2.3), half * 1.24, life * 0.85, 4.4, 0.94, 0.008);
    b.setTone(BLOOD_TONE.venous);
    b.puff(ex, ey, ez, dir.x * (v * 1.7), dir.y * (v * 1.7) + 0.45, dir.z * (v * 1.7), half * 1.38, life * 1.48, 3.4, mistOpacity * 0.90, 0.014);
    b.setTone(BLOOD_TONE.arterial);
    b.mist(ex + dir.x * 0.18, ey + dir.y * 0.18, ez + dir.z * 0.18, dir.x * 11.2, dir.y * 11.2 + 0.45, dir.z * 11.2, half * 0.62, 0.36, 4.2, 0.90, 0.006);
  }
}

/**
 * The puff's numbers. `half`: metres from its middle to its edge for the lightest round, `heavy` what a full-weight round
 * adds. `life`, `lifeHeavy`: seconds. `off`: metres it stands off the skin. `drift`, `drag`: how fast it leaves the wound
 * back toward the gun, and how soon the air stops it. `perFrame`: the hard cap.
 */
export const PUFF = { half: 0.22, heavy: 0.30, life: 0.42, lifeHeavy: 0.28, off: 0.08, drift: 1.75, drag: 5.4, perFrame: 12 };
let puffFrame = -1;
let puffs = 0;

/** A soft breath of fine suspended drops. Gone inside a second so it never hangs like fog. */
export function bloodMist(core: FxCore, position: THREE.Vector3, size = 1, kind?: BloodPuffKind): void {
  const { x, y, z } = position;
  const mult = bloodPuffMult(kind);
  const b = core.blood.begin(core.bloodNow, -1e6, null, BLOOD_TONE.wound);
  for (let i = 0; i < 3; i++) {
    _v.set(rand(-1, 1), rand(-0.2, 0.65), rand(-1, 1)).normalize().multiplyScalar(rand(0.9, 2.4));
    b.puff(x, y, z, _v.x, _v.y, _v.z, 0.28 * size * mult, rand(0.55, 0.88), 3.6, 0.40, i * 0.012);
  }
}

/**
 * Whole-body burst / pasted detonation. The meat, bone and viscera are real bodies in gore, and gore fires three jets
 * on top of this, so here we detonate a gigantic billowing dark-crimson mist cloud with torn liquid webs and radial
 * blood sheets thrown off by the blast.
 */
export function gibBurst(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, force: number): void {
  const { x, y, z } = position;
  const f = Math.sqrt(clamp(force / 10, 0.45, 1.8));
  // Multi-layered dark-crimson blood cloud + liquid webs that chunks burst out of.
  bloodPuff(core, position, dir, 1, clamp(0.95 + f * 0.22, 1.0, 1.35), 'gib');
  const b = core.blood.begin(core.bloodNow, core.floorAt(x, y, z), core.wallAlong(x, y, z, dir.x, dir.y, dir.z), BLOOD_TONE.arterial);
  for (let i = 0; i < 4; i++) {
    _v.set(dir.x + rand(-0.45, 0.45), dir.y + rand(0, 0.45), dir.z + rand(-0.45, 0.45)).normalize();
    stream(core, x, y, z, _v.x, _v.y, _v.z, 5, 12 * f, 2.5, 0.013, 0.11, 1.5, i * 0.018, 3);
  }
  b.setTone(BLOOD_TONE.venous);
  for (let i = 0; i < 8; i++) {
    _v.set(dir.x + rand(-0.9, 0.9), dir.y + rand(0, 0.95), dir.z + rand(-0.9, 0.9)).normalize();
    drops(core, x, y, z, _v.x, _v.y, _v.z, 1, rand(4.5, 9.0) * f, i * 0.018);
  }
  spatter(core, position, 1);
}

/**
 * A head going: sharp explosive arterial liquid crown, billowing crimson mist, a geyser and a crown of thin strands;
 * the skull itself is gore's.
 */
export function headBurst(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3): void {
  const { x, y, z } = position;
  const mult = bloodPuffMult('headburst');
  bloodPuff(core, position, dir, 1, 1.5, 'headburst');
  const mist = core.blood.begin(core.bloodNow, -1e6, null, BLOOD_TONE.arterial);
  mist.splash(x, y + 0.08, z, dir.x * 2.2, 2.4, dir.z * 2.2, 0.58 * mult, 0.42, 4.4, 0.94, 0.008);
  mist.puff(x, y + 0.1, z, dir.x * 1.4, 1.8, dir.z * 1.4, 0.62 * mult, 0.78, 3.4, 0.42, 0.014);
  bloodJet(core, position, UP, 1.3);
  core.blood.setTone(BLOOD_TONE.arterial);
  for (let i = 0; i < 6; i++) {
    _v.set(dir.x * 0.7 + rand(-0.7, 0.7), rand(0.35, 1), dir.z * 0.7 + rand(-0.7, 0.7)).normalize();
    stream(core, x, y, z, _v.x, _v.y, _v.z, 1, rand(5, 9), 0.8, 0.008, 0.08, 1.8, 0, 1);
  }
  spatter(core, position, 0.7);
}

/**
 * What comes out of the far side of a body with the round, and paints the wall or floor behind it. `weight` (0..1, the
 * same scale as the body-hit sounds' `hitWeight`) sets the class: a light round is a fine mist and a small mark, a
 * shotgun or a heavy round a fan of strands and a splash up to a metre across, stretched along the shot. `radial` is a
 * blast: a burst in every direction, leaning along `dir`, the way the blast went. Every mark lands where and when its
 * strand does (`StainQueue`), so the spray is seen to travel to the wall.
 */
export function bloodSpray(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, weight: number, radial = false): void {
  const w = clamp(weight, 0, 1);
  const { x, y, z } = position;
  const floor = core.floorAt(x, y, z);
  if (radial) {
    for (let i = 0; i < SPRAY_RADIAL; i++) {
      _v.set(rand(-1, 1), rand(-0.35, 0.8), rand(-1, 1)).normalize().addScaledVector(dir, 0.8).normalize();
      const b = core.blood.begin(core.bloodNow, floor, core.wallAlong(x, y, z, _v.x, _v.y, _v.z), BLOOD_TONE.arterial);
      sprayFan(core, x, y, z, _v.x, _v.y, _v.z, 0.7 + w * 0.3, 3, 0.35 + 0.35 * w, i * 0.01);
      if (i < 2) b.mist(x, y, z, _v.x * 5, _v.y * 5, _v.z * 5, 0.2, 0.35, 7, 0.5);
    }
    return;
  }
  const b = core.blood.begin(core.bloodNow, floor, core.wallAlong(x, y, z, dir.x, dir.y, dir.z), BLOOD_TONE.wound);
  // A light round leaves mostly mist. It still reads at range: the layer grows a far puff.
  const mists = w < SPRAY_HEAVY ? 2 : 1;
  for (let i = 0; i < mists; i++) {
    b.mist(x, y, z, dir.x * rand(3, 5) + rand(-0.5, 0.5), dir.y * 4 + rand(-0.3, 0.6), dir.z * rand(3, 5) + rand(-0.5, 0.5),
      0.09 + 0.1 * w, rand(0.25, 0.4), 6, 0.55, i * 0.02);
  }
  sprayFan(core, x, y, z, dir.x, dir.y, dir.z, w, 2 + Math.round(w * 8), sprayMark(w), 0);
}

/** Where the bulk of a spray lands, as the quad edge of its biggest mark (the blot fills about a third): a hand's width for a light round, half a metre of blot for the heaviest. */
export function sprayMark(weight: number): number {
  const w = clamp(weight, 0, 1);
  return 0.25 + 1.1 * w ** 1.3;
}

/** A light round is a mist under this weight; at or over it, a splash. */
export const SPRAY_HEAVY = 0.45;
/** Directions a blast's spray goes in. Each costs a ray for its wall. */
export const SPRAY_RADIAL = 6;

/** One fat strand straight down the line that leaves the big mark, and a fan round it that widens with weight. */
function sprayFan(
  core: FxCore, x: number, y: number, z: number, dx: number, dy: number, dz: number, w: number, count: number, mark: number, delay: number,
): void {
  const b = core.blood;
  const speed = 9 + 8 * w;
  const l = b.add(x, y, z, dx * speed, dy * speed + 0.4, dz * speed, 0.006 + 0.01 * w, 0.06, 0.5, delay);
  core.stains.book(core.bloodNow + delay + l.time, l, mark);
  const jitter = 1 + 2.6 * w;
  for (let i = 0; i < count; i++) {
    const v = speed * rand(0.55, 1);
    const half = (0.005 + 0.008 * w) * rand(0.6, 1.3);
    const wait = delay + i * 0.008;
    const s = b.add(
      x, y, z, dx * v + rand(-jitter, jitter), dy * v + rand(-jitter * 0.6, jitter), dz * v + rand(-jitter, jitter),
      half, 0.07 * rand(0.6, 1.2), rand(0.8, 1.5), wait,
    );
    core.stains.book(core.bloodNow + wait + s.time, s, half * STAIN_SCALE);
  }
}

/**
 * One drop falling from a wound, a gib or a body: a short bead that lands and leaves a spot a few centimetres across.
 * `velocity` is what it leaves with, which off a still body is next to nothing. One floor ray.
 */
export function bloodDrip(core: FxCore, position: THREE.Vector3, velocity: THREE.Vector3 | undefined, size = 1): void {
  const { x, y, z } = position;
  const b = core.blood.begin(core.bloodNow, core.floorAt(x, y, z), null, BLOOD_TONE.venous);
  const half = DRIP_HALF * clamp(size, 0.3, 3) * rand(0.75, 1.25);
  const l = b.add(x, y, z, velocity?.x ?? 0, (velocity?.y ?? 0) - 0.2, velocity?.z ?? 0, half, 0.035, 0.3);
  core.stains.book(core.bloodNow + l.time, l, half * STAIN_SCALE * DRIP_STAIN);
}

/**
 * What a piece of a burst body trails as it flies: a fat strand left in its path that keeps a third of the piece's speed,
 * so the piece draws away from it and the strand falls behind, stretched along the arc. Gore calls it for each piece in
 * flight every few hundredths of a second (`gore/trail.ts`, a few a frame over all of them). One in three stains where
 * it lands.
 */
export function gibTrail(core: FxCore, position: THREE.Vector3, velocity: THREE.Vector3, size = 1): void {
  const { x, y, z } = position;
  const b = core.blood.begin(core.bloodNow, core.floorAt(x, y, z), null, BLOOD_TONE.arterial);
  const half = TRAIL_HALF * clamp(size, 0.4, 1.6) * rand(0.75, 1.3);
  const l = b.add(
    x, y, z, velocity.x * TRAIL_KEEP + rand(-0.5, 0.5), velocity.y * TRAIL_KEEP + rand(-0.3, 0.5), velocity.z * TRAIL_KEEP + rand(-0.5, 0.5),
    half, 0.22, 1.4,
  );
  if (Math.random() < 0.34) core.stains.book(core.bloodNow + l.time, l, half * STAIN_SCALE);
}

/** Half width of a trunk piece's trail strand, m, and the share of the piece's speed it keeps. */
const TRAIL_HALF = 0.034;
const TRAIL_KEEP = 0.32;

/** Half width of a drip, m. */
const DRIP_HALF = 0.0055;
/** A drip's spot against what a strand of its width leaves: a falling drop hits square and does not spread far. */
const DRIP_STAIN = 0.75;
