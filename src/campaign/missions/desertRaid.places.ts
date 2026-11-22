/**
 * Marks, zones, doors, routes, and cutscenes for Mission 5 ("Desert Raid" — Surplus).
 *
 * Every coordinate derives directly from `src/world/map/desert/plan.ts` so map builders,
 * convoy splines, setpieces, and mission beats share one spatial contract.
 */
import {
  APPROACH_POSTS,
  CARGO_PLANE,
  DESERT_Z,
  MAIN_GATE,
  PUMP_YARD,
  WARREN_MINIGUN,
} from '../../world/map/desert/plan';
import type { Cutscene, DoorDef, Mark, Zone } from '../types';

export const MARKS: Readonly<Record<string, Mark>> = {
  // ---- Checkpoints ----
  approachStart: { at: [0, 0, DESERT_Z.approachStart], yaw: 0 },
  wallGate: { at: [0, 0, DESERT_Z.convoyLoop], yaw: 0 },
  warrenMid: { at: [0, 0, DESERT_Z.warrenSouth + 2], yaw: 0 },
  pumpEntry: { at: [0, 0, DESERT_Z.pumpSouth + 2], yaw: 0 },
  sewerExit: { at: [PUMP_YARD.sewerExitTop[0], PUMP_YARD.sewerExitTop[1], PUMP_YARD.sewerExitTop[2]], yaw: 0 },
  planeEntry: { at: [0, 0, DESERT_Z.planeForecourt], yaw: 0 },
  exfilPickup: {
    at: [CARGO_PLANE.forecourtExfilPos[0], CARGO_PLANE.forecourtExfilPos[1], CARGO_PLANE.forecourtExfilPos[2]],
    yaw: Math.PI,
  },

  // ---- Objectives, Landmarks & Optional Minigun ----
  mainGateObj: { at: [MAIN_GATE.x, 3.2, MAIN_GATE.z], yaw: 0 },
  warrenMinigun: { at: [WARREN_MINIGUN.pos[0], WARREN_MINIGUN.pos[1], WARREN_MINIGUN.pos[2]], yaw: WARREN_MINIGUN.yaw },
  waterTowerObj: { at: [PUMP_YARD.towerBase[0], 4, PUMP_YARD.towerBase[2]], yaw: 0 },
  sewerGrate: { at: [PUMP_YARD.sewerDropPos[0], PUMP_YARD.sewerDropPos[1], PUMP_YARD.sewerDropPos[2]], yaw: 0 },
  quistTail: { at: [CARGO_PLANE.quistCornerPos[0], CARGO_PLANE.quistCornerPos[1], CARGO_PLANE.quistCornerPos[2]], yaw: Math.PI },

  // ---- Section 1: Approach Lookout Posts ----
  lookoutWest: { at: [APPROACH_POSTS[0]!.x, 0, APPROACH_POSTS[0]!.z], yaw: APPROACH_POSTS[0]!.yaw },
  lookoutEast: { at: [APPROACH_POSTS[1]!.x, 0, APPROACH_POSTS[1]!.z], yaw: APPROACH_POSTS[1]!.yaw },
  lookoutNorth: { at: [APPROACH_POSTS[2]!.x, 0, APPROACH_POSTS[2]!.z], yaw: APPROACH_POSTS[2]!.yaw },

  // ---- Section 2: Wall Walkway Runners ----
  wallWest: { at: [-30, 0, DESERT_Z.wallWalkway], yaw: Math.PI },
  wallCenter: { at: [0, 0, DESERT_Z.wallWalkway], yaw: Math.PI },
  wallEast: { at: [30, 0, DESERT_Z.wallWalkway], yaw: Math.PI },

  // ---- Section 3: Warren Shanty Ambushes & Bounty Wave ----
  warrenShantyWest: { at: [-18, 0, 34], yaw: Math.PI },
  warrenShantyEast: { at: [18, 0, 28], yaw: Math.PI },
  warrenBountyWest: { at: [-24, 0, 8], yaw: Math.PI * 0.75 },
  warrenBountyEast: { at: [24, 0, 4], yaw: -Math.PI * 0.75 },
  warrenNorthLine: { at: [0, 0, -4], yaw: Math.PI },

  // ---- Section 4: Pump Yard Guards & Sewer Dark Ambushers ----
  pumpWest: { at: [-16, 0, -28], yaw: Math.PI },
  pumpEast: { at: [16, 0, -34], yaw: Math.PI },
  sewerMid: { at: [-8, PUMP_YARD.sewerFloorY, -46], yaw: Math.PI },
  sewerNorth: { at: [0, PUMP_YARD.sewerFloorY, -64], yaw: Math.PI },

  // ---- Section 5: Cargo Plane Heavy Welded-Armor Guards ----
  planeForecourtGuard: { at: [0, 0, -82], yaw: Math.PI },
  planeComp1: { at: [CARGO_PLANE.centerX, CARGO_PLANE.floorY, -95], yaw: Math.PI },
  planeComp2: { at: [CARGO_PLANE.centerX, CARGO_PLANE.floorY, -109], yaw: Math.PI },

  // ---- Ammo & Medkit Drops ----
  warrenDropAmmo: { at: [-8, 0, 42], yaw: 0 },
  warrenDropHealth: { at: [10, 0, 14], yaw: 0 },
  pumpDropAmmo: { at: [-10, 0, -20], yaw: 0 },
  sewerDropHealth: { at: [-10, PUMP_YARD.sewerFloorY, -38], yaw: 0 },
  planeDropAmmo: { at: [-8, 0, -78], yaw: 0 },
  planeDropHealth: { at: [8, 0, -78], yaw: 0 },
};

export const ZONES: Readonly<Record<string, Zone>> = {
  wallFront: { min: [-78, -2, DESERT_Z.wallLine + 1], max: [78, 16, 94] },
  warrenSouth: { min: [-68, -2, DESERT_Z.warrenMid], max: [68, 14, DESERT_Z.wallLine - 1] },
  warrenNorth: { min: [-68, -2, DESERT_Z.warrenNorth - 3], max: [68, 14, DESERT_Z.warrenMid] },
  pumpYard: { min: [-52, -2, DESERT_Z.pumpNorthGate - 4], max: [52, 16, DESERT_Z.pumpSouth + 2] },
  sewer: {
    min: [-24, PUMP_YARD.sewerFloorY - 2.5, DESERT_Z.sewerExit - 3],
    max: [20, PUMP_YARD.sewerFloorY + 4.2, DESERT_Z.sewerDrop + 6],
  },
  planeForecourt: { min: [-36, -1.5, DESERT_Z.planeRamp - 2], max: [36, 12, DESERT_Z.sewerExit + 10] },
  planeMid: {
    min: [-CARGO_PLANE.hullHalfW - 1.5, CARGO_PLANE.floorY - 1, CARGO_PLANE.door2Z + 0.5],
    max: [CARGO_PLANE.hullHalfW + 1.5, CARGO_PLANE.floorY + CARGO_PLANE.hullHeight + 1, CARGO_PLANE.door1Z - 0.5],
  },
  planeTail: {
    min: [-CARGO_PLANE.hullHalfW - 1.5, CARGO_PLANE.floorY - 1, DESERT_Z.planeEnd - 2],
    max: [CARGO_PLANE.hullHalfW + 1.5, CARGO_PLANE.floorY + CARGO_PLANE.hullHeight + 1, CARGO_PLANE.door2Z - 0.5],
  },
};

/** Solid sliding blast bulkheads inside the crashed Cargo Plane hull. */
export const DOORS: Readonly<Record<string, DoorDef>> = {
  'plane.door1': {
    at: [CARGO_PLANE.centerX, CARGO_PLANE.floorY, CARGO_PLANE.door1Z],
    yaw: 0,
    width: CARGO_PLANE.hullHalfW * 2 - 0.4,
    height: CARGO_PLANE.hullHeight - 0.6,
    kind: 'split',
    seconds: 0.7,
    start: 1,
    look: 'steelDark',
  },
  'plane.door2': {
    at: [CARGO_PLANE.centerX, CARGO_PLANE.floorY, CARGO_PLANE.door2Z],
    yaw: 0,
    width: CARGO_PLANE.hullHalfW * 2 - 0.4,
    height: CARGO_PLANE.hullHeight - 0.6,
    kind: 'split',
    seconds: 0.7,
    start: 1,
    look: 'steelDark',
  },
};

export const ROUTES: Readonly<Record<string, readonly string[]>> = {};

/** Brief dawn desert camera sweep toward Surplus and the crashed cargo plane on the horizon. */
export const CUTSCENES: Readonly<Record<string, Cutscene>> = {
  opening: {
    shots: [
      {
        from: [-28, 7.5, DESERT_Z.approachStart + 16],
        to: [20, 10, DESERT_Z.approachMid + 24],
        lookFrom: [0, 3, DESERT_Z.approachMid],
        lookTo: [0, 8, DESERT_Z.wallLine],
        seconds: 3.6,
        fov: 56,
        fadeIn: 0.7,
        caption: 'SURPLUS // DAWN RAID',
      },
      {
        from: [30, 17, DESERT_Z.wallLine + 44],
        to: [0, 12, DESERT_Z.approachStart - 12],
        lookFrom: [0, 10, DESERT_Z.planeRamp],
        lookTo: [0, 3.5, DESERT_Z.approachMid],
        seconds: 3.2,
        fov: 52,
        fadeOut: 0.35,
        caption: 'TARGET: HADREK QUIST — THE SALT KING',
      },
    ],
  },
};
