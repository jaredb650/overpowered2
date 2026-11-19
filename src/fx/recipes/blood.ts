import * as THREE from 'three';
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
  b.mist(x, y, z, -dir.x * 2.2, 0.4 - dir.y * 2.2, -dir.z * 2.2, 0.13 * p, 0.2, 8, 0.55);
}

/**
 * The impact puff: what a round knocks out of flesh on the frame it lands, on the side it came from. Hit feedback first
 * and blood second, so it is there whole at once (no attack), saturated, and gone in a fifth of a second by being eaten
 * away, never by fading. `weight` is the round on the body-hit scale (`hitWeight`, 0..1): an SMG round is a puff a hand
 * and a half across, a shotgun's blast or a heavy round one as wide as a chest. `scale` is for a caller's own reasons: the
 * later pellets of a blast on a body it has already puffed are smaller. It grows with distance from the eye in the shader
 * (`layers/blood.ts`), so it reads at range. One record; at most `PUFF.perFrame` a frame, the rest are dropped.
 */
export function bloodPuff(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, weight = 0.3, scale = 1): void {
  if (puffFrame !== core.bloodNow) {
    puffFrame = core.bloodNow;
    puffs = 0;
  }
  if (puffs >= PUFF.perFrame) return;
  puffs++;
  const w = clamp(weight, 0, 1);
  const half = (PUFF.half + PUFF.heavy * w) * scale;
  // Just off the skin, toward the gun, so the body it came out of does not hide half of it.
  const off = PUFF.off + half * 0.25;
  const x = position.x - dir.x * off;
  const y = position.y - dir.y * off;
  const z = position.z - dir.z * off;
  const v = PUFF.drift * (0.7 + 0.6 * w);
  const b = core.blood.begin(core.bloodNow, -1e6, null, BLOOD_TONE.arterial);
  b.puff(x, y, z, -dir.x * v + rand(-0.3, 0.3), 0.35 - dir.y * v, -dir.z * v + rand(-0.3, 0.3), half, PUFF.life + PUFF.lifeHeavy * w, PUFF.drag);
}

/**
 * The puff's numbers. `half`: metres from its middle to its edge for the lightest round, `heavy` what a full-weight round
 * adds. `life`, `lifeHeavy`: seconds. `off`: metres it stands off the skin. `drift`, `drag`: how fast it leaves the wound
 * back toward the gun, and how soon the air stops it. `perFrame`: the hard cap.
 */
export const PUFF = { half: 0.12, heavy: 0.22, life: 0.17, lifeHeavy: 0.1, off: 0.05, drift: 1.6, drag: 9, perFrame: 12 };
let puffFrame = -1;
let puffs = 0;

/** A faint breath of fine drops. It is gone in half a second: blood mist that hangs is a video game effect. */
export function bloodMist(core: FxCore, position: THREE.Vector3, size = 1): void {
  const { x, y, z } = position;
  const b = core.blood.begin(core.bloodNow, -1e6, null, BLOOD_TONE.wound);
  for (let i = 0; i < 3; i++) {
    _v.set(rand(-1, 1), rand(-0.3, 0.6), rand(-1, 1)).normalize().multiplyScalar(rand(0.8, 2));
    b.mist(x, y, z, _v.x, _v.y, _v.z, 0.15 * size, rand(0.35, 0.55), 6, 0.4);
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
  for (let i = 0; i < 2; i++) b.mist(x, y, z, dir.x * 5 + rand(-1, 1), dir.y * 5 + rand(0, 2), dir.z * 5 + rand(-1, 1), 0.22, 0.3, 7, 0.55);
  spatter(core, position, 1);
}

/**
 * A head going: a geyser and a crown of thin strands, and the skull itself is gore's. The first game's yellow chips
 * and flash were taken out at the owner's word (2026-11-13): they read as sparks, not as a head.
 */
export function headBurst(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3): void {
  const { x, y, z } = position;
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
