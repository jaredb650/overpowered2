/**
 * Dogfight — Open-Ocean Aircraft Carrier Air-Combat Map (`map: 'dogfight'`, `contract: 'dogfight'`).
 *
 * Authors USS SOVEREIGN (CVN-88) steaming across a golden-dawn open ocean:
 *   - Vast sunlit ocean plane stretching out to the horizon with churning bow & stern foam wakes
 *   - 144 m armored naval hull with red anti-fouling waterline boot-top & recessed glowing hangar bays
 *   - Wide angled non-skid flight deck at y = 10 m with white runway dashes, yellow foul lines,
 *     twin bow catapult tracks with steel blast deflectors, 4 stern arresting wires, and deck lights
 *   - Multi-tier Starboard Island superstructure with Pri-Fly glass bridge, radar lattice mast, and beacons
 *   - 4 CIWS + 3 SAM perimeter sponson pads for live automated carrier defenses
 *   - 2 glowing interactive deck terminals (Flight Deck Hangar + Carrier Defense Command)
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import {
  CARRIER_AIRCRAFT_TERMINAL,
  CARRIER_CIWS_MOUNTS,
  CARRIER_DECK_Y,
  CARRIER_DEFENSE_TERMINAL,
  CARRIER_SAM_MOUNTS,
  DOGFIGHT_BOUNDS,
  DOGFIGHT_HUB_PT,
  DOGFIGHT_LEVELS,
  DOGFIGHT_LIGHT_BOUNDS,
  DOGFIGHT_LIGHT_CELL,
  DOGFIGHT_PICKUPS,
  DOGFIGHT_PLAYER_SPAWN,
  DOGFIGHT_PLAYER_YAW,
  DOGFIGHT_SKY_SPAWNS,
} from './plan';

export { DOGFIGHT_BOUNDS, DOGFIGHT_LEVELS, DOGFIGHT_LIGHT_BOUNDS, DOGFIGHT_LIGHT_CELL };
export * from './plan';

export const DOGFIGHT_HUB = new THREE.Vector3(DOGFIGHT_HUB_PT[0], DOGFIGHT_HUB_PT[1], DOGFIGHT_HUB_PT[2]);

const STAGES_BUILT = new WeakSet<MapSpec>();

const DECK_Y = CARRIER_DECK_Y;
const DECK_T = 0.6;

/** Ocean plane out to +-900 m plus white foam wakes steaming behind the stern and bow. */
function authorOcean(k: Kit): void {
  const g = k.geo;

  // Main deep maritime ocean expanse (visual to the horizon).
  g.use('steel').tint(0.14, 0.34, 0.52);
  g.gridStep(-900, 0, 900, 1800, 0, 0, 0, 0, -1800, 90);

  // Subtle sunlit sea shimmer bands near the carrier.
  g.use('tile').tint(0.16, 0.40, 0.60);
  g.box(0, 0.015, 0, 220, 0.01, 240, FACE.py);

  // Churning stern propeller wake foam streaming behind z = +72 to +230.
  g.use('paintWhite').tint(0.76, 0.88, 0.96);
  g.box(0, 0.03, 128, 9.5, 0.015, 58, FACE.py);
  g.tint(0.56, 0.78, 0.90);
  g.box(0, 0.025, 198, 15.5, 0.012, 42, FACE.py);
  // Twin V-wake divergence crests.
  for (const side of [-1, 1]) {
    k.push(side * 16, 0.035, 118, side * 0.24);
    g.use('paintWhite').tint(0.72, 0.86, 0.95);
    g.box(0, 0, 0, 2.2, 0.015, 62, FACE.py);
    k.pop();
    // Bow wave spray flare.
    k.push(side * 9.5, 0.04, -76, -side * 0.42);
    g.use('paintWhite').tint(0.84, 0.94, 1.0);
    g.box(0, 0, 0, 1.5, 0.018, 18, FACE.py);
    k.pop();
  }
  g.tint(1);

  // Flat sea-level collider across the playable airspace so airborne jets sample exact y = 0 AGL over open ocean.
  // NavGraph filters exclusively to levels: [CARRIER_DECK_Y], so y = 0 is never added to walkable nav!
  k.noClimb(() => {
    k.collide(0, -1.0, 0, 262, 1.0, 262, 'glass');
  });
}

/** Armored naval hull rising from below waterline (-2 m) up to flight deck underside (9.4 m). */
function authorCarrierHull(k: Kit): void {
  const g = k.geo;

  // Lower anti-fouling red boot-top hull band (y = -2 to +1.8).
  g.use('paintRed').tint(0.56, 0.16, 0.14);
  g.box(0, -0.1, 2, 15.6, 1.9, 64);
  // Tapered red bow keel.
  g.box(0, -0.1, -67, 9.2, 1.9, 7.5);
  g.box(0, -0.1, -74.5, 4.2, 1.9, 3.8);

  // Main armored naval-grey hull body (y = 1.8 to 9.4).
  g.use('steel').tint(0.46, 0.50, 0.55);
  g.box(0, 5.6, 2, 16.0, 3.8, 65);
  // Flared bow overhang supporting the forward flight deck.
  g.box(0, 6.2, -66, 12.6, 3.2, 8);
  g.box(0, 7.2, -72, 9.6, 2.2, 4);

  // Port angled-deck overhang sponson hull flare (supports the port landing waist out to x = -23).
  g.use('steelDark').tint(0.52, 0.56, 0.61);
  g.box(-19.2, 8.1, 14, 3.6, 1.3, 41);
  // Diagonal structural knee-braces beneath port & starboard flight deck overhangs.
  for (let z = -52; z <= 56; z += 18) {
    g.box(-17.8, 6.2, z, 1.8, 2.8, 0.7);
    g.box(16.6, 6.6, z, 1.1, 2.4, 0.7);
  }

  // Recessed hangar bay openings on port & starboard hull sides with warm amber deck glow.
  for (const side of [-1, 1]) {
    g.use('steelDark').tint(0.22, 0.24, 0.28);
    g.box(side * 16.05, 4.6, 24, 0.25, 2.4, 14);
    g.use('emissiveOrange').tint(0.9, 0.65, 0.35);
    g.box(side * 16.12, 6.5, 24, 0.12, 0.22, 12.5);
  }
  g.tint(1);

  // Solid hull collider underneath the flight deck so low-flying jets or boats can't clip through the hull.
  k.noClimb(() => {
    k.collide(0, 4.6, 0, 16.2, 4.7, 71, 'metal');
  });
}

/** Playable 144 m x 38 m angled non-skid flight deck at y = 10 m with runway markings, catapults, and arresting wires. */
function authorFlightDeck(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // Main rectangular flight deck slab (top exactly at DECK_Y = 10.0).
  g.use('asphalt').tint(0.30, 0.33, 0.38);
  g.box(-1.0, DECK_Y - DECK_T / 2, 0, 18.5, DECK_T / 2, 72);
  // Port angled landing extension (extends left to x = -23.5 from z = -26 to z = +58).
  g.box(-21.25, DECK_Y - DECK_T / 2, 16, 2.25, DECK_T / 2, 42);
  // Deck edge steel coaming trim.
  g.use('steelDark').tint(0.42, 0.46, 0.50);
  g.box(17.5, DECK_Y - 0.3, 0, 0.35, 0.35, 72.2);
  g.box(-19.5, DECK_Y - 0.3, -49, 0.35, 0.35, 23);
  g.box(-23.5, DECK_Y - 0.3, 16, 0.35, 0.35, 42.2);
  g.box(-1.0, DECK_Y - 0.3, -72, 18.8, 0.35, 0.4);
  g.box(-1.0, DECK_Y - 0.3, 72, 18.8, 0.35, 0.4);

  // Flight deck walk/drive/land physics colliders (top at exactly y = DECK_Y).
  k.collide(-1.0, DECK_Y - DECK_T / 2, 0, 18.5, DECK_T / 2, 72, 'concrete');
  k.collide(-21.25, DECK_Y - DECK_T / 2, 16, 2.25, DECK_T / 2, 42, 'concrete');

  // --- Painted Flight Deck Runway Markings (y = DECK_Y + 0.02) ---
  const mkY = DECK_Y + 0.025;

  // Main bow launch centerline white dashes (along x = -4.2 from z = 44 to z = -68).
  g.use('paintWhite').tint(0.92, 0.94, 0.96);
  for (let z = -66; z <= 46; z += 9) {
    g.box(-4.2, mkY, z, 0.28, 0.015, 2.6, FACE.py);
  }
  // Angled port landing runway white centerline dashes.
  for (let z = -20; z <= 52; z += 8.5) {
    g.box(-14.0, mkY, z, 0.24, 0.015, 2.4, FACE.py);
  }

  // Yellow foul lines framing the starboard aircraft parking & island safety zone.
  g.use('paintYellow').tint(0.96, 0.78, 0.16);
  g.box(6.8, mkY, 0, 0.24, 0.015, 68, FACE.py);
  g.box(-18.4, mkY, -48, 0.22, 0.015, 21, FACE.py);
  g.box(-22.4, mkY, 16, 0.22, 0.015, 40, FACE.py);
  // Bow & stern yellow hazard threshold bars.
  g.box(-4.2, mkY, -70.4, 12.2, 0.015, 0.65, FACE.py);
  g.box(-6.0, mkY, 70.4, 13.0, 0.015, 0.65, FACE.py);

  // Catapult Pad 1 boxed staging highlight around (-4.2, 10, 12).
  g.use('paintYellow').tint(0.98, 0.80, 0.20);
  g.box(-10.4, mkY, 12, 0.18, 0.015, 9.5, FACE.py);
  g.box(2.0, mkY, 12, 0.18, 0.015, 9.5, FACE.py);
  g.box(-4.2, mkY, 2.5, 6.2, 0.015, 0.22, FACE.py);
  g.box(-4.2, mkY, 21.5, 6.2, 0.015, 0.22, FACE.py);

  // Twin recessed steel Catapult Launch Tracks running straight to the bow!
  g.use('steelDark').tint(0.20, 0.22, 0.26);
  g.box(-4.2, mkY + 0.005, -24, 0.42, 0.018, 44, FACE.py);
  g.box(-11.2, mkY + 0.005, -36, 0.42, 0.018, 32, FACE.py);

  // Raised steel Jet Blast Deflector (JBD) behind Catapult 1 (decorative low angled ramp at z = +24.5).
  k.push(-4.2, DECK_Y + 0.55, 24.8, 0);
  g.use('hazard').tint(0.85, 0.78, 0.65);
  g.box(0, 0, 0, 5.0, 0.55, 0.25);
  k.pop();
  // Keep JBD low & non-blocking behind the catapult so taxiing is painless.

  // 4 Transverse Arresting Wires across the stern recovery zone (z = +36, +43, +50, +57).
  g.use('steel').tint(0.68, 0.72, 0.78);
  for (const wz of [36, 43, 50, 57]) {
    g.box(-11.0, DECK_Y + 0.04, wz, 10.5, 0.04, 0.10, FACE.py);
  }

  // Painted bold hull number "88" on the bow deck using crisp white bars.
  g.use('paintWhite').tint(0.95, 0.96, 0.98);
  for (const ox of [-2.8, 2.2]) {
    const cz = -56;
    g.box(ox, mkY, cz - 3.6, 1.6, 0.015, 0.45, FACE.py); // top bar
    g.box(ox, mkY, cz, 1.6, 0.015, 0.45, FACE.py); // mid bar
    g.box(ox, mkY, cz + 3.6, 1.6, 0.015, 0.45, FACE.py); // bot bar
    g.box(ox - 1.35, mkY, cz, 0.42, 0.015, 3.8, FACE.py); // left vert
    g.box(ox + 1.35, mkY, cz, 0.42, 0.015, 3.8, FACE.py); // right vert
  }

  // Glowing perimeter flight-deck guidance beacons (cyan bow runway lights, amber deck edge lights).
  for (let z = -66; z <= 66; z += 12) {
    g.use(z < -10 ? 'emissiveCyan' : 'emissiveOrange').tint(1, 1, 1);
    g.box(17.1, DECK_Y + 0.14, z, 0.18, 0.14, 0.42);
    const portX = z >= -26 && z <= 58 ? -23.0 : -19.0;
    g.box(portX, DECK_Y + 0.14, z, 0.18, 0.14, 0.42);
  }

  // Low perimeter catwalk safety railings ONLY along the island/stern pedestrian zone (never blocking takeoff/landing!).
  g.use('steel').tint(0.60, 0.64, 0.70);
  g.box(17.3, DECK_Y + 0.55, 42, 0.1, 0.55, 24);
  g.box(17.3, DECK_Y + 0.55, -42, 0.1, 0.55, 24);

  g.tint(1);

  // Minimap outline of the aircraft carrier deck.
  spec.plan?.blocks.push({ x0: -23.5, z0: -72, x1: 17.5, z1: 72 });
}

/** Towering Starboard Island superstructure with Pri-Fly bridge glass, radar mast, and red beacons. */
function authorIsland(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const ix = 14.2;

  // Tier 1: Flight Deck Operations Base (y = 10 to 16).
  g.use('steel').tint(0.50, 0.54, 0.60);
  g.box(ix, DECK_Y + 3.0, 0, 3.2, 3.0, 15.0);
  // Dark armored blast doors along deck-facing west side of island.
  g.use('steelDark').tint(0.28, 0.31, 0.36);
  g.box(ix - 3.25, DECK_Y + 1.5, -10.5, 0.1, 1.4, 1.4);
  g.box(ix - 3.25, DECK_Y + 1.5, 10.5, 0.1, 1.4, 1.4);

  // Tier 2: Navigation & Flag Bridge (y = 16 to 22).
  g.use('steel').tint(0.54, 0.58, 0.64);
  g.box(ix + 0.2, DECK_Y + 9.0, -0.5, 2.8, 3.0, 12.2);
  // Overhanging Bridge Wing gallery.
  g.use('steelDark').tint(0.36, 0.40, 0.45);
  g.box(ix - 0.8, DECK_Y + 9.4, -2.5, 3.6, 0.35, 7.6);
  // Panoramic tinted bridge windows facing the flight deck & bow.
  g.use('glass').tint(0.16, 0.30, 0.42);
  g.box(ix - 2.65, DECK_Y + 10.2, -2.5, 0.12, 1.0, 6.8);
  g.box(ix + 0.2, DECK_Y + 10.2, -12.75, 2.4, 1.0, 0.12);
  // Subtle warm interior console glow inside bridge.
  g.use('emissiveCyan').tint(0.5, 0.9, 1.0);
  g.box(ix - 2.45, DECK_Y + 9.6, -2.5, 0.08, 0.18, 6.0);

  // Tier 3: Pri-Fly Air Boss Control Tower & Exhaust Stack (y = 22 to 28).
  g.use('steel').tint(0.48, 0.52, 0.58);
  g.box(ix + 0.4, DECK_Y + 15.0, -3.5, 2.3, 3.0, 5.5);
  g.use('glass').tint(0.14, 0.26, 0.38);
  g.box(ix - 1.95, DECK_Y + 16.0, -3.5, 0.12, 1.15, 4.8);
  // Slanted twin exhaust funnel aft of Pri-Fly.
  g.use('steelDark').tint(0.30, 0.33, 0.38);
  g.box(ix + 0.5, DECK_Y + 15.4, 5.8, 2.0, 3.4, 3.2);
  g.use('steelDark').tint(0.16, 0.18, 0.20);
  g.box(ix + 0.5, DECK_Y + 18.9, 5.8, 1.8, 0.3, 2.8);

  // Tier 4: Phased-Array Radar Deck & Lattice Communications Mast (y = 28 to 39).
  g.use('panel').tint(0.62, 0.66, 0.72);
  g.box(ix + 0.4, DECK_Y + 19.6, -3.5, 1.8, 1.6, 3.4);
  // Central mast spire + horizontal radar yardarms.
  g.use('steel').tint(0.58, 0.62, 0.68);
  g.cyl(ix + 0.4, DECK_Y + 21.0, -3.5, ix + 0.4, DECK_Y + 29.0, -3.5, 0.48, 0.22, 8);
  g.box(ix + 0.4, DECK_Y + 24.5, -3.5, 4.2, 0.18, 0.28);
  g.box(ix + 0.4, DECK_Y + 27.0, -3.5, 2.8, 0.16, 0.24);
  // Wide surveillance radar dish bar.
  g.use('paintWhite').tint(0.90, 0.92, 0.96);
  g.box(ix + 0.4, DECK_Y + 22.8, -3.5, 0.5, 0.65, 3.6);
  // Glowing red aviation warning beacons atop the mast & funnel.
  g.use('emissiveRed').tint(1, 0.2, 0.15);
  g.box(ix + 0.4, DECK_Y + 29.3, -3.5, 0.32, 0.35, 0.32);
  g.box(ix + 0.5, DECK_Y + 19.4, 5.8, 0.28, 0.28, 0.28);
  g.tint(1);

  // Solid Island collider (so players & jets collide realistically with the command tower).
  k.noClimb(() => {
    k.collide(ix, DECK_Y + 9.0, 0, 3.3, 9.0, 15.1, 'metal');
    k.collide(ix + 0.4, DECK_Y + 23.0, -3.5, 2.0, 6.0, 3.5, 'metal');
  });

  // Minimap island block.
  spec.plan?.blocks.push({ x0: ix - 3.3, z0: -15.1, x1: ix + 3.3, z1: 15.1 });

  // Deck floodlights mounted on the island casting crisp warm illumination across the catapult & terminals.
  k.light(8.5, DECK_Y + 9.5, 10.0, 0xffe4b8, 2.8, 42);
  k.light(8.5, DECK_Y + 9.5, -10.0, 0xffe4b8, 2.8, 42);
  k.light(-4.2, DECK_Y + 8.0, 12.0, 0xc8eeff, 2.2, 34);
  k.light(ix + 0.4, DECK_Y + 29.5, -3.5, 0xff3b2f, 1.8, 22);
}

/** Perimeter armored sponsons for CIWS Phalanx & SeaRAM SAM mounts + two glowing deck terminals. */
function authorSponsonsAndTerminals(k: Kit): void {
  const g = k.geo;

  // Sponson mounting pads for CIWS & SAM batteries.
  for (const m of [...CARRIER_CIWS_MOUNTS, ...CARRIER_SAM_MOUNTS]) {
    const [mx, my, mz] = m.at;
    g.use('steelDark').tint(0.40, 0.44, 0.48);
    g.box(mx, my - 0.55, mz, 2.2, 0.55, 2.2);
    g.use('hazard').tint(0.82, 0.72, 0.35);
    g.box(mx, my - 0.04, mz, 1.8, 0.06, 1.8, FACE.py);
  }

  // --- Terminal 1: Flight Deck Hangar / Aircraft Select Terminal (Cyan) ---
  {
    const [tx, ty, tz] = CARRIER_AIRCRAFT_TERMINAL;
    g.use('steelDark').tint(0.32, 0.36, 0.42);
    g.box(tx, ty + 0.75, tz, 0.75, 0.75, 1.35);
    // Steel overhead rain canopy.
    g.use('steel').tint(0.46, 0.52, 0.58);
    g.box(tx - 0.15, ty + 2.65, tz, 1.15, 0.12, 1.85);
    g.box(tx + 0.65, ty + 1.4, tz - 1.5, 0.12, 1.4, 0.12);
    g.box(tx + 0.65, ty + 1.4, tz + 1.5, 0.12, 1.4, 0.12);
    // Glowing cyan terminal screen & top beacon strip.
    g.use('emissiveCyan').tint(0.25, 0.92, 1.0);
    g.box(tx - 0.78, ty + 1.35, tz, 0.06, 0.48, 1.05);
    g.box(tx - 0.95, ty + 2.65, tz, 0.10, 0.10, 1.65);
    // Painted cyan pad box on deck in front of terminal.
    g.box(tx - 1.6, ty + 0.03, tz, 0.7, 0.015, 1.4, FACE.py);
    k.light(tx - 1.2, ty + 2.2, tz, 0x38e8ff, 1.8, 14);
    k.noClimb(() => k.collide(tx, ty + 0.9, tz, 0.8, 0.9, 1.4, 'metal'));
  }

  // --- Terminal 2: Carrier Defense Command Terminal (Amber) ---
  {
    const [tx, ty, tz] = CARRIER_DEFENSE_TERMINAL;
    g.use('steelDark').tint(0.32, 0.36, 0.42);
    g.box(tx, ty + 0.75, tz, 0.75, 0.75, 1.35);
    // Steel overhead canopy.
    g.use('steel').tint(0.46, 0.52, 0.58);
    g.box(tx - 0.15, ty + 2.65, tz, 1.15, 0.12, 1.85);
    g.box(tx + 0.65, ty + 1.4, tz - 1.5, 0.12, 1.4, 0.12);
    g.box(tx + 0.65, ty + 1.4, tz + 1.5, 0.12, 1.4, 0.12);
    // Glowing amber tactical screen & top strip.
    g.use('emissiveOrange').tint(1.0, 0.70, 0.18);
    g.box(tx - 0.78, ty + 1.35, tz, 0.06, 0.48, 1.05);
    g.box(tx - 0.95, ty + 2.65, tz, 0.10, 0.10, 1.65);
    // Painted amber pad box on deck in front of terminal.
    g.box(tx - 1.6, ty + 0.03, tz, 0.7, 0.015, 1.4, FACE.py);
    k.light(tx - 1.2, ty + 2.2, tz, 0xffaa30, 1.8, 14);
    k.noClimb(() => k.collide(tx, ty + 0.9, tz, 0.8, 0.9, 1.4, 'metal'));
  }

  g.tint(1);
}

export const DOGFIGHT_STAGES = [
  {
    label: 'Charting the open sea',
    run: (k: Kit, spec: MapSpec) => {
      authorOcean(k);
      STAGES_BUILT.add(spec);
    },
  },
  {
    label: 'Welding USS Sovereign hull & flight deck',
    run: (k: Kit, spec: MapSpec) => {
      authorCarrierHull(k);
      authorFlightDeck(k, spec);
    },
  },
  {
    label: 'Raising the island bridge & deck terminals',
    run: (k: Kit, spec: MapSpec) => {
      authorIsland(k, spec);
      authorSponsonsAndTerminals(k);
    },
  },
] as const;

function zones(spec: MapSpec): void {
  const sky = DOGFIGHT_BOUNDS.y1;
  spec.zone('dogfight-deck', 'USS SOVEREIGN FLIGHT DECK', -25, DECK_Y - 2, -74, 20, DECK_Y + 34, 74);
  spec.zone(
    'dogfight-airspace',
    'OPEN OCEAN AIRSPACE',
    DOGFIGHT_BOUNDS.x0,
    DOGFIGHT_BOUNDS.y0,
    DOGFIGHT_BOUNDS.z0,
    DOGFIGHT_BOUNDS.x1,
    sky,
    DOGFIGHT_BOUNDS.z1,
  );
}

function spawns(spec: MapSpec): void {
  const airSpawns: SpawnPoint[] = DOGFIGHT_SKY_SPAWNS.map(([x, y, z]) => ({
    position: new THREE.Vector3(x, y, z),
    zone: 'dogfight-airspace',
    kind: 'air',
  }));
  // Include one deck ground spawn so generic map spawn validators always find >= 1 ground spawn.
  const deckSpawns: SpawnPoint[] = [
    { position: new THREE.Vector3(-12, DECK_Y + 0.1, -30), zone: 'dogfight-deck', kind: 'ground' },
    { position: new THREE.Vector3(-12, DECK_Y + 0.1, 34), zone: 'dogfight-deck', kind: 'ground' },
  ];

  spec.spawns = [...deckSpawns, ...airSpawns];
  for (const [x, y, z] of DOGFIGHT_PICKUPS) spec.pickup(x, y, z);

  spec.playerSpawns.push(
    { position: new THREE.Vector3(DOGFIGHT_PLAYER_SPAWN[0], DOGFIGHT_PLAYER_SPAWN[1] + 0.1, DOGFIGHT_PLAYER_SPAWN[2]), yaw: DOGFIGHT_PLAYER_YAW },
    { position: new THREE.Vector3(5.2, DECK_Y + 0.1, -4.5), yaw: 1.45 },
    { position: new THREE.Vector3(3.5, DECK_Y + 0.1, 14.0), yaw: 2.2 },
    { position: new THREE.Vector3(-2.0, DECK_Y + 0.1, 32.0), yaw: Math.PI },
  );
}

function views(spec: MapSpec): void {
  const eye = DECK_Y + 1.62;
  spec.view('overview', -95, 58, -110, 0, DECK_Y + 4, 0);
  spec.view('deck', DOGFIGHT_PLAYER_SPAWN[0], eye, DOGFIGHT_PLAYER_SPAWN[2], -4.2, DECK_Y + 2.2, 8.0);
  spec.view('bow', -18, DECK_Y + 12, -88, 4, DECK_Y + 8, 12);
  spec.view('island', -24, DECK_Y + 14, 18, 14, DECK_Y + 14, -4);
  spec.view('sky', 120, 74, 130, 0, DECK_Y + 8, 0);
}

export function authorDogfight(k: Kit, spec: MapSpec): void {
  if (!STAGES_BUILT.has(spec)) {
    for (const stage of DOGFIGHT_STAGES) {
      stage.run(k, spec);
    }
  }
  zones(spec);
  spawns(spec);
  views(spec);
}
