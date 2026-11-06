/**
 * The citadel's bones: slabs, shell and every wall of the two wings. The rooms are dressed in rooms.ts. Door openings for scripted
 * doors take their numbers from the mission's rows, so a door and its hole cannot drift apart.
 */
import { DOORS } from '../../../campaign/missions/outpost.places';
import { FACE } from '../../kit/geo';
import { vent } from '../../kit/props';
import {
  carveAll, CITADEL, COMMS, COOLANT, GALLERY_STAIR, HALL_TOP, KITCHEN_STAIR, rect, ROOF, type Rect, WAR, WAR_CEIL, WING,
} from './plan';
import type { Opening, Site } from './site';

const DOOR = { w: 3, y1: 3 } as const;
const WIDE = { w: 4, y1: 3.4 } as const;
/** Where the shell of the raised hall stops. */
const HALL_ROOF = HALL_TOP + 1.2;

const scripted = (id: keyof typeof DOORS, axis: 0 | 2): Opening => {
  const d = DOORS[id]!;
  return { at: d.at[axis], w: d.width, y1: d.at[1] + d.height, scripted: true };
};

function slabs(s: Site): void {
  const { platform, x0, x1, pit, farLip } = COOLANT;
  s.solid(-58, -1, -46, -10, 0, -12);
  s.solid(-10, -1, -28, 10, 0, -12);
  s.solid(10, -1, -70, 58, 0, -12);
  const stair: Rect = rect(KITCHEN_STAIR.foot, KITCHEN_STAIR.north, KITCHEN_STAIR.top, KITCHEN_STAIR.south);
  for (const r of carveAll(rect(14, -80, 58, -70), [stair])) s.solid(r.x0, -2, r.z0, r.x1, 0, r.z1);
  // Far platform: solid to the pit floor west of the gallery, and the gallery's own ceiling over its near deck.
  s.solid(-58, pit - 1, -80, GALLERY_STAIR.top, 0, farLip);
  s.solid(GALLERY_STAIR.top, -2, -80, -14, 0, GALLERY_STAIR.north);
  s.solid(GALLERY_STAIR.top, pit - 1, GALLERY_STAIR.south, -14, 0, farLip);
  s.solid(platform.x0, pit - 1, platform.z0, platform.x1, 0, -41);
  s.solid(x0, pit - 1, farLip, x1, pit, COOLANT.south);
}

function shell(s: Site): void {
  s.wall({ x0: -58, z0: -16, x1: -10, z1: -12, y1: WING, outside: 'poured' });
  s.wall({ x0: -10, z0: -14, x1: 10, z1: -12, y1: WING, outside: 'poured', openings: [scripted('blastDoor', 0)] });
  s.wall({ x0: 10, z0: -16, x1: 58, z1: -12, y1: WING, outside: 'poured' });
  s.wall({ x0: -58, z0: -44, x1: -56, z1: -16, y1: WING, outside: 'poured' });
  s.wall({ x0: 56, z0: -80, x1: 58, z1: -16, y1: WING, outside: 'poured' });
  s.wall({ x0: 14, z0: -80, x1: 56, z1: -78, y1: WING, outside: 'poured' });
  // The Coolant Hall stands proud of the wing, and its walls go down to the pit.
  s.wall({ x0: -58, z0: -80, x1: -56, z1: -44, y0: COOLANT.pit - 1, y1: HALL_ROOF, outside: 'poured' });
  s.wall({ x0: -56, z0: -80, x1: -14, z1: -78, y0: COOLANT.pit - 1, y1: HALL_ROOF, outside: 'poured' });
}

function westWing(s: Site): void {
  s.wall({ x0: -56, z0: -20, x1: -12, z1: -19, y1: WING, openings: [-48, -41, -26, -19].map(at => ({ at, ...DOOR })) });
  s.wall({ x0: -56, z0: -41, x1: -12, z1: -40, y1: WING, openings: [-53, -37, -30, -15].map(at => ({ at, ...DOOR })) });
  for (const x of [-23, -34, -45]) s.wall({ x0: x, z0: -40, x1: x + 1, z1: -20, y1: WING });
  // From the corridor to the Coolant Hall's near platform. The hall's wall runs up past the corridor's ceiling.
  s.wall({ x0: -56, z0: -46, x1: -14, z1: -44, y1: HALL_TOP, openings: [{ at: -34, ...WIDE }] });
  s.solid(-56, COOLANT.pit - 1, -46, COOLANT.platform.x0, 0, -44);
  s.solid(COOLANT.platform.x1, COOLANT.pit - 1, -46, -14, 0, -44);
  s.wall({ x0: -14, z0: -66, x1: -12, z1: -44, y0: COOLANT.pit - 1, y1: HALL_ROOF });
  s.wall({ x0: -12, z0: -26, x1: -10, z1: -16, y1: WING, openings: [scripted('sallyWest', 2)] });
}

function eastWing(s: Site): void {
  s.wall({ x0: 10, z0: -26, x1: 12, z1: -16, y1: WING, openings: [scripted('sallyEast', 2)] });
  s.wall({ x0: 12, z0: -33, x1: 56, z1: -32, y1: WING, openings: [{ at: 20, ...DOOR }, scripted('armourySouth', 0)] });
  s.wall({ x0: 29, z0: -40, x1: 30, z1: -33, y1: WING });
  s.wall({ x0: 12, z0: -41, x1: 56, z1: -40, y1: WING, openings: [{ at: 20, ...DOOR }, { at: 44, ...DOOR }] });
  s.wall({ x0: 12, z0: -46, x1: 56, z1: -44, y1: WING, openings: [{ at: 24, ...WIDE }, { at: 46, ...WIDE }] });
  s.wall({ x0: 12, z0: -80, x1: 14, z1: -46, y1: WING });
  // The kitchen's wall. A long serving hatch makes the mess visible before anyone is committed to it.
  s.wall({ x0: 14, z0: -70, x1: 56, z1: -69, y1: WING, openings: [{ at: 22, ...DOOR }, { at: 36, w: 13, y0: 1.1, y1: 2.3 }, { at: 50, ...DOOR }] });
}

/** Everything above the wings: solid mass round the Stack and the War Room. Only the air sees its outside. */
function upperWorks(s: Site): void {
  const body = 'concreteDark', tone = 0.62;
  s.mass(body, -24, WING, -46, -12, ROOF, -26, tone, 5);
  s.mass(body, 12, WING, -66, 24, ROOF, -26, tone, 5);
  s.mass(body, 12, WING, -80, 24, WAR.floor, -66, tone, 5);
  s.mass(body, WAR.x1, WAR.floor, -80, 24, WAR_CEIL, -66, tone, 5);
  s.mass(body, -18, WAR.floor, -80, WAR.x1, WAR_CEIL, -78, tone, 5);
  // The block under the War Room, bridging the gallery. Its underside is the gallery's ceiling.
  s.mass(body, -14, -2, -80, 14, WAR.floor, -66, tone, 4);
  s.mass(body, -18, WAR.floor - 0.6, -80, -14, WAR.floor, -66, tone, 3);
  // Roof of the raised hall, and the wings'.
  s.mass(body, -56, HALL_TOP, -78, -14, HALL_ROOF, -46, 0.56, 6, FACE.py | FACE.ny);
  for (const r of carveAll(rect(CITADEL.x0, CITADEL.z0, CITADEL.x1, CITADEL.z1), [rect(-58, -80, -14, -44), COMMS])) {
    s.paintFloor('concreteDark', r, WING + 0.02, [0.56, 0.58, 0.62], 4);
  }
  // Ducts on the roofs, for the fly-in.
  const k = s.k, g = k.geo;
  for (const [x, z] of [[-44, -30], [-30, -22], [36, -24], [46, -60], [34, -64], [50, -30]] as const) {
    g.use('steelDark').bevel(x, WING + 0.5, z, 1.4, 0.5, 1, 0.06);
    vent(k, x, WING + 0.5, z + 1.02, 0, 1.6, 0.6);
  }
}

export function authorCitadel(s: Site): void {
  slabs(s);
  shell(s);
  westWing(s);
  eastWing(s);
  upperWorks(s);
}
