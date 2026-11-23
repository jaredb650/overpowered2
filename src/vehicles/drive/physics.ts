/**
 * Arcade-sim AAA vehicle physics for all 6 chassis classes:
 *   - wheeled    (Jackal drift technical, Nomad Quad ATV, Bastion 6x6 guntruck): responsive steering,
 *                controllable handbrake drift, nitro boost with anti-chatter hysteresis, true ramp
 *                launching off crests, slope alignment, and suspension pitch/roll springs.
 *   - moto       (Razor combat motorcycle): deep lean-to-turn banking, stunt wheelie pitch, ramp air.
 *   - tracked    (Aegis MBT): neutral-steer on-the-spot pivoting, heavy traction, turret recoil rock.
 *   - helicopter (Kestrel gunship, Valkyrie door-gunner): intuitive collective climb/descend + cyclic
 *                pitch/bank flight with smooth auto-hover stabilization.
 *   - hover      (Viper lance skiff): repulsor spring hover above sand, deep carve roll, dune-hop.
 *   - jet        (Harrier VTOL Jump-Jet, A-10 Warthog): dual-mode VTOL/STOL vertical hover <-> Mach
 *                forward jet flight with mouse pitch/yaw steering, natural banking roll, afterburner,
 *                and high-speed crash detection.
 *
 * Zero per-frame heap allocations.
 */
import * as THREE from 'three';
import { CG, type PhysicsSystem, type RayHit, type WorldSystem } from '../../core/contracts';
import { clamp, damp, dampAngle } from '../../core/math';
import type { DriveVehicleDef, VehicleInput, VehiclePhysicsState } from './types';

const GRAVITY = 26.5;
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
    boostLocked: false,
    drifting: false,
    grounded: true,
    groundY: position.y,
    altitude: 0,
    hopCooldown: 0,
    recoilOffset: 0,
    deployed: false,
    deployAnim: 0,
    speed: velocity ? Math.hypot(velocity.x, velocity.z) : 0,
    recentClimbVy: 0,
    climbCarryTimer: 0,
    crashImpact: 0,
    crashNormal: new THREE.Vector3(0, 1, 0),
    vtolMode: true,
    airThrottle: 0,
  };
}

/**
 * Samples the highest walkable/driveable surface below `(x, y, z)`.
 * Checks BOTH static `CG.World` raycasts (ramps, bridges, slabs) AND `world.nav.groundHeight`
 * (desert heightfield) so flat ground stays identical while steel ramps & dunes launch cleanly!
 */
function sampleGround(
  world: WorldSystem | undefined,
  physics: PhysicsSystem | undefined,
  x: number,
  y: number,
  z: number,
  fallback: number,
  ownHandle?: number,
): number {
  const navY = world?.nav?.groundHeight?.(x, y + 3.0, z);
  const hasNav = typeof navY === 'number' && Number.isFinite(navY);

  let rayY = -Infinity;
  if (physics?.raycastInto) {
    // Cast from modestly above the chassis so roofs/overpasses far overhead don't teleport us upward,
    // while angled steel ramps rising in front of our bumper are picked up smoothly.
    _origin.set(x, y + 2.4, z);
    _dir.set(0, -1, 0);
    if (physics.raycastInto(_origin, _dir, 44, CG.World, _hit)) {
      if ((ownHandle === undefined || _hit.collider?.handle !== ownHandle) && _hit.normal.y > 0.45) {
        // Only accept hits that aren't a vertical wall lip way above our wheels.
        if (_hit.point.y <= y + 1.85) {
          rayY = _hit.point.y;
        }
      }
    }
  }

  if (rayY > -Infinity && hasNav) return Math.max(rayY, navY);
  if (rayY > -Infinity) return rayY;
  if (hasNav) return navY;
  return fallback;
}

/** Slides horizontal velocity off nearby static walls and records `crashImpact` for high-speed crash damage! */
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
    _origin.set(state.position.x, state.position.y + Math.max(1.05, def.halfHeight * 0.82), state.position.z);
    _dir.set(dx, 0, dz);
    if (physics.raycastInto(_origin, _dir, reach, CG.World, _hit)) {
      if (ownHandle === undefined || _hit.collider?.handle !== ownHandle) {
        // Ignore driveable ramps (normal.y >= 0.55) so fast vehicles climb ramps instead of crashing into them!
        if (Math.abs(_hit.normal.y) < 0.55) {
          const vn = vx * _hit.normal.x + vz * _hit.normal.z;
          if (vn < 0) {
            const impact = -vn;
            if (impact > state.crashImpact) {
              state.crashImpact = impact;
              state.crashNormal.copy(_hit.normal);
            }
            state.velocity.x -= _hit.normal.x * vn * 1.18;
            state.velocity.z -= _hit.normal.z * vn * 1.18;
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

  // Clamp cleanly inside world bounds with gentle slide cushion (generous margin aloft for jets).
  const bounds = world?.bounds;
  if (bounds) {
    const pad = def.category === 'jet' && !state.grounded
      ? Math.max(def.halfWidth, def.halfLength) + 4.0
      : Math.max(def.halfWidth, def.halfLength) + 1.5;
    const minX = bounds.min.x + pad;
    const maxX = bounds.max.x - pad;
    const minZ = bounds.min.z + pad;
    const maxZ = bounds.max.z - pad;
    if (state.position.x < minX) {
      state.position.x = minX;
      if (state.velocity.x < 0) {
        if (def.category !== 'jet' && -state.velocity.x > state.crashImpact) {
          state.crashImpact = -state.velocity.x;
          state.crashNormal.set(1, 0, 0);
        }
        state.velocity.x *= -0.22;
      }
    } else if (state.position.x > maxX) {
      state.position.x = maxX;
      if (state.velocity.x > 0) {
        if (def.category !== 'jet' && state.velocity.x > state.crashImpact) {
          state.crashImpact = state.velocity.x;
          state.crashNormal.set(-1, 0, 0);
        }
        state.velocity.x *= -0.22;
      }
    }
    if (state.position.z < minZ) {
      state.position.z = minZ;
      if (state.velocity.z < 0) {
        if (def.category !== 'jet' && -state.velocity.z > state.crashImpact) {
          state.crashImpact = -state.velocity.z;
          state.crashNormal.set(0, 0, 1);
        }
        state.velocity.z *= -0.22;
      }
    } else if (state.position.z > maxZ) {
      state.position.z = maxZ;
      if (state.velocity.z > 0) {
        if (def.category !== 'jet' && state.velocity.z > state.crashImpact) {
          state.crashImpact = state.velocity.z;
          state.crashNormal.set(0, 0, -1);
        }
        state.velocity.z *= -0.22;
      }
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

  // Clear per-tick crash readout & decay animations.
  state.crashImpact = 0;
  state.recoilOffset = damp(state.recoilOffset, 0, 12, h);
  state.deployAnim = damp(state.deployAnim, state.deployed ? 1 : 0, 8, h);
  if (state.hopCooldown > 0) state.hopCooldown = Math.max(0, state.hopCooldown - h);
  if (state.climbCarryTimer > 0) state.climbCarryTimer = Math.max(0, state.climbCarryTimer - h);

  // Boost fuel management with clean hysteresis (locks at 0.01, unlocks at 0.22 -> ZERO Shift stutter!).
  if (state.boostFuel <= 0.01) state.boostLocked = true;
  else if (state.boostLocked && state.boostFuel >= 0.22) state.boostLocked = false;

  const wantsMoveForBoost =
    def.category === 'helicopter'
      ? (Math.abs(input.throttle) > 0.05 || Math.abs(input.steer) > 0.05)
      : def.category === 'jet'
        ? (!state.vtolMode || input.throttle > 0.05 || input.climb > 0.05)
        : input.throttle > 0.05;

  const canBoost = occupied && !state.deployed && input.boost && !state.boostLocked && state.boostFuel > 0.01 && wantsMoveForBoost;
  state.boosting = canBoost;
  if (canBoost) {
    state.boostFuel = Math.max(0, state.boostFuel - def.boostDrain * h);
    if (state.boostFuel <= 0.01) {
      state.boostLocked = true;
      state.boosting = false;
    }
  } else {
    state.boostFuel = Math.min(1, state.boostFuel + def.boostRegen * h);
  }

  // Forward (+Z rotated by yaw) and Right (+X rotated by yaw) basis vectors.
  const fx = Math.sin(state.yaw);
  const fz = Math.cos(state.yaw);
  const rx = Math.cos(state.yaw);
  const rz = -Math.sin(state.yaw);

  if (def.category === 'helicopter') {
    stepHelicopter(def, state, input, h, fx, fz, rx, rz, world, physics, occupied, ownHandle);
  } else if (def.category === 'jet') {
    stepJet(def, state, input, h, fx, fz, rx, rz, world, physics, occupied, ownHandle);
  } else if (def.category === 'hover') {
    stepHoverBike(def, state, input, h, fx, fz, rx, rz, world, physics, occupied, ownHandle);
  } else {
    stepGroundChassis(def, state, input, h, fx, fz, rx, rz, world, physics, occupied, ownHandle);
  }

  state.speed = def.category === 'jet'
    ? Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z)
    : Math.hypot(state.velocity.x, state.velocity.z);
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
  const isMoto = def.category === 'moto';
  const isTracked = def.category === 'tracked';
  const locked = state.deployed;
  const throttle = occupied && !locked ? clamp(input.throttle, -1, 1) : 0;
  const steer = occupied && !locked ? clamp(input.steer, -1, 1) : 0;
  const handbrake = occupied && !locked && input.handbrake;

  // Decompose current horizontal velocity into forward & lateral components.
  let vFwd = state.velocity.x * fx + state.velocity.z * fz;
  let vSide = state.velocity.x * rx + state.velocity.z * rz;

  const topFwd = state.boosting ? def.boostSpeed : def.maxSpeed;
  const topRev = def.maxReverse;

  // Longitudinal drive / braking / coast drag (airborne preserves momentum cleanly!).
  let accelCmd = 0;
  if (locked) {
    vFwd = damp(vFwd, 0, 12, dt);
    vSide = damp(vSide, 0, 14, dt);
  } else if (!state.grounded) {
    // Mid-air: light air drag, keep forward launch momentum intact!
    vFwd = damp(vFwd, 0, 0.22, dt);
  } else if (handbrake && !isTracked) {
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
  const targetSteer = -steer * (isMoto ? 0.44 : 0.56);
  state.steerAngle = damp(state.steerAngle, targetSteer, 11, dt);

  let targetYawRate = 0;
  if (!locked) {
    if (isTracked) {
      const speedEase = 1 - clamp(Math.abs(vFwd) / (def.maxSpeed * 1.4), 0, 0.35);
      targetYawRate = -steer * def.turnRate * speedEase;
    } else {
      const airControl = state.grounded ? 1 : 0.25;
      const speedFactor = clamp(Math.abs(vFwd) / 5.5, 0, 1);
      const dirSign = vFwd >= -0.35 ? 1 : -1;
      const driftBoost = state.grounded && handbrake && Math.abs(vFwd) > 7 ? 1.42 : 1;
      targetYawRate = -steer * def.turnRate * speedFactor * dirSign * driftBoost * airControl;
    }
  }
  state.yawRate = damp(state.yawRate, targetYawRate, handbrake ? 6.5 : 10.5, dt);
  state.yaw += state.yawRate * dt;

  const nfx = Math.sin(state.yaw);
  const nfz = Math.cos(state.yaw);
  const nrx = Math.cos(state.yaw);
  const nrz = -Math.sin(state.yaw);

  state.drifting = state.grounded && !isTracked && handbrake && Math.hypot(vFwd, vSide) > 8 && Math.abs(steer) > 0.15;
  const grip = locked ? 18 : !state.grounded ? 0.5 : state.drifting ? def.driftGrip : def.lateralGrip;

  const worldVx = vFwd * fx + vSide * rx;
  const worldVz = vFwd * fz + vSide * rz;
  const newFwd = worldVx * nfx + worldVz * nfz;
  const newSide = damp(worldVx * nrx + worldVz * nrz, 0, grip, dt);

  state.velocity.x = newFwd * nfx + newSide * nrx;
  state.velocity.z = newFwd * nfz + newSide * nrz;

  // Integrate horizontal position & slide off walls.
  const prevY = state.position.y;
  state.position.x += state.velocity.x * dt;
  state.position.z += state.velocity.z * dt;
  resolveHorizontalWalls(def, state, physics, world, dt, ownHandle);

  // Terrain height + TRUE RAMP JUMPING + suspension settling!
  const groundY = sampleGround(world, physics, state.position.x, state.position.y, state.position.z, state.groundY, ownHandle);
  state.groundY = groundY;
  const horizSpeed = Math.hypot(state.velocity.x, state.velocity.z);

  if (state.grounded) {
    const dy = groundY - prevY;
    // Detect crest departure: ground drops away beneath us while carrying upward ramp momentum!
    const crestDrop = groundY < prevY - 0.14;
    if (crestDrop && state.climbCarryTimer > 0 && state.recentClimbVy > 2.2 && horizSpeed > 9.5) {
      // Launch cleanly off the ramp lip!
      state.velocity.y = clamp(state.recentClimbVy * 1.08 + horizSpeed * 0.08, 4.5, 22);
      state.grounded = false;
      state.climbCarryTimer = 0;
      state.recentClimbVy = 0;
      state.position.y += state.velocity.y * dt;
    } else if (groundY < prevY - 0.35 && horizSpeed > 12) {
      // Driven off a steep ledge/cliff even without an upward ramp approach!
      state.velocity.y = Math.max(0, state.recentClimbVy);
      state.grounded = false;
      state.position.y += state.velocity.y * dt;
    } else {
      // Normal grounded driving — smoothly follow terrain/ramp slope while recording upward climb rate.
      const nextY = damp(prevY, groundY, 24, dt);
      const instantClimbVy = (nextY - prevY) / dt;
      if (dy > 0.008 && instantClimbVy > 1.2) {
        state.recentClimbVy = clamp(damp(state.recentClimbVy, instantClimbVy, 14, dt), 0, 18);
        state.climbCarryTimer = 0.18;
      } else if (state.climbCarryTimer <= 0) {
        state.recentClimbVy = damp(state.recentClimbVy, 0, 12, dt);
      }
      state.position.y = nextY;
      state.velocity.y = 0;
      state.grounded = true;
    }
  } else {
    // Airborne ballistic arc!
    state.velocity.y -= GRAVITY * dt;
    state.position.y += state.velocity.y * dt;
    if (state.position.y <= groundY) {
      const slamSpeed = -state.velocity.y;
      if (slamSpeed > 18) {
        state.crashImpact = Math.max(state.crashImpact, slamSpeed - 6);
        state.crashNormal.set(0, 1, 0);
      }
      state.position.y = groundY;
      state.velocity.y = 0;
      state.grounded = true;
      state.recentClimbVy = 0;
      state.climbCarryTimer = 0;
    }
  }
  state.altitude = Math.max(0, state.position.y - groundY);

  // Sample front/rear ground slopes + expressive acceleration squat, motorcycle lean, & airborne pitch!
  let targetPitch: number;
  let targetRoll: number;
  if (state.grounded) {
    const gFwd = sampleGround(world, physics, state.position.x + nfx * def.halfLength * 0.8, state.position.y, state.position.z + nfz * def.halfLength * 0.8, groundY, ownHandle);
    const gRear = sampleGround(world, physics, state.position.x - nfx * def.halfLength * 0.8, state.position.y, state.position.z - nfz * def.halfLength * 0.8, groundY, ownHandle);
    const slopePitch = Math.atan2(gRear - gFwd, Math.max(1, def.halfLength * 1.6));
    const wheeliePitch = isMoto && state.boosting && newFwd > 8 ? -0.24 : 0;
    const squatPitch = clamp(-accelCmd * (isMoto ? 0.004 : 0.0024), -0.12, 0.09) - state.recoilOffset * 0.06 + wheeliePitch;
    targetPitch = clamp(slopePitch + squatPitch, -0.52, 0.45);
    if (isMoto) {
      // Deep exhilarating motorcycle lean-to-turn banking!
      const leanScale = clamp(Math.abs(newFwd) / (def.maxSpeed * 0.65), 0, 1);
      targetRoll = clamp(-steer * 0.62 * leanScale, -0.62, 0.62);
    } else {
      targetRoll = clamp(-state.yawRate * (newFwd / Math.max(10, def.maxSpeed)) * 0.14, -0.18, 0.18);
    }
  } else {
    // Nose tracks ballistic arc cleanly while flying off ramps!
    targetPitch = clamp(-Math.atan2(state.velocity.y, Math.max(10, horizSpeed)) * 0.72, -0.48, 0.48);
    targetRoll = isMoto ? clamp(-steer * 0.35, -0.4, 0.4) : damp(state.roll, 0, 2.5, dt);
  }

  state.pitch = damp(state.pitch, targetPitch, state.grounded ? 10 : 5, dt);
  state.roll = damp(state.roll, targetRoll, isMoto ? 11 : 9, dt);
  state.wheelSpin += (newFwd / (isMoto ? 0.42 : 0.58)) * dt;
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

  const groundY = sampleGround(world, physics, state.position.x, state.position.y, state.position.z, state.groundY, ownHandle);
  state.groundY = groundY;
  const targetHoverY = groundY + (occupied ? def.hoverHeight : 0.48);

  if (occupied && input.handbrake && state.hopCooldown <= 0 && state.position.y <= targetHoverY + 1.1) {
    state.velocity.y = def.hopImpulse;
    state.hopCooldown = 1.25;
  }

  const heightError = targetHoverY - state.position.y;
  if (heightError > -0.35) {
    const springAccel = heightError * 52 - state.velocity.y * 9.5;
    state.velocity.y += springAccel * dt;
    state.grounded = true;
  } else {
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
  const rotorSpeed = occupied ? 24 : state.altitude > 0.6 ? 18 : 2.2;
  state.rotorAngle += rotorSpeed * dt;

  const groundY = sampleGround(world, physics, state.position.x, state.position.y, state.position.z, state.groundY, ownHandle);
  state.groundY = groundY;
  state.altitude = Math.max(0, state.position.y - groundY);

  const throttle = occupied ? clamp(input.throttle, -1, 1) : 0;
  const strafe = occupied ? clamp(input.steer, -1, 1) : 0;
  // Note: when unmanned (e.g. sitting in Valkyrie Door Gunner or Kestrel FLIR seat!), hold altitude smoothly!
  const climb = occupied ? clamp(input.climb, -1, 1) : 0;

  const targetVy = climb * def.climbRate;
  state.velocity.y = damp(state.velocity.y, targetVy, occupied ? 5.5 : 4.2, dt);

  const topSpeed = state.boosting ? def.boostSpeed : def.maxSpeed;
  const desiredVx = (fx * throttle + rx * -strafe) * topSpeed;
  const desiredVz = (fz * throttle + rz * -strafe) * topSpeed;
  const response = occupied ? (Math.abs(throttle) > 0.05 || Math.abs(strafe) > 0.05 ? 2.6 : 1.9) : 2.5;
  state.velocity.x = damp(state.velocity.x, desiredVx, response, dt);
  state.velocity.z = damp(state.velocity.z, desiredVz, response, dt);

  state.position.x += state.velocity.x * dt;
  state.position.z += state.velocity.z * dt;
  state.position.y += state.velocity.y * dt;

  if (state.position.y < groundY) {
    const slam = -state.velocity.y;
    if (slam > 14) {
      state.crashImpact = Math.max(state.crashImpact, slam);
      state.crashNormal.set(0, 1, 0);
    }
    state.position.y = groundY;
    if (state.velocity.y < 0) state.velocity.y = 0;
    state.grounded = true;
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

  const vFwd = state.velocity.x * fx + state.velocity.z * fz;
  const vRight = state.velocity.x * rx + state.velocity.z * rz;
  const airBlend = clamp(state.altitude / 2.2, 0, 1);
  const targetPitch = clamp((vFwd / def.maxSpeed) * 0.28, -0.32, 0.34) * airBlend;
  const targetRoll = clamp((-vRight / def.maxSpeed) * 0.36, -0.44, 0.44) * airBlend;
  state.pitch = damp(state.pitch, targetPitch, 5.5, dt);
  state.roll = damp(state.roll, targetRoll, 5.5, dt);
}

/**
 * Dual-mode VTOL/STOL Jump-Jet & Ground-Attack Jet physics (Harrier & A-10 Warthog).
 *   - VTOL mode (`state.vtolMode === true`): effortless vertical takeoff/hover/landing like a thrust-vectored
 *     Harrier, plus pressing `W` + `Shift` aloft automatically kicks you forward if you want, or press `[Q]` to
 *     swap cleanly between VTOL Hover and full Mach Fighter Jet flight!
 *   - JET mode (`state.vtolMode === false`): exhilarating forward jet flight! Nose follows pilot mouse pitch/yaw,
 *     `A/D` rolls & carves sweeping dogfight banks, `W/S` modulates throttle (with safe minimum stall floor),
 *     and `Shift` ignites afterburner!
 */
function stepJet(
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
  const groundY = sampleGround(world, physics, state.position.x, state.position.y, state.position.z, state.groundY, ownHandle);
  state.groundY = groundY;
  state.altitude = Math.max(0, state.position.y - groundY);

  if (!occupied) {
    // Unmanned jet descends gently in VTOL mode and parks cleanly on its landing gear.
    state.vtolMode = true;
    state.airThrottle = damp(state.airThrottle, 0, 3, dt);
    state.velocity.x = damp(state.velocity.x, 0, 2.8, dt);
    state.velocity.z = damp(state.velocity.z, 0, 2.8, dt);
    state.velocity.y = state.altitude > 0.15 ? damp(state.velocity.y, -7.5, 3, dt) : 0;
    state.position.addScaledVector(state.velocity, dt);
    if (state.position.y <= groundY) {
      state.position.y = groundY;
      state.velocity.y = 0;
      state.grounded = true;
    } else {
      state.grounded = false;
    }
    state.pitch = damp(state.pitch, 0, 6, dt);
    state.roll = damp(state.roll, 0, 6, dt);
    state.altitude = Math.max(0, state.position.y - groundY);
    return;
  }

  const throttle = clamp(input.throttle, -1, 1);
  const steer = clamp(input.steer, -1, 1);
  const climb = clamp(input.climb, -1, 1);

  if (state.vtolMode) {
    // VTOL / STOL hover mode: vertical lift on Space, descend on Ctrl, agile hover cruise on WASD!
    const vtolMax = def.maxSpeed * 0.42;
    const targetVy = climb * def.climbRate;
    state.velocity.y = damp(state.velocity.y, targetVy, 5.2, dt);

    const desiredVx = (fx * throttle + rx * -steer) * vtolMax;
    const desiredVz = (fz * throttle + rz * -steer) * vtolMax;
    state.velocity.x = damp(state.velocity.x, desiredVx, 2.8, dt);
    state.velocity.z = damp(state.velocity.z, desiredVz, 2.8, dt);
    state.airThrottle = damp(state.airThrottle, Math.max(0.2, Math.abs(throttle) * 0.55), 4, dt);

    state.position.addScaledVector(state.velocity, dt);
    const vFwd = state.velocity.x * fx + state.velocity.z * fz;
    const vRight = state.velocity.x * rx + state.velocity.z * rz;
    const airBlend = clamp(state.altitude / 2.2, 0, 1);
    state.pitch = damp(state.pitch, clamp((vFwd / vtolMax) * 0.18, -0.22, 0.22) * airBlend, 6, dt);
    state.roll = damp(state.roll, clamp((-vRight / vtolMax) * 0.34, -0.4, 0.4) * airBlend, 6, dt);
  } else {
    // FORWARD JET FLIGHT MODE!
    // Throttle adjusts between safe cruise (0.42) and full military power (1.0), plus Afterburner on Shift!
    const targetThrottle = state.boosting
      ? 1.0
      : clamp(state.airThrottle + throttle * 0.85 * dt, 0.42, 1.0);
    state.airThrottle = damp(state.airThrottle, targetThrottle, 5, dt);

    // Steering bank + aerodynamic turn rate!
    const targetRoll = clamp(-steer * 0.92 - state.yawRate * 0.36, -1.12, 1.12);
    state.roll = damp(state.roll, targetRoll, 5.8, dt);
    const bankYaw = -steer * def.turnRate * 0.85;
    state.yawRate = damp(state.yawRate, bankYaw, 6, dt);
    state.yaw += state.yawRate * dt;

    // Nose vector from (yaw, pitch) where pitch < 0 = nose UP in Three.js (+Z forward, rotation.x < 0 lifts +Z!).
    const nosePitch = -state.pitch; // +angle = climbing up
    const cp = Math.cos(nosePitch);
    const dirX = Math.sin(state.yaw) * cp;
    const dirY = Math.sin(nosePitch);
    const dirZ = Math.cos(state.yaw) * cp;

    const targetSpeed = state.boosting
      ? def.boostSpeed
      : def.maxSpeed * state.airThrottle;
    const desiredVx = dirX * targetSpeed;
    const desiredVy = dirY * targetSpeed + climb * 10;
    const desiredVz = dirZ * targetSpeed;

    state.velocity.x = damp(state.velocity.x, desiredVx, 3.8, dt);
    state.velocity.y = damp(state.velocity.y, desiredVy, 3.8, dt);
    state.velocity.z = damp(state.velocity.z, desiredVz, 3.8, dt);

    state.position.addScaledVector(state.velocity, dt);
  }

  // Floor & sky ceiling checks (with high-speed kamikaze crash detection!).
  if (state.position.y < groundY) {
    const downSpeed = -state.velocity.y;
    const fwdSpeed = Math.hypot(state.velocity.x, state.velocity.z);
    if (!state.vtolMode && (downSpeed > 14 || (state.pitch > 0.25 && fwdSpeed > 28))) {
      state.crashImpact = Math.max(state.crashImpact, Math.hypot(fwdSpeed * 0.75, downSpeed));
      state.crashNormal.set(0, 1, 0);
    }
    state.position.y = groundY;
    if (state.velocity.y < 0) state.velocity.y = 0;
    state.grounded = true;
    if (state.vtolMode) {
      state.velocity.x = damp(state.velocity.x, 0, 4.5, dt);
      state.velocity.z = damp(state.velocity.z, 0, 4.5, dt);
    } else if (state.pitch > 0) {
      state.pitch = dampAngle(state.pitch, 0, 12, dt);
    }
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
}
