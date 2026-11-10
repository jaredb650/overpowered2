import * as THREE from 'three';
import { clamp, rand } from '../../core/math';
import type { ExplosionKind, ExplosionOptions } from '../../core/contracts';
import type { FxCore } from '../core';
import { SmokeMode } from '../layers/smoke';
import { hot, type Rgb } from '../layers/shared';
import { CHIP, FIRE, SMOKE, SPARK } from '../palette';
import { chipBurst, hellfireBurst, sparkCone } from './bursts';

interface FirePalette {
  outer: Rgb;
  mid: Rgb;
  inner: Rgb;
  glow: Rgb;
}

const FLAME: FirePalette = { outer: FIRE.red, mid: FIRE.orange, inner: FIRE.yellow, glow: FIRE.glow };
const PLASMA_FIRE: FirePalette = { outer: hot(0x1140ff, 1.1), mid: hot(0x22aaff, 1.2), inner: hot(0xbfeeff, 3), glow: hot(0x2288ff, 0.3) };
const ENEMY_FIRE: FirePalette = { outer: hot(0xee0030, 1.1), mid: hot(0xff2060, 1.15), inner: hot(0xffa0c0, 2.6), glow: hot(0xff1044, 0.3) };
const WHITE_FIRE: FirePalette = { outer: hot(0x8899aa, 0.9), mid: hot(0xccddee, 1.2), inner: hot(0xffffff, 3), glow: hot(0xbfd8ff, 0.24) };

interface Recipe {
  /** Blast radius the spec's numbers were authored against. */
  base: number;
  chips: readonly (readonly [Rgb, number])[];
  hellfire: boolean;
  /** 0 for no shock sphere. Final radius as a fraction of blast radius, at `shockLife`. */
  shockReach: number;
  shockLife: number;
  /** How far along its fade curve the sphere is cut off. Hellfire stops early, so it pops. */
  shockCut: number;
  sparks: number;
  sparkColor: Rgb;
  fire: FirePalette | null;
  fireScale: number;
  smoke: number;
  debris: number;
  dust: boolean;
  scorch: number;
  embers: number;
  light: THREE.ColorRepresentation;
  lightGain: number;
  flash: Rgb;
}

const ROCKET: Recipe = {
  base: 8,
  chips: [[CHIP.orange, 50], [CHIP.amber, 30]],
  hellfire: false,
  shockReach: 6.25 / 8,
  shockLife: 0.1,
  shockCut: 0.833,
  sparks: 26,
  sparkColor: SPARK.amber,
  fire: FLAME,
  fireScale: 1,
  smoke: 7,
  debris: 12,
  dust: true,
  scorch: 0.42,
  embers: 12,
  light: 0xff8a3a,
  lightGain: 1,
  flash: FIRE.core,
};

const RECIPES: Record<ExplosionKind, Recipe> = {
  rocket: ROCKET,
  grenade: {
    ...ROCKET,
    base: 6,
    chips: [[CHIP.orange, 30], [CHIP.amber, 20], [CHIP.grey, 14]],
    sparks: 34,
    debris: 16,
    fireScale: 0.85,
    smoke: 5,
    embers: 6,
  },
  hellfire: {
    ...ROCKET,
    base: 20,
    chips: [[CHIP.yellow, 120], [CHIP.amber, 100], [CHIP.orange, 80], [CHIP.red, 60]],
    hellfire: true,
    shockReach: 15.25 / 20,
    shockLife: 0.15,
    shockCut: 0.508,
    sparks: 90,
    sparkColor: SPARK.yellow,
    fireScale: 1.05,
    smoke: 12,
    debris: 34,
    scorch: 0.45,
    embers: 50,
    lightGain: 1.3,
  },
  hellfireBullet: {
    ...ROCKET,
    base: 2,
    chips: [[CHIP.orange, 12], [CHIP.amber, 8]],
    shockReach: 0,
    sparks: 8,
    fireScale: 1.3,
    smoke: 1,
    debris: 3,
    dust: false,
    scorch: 0.55,
    embers: 2,
    lightGain: 0.28,
  },
  shell: {
    ...ROCKET,
    base: 5,
    chips: [[CHIP.yellow, 25], [CHIP.amber, 15]],
    shockReach: 3.25 / 5,
    sparks: 20,
    sparkColor: SPARK.yellow,
    fireScale: 0.8,
    smoke: 3,
    debris: 6,
    embers: 4,
    lightGain: 0.6,
  },
  plasma: {
    ...ROCKET,
    base: 6,
    chips: [[CHIP.cyan, 40], [CHIP.blueWhite, 24]],
    sparks: 30,
    sparkColor: SPARK.cyan,
    fire: PLASMA_FIRE,
    smoke: 0,
    debris: 0,
    dust: false,
    scorch: 0.3,
    embers: 0,
    light: 0x55bbff,
    lightGain: 0.9,
    flash: hot(0xdff4ff, 24),
  },
  // The Lance's burst: a plasma ball landing, or one link of the chain a beam leaves. Small and all light: a white-blue
  // core, a short fireball, a shock sphere and a floor ring, a scorch, and few enough pieces that twenty in a second are
  // about what one rocket puts out.
  plasmaBurst: {
    ...ROCKET,
    base: 2.8,
    chips: [[CHIP.cyan, 12], [CHIP.blueWhite, 8]],
    shockReach: 0.85,
    sparks: 12,
    sparkColor: SPARK.cyan,
    fire: PLASMA_FIRE,
    fireScale: 0.5,
    smoke: 0,
    debris: 0,
    dust: false,
    scorch: 0.5,
    embers: 0,
    light: 0x66ccff,
    lightGain: 0.75,
    flash: hot(0xdff4ff, 26),
  },
  enemy: {
    ...ROCKET,
    base: 5,
    chips: [[CHIP.red, 36], [CHIP.magenta, 16], [CHIP.orange, 14]],
    sparks: 18,
    sparkColor: SPARK.red,
    fire: ENEMY_FIRE,
    fireScale: 0.9,
    smoke: 4,
    debris: 6,
    embers: 4,
    light: 0xff3050,
    lightGain: 0.7,
  },
  barrel: {
    ...ROCKET,
    base: 7,
    chips: [[CHIP.orange, 50], [CHIP.amber, 34], [CHIP.yellow, 16]],
    sparks: 40,
    fireScale: 1.15,
    smoke: 12,
    debris: 28,
    scorch: 0.5,
    embers: 24,
    lightGain: 1.3,
  },
  finisher: {
    ...ROCKET,
    base: 8,
    chips: [[CHIP.white, 60], [CHIP.greyLight, 40], [CHIP.grey, 30]],
    sparks: 30,
    sparkColor: SPARK.white,
    fire: WHITE_FIRE,
    fireScale: 0.7,
    smoke: 2,
    debris: 8,
    dust: true,
    scorch: 0.3,
    embers: 0,
    light: 0xcfe4ff,
    lightGain: 1,
  },
  nuke: { ...ROCKET, base: 60, hellfire: true },
};

const RAY = hot(0xffd070, 5);
/** Pulverised concrete, not bonfire smoke: lighter and more neutral than anything else in the game. */
const NUKE_SMOKE = hot(0x8a8e96, 0.75);
const NUKE_DARK = hot(0x5a5e68, 0.75);

const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function randomInBall(radius: number): void {
  do {
    _p.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
  } while (_p.lengthSq() > 1);
  _p.multiplyScalar(radius);
}

/**
 * Three flat-coloured layers at one origin instead of a colour ramp: red body, orange inside it, a
 * yellow-white heart that burns out first. All of it is at full size on frame one.
 */
export function fireball(
  core: FxCore, x: number, y: number, z: number, R: number, pal: FirePalette, floor: number, density = 1, lifeScale = 1,
): void {
  const b = core.birth;
  const s = core.smoke;
  const push = 2.4;

  s.begin(pal.glow, 1, b, 0.22 * lifeScale, 0.8 * R, 1.05 * R, 7, 0, 0.75, SmokeMode.Glow);
  s.add(x, y, z, 0, 0, 0, 0);
  // Lobes sit well apart, so as each one erodes toward its own centre the ball breaks up instead of
  // staying a solid disc in front of the target.
  s.begin(pal.outer, 1, b, 0.24 * lifeScale, 0.26 * R, 0.4 * R, 7, 0.6, 0.03, SmokeMode.Fire);
  lobes(s, x, y, z, R, Math.ceil(8 * density), 0.34, push, 0.4, floor + 0.3 * R);
  s.begin(pal.mid, 1, b, 0.18 * lifeScale, 0.2 * R, 0.31 * R, 7, 0.4, 0.03, SmokeMode.Fire);
  lobes(s, x, y, z, R, Math.ceil(7 * density), 0.22, push, 0.3, floor + 0.24 * R);
  s.begin(pal.inner, 1, b, 0.11 * lifeScale, 0.15 * R, 0.22 * R, 7, 0, 0.03, SmokeMode.Fire);
  lobes(s, x, y, z, R, Math.ceil(5 * density), 0.11, push * 1.6, 0, floor + 0.17 * R);
}

/**
 * Each lobe stays clear of the floor by its own size: a sprite plane meeting a floor at a grazing
 * angle is cut in a straight line that no amount of depth fade hides.
 */
function lobes(
  s: FxCore['smoke'], x: number, y: number, z: number, R: number, count: number, spread: number, push: number, rise: number, minY: number,
): void {
  for (let i = 0; i < count; i++) {
    randomInBall(spread * R);
    s.add(x + _p.x, Math.max(y + _p.y, minY), z + _p.z, _p.x * push, _p.y * push + rise * R, _p.z * push, rand(-1.5, 1.5));
  }
}

/** Cold, thin, and gone inside two seconds. The enemy must still be visible through it. */
export function smokeColumn(core: FxCore, x: number, y: number, z: number, R: number, count: number): void {
  const b = core.birth;
  const s = core.smoke;
  for (let i = 0; i < count; i++) {
    const life = rand(1, 1.8);
    s.begin(i % 3 ? SMOKE.mid : SMOKE.dark, 0.5, b, life, 0.14 * R, 0.33 * R, 2.2, 1 + 0.1 * R, 0.22, SmokeMode.Lit);
    randomInBall(0.26 * R);
    s.add(x + _p.x, y + Math.abs(_p.y) * 0.6, z + _p.z, _p.x * 1.6, rand(0.8, 1.5) * R * 0.5, _p.z * 1.6, rand(-0.5, 0.5));
  }
}

/** Blast wave kicking dust out along the floor, under everything else. */
export function groundDust(core: FxCore, x: number, floorY: number, z: number, R: number, count: number): void {
  const s = core.smoke;
  const b = core.birth;
  const speed = 2.3 * R;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * 6.2832 + rand(-0.2, 0.2);
    const c = Math.cos(a);
    const d = Math.sin(a);
    s.begin(SMOKE.dust, 0.6, b, rand(0.5, 0.85), 0.11 * R, 0.24 * R, 4, 0.5, 0.12, SmokeMode.Lit);
    s.add(x + c * 0.14 * R, floorY + 0.12 * R * 0.4, z + d * 0.14 * R, c * speed, rand(0.4, 1.2), d * speed, rand(-1, 1));
  }
}

export function embers(core: FxCore, x: number, y: number, z: number, spread: number, count: number, color: Rgb = SPARK.ember): void {
  const s = core.streaks.begin(color, core.birth, 1, 3.2, -1e6, 0.03, 0.22, 1.6, 0.5);
  for (let i = 0; i < count; i++) {
    s.setLife(rand(1, 2));
    s.add(x + rand(-spread, spread) * 0.5, y + rand(0, spread) * 0.4, z + rand(-spread, spread) * 0.5,
      rand(-spread, spread) * 2.2, rand(0.5, 2) * spread, rand(-spread, spread) * 2.2, rand(0.012, 0.03));
  }
}

function debrisStreaks(core: FxCore, x: number, y: number, z: number, count: number, speed: number, floor: number): void {
  const s = core.streaks.begin(SPARK.orange, core.birth, 0.5, -20, floor, 0.035, 2.4);
  for (let i = 0; i < count; i++) {
    const v = speed * rand(0.55, 1);
    const a = rand(0, 6.2832);
    const up = rand(0.05, 1);
    const h = Math.sqrt(1 - up * up);
    s.add(x, y, z, Math.cos(a) * h * v, up * v, Math.sin(a) * h * v, rand(0.02, 0.05));
  }
}

function darkDebris(core: FxCore, x: number, y: number, z: number, count: number, speed: number, floor: number): void {
  const c = core.chips.begin('shard', CHIP.debris, core.birth, 1, -20, floor, 0.3, 0.55);
  const h = 5.5 * speed;
  const v = 11 * speed;
  for (let i = 0; i < count; i++) {
    c.add(x, y, z, rand(-h, h), rand(1, v), rand(-h, h), rand(0.08, 0.2) * Math.max(speed, 0.8), rand(-12, 12), rand(-12, 12), rand(-12, 12));
  }
}

/** Wireframe shock sphere: life and reach taken straight from the spec, reaching ~75% of the blast. */
function shockSphere(core: FxCore, x: number, y: number, z: number, radius: number, r: Recipe): void {
  const white = core.shockColor;
  core.shock.add(x, y, z, white, core.now, r.shockLife, 0.4, radius * r.shockReach, 1, r.shockCut);
}

export function explosion(core: FxCore, position: THREE.Vector3, options: ExplosionOptions): void {
  const kind = options.kind ?? 'rocket';
  if (kind === 'nuke') {
    nuke(core, position, options);
    return;
  }
  const r = RECIPES[kind];
  const R = options.radius;
  const scale = options.scale ?? 1;
  const { x, y, z } = position;
  const floor = core.floorAt(x, y, z);
  const reach = clamp(R / r.base, 0.4, 2.5);

  if (r.smoke) smokeColumn(core, x, y, z, R * (r.hellfire ? 0.62 : 1), Math.ceil(r.smoke * scale));
  const nearFloor = y - floor < R * 0.75;
  if (r.dust && nearFloor) groundDust(core, x, floor, z, R, Math.ceil(12 * scale));

  if (r.fire) {
    // Hellfire's radius is huge, but the fireball should sit inside a chip storm, not swallow it.
    const fireR = (r.hellfire ? 0.5 : 1) * R * r.fireScale * Math.sqrt(scale);
    fireball(core, x, y, z, fireR, r.fire, floor, scale);
  }

  // Chips land where the blast happened; speed follows the radius, so reach still matches the blast.
  const speed = Math.sqrt(reach) * 1.3;
  const sizeK = Math.sqrt(scale);
  for (const [color, count] of r.chips) {
    const n = Math.round(count * scale);
    if (r.hellfire) hellfireBurst(core, x, y, z, color, n, floor, speed, sizeK);
    else chipBurst(core, x, y, z, color, n, floor, speed, sizeK * 1.5);
  }
  if (r.debris) {
    darkDebris(core, x, y, z, Math.ceil(r.debris * scale), speed, floor);
    debrisStreaks(core, x, y, z, Math.ceil(r.debris * 1.4 * scale), 26 * speed, floor);
  }
  if (r.sparks) {
    const s = core.streaks.begin(r.sparkColor, core.birth, 0.5, -20, floor, 0.028, 1.3);
    const n = Math.round(r.sparks * scale);
    const h = 13 * speed;
    const v = 18 * speed;
    for (let i = 0; i < n; i++) s.add(x, y, z, rand(-h, h), rand(0, v), rand(-h, h), rand(0.02, 0.04));
  }
  if (r.embers) embers(core, x, y, z, Math.max(1, R * 0.3), Math.ceil(r.embers * scale));

  if (r.shockReach > 0) shockSphere(core, x, y, z, R, r);

  // Frame one: hard white core and thin rays. Gone in three frames, it is the "crack" of the envelope.
  const coreR = R * 0.27 * (r.hellfire ? 0.62 : 1) * Math.sqrt(scale);
  const b = core.now;
  core.flashes.star(x, y, z, r.flash, coreR, b, 0.067, 0, 0, 0.45, 0.6, 30);
  core.flashes.star(x, y, z, RAY, coreR * 3.8, b, 0.05, 13, 0.07, 0.75, 0.3, 12);

  if (r.shockReach > 0 && nearFloor) {
    core.waves.add(x, floor + 0.06, z, 0, 1, 0, core.waveColor, 0.28, b, r.shockLife * 1.6, R, 0.006, 1, 0);
  }

  const render = core.ctx.render;
  render.lights.flash(position, r.light, 7 * r.lightGain, Math.max(R * 3, 6), 0.32);

  if (r.scorch > 0 && nearFloor && R > 1) {
    _p.set(x, floor + 0.02, z);
    render.decals.add('scorch', _p, UP, R * r.scorch, rand(0, 6.2832));
  } else if (options.normal && r.scorch > 0) {
    render.decals.add('scorch', position, options.normal, Math.max(R * r.scorch, 0.5), rand(0, 6.2832));
  }

  const cam = render.camera.position;
  const near = clamp(1 - cam.distanceTo(position) / (R * 3.5));
  if (near > 0) {
    render.post.chromatic(0.012 * near, 0.14);
    render.post.radialBlur(0.05 * near, 0.12);
    core.shimmer.add(x, y, z, R * 0.7, core.now, 0.8, 1, 0);
    core.shimmer.add(x, y, z, R * 1.1, core.now, 0.2, 1, 1);
  }
}

/**
 * The top of the ladder. A white frame, a real fireball that climbs on a stem, a ground wave that
 * rolls past the player, and enough chips to make everything before it look small.
 */
function nuke(core: FxCore, position: THREE.Vector3, options: ExplosionOptions): void {
  const R = options.radius;
  const scale = options.scale ?? 1;
  const { x, y, z } = position;
  const floor = core.floorAt(x, y, z);
  const b = core.birth;
  const n = core.now;
  const s = core.smoke;

  const render = core.ctx.render;
  render.post.flash(0xffffff, 2.4, 1.5);
  render.post.chromatic(0.03, 0.7);
  render.post.radialBlur(0.12, 0.6);
  render.lights.flash(position, 0xffe2b0, 40, R * 4, 2.2);

  groundDust(core, x, floor, z, R * 1.6, 40);

  // Stem first, so everything hot later draws over it.
  for (let i = 0; i < 38; i++) {
    const t = i / 38;
    s.begin(i % 2 ? NUKE_DARK : NUKE_SMOKE, 0.95, b + t * 0.5, rand(5, 8), 0.09 * R, 0.2 * R, 0.5, 0.05 * R, 0.14, SmokeMode.Lit);
    s.add(x + rand(-0.09, 0.09) * R, y + t * 0.16 * R, z + rand(-0.09, 0.09) * R, rand(-1, 1), (0.12 + t * 0.4) * R, rand(-1, 1), rand(-0.3, 0.3));
  }
  // Cap: a dome that rolls outward as it climbs. Rim puffs rise slower than the crown.
  for (let i = 0; i < 64; i++) {
    const a = rand(0, 6.2832);
    const rim = Math.sqrt(Math.random());
    const c = Math.cos(a) * rim * 0.5 * R;
    const d = Math.sin(a) * rim * 0.5 * R;
    s.begin(i % 3 ? NUKE_SMOKE : NUKE_DARK, 0.95, b + 0.2, rand(5, 8.5), 0.12 * R, 0.25 * R, 0.55, 0.05 * R, 0.14, SmokeMode.Lit);
    s.add(x + c * 0.5, y + 0.34 * R, z + d * 0.5, c * 0.5, (0.72 - rim * 0.3) * R, d * 0.5, rand(-0.25, 0.25));
  }

  // Fire layers on a slower clock than a rocket's: this is the one explosion allowed to linger.
  fireball(core, x, y + 0.1 * R, z, R * 0.9, FLAME, floor, 4, 7);
  for (let i = 0; i < 30; i++) {
    const t = i / 30;
    const r = Math.random();
    s.begin(r < 0.3 ? FIRE.red : r < 0.75 ? FIRE.orange : FIRE.amber, 1, b + 0.03 * i, rand(1.6, 3), 0.1 * R, 0.2 * R, 0.55, 0.05 * R, 0.03, SmokeMode.Fire);
    s.add(x + rand(-0.2, 0.2) * R, y + (0.1 + t * 0.25) * R, z + rand(-0.2, 0.2) * R, rand(-3, 3), (0.4 + t * 0.26) * R, rand(-3, 3), rand(-1, 1));
  }

  const chipSpeed = 2.6;
  const counts = Math.round(420 * Math.min(scale, 2));
  hellfireBurst(core, x, y, z, CHIP.yellow, counts, floor, chipSpeed, 1.6);
  hellfireBurst(core, x, y, z, CHIP.amber, counts, floor, chipSpeed, 1.6);
  hellfireBurst(core, x, y, z, CHIP.orange, counts, floor, chipSpeed, 1.6);
  hellfireBurst(core, x, y, z, CHIP.red, counts, floor, chipSpeed, 1.6);
  sparkCone(core, x, y, z, 0, 1, 0, SPARK.yellow, 400, floor, 70, 0.8, 0.09, 1.4);
  embers(core, x, y + 0.2 * R, z, R * 0.4, 300);

  core.shock.add(x, y, z, core.shockColor, n, 0.5, 0.5, R * 1.2, 1, 0.5);
  core.shock.add(x, y, z, core.shockColor, n + 0.14, 0.7, 0.5, R * 2.2, 0.8, 0.8);
  core.waves.add(x, floor + 0.1, z, 0, 1, 0, core.waveColor, 0.6, n, 1.1, R * 2.6, 0.01, 1, 0);
  core.waves.add(x, floor + 0.1, z, 0, 1, 0, CHIP.amber, 0.7, n + 0.12, 1.5, R * 2, 0.012, 1, 0);

  core.flashes.star(x, y, z, FIRE.core, R * 0.8, n, 0.3, 0, 0, 0.6, 0.7, 60);
  core.flashes.star(x, y, z, FIRE.amber, R * 2, n, 0.16, 16, 0.05, 0.7, 0.4, 20);

  _p.set(x, floor + 0.02, z);
  render.decals.add('scorch', _p, UP, R * 0.6, rand(0, 6.2832));
  core.shimmer.add(x, y, z, R, core.now, 3, 1.2, 0);
  core.shimmer.add(x, y, z, R * 1.6, core.now, 0.6, 1.6, 1);
}
