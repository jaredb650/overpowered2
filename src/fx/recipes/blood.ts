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
 * High-speed razor-thin blood needles flung outward on frames 0-3 (like the initial ballistic whip ahead of a
 * real blood mist burst). Uses true 3D curved strands with high drag so they snap out fast and brake midair.
 */
function burstStreaks(
  core: FxCore, x: number, y: number, z: number, dx: number, dy: number, dz: number,
  count: number, speed: number, spread: number, half: number, drag: number, lifeMin = 0.14, lifeMax = 0.24,
): void {
  const b = core.blood;
  for (let i = 0; i < count; i++) {
    const v = speed * rand(0.62, 1.32);
    const vx = dx * v + rand(-spread, spread);
    const vy = dy * v + rand(-spread * 0.65, spread * 0.95);
    const vz = dz * v + rand(-spread, spread);
    b.add(
      x, y, z, vx, vy, vz,
      half * rand(0.65, 1.35), rand(0.032, 0.062), drag * rand(0.8, 1.25), i * 0.0025, rand(lifeMin, lifeMax),
    );
  }
}

/**
 * The impact blood burst: sharp liquid tendrils tearing outward and breaking into droplets, fast frame-0 kinetic
 * needles, velocity-stretched directional splatter, and a wispy dark-crimson billowing aerosol cloud scaled to the
 * trauma class (`bullet`, `shotgun`, `headshot`, `blowout`, or a gigantic pasted `gib` cloud).
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

  const w = clamp(weight, 0, 1);
  const half = (PUFF.half + PUFF.heavy * w) * scale;
  const life = PUFF.life + PUFF.lifeHeavy * w;
  const mistOpacity = clamp((0.46 + 0.14 * w) * clamp(scale, 0.85, 1.15), 0.38, 0.62);
  // Stand slightly off the skin toward the gun so the body mesh never clips half of the entry burst.
  const off = PUFF.off + half * 0.22;
  const x = position.x - dir.x * off;
  const y = position.y - dir.y * off;
  const z = position.z - dir.z * off;
  const v = PUFF.drift * (0.75 + 0.65 * w);
  const b = core.blood.begin(core.bloodNow, -1e6, null, kind === 'headshot' || major ? BLOOD_TONE.arterial : BLOOD_TONE.wound);

  if (kind === 'gib') {
    // GIGANTIC whole-body gib / pasted detonation: huge 3.5-5 m volumetric dark-crimson mist cloud with torn
    // liquid blood webs ripping outward, directional splatter sheets, and a 360-degree burst of kinetic needles.
    const gScale = clamp(scale, 1.0, 2.2);
    // 1) Central torn liquid blood webs (sharp dark tendrils shattering into crisp flying droplets).
    b.splash(position.x, position.y, position.z, dir.x * 2.8, 1.1, dir.z * 2.8, 1.15 * gScale, 0.56, 3.8, 0.94, 0);
    for (let i = 0; i < 6; i++) {
      _v.set(rand(-1, 1), rand(-0.25, 0.9), rand(-1, 1)).normalize();
      const spd = rand(3.2, 6.8);
      b.setTone(i % 2 === 0 ? BLOOD_TONE.arterial : BLOOD_TONE.venous);
      b.splash(
        position.x + _v.x * rand(0.12, 0.45),
        position.y + _v.y * rand(0.08, 0.40),
        position.z + _v.z * rand(0.12, 0.45),
        _v.x * spd + dir.x * 2.0, _v.y * spd + 0.85, _v.z * spd + dir.z * 2.0,
        rand(0.82, 1.50) * gScale, rand(0.42, 0.74), rand(3.6, 5.2), rand(0.84, 0.96), i * 0.008,
      );
    }
    // 2) Inner dense oxblood core billows — deep dark crimson heart that hangs as chunks fly out of it.
    for (let i = 0; i < 4; i++) {
      _v.set(rand(-1, 1), rand(-0.15, 0.7), rand(-1, 1)).normalize();
      const spd = rand(1.0, 2.6);
      b.setTone(i < 2 ? BLOOD_TONE.venous : BLOOD_TONE.wound);
      b.puff(
        position.x + _v.x * rand(0.10, 0.38),
        position.y + _v.y * rand(0.05, 0.32),
        position.z + _v.z * rand(0.10, 0.38),
        _v.x * spd + dir.x * 1.1, _v.y * spd + 0.75, _v.z * spd + dir.z * 1.1,
        rand(1.05, 1.60) * gScale, rand(1.25, 1.85), rand(2.3, 3.2), rand(0.48, 0.62), i * 0.014,
      );
    }
    // 3) Mid billowing crimson cloud body — expands massively outward across a 3.5-5 m volume.
    for (let i = 0; i < 7; i++) {
      _v.set(rand(-1, 1), rand(-0.2, 0.85), rand(-1, 1)).normalize();
      const spd = rand(3.0, 6.8);
      b.setTone(i % 3 === 0 ? BLOOD_TONE.arterial : BLOOD_TONE.wound);
      b.puff(
        position.x + _v.x * rand(0.24, 0.82),
        position.y + _v.y * rand(0.12, 0.68),
        position.z + _v.z * rand(0.24, 0.82),
        _v.x * spd + dir.x * 2.2, _v.y * spd + 1.05, _v.z * spd + dir.z * 2.2,
        rand(0.95, 1.70) * gScale, rand(1.30, 2.05), rand(2.2, 3.4), rand(0.38, 0.52), 0.01 + i * 0.016,
      );
    }
    // 4) Outer wispy rising vapor plumes that curl upward and slowly dissolve into smoky crimson ribbons.
    for (let i = 0; i < 5; i++) {
      _v.set(rand(-1, 1), rand(0.15, 1.0), rand(-1, 1)).normalize();
      const spd = rand(2.4, 5.2);
      b.setTone(i % 2 === 0 ? BLOOD_TONE.wound : BLOOD_TONE.venous);
      b.puff(
        position.x + _v.x * rand(0.40, 1.15),
        position.y + rand(0.20, 0.85),
        position.z + _v.z * rand(0.40, 1.15),
        _v.x * spd + dir.x * 1.4, _v.y * spd + rand(1.4, 3.0), _v.z * spd + dir.z * 1.4,
        rand(1.20, 1.90) * gScale, rand(1.55, 2.35), rand(1.9, 2.8), rand(0.26, 0.40), 0.025 + i * 0.02,
      );
    }
    // 5) Directional velocity-stretched splatter sheets & fast frame-0 kinetic blood needles.
    b.setTone(BLOOD_TONE.arterial);
    for (let i = 0; i < 6; i++) {
      _v.set(rand(-1, 1), rand(-0.2, 0.8), rand(-1, 1)).normalize().addScaledVector(dir, 0.55).normalize();
      const spd = rand(6.5, 12.5);
      b.mist(
        position.x, position.y + rand(-0.1, 0.3), position.z,
        _v.x * spd, _v.y * spd + 0.8, _v.z * spd,
        rand(0.50, 0.90) * gScale, rand(0.42, 0.72), rand(4.2, 5.8), rand(0.68, 0.84), i * 0.008,
      );
    }
    burstStreaks(core, position.x, position.y, position.z, dir.x * 0.45, 0.35, dir.z * 0.45, 24, 13.5, 11.0, 0.0075, 4.6, 0.16, 0.30);
    return;
  }

  if (kind === 'blowout') {
    // Torso blowout: huge directional arterial liquid rupture + billowing exit cloud erupting out the cavity.
    const bScale = clamp(scale, 1.0, 2.1);
    b.splash(position.x + dir.x * 0.12, position.y + dir.y * 0.12, position.z + dir.z * 0.12, dir.x * 5.2, dir.y * 5.2 + 0.65, dir.z * 5.2, 0.72 * bScale, 0.44, 4.2, 0.95, 0);
    for (let i = 0; i < 3; i++) {
      const spd = rand(3.5, 7.2);
      b.setTone(i === 0 ? BLOOD_TONE.arterial : BLOOD_TONE.venous);
      b.splash(
        position.x + dir.x * rand(0.10, 0.38) + rand(-0.18, 0.18),
        position.y + dir.y * rand(0.08, 0.32) + rand(-0.14, 0.20),
        position.z + dir.z * rand(0.10, 0.38) + rand(-0.18, 0.18),
        dir.x * spd + rand(-2.2, 2.2), dir.y * spd + rand(-0.4, 1.8), dir.z * spd + rand(-2.2, 2.2),
        rand(0.50, 0.90) * bScale, rand(0.36, 0.56), rand(4.0, 5.4), rand(0.84, 0.95), i * 0.012,
      );
    }
    for (let i = 0; i < 7; i++) {
      const spd = rand(2.2, 6.2);
      b.setTone(i < 2 ? BLOOD_TONE.venous : i < 5 ? BLOOD_TONE.wound : BLOOD_TONE.arterial);
      b.puff(
        position.x + dir.x * rand(0.12, 0.58) + rand(-0.24, 0.24),
        position.y + dir.y * rand(0.08, 0.46) + rand(-0.18, 0.28),
        position.z + dir.z * rand(0.12, 0.58) + rand(-0.24, 0.24),
        dir.x * spd + rand(-2.0, 2.0), dir.y * spd + rand(0.1, 2.0), dir.z * spd + rand(-2.0, 2.0),
        rand(0.62, 1.20) * bScale, rand(0.88, 1.52), rand(2.6, 4.0), rand(0.38, 0.56), i * 0.016,
      );
    }
    b.setTone(BLOOD_TONE.arterial);
    for (let i = 0; i < 4; i++) {
      const spd = rand(6.5, 11.5);
      b.mist(
        position.x + dir.x * 0.1, position.y + dir.y * 0.1, position.z + dir.z * 0.1,
        dir.x * spd + rand(-2.4, 2.4), dir.y * spd + rand(-0.8, 1.6), dir.z * spd + rand(-2.4, 2.4),
        rand(0.34, 0.62) * bScale, rand(0.32, 0.54), rand(4.5, 6.2), rand(0.70, 0.86), i * 0.01,
      );
    }
    burstStreaks(core, position.x, position.y, position.z, dir.x, dir.y + 0.12, dir.z, 14, 13.0, 5.5, 0.0068, 5.2, 0.14, 0.26);
    return;
  }

  // Primary entry burst: crisp liquid blood tendrils tearing outward (Record 0) + wispy dark-crimson mist behind it.
  b.splash(x, y, z, -dir.x * (v * 1.15) + rand(-0.5, 0.5), 0.35 - dir.y * v, -dir.z * (v * 1.15) + rand(-0.5, 0.5), half * 0.96, life * 0.72, PUFF.drag * 0.9, 0.92);
  b.setTone(BLOOD_TONE.wound);
  b.puff(x, y, z, -dir.x * (v * 0.85) + rand(-0.35, 0.35), 0.38 - dir.y * (v * 0.85), -dir.z * (v * 0.85) + rand(-0.35, 0.35), half * 1.12, life * 1.15, PUFF.drag * 0.72, mistOpacity, 0.006);

  if (kind === 'headshot') {
    // Headshots erupt in a sharp arterial tendril crown + billowing crimson mist + upward/exit splatter cone.
    b.setTone(BLOOD_TONE.arterial);
    b.splash(
      position.x + dir.x * 0.12, position.y + 0.08, position.z + dir.z * 0.12,
      dir.x * (v * 2.1) + rand(-0.8, 0.8), 1.35 + rand(0, 0.7), dir.z * (v * 2.1) + rand(-0.8, 0.8),
      half * 1.25, life * 0.88, 4.4, 0.94, 0.008,
    );
    for (let i = 0; i < 2; i++) {
      b.setTone(i === 0 ? BLOOD_TONE.arterial : BLOOD_TONE.venous);
      b.puff(
        position.x + dir.x * rand(0.06, 0.22) + rand(-0.1, 0.1), position.y + 0.08 + rand(0, 0.14), position.z + dir.z * rand(0.06, 0.22) + rand(-0.1, 0.1),
        dir.x * (v * 1.55) + rand(-1.0, 1.0), 1.15 + rand(0.1, 0.85), dir.z * (v * 1.55) + rand(-1.0, 1.0),
        half * rand(1.15, 1.48), life * rand(1.35, 1.75), 3.8, mistOpacity * 0.96, 0.012 + i * 0.015,
      );
    }
    b.setTone(BLOOD_TONE.arterial);
    b.mist(position.x, position.y + 0.05, position.z, dir.x * 7.5 + rand(-1.2, 1.2), 1.4 + dir.y * 4.5, dir.z * 7.5 + rand(-1.2, 1.2), half * 0.65, 0.36, 5.4, 0.82, 0.006);
    burstStreaks(core, x, y, z, -dir.x * 0.45, 0.62 - dir.y * 0.3, -dir.z * 0.45, 9, 10.5 + 3.2 * w, 5.8, 0.0055, 5.8);
    return;
  }

  if (kind === 'shotgun') {
    // Shotgun blasts tear out a broad multi-lobe liquid splash crown, wide splatter sheet, and billowing mist.
    if (scale >= 0.9) {
      for (let i = 0; i < 2; i++) {
        b.setTone(i === 0 ? BLOOD_TONE.arterial : BLOOD_TONE.venous);
        b.splash(
          x + rand(-0.16, 0.16), y + rand(-0.12, 0.16), z + rand(-0.16, 0.16),
          -dir.x * (v * 1.25) + rand(-1.8, 1.8), 0.45 + rand(-0.4, 0.9), -dir.z * (v * 1.25) + rand(-1.8, 1.8),
          half * rand(0.95, 1.28), life * rand(0.75, 1.0), 4.6, 0.90, 0.008 * (i + 1),
        );
        b.puff(
          x + rand(-0.18, 0.18), y + rand(-0.14, 0.18), z + rand(-0.18, 0.18),
          -dir.x * (v * 0.9) + rand(-1.5, 1.5), 0.48 + rand(-0.35, 0.85), -dir.z * (v * 0.9) + rand(-1.5, 1.5),
          half * rand(1.0, 1.38), life * rand(1.25, 1.65), 4.0, mistOpacity * 0.92, 0.014 * (i + 1),
        );
      }
      b.setTone(BLOOD_TONE.arterial);
      b.mist(position.x, position.y, position.z, dir.x * 7.2 + rand(-1.5, 1.5), 0.5 + dir.y * 4.5, dir.z * 7.2 + rand(-1.5, 1.5), half * 0.65, 0.34, 5.6, 0.78, 0.006);
      burstStreaks(core, x, y, z, -dir.x * 0.65, 0.3 - dir.y * 0.45, -dir.z * 0.65, 9, 10.5, 6.2, 0.0058, 6.0);
    }
    return;
  }

  // Standard / heavy bullet hit: frame-0 kinetic streaks + directional splatter cone + exit bloom on heavier rounds.
  b.setTone(BLOOD_TONE.arterial);
  const streakCount = w >= 0.5 ? 7 : 4;
  burstStreaks(core, x, y, z, -dir.x * 0.8, 0.32 - dir.y * 0.45, -dir.z * 0.8, streakCount, 9.2 + 4.4 * w, 3.6 + 2.4 * w, 0.0046 + 0.002 * w, 6.4);
  b.mist(x, y, z, -dir.x * (4.8 + 2.8 * w), 0.35 - dir.y * 3.5, -dir.z * (4.8 + 2.8 * w), half * 0.52, 0.24 + 0.12 * w, 6.2, 0.72, 0.004);
  if (w >= 0.45) {
    // Heavy / rifle rounds punch a directional liquid splash + billowing mist + spray cone out the far side.
    const ex = position.x + dir.x * 0.16;
    const ey = position.y + dir.y * 0.16;
    const ez = position.z + dir.z * 0.16;
    b.splash(ex, ey, ez, dir.x * (v * 2.2), dir.y * (v * 2.2) + 0.45, dir.z * (v * 2.2), half * 1.15, life * 0.85, 4.6, 0.92, 0.008);
    b.setTone(BLOOD_TONE.venous);
    b.puff(ex, ey, ez, dir.x * (v * 1.6), dir.y * (v * 1.6) + 0.45, dir.z * (v * 1.6), half * 1.28, life * 1.38, 3.8, mistOpacity * 0.95, 0.014);
    b.setTone(BLOOD_TONE.arterial);
    b.mist(ex, ey, ez, dir.x * 8.2, dir.y * 8.2 + 0.4, dir.z * 8.2, half * 0.62, 0.32, 5.4, 0.80, 0.008);
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
export function bloodMist(core: FxCore, position: THREE.Vector3, size = 1): void {
  const { x, y, z } = position;
  const b = core.blood.begin(core.bloodNow, -1e6, null, BLOOD_TONE.wound);
  for (let i = 0; i < 3; i++) {
    _v.set(rand(-1, 1), rand(-0.2, 0.65), rand(-1, 1)).normalize().multiplyScalar(rand(0.9, 2.4));
    b.puff(x, y, z, _v.x, _v.y, _v.z, 0.28 * size, rand(0.55, 0.88), 3.8, 0.46, i * 0.012);
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
  // Gigantic multi-layered dark-crimson blood cloud + liquid webs that chunks burst out of.
  bloodPuff(core, position, dir, 1, clamp(1.15 + f * 0.42, 1.25, 1.90), 'gib');
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
  bloodPuff(core, position, dir, 1, 1.5, 'headshot');
  const mist = core.blood.begin(core.bloodNow, -1e6, null, BLOOD_TONE.arterial);
  mist.splash(x, y + 0.08, z, dir.x * 2.2, 2.4, dir.z * 2.2, 0.56, 0.42, 4.4, 0.92, 0.008);
  mist.puff(x, y + 0.1, z, dir.x * 1.4, 1.8, dir.z * 1.4, 0.62, 0.78, 3.6, 0.50, 0.014);
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
