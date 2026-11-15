/**
 * The Kiln's napalm: the hose in flight, a glob splashing, and a patch burning where it stuck. No layers of their own
 * but the hose ribbon: the fire round the stream and on the patches is the smoke ring's torn fire, the smoke peeling off
 * it the same ring's lit billows, falling drops are streaks.
 */
import * as THREE from 'three';
import { TAU, rand } from '../../core/math';
import type { FxCore } from '../core';
import { SmokeMode } from '../layers/smoke';
import { hot } from '../layers/shared';
import { FIRE, SPARK } from '../palette';
import { tangents } from './bursts';

const STRIDE = 6;
/** Napalm smoke is the one black smoke: oily, thick, and lit from above like the rest. */
const SOOT = hot(0x17130f, 0.75);
const SOOT_LIGHT = hot(0x2a241e, 0.75);
const GLOW = hot(0xff5a14, 0.5);
const LIGHT = 0xff7a30;

/** Fire sprites a second per chain point, smoke per point once it is old enough, drops falling off it. */
const WRAP_RATE = 12;
const SOOT_RATE = 1.1;
const DRIP_RATE = 0.9;

const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();
const _eye = new THREE.Vector3();

function fireColor() {
  const r = Math.random();
  return r < 0.3 ? FIRE.yellow : r < 0.7 ? FIRE.amber : FIRE.orange;
}

/** One frame of the hose: the ribbon, and the fire, smoke and drops coming off it. */
export function hose(core: FxCore, chain: Float32Array, count: number): void {
  const layer = core.hose;
  // The camera can ride on a rig, so its world position and not its local one.
  const m = core.ctx.render.camera.matrixWorld.elements;
  layer.draw(chain, count, _eye.set(m[12]!, m[13]!, m[14]!));
  const dt = core.ctx.time.dt;
  if (dt <= 0 || count < 2) return;
  const s = core.smoke;
  const b = core.birth;
  for (let i = 0; i < count - 1; i++) {
    const o = i * STRIDE;
    const q = o + STRIDE;
    // Not across the gap between two strands.
    if (chain[q + 5] === 1) continue;
    const age = chain[o + 3]!;
    // The first two metres are bare rope: fire there would sit on the screen in front of the gun.
    if (age < 0.08) continue;
    const n = Math.floor(dt * WRAP_RATE * (0.5 + age) + Math.random());
    for (let k = 0; k < n; k++) {
      const t = Math.random();
      const x = chain[o]! + (chain[q]! - chain[o]!) * t;
      const y = chain[o + 1]! + (chain[q + 1]! - chain[o + 1]!) * t;
      const z = chain[o + 2]! + (chain[q + 2]! - chain[o + 2]!) * t;
      const size = 0.16 + age * 0.75;
      s.begin(fireColor(), 1, b, rand(0.18, 0.34), size * 0.6, size * rand(1.2, 1.7), 3, 3, 0.05, SmokeMode.Fire);
      s.add(x + rand(-0.04, 0.04), y + rand(-0.04, 0.04), z + rand(-0.04, 0.04), rand(-0.5, 0.5), rand(0.3, 1.2), rand(-0.5, 0.5), rand(-4, 4));
    }
    if (age > 0.22 && Math.random() < dt * SOOT_RATE * (age + 0.4)) {
      const size = 0.25 + age * 0.5;
      s.begin(Math.random() < 0.5 ? SOOT : SOOT_LIGHT, 0.85, b, rand(1.1, 1.9), size, size * rand(2.2, 3), 1.2, 1.4, 0.12, SmokeMode.Lit);
      s.add(chain[o]! + rand(-0.1, 0.1), chain[o + 1]! + 0.15, chain[o + 2]! + rand(-0.1, 0.1), rand(-0.4, 0.4), rand(0.6, 1.4), rand(-0.4, 0.4), rand(-1, 1));
    }
    if (age > 0.12 && Math.random() < dt * DRIP_RATE) {
      const st = core.streaks.begin(SPARK.orange, b, rand(0.4, 0.7), -14, -1e6, 0.03, 0.25);
      st.add(chain[o]!, chain[o + 1]!, chain[o + 2]!, rand(-0.6, 0.6), rand(-1, 0.5), rand(-0.6, 0.6), rand(0.02, 0.035));
    }
  }
  // The stream lights what it passes, a third of the way out.
  if (Math.random() < dt * 14) {
    const o = Math.floor(count / 3) * STRIDE;
    _p.set(chain[o]!, chain[o + 1]!, chain[o + 2]!);
    core.ctx.render.lights.flash(_p, LIGHT, rand(5, 8), 8, 0.1);
  }
}

/** A glob landing: burning drops thrown off the surface, and a flare of fire where it hit. */
export function napalmSplash(core: FxCore, position: THREE.Vector3, normal: THREE.Vector3): void {
  const { x, y, z } = position;
  const b = core.birth;
  tangents(normal, _t, _b);
  const floor = normal.y > 0.7 ? y : -1e6;
  const st = core.streaks.begin(SPARK.orange, b, rand(0.3, 0.55), -16, floor, 0.03, 0.3, 0, 0, 0.1, 0.4);
  for (let i = 0; i < 3; i++) {
    const a = rand(0, TAU);
    const v = rand(1.5, 4);
    const u = rand(1.5, 4);
    st.add(x, y, z,
      (_t.x * Math.cos(a) + _b.x * Math.sin(a)) * v + normal.x * u,
      (_t.y * Math.cos(a) + _b.y * Math.sin(a)) * v + normal.y * u,
      (_t.z * Math.cos(a) + _b.z * Math.sin(a)) * v + normal.z * u,
      rand(0.02, 0.04));
  }
  const size = rand(0.3, 0.5);
  core.smoke.begin(fireColor(), 1, b, rand(0.18, 0.3), size * 0.6, size * 1.4, 3, 3, 0.05, SmokeMode.Fire);
  core.smoke.add(x + normal.x * 0.1, y + normal.y * 0.1, z + normal.z * 0.1, normal.x * 1.5, normal.y * 1.5 + 0.8, normal.z * 1.5, rand(-3, 3));
}

/**
 * One frame of a patch burning on its surface: tall licks of fire scattered over it, a glow on the surface, oily black
 * smoke, and on a wall drops of burning fuel running off it. `heat` 0..1 thins all of it.
 */
export function napalm(core: FxCore, position: THREE.Vector3, normal: THREE.Vector3, radius: number, heat: number): void {
  const dt = core.ctx.time.dt;
  if (dt <= 0 || heat <= 0) return;
  const s = core.smoke;
  const b = core.birth;
  tangents(normal, _t, _b);
  const wall = normal.y < 0.6;
  const n = Math.floor(dt * 36 * radius * heat + Math.random());
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU);
    const d = Math.sqrt(Math.random()) * radius * 0.85;
    const c = Math.cos(a) * d;
    const e = Math.sin(a) * d;
    const size = rand(0.26, 0.48) * (0.55 + 0.45 * heat) * (0.75 + radius * 0.3);
    s.begin(fireColor(), 1, b, rand(0.35, 0.7), size * 0.5, size, 2, wall ? 3.2 : 4.4, 0.05, SmokeMode.Fire);
    s.add(
      position.x + _t.x * c + _b.x * e + normal.x * 0.1,
      position.y + _t.y * c + _b.y * e + normal.y * 0.1 + size * 0.2,
      position.z + _t.z * c + _b.z * e + normal.z * 0.1,
      normal.x * 0.5 + rand(-0.25, 0.25), rand(0.5, 1.3), normal.z * 0.5 + rand(-0.25, 0.25), rand(-3, 3),
    );
  }
  if (Math.random() < dt * 4 * heat) {
    s.begin(GLOW, 1, b, rand(0.3, 0.45), radius * 1.6, radius * 1.9, 1, 0, 0.2, SmokeMode.Glow);
    s.add(position.x + normal.x * 0.12, position.y + normal.y * 0.12, position.z + normal.z * 0.12, 0, 0, 0);
  }
  if (Math.random() < dt * 1.2 * heat * (0.5 + radius)) {
    const size = rand(0.35, 0.6) * (0.7 + radius * 0.4);
    s.begin(Math.random() < 0.5 ? SOOT : SOOT_LIGHT, 0.8, b, rand(1.4, 2.2), size, size * rand(1.8, 2.5), 1, 1.6, 0.12, SmokeMode.Lit);
    s.add(position.x + normal.x * 0.3, position.y + normal.y * 0.3 + 0.7, position.z + normal.z * 0.3, rand(-0.3, 0.3), rand(0.8, 1.6), rand(-0.3, 0.3), rand(-1, 1));
  }
  if (wall && Math.random() < dt * 1.5 * heat) {
    const st = core.streaks.begin(SPARK.orange, b, rand(0.5, 0.9), -9, -1e6, 0.05, 0.3);
    st.add(position.x + normal.x * 0.05 + _t.x * rand(-radius, radius) * 0.6, position.y - radius * 0.4, position.z + normal.z * 0.05 + _t.z * rand(-radius, radius) * 0.6,
      0, -0.2, 0, rand(0.02, 0.03));
  }
  if (Math.random() < dt * 2 * heat) {
    _p.copy(position).addScaledVector(normal, 0.6);
    core.ctx.render.lights.flash(_p, LIGHT, (2 + radius * 4) * heat, 4 + radius * 3, 0.3);
  }
}
