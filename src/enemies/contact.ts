/**
 * What happens when the player runs into a body.
 *
 * Momentum is the game, so a crowd must never pin or stop a fast player: a hard capsule against 48 bodies would turn
 * a swarm into a cage. So bodies give way, and speed is rewarded for it. A running player shoulders the light ones
 * aside and knocks them off their feet, which turns a charge through a pack into a way out. Heavies do not move, and
 * the player slides around them like a pillar. Standing still inside someone eases the player out, so the camera
 * never sits in a skull.
 *
 * Contact itself never hurts. Every hit the player takes is a telegraphed attack; damage for touching would be
 * exactly the unreadable drizzle the director exists to prevent.
 *
 * `player.push` cancels a slide, a dash and a wall run, so it is only used on feet or in free flight. Those moves go
 * through everything, which is what makes them an escape.
 */
import * as THREE from 'three';
import type { Enemy } from './Enemy';
import type { AiWorld } from './aiWorld';

const PLAYER_RADIUS = 0.45;
/** Speed at which the player counts as hitting a body rather than leaning on it. */
const SHOVE_SPEED = 9;
/** Seconds between shoves on one body, so a slow pass does not rattle it every frame. */
const SHOVE_COOLDOWN = 0.7;
const SHOVE_STAGGER = 0.4;
/** Knockback per metre per second of the player's speed. */
const SHOVE_FORCE = 0.55;
/** Metres per second a player standing inside a body drifts out at. */
const EASE_OUT = 3.5;
/** The player's ground friction, which eats whatever is added before it can move them. */
const GROUND_STOP = 100;

const _v = new THREE.Vector3();

function canNudge(w: AiWorld): boolean {
  const s = w.ctx.player.state;
  return s === 'ground' || s === 'crouch' || s === 'air';
}

export function updateContact(e: Enemy, w: AiWorld, dt: number): void {
  const p = w.player;
  if (!p.alive || e.airborne || e.pinned) return;
  const dx = p.position.x - e.position.x;
  const dz = p.position.z - e.position.z;
  const reach = (e.def.contactRadius ?? e.def.radius) + PLAYER_RADIUS;
  const d2 = dx * dx + dz * dz;
  if (d2 >= reach * reach) return;
  // A body crawling on the floor is walked over, and a head passing overhead is not a collision.
  const dy = p.position.y - e.position.y;
  if (dy > e.char.rig.height * 0.8 || dy < -1.9 || e.maim.legs === 0) return;

  const d = Math.sqrt(d2) || 0.01;
  const nx = dx / d;
  const nz = dz / d;
  const vx = p.velocity.x;
  const vz = p.velocity.z;
  const speed = Math.hypot(vx, vz);
  const closing = -(vx * nx + vz * nz);

  if (e.def.mass > 0 && canNudge(w)) {
    // The inward part of the motion goes, the sideways part stays: a glancing run slides off and keeps its speed.
    const stop = Math.max(0, closing) * e.def.mass;
    const ease = (EASE_OUT + GROUND_STOP * dt * 0.5) * (1 - d / reach);
    w.ctx.player.push(_v.set(nx * (stop + ease), 0, nz * (stop + ease)));
  } else if (speed < SHOVE_SPEED && canNudge(w) && p.grounded) {
    const ease = (EASE_OUT + GROUND_STOP * dt * 0.5) * (1 - d / reach);
    w.ctx.player.push(_v.set(nx * ease, 0, nz * ease));
  }

  if (speed < SHOVE_SPEED || w.now < e.lastBumpAt + SHOVE_COOLDOWN || e.isBoss) return;
  e.lastBumpAt = w.now;
  // Thrown along the run and out to the side it was already on, so the path clears ahead of the player.
  const shove = speed * SHOVE_FORCE * (1 - e.def.mass * 0.7);
  e.push.x += (vx / speed) * shove * 0.6 - nx * shove;
  e.push.z += (vz / speed) * shove * 0.6 - nz * shove;
  e.char.anim.flinch(0, _v.set(vx / speed, 0, vz / speed), 1);
  w.ctx.audio.play('body_thud', { position: e.center, pitchJitter: 0.1 });
  w.ctx.camera.addTrauma(0.06 + e.def.mass * 0.1);
  if (e.def.mass < 0.5) w.enemies.stagger(e, SHOVE_STAGGER);
}
