/**
 * Marks, zones, doors, routes, and cutscenes for Mission 5 ("Desert Raid" — Surplus).
 *
 * Every coordinate derives directly from `src/world/map/desert/plan.ts` so map builders,
 * convoy splines, setpieces, and all 8 mission beats share one spatial contract.
 */
import {
  APPROACH_POSTS,
  CARGO_PLANE,
  DESERT_Z,
  HIGH_TERRACES,
  MAIN_GATE,
  PUMP_YARD,
  SALT_CAVE,
  WALL_TOWERS,
  WARREN_MINIGUN,
} from '../../world/map/desert/plan';
import type { Cutscene, DoorDef, Mark, Zone } from '../types';

export const MARKS: Readonly<Record<string, Mark>> = {
  // ---- 8 Section Checkpoints ----
  approachStart: { at: [0, 0, DESERT_Z.approachStart], yaw: 0 },
  wallGate: { at: [0, 0, DESERT_Z.convoyLoop], yaw: 0 },
  warrenStart: { at: [0, 0, DESERT_Z.warrenSouth + 2], yaw: 0 },
  pumpEntry: { at: [0, 0, DESERT_Z.pumpSouth + 2], yaw: 0 },
  terracesStart: {
    at: [HIGH_TERRACES.sewerExitTop[0], HIGH_TERRACES.sewerExitTop[1], HIGH_TERRACES.sewerExitTop[2]],
    yaw: 0,
  },
  caveStart: {
    at: [SALT_CAVE.southMouth[0], SALT_CAVE.southMouth[1], SALT_CAVE.southMouth[2]],
    yaw: 0,
  },
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
  sewerExit: { at: [PUMP_YARD.sewerExitTop[0], PUMP_YARD.sewerExitTop[1], PUMP_YARD.sewerExitTop[2]], yaw: 0 },
  caveMouthObj: {
    at: [HIGH_TERRACES.caveEntrancePos[0], 2.5, HIGH_TERRACES.caveEntrancePos[2]],
    yaw: 0,
  },
  quistTail: { at: [CARGO_PLANE.quistCornerPos[0], CARGO_PLANE.quistCornerPos[1], CARGO_PLANE.quistCornerPos[2]], yaw: Math.PI },

  // ---- Section 1: Approach 4 Manned Lookout Posts ----
  lookoutPost1: { at: [APPROACH_POSTS[0]!.x, 0, APPROACH_POSTS[0]!.z], yaw: APPROACH_POSTS[0]!.yaw },
  lookoutPost2: { at: [APPROACH_POSTS[1]!.x, 0, APPROACH_POSTS[1]!.z], yaw: APPROACH_POSTS[1]!.yaw },
  lookoutPost3: { at: [APPROACH_POSTS[2]!.x, 0, APPROACH_POSTS[2]!.z], yaw: APPROACH_POSTS[2]!.yaw },
  lookoutPost4: { at: [APPROACH_POSTS[3]!.x, 0, APPROACH_POSTS[3]!.z], yaw: APPROACH_POSTS[3]!.yaw },

  // ---- Section 2: Elevated Wall Battlements (y = 3.6) & Watchtowers ----
  wallWestTop: { at: [-34, 3.6, DESERT_Z.wallWalkway], yaw: Math.PI },
  wallCenterTop: { at: [0, 3.6, DESERT_Z.wallWalkway], yaw: Math.PI },
  wallEastTop: { at: [34, 3.6, DESERT_Z.wallWalkway], yaw: Math.PI },
  wallTowersWest: { at: [WALL_TOWERS[1]!.x, 3.6, WALL_TOWERS[1]!.z - 1.5], yaw: Math.PI },
  wallTowersEast: { at: [WALL_TOWERS[4]!.x, 3.6, WALL_TOWERS[4]!.z - 1.5], yaw: Math.PI },

  // ---- Section 3: Warren Shantytown Wave 1 & Water Bounty Wave 2 ----
  warrenSouthPost: { at: [0, 0, 38], yaw: Math.PI },
  warrenWestRoof: { at: [-18, 3.6, 28], yaw: Math.PI },
  warrenEastAlley: { at: [18, 0, 26], yaw: Math.PI },
  warrenBountyWest: { at: [-24, 0, 8], yaw: Math.PI * 0.75 },
  warrenBountyEast: { at: [24, 3.6, 6], yaw: -Math.PI * 0.75 },
  warrenBountyNorth: { at: [0, 0, -4], yaw: Math.PI },

  // ---- Section 4: Pump Yard Surface & Extended 50 m Dark Storm Sewer ----
  pumpWest: { at: [-16, 0, -26], yaw: Math.PI },
  pumpEast: { at: [16, 0, -32], yaw: Math.PI },
  pumpTowerGuard: { at: [0, 0, -42], yaw: Math.PI },
  sewerSump: { at: [-10, PUMP_YARD.sewerFloorY, -38], yaw: Math.PI },
  sewerGallery: { at: [-4, PUMP_YARD.sewerFloorY, -54], yaw: Math.PI },
  sewerExitGuard: { at: [0, PUMP_YARD.sewerFloorY, -72], yaw: Math.PI },

  // ---- Section 5: High Terraces ("The Perches" — y = 0 / 3.6 / 7.2) ----
  terraceTowersLow: {
    at: [HIGH_TERRACES.towers[0]![0], HIGH_TERRACES.tier2Y, HIGH_TERRACES.towers[0]![2]],
    yaw: Math.PI,
  },
  terraceTentsMid: {
    at: [HIGH_TERRACES.tents[3]![0], HIGH_TERRACES.tier2Y, HIGH_TERRACES.tents[3]![2]],
    yaw: Math.PI,
  },
  terraceCourtyard: { at: [0, HIGH_TERRACES.tier1Y, -100], yaw: Math.PI },
  terraceUpperGuard: { at: [0, HIGH_TERRACES.tier3Y, -134], yaw: Math.PI },

  // ---- Section 6: Salt Cave ("The Cistern Tunnels" — floor y = -2.5) ----
  caveMouthGuard: { at: [0, SALT_CAVE.floorY, DESERT_Z.caveSouth - 10], yaw: Math.PI },
  caveChamberMain: {
    at: [SALT_CAVE.midChamber[0], SALT_CAVE.midChamber[1], SALT_CAVE.midChamber[2]],
    yaw: Math.PI,
  },
  caveExitAmbush: { at: [0, SALT_CAVE.floorY, DESERT_Z.caveNorth + 6], yaw: Math.PI },

  // ---- Section 7: Crashed Cargo Plane (Plane Canyon z = -208 -> -266) ----
  planeForecourtGuard: { at: [0, 0, DESERT_Z.planeForecourt - 5], yaw: Math.PI },
  planeBay1: { at: [CARGO_PLANE.centerX, CARGO_PLANE.floorY, CARGO_PLANE.rampZ - 8], yaw: Math.PI },
  planeBay2: { at: [CARGO_PLANE.centerX, CARGO_PLANE.floorY, CARGO_PLANE.door1Z - 7], yaw: Math.PI },
  planeTailGuard: { at: [CARGO_PLANE.centerX, CARGO_PLANE.floorY, CARGO_PLANE.door2Z - 4], yaw: Math.PI },

  // ---- Section 8: Exfil Escort Stragglers ----
  exfilStragglers: { at: [12, 0, DESERT_Z.planeForecourt - 4], yaw: -Math.PI * 0.65 },

  // ---- Ammo & Medkit Drops ----
  warrenDropAmmo: { at: [-8, 0, 42], yaw: 0 },
  warrenDropHealth: { at: [10, 0, 14], yaw: 0 },
  pumpDropAmmo: { at: [-10, 0, -20], yaw: 0 },
  pumpDropHealth: { at: [12, 0, -22], yaw: 0 },
  sewerDropHealth: { at: [-10, PUMP_YARD.sewerFloorY, -42], yaw: 0 },
  sewerDropAmmo: { at: [-2, PUMP_YARD.sewerFloorY, -62], yaw: 0 },
  terracesDropAmmo: { at: [-10, 0, -86], yaw: 0 },
  terracesDropHealth: { at: [10, 0, -88], yaw: 0 },
  terracesUpperAmmo: { at: [-8, HIGH_TERRACES.tier2Y, -122], yaw: 0 },
  caveDropAmmo: { at: [-6, 0, -150], yaw: 0 },
  caveDropHealth: { at: [6, 0, -150], yaw: 0 },
  caveMidHealth: { at: [6, SALT_CAVE.floorY, -182], yaw: 0 },
  planeDropAmmo: { at: [-8, 0, DESERT_Z.planeForecourt + 2], yaw: 0 },
  planeDropHealth: { at: [8, 0, DESERT_Z.planeForecourt + 2], yaw: 0 },

  // ---- Hidden Easter Egg Weapon Caches (no HUD beacons — reward off-path exploration) ----
  // 1. Piledriver .50 BMG: secluded far-east corner of the outer wall battlement walkway past East Side Gate (stairs at x = 70)
  secretPiledriver: { at: [72.5, 3.6, 58.8], yaw: Math.PI },
  // 2. Billhook (Flechette + Reflex): tucked inside far-west Warren shack (warren.shack.5)
  secretBillhook: { at: [-44, 0, 2], yaw: 0 },
  // 3. Flail MG42 Spec (Heavy Barrel, AP, Stock, EOTech Holo, Laser, 200rd Box, Lightened Bolt): behind NW Pump Yard water cistern
  secretFlail: { at: [-44, 0, -51], yaw: Math.PI * 0.5 },
  // 4. RGL Grenade Launcher: hidden behind Watchtower 0 in the shadowed SW canyon alcove right after emerging from the storm sewer
  secretRgl: { at: [-35, 0, -96], yaw: 0 },
};

export const ZONES: Readonly<Record<string, Zone>> = {
  wallFront: { min: [-78, -2, DESERT_Z.wallLine + 1], max: [78, 16, 94] },
  warrenSouth: { min: [-68, -2, DESERT_Z.warrenMid + 4], max: [68, 14, DESERT_Z.wallLine - 1] },
  warrenMid: { min: [-68, -2, DESERT_Z.warrenNorth + 12], max: [68, 14, DESERT_Z.warrenMid + 4] },
  pumpApproach: { min: [-58, -2, DESERT_Z.pumpSouth - 6], max: [58, 16, DESERT_Z.warrenNorth + 12] },
  pumpTrigger: { min: [-48, -2, DESERT_Z.pumpNorthGate + 4], max: [48, 16, DESERT_Z.sewerDrop] },
  sewer: {
    min: [-24, PUMP_YARD.sewerFloorY - 2.5, DESERT_Z.sewerExit - 3],
    max: [20, PUMP_YARD.sewerFloorY + 4.2, DESERT_Z.sewerDrop + 6],
  },
  terracesEntry: { min: [-36, -1.0, DESERT_Z.terracesSouth - 14], max: [36, 14, DESERT_Z.sewerExit + 2] },
  terraceMidZone: { min: [-54, -2, DESERT_Z.terracesNorth + 14], max: [54, 18, DESERT_Z.terracesMid + 8] },
  caveEntry: { min: [-26, -5, DESERT_Z.caveSouth - 8], max: [26, 14, DESERT_Z.terracesNorth] },
  caveMidZone: { min: [-30, SALT_CAVE.floorY - 2, DESERT_Z.caveNorth + 14], max: [30, 8, DESERT_Z.caveMid + 8] },
  planeForecourtZone: { min: [-36, -2, DESERT_Z.planeRamp - 2], max: [36, 14, DESERT_Z.caveNorth + 2] },
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
