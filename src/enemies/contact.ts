/**
 * What happens when the player runs into a body.
 *
 * Momentum is the game, so a crowd must never pin or stop a fast player: a hard capsule against 48 bodies would turn
 * a swarm into a cage. So light bodies give way, and speed is rewarded for it: a running player shoulders them aside
 * and knocks them off their feet, which turns a charge through a pack into a way out. Middling ones bump a run to a
 * stop and can be leaned through. Standing inside someone bumps the player out, so the camera never sits in a skull.
 *
 * The big ones are solid (`SOLID_MASS`). There is no body to collide with, because enemies are points on the nav graph
 * and the player's capsule only sees the world, so a solid body works on the player's speed: it takes away whatever
 * would carry the player into it in the next frame, sideways motion stays so a glancing run slides round, and any
 * overlap is walked back out. Working on velocity leaves every actual move to the player's own sweep, which is what
 * makes this safe: the push can only ever end against a wall, never through one, and it adds no height, so it cannot
 * throw anyone. A body and a wall can still close on the player, so sitting deep in one for `WEDGE_SECONDS` drops solid
 * bodies for a moment. Being trapped is worse than clipping a boss.
 *
 * Contact itself never hurts. Every hit the player takes is a telegraphed attack; damage for touching would be
 * exactly the unreadable drizzle the director exists to prevent.
 *
 * `player.push` cancels a slide, a dash and a wall run, so a bump only uses it on feet or in free flight, and those
 * moves go straight through light bodies, which is what makes them an escape. It also lifts the player off the floor,
 * where nothing bleeds the speed away, so repeated every frame it adds up to a throw. It is a single bump, `NUDGE_GAP`
 * apart.
 */
import * as THREE from 'three';
import { MOVE } from '../player/tuning';
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
/** Metres per second of the bump out of a body, at full overlap. That clears about half a metre. */
const EASE_OUT = 3.5;
/** Seconds between bumps, shared by every body, so a crowd cannot stack them. */
const NUDGE_GAP = 0.35;
/** `mass` from here up cannot be walked through. A Brute is 0.8, a Riot 0.35. */
const SOLID_MASS = 0.5;
/** Metres per second back out of a solid body, per metre of overlap, and the most it ever is. */
const OUT_RATE = 30;
const OUT_MAX = 6;
/** Fastest a solid body walking into the player carries them along. */
const CARRY_MAX = 9;
/** Overlap past what holding a key into a body can reach, even at 20 fps. Deeper than this, something has closed on the player. */
const WEDGE_DEPTH = 0.25;
const WEDGE_SECONDS = 0.4;
/** How long solid bodies let go for, which is time to walk out. */
const WEDGE_RELEASE = 0.9;
const MIN_STEP = 1 / 240;

const _v = new THREE.Vector3();

function canNudge(w: AiWorld): boolean {
  const s = w.ctx.player.state;
  return s === 'ground' || s === 'crouch' || s === 'air';
}

/**
 * Feet on the ground grip along the keys and scrub off everything else, so held against a round body they would stick
 * to it instead of sliding round. Against a wall the player's own sweep sorts this out. Here it is given back: the part
 * of the keys that runs along the body, at running speed, as it would along a wall.
 */
function slideRound(w: AiWorld, nx: number, nz: number): void {
  const { input, player } = w.ctx;
  const fwd = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
  const side = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
  if (fwd === 0 && side === 0) return;
  const s = Math.sin(player.yaw);
  const c = Math.cos(player.yaw);
  const length = Math.hypot(fwd, side);
  const wx = (side * c - fwd * s) / length;
  const wz = (-side * s - fwd * c) / length;
  const into = -(wx * nx + wz * nz);
  if (into <= 0) return;
  const tx = wx + into * nx;
  const tz = wz + into * nz;
  const along = Math.hypot(tx, tz);
  if (along < 1e-3) return;
  const v = player.velocity;
  const want = MOVE.runSpeed * player.modifiers.speed * along;
  const have = (v.x * tx + v.z * tz) / along;
  if (have >= want) return;
  v.x += (tx / along) * (want - have);
  v.z += (tz / along) * (want - have);
}

/** Keeps the player out of a solid body. `gap` is the room left between them, negative once they overlap. */
function holdOff(e: Enemy, w: AiWorld, nx: number, nz: number, gap: number, step: number): void {
  const p = w.player;
  const { player, time } = w.ctx;
  const now = time.playerElapsed;
  if (now < p.solidFreeAt || player.state === 'mantle') return;
  if (gap < -WEDGE_DEPTH) {
    if (now - p.wedgeSeen > 0.15) p.wedgeSince = now;
    p.wedgeSeen = now;
    if (now - p.wedgeSince > WEDGE_SECONDS) {
      p.solidFreeAt = now + WEDGE_RELEASE;
      return;
    }
  }
  const v = player.velocity;
  const away = v.x * nx + v.z * nz;
  const coming = Math.min(Math.max(e.velocity.x * nx + e.velocity.z * nz, 0), CARRY_MAX);
  // Above the surface this is how fast the player may still close and only just touch. In it, how fast they must leave.
  const least = gap > 0 ? coming - gap / step : coming + Math.min(-gap * OUT_RATE, OUT_MAX);
  if (away >= least) return;
  v.x += nx * (least - away);
  v.z += nz * (least - away);
  // These two write their own velocity every tick, so they have to be ended, or they would carry on through it.
  if (player.dashing || player.wallRunning) player.push(_v.set(0, 0, 0));
  else if (player.grounded && !player.sliding) slideRound(w, nx, nz);
}

export function updateContact(e: Enemy, w: AiWorld): void {
  const p = w.player;
  if (!p.alive || e.airborne || e.pinned || e.carried) return;
  const dx = p.position.x - e.position.x;
  const dz = p.position.z - e.position.z;
  const solid = e.def.mass >= SOLID_MASS;
  const reach = (e.def.contactRadius ?? e.def.radius) + PLAYER_RADIUS;
  const step = Math.max(w.ctx.time.playerDt, MIN_STEP);
  // A dash covers most of a body's width in a slow frame, so a solid body has to look one frame ahead.
  const outer = solid ? reach + p.speed * step : reach;
  const d2 = dx * dx + dz * dz;
  if (d2 >= outer * outer) return;
  // A body crawling on the floor is walked over, and a head passing overhead is not a collision. A boss is still a
  // wall of torso with its legs gone.
  const dy = p.position.y - e.position.y;
  if (dy > e.char.rig.height * 0.8 || dy < -1.9 || (e.maim.legs === 0 && !e.isBoss)) return;

  const d = Math.sqrt(d2) || 0.01;
  const nx = dx / d;
  const nz = dz / d;
  const vx = p.velocity.x;
  const vz = p.velocity.z;
  const speed = Math.hypot(vx, vz);
  const closing = -(vx * nx + vz * nz);

  if (solid) {
    holdOff(e, w, nx, nz, d - reach, step);
    // Held off a frame early, a run never quite touches. Head-on it still lands.
    if (closing < SHOVE_SPEED) return;
  } else {
    if (d >= reach) return;
    if ((e.def.mass > 0 || (speed < SHOVE_SPEED && p.grounded)) && w.now >= p.nudgeAt && canNudge(w)) {
      p.nudgeAt = w.now + NUDGE_GAP;
      // The inward part of the motion goes, the sideways part stays: a glancing run slides off and keeps its speed.
      const bump = Math.max(0, closing) * e.def.mass + EASE_OUT * (1 - d / reach);
      w.ctx.player.push(_v.set(nx * bump, 0, nz * bump));
    }
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
  if (e.def.mass < 0.5) w.enemies.stagger(e, SHOVE_STAGGER, _v, 0.6);
}
