/**
 * Dragon's breath (thresherDragon, billhookDragon): magnesium 12-gauge incendiary blast.
 *
 * A blinding white-gold-to-orange tongue of fire shooting straight out of the barrel, a wide conical shower of
 * bouncing, skittering magnesium sparks reaching ~20 m, lingering hot embers, trailing gunsmoke, and a warm flash
 * that lights up the whole room.
 */
import * as THREE from 'three';
import { rand } from '../../core/math';
import type { FxCore } from '../core';
import { SmokeMode } from '../layers/smoke';
import { hot } from '../layers/shared';
import { FIRE, SMOKE, SPARK } from '../palette';
import { tangents } from './bursts';

const _dir = new THREE.Vector3();
const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _side = new THREE.Vector3();
const _ahead = new THREE.Vector3();

const CORE_FLASH = hot(0xfff0b0, 3.2);
const MAGNESIUM_WHITE = hot(0xfff6d4, 7.5);
const MAGNESIUM_GOLD = hot(0xffba30, 5.5);
const MAGNESIUM_ORANGE = hot(0xff5e12, 4.2);

export function dragonBreath(core: FxCore, position: THREE.Vector3, dir: THREE.Vector3): void {
  const lenSq = dir.lengthSq();
  if (lenSq > 1e-8) _dir.copy(dir).multiplyScalar(1 / Math.sqrt(lenSq));
  else _dir.set(0, 0, -1);
  tangents(_dir, _t, _b);

  const { x, y, z } = position;
  const dx = _dir.x;
  const dy = _dir.y;
  const dz = _dir.z;
  const birth = core.birth;
  const now = core.now;
  const floor = core.floorAt(x, y, z);

  // Room-lighting magnesium flash at the muzzle plus a warm downrange bounce light along the fire tongue.
  const lights = core.ctx.render.lights;
  lights.flash(position, 0xff9428, 18, 22, 0.15);
  _ahead.set(x + dx * 3.8, y + dy * 3.8, z + dz * 3.8);
  lights.flash(_ahead, 0xff6814, 12, 16, 0.2);

  // Blinding core star + three long flame petals tearing downrange from the crown.
  core.flashes.star(x + dx * 0.12, y + dy * 0.12, z + dz * 0.12, CORE_FLASH, 0.65, now, 0.065, 9, 0.22, 0.9, 0.5, 6);
  for (let i = 0; i < 3; i++) {
    const a = (i - 1) * 0.18 + rand(-0.05, 0.05);
    const e = rand(-0.08, 0.08);
    _side.set(dx + _t.x * a + _b.x * e, dy + _t.y * a + _b.y * e, dz + _t.z * a + _b.z * e).normalize();
    core.flashes.petal(
      x + dx * 0.08, y + dy * 0.08, z + dz * 0.08,
      _side.x, _side.y, _side.z,
      i === 1 ? CORE_FLASH : FIRE.amber,
      rand(1.9, 2.7), rand(0.28, 0.42),
      now, 0.075, 0.88, 0.45, 5,
    );
  }

  // Long rolling tongue of fire (16 staggered Fire puffs stretching ~5-8 m out).
  const smoke = core.smoke;
  for (let i = 0; i < 16; i++) {
    const u = i / 15;
    const dist = 0.18 + u * 2.4 + rand(0, 0.22);
    const spread = (0.04 + u * 0.24);
    const sx = rand(-spread, spread);
    const sy = rand(-spread, spread);
    const px = x + dx * dist + _t.x * sx + _b.x * sy;
    const py = y + dy * dist + _t.y * sx + _b.y * sy;
    const pz = z + dz * dist + _t.z * sx + _b.z * sy;
    const speed = rand(14, 30) * (0.65 + 0.55 * (1 - u));
    const jx = rand(-2.6, 2.6) * (0.4 + u);
    const jy = rand(-2.2, 2.6) * (0.4 + u);
    const col = u < 0.25 ? FIRE.yellow : u < 0.6 ? FIRE.amber : u < 0.85 ? FIRE.orange : FIRE.red;
    const life = rand(0.24, 0.44) * (0.85 + 0.3 * u);
    const s0 = rand(0.16, 0.28) * (0.7 + 0.6 * u);
    const s1 = s0 * rand(2.4, 3.6);
    smoke.begin(col, 0.98, birth, life, s0, s1, 4.0, 2.4, 0.06, SmokeMode.Fire);
    smoke.add(
      px, py, pz,
      dx * speed + _t.x * jx + _b.x * jy,
      dy * speed + _t.y * jx + _b.y * jy + rand(0.3, 1.2),
      dz * speed + _t.z * jx + _b.z * jy,
      rand(-4, 4),
    );
  }

  // Additive saturated glow along the tongue so the flame casts a hot bloom envelope.
  smoke.begin(FIRE.glow, 0.52, birth, 0.26, 0.65, 2.2, 3.2, 0.6, 0.18, SmokeMode.Glow);
  for (let i = 0; i < 3; i++) {
    const d = 0.8 + i * 1.4;
    smoke.add(x + dx * d, y + dy * d, z + dz * d, dx * 8, dy * 8 + 0.3, dz * 8, 0);
  }

  // Fast blinding white-gold magnesium core sparks (reaching ~20 m, bouncing off the floor).
  const white = core.streaks.begin(MAGNESIUM_WHITE, birth, 0.9, -13, floor, 0.042, 2.0, 1.4, 0, 0.52, 0.44);
  for (let i = 0; i < 26; i++) {
    const speed = rand(22, 42);
    const a = rand(-0.18, 0.18);
    const e = rand(-0.16, 0.16);
    white.setLife(rand(0.55, 1.15));
    white.add(
      x + dx * 0.18, y + dy * 0.18, z + dz * 0.18,
      (dx + _t.x * a + _b.x * e) * speed,
      (dy + _t.y * a + _b.y * e) * speed + rand(-0.5, 1.4),
      (dz + _t.z * a + _b.z * e) * speed,
      rand(0.014, 0.026),
    );
  }

  // Wide cascading amber/orange magnesium shower that bounces and skitters glowing across the floor.
  const amber = core.streaks.begin(MAGNESIUM_GOLD, birth, 1.25, -13.5, floor, 0.036, 1.4, 1.15, 0, 0.58, 0.36);
  for (let i = 0; i < 24; i++) {
    const speed = rand(14, 32);
    const a = rand(-0.28, 0.28);
    const e = rand(-0.24, 0.26);
    amber.setLife(rand(0.8, 1.55));
    amber.add(
      x + dx * 0.25, y + dy * 0.25, z + dz * 0.25,
      (dx + _t.x * a + _b.x * e) * speed,
      (dy + _t.y * a + _b.y * e) * speed + rand(-1.0, 1.8),
      (dz + _t.z * a + _b.z * e) * speed,
      rand(0.012, 0.022),
    );
  }
  const orange = core.streaks.begin(MAGNESIUM_ORANGE, birth, 1.45, -12.5, floor, 0.032, 1.1, 1.1, 0, 0.62, 0.32);
  for (let i = 0; i < 22; i++) {
    const speed = rand(10, 26);
    const a = rand(-0.34, 0.34);
    const e = rand(-0.28, 0.30);
    orange.setLife(rand(0.95, 1.8));
    orange.add(
      x + dx * 0.3, y + dy * 0.3, z + dz * 0.3,
      (dx + _t.x * a + _b.x * e) * speed,
      (dy + _t.y * a + _b.y * e) * speed + rand(-1.2, 2.0),
      (dz + _t.z * a + _b.z * e) * speed,
      rand(0.011, 0.02),
    );
  }

  // Lingering glowing embers / floating hot magnesium flakes drifting in the wake.
  const ember = core.streaks.begin(SPARK.ember, birth, 1.8, -3.2, floor, 0.016, 0.35, 2.2, 1.4, 0.32, 0.55);
  for (let i = 0; i < 18; i++) {
    const speed = rand(5, 16);
    const a = rand(-0.32, 0.32);
    const e = rand(-0.22, 0.32);
    ember.setLife(rand(1.2, 2.2));
    ember.add(
      x + dx * rand(0.4, 2.2), y + dy * rand(0.4, 2.2), z + dz * rand(0.4, 2.2),
      (dx + _t.x * a + _b.x * e) * speed,
      (dy + _t.y * a + _b.y * e) * speed + rand(0.5, 2.2),
      (dz + _t.z * a + _b.z * e) * speed,
      rand(0.01, 0.018),
    );
  }

  // Trailing hot gunsmoke plume rolling off the fire tongue.
  smoke.begin(SMOKE.mid, 0.32, birth, rand(0.9, 1.4), 0.25, 1.25, 2.4, 1.2, 0.22, SmokeMode.Lit);
  for (let i = 0; i < 5; i++) {
    const d = 0.5 + i * 0.7;
    smoke.add(
      x + dx * d + rand(-0.15, 0.15), y + dy * d + rand(-0.1, 0.15), z + dz * d + rand(-0.15, 0.15),
      dx * rand(2.5, 6) + rand(-0.6, 0.6), dy * rand(2.5, 6) + rand(0.4, 1.2), dz * rand(2.5, 6) + rand(-0.6, 0.6),
      rand(-1.2, 1.2),
    );
  }
}
