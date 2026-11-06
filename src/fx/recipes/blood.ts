import * as THREE from 'three';
import { chance, clamp, rand } from '../../core/math';
import type { FxCore } from '../core';
import { SmokeMode } from '../layers/smoke';
import type { ChipShape } from '../layers/chips';
import { BLOOD, CHIP } from '../palette';
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
 * The tight, pressurised stream. Base speed against jitter stays near the 5:1 of the original: that
 * ratio is what makes it a jet and not a puff. Fixing the first game's crash means the side mist now
 * exists, so it is deliberately brief to keep the droplets as the read.
 */
export function bloodJet(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, intensity = 1): void {
  const { x, y, z } = position;
  const floor = core.floorAt(x, y, z);
  const n = Math.round(30 * intensity);
  const c = core.chips.begin('droplet', BLOOD.deep, core.birth, 1, -15, floor, 0, 0);
  for (let i = 0; i < n; i++) {
    const life = rand(0.8, 1.2);
    c.setLife(life);
    const size = rand(0.08, 0.2) * (life / 1.2) * 0.42;
    // Spread along the axis, not across it: one burst then reads as a stream from the wound.
    const speed = rand(6, 17);
    const vx = dir.x * speed + rand(-1.5, 1.5);
    const vy = dir.y * speed + rand(0, 3.5);
    const vz = dir.z * speed + rand(-1.5, 1.5);
    c.add(x, y, z, vx, vy, vz, size);
  }
  const m = Math.round(5 * intensity);
  core.smoke.begin(BLOOD.mist, 0.34, core.birth, 0.34, 0.1, 0.26, 2, -2, 0.2, SmokeMode.Flat);
  for (let i = 0; i < m; i++) {
    core.smoke.add(x, y, z, dir.x * 7.5 + rand(-2.5, 2.5), dir.y * 7.5 + rand(0, 3), dir.z * 7.5 + rand(-2.5, 2.5), rand(-1, 1));
  }
}

/** A bullet going in: the original's 15-chip dome plus a short directional spit out along the shot. */
export function bloodHit(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, intensity = 1): void {
  const { x, y, z } = position;
  const floor = core.floorAt(x, y, z);
  chipBurst(core, x, y, z, BLOOD.hit, Math.round(15 * intensity), floor, 0.9, 1);
  const n = Math.round(12 * intensity);
  const c = core.chips.begin('droplet', BLOOD.bright, core.birth, 0.6, -15, floor, 0, 0);
  for (let i = 0; i < n; i++) {
    const v = rand(7, 12);
    c.add(x, y, z, dir.x * v + rand(-1.6, 1.6), dir.y * v + rand(-0.4, 2.2), dir.z * v + rand(-1.6, 1.6), rand(0.03, 0.08));
  }
  core.smoke.begin(BLOOD.mist, 0.5, core.birth, 0.28, 0.14, 0.38, 6, 0, 0.16, SmokeMode.Flat);
  core.smoke.add(x, y, z, dir.x * 2.5, dir.y * 2.5 + 0.5, dir.z * 2.5, rand(-1, 1));
  core.flashes.star(x, y, z, BLOOD.bright, 0.17, core.now, 0.034, 5, 0.3, 0.8, 0, 1);
}

/**
 * Hanging red mist, the effect the first game wrote and then disabled because it had no soft texture
 * and its opacity curve was broken. It keeps red saturated here and thins by erosion, never to brown.
 */
export function bloodMist(core: FxCore, position: THREE.Vector3, size = 1): void {
  const { x, y, z } = position;
  const s = core.smoke;
  const b = core.birth;
  for (let i = 0; i < 8; i++) {
    const life = rand(1.5, 3);
    s.begin(chance(0.7) ? BLOOD.mist : BLOOD.mistDark, 0.13, b, life, 0.5 * size, 1.3 * size, 2, 0.04, 0.6, SmokeMode.Flat);
    _v.set(rand(-0.5, 0.5), rand(-0.25, 0.25) + 0.2, rand(-0.5, 0.5)).normalize().multiplyScalar(rand(1.5, 3));
    s.add(x + rand(-0.25, 0.25), y + rand(-0.25, 0.25), z + rand(-0.25, 0.25), _v.x, _v.y, _v.z, rand(-0.4, 0.4));
  }
}

/**
 * Massive blood spurt: 40 pieces streaming away from the blast, so direction tells you where the
 * force came from. The first five are bright, faster, and overtake the rest for a leading edge.
 */
function spurt(core: FxCore, x: number, y: number, z: number, dx: number, dy: number, dz: number, floor: number, count: number): void {
  const b = core.birth;
  const lead = Math.min(5, count);
  const c = core.chips.begin('droplet', BLOOD.bright, b, 1.5, -20, floor, 0, 0);
  for (let i = 0; i < count; i++) {
    if (i === lead) c.setColor(BLOOD.deep);
    const k = i < lead ? 1.5 : 1;
    c.setLife(rand(1, 2));
    const size = i < 10 ? rand(0.15, 0.3) : rand(0.08, 0.16);
    c.add(
      x + rand(-0.15, 0.15), y + rand(-0.15, 0.15), z + rand(-0.15, 0.15),
      (dx * 20 + rand(-4, 4)) * k, (dy * 20 + rand(0, 10)) * k, (dz * 20 + rand(-4, 4)) * k,
      size * 0.34,
    );
  }
}

const GIB_SHAPES: readonly ChipShape[] = ['cube', 'gem', 'rod', 'plate'];

/** Heavy tumbling lumps that hold their size, bounce, then shrink late: the only FX with any weight. */
function giblets(
  core: FxCore, x: number, y: number, z: number, dx: number, dy: number, dz: number, count: number, force: number, floor: number,
): void {
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    const shape = GIB_SHAPES[r < 0.3 ? 0 : r < 0.6 ? 1 : r < 0.85 ? 2 : 3]!;
    const color = chance(0.55) ? BLOOD.dark : BLOOD.deep;
    const life = rand(2.5, 4);
    const c = core.chips.begin(shape, color, core.birth, life, -30, floor, 0.42, 0.65, 0.72);
    const push = force * rand(20, 30);
    const scale = rand(0.8, 1.2);
    const size = (shape === 'rod' ? 0.12 : shape === 'plate' ? 0.15 : 0.1) * scale;
    c.add(
      x + rand(-0.25, 0.25), y + rand(0, 0.5), z + rand(-0.25, 0.25),
      rand(-12.5, 12.5) + dx * push, rand(8, 22) + dy * push, rand(-12.5, 12.5) + dz * push,
      size, rand(-7.5, 7.5), rand(-7.5, 7.5), rand(-7.5, 7.5),
    );
  }
}

/**
 * Whole-body burst: the commented-out giblet design from the first game, stacked on the 120-particle
 * spurts that explosive kills really showed. `force` is roughly 0..20, the blast force on the body.
 */
export function gibBurst(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3, force: number): void {
  const { x, y, z } = position;
  const floor = core.floorAt(x, y, z);
  const f = clamp(force / 10, 0.4, 1.6);

  chipBurst(core, x, y, z, BLOOD.deep, 25, floor, 1.1, 1.3);
  chipBurst(core, x, y, z, BLOOD.dark, 15, floor, 1.1, 1.3);

  for (let i = 0; i < 3; i++) {
    _v.set(dir.x + rand(-0.15, 0.15), dir.y + rand(0, 0.3), dir.z + rand(-0.15, 0.15)).normalize();
    spurt(core, x, y, z, _v.x, _v.y, _v.z, floor, 40);
  }
  giblets(core, x, y, z, dir.x, dir.y, dir.z, Math.round(rand(10, 14)), f * 0.6, floor);

  const n = 20;
  const s = core.chips.begin('droplet', BLOOD.splat, core.birth, 2, -20, floor, 0, 0);
  for (let i = 0; i < n; i++) {
    s.setLife(rand(1.5, 2.5));
    const push = f * 15;
    const vx = rand(-12.5, 12.5) + dir.x * push;
    const vy = rand(0, 20) + dir.y * push;
    const vz = rand(-12.5, 12.5) + dir.z * push;
    s.add(x, y, z, vx, vy, vz, rand(0.05, 0.2) * 0.45);
  }

  const m = core.smoke;
  const b = core.birth;
  for (let i = 0; i < 7; i++) {
    m.begin(BLOOD.mist, 0.15, b, 0.8, rand(0.3, 0.6), rand(0.8, 1.2), 3, 0.1, 0.4, SmokeMode.Flat);
    m.add(x, y, z, rand(-4, 4), rand(0, 5), rand(-4, 4), rand(-1, 1));
  }
  core.flashes.star(x, y, z, BLOOD.bright, 0.9, core.now, 0.05, 7, 0.22, 0.7, 0.35, 3);
  spatter(core, position, 1);
}

/**
 * The signature: 20 yellow chips, three chunks that visibly come apart (one skin-toned), dark shards
 * and a geyser. All on the same frame as the triple-layered sound.
 */
export function headBurst(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3): void {
  const { x, y, z } = position;
  const floor = core.floorAt(x, y, z);
  chipBurst(core, x, y, z, CHIP.yellow, 20, floor);
  chipBurst(core, x, y, z, BLOOD.deep, 15, floor, 0.9, 1.1);

  const chunk = (shape: ChipShape, color: typeof BLOOD.deep, size: number) => {
    const c = core.chips.begin(shape, color, core.birth, 3, -30, floor, 0.4, 0.7, 0.75);
    c.add(
      x, y, z,
      rand(-3, 3) + dir.x * 5, rand(2, 6) + dir.y * 5, rand(-3, 3) + dir.z * 5,
      size, rand(-5, 5), rand(-5, 5), rand(-5, 5),
    );
  };
  chunk('gem', BLOOD.skin, rand(0.13, 0.2));
  chunk('cube', BLOOD.brain, rand(0.09, 0.14));
  chunk('gem', BLOOD.deep, rand(0.11, 0.17));

  const m = core.chips.begin('shard', BLOOD.shard, core.birth, 0.6, -20, floor);
  for (let i = 0; i < 5; i++) {
    m.add(x, y, z, rand(-1.5, 1.5), rand(1, 3), rand(-1.5, 1.5), rand(0.1, 0.2), rand(-6, 6), rand(-6, 6), rand(-6, 6));
  }

  bloodJet(core, position, UP, 1);
  core.flashes.star(x, y, z, CHIP.yellow, 0.42, core.now, 0.05, 6, 0.24, 0.7, 0.4, 5);
  spatter(core, position, 0.7);
}
