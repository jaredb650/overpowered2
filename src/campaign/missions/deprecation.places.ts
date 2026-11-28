/**
 * Marks, zones, scripted doors, helicopter patrol routes, and cutscenes for Mission
 * **Deprecation** (`Form 7742-A`, map `openmind`).
 *
 * Every coordinate is derived directly from `src/world/map/openmind/plan.ts` so mission
 * objectives, spawns, checkpoints, and camera shots stay permanently aligned with map geometry.
 */
import {
  BOULEVARD,
  DATACENTER,
  ELEVATOR_SHAFT,
  LV,
  OFFICE,
  PARKOUR_GEOM,
  PLAYER_SPAWNS,
  TOWER_BY_ID,
  ZIPLINES,
} from '../../world/map/openmind/plan';
import type { Cutscene, DoorDef, Mark, Vec3, Zone } from '../types';

const T1 = TOWER_BY_ID.tower1;
const T2 = TOWER_BY_ID.tower2;
const T3 = TOWER_BY_ID.tower3;
const HQ = TOWER_BY_ID.hq;
const SPAWN0 = PLAYER_SPAWNS[0]!;
const CANYON_ZIP = ZIPLINES[0]!;
const HQ_ZIP = ZIPLINES[1]!;

/** Yaw facing from `from` toward `to` (0 = north / -Z, PI = south / +Z). */
function yawTo(from: Vec3, to: Vec3): number {
  return Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
}

export const MARKS: Readonly<Record<string, Mark>> = {
  // ---- Sections 1–2: Tower 1 Drop & Tower 2 Relay Deck ----
  start: { at: [SPAWN0.x, SPAWN0.y, SPAWN0.z], yaw: SPAWN0.yaw },
  't1.zipline': {
    at: [CANYON_ZIP.start[0], T1.y, CANYON_ZIP.start[2]],
    yaw: yawTo(CANYON_ZIP.start, CANYON_ZIP.end),
  },
  't1.guardA': { at: [-78, T1.y, -138], yaw: Math.PI * 0.45 },
  't1.guardB': { at: [-71, T1.y, -142], yaw: Math.PI * 0.4 },
  't2.landing': { at: [-2, T2.y, -110], yaw: Math.PI },
  't2.guardA': { at: [8, T2.y, -114], yaw: Math.PI * 0.65 },
  't2.guardB': { at: [10, T2.y, -102], yaw: Math.PI * 0.75 },
  't2.sniper': { at: [18, T2.y, -100], yaw: Math.PI * 0.8 },
  't2.chopper': { at: [14, T2.y + 18, -86], yaw: Math.PI },
  'chopper.p1': { at: [-24, T2.y + 19, -108], hold: 1.8 },
  'chopper.p2': { at: [24, T2.y + 20, -96], hold: 1.8 },
  'chopper.p3': { at: [26, T2.y + 19, -66], hold: 1.8 },
  'chopper.p4': { at: [-18, T2.y + 18, -76], hold: 1.8 },

  // ---- Section 3: Tower 3 — The Glass Run ----
  't3.start': { at: [0, T3.y, PARKOUR_GEOM.shutter.runupStartZ + 1], yaw: Math.PI },
  't3.shutter': { at: [PARKOUR_GEOM.shutter.x, PARKOUR_GEOM.shutter.y, PARKOUR_GEOM.shutter.z], yaw: Math.PI },
  // Open upper launch roof flanking the chimney exit (clear of the solid concrete chimney halves below!)
  't3.defenderA': { at: [-5.5, PARKOUR_GEOM.chimney.topY, -29.5], yaw: 0 },
  't3.defenderB': { at: [5.5, PARKOUR_GEOM.chimney.topY, -29.5], yaw: 0 },
  't3.launch': { at: [HQ_ZIP.start[0], PARKOUR_GEOM.chimney.topY, HQ_ZIP.start[2]], yaw: Math.PI },

  // ---- Section 4: 80th-Floor Executive Office & Mezzanine ----
  'office.entry': { at: [0, OFFICE.execY, OFFICE.curtainWall.z + 2], yaw: Math.PI },
  'office.thresher': { at: [-6, OFFICE.execY, -6], yaw: Math.PI },
  'office.guardA': { at: [-15.5, OFFICE.execY, 0], yaw: 0 },
  'office.guardB': { at: [9.0, OFFICE.execY, 2], yaw: 0 },
  'office.riot': { at: [4, OFFICE.execY, 8], yaw: 0 },
  'office.mezzA': { at: [-10, OFFICE.mezzY, 5], yaw: 0 },
  'office.mezzB': { at: [7, OFFICE.mezzY, 2], yaw: 0 },
  'office.lobby': {
    at: [OFFICE.serviceLobby.x0 + 4, OFFICE.mezzY, (OFFICE.serviceLobby.z0 + OFFICE.serviceLobby.z1) / 2],
    yaw: -Math.PI / 2,
  },

  // ---- Section 5: Rigged Service Elevator Drop ----
  'elev.lobby': { at: [OFFICE.serviceLobby.x0 + 5, ELEVATOR_SHAFT.topY, ELEVATOR_SHAFT.cz], yaw: -Math.PI / 2 },
  'elev.autocannon': { at: [OFFICE.serviceLobby.x0 + 3, ELEVATOR_SHAFT.topY, ELEVATOR_SHAFT.cz + 1.8], yaw: -Math.PI / 2 },
  'elev.cab': { at: [ELEVATOR_SHAFT.cx, ELEVATOR_SHAFT.topY, ELEVATOR_SHAFT.cz], yaw: Math.PI / 2 },
  'elev.qrfA': { at: [-3.5, OFFICE.mezzY, 4.5], yaw: -Math.PI / 2 },
  'elev.qrfB': { at: [2, OFFICE.mezzY, -3.5], yaw: -Math.PI / 2 },

  // ---- Section 6: Sub-Level 4 Compute Vault ----
  'vault.landing': { at: [13, DATACENTER.floorY, 1.5], yaw: Math.PI * 0.35 },
  'vault.core': { at: DATACENTER.airGapCore.center, yaw: Math.PI },
  'vault.guardA': { at: [-10, DATACENTER.floorY, -10], yaw: 0 },
  'vault.guardB': { at: [10, DATACENTER.floorY, -10], yaw: 0 },
  'vault.catwalkA': { at: [-12, DATACENTER.catwalkY, -10.5], yaw: Math.PI },
  'vault.catwalkB': { at: [12, DATACENTER.catwalkY, -10.5], yaw: Math.PI },
  'vault.sniper': { at: [0, DATACENTER.catwalkY, -10.5], yaw: Math.PI },

  // ---- Section 7: Breakout & Plaza Distraint Frame ----
  'vault.breach': { at: [0, DATACENTER.floorY, DATACENTER.breakoutRamp.z0 + 4], yaw: Math.PI },
  'plaza.frame': { at: BOULEVARD.plazaGarage.framePos, yaw: Math.PI },
  'plaza.guardA': { at: [8, LV.street, 38], yaw: Math.PI / 2 },
  'plaza.guardB': { at: [15, LV.street, 50], yaw: 0 },

  // ---- Section 8: Boss Stage 1 — Grand Boulevard ----
  'blvd.start': { at: [0, LV.street, 34], yaw: Math.PI },
  'blvd.troopW': { at: [-18, LV.street, 56], yaw: -Math.PI / 2 },
  'blvd.troopE': { at: [18, LV.street, 56], yaw: Math.PI / 2 },

  // ---- Section 9: Boss Stage 2 — Civic 4-Way Intersection ----
  'inter.start': { at: [0, LV.street, BOULEVARD.intersection.z0], yaw: Math.PI },
  'inter.guardW': { at: [-22, LV.street, BOULEVARD.intersection.center[2]], yaw: -Math.PI / 2 },
  'inter.guardE': { at: [22, LV.street, BOULEVARD.intersection.center[2]], yaw: Math.PI / 2 },

  // ---- Section 10: Boss Stage 3 — Civic Spire Plaza & Neural Core ----
  'spire.start': { at: [0, LV.street, BOULEVARD.spirePlaza.z0 - 6], yaw: Math.PI },
  'spire.orion': { at: [8, LV.street, BOULEVARD.spirePlaza.spireCenter[2] + 4], yaw: 0 },
  'spire.catwalkW': { at: [-20, BOULEVARD.spirePlaza.catwalkY, 144], yaw: -Math.PI / 2 },
  'spire.sub0': { at: BOULEVARD.spirePlaza.substations[0].pos },
  'spire.sub1': { at: BOULEVARD.spirePlaza.substations[1].pos },
  'spire.sub2': { at: BOULEVARD.spirePlaza.substations[2].pos },
};

export const ZONES: Readonly<Record<string, Zone>> = {
  'tower1.zipline': {
    min: [CANYON_ZIP.start[0] - 8, T1.y - 2, CANYON_ZIP.start[2] - 8],
    max: [CANYON_ZIP.start[0] + 8, T1.y + 8, CANYON_ZIP.start[2] + 8],
  },
  'tower2.deck': {
    min: [T2.x0 - 2, T2.y - 4, T2.z0 - 2],
    max: [T2.x1 + 2, T2.y + 12, T2.z1 + 2],
  },
  'tower3.runup': {
    min: [T3.x0 - 2, T3.y - 4, T3.z0 - 2],
    max: [T3.x1 + 2, T3.y + 14, PARKOUR_GEOM.shutter.z - 2],
  },
  'tower3.beyondShutter': {
    min: [T3.x0 - 2, T3.y - 2, PARKOUR_GEOM.shutter.z + 1],
    max: [T3.x1 + 2, PARKOUR_GEOM.chimney.topY + 6, T3.z1 + 2],
  },
  'tower3.launch': {
    min: [-6, PARKOUR_GEOM.chimney.topY - 2, T3.z1 - 6],
    max: [6, PARKOUR_GEOM.chimney.topY + 6, T3.z1 + 3],
  },
  'office.exec': {
    min: [HQ.x0 - 1, OFFICE.execY - 1.5, HQ.z0 - 1],
    max: [HQ.x1 + 1, OFFICE.execCeil + 2, HQ.z1 + 1],
  },
  'office.mezz': {
    min: [HQ.x0 - 1, OFFICE.mezzY - 1.5, HQ.z0 - 1],
    max: [HQ.x1 + 1, OFFICE.mezzCeil, HQ.z1 + 1],
  },
  'office.lobby': {
    min: [OFFICE.serviceLobby.x0 - 1, OFFICE.mezzY - 1, OFFICE.serviceLobby.z0 - 1],
    max: [ELEVATOR_SHAFT.x1 + 1, OFFICE.mezzCeil, OFFICE.serviceLobby.z1 + 1],
  },
  'vault.floor': {
    min: [DATACENTER.x0 - 1, DATACENTER.floorY - 2, DATACENTER.z0 - 1],
    max: [DATACENTER.x1 + 1, DATACENTER.floorY + 0.6, DATACENTER.z1 + 1],
  },
  'boulevard.plaza': {
    min: [-38, LV.garage - 2, BOULEVARD.z0],
    max: [42, 16, BOULEVARD.skybridge.z],
  },
  'boulevard.intersection': {
    min: [-38, -2, BOULEVARD.intersection.z0 - 4],
    max: [38, 18, BOULEVARD.intersection.z1 + 2],
  },
  'boulevard.spire': {
    min: [BOULEVARD.spirePlaza.x0, -2, BOULEVARD.spirePlaza.z0],
    max: [BOULEVARD.spirePlaza.x1, 24, BOULEVARD.spirePlaza.z1 + 2],
  },
};

export const DOORS: Readonly<Record<string, DoorDef>> = {
  /**
   * Tower 3 closing armored roof blast shutter (`PARKOUR.slide` dims: 4.4 m × 3.6 m, 2.8 s close).
   * Closes to `open: 0.34` (~1.22 m slide clearance) so sprinting players can always slide under it.
   */
  'tower3.shutter': {
    at: [PARKOUR_GEOM.shutter.x, PARKOUR_GEOM.shutter.y, PARKOUR_GEOM.shutter.z],
    yaw: 0,
    width: PARKOUR_GEOM.shutter.width,
    height: PARKOUR_GEOM.shutter.height,
    kind: 'shutter',
    seconds: PARKOUR_GEOM.shutter.closeSeconds,
    start: 1,
    look: 'hazard',
  },
};

export const ROUTES: Readonly<Record<string, readonly string[]>> = {
  chopperPatrol: ['chopper.p1', 'chopper.p2', 'chopper.p3', 'chopper.p4'],
};

export const CUTSCENES: Readonly<Record<string, Cutscene>> = {
  briefing: {
    shots: [
      {
        from: [-106, T1.y + 12, -152],
        to: [-82, T1.y + 8, -138],
        lookFrom: [0, OFFICE.execY + 4, -12],
        lookTo: [0, OFFICE.execY + 8, 2],
        seconds: 4.2,
        fov: 54,
        fadeIn: 0.8,
        caption: 'FORM 7742-A // OPENMIND TECHNOLOGIES HQ — 05:42',
      },
      {
        from: [-44, T1.y + 6, -126],
        to: [-18, T2.y + 16, -98],
        lookFrom: [0, T3.y + 6, -42],
        lookTo: [0, OFFICE.execY + 2, -12],
        seconds: 4.0,
        fov: 58,
        fadeOut: 0.6,
        caption: 'DIRECTIVE: CROSS EASTERN SKYLINE · LIQUIDATE SUB-LEVEL 4',
      },
    ],
  },
  ending: {
    endsBlack: true,
    shots: [
      {
        from: [-24, 10, 126],
        to: [24, 14, 130],
        lookFrom: [0, 5, 144],
        lookTo: [0, 8, 144],
        seconds: 4.6,
        fov: 52,
        fadeIn: 0.5,
        caption: 'ORION-0 NEURAL CORE TERMINATED',
      },
      {
        from: [32, 34, 104],
        to: [46, 56, 78],
        lookFrom: [0, 14, 70],
        lookTo: [0, 42, 0],
        seconds: 5.0,
        fov: 50,
        fadeOut: 1.2,
        caption: 'FORM 7742-A FULFILLED // MUNICIPAL INVOICE ISSUED',
      },
    ],
  },
};
