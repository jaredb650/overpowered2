/**
 * Closed-loop Euphoria / RDR2-style dynamic balancer for active ragdolls.
 *
 * Replaces open-loop ghost animation playback with closed-loop biomechanical balance:
 * - Real gravity stays ON (`gravityScale = g`) for hips, spine, and stance legs.
 * - Computes live Center of Mass, CoM velocity, and Capture Point (`p_com + v_com * sqrt(h / g)`).
 * - Dynamically triggers alternating catch steps raycasted against actual world geometry
 *   (working natively on slopes, stairs, curbs, and ledges) via analytical 2-bone leg IK.
 * - Pelvis vertical support is strictly gated by physical foot ground contact (vanishes the
 *   instant both feet leave the floor or a leg gives out).
 * - Horizontal motion is pure Newtonian momentum + realistic shoe-friction braking from
 *   planted feet (never pinned to a ghost root).
 * - Per-bone neuromuscular shock transiently drops PD stiffness on struck joints so bullet
 *   lever-arm torque (`r x J`) visibly twists shoulders, buckles knees, and curls the gut.
 * - Spatial probes detect walls (reaching hands out to brace) and low cover/railings (shin
 *   tripping over the barrier).
 * - Runs both living balance recovery (`stand` / `stumble`) and dying-on-feet (`staggerFall`)
 *   with decaying strength, rising step latency, wound clutching, and sideways crumple.
 */
import * as THREE from 'three';
import { CG, type PhysicsSystem, type RayHit } from '../core/contracts';
import { clamp, lerp, smoothstep } from '../core/math';
import { GRAVITY } from '../physics/Physics';
import { HUMAN_HEIGHT } from './rigInfo';
import type { Rag, RagPart } from './rag';
import { MuscleTuning, type CollapseDrive, type MuscleState } from './muscles';
import { StandTuning } from './stand';

const WEIGHT = Math.abs(GRAVITY);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

const fade = (band: readonly number[], u: number, lead: number): number =>
  1 - smoothstep(Math.max(0, band[0]! - lead), Math.max(0.01, band[1]! - lead), u);

export const BalancerTuning = {
  /** Capture-point offset from feet midpoint (m * scale) that triggers a catch step. */
  stepTrigger: 0.14,
  /** Horizontal CoM speed (m/s) that also triggers a catch step even before CoM drifts far. */
  stepSpeedTrigger: 0.55,
  /** Capture-point lead overshoot along CoM velocity (m * scale). */
  stepOvershoot: 0.16,
  /** Maximum anatomical stride length from pelvis (m * scale). Past this, momentum beats the legs. */
  maxStride: 0.68,
  /** Base swing duration (seconds) at full strength; stretches when wounded or dying. */
  swingSeconds: 0.24,
  /** Extra step latency (seconds) added as dying nervous system fails. */
  dyingLatency: 0.22,
  /** Parabolic swing foot clearance height (m * scale). */
  swingArc: 0.14,
  /** PD gain boost on actively swinging legs so Rapier joints snap cleanly to the capture point. */
  swingGain: 2.8,
  /** PD gain on planted stance legs supporting weight. */
  stanceGain: 2.1,
  /** Foot ground-contact tolerance above raycasted terrain (m * scale). */
  groundTol: 0.17,
  /** Maximum vertical leg-extension force as a multiple of body weight (`m * g`). */
  maxSupportWeight: 1.9,
  /** Pelvis vertical PD natural frequency (rad/s) and damping ratio while grounded. */
  hipYRate: 13,
  hipYDamping: 1.05,
  /** Maximum horizontal traction coefficient (`mu`) of planted shoes braking CoM velocity. */
  shoeFriction: 0.52,
  /** Horizontal braking rate (1/s) applied when feet are planted and unyielded. */
  brakeRate: 2.2,
  /** Gentle centering pull toward real feet midpoint when nearly still (< 0.75 m/s) to settle cleanly. */
  settleRate: 6.5,
  /** Soft pelvis uprighting torque natural frequency (rad/s) and damping ratio. */
  uprightRate: 8.0,
  uprightDamping: 1.2,
  /** Maximum lean angle into velocity (rad) so stepping looks grounded, not rigid. */
  maxVelLean: 0.32,
  /** Seconds localized muscle shock lasts on a struck joint. */
  shockDuration: 0.2,
  /** Share of PD drive knocked out at peak localized shock (0.85 = drops to 15% stiffness). */
  shockDrop: 0.85,
  /** Seconds a struck leg stays buckled/weakened. */
  legShockDuration: 0.45,
  /** Seconds a gut shot holds forward abdominal curl. */
  gutCurlDuration: 0.55,
  gutCurlAngle: 0.58,
  /** Spatial probe distances (m * scale) for wall bracing and low-cover shin tripping. */
  wallProbe: 0.95,
  shinProbe: 0.72,
  /** Minimum horizontal speed (m/s) before running spatial probes. */
  probeMinSpeed: 0.65,
  /** Support level below which dying-on-feet biases an asymmetric sideways crumple (prevents knee-folding). */
  crumpleBelow: 0.45,
};

interface LegRig {
  side: 1 | -1;
  hip: RagPart;
  knee: RagPart | null;
  hipOffset: THREE.Vector3;
  footAt: THREE.Vector3;
  upperLen: number;
  lowerLen: number;
  footPos: THREE.Vector3;
  groundY: number;
  grounded: boolean;
  stanceTarget: THREE.Vector3;
  shock: number;
}

interface ArmRig {
  side: 1 | -1;
  shoulder: RagPart;
  elbow: RagPart | null;
  rest: THREE.Vector3;
  upperLen: number;
  lowerLen: number;
  phase: number;
}

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _v7 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m0 = new THREE.Matrix4();
const _ray: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

export class DynamicBalancer {
  readonly scale: number;
  readonly standHipY: number;
  readonly legs: LegRig[] = [];
  readonly arms: ArmRig[] = [];
  readonly spine: RagPart | null = null;
  readonly head: RagPart | null = null;

  /** Live physical Center of Mass & velocity in world space. */
  readonly com = new THREE.Vector3();
  readonly comVel = new THREE.Vector3();
  readonly feetMid = new THREE.Vector3();
  readonly capturePoint = new THREE.Vector3();

  /** Stepping state machine: -1 = double support, 0 = left leg swinging, 1 = right leg swinging. */
  swingLeg = -1;
  lastSwingLeg = 1;
  swingT = 0;
  swingDuration = BalancerTuning.swingSeconds;
  stepCooldown = 0;
  readonly swingStart = new THREE.Vector3();
  readonly swingTarget = new THREE.Vector3();
  swingOverLedge = false;

  /** Ground state read from actual terrain raycasts. */
  groundY = 0;
  groundedCount = 2;

  /** Facing yaw (rad) tracked gently from physical pelvis orientation so hits can twist it naturally. */
  facingYaw = 0;

  /** Localized neuromuscular shock per ragdoll part index (0..1, decays quickly). */
  readonly partShock: Float32Array;
  /** Abdominal curl timer & strength from gut shots. */
  gutCurl = 0;
  /** Wound clutch target (part + local offset) for wounded/dying torso grabs. */
  woundPart: RagPart | null = null;
  readonly woundLocal = new THREE.Vector3();
  woundRegion = '';

  /** Environment probes: wall ahead (for bracing) and low obstacle at shin height (for railing trip). */
  wallAhead = false;
  readonly wallPoint = new THREE.Vector3();
  readonly wallNormal = new THREE.Vector3();
  trippingOverCover = false;

  /** Asymmetric crumple side (+1 left, -1 right) for organic sideways death collapse. */
  crumpleSide: 1 | -1 = 1;
  /** Cumulative step counter (independent of Stand so tests/telemetry can inspect). */
  totalSteps = 0;
  /** Short reaction launch grace (seconds) after a fresh bullet impact so legs have time to launch a catch step. */
  hitGrace = 0;
  /** Exact total mass * (gravityScale / rag.gravity) currently experiencing gravity in Rapier. */
  private activeGravityMass = 0;
  private age = 0;
  private dyingAge = 0;

  constructor(
    private readonly rag: Rag,
    private readonly muscle: MuscleState,
    private readonly physics: PhysicsSystem | null,
    initialGroundY: number,
    initialYaw: number,
  ) {
    const info = rag.info;
    const bind = info.bind;
    this.scale = rag.source.rig.height / HUMAN_HEIGHT;
    this.groundY = initialGroundY;
    this.facingYaw = initialYaw;
    this.partShock = new Float32Array(rag.parts.length);
    this.crumpleSide = 1;

    this.readCenterOfMass();
    const hips0 = rag.parts[0]!;
    // Match exact initial standing pelvis height so Frame 0 has zero vertical pop or yank.
    this.standHipY = clamp(hips0.p.y - initialGroundY, bind[1]! * 0.78, bind[1]! * 1.02);
    this.activeGravityMass = muscle.totalMass;

    const parts = rag.parts;
    for (const part of parts) {
      const m = part.muscle;
      if (!m || !part.parent) continue;
      if (m.role === 'spine') (this as { spine: RagPart | null }).spine = part;
      else if (m.role === 'head') (this as { head: RagPart | null }).head = part;
      else if (!part.hinge && m.role === 'leg') {
        const side: 1 | -1 = bind[part.bone * 3]! >= 0 ? 1 : -1;
        const knee = parts.find(k => k.parent === part && k.hinge) ?? null;
        const o = part.bone * 3;
        const hipOffset = new THREE.Vector3(bind[o]! - bind[0]!, bind[o + 1]! - bind[1]!, bind[o + 2]! - bind[2]!);
        let upperLen = 0.44 * this.scale;
        let lowerLen = 0.42 * this.scale;
        const footAt = new THREE.Vector3(0, -lowerLen, 0);
        if (knee) {
          const ko = knee.bone * 3;
          upperLen = Math.hypot(bind[ko]! - bind[o]!, bind[ko + 1]! - bind[o + 1]!, bind[ko + 2]! - bind[o + 2]!);
          const footBone = info.children[knee.bone]?.[0];
          if (footBone !== undefined) {
            const fo = footBone * 3;
            footAt.set(bind[fo]! - bind[ko]!, bind[fo + 1]! - bind[ko + 1]!, bind[fo + 2]! - bind[ko + 2]!);
            lowerLen = footAt.length();
          }
        }
        const footPos = new THREE.Vector3();
        this.computeFootWorld(knee ?? part, footAt, footPos);
        this.legs.push({
          side, hip: part, knee, hipOffset, footAt, upperLen, lowerLen,
          footPos, groundY: initialGroundY, grounded: true,
          stanceTarget: footPos.clone(), shock: 0,
        });
      } else if (!part.hinge && m.role === 'arm') {
        const side: 1 | -1 = bind[part.bone * 3]! >= 0 ? 1 : -1;
        const elbow = parts.find(k => k.parent === part && k.hinge) ?? null;
        const o = part.bone * 3;
        let upperLen = 0.29 * this.scale;
        let lowerLen = 0.26 * this.scale;
        const rest = new THREE.Vector3(side * 0.25, -1, 0).normalize();
        if (elbow) {
          const eo = elbow.bone * 3;
          rest.set(bind[eo]! - bind[o]!, bind[eo + 1]! - bind[o + 1]!, bind[eo + 2]! - bind[o + 2]!);
          upperLen = rest.length();
          rest.normalize();
          const handBone = info.children[elbow.bone]?.[0];
          if (handBone !== undefined) {
            const ho = handBone * 3;
            lowerLen = Math.hypot(bind[ho]! - bind[eo]!, bind[ho + 1]! - bind[eo + 1]!, bind[ho + 2]! - bind[eo + 2]!);
          }
        }
        this.arms.push({ side, shoulder: part, elbow, rest, upperLen, lowerLen, phase: side > 0 ? 0.4 : 3.55 });
      }
    }
    // Keep left leg at index 0, right leg at index 1 to match `MuscleState.feet` ordering.
    this.legs.sort((a, b) => b.side - a.side);
    if (this.legs.length > 0) {
      let fx = 0, fz = 0;
      for (const leg of this.legs) {
        fx += leg.footPos.x;
        fz += leg.footPos.z;
      }
      this.feetMid.set(fx / this.legs.length, initialGroundY, fz / this.legs.length);
    } else {
      this.feetMid.set(this.com.x, initialGroundY, this.com.z);
    }
  }

  /**
   * Ensures a body entering balance with an explicit knockback `velocity` actually has that horizontal
   * momentum on hips & upper body (even if `anim.stumble` was not called beforehand), while keeping
   * planted shins near rest so shoes don't skate on Frame 0.
   */
  seedVelocity(velocity: THREE.Vector3): void {
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed < 0.05) return;
    const dirX = velocity.x / speed;
    const dirZ = velocity.z / speed;
    const hips = this.rag.parts[0]!;
    hips.body.linvel(hips.v);
    const curAlong = hips.v.x * dirX + hips.v.z * dirZ;
    if (curAlong >= speed * 0.75) return;
    const addX = dirX * (speed - Math.max(0, curAlong));
    const addZ = dirZ * (speed - Math.max(0, curAlong));
    for (const part of this.rag.parts) {
      const isShin = part.hinge && part.muscle?.role === 'leg';
      const share = isShin ? 0.12 : part.muscle?.role === 'leg' ? 0.55 : 1.0;
      part.body.linvel(part.v);
      part.body.setLinvel({ x: part.v.x + addX * share, y: part.v.y, z: part.v.z + addZ * share }, true);
    }
    this.readCenterOfMass();
  }

  /** Called whenever a shot or impact lands on the active balanced body. */
  onHit(bone: number, point: THREE.Vector3, dir: THREE.Vector3, dv: number, region?: string): void {
    const t = BalancerTuning;
    const part = this.rag.partFor(bone);
    const idx = this.rag.parts.indexOf(part);
    const mag = clamp((dv - 0.12) / 0.85, 0, 1);
    if (idx >= 0) this.partShock[idx] = Math.max(this.partShock[idx]!, mag);
    if (part.parent) {
      const pIdx = this.rag.parts.indexOf(part.parent);
      if (pIdx >= 0) this.partShock[pIdx] = Math.max(this.partShock[pIdx]!, mag * 0.55);
    }

    const reg = region ?? this.rag.source.rig.bones[bone]?.region ?? '';
    this.woundRegion = reg;
    if (reg.startsWith('leg') || reg.startsWith('shin')) {
      const side = reg.endsWith('L') ? 1 : -1;
      for (const leg of this.legs) {
        if (leg.side === side) leg.shock = Math.max(leg.shock, clamp(0.65 + mag * 0.35));
      }
      this.crumpleSide = side;
    } else if (reg === 'abdomen') {
      this.gutCurl = Math.max(this.gutCurl, clamp(0.65 + mag * 0.35));
      this.setWound(part, point);
    } else if (reg === 'chest' || reg === 'head') {
      this.setWound(part, point);
    }
    // Slight directional bias for sideways crumple perpendicular to incoming shot so dying bodies don't fold onto knees.
    if (dir.lengthSq() > 1e-4) {
      const sideDot = dir.x * Math.cos(this.facingYaw) - dir.z * Math.sin(this.facingYaw);
      if (Math.abs(sideDot) > 0.2) this.crumpleSide = sideDot > 0 ? 1 : -1;
    }
    // Immediately allow a catch step to respond to the new impulse, and give moderate hits a brief launch grace window.
    this.stepCooldown = Math.min(this.stepCooldown, 0.03);
    if (dv > 0.25 && dv < 1.35) this.hitGrace = Math.max(this.hitGrace, 0.12);
    void t;
  }

  setWound(part: RagPart, worldPoint: THREE.Vector3): void {
    part.body.translation(part.p);
    part.body.rotation(part.q);
    this.woundPart = part;
    this.woundLocal.copy(worldPoint).sub(part.p).applyQuaternion(_q0.copy(part.q).conjugate());
  }

  /**
   * Once per game frame (called from `MuscleState.sampleCollapse`):
   * reads live physical CoM & terrain contacts, runs the capture-point step state machine,
   * probes walls/low cover, and writes closed-loop joint PD targets + strengths.
   */
  update(drive: CollapseDrive, dt: number): void {
    const t = BalancerTuning;
    const dying = !drive.alive;
    this.age += dt;
    if (dying) this.dyingAge += dt;
    if (this.hitGrace > 0) this.hitGrace = Math.max(0, this.hitGrace - dt);
    if (this.stepCooldown > 0) this.stepCooldown = Math.max(0, this.stepCooldown - dt);
    if (this.gutCurl > 0) this.gutCurl = Math.max(0, this.gutCurl - dt / t.gutCurlDuration);
    for (let i = 0; i < this.partShock.length; i++) {
      if (this.partShock[i]! > 0) this.partShock[i] = Math.max(0, this.partShock[i]! - dt / t.shockDuration);
    }
    for (const leg of this.legs) {
      if (leg.shock > 0) leg.shock = Math.max(0, leg.shock - dt / t.legShockDuration);
    }

    // 1. Live physical Center of Mass & foot positions.
    this.readCenterOfMass();
    this.updateFeetAndTerrain();

    // Update facing yaw gently toward physical pelvis forward (+Z local).
    const hips = this.rag.parts[0]!;
    _v0.set(0, 0, 1).applyQuaternion(hips.q);
    if (_v0.x * _v0.x + _v0.z * _v0.z > 0.05) {
      const physYaw = Math.atan2(_v0.x, _v0.z);
      let dy = physYaw - this.facingYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.facingYaw += dy * (1 - Math.exp(-3.5 * dt));
    }

    // 2. Capture point: where CoM is heading over one inverted-pendulum time constant.
    const gEff = WEIGHT * this.rag.gravity;
    const hCom = Math.max(this.com.y - this.groundY, 0.25 * this.scale);
    const omegaInv = Math.sqrt(hCom / Math.max(gEff, 1));
    this.capturePoint.set(
      this.com.x + this.comVel.x * omegaInv,
      this.groundY,
      this.com.z + this.comVel.z * omegaInv,
    );

    // 3. Spatial probes along horizontal velocity: wall bracing & low-cover shin tripping.
    this.probeEnvironment();

    // 4. Advance closed-loop capture-point stepping state machine.
    this.updateStepping(drive, dt, dying);

    if (this.age === 0 && drive.weakLeg !== 0) this.crumpleSide = drive.weakLeg > 0 ? 1 : -1;
    // 5. Sync drive telemetry so `handStanding` has zero hip pop (`root.xz === hips.xz`) and balance readout stays exact.
    drive.ghost.set(hips.p.x, this.groundY, hips.p.z);
    drive.facing.setFromAxisAngle(Y_AXIS, this.facingYaw);
    drive.hipsAt.set(hips.p.x, this.groundY + this.standHipY, hips.p.z);
    drive.hipsRot.copy(drive.facing);
    drive.hipsV.set(this.comVel.x, 0, this.comVel.z);
    for (let i = 0; i < this.legs.length; i++) drive.swing[i] = this.swingLeg === i;

    // 6. Write joint PD poses & strengths (legs via 2-bone IK, spine counter-balance, arm windmill/brace/clutch).
    this.writeJointTargets(drive, dying);
    this.writeStrengthsAndGravity(drive, dying);
  }

  /**
   * Runs inside every Rapier physics substep (`MuscleState.step`):
   * applies contact-gated vertical leg-extension support, friction-bounded horizontal braking,
   * and soft momentum-leaning pelvis uprighting torque — with REAL GRAVITY ON.
   */
  stepForces(drive: CollapseDrive, dt: number): void {
    const t = BalancerTuning;
    const support = drive.support;
    if (support <= 0.001) return;

    const hips = this.rag.parts[0]!;
    hips.body.translation(hips.p);
    hips.body.rotation(hips.q);
    hips.body.linvel(hips.v);
    hips.body.angvel(hips.w);

    const gEff = WEIGHT * this.rag.gravity;
    const totalMass = this.muscle.totalMass;
    const stand = drive.stand;
    const yielded = stand?.yielded ?? 0;
    const dying = !drive.alive;

    // Contact-gated support: drops to 0 the instant both feet leave the floor!
    const grounded = this.groundedCount > 0 ? 1 : 0;
    if (grounded === 0) return;

    // Effective stance leg power (drops sharply if the supporting leg was just shot or fractured).
    let legPower = 0;
    let legCount = 0;
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i]!;
      if (this.swingLeg === i) continue;
      const m = leg.hip.muscle!;
      const localPower = m.strength * (1 - 0.78 * leg.shock);
      legPower += localPower;
      legCount++;
    }
    if (legCount === 0) legPower = 0.5;
    else legPower /= legCount;

    const effSupport = support * legPower;
    if (effSupport <= 0.01) return;
    // While fighting for horizontal balance on healthy grounded legs (`stand`), legs still extend vertically
    // (`StandTuning.lift`) while horizontal traction weakens with balance budget — unless a leg is shot (`legPower`).
    const vertSupport = stand ? lerp(support, 1, StandTuning.lift) * legPower : effSupport;

    // --- A. Vertical Leg-Extension Support (Real Gravity ON, strictly matched to actual active downward weight) ---
    const horizSpeed = Math.hypot(this.comVel.x, this.comVel.z);
    let legShockMax = 0;
    for (const leg of this.legs) legShockMax = Math.max(legShockMax, leg.shock);
    const dyingU = dying ? drive.time / Math.max(drive.duration, 0.05) : 0;
    const dyingRamp = dying ? smoothstep(0, 0.2, this.dyingAge) : 0;
    const dyingSlump = dying ? (smoothstep(0.0, 0.45, dyingU) * 0.22 + (1 - support) * 0.22) * dyingRamp : 0;
    const crouchDrop = clamp(horizSpeed * 0.02 + legShockMax * 0.18 + this.gutCurl * 0.09 + dyingSlump, 0, 0.44) * this.scale;
    const wantY = this.groundY + this.standHipY - crouchDrop;

    const ky = totalMass * t.hipYRate * t.hipYRate * vertSupport;
    const dy = totalMass * 2 * t.hipYDamping * t.hipYRate * vertSupport;
    const scaleY = dt / (1 + (dy * dt + ky * dt * dt) / hips.mass);
    const gravityCarry = this.activeGravityMass * gEff * clamp(vertSupport, 0, 1) * dt;
    let impulseY = (ky * (wantY - hips.p.y) - dy * hips.v.y) * scaleY + gravityCarry;
    const maxUpImpulse = t.maxSupportWeight * totalMass * gEff * vertSupport * dt;
    impulseY = clamp(impulseY, -0.35 * maxUpImpulse, maxUpImpulse);

    // --- B. Horizontal Planted-Foot Braking (ZERO ghost tether — Euphoria Ankle Strategy vs Stepping Strategy) ---
    let impulseX = 0;
    let impulseZ = 0;
    const traction = (1 - yielded * 0.92) * effSupport;
    if (traction > 0.01) {
      const maxFriction = t.shoeFriction * totalMass * gEff * traction * dt;
      const inAnkleStrategy = this.groundedCount >= 2 && this.swingLeg < 0 && horizSpeed < 0.55 && yielded < 0.2;
      // Ankle strategy strongly resists minor bumps without drifting hips; stepping strategy scales braking smoothly with speed.
      const speedScale = inAnkleStrategy ? 2.4 : (0.65 + 0.23 * horizSpeed);
      const brakeK = t.brakeRate * speedScale * traction * (this.groundedCount >= 2 ? 1.25 : 0.75);
      let fx = -this.comVel.x * totalMass * brakeK * dt;
      let fz = -this.comVel.z * totalMass * brakeK * dt;

      // When nearly still on both feet, center hips over real physical feet midpoint (ankle/hip strategy).
      if (this.groundedCount >= 2 && horizSpeed < 0.85 && yielded < 0.2) {
        const ankleW = inAnkleStrategy ? 18.0 : t.settleRate;
        const settleW = (1 - smoothstep(0.35, 0.85, horizSpeed)) * ankleW * traction;
        fx += (this.feetMid.x - hips.p.x) * totalMass * settleW * dt;
        fz += (this.feetMid.z - hips.p.z) * totalMass * settleW * dt;
      }

      // If tripping over low cover, reduce braking so upper torso pitches cleanly over the barrier.
      if (this.trippingOverCover) {
        fx *= 0.25;
        fz *= 0.25;
      }

      const fLen = Math.hypot(fx, fz);
      if (fLen > maxFriction && fLen > 1e-6) {
        const s = maxFriction / fLen;
        fx *= s;
        fz *= s;
      }
      // Keep impulse bounded by hips mass stability so single substep never overshoots.
      const maxHipsStep = hips.mass * 2.2;
      const hLen = Math.hypot(fx, fz);
      if (hLen > maxHipsStep && hLen > 1e-6) {
        const s = maxHipsStep / hLen;
        fx *= s;
        fz *= s;
      }
      impulseX = fx;
      impulseZ = fz;
    }

    _v0.set(impulseX, impulseY, impulseZ);
    if (Number.isFinite(_v0.x + _v0.y + _v0.z)) hips.body.applyImpulse(_v0, true);

    // --- C. Soft Pelvis Upright / Momentum-Lean Torque ---
    // Desired pelvis orientation: yaw along facing, leaning subtly with velocity & toward buckled leg.
    const fwdX = Math.sin(this.facingYaw);
    const fwdZ = Math.cos(this.facingYaw);
    const leftX = Math.cos(this.facingYaw);
    const leftZ = -Math.sin(this.facingYaw);
    const vFwd = this.comVel.x * fwdX + this.comVel.z * fwdZ;
    const vLeft = this.comVel.x * leftX + this.comVel.z * leftZ;

    // Pitch gently with velocity, forward when tripped or gut-curled.
    let targetPitch = clamp(vFwd * 0.065, -t.maxVelLean, t.maxVelLean) + this.gutCurl * 0.28 + (this.trippingOverCover ? 0.35 : 0);
    // Roll gently with lateral shove + strongly toward shot/buckled leg or sideways death crumple.
    let buckleRoll = 0;
    for (const leg of this.legs) buckleRoll += leg.side * (leg.shock * 0.28 + (1 - leg.hip.muscle!.strength) * 0.22);
    let crumpleRoll = 0;
    if (dying && support < t.crumpleBelow) {
      const cFrac = 1 - support / t.crumpleBelow;
      crumpleRoll = this.crumpleSide * cFrac * 0.65;
      targetPitch -= cFrac * 0.22;
    }
    const targetRoll = clamp(-vLeft * 0.065 - buckleRoll - crumpleRoll, -0.75, 0.75);

    _q0.setFromAxisAngle(Y_AXIS, this.facingYaw);
    _q1.setFromAxisAngle(X_AXIS, targetPitch);
    _q0.multiply(_q1);
    _q1.setFromAxisAngle(_v1.set(0, 0, 1), targetRoll);
    _q0.multiply(_q1);

    // Shortest-arc rotation error from current hips.q to target _q0.
    _q1.copy(hips.q).conjugate().premultiply(_q0);
    if (_q1.w < 0) _q1.set(-_q1.x, -_q1.y, -_q1.z, -_q1.w);
    const sinHalf = Math.hypot(_q1.x, _q1.y, _q1.z);
    if (sinHalf > 1e-5) {
      const ang = 2 * Math.atan2(sinHalf, _q1.w);
      const ax = _q1.x / sinHalf;
      const ay = _q1.y / sinHalf;
      const az = _q1.z / sinHalf;
      const orientStrength = effSupport * (1 - yielded * 0.75);
      const ki = this.muscle.bodyInertia * t.uprightRate * t.uprightRate * orientStrength;
      const di = this.muscle.bodyInertia * 2 * t.uprightDamping * t.uprightRate * orientStrength;
      const invI = 1 / Math.max(hips.mass * 0.018, 0.025);
      const spinScale = (0.75 * dt) / (1 + (di * dt + ki * dt * dt) * invI);
      hips.tau.x += (ki * ax * ang - di * hips.w.x) * spinScale;
      hips.tau.y += (ki * ay * ang - di * hips.w.y) * spinScale * 0.55; // softer yaw so shoulder shots twist naturally!
      hips.tau.z += (ki * az * ang - di * hips.w.z) * spinScale;
    }

    // --- D. Soft Chest Vestibular Stabilization (prevents braking deceleration from flinging torso over hips, yields on hit) ---
    if (this.spine) {
      const sp = this.spine;
      const spIdx = this.rag.parts.indexOf(sp);
      const spShock = spIdx >= 0 ? this.partShock[spIdx]! : 0;
      const spAuth = sp.muscle!.drive * effSupport * (1 - yielded * 0.85) * (1 - 0.85 * spShock);
      if (spAuth > 0.05) {
        sp.body.rotation(sp.q);
        sp.body.angvel(sp.w);
        // Target world chest orientation = hips target * spine local pose.
        _q2.copy(_q0).multiply(sp.muscle!.pose);
        _q1.copy(sp.q).conjugate().premultiply(_q2);
        if (_q1.w < 0) _q1.set(-_q1.x, -_q1.y, -_q1.z, -_q1.w);
        const sH = Math.hypot(_q1.x, _q1.y, _q1.z);
        if (sH > 1e-5) {
          const ang = 2 * Math.atan2(sH, _q1.w);
          const rate = 11.5;
          const k = sp.mass * 0.16 * rate * rate * spAuth;
          const d = sp.mass * 0.16 * 2.1 * rate * spAuth;
          const invI = 1 / Math.max(sp.mass * 0.08, 0.08);
          const sc = (0.85 * dt) / (1 + (d * dt + k * dt * dt) * invI);
          sp.tau.x += (k * (_q1.x / sH) * ang - d * sp.w.x) * sc;
          sp.tau.y += (k * (_q1.y / sH) * ang - d * sp.w.y) * sc * 0.35;
          sp.tau.z += (k * (_q1.z / sH) * ang - d * sp.w.z) * sc;
        }
      }
    }

    // --- E. Task-Space Swing-Foot Placement (Euphoria foot effector — active ONLY during swing, 0 on stance foot) ---
    if (this.swingLeg >= 0) {
      const leg = this.legs[this.swingLeg]!;
      const part = leg.knee ?? leg.hip;
      const swingAuth = leg.hip.muscle!.drive * (1 - leg.shock * 0.8) * effSupport;
      if (swingAuth > 0.08) {
        const s = smoothstep(0, 1, clamp(this.swingT));
        const arcH = (this.trippingOverCover ? 0.02 : t.swingArc) * this.scale;
        const baseY = lerp(this.swingStart.y, this.swingTarget.y, s);
        const peakLift = Math.max(this.swingStart.y, this.swingTarget.y) - baseY;
        const tx = lerp(this.swingStart.x, this.swingTarget.x, s);
        const ty = baseY + (arcH + peakLift * 0.4) * Math.sin(Math.PI * s);
        const tz = lerp(this.swingStart.z, this.swingTarget.z, s);

        part.body.translation(part.p);
        part.body.rotation(part.q);
        part.body.linvel(part.v);
        part.body.angvel(part.w);
        // World position & velocity of ankle point on shin.
        _v2.copy(leg.footAt).sub(part.com).applyQuaternion(part.q);
        _v3.copy(part.w).cross(_v2).add(part.v);
        _v4.copy(leg.footAt).applyQuaternion(part.q).add(part.p);
        const legMass = (part.mass + (part.parent?.mass ?? 0)) / 3;
        const rate = 19;
        const k = legMass * rate * rate * swingAuth;
        const d = legMass * 2.0 * rate * swingAuth;
        const sc = dt / (1 + (d * dt + k * dt * dt) / Math.max(legMass, 0.2));
        _v5.set((k * (tx - _v4.x) - d * _v3.x) * sc, (k * (ty - _v4.y) - d * _v3.y) * sc, (k * (tz - _v4.z) - d * _v3.z) * sc);
        if (Number.isFinite(_v5.x + _v5.y + _v5.z)) part.body.applyImpulseAtPoint(_v5, _v4, true);
      }
    }

    // --- F. Planted-Shoe Floor Grip (real rubber traction on grounded stance feet prevents ice-skating) ---
    for (let i = 0; i < this.legs.length; i++) {
      if (this.swingLeg === i) continue;
      const leg = this.legs[i]!;
      if (!leg.grounded) continue;
      const part = leg.knee ?? leg.hip;
      const grip = leg.hip.muscle!.drive * (1 - leg.shock * 0.75) * effSupport;
      if (grip <= 0.08) continue;
      part.body.translation(part.p);
      part.body.rotation(part.q);
      part.body.linvel(part.v);
      part.body.angvel(part.w);
      _v2.copy(leg.footAt).sub(part.com).applyQuaternion(part.q);
      _v3.copy(part.w).cross(_v2).add(part.v);
      _v4.copy(leg.footAt).applyQuaternion(part.q).add(part.p);
      const footSlip = Math.hypot(_v3.x, _v3.z);
      if (footSlip > 0.015) {
        const footMass = part.mass * 0.85;
        const maxGrip = t.shoeFriction * totalMass * 0.9 * gEff * grip * dt;
        const dampK = Math.min(footMass * 55 * grip * dt, footMass * 0.95);
        let gx = -_v3.x * dampK;
        let gz = -_v3.z * dampK;
        const gLen = Math.hypot(gx, gz);
        if (gLen > maxGrip && gLen > 1e-6) {
          gx *= maxGrip / gLen;
          gz *= maxGrip / gLen;
        }
        _v5.set(gx, 0, gz);
        if (Number.isFinite(_v5.x + _v5.z)) part.body.applyImpulseAtPoint(_v5, _v4, true);
      }
    }
  }

  private readCenterOfMass(): void {
    const parts = this.rag.parts;
    let x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0, m = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      p.body.translation(p.p);
      p.body.rotation(p.q);
      p.body.linvel(p.v);
      p.body.angvel(p.w);
      _v0.copy(p.com).applyQuaternion(p.q).add(p.p);
      x += _v0.x * p.mass;
      y += _v0.y * p.mass;
      z += _v0.z * p.mass;
      vx += p.v.x * p.mass;
      vy += p.v.y * p.mass;
      vz += p.v.z * p.mass;
      m += p.mass;
    }
    if (m > 0) {
      this.com.set(x / m, y / m, z / m);
      this.comVel.set(vx / m, vy / m, vz / m);
    }
  }

  private computeFootWorld(part: RagPart, footAt: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(footAt).applyQuaternion(part.q).add(part.p);
  }

  private raycastGround(x: number, fromY: number, z: number, maxDist: number): number | null {
    if (!this.physics) return 0;
    _v7.set(x, fromY, z);
    if (this.physics.raycastInto(_v7, DOWN, maxDist, CG.World, _ray)) return _ray.point.y;
    return null;
  }

  private updateFeetAndTerrain(): void {
    const t = BalancerTuning;
    const hips = this.rag.parts[0]!;
    let fx = 0, fz = 0, gSum = 0, gCount = 0;
    let lowestGrounded = Infinity;

    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i]!;
      this.computeFootWorld(leg.knee ?? leg.hip, leg.footAt, leg.footPos);
      fx += leg.footPos.x;
      fz += leg.footPos.z;
      const probeY = Math.max(hips.p.y, leg.footPos.y + 0.4 * this.scale);
      const hitY = this.raycastGround(leg.footPos.x, probeY, leg.footPos.z, 1.5 * this.scale);
      if (hitY !== null) {
        leg.groundY = hitY;
        leg.grounded = leg.footPos.y <= hitY + t.groundTol * this.scale;
        if (leg.grounded) {
          gCount++;
          gSum += hitY;
          lowestGrounded = Math.min(lowestGrounded, hitY);
        }
      } else {
        leg.grounded = false;
      }
      // Keep planted foot anchor updated to ground height while in double support.
      if (this.swingLeg !== i && leg.grounded) {
        leg.stanceTarget.y = leg.groundY + 0.04 * this.scale;
      }
    }

    if (this.legs.length > 0) {
      this.feetMid.set(fx / this.legs.length, this.groundY, fz / this.legs.length);
    }
    this.groundedCount = gCount;
    if (gCount > 0) {
      // Smoothly track terrain height (supports stairs/ramps without jitter).
      const targetG = gSum / gCount;
      this.groundY = lerp(this.groundY, targetG, 0.35);
    } else {
      const underHips = this.raycastGround(hips.p.x, hips.p.y, hips.p.z, 2.0 * this.scale);
      if (underHips !== null) this.groundY = underHips;
    }
  }

  private probeEnvironment(): void {
    const t = BalancerTuning;
    this.wallAhead = false;
    this.trippingOverCover = false;
    if (!this.physics) return;
    const speed = Math.hypot(this.comVel.x, this.comVel.z);
    if (speed < t.probeMinSpeed) return;

    const dirX = this.comVel.x / speed;
    const dirZ = this.comVel.z / speed;
    const hips = this.rag.parts[0]!;

    // Chest ray: detects walls / pillars to reach out & brace against.
    _v0.set(hips.p.x, hips.p.y + 0.32 * this.scale, hips.p.z);
    _v1.set(dirX, 0, dirZ);
    const chestHit = this.physics.raycastInto(_v0, _v1, t.wallProbe * this.scale, CG.World, _ray);
    if (chestHit) {
      this.wallAhead = true;
      this.wallPoint.copy(_ray.point);
      this.wallNormal.copy(_ray.normal);
      return;
    }

    // Shin ray (only when chest ray is clear!): detects railings, desks, low cover -> shin trip!
    _v0.set(this.com.x, this.groundY + 0.36 * this.scale, this.com.z);
    if (this.physics.raycastInto(_v0, _v1, t.shinProbe * this.scale, CG.World, _ray)) {
      this.trippingOverCover = true;
    }
  }

  private updateStepping(drive: CollapseDrive, dt: number, dying: boolean): void {
    const t = BalancerTuning;
    if (this.legs.length < 2) return;

    const speed = Math.hypot(this.comVel.x, this.comVel.z);
    const cpDx = this.capturePoint.x - this.feetMid.x;
    const cpDz = this.capturePoint.z - this.feetMid.z;
    const cpDist = Math.hypot(cpDx, cpDz);

    // Active swing leg progression.
    if (this.swingLeg >= 0) {
      const leg = this.legs[this.swingLeg]!;
      this.swingT += dt / Math.max(this.swingDuration, 0.12);
      // Dynamically refine landing target slightly in first half of swing as momentum changes.
      if (this.swingT < 0.5 && !this.swingOverLedge) {
        this.computeStepTarget(this.swingLeg, _v2);
        this.swingTarget.lerp(_v2, 0.25);
      }
      const landed = this.swingT >= 1 || (this.swingT >= 0.65 && leg.grounded && leg.footPos.y <= this.swingTarget.y + 0.08 * this.scale);
      if (landed) {
        const stepDist = Math.hypot(leg.footPos.x - this.swingStart.x, leg.footPos.z - this.swingStart.z);
        leg.stanceTarget.copy(leg.footPos);
        leg.stanceTarget.y = leg.groundY + 0.04 * this.scale;
        this.lastSwingLeg = this.swingLeg;
        this.swingLeg = -1;
        this.swingT = 0;
        if (stepDist > StandTuning.stepLength * this.scale) {
          this.totalSteps++;
          drive.stand?.footfall();
          (drive.anim as { onFootstep?: (() => void) | null }).onFootstep?.();
        }
        // Dying nervous system adds growing latency before next catch step.
        this.stepCooldown = dying ? t.dyingLatency * (1 - drive.support) : 0.025;
      }
      return;
    }

    // Double support: decide if CoM capture point requires a new catch step.
    if (this.stepCooldown > 0 || drive.support < 0.12) return;
    const needsStep = cpDist > t.stepTrigger * this.scale || speed > t.stepSpeedTrigger;
    if (!needsStep) return;

    // Choose swing leg: prefer alternating gait, biased toward the side of momentum & healthier leg.
    let pick = 1 - this.lastSwingLeg;
    if (this.totalSteps === 0) {
      const leftX = Math.cos(this.facingYaw);
      const leftZ = -Math.sin(this.facingYaw);
      const sideScore = cpDx * leftX + cpDz * leftZ;
      pick = sideScore >= 0 ? 0 : 1;
      // If picked leg is severely buckled while the other is healthy, hop with the healthy leg if moving fast.
      if (this.legs[pick]!.shock > 0.5 && this.legs[1 - pick]!.shock < 0.2) pick = 1 - pick;
    }

    const leg = this.legs[pick]!;
    const stance = this.legs[1 - pick]!;
    stance.stanceTarget.copy(stance.footPos);
    stance.stanceTarget.y = stance.groundY + 0.04 * this.scale;

    this.swingLeg = pick;
    this.swingT = 0;
    this.swingStart.copy(leg.footPos);
    this.swingOverLedge = !this.computeStepTarget(pick, this.swingTarget);

    // Faster steps for faster momentum, slower & heavier when dying or leg-wounded.
    const speedFactor = lerp(1.1, 0.72, clamp(speed / 4.5));
    const fatigueFactor = dying ? lerp(1.45, 1.0, drive.support) : 1 + leg.shock * 0.35;
    this.swingDuration = t.swingSeconds * speedFactor * fatigueFactor;

    // Tripping over low cover drains balance budget rapidly so torso pitches over the railing.
    if (this.trippingOverCover && drive.stand) {
      drive.stand.budget = Math.min(drive.stand.budget, 0.08);
    }
  }

  /** Computes terrain-raycasted foot landing target for `legIdx`. Returns false if over a ledge drop. */
  private computeStepTarget(legIdx: number, out: THREE.Vector3): boolean {
    const t = BalancerTuning;
    const leg = this.legs[legIdx]!;
    const hips = this.rag.parts[0]!;

    const speed = Math.hypot(this.comVel.x, this.comVel.z);
    const leftX = Math.cos(this.facingYaw);
    const leftZ = -Math.sin(this.facingYaw);

    // Base target: Capture Point + slight overshoot along travel + anatomical lateral stance width.
    let tx = this.capturePoint.x + leftX * leg.side * 0.14 * this.scale;
    let tz = this.capturePoint.z + leftZ * leg.side * 0.14 * this.scale;
    if (speed > 0.2) {
      tx += (this.comVel.x / speed) * t.stepOvershoot * this.scale;
      tz += (this.comVel.z / speed) * t.stepOvershoot * this.scale;
    }

    // Clamp stride reach from pelvis so legs never stretch unnaturally.
    const dx = tx - hips.p.x;
    const dz = tz - hips.p.z;
    const dist = Math.hypot(dx, dz);
    const maxR = t.maxStride * this.scale;
    if (dist > maxR && dist > 1e-6) {
      tx = hips.p.x + (dx / dist) * maxR;
      tz = hips.p.z + (dz / dist) * maxR;
    }

    // Stop short of walls so swing foot doesn't target inside solid geometry.
    if (this.wallAhead) {
      const toWallX = tx - this.wallPoint.x;
      const toWallZ = tz - this.wallPoint.z;
      const into = toWallX * this.wallNormal.x + toWallZ * this.wallNormal.z;
      if (into < 0.18 * this.scale) {
        const push = 0.18 * this.scale - into;
        tx += this.wallNormal.x * push;
        tz += this.wallNormal.z * push;
      }
    }

    const hitY = this.raycastGround(tx, hips.p.y + 0.35 * this.scale, tz, 1.55 * this.scale);
    if (hitY !== null) {
      out.set(tx, hitY + 0.04 * this.scale, tz);
      return true;
    }
    // No ground ahead (ledge/balcony drop): foot reaches into empty air.
    out.set(tx, hips.p.y - 1.15 * this.scale, tz);
    return false;
  }

  private writeJointTargets(drive: CollapseDrive, dying: boolean): void {
    const t = BalancerTuning;
    const hips = this.rag.parts[0]!;
    const invHipsQ = _q2.copy(hips.q).conjugate();

    // --- 1. Legs: Analytical 2-Bone IK in physical pelvis frame ---
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i]!;
      const isSwinging = this.swingLeg === i;
      if (isSwinging) {
        const s = smoothstep(0, 1, clamp(this.swingT));
        const arcH = (this.trippingOverCover ? 0.02 : t.swingArc) * this.scale;
        const baseY = lerp(this.swingStart.y, this.swingTarget.y, s);
        const peakLift = Math.max(this.swingStart.y, this.swingTarget.y) - baseY;
        _v0.set(
          lerp(this.swingStart.x, this.swingTarget.x, s),
          baseY + (arcH + peakLift * 0.4) * Math.sin(Math.PI * s),
          lerp(this.swingStart.z, this.swingTarget.z, s),
        );
      } else {
        // Stance leg holds planted anchor; if freshly shot/buckled, bend knee sharply downward!
        _v0.copy(leg.stanceTarget);
        if (leg.shock > 0.15) _v0.y += leg.shock * 0.22 * this.scale;
      }
      this.solveLegIK(leg, hips.p, invHipsQ, _v0, leg.shock);
    }

    // --- 2. Spine & Head: Counter-balance + gut curl + natural look-leveling ---
    if (this.spine) {
      // Counter-lean spine slightly against pelvis pitch/roll so head attempts to stabilize.
      _v0.set(0, 1, 0).applyQuaternion(hips.q); // pelvis world up
      const fwdX = Math.sin(this.facingYaw);
      const fwdZ = Math.cos(this.facingYaw);
      const leftX = Math.cos(this.facingYaw);
      const leftZ = -Math.sin(this.facingYaw);
      const pelvPitch = _v0.x * fwdX + _v0.z * fwdZ;
      const pelvRoll = _v0.x * leftX + _v0.z * leftZ;

      const dyingRamp = dying ? smoothstep(0, 0.25, this.dyingAge) : 0;
      const spinePitch = clamp(-pelvPitch * 0.45 + this.gutCurl * t.gutCurlAngle + 0.18 * dyingRamp, -0.45, 0.72);
      const spineRoll = clamp(pelvRoll * 0.4 + (dying && drive.support < t.crumpleBelow ? -this.crumpleSide * 0.28 : 0), -0.45, 0.45);
      _q0.setFromAxisAngle(X_AXIS, spinePitch);
      _q1.setFromAxisAngle(_v1.set(0, 0, 1), spineRoll);
      this.spine.muscle!.pose.copy(_q0).multiply(_q1);
    }
    if (this.head) {
      const dyingRamp = dying ? smoothstep(0, 0.25, this.dyingAge) : 0;
      const headPitch = clamp(lerp(-0.05, 0.35, dyingRamp) + this.gutCurl * 0.3, -0.35, 0.55);
      this.head.muscle!.pose.setFromAxisAngle(X_AXIS, headPitch);
    }

    // --- 3. Arms: Wall Bracing > Wound Clutching > Angular-Momentum Windmilling ---
    const chest = this.spine ?? hips;
    const chestUp = _v2.set(0, 1, 0).applyQuaternion(chest.q);
    const chestFwd = _v3.set(0, 0, 1).applyQuaternion(chest.q);
    const chestLeft = _v4.set(1, 0, 0).applyQuaternion(chest.q);
    const speed = Math.hypot(this.comVel.x, this.comVel.z);
    const urgency = clamp(speed / 2.5 + chest.w.length() * 0.28, 0, 1);

    let clutched = false;
    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i]!;
      // Priority 1: Wall Bracing — reach hand onto detected wall ahead!
      if (this.wallAhead && arm.shoulder.muscle!.strength > 0.35) {
        _v0.copy(this.wallPoint).addScaledVector(chestLeft, arm.side * 0.18 * this.scale);
        this.solveArmReach(arm, chest, chestLeft, chestFwd, chestUp, _v0);
        continue;
      }
      // Priority 2: Wound Clutching (dying torso/gut shot after human reaction delay, or gut curl while stumbling)
      const wantsClutch = !clutched && this.woundPart !== null && ((dying && this.dyingAge > 0.12) || this.gutCurl > 0.25)
        && (this.woundRegion === 'abdomen' || this.woundRegion === 'chest' || this.woundRegion === 'head')
        && arm.shoulder.muscle!.strength > 0.4;
      if (wantsClutch) {
        clutched = true;
        _v0.copy(this.woundLocal).applyQuaternion(this.woundPart!.q).add(this.woundPart!.p);
        this.solveArmReach(arm, chest, chestLeft, chestFwd, chestUp, _v0);
        continue;
      }
      // Priority 3: Angular-Momentum Windmilling (classic Euphoria arm balance reflex!)
      const wRate = 7.5 + urgency * 5.0;
      const wA = Math.sin(this.age * wRate + arm.phase);
      const wB = Math.cos(this.age * wRate * 0.72 + arm.phase);
      // Throw arm outward opposite to torso angular velocity to conserve angular momentum.
      _v5.copy(chest.w).cross(chestUp); // world direction chest top is falling toward
      _v0.copy(chestLeft).multiplyScalar(arm.side * (0.45 + 0.55 * urgency));
      _v0.addScaledVector(chestUp, (-0.55 + urgency * 0.65) + wA * 0.38 * urgency);
      _v0.addScaledVector(chestFwd, (0.25 + wB * 0.35 * urgency));
      _v0.addScaledVector(_v5, -0.45 * urgency);
      if (_v0.lengthSq() > 1e-6) _v0.normalize();
      this.aimArm(arm, chest, _v0, lerp(0.45, 0.85 + wA * 0.25, urgency));
    }
  }

  /** Singularity-free analytical 2-bone leg IK in pelvis local space. */
  private solveLegIK(leg: LegRig, hipsP: THREE.Vector3, invHipsQ: THREE.Quaternion, targetWorld: THREE.Vector3, shock: number): void {
    const L1 = leg.upperLen;
    const L2 = leg.lowerLen;

    // Foot target relative to hip socket in pelvis local space.
    _v1.copy(targetWorld).sub(hipsP).applyQuaternion(invHipsQ).sub(leg.hipOffset);
    const rawDist = _v1.length();
    const minD = Math.abs(L1 - L2) + 0.04 * this.scale;
    const maxD = L1 + L2 - 0.015 * this.scale;
    const d = clamp(rawDist, minD, maxD);
    if (rawDist > 1e-5) _v1.multiplyScalar(1 / rawDist);
    else _v1.set(0, -1, 0);

    // Law of cosines for knee bend & thigh lift angle.
    const cosKnee = clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1);
    let kneeBend = Math.PI - Math.acos(cosKnee);
    // Buckled/shot knee flexes extra so the leg visibly gives out.
    if (shock > 0.1) kneeBend = Math.min(2.1, kneeBend + shock * 0.95);
    const cosLift = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
    const hipLift = Math.acos(cosLift);

    // Forward anatomical knee pole (+Z in pelvis frame, slight outward splay).
    _v2.set(leg.side * 0.14, 0, 1).normalize();
    // Orthogonalize pole against foot direction _v1.
    _v2.addScaledVector(_v1, -_v2.dot(_v1));
    if (_v2.lengthSq() < 1e-6) _v2.set(0, 0, 1);
    else _v2.normalize();

    // Thigh unit direction (-Y local axis of thigh bone).
    _v3.copy(_v1).multiplyScalar(Math.cos(hipLift)).addScaledVector(_v2, Math.sin(hipLift)).normalize();
    // Local +Y = -thighDir; Local +Z = knee-bend forward vector perpendicular to thighDir.
    _v4.copy(_v3).negate(); // yAxis
    _v5.copy(_v2).multiplyScalar(Math.cos(hipLift)).addScaledVector(_v1, -Math.sin(hipLift)).normalize(); // zAxis
    _v6.crossVectors(_v4, _v5).normalize(); // xAxis (exact knee hinge axis!)
    _v5.crossVectors(_v6, _v4).normalize();

    _m0.makeBasis(_v6, _v4, _v5);
    leg.hip.muscle!.pose.setFromRotationMatrix(_m0);
    const km = leg.knee?.muscle;
    if (km) km.pose.setFromAxisAngle(km.hingeAxis, clamp(kneeBend, km.lo, km.hi));
  }

  private aimArm(arm: ArmRig, chest: RagPart, worldDir: THREE.Vector3, elbowBend: number): void {
    _v1.copy(worldDir).applyQuaternion(_q0.copy(chest.q).conjugate());
    if (_v1.z < -0.5) {
      _v1.z = -0.5;
      _v1.normalize();
    }
    arm.shoulder.muscle!.pose.setFromUnitVectors(arm.rest, _v1);
    const em = arm.elbow?.muscle;
    if (em) em.pose.setFromAxisAngle(em.hingeAxis, clamp(-elbowBend, em.lo, em.hi));
  }

  private solveArmReach(arm: ArmRig, chest: RagPart, left: THREE.Vector3, fwd: THREE.Vector3, up: THREE.Vector3, target: THREE.Vector3): void {
    const L1 = arm.upperLen;
    const L2 = arm.lowerLen;
    _v1.copy(target).sub(arm.shoulder.p);
    const d = clamp(_v1.length(), Math.abs(L1 - L2) + 0.02, L1 + L2 - 0.01);
    if (_v1.lengthSq() > 1e-6) _v1.normalize();
    else _v1.copy(fwd);
    const bend = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    const lean = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    _v6.copy(left).multiplyScalar(arm.side * 0.7).addScaledVector(fwd, -0.5).addScaledVector(up, -0.35);
    _v6.addScaledVector(_v1, -_v6.dot(_v1));
    if (_v6.lengthSq() > 1e-6) _v6.normalize();
    _v5.copy(_v1).multiplyScalar(Math.cos(lean)).addScaledVector(_v6, Math.sin(lean)).normalize();
    this.aimArm(arm, chest, _v5, bend);
  }

  private writeStrengthsAndGravity(drive: CollapseDrive, dying: boolean): void {
    const t = BalancerTuning;
    const mt = MuscleTuning;
    const parts = this.rag.parts;
    const g = this.rag.gravity;
    const support = drive.support;
    const u = drive.time / Math.max(drive.duration, 0.05);
    const stand = drive.stand;
    const upperBase = stand ? stand.upper : clamp(support * 1.1, 0, 0.85);

    let root: RagPart | null = null;
    let carriedOnHips = 0;
    let activeMass = 0;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const m = part.muscle!;
      const shockCut = 1 - t.shockDrop * this.partShock[i]!;
      if (!part.parent) {
        root = part;
        m.drive = support;
        continue;
      }

      let gFactor = 1;
      if (m.role === 'leg') {
        const legIdx = this.legs.findIndex(l => l.hip === part || l.knee === part);
        const leg = legIdx >= 0 ? this.legs[legIdx]! : null;
        const isSwinging = legIdx >= 0 && legIdx === this.swingLeg;
        const legShockCut = leg ? 1 - 0.82 * leg.shock : 1;
        let baseLeg: number;
        if (dying) {
          const lead = leg && leg.side === drive.weakLeg ? mt.weakLegLead : 0;
          baseLeg = fade(mt.legFade, u, lead);
        } else if (stand) {
          baseLeg = StandTuning.legDrive;
        } else {
          baseLeg = fade(mt.standFade.leg, u, leg && leg.side === drive.weakLeg ? mt.weakLegLead : 0);
        }
        m.drive = baseLeg * m.strength * shockCut * legShockCut;
        m.gain = isSwinging ? t.swingGain : t.stanceGain;
        // Stance legs keep FULL real gravity for genuine floor friction; actively swinging leg carries partial self-weight.
        gFactor = isSwinging ? (1 - 0.65 * m.drive) : 1;
      } else {
        let baseUpper: number;
        if (dying) {
          baseUpper = fade(m.role === 'head' ? mt.headFade : m.role === 'arm' ? mt.armFade : mt.spineFade, u, 0);
        } else if (stand) {
          // Spine keeps higher postural strength than arms/head so torso doesn't flop under gravity,
          // while localized `shockCut` still drops it to 15% on impact for dramatic bullet whip.
          baseUpper = m.role === 'spine' ? Math.max(upperBase, 0.72) : upperBase;
        } else {
          baseUpper = fade(m.role === 'head' ? mt.standFade.head : m.role === 'arm' ? mt.standFade.arm : mt.standFade.spine, u, 0);
        }
        m.drive = baseUpper * m.strength * shockCut;
        m.gain = m.role === 'spine' ? 2.4 : 1.0;
        if (m.role === 'spine') {
          // Spine muscles transmit vertical compression of the chest straight down into the pelvis:
          // total body weight in Rapier remains 100% real, while eliminating artificial 1-joint chest droop.
          const spineCarry = m.drive;
          gFactor = 1 - spineCarry;
          carriedOnHips += part.mass * spineCarry;
        } else {
          gFactor = 1 - 0.75 * m.drive;
        }
      }
      part.body.setGravityScale(g * gFactor, false);
      const isGroundedLeg = m.role === 'leg' && this.legs.some((l, idx) => (l.hip === part || l.knee === part) && idx !== this.swingLeg && l.grounded);
      if (!isGroundedLeg) activeMass += part.mass * gFactor;
    }

    if (root) {
      // Pelvis carries its own real gravity PLUS vertical trunk compression transmitted down the spine.
      const hipFactor = 1 + carriedOnHips / Math.max(root.mass, 0.5);
      root.body.setGravityScale(g * hipFactor, false);
      activeMass += root.mass * hipFactor;
    }
    this.activeGravityMass = activeMass;
  }
}
