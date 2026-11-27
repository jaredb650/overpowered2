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
import { CG, type PhysicsSystem, type RayHit, type VehicleRamClass, type WorldSystem } from '../../core/contracts';
import { clamp, damp, dampAngle } from '../../core/math';
import type { DriveVehicleDef, VehicleInput, VehiclePhysicsState } from './types';

const GRAVITY = 26.5;
const WALL_PAD = 0.65;

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
const _sideOrigin = new THREE.Vector3();
const _sideHit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

function ramClassOf(def: DriveVehicleDef): VehicleRamClass | null {
  if (def.category === 'helicopter' || def.category === 'jet') return null;
  if (def.category === 'tracked' || def.mass >= 9) return 'heavy';
  if (def.id === 'bastion' || def.mass >= 4.5) return 'medium';
  return 'light';
}

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
    ramBreachImpact: 0,
    ramBreachPoint: new THREE.Vector3(),
    ramBlocked: false,
    vtolMode: true,
    airThrottle: 0,
    abandonedFall: false,
    fallSpin: 0,
    cobraTimer: 0,
    wingSweep: 0,
    nozzleDeflect: 0,
    dumpBurnTimer: 0,
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
    if (physics.raycastInto(_origin, _dir, 400, CG.World, _hit)) {
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

/** Slides horizontal velocity off nearby static walls, or smashes straight through weaker destructible structures! */
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
    const rayY = state.position.y + Math.max(1.05, def.halfHeight * 0.82);
    _origin.set(state.position.x, rayY, state.position.z);
    _dir.set(dx, 0, dz);
    if (physics.raycastInto(_origin, _dir, reach, CG.World, _hit)) {
      if (ownHandle === undefined || _hit.collider?.handle !== ownHandle) {
        // Ignore driveable ramps (normal.y >= 0.55) so fast vehicles climb ramps instead of crashing into them!
        if (Math.abs(_hit.normal.y) < 0.55) {
          const vn = vx * _hit.normal.x + vz * _hit.normal.z;
          if (vn < 0) {
            const impact = -vn;
            const ramClass = ramClassOf(def);
            let breached = false;
            if (ramClass && _hit.collider && impact >= 2.2 && world?.objects?.tryVehicleRam) {
              const ramRes = world.objects.tryVehicleRam(_hit.collider, ramClass, impact, _hit.point, _dir);
              if (ramRes.breached) {
                breached = true;
                state.velocity.x *= ramRes.speedRetain;
                state.velocity.z *= ramRes.speedRetain;
                if (impact > state.ramBreachImpact) {
                  state.ramBreachImpact = impact;
                  state.ramBreachPoint.copy(_hit.point);
                }
                // Wide armored bumpers (tanks & 6x6 trucks) clear flanking drywall/timber/masonry panels cleanly.
                if (ramClass === 'heavy' || ramClass === 'medium') {
                  const perpX = -dz;
                  const perpZ = dx;
                  const sideOff = def.halfWidth * 0.72;
                  for (const s of [-1, 1]) {
                    _sideOrigin.set(state.position.x + perpX * sideOff * s, rayY, state.position.z + perpZ * sideOff * s);
                    if (physics.raycastInto(_sideOrigin, _dir, reach + 0.6, CG.World, _sideHit)) {
                      if (_sideHit.collider && (ownHandle === undefined || _sideHit.collider.handle !== ownHandle) && Math.abs(_sideHit.normal.y) < 0.55) {
                        world.objects.tryVehicleRam(_sideHit.collider, ramClass, impact, _sideHit.point, _dir);
                      }
                    }
                  }
                }
              } else if (ramRes.hit) {
                state.ramBlocked = true;
              }
            }

            if (!breached) {
              if (impact > state.crashImpact) {
                state.crashImpact = impact;
                state.crashNormal.copy(_hit.normal);
              }
              // Slide cleanly along walls with minimal bounce so holding W never ping-pongs!
              state.velocity.x -= _hit.normal.x * vn * 1.04;
              state.velocity.z -= _hit.normal.z * vn * 1.04;
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
        state.velocity.x *= -0.1;
      }
    } else if (state.position.x > maxX) {
      state.position.x = maxX;
      if (state.velocity.x > 0) {
        if (def.category !== 'jet' && state.velocity.x > state.crashImpact) {
          state.crashImpact = state.velocity.x;
          state.crashNormal.set(-1, 0, 0);
        }
        state.velocity.x *= -0.1;
      }
    }
    if (state.position.z < minZ) {
      state.position.z = minZ;
      if (state.velocity.z < 0) {
        if (def.category !== 'jet' && -state.velocity.z > state.crashImpact) {
          state.crashImpact = -state.velocity.z;
          state.crashNormal.set(0, 0, 1);
        }
        state.velocity.z *= -0.1;
      }
    } else if (state.position.z > maxZ) {
      state.position.z = maxZ;
      if (state.velocity.z > 0) {
        if (def.category !== 'jet' && state.velocity.z > state.crashImpact) {
          state.crashImpact = state.velocity.z;
          state.crashNormal.set(0, 0, -1);
        }
        state.velocity.z *= -0.1;
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
  driveActive: boolean,
  ownHandle?: number,
  hasOccupant = driveActive,
): void {
  if (dt <= 0) return;
  const h = Math.min(dt, 0.05);

  // Clear per-tick crash & structural ram readouts and decay animations.
  state.crashImpact = 0;
  state.ramBreachImpact = 0;
  state.ramBlocked = false;
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

  const canBoost = driveActive && !state.deployed && input.boost && !state.boostLocked && state.boostFuel > 0.01 && wantsMoveForBoost;
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

  // Forward (+Z rotated by yaw) and Left (+X rotated by yaw) basis vectors.
  const fx = Math.sin(state.yaw);
  const fz = Math.cos(state.yaw);
  const lx = Math.cos(state.yaw);
  const lz = -Math.sin(state.yaw);

  if (def.category === 'helicopter') {
    stepHelicopter(def, state, input, h, fx, fz, lx, lz, world, physics, driveActive, hasOccupant, ownHandle);
  } else if (def.category === 'jet') {
    stepJet(def, state, input, h, fx, fz, lx, lz, world, physics, driveActive, hasOccupant, ownHandle);
  } else if (def.category === 'hover') {
    stepHoverBike(def, state, input, h, fx, fz, lx, lz, world, physics, driveActive, ownHandle);
  } else {
    stepGroundChassis(def, state, input, h, fx, fz, lx, lz, world, physics, driveActive, ownHandle);
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
  lx: number,
  lz: number,
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

  // Decompose current horizontal velocity into forward & lateral (+X = left) components.
  let vFwd = state.velocity.x * fx + state.velocity.z * fz;
  let vSide = state.velocity.x * lx + state.velocity.z * lz;

  const topFwd = state.boosting ? def.boostSpeed : def.maxSpeed;
  const topRev = def.maxReverse;

  // Longitudinal drive / braking / coast drag (airborne preserves momentum cleanly!).
  let accelCmd = 0;
  if (locked) {
    vFwd = damp(vFwd, 0, 12, dt);
    vSide = damp(vSide, 0, 14, dt);
  } else if (!state.grounded) {
    vFwd = damp(vFwd, 0, 0.22, dt);
  } else if (handbrake && !isTracked) {
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

  // Steering & drift dynamics (moto gets speed-sensitive steering stabilization so it's crisp yet never twitchy at 150 km/h!).
  const targetSteer = -steer * (isMoto ? 0.36 : 0.54);
  state.steerAngle = damp(state.steerAngle, targetSteer, isMoto ? 9.5 : 11, dt);

  let targetYawRate = 0;
  if (!locked) {
    if (isTracked) {
      const speedEase = 1 - clamp(Math.abs(vFwd) / (def.maxSpeed * 1.4), 0, 0.35);
      targetYawRate = -steer * def.turnRate * speedEase;
    } else if (isMoto) {
      const airControl = state.grounded ? 1 : 0.2;
      const speedFactor = clamp(Math.abs(vFwd) / 4.5, 0, 1);
      // Speed-sensitive curve: agile low-speed carving, composed high-speed sweepers.
      const hiSpeedDamp = 1 - clamp((Math.abs(vFwd) - 16) / (def.boostSpeed * 1.25), 0, 0.48);
      const dirSign = vFwd >= -0.35 ? 1 : -1;
      const driftBoost = state.grounded && handbrake && Math.abs(vFwd) > 7 ? 1.25 : 1;
      targetYawRate = -steer * def.turnRate * speedFactor * hiSpeedDamp * dirSign * driftBoost * airControl;
    } else {
      const airControl = state.grounded ? 1 : 0.25;
      const speedFactor = clamp(Math.abs(vFwd) / 5.5, 0, 1);
      const dirSign = vFwd >= -0.35 ? 1 : -1;
      const driftBoost = state.grounded && handbrake && Math.abs(vFwd) > 7 ? 1.42 : 1;
      targetYawRate = -steer * def.turnRate * speedFactor * dirSign * driftBoost * airControl;
    }
  }
  state.yawRate = damp(state.yawRate, targetYawRate, isMoto ? 8.0 : handbrake ? 6.5 : 10.5, dt);
  state.yaw += state.yawRate * dt;

  const nfx = Math.sin(state.yaw);
  const nfz = Math.cos(state.yaw);
  const nlx = Math.cos(state.yaw);
  const nlz = -Math.sin(state.yaw);

  state.drifting = state.grounded && !isTracked && handbrake && Math.hypot(vFwd, vSide) > 8 && Math.abs(steer) > 0.15;
  const grip = locked ? 18 : !state.grounded ? 0.5 : state.drifting ? def.driftGrip : def.lateralGrip;

  const worldVx = vFwd * fx + vSide * lx;
  const worldVz = vFwd * fz + vSide * lz;
  const newFwd = worldVx * nfx + worldVz * nfz;
  const newSide = damp(worldVx * nlx + worldVz * nlz, 0, grip, dt);

  state.velocity.x = newFwd * nfx + newSide * nlx;
  state.velocity.z = newFwd * nfz + newSide * nlz;

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
    const crestDrop = groundY < prevY - 0.14;
    if (crestDrop && state.climbCarryTimer > 0 && state.recentClimbVy > 2.2 && horizSpeed > 9.5) {
      state.velocity.y = clamp(state.recentClimbVy * 1.08 + horizSpeed * 0.08, 4.5, 22);
      state.grounded = false;
      state.climbCarryTimer = 0;
      state.recentClimbVy = 0;
      state.position.y += state.velocity.y * dt;
    } else if (groundY < prevY - 0.35 && horizSpeed > 12) {
      state.velocity.y = Math.max(0, state.recentClimbVy);
      state.grounded = false;
      state.position.y += state.velocity.y * dt;
    } else {
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
    state.velocity.y -= GRAVITY * dt;
    state.position.y += state.velocity.y * dt;
    if (state.position.y <= groundY) {
      const slamSpeed = -state.velocity.y;
      if (slamSpeed > 22) {
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

  // Sample front/rear ground slopes + expressive squat, motorcycle lean & suspension body roll!
  // Coordinate rule (+Z nose, +Y up, +X left): POSITIVE roll drops right (-X) and lifts left (+X) = leaning RIGHT!
  let targetPitch: number;
  let targetRoll: number;
  if (state.grounded) {
    const gFwd = sampleGround(world, physics, state.position.x + nfx * def.halfLength * 0.8, state.position.y, state.position.z + nfz * def.halfLength * 0.8, groundY, ownHandle);
    const gRear = sampleGround(world, physics, state.position.x - nfx * def.halfLength * 0.8, state.position.y, state.position.z - nfz * def.halfLength * 0.8, groundY, ownHandle);
    const slopePitch = Math.atan2(gRear - gFwd, Math.max(1, def.halfLength * 1.6));
    const wheeliePitch = isMoto && state.boosting && newFwd > 8 ? -0.18 : 0;
    const squatPitch = clamp(-accelCmd * (isMoto ? 0.003 : 0.0024), -0.1, 0.08) - state.recoilOffset * 0.06 + wheeliePitch;
    targetPitch = clamp(slopePitch + squatPitch, -0.45, 0.42);
    if (isMoto) {
      // Smooth, controlled lean INTO the turn (steer > 0 turning right => positive roll leaning right!).
      const leanScale = clamp(Math.abs(newFwd) / (def.maxSpeed * 0.55), 0, 1);
      targetRoll = clamp(steer * 0.46 * leanScale, -0.46, 0.46);
    } else {
      // 4-wheeled suspension body roll leans gently OUTWARD (turning right -> yawRate < 0 -> negative roll).
      targetRoll = clamp(state.yawRate * (newFwd / Math.max(10, def.maxSpeed)) * 0.12, -0.15, 0.15);
    }
  } else {
    targetPitch = clamp(-Math.atan2(state.velocity.y, Math.max(10, horizSpeed)) * 0.65, -0.44, 0.44);
    targetRoll = isMoto ? clamp(steer * 0.28, -0.32, 0.32) : damp(state.roll, 0, 2.5, dt);
  }

  state.pitch = damp(state.pitch, targetPitch, state.grounded ? 10 : 5, dt);
  state.roll = damp(state.roll, targetRoll, isMoto ? 8.5 : 9, dt);
  state.wheelSpin += (newFwd / (isMoto ? 0.42 : 0.58)) * dt;
}

function stepHoverBike(
  def: DriveVehicleDef,
  state: VehiclePhysicsState,
  input: VehicleInput,
  dt: number,
  fx: number,
  fz: number,
  lx: number,
  lz: number,
  world: WorldSystem | undefined,
  physics: PhysicsSystem | undefined,
  occupied: boolean,
  ownHandle?: number,
): void {
  const throttle = occupied ? clamp(input.throttle, -1, 1) : 0;
  const steer = occupied ? clamp(input.steer, -1, 1) : 0;

  let vFwd = state.velocity.x * fx + state.velocity.z * fz;
  let vSide = state.velocity.x * lx + state.velocity.z * lz;

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
  state.yawRate = damp(state.yawRate, -steer * def.turnRate * turnMult, 11, dt);
  state.yaw += state.yawRate * dt;

  const nfx = Math.sin(state.yaw);
  const nfz = Math.cos(state.yaw);
  const nlx = Math.cos(state.yaw);
  const nlz = -Math.sin(state.yaw);

  const worldVx = vFwd * fx + vSide * lx;
  const worldVz = vFwd * fz + vSide * lz;
  const newFwd = worldVx * nfx + worldVz * nfz;
  const newSide = damp(worldVx * nlx + worldVz * nlz, 0, def.lateralGrip, dt);
  state.velocity.x = newFwd * nfx + newSide * nlx;
  state.velocity.z = newFwd * nfz + newSide * nlz;

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

  // Carve INTO the turn: steer > 0 (turning right) => positive roll (banking right)!
  const targetRoll = clamp(steer * (0.2 + 0.3 * clamp(Math.abs(newFwd) / def.maxSpeed, 0, 1)), -0.5, 0.5);
  const targetPitch = clamp(-throttle * 0.08 + (state.boosting ? -0.1 : 0) - clamp(state.velocity.y * 0.025, -0.25, 0.25), -0.35, 0.32);
  state.roll = damp(state.roll, occupied ? targetRoll : 0, 9.5, dt);
  state.pitch = damp(state.pitch, occupied ? targetPitch : 0, 9, dt);
}

function stepHelicopter(
  def: DriveVehicleDef,
  state: VehiclePhysicsState,
  input: VehicleInput,
  dt: number,
  fx: number,
  fz: number,
  lx: number,
  lz: number,
  world: WorldSystem | undefined,
  physics: PhysicsSystem | undefined,
  driveActive: boolean,
  hasOccupant: boolean,
  ownHandle?: number,
): void {
  const groundY = sampleGround(world, physics, state.position.x, state.position.y, state.position.z, state.groundY, ownHandle);
  state.groundY = groundY;
  state.altitude = Math.max(0, state.position.y - groundY);

  // If completely abandoned in mid-air (NO crew in any seat!), cut lift and enter a fiery death spiral!
  if (!hasOccupant) {
    if (state.altitude > 3.5 || state.abandonedFall) {
      state.abandonedFall = true;
      if (Math.abs(state.fallSpin) < 0.5) state.fallSpin = 2.6;
      state.rotorAngle += 9 * dt;
      state.yaw += state.fallSpin * dt;
      state.velocity.y -= GRAVITY * 0.72 * dt;
      state.velocity.x = damp(state.velocity.x, 0, 0.28, dt);
      state.velocity.z = damp(state.velocity.z, 0, 0.28, dt);
      state.position.addScaledVector(state.velocity, dt);
      state.pitch = damp(state.pitch, 0.52, 2.4, dt);
      state.roll = damp(state.roll, 0.72, 2.4, dt);
      if (state.position.y <= groundY) {
        const impact = Math.max(28, -state.velocity.y * 1.45);
        state.crashImpact = Math.max(state.crashImpact, impact);
        state.crashNormal.set(0, 1, 0);
        state.position.y = groundY;
        state.velocity.set(0, 0, 0);
        state.grounded = true;
        // Keep abandonedFall latched so stepCrashAndRam() detonates the crashed chopper on this frame!
      } else {
        state.grounded = false;
      }
      state.altitude = Math.max(0, state.position.y - groundY);
      resolveHorizontalWalls(def, state, physics, world, dt, ownHandle);
      return;
    }
    // Exited low to the ground (<= 3.5 m): settle cleanly onto landing skids.
    state.rotorAngle += (state.altitude > 0.4 ? 12 : 2.2) * dt;
    state.velocity.x = damp(state.velocity.x, 0, 3.2, dt);
    state.velocity.z = damp(state.velocity.z, 0, 3.2, dt);
    state.velocity.y = state.altitude > 0.08 ? damp(state.velocity.y, -4.5, 4, dt) : 0;
    state.position.addScaledVector(state.velocity, dt);
    if (state.position.y <= groundY) {
      state.position.y = groundY;
      state.velocity.y = 0;
      state.grounded = true;
    } else {
      state.grounded = false;
    }
    state.pitch = damp(state.pitch, 0, 5, dt);
    state.roll = damp(state.roll, 0, 5, dt);
    state.altitude = Math.max(0, state.position.y - groundY);
    return;
  }

  state.abandonedFall = false;
  state.fallSpin = 0;
  const rotorSpeed = 24;
  state.rotorAngle += rotorSpeed * dt;

  const throttle = driveActive ? clamp(input.throttle, -1, 1) : 0;
  const strafe = driveActive ? clamp(input.steer, -1, 1) : 0;
  // When a gunner is seated in Seat 2 (hasOccupant && !driveActive), auto-hover holds altitude steadily!
  const climb = driveActive ? clamp(input.climb, -1, 1) : 0;

  const targetVy = climb * def.climbRate;
  state.velocity.y = damp(state.velocity.y, targetVy, driveActive ? 5.5 : 4.2, dt);

  const topSpeed = state.boosting ? def.boostSpeed : def.maxSpeed;
  const desiredVx = (fx * throttle + lx * -strafe) * topSpeed;
  const desiredVz = (fz * throttle + lz * -strafe) * topSpeed;
  const response = driveActive ? (Math.abs(throttle) > 0.05 || Math.abs(strafe) > 0.05 ? 2.8 : 2.0) : 2.6;
  state.velocity.x = damp(state.velocity.x, desiredVx, response, dt);
  state.velocity.z = damp(state.velocity.z, desiredVz, response, dt);

  state.position.x += state.velocity.x * dt;
  state.position.z += state.velocity.z * dt;
  state.position.y += state.velocity.y * dt;

  if (state.position.y < groundY) {
    const slam = -state.velocity.y;
    if (slam > 18) {
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
  const vLeft = state.velocity.x * lx + state.velocity.z * lz;
  const airBlend = clamp(state.altitude / 2.2, 0, 1);
  // Moving forward pitches nose down (+pitch); moving right (vLeft < 0) banks right (+roll).
  const targetPitch = clamp((vFwd / def.maxSpeed) * 0.28, -0.32, 0.34) * airBlend;
  const targetRoll = clamp((-vLeft / def.maxSpeed) * 0.36, -0.44, 0.44) * airBlend;
  state.pitch = damp(state.pitch, targetPitch, 5.5, dt);
  state.roll = damp(state.roll, targetRoll, 5.5, dt);
}

/**
 * Unified Dual-Mode VTOL/STOL Jump-Jet & Ground-Attack Jet physics (Harrier & A-10 Warthog).
 * Single controller for pitch, yaw, and roll (ZERO dual-mutation stutter!), correct right-hand bank sign,
 * and realistic abandoned nose-dive crashes if the pilot bails mid-flight!
 */
function stepJet(
  def: DriveVehicleDef,
  state: VehiclePhysicsState,
  input: VehicleInput,
  dt: number,
  fx: number,
  fz: number,
  lx: number,
  lz: number,
  world: WorldSystem | undefined,
  physics: PhysicsSystem | undefined,
  driveActive: boolean,
  hasOccupant: boolean,
  ownHandle?: number,
): void {
  const groundY = sampleGround(world, physics, state.position.x, state.position.y, state.position.z, state.groundY, ownHandle);
  state.groundY = groundY;
  state.altitude = Math.max(0, state.position.y - groundY);

  if (!hasOccupant) {
    const horizSpd = Math.hypot(state.velocity.x, state.velocity.z);
    // If bailed out in mid-air or at flight speed, jet drops out of the sky nose-down and explodes on impact!
    if (state.altitude > 3.5 || !state.vtolMode || horizSpd > 12 || state.abandonedFall) {
      state.abandonedFall = true;
      state.vtolMode = false;
      state.airThrottle = damp(state.airThrottle, 0.15, 1.5, dt);
      state.velocity.y -= GRAVITY * 0.85 * dt;
      state.velocity.x = damp(state.velocity.x, 0, 0.18, dt);
      state.velocity.z = damp(state.velocity.z, 0, 0.18, dt);
      state.position.addScaledVector(state.velocity, dt);
      const divePitch = clamp(-Math.atan2(state.velocity.y, Math.max(8, Math.hypot(state.velocity.x, state.velocity.z))), -0.4, 1.1);
      state.pitch = damp(state.pitch, divePitch, 3.2, dt);
      state.roll = damp(state.roll, 0.65, 1.8, dt);
      state.yaw += 0.45 * dt;
      if (state.position.y <= groundY) {
        const impact = Math.max(34, state.velocity.length() * 1.25);
        state.crashImpact = Math.max(state.crashImpact, impact);
        state.crashNormal.set(0, 1, 0);
        state.position.y = groundY;
        state.velocity.set(0, 0, 0);
        state.grounded = true;
        // Keep abandonedFall latched so stepCrashAndRam() detonates the crashed jet on this frame!
      } else {
        state.grounded = false;
      }
      state.altitude = Math.max(0, state.position.y - groundY);
      resolveHorizontalWalls(def, state, physics, world, dt, ownHandle);
      return;
    }
    // Parked / exited gently on the tarmac: stay cleanly settled on gear.
    state.vtolMode = true;
    state.airThrottle = damp(state.airThrottle, 0, 3, dt);
    state.velocity.x = damp(state.velocity.x, 0, 3.2, dt);
    state.velocity.z = damp(state.velocity.z, 0, 3.2, dt);
    state.velocity.y = state.altitude > 0.08 ? damp(state.velocity.y, -4.5, 4, dt) : 0;
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

  state.abandonedFall = false;
  state.fallSpin = 0;

  const throttle = driveActive ? clamp(input.throttle, -1, 1) : 0;
  const steer = driveActive ? clamp(input.steer, -1, 1) : 0;
  const climb = driveActive ? clamp(input.climb, -1, 1) : 0;

  // Tick jet special timers (Raptor Cobra AoA & Lancer Dump-and-Burn).
  if (state.cobraTimer > 0) state.cobraTimer = Math.max(0, state.cobraTimer - dt);
  if (state.dumpBurnTimer > 0) state.dumpBurnTimer = Math.max(0, state.dumpBurnTimer - dt);

  const isRaptor = def.id === 'raptor';
  const isHornet = def.id === 'hornet';
  const isLancer = def.id === 'lancer';
  const isStolJet = def.special.id !== 'vtol';

  if (state.vtolMode) {
    // VTOL / STOL tarmac hover & launch mode: Space lifts off cleanly, Ctrl settles onto gear, WASD repositions!
    if (driveActive && typeof input.targetAimYaw === 'number') {
      state.yaw = dampAngle(state.yaw, input.targetAimYaw, isRaptor ? 6.5 : 4.5, dt);
    }
    const vtolMax = def.maxSpeed * (isStolJet ? 0.34 : 0.42);
    const targetVy = climb * def.climbRate;
    state.velocity.y = damp(state.velocity.y, targetVy, 5.2, dt);

    const nfx = Math.sin(state.yaw);
    const nfz = Math.cos(state.yaw);
    const nlx = Math.cos(state.yaw);
    const nlz = -Math.sin(state.yaw);

    const desiredVx = (nfx * throttle + nlx * -steer) * vtolMax;
    const desiredVz = (nfz * throttle + nlz * -steer) * vtolMax;
    state.velocity.x = damp(state.velocity.x, desiredVx, 3.0, dt);
    state.velocity.z = damp(state.velocity.z, desiredVz, 3.0, dt);
    state.airThrottle = damp(state.airThrottle, Math.max(0.2, Math.abs(throttle) * 0.6), 4, dt);

    state.position.addScaledVector(state.velocity, dt);
    const vFwd = state.velocity.x * nfx + state.velocity.z * nfz;
    const vLeft = state.velocity.x * nlx + state.velocity.z * nlz;
    const airBlend = clamp(state.altitude / 2.2, 0, 1);
    state.pitch = damp(state.pitch, clamp((vFwd / Math.max(10, vtolMax)) * 0.16, -0.22, 0.22) * airBlend, 6, dt);
    // Strafe right (vLeft < 0) => positive roll (banking right!).
    state.roll = damp(state.roll, clamp((-vLeft / Math.max(10, vtolMax)) * 0.34, -0.4, 0.4) * airBlend, 6, dt);

    // Non-VTOL conventional jets (Raptor, Hornet, Lancer) transition seamlessly into Mach flight once airborne + pushing forward!
    if (isStolJet && driveActive && ((state.altitude > 4.2 && (throttle > 0.15 || state.boosting)) || (state.altitude > 1.8 && state.boosting && throttle > 0.1))) {
      state.vtolMode = false;
      state.airThrottle = Math.max(state.airThrottle, 0.78);
    }
  } else {
    // UNIFIED SMOOTH FORWARD JET FLIGHT MODE (single pitch/yaw/roll controller -> ZERO stutter!).
    const cobraActive = isRaptor && state.cobraTimer > 0;
    const dumpBurnActive = isLancer && state.dumpBurnTimer > 0;

    // Gentle auto-STOL touchdown if a conventional jet slows right down near the tarmac while holding descend/back.
    if (isStolJet && driveActive && state.altitude < 4.5 && climb < -0.2 && throttle < -0.1 && state.airThrottle < 0.52) {
      state.vtolMode = true;
    }

    const minThrottle = cobraActive ? 0.3 : 0.45;
    const targetThrottle = (state.boosting || dumpBurnActive)
      ? 1.0
      : cobraActive
        ? 0.34
        : clamp(state.airThrottle + throttle * 0.85 * dt, minThrottle, 1.0);
    state.airThrottle = damp(state.airThrottle, targetThrottle, cobraActive ? 8.5 : 5, dt);

    // Combine mouse aim heading + A/D keyboard banking smoothly in one place!
    let yawDiff = 0;
    if (driveActive && typeof input.targetAimYaw === 'number') {
      let d = input.targetAimYaw - state.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      yawDiff = d;
    }
    const turnAuthority = def.turnRate * (cobraActive ? 1.75 : 1.0);
    const aimGain = isRaptor ? (cobraActive ? 4.4 : 3.2) : isHornet ? 2.6 : 2.1;
    const yawDamp = isRaptor ? 11.0 : isHornet ? 8.5 : isLancer ? 5.8 : 6.5;
    const pitchDamp = isRaptor ? (cobraActive ? 11.5 : 9.5) : isHornet ? 7.4 : isLancer ? 5.0 : 5.2;
    const rollDamp = isRaptor ? 8.8 : isHornet ? 7.0 : isLancer ? 4.8 : 5.4;
    const maxBank = isRaptor ? 1.36 : isHornet ? 1.22 : isLancer ? 0.98 : 1.05;
    const velDamp = isRaptor ? (cobraActive ? 7.5 : 6.2) : isHornet ? 5.0 : isLancer ? 3.8 : 4.2;

    const desiredYawRate = clamp(yawDiff * aimGain - steer * turnAuthority * 0.88, -turnAuthority * 1.25, turnAuthority * 1.25);
    state.yawRate = damp(state.yawRate, desiredYawRate, yawDamp, dt);
    state.yaw += state.yawRate * dt;

    // Smooth pitch tracking toward pilot aim (pitch < 0 = nose UP in Three.js!).
    const pitchLimit = isRaptor ? 1.18 : isHornet ? 1.06 : 0.92;
    if (driveActive && typeof input.targetAimPitch === 'number') {
      const cobraNoseBias = cobraActive ? -0.34 : 0;
      const desiredPitch = clamp(-input.targetAimPitch + cobraNoseBias, -pitchLimit, pitchLimit);
      state.pitch = damp(state.pitch, desiredPitch, pitchDamp, dt);
    }

    // FIXED BANK SIGN (+Z nose, +Y up, +X left): turning RIGHT (yawRate < 0, steer > 0) => POSITIVE roll (right wing drops)!
    const bankCmd = clamp((-state.yawRate / Math.max(1, turnAuthority)) * (isRaptor ? 1.05 : 0.86) + steer * 0.36, -maxBank, maxBank);
    state.roll = damp(state.roll, bankCmd, rollDamp, dt);

    // Nose vector from (yaw, pitch).
    const nosePitch = -state.pitch;
    const cp = Math.cos(nosePitch);
    const dirX = Math.sin(state.yaw) * cp;
    const dirY = Math.sin(nosePitch);
    const dirZ = Math.cos(state.yaw) * cp;

    const targetSpeed = dumpBurnActive
      ? def.boostSpeed * 1.05
      : state.boosting && !cobraActive
        ? def.boostSpeed
        : def.maxSpeed * state.airThrottle;
    const desiredVx = dirX * targetSpeed;
    const desiredVy = dirY * targetSpeed + climb * (isRaptor ? 14 : 10);
    const desiredVz = dirZ * targetSpeed;

    state.velocity.x = damp(state.velocity.x, desiredVx, velDamp, dt);
    state.velocity.y = damp(state.velocity.y, desiredVy, velDamp, dt);
    state.velocity.z = damp(state.velocity.z, desiredVz, velDamp, dt);

    state.position.addScaledVector(state.velocity, dt);
  }

  // Animated variable-geometry wing sweep (Lancer) & 2D thrust-vectoring exhaust nozzles (Raptor)!
  const curSpd = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
  if (isLancer) {
    const targetSweep = state.vtolMode ? 0 : clamp((curSpd - 22) / 56, 0, 1);
    state.wingSweep = damp(state.wingSweep, targetSweep, 3.2, dt);
  }
  if (isRaptor) {
    const targetNozzle = clamp(-state.pitch * 0.42 + (state.cobraTimer > 0 ? 0.38 : 0) + clamp(climb * 0.18, -0.2, 0.2), -0.46, 0.46);
    state.nozzleDeflect = damp(state.nozzleDeflect, targetNozzle, 10, dt);
  }

  // Floor & sky ceiling checks (with high-speed crash detection!).
  if (state.position.y < groundY) {
    const downSpeed = -state.velocity.y;
    const fwdSpeed = Math.hypot(state.velocity.x, state.velocity.z);
    if (!state.vtolMode && (downSpeed > 18 || (state.pitch > 0.32 && fwdSpeed > 34))) {
      state.crashImpact = Math.max(state.crashImpact, Math.hypot(fwdSpeed * 0.72, downSpeed));
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
