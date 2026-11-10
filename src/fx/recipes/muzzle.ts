import * as THREE from 'three';
import { rand } from '../../core/math';
import type { MuzzleKind, TracerKind } from '../../core/contracts';
import type { FxCore } from '../core';
import { SmokeMode } from '../layers/smoke';
import type { FlashLayer } from '../layers/flashes';
import { hot, type Rgb } from '../layers/shared';
import { SMOKE, SPARK } from '../palette';

interface MuzzleFx {
  color: Rgb;
  /** Star radius, in meters. */
  size: number;
  points: number;
  inner: number;
  /** Flame petals along the barrel. */
  petals: number;
  petalLength: number;
  /** Seconds. Two frames at 60 fps by default: on, then gone. */
  life: number;
  light: THREE.ColorRepresentation;
  lightPower: number;
  lightRadius: number;
  /** Size of the wisp left at the muzzle, 0 for none. */
  wisp: number;
  sparks: number;
}

const FLASH = 0.03;

const MUZZLES: Record<MuzzleKind, MuzzleFx> = {
  smg: {
    color: hot(0xffff00, 2), size: 0.2, points: 5, inner: 0.22, petals: 1, petalLength: 0.5, life: FLASH,
    light: 0xffd070, lightPower: 4, lightRadius: 7, wisp: 0.05, sparks: 0,
  },
  rifle: {
    color: hot(0xffcc33, 2.2), size: 0.26, points: 6, inner: 0.2, petals: 2, petalLength: 0.7, life: FLASH,
    light: 0xffc060, lightPower: 5, lightRadius: 9, wisp: 0.07, sparks: 0,
  },
  shotgun: {
    color: hot(0xffaa00, 2), size: 0.42, points: 8, inner: 0.24, petals: 3, petalLength: 0.9, life: FLASH * 1.4,
    light: 0xffa850, lightPower: 8, lightRadius: 11, wisp: 0.18, sparks: 9,
  },
  rocket: {
    color: hot(0xff6600, 1.9), size: 0.5, points: 7, inner: 0.3, petals: 2, petalLength: 1.1, life: 0.05,
    light: 0xff8840, lightPower: 8, lightRadius: 12, wisp: 0.34, sparks: 12,
  },
  autocannon: {
    color: hot(0xffaa00, 2.2), size: 0.72, points: 8, inner: 0.2, petals: 3, petalLength: 1.7, life: 0.05,
    light: 0xffb050, lightPower: 13, lightRadius: 15, wisp: 0.3, sparks: 10,
  },
  plasma: {
    color: hot(0x33ddff, 2.2), size: 0.3, points: 6, inner: 0.32, petals: 1, petalLength: 0.6, life: 0.05,
    light: 0x55ccff, lightPower: 5, lightRadius: 9, wisp: 0, sparks: 5,
  },
  railgun: {
    color: hot(0xbfe8ff, 3), size: 0.55, points: 4, inner: 0.1, petals: 1, petalLength: 1.4, life: 0.06,
    light: 0x99ddff, lightPower: 13, lightRadius: 16, wisp: 0.14, sparks: 8,
  },
  minigun: {
    color: hot(0xffee33, 2), size: 0.17, points: 4, inner: 0.2, petals: 1, petalLength: 0.45, life: 0.02,
    light: 0xffd070, lightPower: 3, lightRadius: 6, wisp: 0, sparks: 0,
  },
  revolver: {
    color: hot(0xffcc55, 2.4), size: 0.36, points: 6, inner: 0.16, petals: 2, petalLength: 0.8, life: FLASH * 1.3,
    light: 0xffc070, lightPower: 8, lightRadius: 11, wisp: 0.12, sparks: 5,
  },
  flame: {
    color: hot(0xff8822, 2), size: 0.14, points: 5, inner: 0.4, petals: 0, petalLength: 0, life: 0.05,
    light: 0xff7a30, lightPower: 2, lightRadius: 6, wisp: 0, sparks: 0,
  },
  enemy: {
    color: hot(0xff5522, 1.9), size: 0.3, points: 5, inner: 0.22, petals: 1, petalLength: 0.6, life: FLASH,
    light: 0xff6030, lightPower: 3, lightRadius: 6, wisp: 0, sparks: 0,
  },
  // Harrow: a four-point cross with long side jets, whiter than the SMG's star, so the two read apart on slot 1.
  carbine: {
    color: hot(0xffe0a0, 2.4), size: 0.3, points: 4, inner: 0.14, petals: 3, petalLength: 0.85, life: FLASH,
    light: 0xffd090, lightPower: 6, lightRadius: 10, wisp: 0.08, sparks: 3,
  },
  // Rivet: a small tight pop, gone in a frame.
  pistol: {
    color: hot(0xfff0b0, 2.2), size: 0.15, points: 6, inner: 0.3, petals: 1, petalLength: 0.32, life: FLASH * 0.8,
    light: 0xffd890, lightPower: 3, lightRadius: 6, wisp: 0.04, sparks: 0,
  },
  // Sabot: a cold blue-white lance of a flash. No fireball, because nothing in the round burns.
  sabot: {
    color: hot(0xbfe0ff, 2.6), size: 0.5, points: 4, inner: 0.1, petals: 2, petalLength: 2.1, life: 0.05,
    light: 0xa8d0ff, lightPower: 12, lightRadius: 15, wisp: 0.22, sparks: 14,
  },
};

const _side = new THREE.Vector3();
const AUTOCANNON_SECOND = hot(0xffff00, 2.4);

function stack(
  layer: FlashLayer, f: MuzzleFx, x: number, y: number, z: number, dx: number, dy: number, dz: number, birth: number, scale: number,
): void {
  // Crisp star facing the eye. Spikes are re-rolled per shot, so automatic fire strobes rather than repeats.
  layer.star(x, y, z, f.color, f.size * scale * rand(0.85, 1.15), birth, f.life, f.points, f.inner, 0.85, 0.5, 5);
  for (let i = 0; i < f.petals; i++) {
    // Slight fan so a side view gets a flower and not a single spike.
    const a = (i - (f.petals - 1) / 2) * 0.28;
    _side.set(dx + a * dz, dy + (i % 2 ? a : -a) * 0.4, dz - a * dx).normalize();
    layer.petal(x, y, z, _side.x, _side.y, _side.z, f.color, f.petalLength * scale * rand(0.8, 1.2), f.size * scale * 0.42, birth, f.life, 0.85, 0.5, 4);
  }
}

/** Inside this range the shooter is the camera, and the flash must draw over the viewmodel. */
const OWN_GUN = 3;

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

export function muzzleFlash(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, kind: MuzzleKind, view: boolean): void {
  const f = MUZZLES[kind];
  const { x, y, z } = position;
  const birth = core.playerNow;
  const r = core.ctx.render;
  let layer = core.muzzle;
  let px = x, py = y, pz = z, dx = dir.x, dy = dir.y, dz = dir.z, scale = 1;

  if (core.muzzleView) {
    if (view) {
      layer = core.muzzleView;
    } else if (r.camera.position.distanceToSquared(position) < OWN_GUN * OWN_GUN) {
      // The viewmodel is drawn in its own depth slice, so a world-space flash at the muzzle would be
      // hidden by the gun that fired it. The two cameras share an eye and a depth axis, so only x and
      // y differ, by the ratio of their FOV tangents.
      const k = Math.tan((r.camera.fov * Math.PI) / 360) / Math.tan((r.viewCamera.fov * Math.PI) / 360);
      _v.copy(position).applyMatrix4(r.camera.matrixWorldInverse);
      _v.x /= k;
      _v.y /= k;
      _v.applyMatrix4(r.viewCamera.matrixWorld);
      _d.copy(dir).transformDirection(r.camera.matrixWorldInverse);
      _d.x /= k;
      _d.y /= k;
      _d.transformDirection(r.viewCamera.matrixWorld);
      layer = core.muzzleView;
      px = _v.x; py = _v.y; pz = _v.z;
      dx = _d.x; dy = _d.y; dz = _d.z;
      scale = 1 / k;
    }
  }
  stack(layer, f, px, py, pz, dx, dy, dz, birth, scale);

  // The autocannon's two-stage flash, the best one in the first game: big orange, then small yellow.
  if (kind === 'autocannon') {
    layer.star(px, py, pz, AUTOCANNON_SECOND, f.size * 0.5 * scale, birth + 0.05, 0.05, 8, 0.2, 1, 0.4, 4);
  }

  r.lights.flash(position, f.light, f.lightPower, f.lightRadius, 0.06);

  if (f.wisp > 0) {
    const s = core.smoke;
    s.begin(SMOKE.light, 0.26, core.birth, rand(0.4, 0.7), f.wisp, f.wisp * 3.2, 3.5, 0.9, 0.2, SmokeMode.Lit);
    s.add(x + dir.x * 0.1, y + dir.y * 0.1, z + dir.z * 0.1, dir.x * 2.2, dir.y * 2.2 + 0.2, dir.z * 2.2, rand(-1, 1));
  }
  if (f.sparks > 0) {
    const s = core.streaks.begin(SPARK.amber, core.birth, 0.28, -14, -1e6, 0.018, 0.5);
    for (let i = 0; i < f.sparks; i++) {
      const v = rand(12, 28);
      s.add(x, y, z, dir.x * v + rand(-3.5, 3.5), dir.y * v + rand(-3.5, 3.5), dir.z * v + rand(-3.5, 3.5), rand(0.008, 0.016));
    }
  }
}

interface TracerFx {
  color: Rgb;
  width: number;
  speed: number;
  length: number;
  core: number;
  minPx: number;
}

const TRACERS: Record<TracerKind, TracerFx> = {
  bullet: { color: hot(0xffc040, 3), width: 0.013, speed: 520, length: 11, core: 6, minPx: 1.1 },
  heavy: { color: hot(0xffa030, 3), width: 0.032, speed: 340, length: 18, core: 6, minPx: 1.5 },
  hellfire: { color: hot(0xff5a10, 3), width: 0.036, speed: 340, length: 12, core: 4.5, minPx: 1.6 },
  bloodthirst: { color: hot(0xff1020, 3), width: 0.022, speed: 520, length: 14, core: 3.5, minPx: 1.3 },
  berserk: { color: hot(0xff22aa, 3), width: 0.026, speed: 520, length: 15, core: 4, minPx: 1.4 },
  plasma: { color: hot(0x33ddff, 3), width: 0.05, speed: 180, length: 5, core: 6, minPx: 1.6 },
  rail: { color: hot(0x88ccff, 3), width: 0.05, speed: 1600, length: 90, core: 8, minPx: 2 },
  enemy: { color: hot(0xff3020, 3), width: 0.022, speed: 170, length: 6, core: 3.5, minPx: 1.4 },
  carbine: { color: hot(0xffe0a0, 3), width: 0.02, speed: 700, length: 20, core: 6, minPx: 1.3 },
  pistol: { color: hot(0xffd070, 3), width: 0.011, speed: 480, length: 6, core: 6, minPx: 1 },
  // Thick and fast enough that its far segments, past each wall, are drawn before the eye can tell them apart.
  sabot: { color: hot(0x9fd0ff, 3.4), width: 0.11, speed: 1400, length: 70, core: 9, minPx: 3 },
};

export function tracer(core: FxCore, from: THREE.Vector3, to: THREE.Vector3, kind: TracerKind): void {
  const f = TRACERS[kind];
  core.lines.tracer(from, to, f.color, f.width, core.birth, f.speed, f.length, f.core, f.minPx);
}
