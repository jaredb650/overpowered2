/**
 * The Open-Sea Strait (`map: 'strait'`, Crossfire Parts 2 & 4: F-22 Raptor Escort & Dusk Return).
 *
 * Built on the proven open-ocean `dogfight` architecture, scaled to a massive 1,640 m x 1,640 m
 * long-range bomber transit corridor:
 *   - Expansive dark-blue ocean plane (+-2,600 m) with sun glint bands & vessel wakes
 *   - South End (z = +540): Friendly Carrier Strike Group (CVN-91 + 2 escort frigates)
 *   - Mid-Strait (z = -180..+180): 8 jagged volcanic sea stacks (94–142 m tall) + 2 detailed PBR
 *     hostile Southern Missile Destroyers (`destroyer_west` & `destroyer_east`) with SAM/CIWS mounts
 *   - North Horizon (z = -680..-820): Fortified Fortress Halcyon coastline cliffs, coastal bunkers,
 *     radar towers, and rising dark smoke pillars
 *   - High-Altitude Cloud Layer (y = 178–228 m): atmospheric cloud deck for high-speed dogfighting
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import { FACE } from '../../kit/geo';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import {
  DESTROYER_LOCAL_MOUNTS,
  STRAIT_BOUNDS,
  STRAIT_CARRIER_CENTER,
  STRAIT_CARRIER_DECK_Y,
  STRAIT_CLOUD_BANKS,
  STRAIT_COASTAL_RADARS,
  STRAIT_DECK_PLAYER_SPAWN,
  STRAIT_DECK_PLAYER_YAW,
  STRAIT_DESTROYERS,
  STRAIT_FRIENDLY_ESCORTS,
  STRAIT_HUB_PT,
  STRAIT_LEVELS,
  STRAIT_LIGHT_BOUNDS,
  STRAIT_LIGHT_CELL,
  STRAIT_NAV_BOUNDS,
  STRAIT_SEA_STACKS,
  STRAIT_SKY_SPAWNS,
  STRAIT_SMOKE_PILLARS,
  type StraitShipPose,
} from './plan';

export {
  STRAIT_BOUNDS,
  STRAIT_LEVELS,
  STRAIT_LIGHT_BOUNDS,
  STRAIT_LIGHT_CELL,
  STRAIT_NAV_BOUNDS,
};
export * from './plan';

export const STRAIT_HUB = new THREE.Vector3(STRAIT_HUB_PT[0], STRAIT_HUB_PT[1], STRAIT_HUB_PT[2]);

/** Prevents duplicate geometry if `authorStrait` is called after `STRAIT_STAGES`. */
const STAGES_BUILT = new WeakSet<MapSpec>();

const DECK_Y = STRAIT_CARRIER_DECK_Y;
const DECK_T = 0.6;

function start(spec: MapSpec): void {
  spec.reactor = null;
  spec.killY = STRAIT_BOUNDS.y0;
  spec.roads = [];

  const fill = (
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    rgb: readonly [number, number, number],
    label = '',
  ) => ({ x0, z0, x1, z1, rgb, label });

  spec.plan = {
    fills: [
      fill(STRAIT_BOUNDS.x0, STRAIT_BOUNDS.z0, STRAIT_BOUNDS.x1, STRAIT_BOUNDS.z1, [0.10, 0.20, 0.34], 'OPEN-SEA STRAIT'),
      fill(-40, 460, 40, 620, [0.24, 0.38, 0.46], 'CARRIER GROUP'),
      fill(-820, -820, 820, -680, [0.24, 0.22, 0.22], 'HALCYON COAST'),
    ],
    walls: [],
    blocks: [],
    decks: [],
    gates: [],
    doors: [],
  };
}

/** Stage 1: Expansive dark-blue ocean plane (+-2,600 m), sun glint bands, and flat sea-level collider. */
function authorOceanAndClouds(k: Kit): void {
  const g = k.geo;

  // Vast deep maritime dark-blue ocean expanse stretching to +-2,600 m (explicit grid avoids 24 m chunk-split blowup).
  g.use('steel').tint(0.10, 0.25, 0.44);
  g.grid(-2600, 0, 2600, 5200, 0, 0, 0, 0, -5200, 26, 26);

  // Sunlit dawn/dusk sea glint streaks & current shimmer lanes running down the strait.
  g.use('tile').tint(0.16, 0.34, 0.52);
  g.box(0, 0.015, 40, 260, 0.01, 560, FACE.py);
  g.tint(0.28, 0.42, 0.56);
  g.box(220, 0.02, -120, 95, 0.01, 440, FACE.py);
  g.box(-190, 0.02, 220, 85, 0.01, 380, FACE.py);
  g.tint(0.54, 0.46, 0.36);
  g.box(410, 0.024, 80, 54, 0.008, 620, FACE.py);
  g.tint(1);

  // Flat sea-level collider across the entire 1,640 m playable airspace so airborne jets sample exact y = 0 AGL
  // and the compact STRAIT_NAV_BOUNDS bakes cleanly and instantaneously.
  k.noClimb(() => {
    k.collide(0, -1.0, 0, 860, 1.0, 860, 'glass');
  });

  // Sky clouds are rendered cleanly by the procedural dawn/dusk sky dome rather than opaque box geometry.
  void STRAIT_CLOUD_BANKS;
  g.tint(1);

  // Broad maritime lighting inside STRAIT_LIGHT_BOUNDS so aircraft & ships receive crisp bounce light.
  k.light(0, 32, 0, 0x9cc4ee, 72, 68);
  k.light(-48, 28, -56, 0xffd2a0, 58, 56);
  k.light(48, 28, 56, 0xffd2a0, 58, 56);
}

/** Stage 2: South End Friendly Carrier Strike Group (CVN-91 at z = +540 + 2 escort frigates). */
function authorCarrierStrikeGroup(k: Kit, spec: MapSpec): void {
  const g = k.geo;
  const [cx, , cz] = STRAIT_CARRIER_CENTER; // (0, 10, 540)

  k.push(cx, 0, cz, 0);

  // Churning stern propeller wake & twin V-wake crests behind CVN-91
  g.use('paintWhite').tint(0.76, 0.88, 0.96);
  g.box(0, 0.03, 134, 10.5, 0.015, 62, FACE.py);
  g.tint(0.56, 0.78, 0.90);
  g.box(0, 0.025, 208, 16.5, 0.012, 46, FACE.py);
  for (const side of [-1, 1]) {
    k.push(side * 17, 0.035, 122, side * 0.22);
    g.use('paintWhite').tint(0.72, 0.86, 0.95);
    g.box(0, 0, 0, 2.2, 0.015, 64, FACE.py);
    k.pop();
    k.push(side * 9.5, 0.04, -76, -side * 0.40);
    g.use('paintWhite').tint(0.84, 0.94, 1.0);
    g.box(0, 0, 0, 1.5, 0.018, 18, FACE.py);
    k.pop();
  }

  // Red anti-fouling boot-top + armored naval-grey hull
  g.use('paintRed').tint(0.56, 0.16, 0.14);
  g.box(0, -0.1, 2, 15.6, 1.9, 64);
  g.box(0, -0.1, -67, 9.2, 1.9, 7.5);
  g.box(0, -0.1, -74.5, 4.2, 1.9, 3.8);

  g.use('steel').tint(0.46, 0.50, 0.55);
  g.box(0, 5.6, 2, 16.0, 3.8, 65);
  g.box(0, 6.2, -66, 12.6, 3.2, 8);
  g.box(0, 7.2, -72, 9.6, 2.2, 4);

  g.use('steelDark').tint(0.50, 0.54, 0.60);
  g.box(-19.2, 8.1, 14, 3.6, 1.3, 41);

  // Flight deck slab (top at exact DECK_Y = 10.0)
  g.use('asphalt').tint(0.30, 0.33, 0.38);
  g.box(-1.0, DECK_Y - DECK_T / 2, 0, 18.5, DECK_T / 2, 72);
  g.box(-21.25, DECK_Y - DECK_T / 2, 16, 2.25, DECK_T / 2, 42);

  // Runway markings, catapult tracks, arresting wires & glowing perimeter deck beacons
  const mkY = DECK_Y + 0.025;
  g.use('paintWhite').tint(0.92, 0.94, 0.96);
  for (let z = -64; z <= 48; z += 10) {
    g.box(-4.2, mkY, z, 0.28, 0.015, 2.8, FACE.py);
  }
  for (let z = -18; z <= 52; z += 9) {
    g.box(-14.0, mkY, z, 0.24, 0.015, 2.5, FACE.py);
  }
  g.use('paintYellow').tint(0.96, 0.78, 0.16);
  g.box(6.8, mkY, 0, 0.24, 0.015, 68, FACE.py);
  g.box(-4.2, mkY, -70.4, 12.2, 0.015, 0.65, FACE.py);
  g.box(-6.0, mkY, 70.4, 13.0, 0.015, 0.65, FACE.py);
  g.use('steelDark').tint(0.20, 0.22, 0.26);
  g.box(-4.2, mkY + 0.005, -24, 0.42, 0.018, 44, FACE.py);
  g.use('steel').tint(0.68, 0.72, 0.78);
  for (const wz of [36, 43, 50, 57]) {
    g.box(-11.0, DECK_Y + 0.04, wz, 10.5, 0.04, 0.10, FACE.py);
  }
  for (let z = -66; z <= 66; z += 16) {
    g.use(z < 0 ? 'emissiveCyan' : 'emissiveOrange').tint(1, 1, 1);
    g.box(17.1, DECK_Y + 0.14, z, 0.18, 0.14, 0.42);
    const portX = z >= -26 && z <= 58 ? -23.0 : -19.0;
    g.box(portX, DECK_Y + 0.14, z, 0.18, 0.14, 0.42);
  }

  // Starboard Island Superstructure (Pri-Fly bridge, exhaust stack, phased-array radar mast, red beacon)
  const ix = 14.2;
  g.use('steel').tint(0.50, 0.54, 0.60);
  g.box(ix, DECK_Y + 3.0, 0, 3.2, 3.0, 15.0);
  g.box(ix + 0.2, DECK_Y + 9.0, -0.5, 2.8, 3.0, 12.2);
  g.box(ix + 0.4, DECK_Y + 15.0, -3.5, 2.3, 3.0, 5.5);
  g.use('glass').tint(0.16, 0.30, 0.42);
  g.box(ix - 2.65, DECK_Y + 10.2, -2.5, 0.12, 1.0, 6.8);
  g.box(ix - 1.95, DECK_Y + 16.0, -3.5, 0.12, 1.15, 4.8);
  g.use('emissiveCyan').tint(0.45, 0.92, 1.0);
  g.box(ix - 2.45, DECK_Y + 9.6, -2.5, 0.08, 0.18, 6.0);
  g.use('steelDark').tint(0.30, 0.33, 0.38);
  g.box(ix + 0.5, DECK_Y + 15.4, 5.8, 2.0, 3.4, 3.2);
  g.use('steel').tint(0.58, 0.62, 0.68);
  g.cyl(ix + 0.4, DECK_Y + 18.0, -3.5, ix + 0.4, DECK_Y + 29.0, -3.5, 0.48, 0.22, 8);
  g.box(ix + 0.4, DECK_Y + 24.5, -3.5, 4.2, 0.18, 0.28);
  g.use('paintWhite').tint(0.90, 0.92, 0.96);
  g.box(ix + 0.4, DECK_Y + 22.8, -3.5, 0.5, 0.65, 3.6);
  g.use('emissiveRed').tint(1, 0.2, 0.15);
  g.box(ix + 0.4, DECK_Y + 29.3, -3.5, 0.32, 0.35, 0.32);
  g.tint(1);

  // Carrier deck & hull colliders (walkable / landable flight deck at y = 10)
  k.collide(-1.0, DECK_Y - DECK_T / 2, 0, 18.5, DECK_T / 2, 72, 'concrete');
  k.collide(-21.25, DECK_Y - DECK_T / 2, 16, 2.25, DECK_T / 2, 42, 'concrete');
  k.noClimb(() => {
    k.collide(0, 4.6, 0, 16.2, 4.7, 71, 'metal');
    k.collide(ix, DECK_Y + 9.0, 0, 3.3, 9.0, 15.1, 'metal');
  });
  k.pop();

  spec.plan?.blocks.push({ x0: cx - 23.5, z0: cz - 72, x1: cx + 17.5, z1: cz + 72 });

  // Friendly Escort Frigates flanking CVN-91
  for (const f of STRAIT_FRIENDLY_ESCORTS) {
    authorNavalEscort(k, f, false);
    spec.plan?.blocks.push({ x0: f.x - 8, z0: f.z - 42, x1: f.x + 8, z1: f.z + 42 });
  }
}

/**
 * Shared detailed PBR warship builder used for both the 2 Friendly Escort Frigates and the 2 heavily armed
 * Hostile Southern Missile Destroyers (`destroyer_west` & `destroyer_east`) with SAM/CIWS sponson pads.
 */
function authorNavalEscort(k: Kit, ship: StraitShipPose, hostileDestroyer: boolean): void {
  const g = k.geo;
  const hullScale = hostileDestroyer ? 1.18 : 0.94;
  const hx = 6.2 * hullScale;
  const hz = 38 * hullScale;

  k.push(ship.x, 0, ship.z, ship.yaw);

  // Red anti-fouling waterline boot-top
  g.use('paintRed').tint(0.54, 0.15, 0.14);
  g.box(0, 0.1, 0, hx * 0.96, 1.3, hz);
  g.box(0, 0.1, -(hz + 6.5), hx * 0.56, 1.3, 6.8);

  // Main armored stealth naval hull (darker gunmetal slate on hostile Southern destroyers)
  g.use('steel').tint(
    hostileDestroyer ? 0.34 : 0.46,
    hostileDestroyer ? 0.38 : 0.51,
    hostileDestroyer ? 0.44 : 0.56,
  );
  g.box(0, 3.4, 0, hx, 2.4, hz + 1);
  // Pointed raked bow prow
  g.box(0, 3.7, -(hz + 6.5), hx * 0.62, 2.2, 6.8);
  g.box(0, 4.0, -(hz + 13.0), hx * 0.30, 1.9, 3.8);

  // Non-skid main weather deck + aft helicopter landing deck
  g.use('asphalt').tint(0.28, 0.31, 0.36);
  g.box(0, 5.85, 0, hx * 0.92, 0.12, hz * 0.94, FACE.py);
  // White helipad H + yellow safety circle bars on stern deck
  const heliZ = hz * 0.66;
  g.use('paintWhite').tint(0.88, 0.90, 0.94);
  g.box(-1.6, 5.99, heliZ, 0.28, 0.02, 2.8, FACE.py);
  g.box(1.6, 5.99, heliZ, 0.28, 0.02, 2.8, FACE.py);
  g.box(0, 5.99, heliZ, 1.6, 0.02, 0.30, FACE.py);
  g.use('paintYellow').tint(0.96, 0.78, 0.18);
  g.box(0, 5.99, heliZ - 6.8, hx * 0.78, 0.02, 0.24, FACE.py);
  g.box(0, 5.99, heliZ + 6.8, hx * 0.78, 0.02, 0.24, FACE.py);

  // Forward 5-inch stealth naval gun turret + raised armored VLS missile cell deck
  g.use('steelDark').tint(0.34, 0.38, 0.44);
  g.bevel(0, 6.8, -(hz * 0.76), 2.3, 1.05, 2.8, 0.22);
  g.cyl(0, 7.1, -(hz * 0.78), 0, 7.35, -(hz * 0.94), 0.24, 0.18, 6);
  // Forward VLS launcher bank
  g.use('panel').tint(0.32, 0.36, 0.42);
  g.bevel(0, 6.45, -24.0, 3.6, 0.65, 5.2, 0.1);
  if (hostileDestroyer) {
    g.use('hazard').tint(0.92, 0.62, 0.24);
    g.box(0, 7.12, -24.0, 3.2, 0.06, 4.6, FACE.py);
  }

  // Multi-tier stealth pyramid superstructure + AEGIS phased-array radar panels
  g.use('steel').tint(
    hostileDestroyer ? 0.38 : 0.50,
    hostileDestroyer ? 0.42 : 0.55,
    hostileDestroyer ? 0.47 : 0.60,
  );
  g.bevel(0, 9.8, -5.0, hx * 0.78, 4.0, 14.5, 0.45);
  // Aft helicopter hangar bay housing (supports aft SAM pad at y = 11.4, z = +12.0!)
  g.bevel(0, 8.6, 12.0, hx * 0.72, 2.7, 7.0, 0.25);
  // Upper navigation bridge house
  g.bevel(0, 15.6, -7.0, hx * 0.54, 2.5, 8.2, 0.35);
  // Octagonal AEGIS phased-array radar panels on bridge flanks
  g.use('panel').tint(0.56, 0.60, 0.66);
  g.box(-hx * 0.56, 15.2, -7.0, 0.14, 1.6, 2.2);
  g.box(hx * 0.56, 15.2, -7.0, 0.14, 1.6, 2.2);
  g.box(0, 15.2, -15.35, 2.4, 1.6, 0.14);

  // Integrated stealth mainmast + aft radar tower + rotating-style surveillance bar
  g.use('steelDark').tint(0.26, 0.30, 0.36);
  g.bevel(0, 22.4, -7.0, 1.9, 4.6, 2.4, 0.25);
  g.cyl(0, 27.0, -7.0, 0, 32.5, -7.0, 0.52, 0.18, 8);
  g.box(0, 29.0, -7.0, 4.8, 0.20, 0.28);
  g.use('paintWhite').tint(0.90, 0.92, 0.96);
  g.box(0, 26.8, -7.0, 0.45, 0.75, 4.2);

  // Bridge window glow (red/orange on hostile Southern destroyers, cyan on friendly escorts!)
  if (hostileDestroyer) {
    g.use('emissiveRed').tint(1.0, 0.28, 0.18);
    g.box(0, 16.0, -15.4, 3.6, 0.65, 0.14);
    g.use('emissiveOrange').tint(1.0, 0.55, 0.18);
    g.box(0, 11.4, -19.6, 4.2, 0.35, 0.12);
  } else {
    g.use('emissiveCyan').tint(0.45, 0.92, 1.0);
    g.box(0, 16.0, -15.4, 3.6, 0.65, 0.14);
  }
  // Bright red masthead aviation warning beacon
  g.use('emissiveRed').tint(1, 0.18, 0.14);
  g.box(0, 32.9, -7.0, 0.55, 0.48, 0.55);

  // Armored SAM & CIWS sponson pads matching DESTROYER_LOCAL_MOUNTS for BaseDefenseSystem!
  if (hostileDestroyer) {
    for (const m of DESTROYER_LOCAL_MOUNTS) {
      const [mx, my, mz] = m.local;
      g.use('steelDark').tint(0.32, 0.36, 0.42);
      g.box(mx, my - 0.55, mz, 2.3, 0.55, 2.3);
      g.use('hazard').tint(0.92, 0.68, 0.22);
      g.box(mx, my - 0.03, mz, 1.9, 0.06, 1.9, FACE.py);
    }
  }

  // Churning bow wave spray & twin stern propeller foam wakes
  g.use('paintWhite').tint(0.76, 0.88, 0.96);
  g.box(0, 0.03, hz + 34, 5.2, 0.015, 34, FACE.py);
  g.tint(0.56, 0.78, 0.90);
  g.box(0, 0.025, hz + 76, 8.6, 0.012, 26, FACE.py);
  for (const s of [-1, 1]) {
    k.push(s * 5.2, 0.035, -(hz + 10), -s * 0.38);
    g.use('paintWhite').tint(0.84, 0.94, 1.0);
    g.box(0, 0, 0, 1.1, 0.016, 14, FACE.py);
    k.pop();
  }
  g.tint(1);

  // Solid ship hull & superstructure colliders (noClimb)
  k.noClimb(() => {
    k.collide(0, 3.0, 0, hx + 0.3, 3.1, hz + 4, 'metal');
    k.collide(0, 13.5, -5.0, hx * 0.8, 10.0, 15.0, 'metal');
    k.collide(0, 8.6, 12.0, hx * 0.75, 2.8, 7.2, 'metal');
  });
  k.pop();
}

/** Stage 3: Mid-Strait Volcanic Sea Stacks (94–142 m tall). Hostile Southern Missile Destroyers spawn dynamically via StraitDirector so they can list & sink! */
function authorMidStraitGauntlet(k: Kit, spec: MapSpec): void {
  const g = k.geo;

  // Record ship footprint hints in the tactical plan; actual sinkable warship hulls + colliders spawn dynamically in DestroyerFleet.
  for (const d of STRAIT_DESTROYERS) {
    spec.plan?.blocks.push({ x0: d.x - 10, z0: d.z - 52, x1: d.x + 10, z1: d.z + 52 });
  }

  // 2. 8 Towering Jagged Volcanic Basalt Sea Stacks (94–142 m tall) for thrilling high-speed F-22 weaving!
  for (const s of STRAIT_SEA_STACKS) {
    k.push(s.x, 0, s.z, s.yaw);

    // Sea-level surf foam collar
    g.use('paintWhite').tint(0.76, 0.88, 0.96);
    g.box(0, 0.04, 0, s.radius * 1.28, 0.02, s.radius * 1.20, FACE.py);

    // Layered jagged basalt spire tiers
    g.use('concrete').tint(0.24, 0.24, 0.26);
    g.box(0, s.height * 0.16, 0, s.radius, s.height * 0.18, s.radius * 0.86);
    g.tint(0.30, 0.29, 0.30);
    g.box(s.radius * 0.18, s.height * 0.42, -s.radius * 0.12, s.radius * 0.72, s.height * 0.25, s.radius * 0.64);
    g.tint(0.36, 0.34, 0.32);
    g.box(-s.radius * 0.12, s.height * 0.70, s.radius * 0.08, s.radius * 0.42, s.height * 0.24, s.radius * 0.36);
    g.tint(0.42, 0.38, 0.34);
    g.box(-s.radius * 0.08, s.height * 0.93, s.radius * 0.04, s.radius * 0.18, s.height * 0.15, s.radius * 0.16);
    // Secondary jagged flanking basalt tooth
    g.tint(0.27, 0.27, 0.29);
    g.box(-s.radius * 0.92, s.height * 0.26, s.radius * 0.58, s.radius * 0.38, s.height * 0.28, s.radius * 0.32);
    g.box(s.radius * 0.84, s.height * 0.20, -s.radius * 0.52, s.radius * 0.34, s.height * 0.22, s.radius * 0.30);
    g.tint(1);

    k.noClimb(() => {
      k.collide(0, s.height * 0.18, 0, s.radius * 0.94, s.height * 0.20, s.radius * 0.82, 'concrete');
      k.collide(s.radius * 0.14, s.height * 0.52, -s.radius * 0.08, s.radius * 0.62, s.height * 0.28, s.radius * 0.54, 'concrete');
      k.collide(-s.radius * 0.08, s.height * 0.84, s.radius * 0.06, s.radius * 0.28, s.height * 0.20, s.radius * 0.26, 'concrete');
    });
    k.pop();

    spec.plan?.blocks.push({
      x0: s.x - s.radius,
      z0: s.z - s.radius,
      x1: s.x + s.radius,
      z1: s.z + s.radius,
    });
  }
}

/** Stage 4: North Horizon Fortified Enemy Coastline Cliffs, Radar Towers & Rising Dark Smoke Pillars (Fortress Halcyon). */
function authorHalcyonHorizon(k: Kit): void {
  const g = k.geo;

  // White surf foam line along the enemy northern shoreline (z = -692)
  g.use('paintWhite').tint(0.74, 0.84, 0.92);
  g.box(0, 0.04, -692, 840, 0.02, 10, FACE.py);

  // Sweeping jagged enemy coastal cliffs spanning x = -860..+860 across z = -700..-830
  const cliffBlocks: readonly [number, number, number, number, number][] = [
    [-720, -755, 165, 58, 72],
    [-480, -765, 160, 62, 92],
    [-250, -760, 155, 58, 108],
    [   0, -770, 175, 64, 128],
    [ 260, -760, 155, 58, 102],
    [ 495, -765, 165, 62, 88],
    [ 730, -755, 160, 56, 70],
  ];
  for (const [cx, cz, hx, hz, h] of cliffBlocks) {
    // Lower dark coastal basalt wall
    g.use('concrete').tint(0.22, 0.22, 0.24);
    g.box(cx, h * 0.28, cz, hx, h * 0.30, hz);
    // Mid-cliff faceted step
    g.tint(0.28, 0.27, 0.28);
    g.box(cx + hx * 0.06, h * 0.62, cz - hz * 0.14, hx * 0.78, h * 0.26, hz * 0.72);
    // High ridge crest
    g.tint(0.34, 0.31, 0.30);
    g.box(cx - hx * 0.08, h * 0.88, cz - hz * 0.24, hx * 0.48, h * 0.16, hz * 0.46);
  }

  // Fortified concrete seawall bastions & glowing red firing slits embedded along z = -700
  for (const bx of [-380, -140, 120, 390]) {
    g.use('concreteDark').tint(0.36, 0.38, 0.42);
    g.bevel(bx, 18, -704, 34, 18, 14, 1.2);
    g.use('emissiveRed').tint(1.0, 0.25, 0.16);
    g.box(bx, 24, -689.5, 22, 1.2, 0.6, FACE.pz);
  }

  // 3 Tall Hostile Coastal Early-Warning Radar Towers crowning the cliffs
  for (const r of STRAIT_COASTAL_RADARS) {
    g.use('steelDark').tint(0.34, 0.38, 0.44);
    g.cyl(r.x, r.baseY, r.z, r.x, r.baseY + r.height, r.z, 3.2, 1.4, 8);
    g.box(r.x, r.baseY + r.height * 0.68, r.z, 11.0, 1.1, 1.4);
    // White geodesic radar dome + bright red aviation warning beacon
    g.use('paintWhite').tint(0.86, 0.88, 0.92);
    g.box(r.x, r.baseY + r.height + 4.5, r.z, 5.2, 4.8, 5.2);
    g.use('emissiveRed').tint(1, 0.18, 0.14);
    g.box(r.x, r.baseY + r.height + 10.6, r.z, 1.8, 2.2, 1.8);
  }

  // 5 Rising Dark Smoke Pillars marking Fortress Halcyon's burning industrial horizon!
  for (const p of STRAIT_SMOKE_PILLARS) {
    // Glowing orange-red furnace glow at pillar base
    g.use('emissiveOrange').tint(1.0, 0.42, 0.12);
    g.box(p.x, p.baseY + 5, p.z, p.radius * 0.55, 6.0, p.radius * 0.55);

    // Rising tiered dark charcoal smoke plume drifting gently eastward with altitude
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const t = i / (segs - 1);
      const sy = p.baseY + 14 + t * p.height;
      const sx = p.x + t * 28 + Math.sin(i * 1.7 + p.x) * 6;
      const sz = p.z - t * 14;
      const rad = p.radius * (0.65 + t * 1.15);
      const shade = 0.14 + t * 0.12;
      g.use('concreteDark').tint(shade, shade, shade + 0.02);
      g.box(sx, sy, sz, rad, (p.height / segs) * 0.62, rad * 0.92);
    }
  }
  g.tint(1);

  // Single simple coastal cliff face collider along z = -755 so jets cannot clip straight through the enemy mainland.
  k.noClimb(() => {
    k.collide(0, 48, -775, 860, 52, 65, 'concrete');
  });
}

export const STRAIT_STAGES = [
  {
    label: 'Charting the Open-Sea Strait & cloud deck',
    run: (k: Kit, spec: MapSpec) => {
      start(spec);
      authorOceanAndClouds(k);
      STAGES_BUILT.add(spec);
    },
  },
  {
    label: 'Deploying the South Friendly Carrier Strike Group',
    run: authorCarrierStrikeGroup,
  },
  {
    label: 'Positioning Mid-Strait destroyers & volcanic sea stacks',
    run: authorMidStraitGauntlet,
  },
  {
    label: 'Raising the North Fortress Halcyon coastline',
    run: authorHalcyonHorizon,
  },
] as const;

function zones(spec: MapSpec): void {
  const sky = STRAIT_BOUNDS.y1;
  spec.zone('strait-carrier', 'CARRIER STRIKE GROUP UMBRELLA', -220, -2, 420, 220, 140, 660);
  spec.zone('strait-gauntlet', 'MID-STRAIT DESTROYER GAUNTLET', -420, -2, -260, 420, 220, 220);
  spec.zone('strait-coast', 'FORTRESS HALCYON APPROACH', -820, -2, -820, 820, sky, -560);
  spec.zone(
    'strait-airspace',
    'THE OPEN-SEA STRAIT',
    STRAIT_BOUNDS.x0,
    STRAIT_BOUNDS.y0,
    STRAIT_BOUNDS.z0,
    STRAIT_BOUNDS.x1,
    sky,
    STRAIT_BOUNDS.z1,
  );
}

function spawns(spec: MapSpec): void {
  const airSpawns: SpawnPoint[] = STRAIT_SKY_SPAWNS.map(([x, y, z]) => ({
    position: new THREE.Vector3(x, y, z),
    zone: 'strait-airspace',
    kind: 'air',
  }));

  // Ground fallback spawns on the friendly carrier deck so generic validators always find >= 1 ground spawn.
  const deckSpawns: SpawnPoint[] = [
    { position: new THREE.Vector3(-10, DECK_Y + 0.1, 512), zone: 'strait-carrier', kind: 'ground' },
    { position: new THREE.Vector3(-10, DECK_Y + 0.1, 574), zone: 'strait-carrier', kind: 'ground' },
  ];

  spec.spawns = [...deckSpawns, ...airSpawns];

  spec.pickup(7.8, DECK_Y + 0.4, 554);
  spec.pickup(7.8, DECK_Y + 0.4, 526);

  spec.playerSpawns.push(
    {
      position: new THREE.Vector3(STRAIT_DECK_PLAYER_SPAWN[0], STRAIT_DECK_PLAYER_SPAWN[1] + 0.1, STRAIT_DECK_PLAYER_SPAWN[2]),
      yaw: STRAIT_DECK_PLAYER_YAW,
    },
    { position: new THREE.Vector3(-4.2, DECK_Y + 0.1, 552), yaw: 0 },
    { position: new THREE.Vector3(0, 92, 502), yaw: 0 },
  );
}

function views(spec: MapSpec): void {
  spec.view('overview', 240, 140, 420, 0, 24, -120);
  spec.view('carrier', -95, 58, 430, 0, DECK_Y + 6, 540);
  spec.view('gauntlet', 0, 118, 220, 0, 20, -140);
  spec.view('destroyerWest', -240, 42, 40, -140, 12, -60);
  spec.view('destroyerEast', 250, 42, -60, 150, 12, -160);
  spec.view('halcyon', 0, 145, -360, 0, 68, -740);
}

/**
 * Finalizes Open-Sea Strait zones, spawns, pickups, and views.
 * Safely executes `STRAIT_STAGES` when called standalone without running stages first.
 */
export function authorStrait(k: Kit, spec: MapSpec): void {
  if (!STAGES_BUILT.has(spec)) {
    for (const stage of STRAIT_STAGES) {
      stage.run(k, spec);
    }
  }
  zones(spec);
  spawns(spec);
  views(spec);
}
