/**
 * Blood on the floor behind a wounded man (section 14.6): drips while he walks, a pool where he stops, and a smear where he drags
 * himself. Decals have a hard cap with oldest-out eviction, so a trail can only ever be as long as the budget allows.
 */
import * as THREE from 'three';
import type { AiWorld } from '../aiWorld';
import type { Enemy } from '../Enemy';
import type { Injuries } from './injuries';

/** Metres between drops at a heavy bleed, and at a slight one. */
const SPACING_HEAVY = 0.45;
const SPACING_LIGHT = 1.6;
/** Bleed share that counts as heavy. */
const HEAVY = 0.05;
/** Close enough that the marks run together into one drag. */
const SMEAR_SPACING = 0.24;
/** Seconds between drops into the same spot, standing still. */
const POOLING = 1.3;
const DROP_SIZE = 0.13;
const POOL_SIZE = 0.26;
const SMEAR_SIZE = 0.42;
/** What he leaves lying still. Pools grow by themselves. */
const LYING_POOL = 0.6;

const UP = new THREE.Vector3(0, 1, 0);
const _at = new THREE.Vector3();

export function dripTrail(e: Enemy, b: Injuries, w: AiWorld, now: number): void {
  const flowing = b.bleed > 0 || b.condition === 'mortal' || b.floored;
  if (!flowing || e.downed) return;
  const moved = Math.hypot(e.position.x - b.dripX, e.position.z - b.dripZ);
  const heavy = Math.min(1, b.bleed / HEAVY);
  const spacing = b.floored ? SMEAR_SPACING : SPACING_LIGHT + (SPACING_HEAVY - SPACING_LIGHT) * heavy;
  const still = moved < 0.08 && now >= b.nextDrip;
  if (moved < spacing && !still) return;
  const decals = w.ctx.render.decals;
  // On the floor itself. The stain is drawn against the depth of what is there, and anything off it does not show.
  const ground = w.ctx.world.nav.groundHeight(e.position.x, e.position.y + 0.5, e.position.z);
  _at.set(e.position.x, Number.isNaN(ground) ? e.position.y : ground, e.position.z);
  if (b.floored && still) {
    decals.add('bloodPool', _at, UP, LYING_POOL);
  } else if (b.floored) {
    decals.add('bloodSmear', _at, UP, SMEAR_SIZE, Math.atan2(e.position.x - b.dripX, e.position.z - b.dripZ));
  } else {
    // Off the centre line: drops fall from a wound, and a wound is on one side of a man.
    _at.x += (Math.random() - 0.5) * 0.3;
    _at.z += (Math.random() - 0.5) * 0.3;
    decals.add('blood', _at, UP, still ? POOL_SIZE : DROP_SIZE * (0.7 + heavy * 0.8));
  }
  b.dripX = e.position.x;
  b.dripZ = e.position.z;
  b.nextDrip = now + POOLING;
}
