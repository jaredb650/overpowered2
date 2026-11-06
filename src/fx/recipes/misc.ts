import * as THREE from 'three';
import { TAU, clamp, rand } from '../../core/math';
import type { BeamKind, SlashKind } from '../../core/contracts';
import type { FxCore } from '../core';
import { SmokeMode } from '../layers/smoke';
import { hot, hotInto, type Rgb } from '../layers/shared';
import { CHIP, FIRE, SMOKE, SPARK } from '../palette';
import { chipDome, sparkCone, tangents } from './bursts';

const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _c: Rgb = { r: 0, g: 0, b: 0 };

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Rings below this diameter are all the first game's shell pulse: a thin octagon that accelerates out
 * to about 0.66 m and pops off in 0.1 s. Callers pass tiny sizes for it, so they get the true pulse.
 */
const PULSE = 1.32;

/** `size` is the final diameter in meters. Large rings become round shock fronts on a slower clock. */
export function ring(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, color: THREE.ColorRepresentation, size = PULSE): void {
  hotInto(_c, color, 3.5);
  _p.copy(dir).normalize();
  const { x, y, z } = position;
  if (size <= PULSE * 1.5) {
    core.trailRings.add(x, y, z, _p.x, _p.y, _p.z, _c, 0.75, core.now, 0.1, Math.max(size, PULSE) * 0.5);
  } else {
    const life = clamp(0.16 + size * 0.008, 0.16, 0.9);
    core.waves.add(x, y, z, _p.x, _p.y, _p.z, _c, 0.7, core.now, life, size * 0.5, clamp(0.24 / size, 0.006, 0.08), 1, 0.5);
  }
}

export function sparks(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, count: number, color: THREE.ColorRepresentation = 0xffee55): void {
  hotInto(_c, color, 5);
  _p.copy(dir).normalize();
  const floor = core.floorAt(position.x, position.y, position.z);
  sparkCone(core, position.x, position.y, position.z, _p.x, _p.y, _p.z, _c, count, floor, 16, 0.42);
}

const _hsl = { h: 0, s: 0, l: 0 };
const _col = new THREE.Color();

/** Above this a cube stops being a trail dot and starts being a translucent box. */
const CUBE_LIMIT = 1.2;

/**
 * The first game's createSmokeParticle: one axis-aligned cube puff that drifts up and spreads.
 * Saturated colours are fire, Hellfire's orange trail, and keep their heat; greys are plain smoke.
 * Callers also use this for landing clouds several meters across, and those get real billows.
 */
export function smokePuff(core: FxCore, position: THREE.Vector3, color: THREE.ColorRepresentation = 0x888888, size = 0.5, seconds = 1): void {
  _col.set(color).getHSL(_hsl);
  hotInto(_c, color, _hsl.s > 0.4 ? 1.15 : 0.7);
  if (size > CUBE_LIMIT) {
    const s = core.smoke;
    s.begin(_c, 0.55, core.birth, seconds, size * 0.6, size * 1.15, 2, 0.6, 0.2, SmokeMode.Lit);
    s.add(position.x, position.y, position.z, rand(-0.4, 0.4), rand(0.4, 1.2), rand(-0.4, 0.4), rand(-0.4, 0.4));
    return;
  }
  core.puffs.add(
    position.x + rand(-0.05, 0.05), position.y + rand(-0.05, 0.05), position.z + rand(-0.05, 0.05),
    rand(-0.25, 0.25), rand(0.5, 1.5), rand(-0.25, 0.25), _c, 0.6, core.birth, seconds, size,
  );
}

interface BeamFx {
  color: Rgb;
  width: number;
  life: number;
  core: number;
  rings: boolean;
  sparks: number;
  spark: Rgb;
}

const BEAMS: Record<BeamKind, BeamFx> = {
  rail: { color: hot(0x55bbff, 2.4), width: 0.1, life: 0.55, core: 6, rings: true, sparks: 14, spark: SPARK.cyan },
  lance: { color: hot(0xff5a20, 2.4), width: 0.8, life: 0.12, core: 9, rings: false, sparks: 20, spark: SPARK.orange },
  laser: { color: hot(0xff1a10, 2.6), width: 0.012, life: 0.04, core: 3, rings: false, sparks: 0, spark: SPARK.red },
  sniper: { color: hot(0xff2010, 2.6), width: 0.06, life: 0.3, core: 5, rings: false, sparks: 8, spark: SPARK.red },
  heal: { color: hot(0x33ff99, 2), width: 0.05, life: 0.2, core: 4, rings: false, sparks: 0, spark: SPARK.white },
};

export function beam(core: FxCore, from: THREE.Vector3, to: THREE.Vector3, kind: BeamKind, width?: number, seconds?: number): void {
  const f = BEAMS[kind];
  const w = width ?? f.width;
  const life = seconds ?? f.life;
  core.lines.beam(from, to, f.color, w, core.now, life, f.core);
  if (f.rings) {
    // Quake's rail spiral, carried in the first game's own ring language: a coil of octagons along the line.
    _p.subVectors(to, from);
    const dist = _p.length();
    _p.multiplyScalar(1 / Math.max(dist, 1e-3));
    const n = Math.min(64, Math.floor(dist / 1.4));
    tangents(_p, _t, _b);
    for (let i = 0; i < n; i++) {
      const d = 1.4 * (i + rand(0.2, 0.8));
      const a = d * 0.9;
      const c = Math.cos(a) * 0.09;
      const s = Math.sin(a) * 0.09;
      core.trailRings.add(
        from.x + _p.x * d + _t.x * c + _b.x * s,
        from.y + _p.y * d + _t.y * c + _b.y * s,
        from.z + _p.z * d + _t.z * c + _b.z * s,
        _p.x, _p.y, _p.z, f.color, 0.5, core.now + i * 0.0014, 0.26, 0.5, 0.08, 1, 0.6,
      );
    }
  }
  if (f.sparks) {
    const floor = core.floorAt(to.x, to.y, to.z);
    sparkCone(core, to.x, to.y, to.z, 0, 1, 0, f.spark, f.sparks, floor, 12, 0.9, 0.02);
    core.flashes.star(to.x, to.y, to.z, f.color, 0.5, core.now, 0.06, 7, 0.2, 0.7, 0.45, 12);
  }
  if (kind === 'rail' || kind === 'lance') core.ctx.render.lights.flash(to, 0x88ccff, 10, 12, 0.14);
}

/** One bolt, with short forked branches near the middle. */
export function arc(
  core: FxCore, from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation = 0x66ccff,
  seconds = 0.22, width = 0.05,
): void {
  hotInto(_c, color, 6);
  const b = core.now;
  const dist = from.distanceTo(to);
  core.arcs.add(from.x, from.y, from.z, to.x, to.y, to.z, _c, width, b, seconds, 0.2, 30, 12);
  core.arcs.add(from.x, from.y, from.z, to.x, to.y, to.z, _c, width * 0.55, b, seconds * 0.8, 0.32, 24, 8);
  const forks = Math.min(3, Math.floor(dist / 3));
  for (let i = 0; i < forks; i++) {
    _p.lerpVectors(from, to, rand(0.25, 0.75));
    _q.set(_p.x + rand(-1, 1) * dist * 0.22, _p.y + rand(-1, 1) * dist * 0.22, _p.z + rand(-1, 1) * dist * 0.22);
    core.arcs.add(_p.x, _p.y, _p.z, _q.x, _q.y, _q.z, _c, width * 0.4, b, seconds * 0.6, 0.3, 26, 7);
  }
  core.flashes.star(to.x, to.y, to.z, _c, 0.3, b, 0.05, 6, 0.2, 0.7, 0.5, 10);
  core.ctx.render.lights.flash(to, color, 5, 7, 0.1);
}

interface SlashFx {
  color: Rgb;
  width: number;
  life: number;
  sheet: number;
  wipe: number;
  edge: number;
}

const SLASHES: Record<SlashKind, SlashFx> = {
  light: { color: hot(0x33ccff, 1), width: 0.42, life: 0.2, sheet: 0.7, wipe: 0.42, edge: 6 },
  heavy: { color: hot(0xff3a00, 1.1), width: 0.6, life: 0.28, sheet: 0.85, wipe: 0.36, edge: 7 },
  sweep: { color: hot(0x88ccff, 0.9), width: 0.5, life: 0.26, sheet: 0.7, wipe: 0.4, edge: 6 },
  finisher: { color: hot(0xdfeeff, 0.85), width: 0.7, life: 0.34, sheet: 0.85, wipe: 0.32, edge: 9 },
};

/** Crescent on the swing plane: `normal` is the plane, `startDir` the blade at the start of the swing. */
export function slash(
  core: FxCore, centre: THREE.Vector3, normal: THREE.Vector3, startDir: THREE.Vector3, arcRadians: number,
  radius: number, kind: SlashKind,
): void {
  const f = SLASHES[kind];
  _p.crossVectors(normal, startDir).normalize();
  core.slashes.add(centre, startDir, _p, radius, arcRadians, f.color, f.width, core.now, f.life, f.sheet, f.wipe, f.edge);
}

/** One frame's worth of the Kiln's stream. Call it every frame while firing, from weapon code. */
export function flame(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, intensity = 1): void {
  const { x, y, z } = position;
  const dt = core.ctx.time.playerDt;
  const s = core.smoke;
  const b = core.birth;
  // Rate-based, so 30 and 144 fps put out the same fire.
  core.flameAccum += dt * 100 * intensity;
  while (core.flameAccum >= 1) {
    core.flameAccum -= 1;
    const speed = rand(21, 27);
    const life = rand(0.34, 0.52);
    const lead = rand(0, speed * dt);
    const r = Math.random();
    const color = r < 0.25 ? FIRE.yellow : r < 0.6 ? FIRE.amber : FIRE.orange;
    s.begin(color, 1, b, life, 0.11, rand(0.42, 0.72), 1.7, 3.2, 0.05, SmokeMode.Fire);
    s.add(
      x + dir.x * lead, y + dir.y * lead, z + dir.z * lead,
      dir.x * speed + rand(-1.3, 1.3), dir.y * speed + rand(-0.9, 1.3), dir.z * speed + rand(-1.3, 1.3),
      rand(-3, 3),
    );
  }
  if (Math.random() < dt * 10) {
    const st = core.streaks.begin(SPARK.ember, b, rand(0.4, 0.9), 2, -1e6, 0.02, 0.2, 1.2, 0.2);
    st.add(x, y, z, dir.x * 17 + rand(-3, 3), dir.y * 17 + rand(-1, 3), dir.z * 17 + rand(-3, 3), 0.018);
  }
}

/** Frozen enemy breaking apart: cold chips, no blood, a thin puff of frost. */
export function frostShatter(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, scale = 1): void {
  const { x, y, z } = position;
  const floor = core.floorAt(x, y, z);
  const b = core.birth;
  core.smoke.begin(SMOKE.frost, 0.22, b, 0.6, 0.4 * scale, 1 * scale, 3, 0.1, 0.25, SmokeMode.Lit);
  for (let i = 0; i < 5; i++) core.smoke.add(x, y, z, rand(-2, 2) + dir.x * 2, rand(0, 2), rand(-2, 2) + dir.z * 2, rand(-1, 1));

  const big = core.chips.begin('shard', CHIP.ice, b, 1.4, -20, floor, 0.42, 0.7);
  for (let i = 0, n = Math.round(46 * scale); i < n; i++) {
    big.add(x + rand(-0.3, 0.3), y + rand(-0.6, 0.6), z + rand(-0.3, 0.3),
      rand(-7, 7) + dir.x * 5, rand(1, 11) + dir.y * 5, rand(-7, 7) + dir.z * 5,
      rand(0.08, 0.32) * scale, rand(-14, 14), rand(-14, 14), rand(-14, 14));
  }
  const small = core.chips.begin('gem', CHIP.iceWhite, b, 1, -20, floor);
  for (let i = 0, n = Math.round(40 * scale); i < n; i++) {
    small.add(x, y, z, rand(-5, 5), rand(0, 10), rand(-5, 5), rand(0.05, 0.1) * scale, rand(-9, 9), rand(-9, 9), rand(-9, 9));
  }
  sparkCone(core, x, y, z, 0, 1, 0, SPARK.white, 18, floor, 10, 0.9, 0.018);
  core.flashes.star(x, y, z, CHIP.iceWhite, 0.8 * scale, core.now, 0.05, 8, 0.2, 0.7, 0.4, 7);
  core.waves.add(x, y, z, UP.x, UP.y, UP.z, CHIP.ice, 0.7, core.now, 0.22, 2.6 * scale, 0.06, 1, 0);
  core.ctx.render.lights.flash(position, 0x88ddff, 7, 9, 0.16);
}

/** Dust kicked by landing, sliding or a blast. Cold, low and short. */
export function dust(core: FxCore, position: THREE.Vector3, normal: THREE.Vector3, scale = 1): void {
  const { x, y, z } = position;
  const s = core.smoke;
  const b = core.birth;
  const n = Math.ceil(6 * scale);
  tangents(normal, _t, _b);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rand(-0.3, 0.3);
    const c = Math.cos(a);
    const d = Math.sin(a);
    const v = rand(2.2, 4) * Math.sqrt(scale);
    s.begin(SMOKE.kick, 0.6, b, rand(0.35, 0.6), 0.16 * scale, 0.5 * scale, 5.5, 0.2, 0.15, SmokeMode.Lit);
    s.add(
      x + normal.x * 0.05, y + normal.y * 0.05, z + normal.z * 0.05,
      (_t.x * c + _b.x * d) * v + normal.x * 0.5,
      (_t.y * c + _b.y * d) * v + normal.y * 0.5,
      (_t.z * c + _b.z * d) * v + normal.z * 0.5,
      rand(-1, 1),
    );
  }
}

/** Landing with weight: dust plus chips of floor and a flat ring. `impact` is about 0..1. */
export function slam(core: FxCore, position: THREE.Vector3, impact: number): void {
  const { x, y, z } = position;
  const k = clamp(impact, 0.2, 1.6);
  const floor = y;
  dust(core, position, UP, 1.4 + k * 2);
  chipDome(core, x, y + 0.05, z, UP, CHIP.grey, Math.round(20 * k), floor, 0.9 * k + 0.3, 1.2, 'shard');
  core.waves.add(x, y + 0.05, z, 0, 1, 0, CHIP.blueWhite, 0.8, core.now, 0.2, 2.2 + k * 3.5, 0.016, 1, 0);
  core.waves.add(x, y + 0.05, z, 0, 1, 0, CHIP.cyan, 0.7, core.now + 0.03, 0.28, 3 + k * 5, 0.03, 1, 0);
  sparkCone(core, x, y + 0.05, z, 0, 1, 0, SPARK.cyan, Math.round(14 * k), floor, 11, 1, 0.02);
  core.ctx.render.decals.add('crack', position, UP, 1.5 + k * 1.4, rand(0, TAU));
  core.ctx.render.lights.flash(position, 0x66ccff, 10 * k, 9, 0.14);
}

/** Speed lines past the eye on a dash: straight, thin, and gone in a blink. `position` is the eye. */
export function dashStreaks(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3): void {
  const { x, y, z } = position;
  const s = core.streaks.begin(SPARK.cyan, core.birth, 0.22, -0.01, -1e6, 0.05, 2.6, 3.5);
  for (let i = 0; i < 26; i++) {
    const v = rand(14, 30);
    s.add(x + rand(-1, 1) + dir.x * 2, y + rand(-1.3, 0.7) + dir.y * 2, z + rand(-1, 1) + dir.z * 2,
      -dir.x * v, -dir.y * v, -dir.z * v, rand(0.008, 0.02));
  }
  core.waves.add(x + dir.x * 1.4, y + dir.y * 1.4, z + dir.z * 1.4, dir.x, dir.y, dir.z, CHIP.blueWhite, 0.5, core.now, 0.12, 1.5, 0.05, 1, 0);
}

export function jumpPad(core: FxCore, position: THREE.Vector3, normal: THREE.Vector3, color: THREE.ColorRepresentation = 0x33ddff): void {
  const { x, y, z } = position;
  hotInto(_c, color, 3.2);
  const n = core.now;
  for (let i = 0; i < 3; i++) {
    core.waves.add(x + normal.x * i * 0.7, y + normal.y * i * 0.7, z + normal.z * i * 0.7, normal.x, normal.y, normal.z, _c, 0.9, n + i * 0.035, 0.24, 1.5 + i * 0.5, 0.09, 1, 0);
  }
  const s = core.streaks.begin(_c, core.birth, 0.5, -6, -1e6, 0.03, 1.8, 1.4);
  for (let i = 0; i < 26; i++) {
    const a = rand(0, TAU);
    const r = rand(0.2, 1.3);
    s.add(x + Math.cos(a) * r, y + 0.1, z + Math.sin(a) * r, normal.x * rand(10, 24), normal.y * rand(10, 24), normal.z * rand(10, 24), rand(0.015, 0.03));
  }
  core.flashes.star(x, y + 0.2, z, _c, 1.1, n, 0.05, 8, 0.2, 0.8, 0.35, 8);
  core.ctx.render.lights.flash(position, color, 9, 9, 0.2);
}

export function pickupSparkle(core: FxCore, position: THREE.Vector3, color: THREE.ColorRepresentation = 0xffffff): void {
  const { x, y, z } = position;
  hotInto(_c, color, 4);
  const b = core.now;
  for (let i = 0; i < 7; i++) {
    core.flashes.star(x + rand(-0.4, 0.4), y + rand(-0.1, 1.2), z + rand(-0.4, 0.4), _c, rand(0.08, 0.2), b + i * 0.05, 0.13, 4, 0.1, 0.1, 0.3, 8);
  }
  const s = core.streaks.begin(_c, core.birth, 0.55, 4, -1e6, 0.03, 0.4, 2);
  for (let i = 0; i < 14; i++) {
    s.add(x + rand(-0.3, 0.3), y + rand(0, 0.6), z + rand(-0.3, 0.3), rand(-2, 2), rand(1, 5), rand(-2, 2), rand(0.012, 0.022));
  }
  core.waves.add(x, y + 0.05, z, 0, 1, 0, _c, 0.8, b, 0.2, 1, 0.08, 1, 0);
}

/** A column that strikes the ground and rings out. The enemy appears inside the frame of light. */
export function spawnIn(core: FxCore, position: THREE.Vector3, color: THREE.ColorRepresentation = 0x33ddff, height = 2.4): void {
  const { x, y, z } = position;
  hotInto(_c, color, 2.2);
  const n = core.now;
  _p.set(x, y, z);
  _q.set(x, y + height * 3, z);
  core.lines.beam(_p, _q, _c, 0.34, n, 0.22, 5);
  for (let i = 0; i < 5; i++) {
    core.waves.add(x, y + (i / 4) * height, z, 0, 1, 0, _c, 0.8, n + i * 0.025, 0.24, 1.1, 0.07, 1, 0.3);
  }
  const s = core.streaks.begin(_c, core.birth, 0.5, 3, -1e6, 0.04, 0.8, 2);
  for (let i = 0; i < 24; i++) {
    const a = rand(0, TAU);
    s.add(x + Math.cos(a) * 0.7, y + rand(0, height), z + Math.sin(a) * 0.7, Math.cos(a) * rand(1, 4), rand(1, 7), Math.sin(a) * rand(1, 4), 0.02);
  }
  core.flashes.star(x, y + height * 0.5, z, _c, height * 0.7, n, 0.05, 6, 0.08, 0.7, 0.3, 5);
  core.ctx.render.lights.flash(position, color, 12, 10, 0.3);
}

/** Boots on a wall during a run: bright sparks peeling off behind the foot. */
export function wallSparks(core: FxCore, position: THREE.Vector3, normal: THREE.Vector3, along: THREE.Vector3): void {
  const { x, y, z } = position;
  const s = core.streaks.begin(SPARK.yellow, core.birth, 0.35, -20, -1e6, 0.02, 0.7);
  for (let i = 0; i < 4; i++) {
    const v = rand(4, 10);
    s.add(x, y, z, -along.x * v + normal.x * rand(1, 4), -along.y * v + rand(-1, 3), -along.z * v + normal.z * rand(1, 4), rand(0.012, 0.022));
  }
}

/** Small fire burst on a body or a surface, used by burning emitters and by the Kiln on hit. */
export function burnPuff(core: FxCore, x: number, y: number, z: number, size: number): void {
  const b = core.birth;
  const s = core.smoke;
  const life = rand(0.3, 0.55);
  const r = Math.random();
  s.begin(r < 0.3 ? FIRE.amber : r < 0.75 ? FIRE.orange : FIRE.red, 1, b, life, size * 0.6, size, 2, 4.2, 0.05, SmokeMode.Fire);
  // Spread up a body, so a burning enemy is on fire and not standing next to one small flame.
  s.add(x + rand(-0.28, 0.28), y + rand(-0.75, 0.6), z + rand(-0.28, 0.28), rand(-0.4, 0.4), rand(1, 2.6), rand(-0.4, 0.4), rand(-3, 3));
}
