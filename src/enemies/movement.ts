/**
 * Steering. Enemies have no physics bodies: they read the flow field, push apart from each other, and stay on the
 * ground through nav height. Every frame this does a little arithmetic per enemy; anything costlier is cached.
 */
import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/math';
import { say } from './attacks';
import type { Enemy } from './Enemy';
import type { AiWorld } from './aiWorld';

const GRAVITY = -28;
/** Tallest rise walked up without a jump. */
const STEP_UP = 0.75;
/** A drop bigger than this is a fall, not a step. */
const STEP_DOWN = 0.9;
/** Jump links: how far ahead and how high an enemy can reach when the flow runs into a ledge. */
const JUMP_REACH = 4;
const JUMP_HEIGHT = 7;
const GROUND_SAMPLE_STEP = 0.3;
/** Gap bodies keep from each other. Tight enough that a pack reads as one mass. */
const SEPARATION_GAP = 0.55;
/** How hard a crowd jostles, in m/s, before the body's own top speed caps it. */
const SEPARATION_PACE = 3.5;
const WALL_PROBE_SECONDS = 0.25;
const WALL_PROBE_REACH = 1.3;
/** How far from a pad's own node an enemy walks before it just leaps for the far end. */
const PAD_MISS_HOPS = 1;

const _d = new THREE.Vector3();
const _sep = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _pad = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Sets a ballistic arc that lands on `target` after `seconds`, with `apex` metres of extra rise. */
export function leapTo(e: Enemy, target: THREE.Vector3, seconds: number, apex = 1): void {
  const t = Math.max(seconds, 0.1);
  e.velocity.x = (target.x - e.position.x) / t;
  e.velocity.z = (target.z - e.position.z) / t;
  // Rise needed to reach the target height at t, plus a term for a visible arc.
  e.verticalSpeed = (target.y - e.position.y) / t - 0.5 * GRAVITY * t + (apex > 0 ? apex * 0.5 : 0);
  e.airborne = true;
  e.ballistic = true;
}

function flowInto(e: Enemy, w: AiWorld, out: THREE.Vector3): void {
  const nav = w.ctx.world.nav;
  if (nav.flowDirection(e.position, out)) return;
  // Knocked off the graph or dropped outside it: head for the nearest walkable cell, then the player.
  if (nav.nearest(e.position, 14, _p)) out.subVectors(_p, e.position);
  else out.subVectors(w.player.position, e.position);
  out.y = 0;
  out.normalize();
}

/** Uphill on the path-distance field: a real retreat that follows corridors, not a walk into the nearest wall. */
function fleeInto(e: Enemy, w: AiWorld, out: THREE.Vector3): void {
  const nav = w.ctx.world.nav;
  const here = nav.pathDistance(e.position);
  let best = here;
  let bx = 0;
  let bz = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + e.uid;
    _p.set(e.position.x + Math.sin(a) * 2.5, e.position.y + 0.4, e.position.z + Math.cos(a) * 2.5);
    const d = nav.pathDistance(_p);
    if (Number.isFinite(d) && d > best) {
      best = d;
      bx = Math.sin(a);
      bz = Math.cos(a);
    }
  }
  if (bx === 0 && bz === 0) {
    out.subVectors(e.position, w.player.position);
    out.y = 0;
    out.normalize();
  } else out.set(bx, 0, bz);
}

/**
 * Point, orbit and flee moves skip the field, and the node grid is too coarse to see a thin wall.
 * A short budgeted ray catches those. Flow never needs it.
 */
function probeWall(e: Enemy, w: AiWorld): void {
  if (w.now < e.probeAt || w.now < e.flowUntil || !w.director.spendRay()) return;
  e.probeAt = w.now + WALL_PROBE_SECONDS;
  _p.copy(e.position);
  _p.y += 1;
  if (w.ctx.physics.raycast(_p, e.desired, WALL_PROBE_REACH) === null) return;
  if (e.mode === 'orbit') e.orbitDir = -e.orbitDir;
  else e.flowUntil = w.now + 1.2;
}

function desiredDirection(e: Enemy, w: AiWorld, dt: number): number {
  const d = e.desired;
  const player = w.player.position;
  let mode = e.mode;
  if (w.now < e.flowUntil) mode = 'flow';
  switch (mode) {
    case 'flow': {
      flowInto(e, w, d);
      if (e.weave > 0) {
        e.weavePhase += dt * 2.2;
        const a = Math.sin(e.weavePhase + e.uid) * e.weave;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const x = d.x * c + d.z * s;
        d.z = d.z * c - d.x * s;
        d.x = x;
      }
      return 1;
    }
    case 'point': {
      d.subVectors(e.moveTarget, e.position);
      d.y = 0;
      const len = d.length();
      if (len < 0.4) {
        d.set(0, 0, 0);
        return 0;
      }
      d.multiplyScalar(1 / len);
      return clamp(len / 1.5, 0.35, 1);
    }
    case 'orbit': {
      _p.subVectors(e.position, player);
      _p.y = 0;
      const r = _p.length() || 1;
      _p.multiplyScalar(1 / r);
      d.set(_p.z * e.orbitDir, 0, -_p.x * e.orbitDir);
      d.addScaledVector(_p, clamp((e.orbitRadius - r) * 0.5, -1, 1)).normalize();
      return 1;
    }
    case 'flee':
      e.timerB -= dt;
      if (e.timerB <= 0) {
        e.timerB = 0.35;
        fleeInto(e, w, e.scratchPoint);
      }
      d.copy(e.scratchPoint);
      return 1;
    case 'hold':
    default:
      d.set(0, 0, 0);
      return 0;
  }
}

function separate(e: Enemy, w: AiWorld, alive: readonly Enemy[]): void {
  _sep.set(0, 0, 0);
  const px = e.position.x;
  const py = e.position.y;
  const pz = e.position.z;
  const r = e.def.radius;
  for (let i = 0; i < alive.length; i++) {
    const o = alive[i]!;
    if (o === e || o.airborne) continue;
    const dx = px - o.position.x;
    const dz = pz - o.position.z;
    const reach = r + o.def.radius + SEPARATION_GAP;
    const d2 = dx * dx + dz * dz;
    if (d2 > reach * reach || Math.abs(py - o.position.y) > 2) continue;
    const d = Math.sqrt(d2) || 0.01;
    const push = (1 - d / reach) * (o.def.radius / r);
    // Half straight apart and half sideways by uid: crowds flow past each other rather than bounce off.
    const tangent = e.uid < o.uid ? 0.6 : -0.6;
    _sep.x += ((dx / d) - (dz / d) * tangent) * push;
    _sep.z += ((dz / d) + (dx / d) * tangent) * push;
  }
  // Capped, or the sum of its neighbours flings a body in the middle of a pack faster than it can walk.
  const crowd = Math.hypot(_sep.x, _sep.z);
  if (crowd > 1) _sep.multiplyScalar(1 / crowd);
  // Stand off the player so nobody clips into the camera. Lunges are ballistic and skip this.
  const dxp = px - w.player.position.x;
  const dzp = pz - w.player.position.z;
  const dp = Math.hypot(dxp, dzp) || 0.01;
  const personal = r + 0.7;
  if (dp < personal) {
    const push = (1 - dp / personal) * 2.5;
    _sep.x += (dxp / dp) * push;
    _sep.z += (dzp / dp) * push;
  }
}

function integrateAir(e: Enemy, w: AiWorld, dt: number): void {
  e.verticalSpeed += GRAVITY * dt;
  e.position.x += e.velocity.x * dt;
  e.position.z += e.velocity.z * dt;
  e.position.y += e.verticalSpeed * dt;
  if (e.verticalSpeed > 0) return;
  const ground = w.ctx.world.nav.groundHeight(e.position.x, e.position.y + 1, e.position.z);
  if (Number.isNaN(ground)) {
    // Over a hole with no floor below: put the enemy back on the nearest ground rather than lose it forever.
    if (e.position.y < -40 && w.ctx.world.nav.nearest(e.position, 60, _p)) e.position.copy(_p);
    return;
  }
  if (e.position.y <= ground) {
    e.position.y = ground;
    e.groundY = ground;
    const impact = -e.verticalSpeed;
    e.airborne = false;
    e.ballistic = false;
    e.verticalSpeed = 0;
    e.groundSampleAt.set(e.position.x, e.position.z);
    if (impact > 7) e.char.anim.play('land', 1.3);
  }
}

/** Runs the flow into a ledge: look for a landing above it. This is how drops and jump links read from the field. */
function tryJumpUp(e: Enemy, w: AiWorld, dir: THREE.Vector3): boolean {
  if (e.maim.legs < 2 || !w.director.spendRay()) return false;
  const nav = w.ctx.world.nav;
  const x = e.position.x + dir.x * JUMP_REACH;
  const z = e.position.z + dir.z * JUMP_REACH;
  const landing = nav.groundHeight(x, e.position.y + JUMP_HEIGHT, z);
  if (Number.isNaN(landing)) return false;
  const rise = landing - e.position.y;
  if (rise < STEP_UP || rise > JUMP_HEIGHT) return false;
  _q.set(x, landing, z);
  e.char.anim.play('leap');
  leapTo(e, _q, clamp(0.45 + rise * 0.07, 0.45, 0.9), 1);
  return true;
}

export function updateMovement(e: Enemy, w: AiWorld, dt: number, alive: readonly Enemy[]): void {
  if (e.pinned) {
    updateFacing(e, w, dt);
    return;
  }
  if (e.airborne) {
    integrateAir(e, w, dt);
    return;
  }

  const stunned = e.stagger > 0;
  const throttle = stunned ? 0 : desiredDirection(e, w, dt);
  if (throttle > 0 && e.mode !== 'flow') probeWall(e, w);
  separate(e, w, alive);

  let speed = e.def.speed * e.speedMul * e.pace * throttle * (1 + e.buff * 0.12);
  if (e.attack) speed *= e.attack.moveMul;
  speed *= gaitSpeed(e, dt);

  const d = e.desired;
  const accel = e.def.accel;
  const jostle = Math.min(e.def.speed, SEPARATION_PACE);
  let tx = d.x * speed + _sep.x * jostle;
  let tz = d.z * speed + _sep.z * jostle;
  // A crowd steers a body. It must never carry one past its own walking speed.
  const top = Math.max(speed, jostle);
  const wanted = Math.hypot(tx, tz);
  if (wanted > top) {
    tx *= top / wanted;
    tz *= top / wanted;
  }
  e.velocity.x = damp(e.velocity.x, tx, accel, dt);
  e.velocity.z = damp(e.velocity.z, tz, accel, dt);

  // Knockback bleeds off quickly so a heavy hit shoves without sliding the enemy around like ice.
  const rate = Math.exp(-7 * dt);
  e.push.x *= rate;
  e.push.z *= rate;

  const stepX = (e.velocity.x + e.push.x) * dt;
  const stepZ = (e.velocity.z + e.push.z) * dt;
  moveOnGround(e, w, stepX, stepZ, dt, speed);
  updateFacing(e, w, dt);
}

/** Maimed gaits pull in pulses. The rhythm is what makes a crawler look like it is dragging itself. */
function gaitSpeed(e: Enemy, dt: number): number {
  const m = e.maim;
  if (m.legs === 2) return 1;
  if (m.legs === 1) {
    e.gaitPhase += dt * 4;
    const s = Math.sin(e.gaitPhase);
    return s > 0 ? 0.3 + s * 1.2 : 0.25;
  }
  e.gaitPhase += dt * (m.arms === 0 ? 5 : 3.2);
  const s = Math.sin(e.gaitPhase);
  return s > 0 ? 0.15 + s * s * 1.9 : 0.05;
}

/**
 * Pads throw enemies exactly as they throw the player: gravity is the same, so the flight matches the arc the map
 * was tuned and swept for. An enemy that comes in off the pad's edge still has to go, so it leaps for the far end.
 */
function takePad(e: Enemy, w: AiWorld): boolean {
  const { world, audio, fx } = w.ctx;
  if (world.objects.padAt(e.position, _pad)) {
    e.velocity.x = _pad.x;
    e.velocity.z = _pad.z;
    e.verticalSpeed = _pad.y;
    e.airborne = e.ballistic = true;
    w.enemies.linksTaken++;
    fx.jumpPad(e.position, UP);
    audio.play('jump_pad', { position: e.position });
    say(e, w, e.def.voice.bark, 0.5);
    return true;
  }
  if (world.nav.linkAhead(e.position, _q, PAD_MISS_HOPS) !== 'pad') return false;
  leapAcross(e, w, 3);
  return true;
}

function leapAcross(e: Enemy, w: AiWorld, apex: number): void {
  const reach = Math.hypot(_q.x - e.position.x, _q.z - e.position.z);
  const rise = Math.max(0, _q.y - e.position.y);
  e.char.anim.play('leap');
  w.enemies.linksTaken++;
  leapTo(e, _q, clamp(0.4 + reach * 0.05 + rise * 0.05, 0.45, 1.8), apex);
}

/**
 * Jump and pad links are the only flow steps a walker cannot just walk. A crawler still takes them: it has arms to
 * haul itself up a ledge, and a pad throws whatever is on it.
 */
function crossLink(e: Enemy, w: AiWorld): boolean {
  if (e.mode !== 'flow' && w.now >= e.flowUntil) return false;
  const kind = w.ctx.world.nav.linkAhead(e.position, _q, 2);
  if (kind === 'pad') return takePad(e, w);
  if (kind !== 'jump') return false;
  leapAcross(e, w, 1);
  return true;
}

/** Floor height of a step, or NaN when a wall or a ledge too high to step up is in the way. */
function stepHeight(e: Enemy, w: AiWorld, x: number, z: number): number {
  const ground = w.ctx.world.nav.groundHeight(x, e.position.y + STEP_UP + 0.4, z);
  return ground - e.position.y > STEP_UP ? NaN : ground;
}

function moveOnGround(e: Enemy, w: AiWorld, stepX: number, stepZ: number, dt: number, wanted: number): void {
  if (wanted > 0.5 && crossLink(e, w)) return;
  let nx = e.position.x + stepX;
  let nz = e.position.z + stepZ;

  if (Math.hypot(nx - e.groundSampleAt.x, nz - e.groundSampleAt.y) >= GROUND_SAMPLE_STEP) {
    let ground = stepHeight(e, w, nx, nz);
    if (Number.isNaN(ground)) {
      // Corners get cut because flow looks a few cells ahead. Sliding along the wall keeps the crowd moving.
      ground = stepHeight(e, w, nx, e.position.z);
      if (!Number.isNaN(ground)) nz = e.position.z;
      else {
        ground = stepHeight(e, w, e.position.x, nz);
        if (!Number.isNaN(ground)) nx = e.position.x;
      }
    }
    if (Number.isNaN(ground)) {
      if (!tryJumpUp(e, w, e.desired)) blocked(e, w, dt, wanted);
      return;
    }
    if (e.position.y - ground > STEP_DOWN) {
      e.airborne = true;
      e.verticalSpeed = 0;
      e.position.x = nx;
      e.position.z = nz;
      return;
    }
    e.groundY = ground;
    e.groundSampleAt.set(nx, nz);
  }

  e.position.x = nx;
  e.position.z = nz;
  e.position.y = damp(e.position.y, e.groundY, 22, dt);
  trackProgress(e, w, dt, wanted);
}

function blocked(e: Enemy, w: AiWorld, dt: number, wanted: number): void {
  e.velocity.x = e.velocity.z = 0;
  trackProgress(e, w, dt, wanted);
}

/**
 * Point moves can be walled off because they skip the field, so they fall back to flow, which always has a route.
 * If flow itself stalls the enemy has been shoved into geometry; it goes back to the nearest node.
 */
function trackProgress(e: Enemy, w: AiWorld, dt: number, wanted: number): void {
  if (wanted < 0.5) {
    e.stuck = 0;
    return;
  }
  const gone = Math.hypot(e.position.x - e.lastProgress.x, e.position.z - e.lastProgress.z);
  if (gone > wanted * 0.25) {
    e.stuck = 0;
    e.lastProgress.copy(e.position);
    return;
  }
  e.stuck += dt;
  if (e.stuck < 0.8) return;
  e.stuck = 0;
  e.lastProgress.copy(e.position);
  if (e.mode === 'flow' || w.now < e.flowUntil) {
    if (w.ctx.world.nav.nearest(e.position, 3, _p)) {
      e.position.copy(_p);
      e.groundY = _p.y;
      e.groundSampleAt.set(_p.x, _p.z);
    }
  } else e.flowUntil = w.now + 1.6;
}

function updateFacing(e: Enemy, w: AiWorld, dt: number): void {
  let target = e.yaw;
  if (e.face === 'player') {
    target = Math.atan2(w.player.position.x - e.position.x, w.player.position.z - e.position.z);
  } else if (e.face === 'move') {
    const vx = e.velocity.x;
    const vz = e.velocity.z;
    if (vx * vx + vz * vz > 0.25) target = Math.atan2(vx, vz);
  } else return;
  e.yaw = dampAngle(e.yaw, target, e.def.turn, dt);
}

/** True when a short straight walk from the enemy in `dir` stays on floor of about the same height. */
export function canWalk(e: Enemy, w: AiWorld, dx: number, dz: number, dist: number): boolean {
  const nav = w.ctx.world.nav;
  const x = e.position.x + dx * dist;
  const z = e.position.z + dz * dist;
  const ground = nav.groundHeight(x, e.position.y + STEP_UP + 0.4, z);
  if (Number.isNaN(ground) || Math.abs(ground - e.position.y) > STEP_DOWN) return false;
  _d.set(x, ground + 0.2, z);
  return nav.nearest(_d, 0.8, _p);
}
