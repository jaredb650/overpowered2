/**
 * Desert Raid (Mission 5) — Escort Gunships, Scripted Warthog Main Gate Breach,
 * Friendly Assault Squads & Scenic Town-Flattening Ending Cutscene.
 *
 * Implements `AirAndSquadsController` using real engine systems:
 *   - `ModelBuilder` / `ModelMaterials` / `Airframe` / `EngineSound` for twin desert gunships
 *   - `warthogModel` for the Section 2 A-10 gate breach and Section 6 twin strafing runs
 *   - `ctx.allies` (`AllySystem`) for 2 fast-roped friendly assault squads pushing 3 Warren lanes
 *   - `megaBlast` + `ctx.world.objects.damageExplosivesInRadius` / `nukeSweep` for flattening Surplus
 *   - `ctx.camera.setSeat` + `ui.cinema` (`ctx.hud.seat`) for cinematic framing & letterbox bars
 *
 * CRITICAL INVARIANT: Escort gunships NEVER attack freely during Approach, Wall Loop, or Warren.
 * They only fire weapons during the scripted Section 6 ending cutscene so destructible Surplus
 * remains intact for the player to fight through.
 */
import * as THREE from 'three';
import type { Ally, AllyType } from '../../allies';
import type { Ctx, EmitterHandle, SeatView } from '../../core/contracts';
import type {} from '../../core/gameplay';
import { clamp, damp, lerp, rand, smoothstep, TAU } from '../../core/math';
import { megaBlast, resetMegaBlasts } from '../../fx/recipes/megaBlast';
import { plate } from '../../progression/callins/ac130Model';
import {
  Airframe,
  EngineSound,
  type AirframeSpec,
  type EngineSoundPlan,
  type RotorSpec,
} from '../../progression/callins/airframe';
import { warthogModel } from '../../progression/callins/warthog';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import { hull } from '../../vehicles/loft';
import { DESERT_Z, MAIN_GATE } from '../../world/map/desert/plan';
import type { CampaignHud } from '../hud';
import type { MissionRunner } from '../runner';
import type { AirAndSquadsController } from './types';

// ---------------------------------------------------------------------------------------------
// Tuned Constants & Spatial Layout
// ---------------------------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const NOSE_OFFSET = 7.6;

/** Section 2 Warthog main gate breach timing (seconds). */
export const GATE_STRIKE = {
  duration: 3.8,
  fireStart: 1.22,
  fireEnd: 2.12,
  fireGap: 0.05,
  roarAt: 1.92,
  breachAt: 2.1,
  flareStart: 2.28,
  flareGap: 0.13,
  flareCount: 6,
  fov: 54,
} as const;

/** Section 3 gunship fast-rope drop timing & positions (just inside breached Main Gate). */
export const DROP_ZONE = {
  west: [-12, 9, 52] as const,
  east: [12, 9, 52] as const,
  hoverSeconds: 3.8,
  ropeDeployAt: 0.45,
  ropeRetractAt: 3.1,
  lowWashAltitude: 16,
} as const;

/** Section 6 scenic town-flattening ending cutscene timing (seconds). */
export const ENDING_CUTSCENE = {
  duration: 10.5,
  capturedDuration: 11.8,
  capturedPhase1End: 4.8,
  wave1End: 3.0,
  wave2End: 7.4,
  nukeSweepAt: 6.2,
  /** Sweeps Wall (z=+62), Warren, Pump Yard & High Terraces (z=-80..-144) while keeping Cargo Plane (z=-208..-266) intact. */
  nukeSweepCenter: [0, 0, -35] as const,
  nukeSweepRadius: 125,
} as const;

/** Gunship engine audio plan (uses existing helicopter rotor & turbine loops). */
const GUNSHIP_ENGINE_PLAN: EngineSoundPlan = {
  near: 45,
  far: 260,
  layers: [
    { id: 'heli_rotor_loop', volume: 0.55, pitch: 1.08 },
    { id: 'heli_turbine_loop', volume: 0.32, pitch: 1.02 },
  ],
};

// ---------------------------------------------------------------------------------------------
// Sculpted Twin Desert Raid Gunship Airframe (Desert Olive/Tan Livery, Open Doors, Rocket Pods)
// ---------------------------------------------------------------------------------------------

type GunshipMount = 'podLeft' | 'podRight' | 'ropeLeft' | 'ropeRight' | 'nose';
const ROPE_MOUNTS: readonly GunshipMount[] = ['ropeLeft', 'ropeRight'];

const TAN_HULL = '#8a7e5c';
const OLIVE_PANEL = '#5b6143';
const DARK_OLIVE = '#3b402e';
const CABIN_INT = '#2a2d24';
const STEEL = '#222628';
const GLASS = '#10181d';
const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];
const MAIN_ROTOR_RADIUS = 7.6;

function buildDesertGunship(b: ModelBuilder): void {
  // Open-door slab-sided troop/gunship cabin in desert olive/tan livery.
  const hw = 1.24;
  const floorY = -0.95;
  const roofY = 0.98;
  const backZ = -2.2;
  const frontZ = 2.4;
  const doorBack = -1.35;
  const doorFront = 1.65;
  const len = frontZ - backZ;
  const midZ = (frontZ + backZ) / 2;
  const h = roofY - floorY;
  const midY = (roofY + floorY) / 2;

  b.box(hw * 2, 0.14, len, DARK_OLIVE, { at: [0, floorY - 0.07, midZ] });
  b.box(hw * 2, 0.14, len, OLIVE_PANEL, { at: [0, roofY + 0.07, midZ] });
  b.box(hw * 2, h, 0.12, CABIN_INT, { at: [0, midY, backZ - 0.05] });
  b.box(hw * 2, h, 0.12, CABIN_INT, { at: [0, midY, frontZ + 0.05] });

  // Both side doors slid open so assault squads visibly fast-rope out.
  for (const s of [1, -1]) {
    b.box(0.1, h, frontZ - doorFront, TAN_HULL, { at: [s * (hw + 0.04), midY, (frontZ + doorFront) / 2] });
    b.box(0.1, h, doorBack - backZ, TAN_HULL, { at: [s * (hw + 0.04), midY, (doorBack + backZ) / 2] });
    b.box(0.12, 0.16, doorFront - doorBack, OLIVE_PANEL, { at: [s * (hw + 0.05), roofY - 0.06, (doorFront + doorBack) / 2] });
    b.box(0.15, 0.09, doorFront - doorBack, DARK_OLIVE, { at: [s * (hw + 0.05), floorY + 0.03, (doorFront + doorBack) / 2] });
    // Slid-back door panel & track rail.
    b.box(0.06, h - 0.28, 1.75, OLIVE_PANEL, { at: [s * (hw + 0.16), midY - 0.04, doorBack - 0.55] });
    b.box(0.05, 0.05, 4.2, STEEL, { at: [s * (hw + 0.14), roofY - 0.08, -0.1] });
    // Fast-rope bar cantilevered over each open door.
    b.cyl(0.04, 0.04, 0.7, 6, STEEL, { at: [s * (hw + 0.28), roofY - 0.14, 0.15], rot: [0, 0, Math.PI / 2] });
  }
  // Interior benches & warm amber cabin work light.
  b.box(0.65, 0.09, 2.8, DARK_OLIVE, { at: [0, -0.48, 0.15] });
  b.box(0.12, 0.72, 2.8, CABIN_INT, { at: [0, -0.1, 0.15] });
  b.glow(new THREE.BoxGeometry(0.18, 0.04, 0.42), '#ffb048', 2.0, { at: [0, roofY - 0.03, 0.2] });

  // Armored angled nose & dark tinted cockpit canopy.
  b.solid(hull([
    { z: 2.35, w: 1.26, top: 1.0, bottom: -1.04 },
    { z: 3.7, w: 1.08, top: 0.82, bottom: -0.98 },
    { z: 4.9, w: 0.78, top: 0.18, bottom: -0.88 },
    { z: 5.9, w: 0.34, top: -0.26, bottom: -0.68 },
  ]), TAN_HULL);
  b.solid(hull([
    { z: 2.45, w: 1.08, top: 1.06, bottom: 0.08 },
    { z: 3.65, w: 0.96, top: 0.88, bottom: -0.02 },
    { z: 4.55, w: 0.68, top: 0.28, bottom: -0.28 },
  ]), GLASS);
  b.box(0.06, 1.1, 0.06, OLIVE_PANEL, { at: [0, 0.42, 4.1], rot: [0.72, 0, 0] });

  // Chin FLIR sensor ball & under-nose turret housing.
  b.solid(new THREE.SphereGeometry(0.32, 10, 8), STEEL, { at: [0, -0.92, 5.2] });
  b.cyl(0.08, 0.1, 1.4, 8, STEEL, { at: [0, -1.16, 5.4], rot: ALONG_Z });
  b.glow(new THREE.CircleGeometry(0.14, 10), '#ffd080', 2.2, { at: [0, -0.92, 5.52] });

  // Stub wings with twin desert-olive rocket pods on each flank.
  for (const s of [1, -1]) {
    b.box(2.5, 0.14, 1.32, OLIVE_PANEL, { at: [s * 2.35, 0.18, 0.45], rot: [0, 0, s * -0.09] });
    b.box(0.09, 0.44, 0.9, TAN_HULL, { at: [s * 3.58, 0.04, 0.45] });
    for (const x of [2.15, 3.18]) {
      b.box(0.11, 0.34, 0.62, DARK_OLIVE, { at: [s * x, -0.08, 0.48] });
      b.cyl(0.28, 0.28, 1.85, 10, DARK_OLIVE, { at: [s * x, -0.46, 0.72], rot: ALONG_Z });
      b.cyl(0.24, 0.24, 0.05, 10, '#101214', { at: [s * x, -0.46, 1.65], rot: ALONG_Z });
    }
  }

  // Twin shoulder turbines & main rotor mast cowling.
  b.solid(hull([
    { z: -2.4, w: 0.56, top: 1.54, bottom: 1.02 },
    { z: -0.3, w: 0.92, top: 1.84, bottom: 1.02 },
    { z: 1.5, w: 0.84, top: 1.72, bottom: 1.02 },
    { z: 2.35, w: 0.42, top: 1.3, bottom: 1.02 },
  ]), OLIVE_PANEL);
  for (const s of [1, -1]) {
    b.cyl(0.32, 0.36, 2.5, 10, TAN_HULL, { at: [s * 0.92, 1.32, -0.15], rot: ALONG_Z });
    b.cyl(0.24, 0.3, 0.45, 10, STEEL, { at: [s * 0.92, 1.32, 1.25], rot: ALONG_Z });
    b.cyl(0.24, 0.17, 0.55, 10, STEEL, { at: [s * 0.98, 1.35, -1.62], rot: [Math.PI / 2 + 0.08, 0, s * 0.2] });
    b.glow(new THREE.CircleGeometry(0.16, 10), '#ff8a3a', 2.2, { at: [s * 1.04, 1.37, -1.92], rot: [0, Math.PI, 0] });
  }
  b.cyl(0.16, 0.2, 0.72, 8, STEEL, { at: [0, 2.12, 0.2] });

  // Tapered tail boom, swept vertical fin, and horizontal stabilizer.
  b.solid(hull([
    { z: -9.1, w: 0.16, top: 1.34, bottom: 0.92 },
    { z: -5.2, w: 0.34, top: 1.18, bottom: 0.42 },
    { z: -2.2, w: 1.24, top: 1.0, bottom: -1.04 },
  ]), TAN_HULL);
  b.solid(plate([[-8.5, 1.2], [-9.7, 1.2], [-10.35, 3.35], [-9.4, 3.35]], 0.16), OLIVE_PANEL, { at: [0.08, 0, 0], rot: [0, -Math.PI / 2, 0] });
  b.solid(plate([[-1.75, -8.1], [1.75, -8.1], [1.75, -8.85], [-1.75, -8.85]], 0.09), DARK_OLIVE, { at: [0, 1.12, 0], rot: [Math.PI / 2, 0, 0] });

  // Heavy desert landing skids.
  for (const s of [1, -1]) {
    b.cyl(0.06, 0.06, 4.9, 6, STEEL, { at: [s * 1.48, -1.56, 0.45], rot: ALONG_Z });
    b.box(0.08, 0.72, 0.12, DARK_OLIVE, { at: [s * 1.24, -1.24, 1.65], rot: [0, 0, s * 0.42] });
    b.box(0.08, 0.72, 0.12, DARK_OLIVE, { at: [s * 1.24, -1.24, -0.85], rot: [0, 0, s * 0.42] });
  }
}

function buildGunshipMainRotor(b: ModelBuilder): void {
  b.cyl(0.32, 0.38, 0.28, 10, DARK_OLIVE);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const mid = (MAIN_ROTOR_RADIUS + 0.32) / 2;
    b.box(0.42, 0.05, MAIN_ROTOR_RADIUS - 0.32, STEEL, {
      at: [Math.sin(a) * mid, 0.03, Math.cos(a) * mid],
      rot: [0.05, a, 0],
    });
  }
}

function buildGunshipTailRotor(b: ModelBuilder): void {
  b.cyl(0.12, 0.12, 0.2, 8, DARK_OLIVE, { rot: [0, 0, Math.PI / 2] });
  for (let i = 0; i < 2; i++) {
    b.box(0.03, 2.7, 0.19, STEEL, { rot: [(i * Math.PI) / 2, 0, 0] });
  }
}

function buildGunshipStrobes(b: ModelBuilder): void {
  // Warm amber anti-collision beacon + port red / starboard green wingtip nav lights.
  b.glow(new THREE.SphereGeometry(0.11, 6, 4), '#ffae38', 7, { at: [0, 3.4, -9.8] });
  b.glow(new THREE.SphereGeometry(0.09, 6, 4), '#ffae38', 6, { at: [0, -1.04, -2.1] });
  b.glow(new THREE.SphereGeometry(0.07, 6, 4), '#ff3526', 6, { at: [3.62, 0.2, 0.45] });
  b.glow(new THREE.SphereGeometry(0.07, 6, 4), '#38ff8c', 6, { at: [-3.62, 0.2, 0.45] });
}

const GUNSHIP_ROTORS: readonly RotorSpec[] = [
  { at: [0, 2.52, 0.2], axis: 'y', rate: 28, build: buildGunshipMainRotor, disc: MAIN_ROTOR_RADIUS },
  { at: [-0.22, 2.55, -9.8], axis: 'x', rate: 60, build: buildGunshipTailRotor, disc: 1.4 },
];

const DESERT_GUNSHIP_AIRFRAME: AirframeSpec<GunshipMount> = {
  name: 'desert_gunship',
  scale: 1.05,
  build: buildDesertGunship,
  rotors: GUNSHIP_ROTORS,
  mounts: {
    podLeft: [2.66, -0.46, 1.75],
    podRight: [-2.66, -0.46, 1.75],
    ropeLeft: [1.52, 0.78, 0.15],
    ropeRight: [-1.52, 0.78, 0.15],
    nose: [0, -1.16, 6.1],
  },
  strobe: { build: buildGunshipStrobes, period: 1.15, lit: 0.14 },
};

// ---------------------------------------------------------------------------------------------
// Balanced 4-Man Tactical Fireteam Roster & Stage Waypoints
// ---------------------------------------------------------------------------------------------

export type SquadStage = 'warren' | 'pumpyard' | 'terraces' | 'cave';
type SquadLane = 'west' | 'center' | 'east';

interface SquadBlueprint {
  readonly squad: 'alpha' | 'bravo';
  readonly lane: SquadLane;
  readonly type: AllyType;
  readonly dropOffset: readonly [number, number];
  readonly warrenPost: readonly [number, number];
  readonly pumpyardPost: readonly [number, number];
  readonly terracesPost: readonly [number, number];
  readonly cavePost: readonly [number, number];
}

/**
 * Balanced 4-soldier tactical fireteam (2 Alpha + 2 Bravo) providing flank/rear fire support
 * without solo-clearing the Warren, Pump Yard, or High Terraces. Holds outside the Salt Cave
 * perimeter during Section 6 so allies never enter the subterranean tunnels or Cargo Plane.
 */
export const SQUAD_POST_RADIUS = 8;

const SQUAD_BLUEPRINT: readonly SquadBlueprint[] = [
  // Squad Alpha (Gunship 1 — port drop at (-12, 0, 52))
  {
    squad: 'alpha',
    lane: 'west',
    type: 'rifleman',
    dropOffset: [-2.2, -1.0],
    warrenPost: [-22, 34],
    pumpyardPost: [-16, -14],
    terracesPost: [-18, -86],
    cavePost: [-16, -130],
  },
  {
    squad: 'alpha',
    lane: 'center',
    type: 'shotgunner',
    dropOffset: [1.4, -1.6],
    warrenPost: [-8, 30],
    pumpyardPost: [-6, -16],
    terracesPost: [-8, -90],
    cavePost: [-8, -134],
  },

  // Squad Bravo (Gunship 2 — starboard drop at (+12, 0, 52))
  {
    squad: 'bravo',
    lane: 'center',
    type: 'medic',
    dropOffset: [-1.4, -1.6],
    warrenPost: [8, 36],
    pumpyardPost: [6, -13],
    terracesPost: [8, -84],
    cavePost: [8, -128],
  },
  {
    squad: 'bravo',
    lane: 'east',
    type: 'rifleman',
    dropOffset: [2.2, -1.0],
    warrenPost: [22, 32],
    pumpyardPost: [16, -15],
    terracesPost: [18, -88],
    cavePost: [16, -132],
  },
];

/** Carpet-bombing targets across Surplus (Wall, Warren, Pump Yard & High Terraces) during Wave 2. */
interface BombEvent {
  readonly at: number;
  readonly pos: readonly [number, number, number];
  readonly radius: number;
  readonly damage: number;
  readonly kind: 'bomb' | 'mega';
  readonly scale: number;
}

const ENDING_BOMBS: readonly BombEvent[] = [
  // Rolling airstrike bombs across Wall watchtowers & outer Warren
  { at: 3.15, pos: [-56, 0, 60], radius: 28, damage: 4500, kind: 'bomb', scale: 2.0 },
  { at: 3.45, pos: [56, 0, 60], radius: 28, damage: 4500, kind: 'bomb', scale: 2.0 },
  // MegaBlast #1: West Wall & West Warren
  { at: 3.65, pos: [-34, 0, 42], radius: 56, damage: 99999, kind: 'mega', scale: 0.95 },
  { at: 3.95, pos: [-14, 0, 48], radius: 30, damage: 4500, kind: 'bomb', scale: 2.2 },
  { at: 4.25, pos: [16, 0, 46], radius: 30, damage: 4500, kind: 'bomb', scale: 2.2 },
  // MegaBlast #2: East Wall & East Warren
  { at: 4.55, pos: [34, 0, 34], radius: 56, damage: 99999, kind: 'mega', scale: 0.95 },
  { at: 4.85, pos: [-46, 0, 18], radius: 32, damage: 4800, kind: 'bomb', scale: 2.3 },
  { at: 5.15, pos: [44, 0, 12], radius: 32, damage: 4800, kind: 'bomb', scale: 2.3 },
  // MegaBlast #3: Central Warren heart
  { at: 5.4, pos: [0, 0, 12], radius: 62, damage: 99999, kind: 'mega', scale: 1.15 },
  { at: 5.65, pos: [-26, 0, -20], radius: 34, damage: 5000, kind: 'bomb', scale: 2.2 },
  { at: 5.9, pos: [26, 0, -24], radius: 34, damage: 5000, kind: 'bomb', scale: 2.2 },
  // MegaBlast #4: Pump Yard tanks & pipes
  { at: 6.15, pos: [0, 0, -38], radius: 58, damage: 99999, kind: 'mega', scale: 1.1 },
  // High Terraces ("The Perches") vertical watchtowers & canopy tiers — stays well south of Cargo Plane (z = -208..-266)
  { at: 6.45, pos: [-26, 3.6, -94], radius: 32, damage: 5000, kind: 'bomb', scale: 2.2 },
  { at: 6.7, pos: [26, 3.6, -96], radius: 32, damage: 5000, kind: 'bomb', scale: 2.2 },
  // MegaBlast #5: High Terraces central perch collapse
  { at: 6.95, pos: [0, 3.6, -118], radius: 52, damage: 99999, kind: 'mega', scale: 1.1 },
  { at: 7.22, pos: [-20, 3.6, -134], radius: 30, damage: 5000, kind: 'bomb', scale: 2.1 },
  { at: 7.36, pos: [20, 3.6, -134], radius: 30, damage: 5000, kind: 'bomb', scale: 2.1 },
];

/** Smoldering ruins columns emitted across Wall, Warren, Pump Yard & High Terraces during Wave 3. */
const RUIN_PLUMES: readonly (readonly [number, number, number])[] = [
  [-44, 0.5, 54],
  [44, 0.5, 54],
  [-24, 0.5, 32],
  [22, 0.5, 28],
  [0, 0.5, 14],
  [-18, 0.5, -14],
  [20, 0.5, -24],
  [0, 0.5, -40],
  [-24, 3.8, -96],
  [24, 3.8, -116],
  [0, 4.0, -132],
];

// ---------------------------------------------------------------------------------------------
// Internal State Types
// ---------------------------------------------------------------------------------------------

export type GunshipMode = 'idle' | 'escort' | 'drop' | 'overwatch' | 'ending';

interface GunshipUnit {
  readonly side: -1 | 1; // -1 = Gunship 1 (port/west), +1 = Gunship 2 (starboard/east)
  readonly frame: Airframe<GunshipMount>;
  readonly washRing: THREE.Mesh;
  readonly washMat: THREE.MeshBasicMaterial;
  readonly ropes: readonly THREE.Mesh[];
  readonly pos: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly forward: THREE.Vector3;
  roll: number;
  dustTimer: number;
  rocketTimer: number;
  leftPodNext: boolean;
}

interface SquadMember {
  readonly ally: Ally;
  readonly blueprint: SquadBlueprint;
  readonly currentPost: THREE.Vector3;
}

interface GateStrikeState {
  active: boolean;
  clock: number;
  breached: boolean;
  roared: boolean;
  nextShotAt: number;
  shotsFired: number;
  flaresFired: number;
  onBreached: (() => void) | null;
}

interface EndingState {
  active: boolean;
  clock: number;
  duration: number;
  quistCaptured: boolean;
  getConvoyPos: ((out: THREE.Vector3) => THREE.Vector3) | null;
  getQuistBedPos: ((out: THREE.Vector3) => THREE.Vector3) | null;
  getTruckYaw: (() => number) | null;
  onDone: (() => void) | null;
  nextStrafeAt: number;
  strafeStep: number;
  roarAPlayed: boolean;
  roarBPlayed: boolean;
  bombIdx: number;
  nukeSwept: boolean;
  plumeTimer: number;
  plumeIdx: number;
}

// ---------------------------------------------------------------------------------------------
// Scratch Vectors (allocation-free update loop)
// ---------------------------------------------------------------------------------------------

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _nose = new THREE.Vector3();
const _impact = new THREE.Vector3();
const _look = new THREE.Vector3();
const _convoy = new THREE.Vector3();
const _quistBed = new THREE.Vector3();
const _p1EndPos = new THREE.Vector3();
const _p2EndPos = new THREE.Vector3();
const _p1EndLook = new THREE.Vector3();
const _p2EndLook = new THREE.Vector3();
const _navPt = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------
// Controller Implementation
// ---------------------------------------------------------------------------------------------

export class DesertAirAndSquads implements AirAndSquadsController {
  private built = false;
  private materials: ModelMaterials | null = null;
  private gunships: GunshipUnit[] = [];
  private warthogA: THREE.Group | null = null;
  private warthogB: THREE.Group | null = null;
  private quistFillLight: THREE.PointLight | null = null;
  private readonly trails: EmitterHandle[] = [];
  private engineSound: EngineSound | null = null;
  private engineActive = false;

  private _gunshipMode: GunshipMode = 'idle';
  private escortClock = 0;
  private dropClock = 0;
  private anchorX = 0;
  private anchorZ: number = DESERT_Z.approachStart;

  private readonly squadMembers: SquadMember[] = [];
  private squadsDropped = false;
  private squadStage: SquadStage | null = null;
  private warrenPaceTimer = 0;
  private warrenPaceZ = 40;

  // Camera & letterbox override state (always cleanly restored on finish, clear, or reset).
  private readonly cutView: SeatView = {
    position: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    roll: 0,
    shake: 0.55,
  };
  private cameraOverrideActive = false;
  private parkedByUs = false;
  private holsteredByUs = false;
  private cinemaAttached = false;
  private megaBlastUsed = false;

  private readonly gateStrike: GateStrikeState = {
    active: false,
    clock: 0,
    breached: false,
    roared: false,
    nextShotAt: GATE_STRIKE.fireStart,
    shotsFired: 0,
    flaresFired: 0,
    onBreached: null,
  };

  private readonly ending: EndingState = {
    active: false,
    clock: 0,
    duration: ENDING_CUTSCENE.duration,
    quistCaptured: false,
    getConvoyPos: null,
    getQuistBedPos: null,
    getTruckYaw: null,
    onDone: null,
    nextStrafeAt: 0.25,
    strafeStep: 0,
    roarAPlayed: false,
    roarBPlayed: false,
    bombIdx: 0,
    nukeSwept: false,
    plumeTimer: 0,
    plumeIdx: 0,
  };

  constructor(
    private readonly ctx: Ctx,
    private readonly runner: MissionRunner,
    private readonly ui: CampaignHud,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Public State Getters
  // -------------------------------------------------------------------------------------------

  /** Number of living friendly raid soldiers currently on the ground. */
  get aliveFriendlies(): number {
    let count = 0;
    for (let i = 0; i < this.squadMembers.length; i++) {
      const a = this.squadMembers[i]!.ally;
      if (a.state !== 'dead' && a.body?.alive !== false) count++;
    }
    return count;
  }

  /** Current escort gunship operating mode (read-only telemetry/testing). */
  get gunshipMode(): GunshipMode {
    return this._gunshipMode;
  }

  /** True while the Section 2 Warthog main gate breach cut is active. */
  get isGateStrikeActive(): boolean {
    return this.gateStrike.active;
  }

  /** True while the Section 6 town-flattening ending cutscene is running. */
  get isEndingCutsceneActive(): boolean {
    return this.ending.active;
  }

  /** True while this controller owns the camera SeatView override. */
  get hasCameraOverride(): boolean {
    return this.cameraOverrideActive;
  }

  // -------------------------------------------------------------------------------------------
  // Public AirAndSquadsController API
  // -------------------------------------------------------------------------------------------

  /** Launch the two escort gunships flying low overhead with the convoy. */
  startEscort(): void {
    this.ensureBuilt();
    this.ctx.allies?.preload?.();
    this._gunshipMode = 'escort';
    this.escortClock = 0;

    const p = this.ctx.player?.position;
    this.anchorX = clamp(p ? p.x : 0, -40, 40);
    this.anchorZ = clamp(p ? p.z : DESERT_Z.approachStart, DESERT_Z.wallLine + 8, DESERT_Z.approachStart + 10);

    for (let i = 0; i < this.gunships.length; i++) {
      const g = this.gunships[i]!;
      g.pos.set(this.anchorX + g.side * 26, 21 + (g.side > 0 ? 1.5 : -1.0), this.anchorZ + 12);
      g.target.copy(g.pos);
      g.forward.set(0, 0, -1);
      g.roll = 0;
      g.frame.fly(g.pos, g.forward, 0);
      this.setRopesVisible(g, false);
    }

    this.startEngineLoop();
  }

  /** Execute the scripted Section 2 Warthog A-10 gate breach (short camera cut + gate destruction). */
  strikeMainGate(onBreached: () => void): void {
    this.ensureBuilt();
    if (this.gateStrike.active) {
      this.finishGateStrike(false);
    }

    const s = this.gateStrike;
    s.active = true;
    s.clock = 0;
    s.breached = false;
    s.roared = false;
    s.nextShotAt = GATE_STRIKE.fireStart;
    s.shotsFired = 0;
    s.flaresFired = 0;
    s.onBreached = onBreached;

    this.ctx.audio?.play?.('walkietalkie_fire');
    this.ctx.audio?.play?.('airstrike_activate');

    this.acquireCameraCut('WARTHOG 1-1 // MAIN GATE BREACH', GATE_STRIKE.fov);

    if (this.warthogA) {
      this.positionGateWarthog(0, this.warthogA);
      this.warthogA.visible = true;
      this.attachJetTrails(this.warthogA, GATE_STRIKE.duration);
    }

    this.updateGateStrikeCamera(0);
  }

  /** Hover gunships over the breached gate and drop the 4-man friendly fireteam into the Warren. */
  dropWarrenSquads(): void {
    this.ensureBuilt();
    if (this._gunshipMode === 'idle') {
      this.startEscort();
    }

    this._gunshipMode = 'drop';
    this.dropClock = 0;

    // Position dust & sound cue as gunships flare down inside the gate.
    this.ctx.audio?.play?.('walkietalkie_fire', { volume: 0.7 });

    if (this.squadsDropped) return;
    this.squadsDropped = true;

    const allies = this.ctx.allies;
    if (!allies) return;

    for (let i = 0; i < SQUAD_BLUEPRINT.length; i++) {
      const bp = SQUAD_BLUEPRINT[i]!;
      const zone = bp.squad === 'alpha' ? DROP_ZONE.west : DROP_ZONE.east;
      const rawSpawn = _v1.set(zone[0] + bp.dropOffset[0], 0, zone[2] + bp.dropOffset[1]);
      const spawnPos = this.snapToNav(rawSpawn, _v2).clone();

      const rawStage = _v3.set(bp.warrenPost[0], 0, Math.min(46, bp.warrenPost[1] + 10));
      const postPos = this.snapToNav(rawStage, _navPt).clone();

      const ally = allies.spawn(bp.type, spawnPos, postPos, SQUAD_POST_RADIUS, Math.PI);
      if (!ally) continue;

      // Detached so a stray squad toggle never pulls the fireteam off their flank cover posts.
      ally.detached = true;
      ally.order = 'post';
      ally.postRadius = SQUAD_POST_RADIUS;
      // Slightly lean HP so squads contribute flank fire and suffer authentic casualties without solo-clearing.
      if (ally.maxHealth > 0) {
        ally.maxHealth = Math.round(ally.maxHealth * 0.85);
        ally.health = ally.maxHealth;
      }

      this.squadMembers.push({
        ally,
        blueprint: bp,
        currentPost: postPos,
      });

      this.ctx.fx?.dust?.(spawnPos, UP, 1.3);
    }

    this.squadStage = 'warren';
    this.warrenPaceZ = 42;
    this.warrenPaceTimer = 0;
  }

  /** Advance friendly fireteam across Warren, Pump Yard, High Terraces, and Salt Cave perimeter overwatch. */
  advanceSquads(stage: SquadStage): void {
    this.squadStage = stage;
    const allies = this.ctx.allies;

    for (let i = 0; i < this.squadMembers.length; i++) {
      const m = this.squadMembers[i]!;
      if (m.ally.state === 'dead' || m.ally.body?.alive === false) continue;

      let coords: readonly [number, number];
      if (stage === 'warren') coords = m.blueprint.warrenPost;
      else if (stage === 'pumpyard') coords = m.blueprint.pumpyardPost;
      else if (stage === 'terraces') coords = m.blueprint.terracesPost;
      else coords = m.blueprint.cavePost;

      const rawTarget = _v1.set(coords[0], 0, coords[1]);
      const snapped = this.snapToNav(rawTarget, _v2);
      m.currentPost.copy(snapped);

      m.ally.post.copy(snapped);
      m.ally.postRadius = SQUAD_POST_RADIUS;
      m.ally.postYaw = Math.PI;
      m.ally.order = 'post';
      m.ally.thinkAt = 0;
      m.ally.patrolAt = 0;
      allies?.setOrder?.(m.ally, 'post');
    }

    if (stage === 'warren') {
      this.warrenPaceZ = 38;
      this.warrenPaceTimer = 0;
    }
  }

  /** Run the scenic town-flattening ending cutscene behind the retreating convoy (with cuffed Quist close-up if captured). */
  startEndingCutscene(
    getConvoyPos: (out: THREE.Vector3) => THREE.Vector3,
    quistCaptured: boolean,
    onDone: () => void,
    getQuistBedPos?: (out: THREE.Vector3) => THREE.Vector3,
    getTruckYaw?: () => number,
  ): void {
    this.ensureBuilt();
    if (this.gateStrike.active) this.finishGateStrike(false);
    if (this.ending.active) this.finishEndingCutscene(false);

    const e = this.ending;
    e.active = true;
    e.clock = 0;
    e.duration = quistCaptured ? ENDING_CUTSCENE.capturedDuration : ENDING_CUTSCENE.duration;
    e.quistCaptured = quistCaptured;
    e.getConvoyPos = getConvoyPos;
    e.getQuistBedPos = getQuistBedPos ?? null;
    e.getTruckYaw = getTruckYaw ?? null;
    e.onDone = onDone;
    e.nextStrafeAt = 0.28;
    e.strafeStep = 0;
    e.roarAPlayed = false;
    e.roarBPlayed = false;
    e.bombIdx = 0;
    e.nukeSwept = false;
    e.plumeTimer = 0;
    e.plumeIdx = 0;

    // Ensure gunships are airborne and ready to join Wave 2 bombing run.
    this._gunshipMode = 'ending';
    for (let i = 0; i < this.gunships.length; i++) {
      const g = this.gunships[i]!;
      this.setRopesVisible(g, false);
      g.rocketTimer = 0.15 + i * 0.18;
      if (!g.frame.root.visible) {
        g.pos.set(g.side * 58, 26, 48);
        g.forward.set(-g.side * 0.3, 0, -1).normalize();
        g.frame.fly(g.pos, g.forward, 0);
      }
    }
    this.startEngineLoop();

    const caption = quistCaptured
      ? 'SURPLUS // QUIST SECURED — LEVEL THE SITE'
      : 'SURPLUS // TARGET NEUTRALIZED — LEVEL THE SITE';
    this.acquireCameraCut(caption, quistCaptured ? 42 : 54);

    if (this.warthogA) {
      this.positionEndingWarthog(0, 0, this.warthogA);
      this.warthogA.visible = true;
      this.attachJetTrails(this.warthogA, ENDING_CUTSCENE.wave1End + 0.6);
    }
    if (this.warthogB) {
      this.positionEndingWarthog(0, 1, this.warthogB);
      this.warthogB.visible = true;
      this.attachJetTrails(this.warthogB, ENDING_CUTSCENE.wave1End + 0.8);
    }

    this.ctx.audio?.play?.('airstrike_activate', { volume: 1.0 });
    this.updateEndingCamera(0);
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    if (this.gateStrike.active) {
      this.updateGateStrike(dt);
    }

    if (this.ending.active) {
      this.updateEndingCutscene(dt);
    }

    if (this._gunshipMode !== 'idle') {
      this.updateGunships(dt);
    }

    if (this.squadStage === 'warren' && this.squadMembers.length > 0 && !this.ending.active) {
      this.updateWarrenSquadPacing(dt);
    }
  }

  clear(): void {
    this.releaseCameraCut();
    this.stopTrails();
    this.stopEngineLoop();

    this.gateStrike.active = false;
    this.gateStrike.onBreached = null;
    this.ending.active = false;
    this.ending.getConvoyPos = null;
    this.ending.getQuistBedPos = null;
    this.ending.getTruckYaw = null;
    this.ending.onDone = null;

    if (this.quistFillLight) {
      this.quistFillLight.intensity = 0;
      this.quistFillLight.visible = false;
    }

    this._gunshipMode = 'idle';
    this.escortClock = 0;
    this.dropClock = 0;

    if (this.warthogA) this.warthogA.visible = false;
    if (this.warthogB) this.warthogB.visible = false;

    for (let i = 0; i < this.gunships.length; i++) {
      const g = this.gunships[i]!;
      g.frame.hide();
      g.washRing.visible = false;
      this.setRopesVisible(g, false);
    }

    this.clearSquads();

    if (this.megaBlastUsed) {
      this.megaBlastUsed = false;
      resetMegaBlasts(this.ctx);
    }
  }

  reset(): void {
    this.clear();
  }

  // -------------------------------------------------------------------------------------------
  // Lazy Model & Visual Construction
  // -------------------------------------------------------------------------------------------

  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;

    const scene = this.ctx.render?.scene;
    if (!scene || typeof scene.add !== 'function') return;

    this.materials = this.createMaterials();

    const ropeGeo = new THREE.CylinderGeometry(0.055, 0.055, 1, 6);
    const ropeMat = new THREE.MeshStandardMaterial({ color: '#4d4638', roughness: 0.92, metalness: 0.05 });
    const ringGeo = new THREE.RingGeometry(2.4, 7.6, 28);
    ringGeo.rotateX(-Math.PI / 2);

    const sides: readonly (-1 | 1)[] = [-1, 1];
    for (const side of sides) {
      const frame = new Airframe(this.materials, scene, DESERT_GUNSHIP_AIRFRAME);
      const washMat = new THREE.MeshBasicMaterial({
        color: '#d8bc90',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const washRing = new THREE.Mesh(ringGeo, washMat);
      washRing.visible = false;
      washRing.position.set(0, 0.08, 0);
      scene.add(washRing);

      const ropeL = new THREE.Mesh(ropeGeo, ropeMat);
      const ropeR = new THREE.Mesh(ropeGeo, ropeMat);
      ropeL.visible = false;
      ropeR.visible = false;
      scene.add(ropeL);
      scene.add(ropeR);

      this.gunships.push({
        side,
        frame,
        washRing,
        washMat,
        ropes: [ropeL, ropeR],
        pos: new THREE.Vector3(side * 26, 22, DESERT_Z.approachStart),
        target: new THREE.Vector3(side * 26, 22, DESERT_Z.approachStart),
        forward: new THREE.Vector3(0, 0, -1),
        roll: 0,
        dustTimer: 0,
        rocketTimer: 0,
        leftPodNext: side < 0,
      });
    }

    this.warthogA = warthogModel(this.materials);
    this.warthogA.visible = false;
    scene.add(this.warthogA);

    this.warthogB = warthogModel(this.materials);
    this.warthogB.visible = false;
    scene.add(this.warthogB);

    // Warm golden key light over the convoy truck bed during the captured Quist close-up phase.
    this.quistFillLight = new THREE.PointLight('#ffbe6b', 0, 9, 2);
    this.quistFillLight.visible = false;
    scene.add(this.quistFillLight);
  }

  private createMaterials(): ModelMaterials {
    if (this.ctx.render?.materials && typeof this.ctx.render.materials.patch === 'function') {
      return new ModelMaterials(this.ctx);
    }
    // Minimal test fallback when render.materials is omitted.
    const fakeCtx = {
      render: {
        materials: {
          patch: <T extends THREE.MeshStandardMaterial>(m: T): T => m,
        },
      },
    } as unknown as Ctx;
    return new ModelMaterials(fakeCtx);
  }

  // -------------------------------------------------------------------------------------------
  // Escort Gunships Flight & Rotor-Wash
  // -------------------------------------------------------------------------------------------

  private updateGunships(dt: number): void {
    this.escortClock += dt;

    if (this._gunshipMode === 'drop') {
      this.dropClock += dt;
      if (this.dropClock >= DROP_ZONE.hoverSeconds) {
        this._gunshipMode = 'overwatch';
        for (const g of this.gunships) this.setRopesVisible(g, false);
      }
    }

    // Track player / raid column smoothly in escort mode.
    const p = this.ctx.player?.position;
    if (p && this._gunshipMode === 'escort') {
      const targetX = clamp(p.x, -44, 44);
      const targetZ = clamp(p.z, DESERT_Z.wallLine + 8, DESERT_Z.approachStart + 12);
      this.anchorX = damp(this.anchorX, targetX, 1.4, dt);
      this.anchorZ = damp(this.anchorZ, targetZ, 1.4, dt);
    }

    for (let i = 0; i < this.gunships.length; i++) {
      const g = this.gunships[i]!;
      g.frame.update(dt);

      if (this._gunshipMode === 'escort') {
        this.flyEscortGunship(g, dt);
      } else if (this._gunshipMode === 'drop') {
        this.flyDropGunship(g, dt);
      } else if (this._gunshipMode === 'overwatch') {
        this.flyOverwatchGunship(g, dt);
      } else if (this._gunshipMode === 'ending') {
        this.flyEndingGunship(g, dt);
      }

      this.updateRotorWash(g, dt);
    }

    if (this.engineSound && this.engineActive && this.gunships.length > 0) {
      // Average position of twin gunships for smooth spatial rotor ambience.
      _v1.set(0, 0, 0);
      for (const g of this.gunships) _v1.add(g.pos);
      _v1.multiplyScalar(1 / this.gunships.length);
      const listener = this.cameraOverrideActive ? this.cutView.position : this.ctx.player?.eye;
      if (listener) {
        const swell = this._gunshipMode === 'drop' ? 1.15 : this._gunshipMode === 'ending' ? 1.1 : 0.72;
        this.engineSound.update(_v1, swell, dt, listener);
      }
    }
  }

  /** Low flanking escort orbits (y = 18..24 m). STRICTLY PASSIVE — zero unscripted weapon fire. */
  private flyEscortGunship(g: GunshipUnit, dt: number): void {
    const t = this.escortClock;
    const phase = g.side < 0 ? 0 : Math.PI * 0.85;
    const lateral = g.side * (25 + Math.sin(t * 0.55 + phase) * 6.5);
    const leadZ = -14 + Math.cos(t * 0.42 + phase) * 14;
    const alt = 21 + Math.sin(t * 0.75 + phase) * 2.6; // stays in 18.4..23.6 m

    g.target.set(this.anchorX + lateral, alt, this.anchorZ + leadZ);
    this.steerGunship(g, dt, 2.2, true);
  }

  /** Hover low (y = 9 m) inside breached Main Gate with deployed fast-ropes & dust wash. */
  private flyDropGunship(g: GunshipUnit, dt: number): void {
    const zone = g.side < 0 ? DROP_ZONE.west : DROP_ZONE.east;
    const hoverBob = Math.sin(this.dropClock * 2.6 + g.side) * 0.35;
    const climbOut = smoothstep(DROP_ZONE.ropeRetractAt, DROP_ZONE.hoverSeconds, this.dropClock);

    g.target.set(
      zone[0] + g.side * climbOut * 8,
      zone[1] + hoverBob + climbOut * 11,
      zone[2] - climbOut * 6,
    );

    const prevX = g.pos.x;
    const prevZ = g.pos.z;
    g.pos.x = damp(g.pos.x, g.target.x, 4.2, dt);
    g.pos.y = damp(g.pos.y, g.target.y, 4.0, dt);
    g.pos.z = damp(g.pos.z, g.target.z, 4.2, dt);

    // Nose points north (-Z) slightly inward toward the Warren avenue while hovering.
    _dir.set(-g.side * 0.2, 0, -1).normalize();
    g.forward.lerp(_dir, clamp(dt * 2.4, 0, 1)).normalize();
    const vx = dt > 1e-4 ? (g.pos.x - prevX) / dt : 0;
    const vz = dt > 1e-4 ? (g.pos.z - prevZ) / dt : 0;
    const wantRoll = clamp(-vx * 0.025, -0.35, 0.35);
    g.roll = damp(g.roll, wantRoll, 4.0, dt);
    g.frame.fly(g.pos, g.forward, g.roll);

    // Show fast-ropes from open doors down to desert floor during drop window.
    const ropesOut = this.dropClock >= DROP_ZONE.ropeDeployAt && this.dropClock <= DROP_ZONE.ropeRetractAt;
    this.setRopesVisible(g, ropesOut);
    if (ropesOut) {
      const sway = Math.sin(this.dropClock * 6.2 + g.side) * 0.14;
      for (let r = 0; r < 2; r++) {
        g.frame.mount(ROPE_MOUNTS[r]!, _v1);
        const h = Math.max(1, _v1.y);
        const rope = g.ropes[r]!;
        rope.scale.set(1, h, 1);
        rope.position.set(_v1.x, h * 0.5, _v1.z);
        rope.rotation.set(sway * (r === 0 ? 1 : -0.8), 0, sway * 0.6 + vz * 0.005);
      }
    }
  }

  /** High passive perimeter overwatch around Surplus after squad drop. Zero unscripted attacks. */
  private flyOverwatchGunship(g: GunshipUnit, dt: number): void {
    const t = this.escortClock * 0.24 + (g.side < 0 ? 0 : Math.PI);
    const rx = 68;
    const rz = 62;
    const alt = 30 + Math.sin(t * 2.0 + g.side) * 2.5;
    g.target.set(Math.cos(t) * rx, alt, 10 + Math.sin(t) * rz);
    this.steerGunship(g, dt, 1.5, true);
  }

  /** Scripted Section 6 ending strike: gunships swoop low during Wave 2 firing rockets, then peel up in Wave 3. */
  private flyEndingGunship(g: GunshipUnit, dt: number): void {
    const t = this.ending.clock;
    const totalDur = Math.max(ENDING_CUTSCENE.wave2End + 0.5, this.ending.duration);
    if (t < ENDING_CUTSCENE.wave1End) {
      // Holding high on flanks waiting for Warthogs to clear.
      const waitK = smoothstep(0, ENDING_CUTSCENE.wave1End, t);
      g.target.set(g.side * lerp(72, 54, waitK), lerp(34, 24, waitK), lerp(52, 42, waitK));
      this.steerGunship(g, dt, 2.2, true);
    } else if (t < ENDING_CUTSCENE.wave2End) {
      // Wave 2 (3 -> 7.4 s): sweeping low rocket runs along Surplus & High Terraces flanks!
      const u = clamp((t - ENDING_CUTSCENE.wave1End) / (ENDING_CUTSCENE.wave2End - ENDING_CUTSCENE.wave1End), 0, 1);
      g.target.set(
        g.side * lerp(52, 34, Math.sin(u * Math.PI)),
        lerp(22, 19, Math.sin(u * Math.PI)),
        lerp(56, -118, u),
      );
      this.steerGunship(g, dt, 2.6, true);

      // Scripted rocket salvos into Surplus & High Terraces (staying south of Cargo Plane)!
      g.rocketTimer -= dt;
      if (g.rocketTimer <= 0) {
        g.rocketTimer = 0.42;
        this.fireEndingGunshipRocket(g, u);
      }
    } else {
      // Wave 3 (7.4 -> end): triumphant peel-out climb over the smoking ruins & intact Cargo Plane silhouette.
      const u = clamp((t - ENDING_CUTSCENE.wave2End) / (totalDur - ENDING_CUTSCENE.wave2End), 0, 1);
      g.target.set(
        g.side * lerp(48, 125, u),
        lerp(22, 58, u),
        lerp(-118, -165, u),
      );
      this.steerGunship(g, dt, 1.9, true);
    }
  }

  private fireEndingGunshipRocket(g: GunshipUnit, progress: number): void {
    g.leftPodNext = !g.leftPodNext;
    g.frame.mount(g.leftPodNext ? 'podLeft' : 'podRight', _v1);
    const targetZ = lerp(52, -124, progress) + rand(-10, 10);
    const targetX = g.side * rand(4, 38);
    _impact.set(targetX, targetZ < -75 ? 3.6 : 0.5, targetZ);
    _dir.subVectors(_impact, _v1).normalize();

    this.ctx.fx?.muzzleFlash?.(_v1, _dir, 'rocket');
    this.ctx.fx?.tracer?.(_v1, _impact, 'hellfire');
    this.ctx.fx?.explosion?.(_impact, { radius: 9, kind: 'rocket', scale: 1.5 });
    this.ctx.audio?.play?.('rocket_fire', { position: _v1, volume: 0.75, pitch: rand(0.95, 1.1) });
    this.ctx.audio?.play?.('rocket_explosion', { position: _impact, volume: 0.85 });
    this.ctx.world?.objects?.damageExplosivesInRadius?.(_impact, 22, 2400, 'airstrike');
  }

  private steerGunship(g: GunshipUnit, dt: number, rate: number, bankIntoTurn: boolean): void {
    const prevX = g.pos.x;
    const prevY = g.pos.y;
    const prevZ = g.pos.z;

    g.pos.x = damp(g.pos.x, g.target.x, rate, dt);
    g.pos.y = damp(g.pos.y, g.target.y, rate, dt);
    g.pos.z = damp(g.pos.z, g.target.z, rate, dt);

    _dir.set(g.pos.x - prevX, (g.pos.y - prevY) * 0.25, g.pos.z - prevZ);
    const speed = dt > 1e-4 ? _dir.length() / dt : 0;
    if (_dir.lengthSq() > 1e-5) {
      _dir.normalize();
      g.forward.lerp(_dir, clamp(dt * 3.0, 0, 1)).normalize();
    }

    let wantRoll = 0;
    if (bankIntoTurn && speed > 0.5) {
      // Cross horizontal forward & target direction for realistic helicopter banking.
      _v2.subVectors(g.target, g.pos).setY(0);
      if (_v2.lengthSq() > 0.25) {
        _v2.normalize();
        const turnCross = g.forward.x * _v2.z - g.forward.z * _v2.x;
        wantRoll = clamp(turnCross * 0.65, -0.42, 0.42);
      }
    }
    g.roll = damp(g.roll, wantRoll, 3.2, dt);
    g.frame.fly(g.pos, g.forward, g.roll);
  }

  private updateRotorWash(g: GunshipUnit, dt: number): void {
    const lowK = clamp(1 - (g.pos.y - 7) / (DROP_ZONE.lowWashAltitude - 7), 0, 1);
    if (lowK <= 0.01) {
      g.washRing.visible = false;
      return;
    }

    g.washRing.visible = true;
    g.washRing.position.set(g.pos.x, 0.08, g.pos.z);
    g.washRing.rotation.y = (g.washRing.rotation.y + dt * (2.5 + lowK * 4.0)) % TAU;
    const pulse = 0.92 + Math.sin(this.escortClock * 8 + g.side) * 0.1;
    const scale = lerp(0.8, 1.45, lowK) * pulse;
    g.washRing.scale.set(scale, 1, scale);
    g.washMat.opacity = lowK * 0.36;

    g.dustTimer -= dt;
    if (g.dustTimer <= 0) {
      g.dustTimer = lerp(0.28, 0.09, lowK);
      const a = rand(0, TAU);
      const r = rand(2.5, 7.5);
      _v1.set(g.pos.x + Math.cos(a) * r, 0.18, g.pos.z + Math.sin(a) * r);
      this.ctx.fx?.dust?.(_v1, UP, lerp(0.8, 1.8, lowK));
    }
  }

  private setRopesVisible(g: GunshipUnit, visible: boolean): void {
    for (let i = 0; i < g.ropes.length; i++) {
      g.ropes[i]!.visible = visible;
    }
  }

  private startEngineLoop(): void {
    if (this.engineActive) return;
    if (!this.ctx.audio || typeof this.ctx.audio.startLoop !== 'function') return;
    if (typeof this.ctx.audio.has === 'function' && !this.ctx.audio.has('heli_rotor_loop')) return;
    this.engineSound ??= new EngineSound(this.ctx, GUNSHIP_ENGINE_PLAN);
    this.engineSound.start(0.9);
    this.engineActive = true;
  }

  private stopEngineLoop(): void {
    if (!this.engineActive) return;
    this.engineSound?.stop(0.4);
    this.engineActive = false;
  }

  // -------------------------------------------------------------------------------------------
  // Section 2: Scripted Warthog Main Gate Breach
  // -------------------------------------------------------------------------------------------

  private updateGateStrike(dt: number): void {
    const s = this.gateStrike;
    s.clock += dt;

    if (this.warthogA) {
      this.positionGateWarthog(s.clock, this.warthogA);
    }

    // Screaming GAU-8 30 mm tracer curtain across the bulldozer blade.
    while (s.clock >= s.nextShotAt && s.nextShotAt <= GATE_STRIKE.fireEnd) {
      this.fireGateTracer(s.shotsFired++);
      s.nextShotAt += GATE_STRIKE.fireGap;
    }

    // Booming Warthog BRRRT / flyby roar right as shells hammer the blade.
    if (!s.roared && s.clock >= GATE_STRIKE.roarAt) {
      s.roared = true;
      this.ctx.audio?.play?.('warthog_flyby', { volume: 1.6 });
      this.ctx.camera?.addTrauma?.(0.45);
    }

    // Massive blast & bulldozer gate shatter at impact (~2.1 s).
    if (!s.breached && s.clock >= GATE_STRIKE.breachAt) {
      this.triggerGateBreachImpact();
    }

    // Countermeasure flares while pulling steeply skyward.
    while (
      s.flaresFired < GATE_STRIKE.flareCount &&
      s.clock >= GATE_STRIKE.flareStart + s.flaresFired * GATE_STRIKE.flareGap
    ) {
      s.flaresFired++;
      if (this.warthogA) {
        this.ctx.fx?.sparks?.(this.warthogA.position, _dir.set(0, -1, 0), 10, '#ffd9a0');
      }
    }

    this.updateGateStrikeCamera(s.clock);

    if (s.clock >= GATE_STRIKE.duration) {
      this.finishGateStrike(true);
    }
  }

  /** Diving A-10 trajectory from SW dawn sky (y = 65 -> 16 m over Main Gate -> steep NE breakaway). */
  private positionGateWarthog(t: number, jet: THREE.Group): void {
    this.gateWarthogPoint(t, jet.position);
    this.gateWarthogPoint(t + 0.05, _look);
    jet.lookAt(_look);
    // Dramatic bank away after the pass.
    const bank = smoothstep(GATE_STRIKE.breachAt + 0.05, GATE_STRIKE.duration - 0.3, t) * 0.78;
    jet.rotateZ(bank);
  }

  private gateWarthogPoint(t: number, out: THREE.Vector3): THREE.Vector3 {
    const u = clamp(t / GATE_STRIKE.duration, 0, 1);
    const x = lerp(-118, 122, u);
    const z = lerp(168, -56, u);
    // Swoop down from y = 65 to y = 16 at u ~= 0.59 (t ~= 2.24 s), then pull steeply skyward.
    const divePeak = 0.59;
    let y: number;
    if (u <= divePeak) {
      const k = 1 - u / divePeak;
      y = 16 + k * k * (65 - 16);
    } else {
      const k = (u - divePeak) / (1 - divePeak);
      y = 16 + k * k * (82 - 16);
    }
    return out.set(x, y, z);
  }

  private fireGateTracer(index: number): void {
    const { audio, fx } = this.ctx;
    const total = Math.max(1, Math.floor((GATE_STRIKE.fireEnd - GATE_STRIKE.fireStart) / GATE_STRIKE.fireGap));
    const u = clamp(index / total, 0, 1);
    const impactX = lerp(-MAIN_GATE.width * 0.46, MAIN_GATE.width * 0.46, u) + rand(-0.6, 0.6);
    const impactY = rand(1.1, MAIN_GATE.height * 0.72);
    _impact.set(MAIN_GATE.x + impactX, impactY, MAIN_GATE.z + 0.8);

    if (this.warthogA) {
      this.warthogA.getWorldDirection(_dir);
      _nose.copy(this.warthogA.position).addScaledVector(_dir, NOSE_OFFSET);
    } else {
      _nose.set(-40, 32, 108);
      _dir.subVectors(_impact, _nose).normalize();
    }

    fx?.muzzleFlash?.(_nose, _dir, 'autocannon');
    fx?.tracer?.(_nose, _impact, 'heavy');
    fx?.sparks?.(_impact, _v1.set(0, 0.4, 1).normalize(), 12, '#ffd480');
    fx?.burst?.(_impact, _v1.set(0, 0.3, 1).normalize(), 1.4);
    audio?.play?.('30mmshell_explode', { position: _impact, volume: 0.9 });
    if (index % 2 === 0) {
      audio?.play?.('30mmShell_flyBy', { position: _impact, volume: 0.75 });
    }
  }

  private triggerGateBreachImpact(): void {
    const s = this.gateStrike;
    s.breached = true;

    const { audio, camera, fx, render } = this.ctx;
    _v1.set(MAIN_GATE.x, 3.0, MAIN_GATE.z);
    _v2.set(MAIN_GATE.x, 0.05, MAIN_GATE.z);

    fx?.explosion?.(_v1, { radius: 14, kind: 'hellfire', scale: 2.3 });
    fx?.ring?.(_v1, UP, '#ffaa44', 26);
    fx?.sparks?.(_v1, UP, 44, '#ffe290');
    fx?.smoke?.(_v1, 0x3b2f26, 9.5, 2.8);
    fx?.embers?.(_v1, 48, 8);
    render?.lights?.flash?.(_v1, '#ff9a3c', 200, 100, 0.65);
    render?.decals?.add?.('scorch', _v2, UP, 14, 0);
    render?.post?.flash?.('#ffc072', 0.55, 0.28);
    render?.post?.chromatic?.(0.45, 0.3);
    audio?.play?.('hellfirerocket_explode', { position: _v1, volume: 1.25 });
    camera?.addTrauma?.(0.88);
    camera?.fovPunch?.(7.5, 0.32);

    const cb = s.onBreached;
    s.onBreached = null;
    cb?.();
  }

  private updateGateStrikeCamera(t: number): void {
    const u = smoothstep(0, 1, clamp(t / GATE_STRIKE.duration, 0, 1));
    // Oblique low-angle framing south-east of the Bulldozer Main Gate.
    this.cutView.position.set(lerp(24, 17, u), lerp(4.8, 6.6, u), lerp(88, 79, u));

    // Track from the diving Warthog silhouette in the SW dawn sky onto the Main Gate, then lift slightly with breakaway.
    const gateTarget = _v2.set(MAIN_GATE.x, 3.4, MAIN_GATE.z);
    if (this.warthogA && t < 1.35) {
      const blend = smoothstep(0.15, 1.35, t);
      _look.lerpVectors(this.warthogA.position, gateTarget, blend);
    } else if (this.warthogA && t > 2.55) {
      const pull = smoothstep(2.55, GATE_STRIKE.duration, t) * 0.45;
      _look.lerpVectors(gateTarget, this.warthogA.position, pull);
    } else {
      _look.copy(gateTarget);
    }

    this.aimCameraViewAt(_look);
  }

  private finishGateStrike(signalDone: boolean): void {
    const s = this.gateStrike;
    if (!s.active) return;

    // Guarantee onBreached fired if we finished normally without breaching (e.g. huge dt jump).
    if (signalDone && !s.breached) {
      this.triggerGateBreachImpact();
    }

    s.active = false;
    s.onBreached = null;
    if (this.warthogA) this.warthogA.visible = false;
    this.stopTrails();
    this.releaseCameraCut();

    if (signalDone) {
      this.runner.signal('dr:gate_breached');
    }
  }

  // -------------------------------------------------------------------------------------------
  // Section 3/4: Friendly Assault Squad Pacing & Cleanup
  // -------------------------------------------------------------------------------------------

  private updateWarrenSquadPacing(dt: number): void {
    this.warrenPaceTimer -= dt;
    if (this.warrenPaceTimer > 0) return;
    this.warrenPaceTimer = 1.6;

    const playerZ = this.ctx.player?.position?.z;
    if (playerZ === undefined) return;

    // Hold rear/flank cover ~10 m behind the player's northward advance so the fireteam supports without solo-clearing.
    const desiredZ = clamp(playerZ + 10, 8, 44);
    if (desiredZ >= this.warrenPaceZ - 3) return;
    this.warrenPaceZ = desiredZ;

    for (let i = 0; i < this.squadMembers.length; i++) {
      const m = this.squadMembers[i]!;
      if (m.ally.state !== 'up') continue;
      const laneOffset = i % 2 === 0 ? 2 : -2;
      const z = clamp(this.warrenPaceZ + laneOffset, 4, 46);
      const raw = _v1.set(m.blueprint.warrenPost[0], 0, z);
      const snapped = this.snapToNav(raw, _v2);
      m.currentPost.copy(snapped);
      m.ally.post.copy(snapped);
      m.ally.postRadius = SQUAD_POST_RADIUS;
      m.ally.thinkAt = 0;
    }
  }

  private clearSquads(): void {
    const allies = this.ctx.allies;
    for (let i = 0; i < this.squadMembers.length; i++) {
      allies?.dismiss?.(this.squadMembers[i]!.ally);
    }
    this.squadMembers.length = 0;
    this.squadsDropped = false;
    this.squadStage = null;
    this.warrenPaceTimer = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Section 6: Scenic Ending Cutscene — Flattening Surplus
  // -------------------------------------------------------------------------------------------

  private updateEndingCutscene(dt: number): void {
    const e = this.ending;
    e.clock += dt;
    const t = e.clock;

    // Wave 1 (0 -> 3 s): Twin Warthog gun runs raking Warren & outer wall left-to-right.
    if (t <= ENDING_CUTSCENE.wave1End + 0.35) {
      if (this.warthogA) this.positionEndingWarthog(t, 0, this.warthogA);
      if (this.warthogB) this.positionEndingWarthog(t, 1, this.warthogB);

      if (!e.roarAPlayed && t >= 1.1) {
        e.roarAPlayed = true;
        this.ctx.audio?.play?.('warthog_flyby', { volume: 1.45 });
        this.ctx.camera?.addTrauma?.(0.32);
      }
      if (!e.roarBPlayed && t >= 1.95) {
        e.roarBPlayed = true;
        this.ctx.audio?.play?.('warthog_flyby', { volume: 1.35, pitch: 0.94 });
        this.ctx.camera?.addTrauma?.(0.35);
      }

      while (t >= e.nextStrafeAt && e.nextStrafeAt <= ENDING_CUTSCENE.wave1End) {
        this.fireEndingStrafeRound(e.strafeStep++);
        e.nextStrafeAt += 0.095;
      }
    } else if (t <= ENDING_CUTSCENE.wave2End + 0.5) {
      // Wave 2 high-altitude bomber pass sweeping south-to-north over Surplus & High Terraces.
      if (this.warthogA) this.positionEndingBomber(t, 0, this.warthogA);
      if (this.warthogB) this.positionEndingBomber(t, 1, this.warthogB);
    } else {
      if (this.warthogA) this.warthogA.visible = false;
      if (this.warthogB) this.warthogB.visible = false;
    }

    // Wave 2 (3 -> 7.4 s): Airstrike bombers & Gunships carpet-bombing + megaBlast pressure waves.
    while (e.bombIdx < ENDING_BOMBS.length && t >= ENDING_BOMBS[e.bombIdx]!.at) {
      this.detonateEndingBomb(ENDING_BOMBS[e.bombIdx]!);
      e.bombIdx++;
    }

    // Sweeping structural collapse wave across Wall, Warren, Pump Yard & High Terraces (Cargo Plane stays intact!).
    if (!e.nukeSwept && t >= ENDING_CUTSCENE.nukeSweepAt) {
      e.nukeSwept = true;
      _v1.set(
        ENDING_CUTSCENE.nukeSweepCenter[0],
        ENDING_CUTSCENE.nukeSweepCenter[1],
        ENDING_CUTSCENE.nukeSweepCenter[2],
      );
      const objs = this.ctx.world?.objects;
      if (typeof objs?.nukeSweep === 'function') {
        objs.nukeSweep(_v1, ENDING_CUTSCENE.nukeSweepRadius);
      } else {
        objs?.destruction?.nukeSweep?.(_v1, ENDING_CUTSCENE.nukeSweepRadius);
      }
      objs?.damageExplosivesInRadius?.(_v1, ENDING_CUTSCENE.nukeSweepRadius, 99999, 'nuke');
      this.ctx.camera?.addTrauma?.(0.8);
      this.ctx.render?.post?.chromatic?.(0.55, 0.4);
    }

    // Wave 3 (7.4 s -> end): Smoke columns & embers rising across levelled ruins.
    if (t >= ENDING_CUTSCENE.wave2End - 0.4) {
      e.plumeTimer -= dt;
      if (e.plumeTimer <= 0) {
        e.plumeTimer = 0.14;
        const p = RUIN_PLUMES[e.plumeIdx % RUIN_PLUMES.length]!;
        e.plumeIdx++;
        _v1.set(p[0] + rand(-5, 5), p[1] + rand(1, 5), p[2] + rand(-5, 5));
        this.ctx.fx?.smoke?.(_v1, 0x262220, rand(6, 11), rand(2.2, 3.6));
        this.ctx.fx?.embers?.(_v1, 14, 7);
        this.ctx.fx?.flameLick?.(_v1, rand(2.2, 4.0), 0.75);
        if (e.plumeIdx % 3 === 0) {
          this.ctx.fx?.heatShimmer?.(_v1, 18, 2.0);
        }
      }
    }

    this.updateEndingCamera(t);

    if (t >= e.duration) {
      this.finishEndingCutscene(true);
    }
  }

  private positionEndingWarthog(t: number, idx: 0 | 1, jet: THREE.Group): void {
    const startT = idx === 0 ? 0.0 : 0.42;
    const span = 2.85;
    const u = clamp((t - startT) / span, 0, 1);
    const zLine = idx === 0 ? 54 : 20;

    const pt = (s: number, out: THREE.Vector3): THREE.Vector3 => {
      const x = lerp(-135, 145, s);
      const z = zLine + Math.sin(s * Math.PI) * (idx === 0 ? -12 : -18);
      const dip = Math.abs(s - 0.5) * 2;
      const y = (idx === 0 ? 18 : 22) + dip * dip * 38;
      return out.set(x, y, z);
    };

    jet.visible = true;
    pt(u, jet.position);
    pt(u + 0.03, _look);
    jet.lookAt(_look);
    jet.rotateZ(lerp(-0.22, 0.55, smoothstep(0.4, 0.95, u)));
  }

  private positionEndingBomber(t: number, idx: 0 | 1, jet: THREE.Group): void {
    const startT = ENDING_CUTSCENE.wave1End + 0.35 + idx * 0.45;
    const span = 3.8;
    const u = clamp((t - startT) / span, 0, 1);
    const laneX = idx === 0 ? -24 : 24;

    const pt = (s: number, out: THREE.Vector3): THREE.Vector3 => {
      const x = laneX + Math.sin(s * Math.PI) * (idx === 0 ? -10 : 10);
      const z = lerp(115, -165, s);
      const climb = smoothstep(0.65, 1, s) * 28;
      const y = 38 + idx * 5 + climb;
      return out.set(x, y, z);
    };

    jet.visible = true;
    pt(u, jet.position);
    pt(u + 0.03, _look);
    jet.lookAt(_look);
    jet.rotateZ((idx === 0 ? -1 : 1) * smoothstep(0.55, 1, u) * 0.45);
  }

  private fireEndingStrafeRound(step: number): void {
    const total = Math.max(1, Math.floor((ENDING_CUTSCENE.wave1End - 0.28) / 0.095));
    const u = clamp(step / total, 0, 1);
    const isFirst = step % 2 === 0;
    const jet = isFirst ? this.warthogA : this.warthogB;
    const zBand = isFirst ? DESERT_Z.wallLine - 4 : DESERT_Z.warrenMid + 4;

    _impact.set(lerp(-70, 70, u) + rand(-3, 3), rand(0.5, 4.0), zBand + rand(-8, 8));
    if (jet && jet.visible) {
      jet.getWorldDirection(_dir);
      _nose.copy(jet.position).addScaledVector(_dir, NOSE_OFFSET);
    } else {
      _nose.set(_impact.x - 32, 26, _impact.z + 18);
      _dir.subVectors(_impact, _nose).normalize();
    }

    this.ctx.fx?.muzzleFlash?.(_nose, _dir, 'autocannon');
    this.ctx.fx?.tracer?.(_nose, _impact, 'heavy');
    this.ctx.fx?.sparks?.(_impact, UP, 10, '#ffd684');
    this.ctx.fx?.explosion?.(_impact, { radius: 6, kind: 'shell', scale: 1.25 });
    this.ctx.audio?.play?.('30mmshell_explode', { position: _impact, volume: 0.78 });
    this.ctx.world?.objects?.damageExplosivesInRadius?.(_impact, 18, 1800, 'airstrike');
  }

  private detonateEndingBomb(ev: BombEvent): void {
    const { audio, camera, combat, fx, render, world } = this.ctx;
    _v1.set(ev.pos[0], ev.pos[1], ev.pos[2]);

    if (ev.kind === 'mega') {
      this.megaBlastUsed = true;
      // Visual shockwave dome + debris torus + fireball column + delayed pressure wave (cosmetic avoids harming parked convoy).
      megaBlast(this.ctx, _v1, ev.scale, { source: 'nuke', cosmetic: true });
      // Physically collapse every destructible shack, watchtower, wall panel & tank in radius.
      world?.objects?.damageExplosivesInRadius?.(_v1, ev.radius, ev.damage, 'nuke');
      // Clear any remaining Saltbloods inside Surplus without pushing/harming the retreating convoy.
      combat?.explode?.(_v1, {
        radius: ev.radius * 0.75,
        damage: 1600,
        kind: 'barrel',
        source: 'nuke',
        team: 'player',
        instakill: true,
        selfDamage: 0,
        playerPush: 0,
        shake: 0,
        worldObject: true,
      });
      camera?.addTrauma?.(0.75);
      camera?.fovPunch?.(6, 0.3);
      render?.post?.flash?.('#ffb868', 0.42, 0.25);
    } else {
      fx?.explosion?.(_v1, { radius: 14, kind: 'hellfire', scale: ev.scale });
      fx?.napalm?.(_v1, UP, 8, 1.0);
      fx?.smoke?.(_v1, 0x2d241e, 9, 2.8);
      fx?.embers?.(_v1, 32, 9);
      fx?.ring?.(_v1, UP, '#ff9838', 22);
      render?.lights?.flash?.(_v1, '#ff8628', 170, 95, 0.65);
      audio?.play?.('hellfirerocket_explode', { position: _v1, volume: 0.95 });
      world?.objects?.damageExplosivesInRadius?.(_v1, ev.radius, ev.damage, 'airstrike');
      camera?.addTrauma?.(0.32);
    }
  }

  private resolveQuistBedWorld(convoy: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const e = this.ending;
    if (e.getQuistBedPos) {
      return e.getQuistBedPos(out);
    }
    const yaw = e.getTruckYaw ? e.getTruckYaw() : Math.PI;
    // Matches middle convoy truck bed mount (0.56, 1.05, 2.22) + seated chest/head height (+0.50).
    const lx = 0.56;
    const ly = 1.55;
    const lz = 2.22;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    return out.set(
      convoy.x + lx * cosY + lz * sinY,
      convoy.y + ly,
      convoy.z - lx * sinY + lz * cosY,
    );
  }

  private updateEndingCamera(t: number): void {
    const e = this.ending;
    const duration = Math.max(1, e.duration);
    const u = smoothstep(0, 1, clamp(t / duration, 0, 1));
    const convoy = e.getConvoyPos
      ? e.getConvoyPos(_convoy)
      : _convoy.set(0, 0, lerp(DESERT_Z.convoyLoop + 10, DESERT_Z.approachStart, u));

    // Re-enforce camera seat ownership every frame so convoy/turret systems can never fight the cutscene camera.
    this.ctx.camera?.setSeat?.(this.cutView);

    if (e.quistCaptured) {
      const quistBed = this.resolveQuistBedWorld(convoy, _quistBed);
      // Place camera on Quist's own outer side of the truck bed (never across the central Mk 19 shield)
      // and slightly above the 2.34 m roll-cage bar so cuffed Quist + burning Surplus are 100% unobstructed.
      const outSide = quistBed.x >= convoy.x ? 1 : -1;
      const phase1End = ENDING_CUTSCENE.capturedPhase1End;
      const bob = Math.sin(t * 7.2) * 0.035 + Math.cos(t * 4.1) * 0.018;
      const p1Y = Math.max(convoy.y + 2.55, quistBed.y + 0.96);

      if (t <= phase1End) {
        // Phase 1 (0 -> 4.8 s): Close-up over-the-shoulder shot of cuffed Hadrek Quist looking north (-Z)
        // positioned cleanly forward of the exhaust stack & above the roll-cage bar so burning Surplus & Warthogs fill the skyline.
        const p1 = smoothstep(0, phase1End, t);
        this.cutView.position.set(
          quistBed.x + outSide * lerp(0.38, 0.62, p1),
          p1Y + bob,
          quistBed.z + lerp(1.25, 1.65, p1),
        );
        _look.set(quistBed.x, quistBed.y + 0.34, quistBed.z - lerp(1.4, 2.2, p1));
        this.ctx.camera?.setZoom?.(lerp(42, 45, p1));

        if (this.quistFillLight) {
          const fade = 1 - smoothstep(phase1End - 0.85, phase1End, t);
          this.quistFillLight.visible = fade > 0.02;
          this.quistFillLight.intensity = 2.8 * fade;
          this.quistFillLight.position.set(quistBed.x + outSide * 0.85, quistBed.y + 1.35, quistBed.z + 1.0);
        }
      } else {
        // Phase 2 (4.8 -> 11.8 s): C1-smooth crane-out from the truck bed to panoramic aerial chase,
        // framing Wall, Warren, Pump Yard, High Terraces & intact Cargo Plane on the far north ridge.
        const p2 = smoothstep(phase1End, duration, t);
        _p1EndPos.set(quistBed.x + outSide * 0.62, p1Y, quistBed.z + 1.65);
        _p2EndPos.set(convoy.x + 3.5, convoy.y + 16.0, convoy.z + 27.0);
        this.cutView.position.lerpVectors(_p1EndPos, _p2EndPos, p2);

        _p1EndLook.set(quistBed.x, quistBed.y + 0.34, quistBed.z - 2.2);
        _p2EndLook.set(0, 12.0, -80);
        _look.lerpVectors(_p1EndLook, _p2EndLook, smoothstep(0, 0.65, p2));
        this.ctx.camera?.setZoom?.(lerp(45, 62, p2));

        if (this.quistFillLight) {
          this.quistFillLight.intensity = 0;
          this.quistFillLight.visible = false;
        }
      }
    } else {
      if (this.quistFillLight) {
        this.quistFillLight.intensity = 0;
        this.quistFillLight.visible = false;
      }

      // Uncaptured ending (10.5 s): Smooth aerial chase behind the retreating convoy looking north over flattening Surplus.
      this.cutView.position.set(
        convoy.x + lerp(11, 4, u),
        convoy.y + lerp(9.5, 16.5, u),
        convoy.z + lerp(22, 32, u),
      );
      _look.set(0, lerp(7.0, 12.0, u), lerp(20, -80, u));
      this.ctx.camera?.setZoom?.(lerp(54, 62, u));
    }

    this.aimCameraViewAt(_look);
  }

  private finishEndingCutscene(signalDone: boolean): void {
    const e = this.ending;
    if (!e.active) return;

    // If stepped in one large jump in a test, ensure remaining bombs & nuke sweep still ran.
    if (signalDone) {
      while (e.bombIdx < ENDING_BOMBS.length) {
        this.detonateEndingBomb(ENDING_BOMBS[e.bombIdx]!);
        e.bombIdx++;
      }
      if (!e.nukeSwept) {
        e.nukeSwept = true;
        _v1.set(
          ENDING_CUTSCENE.nukeSweepCenter[0],
          ENDING_CUTSCENE.nukeSweepCenter[1],
          ENDING_CUTSCENE.nukeSweepCenter[2],
        );
        const objs = this.ctx.world?.objects;
        if (typeof objs?.nukeSweep === 'function') objs.nukeSweep(_v1, ENDING_CUTSCENE.nukeSweepRadius);
        else objs?.destruction?.nukeSweep?.(_v1, ENDING_CUTSCENE.nukeSweepRadius);
        objs?.damageExplosivesInRadius?.(_v1, ENDING_CUTSCENE.nukeSweepRadius, 99999, 'nuke');
      }
    }

    const done = e.onDone;
    e.active = false;
    e.getConvoyPos = null;
    e.getQuistBedPos = null;
    e.getTruckYaw = null;
    e.onDone = null;
    this._gunshipMode = 'overwatch';

    if (this.quistFillLight) {
      this.quistFillLight.intensity = 0;
      this.quistFillLight.visible = false;
    }

    if (this.warthogA) this.warthogA.visible = false;
    if (this.warthogB) this.warthogB.visible = false;
    this.stopTrails();
    this.releaseCameraCut();

    if (signalDone) {
      done?.();
      this.runner.signal('dr:ending_done');
    }
  }

  // -------------------------------------------------------------------------------------------
  // Shared Helpers (Camera Override, Trails, Nav Snapping)
  // -------------------------------------------------------------------------------------------

  private acquireCameraCut(caption: string, fov: number): void {
    const { camera, hud, player, weapons } = this.ctx;
    if (!this.cameraOverrideActive) {
      this.cameraOverrideActive = true;
      if (player && !player.parked && typeof player.park === 'function') {
        player.park(player.position);
        this.parkedByUs = true;
      } else {
        this.parkedByUs = false;
      }
      if (weapons && typeof weapons.setHolstered === 'function') {
        weapons.setHolstered(true);
        this.holsteredByUs = true;
      } else {
        this.holsteredByUs = false;
      }
      camera?.setSeat?.(this.cutView);
    }

    camera?.setZoom?.(fov);
    if (this.ui?.cinema && hud && typeof hud.seat === 'function') {
      hud.seat(this.ui.cinema);
      this.cinemaAttached = true;
    }
    this.ui?.caption?.(caption);
  }

  private releaseCameraCut(): void {
    if (!this.cameraOverrideActive) return;
    this.cameraOverrideActive = false;

    const { camera, hud, player, weapons } = this.ctx;
    camera?.setSeat?.(null);
    camera?.setZoom?.(null);

    if (this.cinemaAttached) {
      this.cinemaAttached = false;
      hud?.seat?.(null);
    }
    this.ui?.caption?.('');

    if (this.holsteredByUs) {
      this.holsteredByUs = false;
      weapons?.setHolstered?.(false);
    }
    if (this.parkedByUs) {
      this.parkedByUs = false;
      player?.unpark?.(0.6);
    }
  }

  private aimCameraViewAt(target: THREE.Vector3): void {
    _dir.subVectors(target, this.cutView.position);
    if (_dir.lengthSq() > 1e-8) {
      this.cutView.yaw = Math.atan2(-_dir.x, -_dir.z);
      this.cutView.pitch = Math.atan2(_dir.y, Math.hypot(_dir.x, _dir.z));
    }
    this.cutView.roll = 0;
    this.ctx.camera?.syncSeat?.();
  }

  private attachJetTrails(jet: THREE.Group, seconds: number): void {
    const fx = this.ctx.fx;
    if (!fx || typeof fx.attachEmitter !== 'function') return;
    for (const side of [-1.45, 1.45]) {
      this.trails.push(fx.attachEmitter(jet, 'smokeTrail', new THREE.Vector3(side, 1.05, -5.6), seconds));
    }
  }

  private stopTrails(): void {
    for (let i = 0; i < this.trails.length; i++) {
      this.trails[i]!.stop();
    }
    this.trails.length = 0;
  }

  private snapToNav(point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const nav = this.ctx.world?.nav;
    if (nav && typeof nav.nearest === 'function' && nav.nearest(point, 8, out)) {
      return out;
    }
    return out.copy(point);
  }
}
