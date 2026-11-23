/**
 * Arcade-sim AAA vehicle physics for all 4 chassis classes:
 *   - wheeled    (Jackal drift technical, Bastion 6x6 guntruck): responsive steering, controllable
 *                handbrake drift, nitro boost, slope alignment, and suspension pitch/roll springs.
 *   - tracked    (Aegis MBT): neutral-steer on-the-spot pivoting, heavy traction, turret recoil rock.
 *   - helicopter (Kestrel gunship): intuitive collective climb/descend + cyclic pitch/bank flight
 *                with smooth auto-hover stabilization.
 *   - hover      (Viper jet-skiff): repulsor spring hover above sand, deep motorcycle carve roll,
 *                vertical dune-hop impulse, and blistering 56 m/s mach boost.
 *
 * Zero per-frame heap allocations.
 */
import * as THREE from 'three';
import { CG, type PhysicsSystem, type RayHit, type WorldSystem } from '../../core/contracts';
import { clamp, damp } from '../../core/math';
import type { DriveVehicleDef, VehicleInput, VehiclePhysicsState } from './types';

const GRAVITY = 28;
const WALL_PAD = 0.65;

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

export function createPhysicsState(position: THREE.Vector3, yaw: number, velocity?: THREE.Vector3): VehiclePhysicsState {
  return {
    position: position.clone(),
    velocity: velocity ? velocity.clone() : new THREE.Vector3(),
    yaw,
    pitch: 0,
    roll: 0,
    pitchRate: 0,
    rollRate: 0,
    yawRate: 0,
    steerAngle: 0,
    wheelSpin: 0,
    rotorAngle: 0,
    boostFuel: 1,
    boosting: false,
    drifting: false,
    grounded: true,
    groundY: position.y,
    altitude: 0,
    hopCooldown: 0,
    recoilOffset: 0,
    deployed: false,
    deployAnim: 0,
    speed: velocity ? Math.hypot(velocity.x, velocity.z) : 0,
  };
}

function sampleGround(world: WorldSystem | undefined, physics: PhysicsSystem | undefined, x: number, y: number, z: number, fallback: number): number {
  const navY = world?.nav?.groundHeight?.(x, y + 3.5, z);
  if (typeof navY === 'number' && Number.isFinite(navY)) return navY;
  if (physics?.raycastInto) {
    _origin.set(x, y + 3.5, z);
    _dir.set(0, -1, 0);
    if (physics.raycastInto(_origin, _dir, 40, CG.World, _hit)) return _hit.point.y;
  }
  return fallback;
}

/** Slides horizontal velocity off nearby static walls so vehicles never clip through pillars or outer rims. */
function resolveHorizontalWalls(
  def: DriveVehicleDef,
  state: VehiclePhysicsState,
  physics: PhysicsSystem | undefined,
  world: WorldSystem | undefined,
  dt: number,
  ownHandle?: number,
): void {
  const vx = state.velocity.x;
  const vz = state.velocity.z;
  const horizSpeed = Math.hypot(vx, vz);
  if (horizSpeed > 0.25 && physics?.raycastInto) {
    const inv = 1 / horizSpeed;
    const dx = vx * inv;
    const dz = vz * inv;
    const radius = Math.max(def.halfWidth, def.halfLength * 0.72) + WALL_PAD;
    const reach = radius + horizSpeed * dt;
    _origin.set(state.position.x, state.position.y + Math.max(0.95, def.halfHeight * 0.75), state.position.z);
    _dir.set(dx, 0, dz);
    if (physics.raycastInto(_origin, _dir, reach, CG.World, _hit)) {
      if (ownHandle === undefined || _hit.collider?.handle !== ownHandle) {
        // Ignore gentle ground slopes (normal pointing mostly upward).
        if (Math.abs(_hit.normal.y) < 0.65) {
          const vn = vx * _hit.normal.x + vz * _hit.normal.z;
          if (vn < 0) {
            state.velocity.x -= _hit.normal.x * vn * 1.15;
            state.velocity.z -= _hit.normal.z * vn * 1.15;
            const pen = radius - _hit.distance;
            if (pen > 0) {
              state.position.x += _hit.normal.x * pen;
              state.position.z += _hit.normal.z * pen;
            }
          }
        }
      }
    }
  }

  // Clamp cleanly inside world bounds with gentle slide cushion.
  const bounds = world?.bounds;
  if (bounds) {
    const pad = Math.max(def.halfWidth, def.halfLength) + 1.5;
    const minX = bounds.min.x + pad;
    const maxX = bounds.max.x - pad;
    const minZ = bounds.min.z + pad;
    const maxZ = bounds.max.z - pad;
    if (state.position.x < minX) {
      state.position.x = minX;
      if (state.velocity.x < 0) state.velocity.x *= -0.2;
    } else if (state.position.x > maxX) {
      state.position.x = maxX;
      if (state.velocity.x > 0) state.velocity.x *= -0.2;
    }
    if (state.position.z < minZ) {
      state.position.z = minZ;
      if (state.velocity.z < 0) state.velocity.z *= -0.2;
    } else if (state.position.z > maxZ) {
      state.position.z = maxZ;
      if (state.velocity.z > 0) state.velocity.z *= -0.2;
    }
  }
}

export function stepVehiclePhysics(
  def: DriveVehicleDef,
  state: VehiclePhysicsState,
  input: VehicleInput,
  dt: number,
  world: WorldSystem | undefined,
  physics: PhysicsSystem | undefined,
  occupied: boolean,
  ownHandle?: number,
): void {
  if (dt <= 0) return;
  const h = Math.min(dt, 0.05);

  // Recoil & deploy animations decay smoothly every frame.
  state.recoilOffset = damp(state.recoilOffset, 0, 12, h);
  state.deployAnim = damp(state.deployAnim, state.deployed ? 1 : 0, 8, h);
  if (state.hopCooldown > 0) state.hopCooldown = Math.max(0, state.hopCooldown - h);

  // Boost fuel management.
  const canBoost = occupied && !state.deployed && input.boost && state.boostFuel > 0.04 && (
    def.category === 'helicopter' ? (Math.abs(input.throttle) > 0.05 || Math.abs(input.steer) > 0.05) : input.throttle > 0.05
  );
  state.boosting = canBoost;
  if (canBoost) {
    state.boostFuel = Math.max(0, state.boostFuel - def.boostDrain * h);
  } else {
    state.boostFuel = Math.min(1, state.boostFuel + def.boostRegen * h);
  }

  // Forward (+Z rotated by yaw) and Right (-X/+X consistent with Three.js rotation.y) basis vectors.
  // In Three.js: rotation.y = yaw maps local +Z -> (sin(yaw), 0, cos(yaw)) and local +X -> (cos(yaw), 0, -sin(yaw)).
  const fx = Math.sin(state.yaw);
  const fz = Math.cos(state.yaw);
  const rx = Math.cos(state.yaw);
  const rz = -Math.sin(state.yaw);

  if (def.category === 'helicopter') {
    stepHelicopter(def, state, input, h, fx, fz, rx, rz, world, physics, occupied, ownHandle);
  } else if (def.category === 'hover') {
    stepHoverBike(def, state, input, h, fx, fz, rx, rz, world, physics, occupied, ownHandle);
  } else {
    stepGroundChassis(def, state, input, h, fx, fz, rx, rz, world, physics, occupied, ownHandle);
  }

  state.speed = Math.hypot(state.velocity.x, state.velocity.z);
}

function stepGroundChassis(
  def: DriveVehicleDef,
  state: VehiclePhysicsState,
  input: VehicleInput,
  dt: number,
  fx: number,
  fz: number,
  rx: number,
  rz: number,
  world: WorldSystem | undefined,
  physics: PhysicsSystem | undefined,
  occupied: boolean,
  ownHandle?: number,
): void {
  const locked = state.deployed;
  const throttle = occupied && !locked ? clamp(input.throttle, -1, 1) : 0;
  const steer = occupied && !locked ? clamp(input.steer, -1, 1) : 0;
  const handbrake = occupied && !locked && input.handbrake;

  // Decompose current horizontal velocity into forward & lateral components.
  let vFwd = state.velocity.x * fx + state.velocity.z * fz;
  let vSide = state.velocity.x * rx + state.velocity.z * rz;

  const topFwd = state.boosting ? def.boostSpeed : def.maxSpeed;
  const topRev = def.maxReverse;

  // Longitudinal drive / braking / coast drag.
  let accelCmd = 0;
  if (locked) {
    vFwd = damp(vFwd, 0, 12, dt);
    vSide = damp(vSide, 0, 14, dt);
  } else if (handbrake && def.category === 'wheeled') {
    // Handbrake slows gently while letting the rear kick out into a powerslide!
    vFwd = damp(vFwd, 0, 1.8, dt);
  } else if (throttle > 0.02) {
    if (vFwd < -0.5) {
      accelCmd = def.brake;
    } else {
      const boostMult = state.boosting ? 1.65 : 1;
      accelCmd = def.accel * boostMult * throttle;
    }
    vFwd = Math.min(topFwd, vFwd + accelCmd * dt);
  } else if (throttle < -0.02) {
    if (vFwd > 0.5) {
      accelCmd = -def.brake;
    } else {
      accelCmd = def.accel * 0.72 * throttle;
    }
    vFwd = Math.max(-topRev, vFwd + accelCmd * dt);
  } else {
    vFwd = damp(vFwd, 0, occupied ? 1.9 : 4.5, dt);
  }

  // Steering & drift dynamics.
  const targetSteer = -steer * 0.56;
  state.steerAngle = damp(state.steerAngle, targetSteer, 11, dt);

  let targetYawRate = 0;
  if (!locked) {
    if (def.category === 'tracked') {
      // Neutral-steer: tank pivots cleanly on the spot even at zero forward speed!
      const speedEase = 1 - clamp(Math.abs(vFwd) / (def.maxSpeed * 1.4), 0, 0.35);
      targetYawRate = -steer * def.turnRate * speedEase;
    } else {
      // Wheeled vehicle: steer scales up quickly from low speed and reverses naturally in reverse.
      const speedFactor = clamp(Math.abs(vFwd) / 5.5, 0, 1);
      const dirSign = vFwd >= -0.35 ? 1 : -1;
      const driftBoost = handbrake && Math.abs(vFwd) > 7 ? 1.42 : 1;
      targetYawRate = -steer * def.turnRate * speedFactor * dirSign * driftBoost;
    }
  }
  state.yawRate = damp(state.yawRate, targetYawRate, handbrake ? 6.5 : 10.5, dt);
  state.yaw += state.yawRate * dt;

  // Re-evaluate basis after yaw turn so lateral grip carves velocity cleanly along the new heading.
  const nfx = Math.sin(state.yaw);
  const nfz = Math.cos(state.yaw);
  const nrx = Math.cos(state.yaw);
  const nrz = -Math.sin(state.yaw);

  state.drifting = def.category === 'wheeled' && handbrake && Math.abs(vFwd) > 8 && Math.abs(steer) > 0.15;
  const grip = locked ? 18 : state.drifting ? def.driftGrip : def.lateralGrip;
  // Convert momentum across the yaw rotation into lateral slip, then damp by tire grip.
  const worldVx = vFwd * fx + vSide * rx;
  const worldVz = vFwd * fz + vSide * rz;
  const newFwd = worldVx * nfx + worldVz * nfz;
  const newSide = damp(worldVx * nrx + worldVz * nrz, 0, grip, dt);

  state.velocity.x = newFwd * nfx + newSide * nrx;
  state.velocity.z = newFwd * nfz + newSide * nrz;

  // Integrate horizontal position & slide off walls.
  state.position.x += state.velocity.x * dt;
  state.position.z += state.velocity.z * dt;
  resolveHorizontalWalls(def, state, physics, world, dt, ownHandle);

  // Terrain height + gravity + suspension settling.
  const groundY = sampleGround(world, physics, state.position.x, state.position.y, state.position.z, state.groundY);
  state.groundY = groundY;
  if (state.position.y > groundY + 0.08 || state.velocity.y > 0.2) {
    state.velocity.y -= GRAVITY * dt;
    state.position.y += state.velocity.y * dt;
    if (state.position.y <= groundY) {
      state.position.y = groundY;
      state.velocity.y = 0;
      state.grounded = true;
    } else {
      state.grounded = false;
    }
  } else {
    state.position.y = damp(state.position.y, groundY, 22, dt);
    state.velocity.y = 0;
    state.grounded = true;
  }
  state.altitude = Math.max(0, state.position.y - groundY);

  // Sample front/rear/side ground slopes + expressive acceleration squat & corner body roll.
  const gFwd = sampleGround(world, physics, state.position.x + nfx * def.halfLength * 0.8, state.position.y, state.position.z + nfz * def.halfLength * 0.8, groundY);
  const gRear = sampleGround(world, physics, state.position.x - nfx * def.halfLength * 0.8, state.position.y, state.position.z - nfz * def.halfLength * 0.8, groundY);
  const slopePitch = Math.atan2(gRear - gFwd, Math.max(1, def.halfLength * 1.6));
  const squatPitch = clamp(-accelCmd * 0.0024, -0.09, 0.09) - state.recoilOffset * 0.06;
  const cornerRoll = clamp(-state.yawRate * (newFwd / Math.max(10, def.maxSpeed)) * 0.14, -0.18, 0.18);

  state.pitch = damp(state.pitch, clamp(slopePitch + squatPitch, -0.42, 0.42), 9, dt);
  state.roll = damp(state.roll, cornerRoll, 9, dt);
  state.wheelSpin += (newFwd / 0.58) * dt;
}

function stepHoverBike(
  def: DriveVehicleDef,
  state: VehiclePhysicsState,
  input: VehicleInput,
  dt: number,
  fx: number,
  fz: number,
  rx: number,
  rz: number,
  world: WorldSystem | undefined,
  physics: PhysicsSystem | undefined,
  occupied: boolean,
  ownHandle?: number,
): void {
  const throttle = occupied ? clamp(input.throttle, -1, 1) : 0;
  const steer = occupied ? clamp(input.steer, -1, 1) : 0;

  let vFwd = state.velocity.x * fx + state.velocity.z * fz;
  let vSide = state.velocity.x * rx + state.velocity.z * rz;

  const topFwd = state.boosting ? def.boostSpeed : def.maxSpeed;
  if (throttle > 0.02) {
    const mult = state.boosting ? 1.55 : 1;
    vFwd = Math.min(topFwd, vFwd + def.accel * mult * throttle * dt);
  } else if (throttle < -0.02) {
    vFwd = Math.max(-def.maxReverse, vFwd + def.accel * 0.8 * throttle * dt);
  } else {
    vFwd = damp(vFwd, 0, occupied ? 1.4 : 3.8, dt);
  }

  // Agile hover carve yaw (can pivot cleanly even at low speed!).
  const turnMult = 0.55 + 0.45 * clamp(Math.abs(vFwd) / 14, 0, 1);
  state.yawRate = damp(state.yawRate, -steer * def.turnRate * turnMult, 12, dt);
  state.yaw += state.yawRate * dt;

  const nfx = Math.sin(state.yaw);
  const nfz = Math.cos(state.yaw);
  const nrx = Math.cos(state.yaw);
  const nrz = -Math.sin(state.yaw);

  const worldVx = vFwd * fx + vSide * rx;
  const worldVz = vFwd * fz + vSide * rz;
  const newFwd = worldVx * nfx + worldVz * nfz;
  const newSide = damp(worldVx * nrx + worldVz * nrz, 0, def.lateralGrip, dt);
  state.velocity.x = newFwd * nfx + newSide * nrx;
  state.velocity.z = newFwd * nfz + newSide * nrz;

  state.position.x += state.velocity.x * dt;
  state.position.z += state.velocity.z * dt;
  resolveHorizontalWalls(def, state, physics, world, dt, ownHandle);

  // Repulsor spring cushion + Spacebar dune-hop!
  const groundY = sampleGround(world, physics, state.position.x, state.position.y, state.position.z, state.groundY);
  state.groundY = groundY;
  const targetHoverY = groundY + (occupied ? def.hoverHeight : 0.48);

  if (occupied && input.handbrake && state.hopCooldown <= 0 && state.position.y <= targetHoverY + 1.1) {
    state.velocity.y = def.hopImpulse;
    state.hopCooldown = 1.25;
  }

  const heightError = targetHoverY - state.position.y;
  if (heightError > -0.35) {
    // Repulsor cushion spring-damper smoothly glides over terrain ripples.
    const springAccel = heightError * 52 - state.velocity.y * 9.5;
    state.velocity.y += springAccel * dt;
    state.grounded = true;
  } else {
    // Airborne off a dune hop!
    state.velocity.y -= GRAVITY * 0.78 * dt;
    state.grounded = false;
  }
  state.position.y += state.velocity.y * dt;
  if (state.position.y < groundY + 0.25) {
    state.position.y = groundY + 0.25;
    if (state.velocity.y < 0) state.velocity.y = 0;
    state.grounded = true;
  }
  state.altitude = Math.max(0, state.position.y - groundY);

  // Exhilarating motorcycle carve bank + boost nose-lift.
  const targetRoll = clamp(-steer * (0.22 + 0.36 * clamp(Math.abs(newFwd) / def.maxSpeed, 0, 1)), -0.58, 0.58);
  const targetPitch = clamp(-throttle * 0.08 + (state.boosting ? -0.1 : 0) - clamp(state.velocity.y * 0.025, -0.25, 0.25), -0.35, 0.32);
  state.roll = damp(state.roll, occupied ? targetRoll : 0, 10, dt);
  state.pitch = damp(state.pitch, occupied ? targetPitch : 0, 9, dt);
}

function stepHelicopter(
  def: DriveVehicleDef,
  state: VehiclePhysicsState,
  input: VehicleInput,
  dt: number,
  fx: number,
  fz: number,
  rx: number,
  rz: number,
  world: WorldSystem | undefined,
  physics: PhysicsSystem | undefined,
  occupied: boolean,
  ownHandle?: number,
): void {
  // Spool rotors fast when occupied, wind down when parked on the ground.
  const rotorSpeed = occupied ? 24 : state.altitude > 0.6 ? 16 : 2.2;
  state.rotorAngle += rotorSpeed * dt;

  const groundY = sampleGround(world, physics, state.position.x, state.position.y, state.position.z, state.groundY);
  state.groundY = groundY;
  state.altitude = Math.max(0, state.position.y - groundY);

  const throttle = occupied ? clamp(input.throttle, -1, 1) : 0;
  const strafe = occupied ? clamp(input.steer, -1, 1) : 0;
  const climb = occupied ? clamp(input.climb, -1, 1) : (state.altitude > 0.2 ? -0.45 : 0);

  // Collective altitude velocity (smooth auto-hover when climb === 0!).
  const targetVy = climb * def.climbRate;
  state.velocity.y = damp(state.velocity.y, targetVy, occupied ? 5.5 : 3.5, dt);

  // Cyclic horizontal flight acceleration (W/S forward/back, A/D bank-strafe).
  const topSpeed = state.boosting ? def.boostSpeed : def.maxSpeed;
  const desiredVx = (fx * throttle + rx * -strafe) * topSpeed;
  const desiredVz = (fz * throttle + rz * -strafe) * topSpeed;
  const response = occupied ? (Math.abs(throttle) > 0.05 || Math.abs(strafe) > 0.05 ? 2.6 : 1.9) : 2.2;
  state.velocity.x = damp(state.velocity.x, desiredVx, response, dt);
  state.velocity.z = damp(state.velocity.z, desiredVz, response, dt);

  state.position.x += state.velocity.x * dt;
  state.position.z += state.velocity.z * dt;
  state.position.y += state.velocity.y * dt;

  // Floor & ceiling clamps.
  if (state.position.y < groundY) {
    state.position.y = groundY;
    if (state.velocity.y < 0) state.velocity.y = 0;
    state.grounded = true;
    // Soft skid friction when touching the desert floor.
    state.velocity.x = damp(state.velocity.x, 0, 5, dt);
    state.velocity.z = damp(state.velocity.z, 0, 5, dt);
  } else {
    state.grounded = false;
  }
  const maxY = groundY + def.maxAltitude;
  if (state.position.y > maxY) {
    state.position.y = maxY;
    if (state.velocity.y > 0) state.velocity.y = 0;
  }
  state.altitude = Math.max(0, state.position.y - groundY);

  resolveHorizontalWalls(def, state, physics, world, dt, ownHandle);

  // Expressive helicopter nose-pitch & banking roll tied to cyclic velocity!
  const vFwd = state.velocity.x * fx + state.velocity.z * fz;
  const vRight = state.velocity.x * rx + state.velocity.z * rz;
  const airBlend = clamp(state.altitude / 2.2, 0, 1);
  const targetPitch = clamp((vFwd / def.maxSpeed) * 0.28, -0.32, 0.34) * airBlend;
  const targetRoll = clamp((-vRight / def.maxSpeed) * 0.36, -0.44, 0.44) * airBlend;
  state.pitch = damp(state.pitch, targetPitch, 5.5, dt);
  state.roll = damp(state.roll, targetRoll, 5.5, dt);
}
