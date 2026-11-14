/**
 * Where everything in Foreclosure is, on Holdfast (src/world/map/holdfast, docs/notes/holdfast.md). The map puts a floor under every
 * mark and the map test holds it to that: marks on walkable ground, battles with a firing line and cover on both sides, the gunship's
 * targets in sight from its orbit, the Frame's routes clear at its width. x east, z south, the salt at y 0, north is -z.
 */
import type { Mark, Zone } from '../types';
import { LEVEL, stack, stackTop } from '../../world/map/holdfast/plan';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Zone => ({ min: [x0, y0, z0], max: [x1, y1, z1] });
/** yaw as a camera's: 0 looks north (-z), π/2 west, π south. */
const at = (x: number, y: number, z: number, yaw = 0): Mark => ({ at: [x, y, z], yaw });
const N = 0, W = Math.PI / 2, S = Math.PI, E = -Math.PI / 2;

const { roof, step, pad, quayDeck, slip, harbour } = LEVEL;
const A = stackTop(stack('A')), C1 = stackTop(stack('C1')), E1 = stackTop(stack('E1'));

/**
 * Every named place on Holdfast. The mission takes the ones its beats name today as MARKS (below); the rest are here for the stages
 * that build those beats (docs/proposals/mission-2-plan.md, stages 8 to 11), held to their floors by the map test all the same.
 */
export const PLACES: Readonly<Record<string, Mark>> = {
  // Checkpoints and places the player is put, in the order of the beats.
  lz: at(40, 0, 95, N),
  shanties: at(64, 0, 66, N),
  gate: at(70, 0, 44, N),
  square: at(70, 0, 28, N),
  quay: at(71, quayDeck, -60, E),
  slip: at(104, slip, -66, N),
  frame: at(112, slip, -82, S),
  harbour: at(44, 0, -98, W),
  pans: at(-30, 0, -20, W),
  deck: at(-90, 0, 4, W),

  // Where things stand.
  outerShacks: at(100, 0, 66, S),
  sniperShack: at(84, 0, 76, S),
  wallGuns: at(40, pad, 46.4, S),
  wallGunWest: at(40, pad, 46.4, S),
  wallGunEast: at(100, pad, 46.4, S),
  breach: at(55, 0, 52, N),
  breachKit: at(58, 0, 62, N),
  eastBureau: at(118, 0, 66, N),
  eastMilitia: at(112, step, 48.6, S),
  lanes: at(48, 0, 29, E),
  marketRoofWest: at(45, roof, 39, E),
  marketRoofEast: at(108, roof, 34, W),
  marketRoofNorth: at(44, roof, 19, S),
  stacks: at(70, E1, -24, W),
  stacksSniperA: at(64, E1, -10, W),
  stacksSniperB: at(64, E1, -34, W),
  quayRoad: at(56.5, 0, -50, S),
  craneCab: at(30.5, 22, -20, N),
  thresherRack: at(75.5, quayDeck, -61, E),
  quayHealth: at(68.5, quayDeck, -62.5, E),
  quayArmour: at(68.5, quayDeck, -58.5, E),
  slipNorth: at(118, 0, -97, S),
  slipEast: at(156, 0, -66, W),
  slipWest: at(80, 0, -80, E),
  doorGun: at(110, slip, -74, N),
  courierWreck: at(124, slip, -84, N),
  backStreet: at(100, 0, 29, W),
  backTank: at(117.5, 0, 2, N),
  flakTower: at(36, harbour, -108.5, E),
  flakGun1: at(14, 24, -110, N),
  flakGun2: at(26, 24, -110, N),
  flakGun3: at(14, 24, -100, N),
  flakGun4: at(26, 24, -100, N),
  mother: at(-90, 0, -10, S),
  deckCrew: at(-86, 0, 0, W),
  deckGun: at(-92, 0, 2, W),

  // The gunship's targets in the overwatch, round the LZ.
  aaWest: at(10, 0, 88, E),
  aaEast: at(128, 0, 92, W),
  trench: at(40.5, 0, 66.5, S),
  fuelDepot: at(143.5, 0, 69, E),
  roofGunWest: at(28, roof, 78, S),
  roofGunEast: at(106, roof, 74, S),
  openGround: at(80, 0, 84, S),

  // The technicals' tracks, from the flats' edge to the gate.
  techW0: at(8, 0, 118, N), techW1: at(14, 0, 86, N), techW2: at(20, 0, 58.5, E), techW3: at(60, 0, 58.5, E),
  techE0: at(150, 0, 118, N), techE1: at(146, 0, 86, N), techE2: at(120, 0, 58.5, W), techE3: at(80, 0, 58.5, W),

  // The stacks: the parkour route over the top, and the aisle under it.
  stacksFoot: at(32, 0, 11, N),
  stacksClimbed: at(32, A, 4, N),
  stacksTop: at(32, C1, -26, N),
  stacksEnd: at(30, 0, -50, N),
  aisleSouth: at(56.5, 0, 6, N),
  aisleNorth: at(56.5, 0, -40, S),

  // War spaces: a Bailiff squad's ground and the militia's across from it.
  flatsBureau: at(112, 0, 96, N),
  flatsMilitia: at(124, 0, 76, S),
  westBureau: at(33.5, 0, 66.5, N),
  cornerBureau: at(84, 0, 27.4, E),
  cornerMilitia: at(100, 0, 33, W),
  squareBureau: at(66, 0, 36, N),
  counterMilitia: at(64, 0, 12, S),
  quayBureau: at(123.5, 0, 6, N),
  quayMilitia: at(111.5, 0, -26, S),
  aisleBureau: at(53, 0, 4, N),

  // The Frame's ways through the town.
  slipRampFoot: at(118, slip, -76, S),
  slipRampTop: at(118, 0, -50, S),
  squareNorth: at(70, 0, 12, S),
  squareEast: at(84, 0, 29, E),
  saltStreetEast: at(119, 0, 29, N),
  quayStreetNorth: at(119, 0, 12, N),
  quayRoadNorth: at(117.5, 0, -50, W),
  apronWest: at(17, 0, -50, N),
  flakFoot: at(17, 0, -93, W),
  harbourWest: at(-2.5, 0, -96, S),
  westRoad: at(-2.5, 0, -40, S),
  westGateIn: at(-2.5, 0, -20, W),
  westGateOut: at(-24, 0, -20, W),
  pansA: at(-60, 0, -60, W),
  pansB: at(-130, 0, -20, S),
  pansC: at(-110, 0, 70, E),
  pansD: at(-40, 0, 60, N),
};

export const ZONES: Readonly<Record<string, Zone>> = {
  // Out of the west gate onto the salt.
  westGate: box(-24, -1, -26, -12, 7, -14),
};

/** Lists of marks. Technicals drive the tracks; the Frame's routes are swept at its width by the map test. */
export const ROUTES: Readonly<Record<string, readonly string[]>> = {
  technicalWest: ['techW0', 'techW1', 'techW2', 'techW3'],
  technicalEast: ['techE0', 'techE1', 'techE2', 'techE3'],
  // `foreclosure`: out of the Slip, down the crane aisle, into the Square, east down Salt Street and back up the quay road.
  frameStacks: ['frame', 'slipRampFoot', 'slipRampTop', 'quayRoad', 'aisleNorth', 'aisleSouth', 'squareNorth', 'square'],
  frameMarket: ['square', 'squareEast', 'saltStreetEast', 'quayStreetNorth', 'backTank', 'quayRoadNorth'],
  // `flak`: along the quay to the tower's foot.
  frameHarbour: ['quayRoadNorth', 'apronWest', 'flakFoot', 'harbour'],
  // `pans`: down the west road and out of the west gate onto the salt.
  frameWest: ['flakFoot', 'harbourWest', 'westRoad', 'westGateIn', 'westGateOut', 'pans'],
  // `mother`: room to circle her.
  framePans: ['pans', 'pansA', 'pansB', 'pansC', 'pansD', 'pans'],
};

/** The names the skeleton's beats use. A beat that starts naming another place adds it here. */
const NAMED = [
  'lz', 'shanties', 'gate', 'square', 'quay', 'slip', 'frame', 'harbour', 'pans', 'deck', 'outerShacks', 'wallGuns', 'breachKit',
  'eastBureau', 'eastMilitia', 'lanes', 'stacks', 'quayRoad', 'craneCab', 'thresherRack', 'quayHealth', 'quayArmour', 'slipNorth',
  'slipEast', 'slipWest', 'backStreet', 'backTank', 'flakTower', 'mother', 'deckCrew', 'deckGun',
];

/** The mission's marks: what its beats name and what its routes run through. */
export const MARKS: Readonly<Record<string, Mark>> = Object.fromEntries(
  Object.entries(PLACES).filter(([id]) => NAMED.includes(id) || Object.values(ROUTES).some(r => r.includes(id))),
);

/** The Frame's routes, by id in ROUTES. */
export const FRAME_ROUTES = ['frameStacks', 'frameMarket', 'frameHarbour', 'frameWest', 'framePans'] as const;

/**
 * Where the war is: other Bailiff squads' fights beside the player's, as `battle` steps take them (`at` the Bureau's ground, `from`
 * the militia's). Each has a firing line between the two and cover on both sides (the map test).
 */
export const BATTLES: Readonly<Record<string, { at: string; from: string; what: string }>> = {
  flats: { at: 'flatsBureau', from: 'flatsMilitia', what: 'A second stick of the 14th lands east of the LZ and fights into the east shanties' },
  eastStreet: { at: 'eastBureau', from: 'eastMilitia', what: 'A squad under the wall east of the gate, militia firing down from the step' },
  westWall: { at: 'westBureau', from: 'wallGunWest', what: 'A squad pinned in the trench by the west wall gun' },
  marketCorner: { at: 'cornerBureau', from: 'cornerMilitia', what: 'A squad holding the Square\'s east corner, the counter-attack out of the lanes off Salt Street' },
  squareCounter: { at: 'squareBureau', from: 'counterMilitia', what: 'The militia\'s counter-attack into the Square from Crane Street' },
  quayRoad: { at: 'quayBureau', from: 'quayMilitia', what: 'The long way round the stacks, up the quay road into a barricade' },
};

/** The overwatch: the AC-130's orbit (docs/notes/progression.md: radius 160, altitude 185) round the LZ, and what it shoots. */
export const OVERWATCH = {
  over: 'lz',
  radius: 160,
  altitude: 185,
  targets: ['outerShacks', 'sniperShack', 'trench', 'fuelDepot', 'roofGunWest', 'roofGunEast', 'aaWest', 'aaEast', 'openGround', 'techW1', 'techE1', 'wallGunWest', 'wallGunEast'],
} as const;
