/**
 * Where everything in the Outpost mission is. docs/campaign/MISSION.md draws this; the map has to put a floor under each row, and a
 * test holds the parkour rows to what src/campaign/parkour.ts proved. x east, z south, floor of the apron at y 0, north is -z.
 */
import type { DoorDef, Mark, Vec3, Zone } from '../types';
import { PARKOUR } from '../parkour';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Zone => ({ min: [x0, y0, z0], max: [x1, y1, z1] });
const at = (x: number, y: number, z: number, yaw?: number): Mark => ({ at: [x, y, z] as Vec3, yaw });
const hold = (x: number, y: number, z: number, seconds: number): Mark => ({ at: [x, y, z] as Vec3, hold: seconds });

/** The citadel's levels. */
export const LEVEL = { gallery: -5, ground: 0, upper: 5, command: 10, roof: 14 } as const;

export const ZONES: Readonly<Record<string, Zone>> = {
  // Outside
  lzCut: box(-49, -4, 73, -15, -0.5, 99),
  gateApproach: box(-40, -1, 14, 40, 12, 34),
  easternApron: box(44, -1, 40, 110, 30, 110),
  wreckDeck: box(74, PARKOUR.doubleJump.ledge - 0.4, 80, 94, 9, 88),

  // The gate yard and the door
  gateYard: box(-30, -1, -12, 30, 12, 10),
  blastLine: box(-30, -1, -12, 30, 12, -12 + PARKOUR.slide.triggerRange),
  sallyHall: box(-10, -1, -26, 10, 6, -14),

  // Inside, in the order the route takes them
  southCorridor: box(-56, -1, -19, -10, 5, -16),
  bunks: box(-56, -1, -41, -12, 5, -19),
  northCorridor: box(-56, -1, -44, -12, 5, -41),
  coolantNear: box(-40, -1, -50, -28, 12, -46),
  coolantFar: box(-56, -1, -78, -14, 12, -50 - PARKOUR.dash.gap),
  galleryNear: box(-24, -7, -78, -11, -1, -71),
  galleryFar: box(11, -7, -78, 24, -1, -71),
  messHall: box(14, -1, -78, 56, 6, -46),
  stackTop: box(-10, 9, -64, 10, 13, -28),
};

export const MARKS: Readonly<Record<string, Mark>> = {
  // Player
  lz: at(-32, -3, 86, 0),
  apronRally: at(-8, 0, 62, 0),
  wreckDeck: at(84, PARKOUR.doubleJump.ledge, 84),
  wreckFoot: at(70, 0, 76, Math.PI / 2),
  gateMouth: at(0, 0, 22, 0),
  sallyHall: at(0, 0, -18, Math.PI / 2),
  coolantNear: at(-34, 0, -48, 0),
  galleryNear: at(-20, LEVEL.gallery, -74.5, -Math.PI / 2),
  galleryFar: at(18, LEVEL.gallery, -74.5, -Math.PI / 2),
  armoury: at(44, 0, -37, Math.PI),
  stackFloor: at(6, 0, -33, Math.PI / 2),
  warRoomDoor: at(0, LEVEL.command, -64, 0),

  // Things to find
  pumpRoof: at(-60, 3.6, 50),
  shotgunCrate: at(24, 0, 24),
  rocketRack: at(84, PARKOUR.doubleJump.ledge, 84),
  autocannonRack: at(44, 0, -37),
  kilnRack: at(50, 0, -74),

  // Supplies
  lzHealth: at(-22, -3, 92),
  guardAmmo: at(21, 0, 22),
  wreckAmmo: at(80, PARKOUR.doubleJump.ledge, 84),
  apronAmmoWest: at(-40, 0, 60),
  apronAmmoEast: at(30, 0, 60),
  gateAmmo: at(16, 0, 18),
  barracksHealth: at(-28, 0, -30),
  coolantArmor: at(-40, 0, -72),
  stackHealth: at(-6, LEVEL.upper, -46),
  armouryHealth: at(36, 0, -37),
  armouryArmor: at(52, 0, -37),
  roofAmmo: at(-16, LEVEL.roof, -50),
  roofHealth: at(16, LEVEL.roof, -50),

  // Who comes on where. Everything outside the wall arrives from behind a berm, out of sight of the apron.
  wallWest: at(-40, 5, 12),
  towerOne: at(-40, 9, 12),
  towerTwo: at(40, 9, 12),
  yardWest: at(-18, 0, 2),
  ringEast: at(66, 0, -30),
  ringWest: at(-66, 0, -30),
  apronEast: at(44, 0, 46),
  guardPost: at(24, 0, 30),
  lzRim: at(-14, 0, 70),
  sandbagsWest: at(-14, 0, -6),
  sandbagsEast: at(14, 0, -6),
  corridorMg: at(-54, 0, -17.5),
  northCorridorEast: at(-14, 0, -42.5),
  bunkFour: at(-50, 0, -30),
  coolantFar: at(-34, 0, -72),
  messFloor: at(36, 0, -62),
  messWest: at(20, 0, -52),
  messEast: at(52, 0, -52),
  plateWest: at(16, 0, -24),
  guardRoom: at(20, 0, -36),
  stackBase: at(0, LEVEL.gallery, -46),
  stackLower: at(-6, LEVEL.upper, -36),
  stackUpper: at(6, LEVEL.command, -56),
  warRoom: at(0, LEVEL.command, -72),
  roofWest: at(-18, LEVEL.roof, -40),
  roofEast: at(18, LEVEL.roof, -40),
  roofMast: at(0, LEVEL.roof, -70),

  // Roads. East and west roads meet in front of the gate; a truck stops short of it and the men get out.
  eastEdge: at(110, 0, 34),
  eastRoad: at(64, 0, 34),
  eastStop: at(26, 0, 34),
  westEdge: at(-110, 0, 34),
  westRoad: at(-64, 0, 34),
  westStop: at(-26, 0, 34),
  tankEastStop: at(48, 0, 34),
  tankWestStop: at(-48, 0, 34),
  gateInside: at(0, 0, -2),
  gateHold: at(0, 0, 12),

  // The air
  skyNorth: at(0, 42, -130),
  skyApron: at(0, 30, 60),
  skyWest: at(-60, 34, 40),
  skyEast: at(60, 34, 40),

  // The Packmule's lap. Left door to the wire the whole way, so the lap runs anticlockwise from above.
  fly0: at(-200, 60, 150),
  fly1: at(-90, 36, 58),
  fly2: hold(0, 32, 48, 20),
  fly3: hold(92, 34, 40, 14),
  fly4: at(98, 36, -40),
  fly5: hold(60, 38, -104, 18),
  fly6: at(-60, 38, -104),
  fly7: hold(-98, 34, -40, 18),
  fly8: at(-92, 30, 40),
  fly9: at(-52, 18, 80),
  fly10: at(-32, 2, 86),
};

export const ROUTES: Readonly<Record<string, readonly string[]>> = {
  insertion: ['fly0', 'fly1', 'fly2', 'fly3', 'fly4', 'fly5', 'fly6', 'fly7', 'fly8', 'fly9', 'fly10'],
  eastRoad: ['eastEdge', 'eastRoad', 'eastStop'],
  westRoad: ['westEdge', 'westRoad', 'westStop'],
  tankEast: ['eastEdge', 'eastRoad', 'tankEastStop'],
  tankWest: ['westEdge', 'westRoad', 'tankWestStop'],
  gateTank: ['gateInside', 'gateHold'],
  chopper: ['skyNorth', 'skyApron', 'skyEast', 'skyWest'],
};

export const DOORS: Readonly<Record<string, DoorDef>> = {
  /** The main gate: wide enough for a tank, and the first thing that shuts in the player's face. */
  mainGate: { at: [0, 0, 12], yaw: 0, width: 14, height: 6, kind: 'split', seconds: 3.5, start: 1 },
  /** The citadel's blast door. The slide lesson, so its numbers are PARKOUR's. */
  blastDoor: { at: [0, 0, -12], yaw: 0, width: 6, height: PARKOUR.slide.doorHeight, kind: 'shutter', seconds: PARKOUR.slide.closeSeconds, start: 1 },
  /** From Sally Hall to the bunks. Opens for the raid. */
  sallyWest: { at: [-10, 0, -17.5], yaw: Math.PI / 2, width: 3, height: 3, kind: 'shutter', seconds: 1.2, start: 0 },
  /** From Sally Hall into the Plate Hall's west end. Shut until the Commander sends men through it behind the player. */
  sallyEast: { at: [12, 0, -20], yaw: Math.PI / 2, width: 3, height: 3, kind: 'shutter', seconds: 1.2, start: 0 },
  /** The Armoury's door to the Plate Hall, which opens once the player has had their breath. */
  armourySouth: { at: [44, 0, -32.5], yaw: 0, width: 3, height: 3, kind: 'shutter', seconds: 1, start: 0 },
  /** War Room to the roof stairs. He opens it himself when he runs. */
  warRoomStairs: { at: [0, LEVEL.command, -67], yaw: 0, width: 3, height: 3, kind: 'shutter', seconds: 1, start: 0 },
};
