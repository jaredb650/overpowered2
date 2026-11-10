/**
 * A small cannon round going off: the 20 mm of the rotary gun on key 8 and of the helicopter's door gun.
 *
 * It is made to be fired tens of times a second, so it is not an explosion from `explosions.ts`: no smoke column, no shock
 * sphere, no shimmer, no post effects and no chips to speak of. A white-hot core the size of a grapefruit with a few rays,
 * three lobes of fire that are gone in a tenth of a second, sparks thrown off the surface and a puff of what it hit.
 * About thirty particle records, and a short light for every other one, all from the pooled layers.
 */
import * as THREE from 'three';
import { rand } from '../../core/math';
import type { FxCore } from '../core';
import { SmokeMode } from '../layers/smoke';
import { hot } from '../layers/shared';
import { CHIP, FIRE, SMOKE, SPARK } from '../palette';
import { chipDome, sparkCone } from './bursts';

/** Radius of the white core at scale 1, metres. A grapefruit is about 0.07. */
const CORE = 0.075;
const RAYS = hot(0xffd070, 6);
const HEART = hot(0xffe9a0, 3.2);
/** One burst in this many leaves a scorch, so a held trigger does not turn the decal ring over. */
const SCORCH_EVERY = 3;
const LIGHT_EVERY = 2;

let serial = 0;

export function burst(core: FxCore, position: THREE.Vector3, normal: THREE.Vector3, scale = 1): void {
  const k = scale;
  // Stood a hand off the surface, so the sprites are not cut by the wall they lie against.
  const x = position.x + normal.x * 0.06 * k;
  const y = position.y + normal.y * 0.06 * k;
  const z = position.z + normal.z * 0.06 * k;
  const floor = core.floorAt(x, y, z);
  const now = core.now;
  const birth = core.birth;

  // Frame one: the crack. A hard white disc and thin rays, both gone inside three frames.
  core.flashes.star(x, y, z, FIRE.core, CORE * k, now, 0.05, 0, 0, 0.5, 0.6, 30);
  core.flashes.star(x, y, z, RAYS, CORE * 4.2 * k * rand(0.85, 1.2), now, 0.04, 7, 0.08, 0.7, 0.3, 10);

  // The pop of fire: a yellow heart inside two orange lobes, pushed off the surface.
  const s = core.smoke;
  const push = 1.6 * k;
  s.begin(FIRE.orange, 1, birth, 0.12, 0.09 * k, 0.17 * k, 7, 0.5, 0.03, SmokeMode.Fire);
  for (let i = 0; i < 2; i++) {
    s.add(x + rand(-0.05, 0.05) * k, y + rand(-0.05, 0.05) * k, z + rand(-0.05, 0.05) * k,
      normal.x * push + rand(-0.6, 0.6), normal.y * push + rand(-0.2, 0.8), normal.z * push + rand(-0.6, 0.6), rand(-1.5, 1.5));
  }
  s.begin(HEART, 1, birth, 0.075, 0.06 * k, 0.11 * k, 7, 0, 0.03, SmokeMode.Fire);
  s.add(x, y, z, normal.x * push * 0.5, normal.y * push * 0.5, normal.z * push * 0.5, rand(-1.5, 1.5));

  // What it hit, thrown off the face as dust, and a few pieces of it.
  s.begin(SMOKE.dust, 0.5, birth, rand(0.4, 0.65), 0.14 * k, 0.42 * k, 5, 0.35, 0.14, SmokeMode.Lit);
  for (let i = 0; i < 2; i++) {
    const v = rand(1.2, 3) * k;
    s.add(x, y, z, normal.x * v + rand(-0.7, 0.7), normal.y * v + rand(0, 0.7), normal.z * v + rand(-0.7, 0.7), rand(-1, 1));
  }
  sparkCone(core, x, y, z, normal.x, normal.y, normal.z, SPARK.yellow, Math.round(7 * k), floor, 13, 0.6, 0.016, 0.32);
  chipDome(core, x, y, z, normal, CHIP.debris, Math.round(3 * k), floor, 0.7, 0.55 * Math.sqrt(k), 'shard', 0.7);

  const render = core.ctx.render;
  // Every other burst lights the room: a light is paid for by every pixel in its reach, and at this rate one in two is
  // still a steady flicker on the wall.
  if (serial % LIGHT_EVERY === 0) render.lights.flash(position, 0xffb060, 3.6 * k, 4.5 * k, 0.07);
  if (serial % SCORCH_EVERY === 0) render.decals.add('scorch', position, normal, 0.26 * k, rand(0, 6.2832));
  serial++;
}
