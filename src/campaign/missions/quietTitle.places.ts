/**
 * Spatial layout, marks, zones, patrol routes, blast shutters, opening flyover cutscene,
 * and High Magistrate Aldous Vane's 75-second Upper Bureau routine for Mission 3 ("Quiet Title").
 *
 * Coordinates match the Chancery Estate map (`src/world/map/chancery/plan.ts`):
 *   x east, y up, z south; yaw 0 faces north (-z), π south (+z), π/2 west (-x), -π/2 east (+x).
 */
import type { Cutscene, DoorDef, Mark, Vec3, Zone } from '../types';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Zone => ({
  min: [x0, y0, z0],
  max: [x1, y1, z1],
});

const at = (x: number, y: number, z: number, yaw = 0): Mark => ({ at: [x, y, z], yaw });

const N = 0;
const W = Math.PI / 2;
const S = Math.PI;
const E = -Math.PI / 2;

export interface VaneStation {
  readonly id: 'vaneWindow' | 'vaneBoard' | 'vaneDesk' | 'vaneLoggia';
  readonly position: Vec3;
  readonly yaw: number;
  readonly seconds: number;
  readonly activity: string;
}

/**
 * High Magistrate Aldous Vane's 75-second unalerted Upper Bureau cycle (`y = 6`).
 * Every station exposes a clean sightline window from either the East Bell Tower or interior approaches.
 */
export const VANE_STATIONS: readonly VaneStation[] = [
  {
    id: 'vaneWindow',
    position: [0, 6, -29],
    yaw: Math.PI,
    seconds: 18,
    activity: 'Watching Holdfast burn through the south panoramic glass',
  },
  {
    id: 'vaneBoard',
    position: [-12, 6, -42],
    yaw: -Math.PI / 2,
    seconds: 20,
    activity: 'Inspecting the Red Goggles Incident Board',
  },
  {
    id: 'vaneDesk',
    position: [0, 6, -46],
    yaw: Math.PI,
    seconds: 22,
    activity: 'Drafting Form 9-A Stay of Liquidation & Tallow manifests',
  },
  {
    id: 'vaneLoggia',
    position: [24, 6, -40],
    yaw: Math.PI / 2,
    seconds: 15,
    activity: 'Taking evening air on the East Stone Loggia',
  },
];

/** Exact Chancery Estate coordinates shared with `src/world/map/chancery/plan.ts`. */
export const MARKS: Readonly<Record<string, Mark>> = {
  // Insertion & checkpoints
  culvert: at(-55, 0, 62, N),
  courtyardRally: at(0, 0, 6, N),

  // Perimeter & grounds
  gatehouse: at(0, 0, 44, N),
  guardhouseA: at(-26, 0, 40, N),
  guardhouseB: at(34, 0, 40, N),
  westGarden: at(-48, 0, 30, N),
  generatorHouse: at(-50, 0, 0, E),
  generatorConsole: at(-50, -8, -22, N),
  courtyard: at(0, 0, 6, S),
  eastTerrace: at(48, 0, 28, W),
  conservatory: at(48, 0, -8, W),

  // East Bell-Tower Sniper Perch (Contractor #4418-B's nest)
  bellPerch: at(48, 11.5, -22, W),

  // Chancery Ground Floor
  foyer: at(0, 0, -30, S),
  westLibrary: at(-18, 0, -40, E),
  eastArchive: at(18, 0, -34, W),
  servantWing: at(-36, 0, -36, E),

  // Chancery Upper Bureau (y = 6)
  vaneWindow: at(0, 6, -29, Math.PI),
  vaneBoard: at(-12, 6, -42, -Math.PI / 2),
  vaneDesk: at(0, 6, -46, Math.PI),
  vaneLoggia: at(24, 6, -40, Math.PI / 2),
  lift: at(-16, 6, -54, S),

  // Subterranean Continuity Bunker Sub-Level (y = -8)
  armoryRack: at(-14, -8, -16, E),
  vaultAntechamber: at(0, -8, -28, S),
  bunkerDoor: at(0, -8, -38, N),
  bunkerDesk: at(0, -8, -52, S),
};

export const ZONES: Readonly<Record<string, Zone>> = {
  /** South-west coastal culvert insertion & extraction point. */
  exfilCulvert: box(-64, -2, 54, -44, 6, 70),
  /** North clifftop extraction line behind the Chancery Estate. */
  exfilCliff: box(-20, -2, -68, 20, 8, -58),
  /** East Bell-Tower Sniper Perch landing (Contractor #4418-B's nest). */
  bellTower: box(43, 9, -28, 53, 15, -16),
};

/** Looping patrol routes across every estate sector; all marks lie on walkable Chancery ground. */
export const ROUTES: Readonly<Record<string, readonly string[]>> = {
  patrolWest: ['westGarden', 'guardhouseA', 'generatorHouse', 'westGarden'],
  patrolCourtyard: ['courtyard', 'guardhouseB', 'foyer', 'guardhouseA', 'courtyard'],
  patrolEast: ['eastTerrace', 'conservatory', 'guardhouseB', 'eastTerrace'],
  patrolMansion: ['foyer', 'westLibrary', 'servantWing', 'eastArchive', 'foyer'],
  patrolUpper: ['vaneWindow', 'vaneBoard', 'vaneDesk', 'vaneLoggia'],
};

/** Heavy armoured blast shutters protecting the Upper Bureau once Continuity Protocol triggers. */
export const DOORS: Readonly<Record<string, DoorDef>> = {
  'shutter.south': {
    at: [0, 6.8, -26],
    yaw: 0,
    width: 28,
    height: 3.9,
    kind: 'shutter',
    seconds: 1.4,
    start: 1,
    look: 'steelDark',
  },
  'shutter.east': {
    at: [20, 6, -40],
    yaw: Math.PI / 2,
    width: 4.5,
    height: 3.4,
    kind: 'shutter',
    seconds: 1.2,
    start: 1,
    look: 'steelDark',
  },
};

/** 3-shot moonlit flyover introducing the Chancery Estate, Upper Bureau, Bell Tower, and Culvert drop. */
export const CUTSCENES: Readonly<Record<string, Cutscene>> = {
  briefing: {
    shots: [
      {
        // Shot 1: Distant amber Holdfast glow rising over the silhouette of the clifftop Chancery Estate
        from: [-95, 42, 95],
        to: [-42, 30, 48],
        lookFrom: [0, 10, -35],
        lookTo: [0, 8, -32],
        seconds: 6.5,
        fov: 52,
        fadeIn: 1.8,
        caption: 'Chancery Estate — 04:18',
      },
      {
        // Shot 2: Pan past the lit Upper Bureau south windows & across the East Bell-Tower Sniper Perch
        from: [12, 14, -6],
        to: [62, 16, -10],
        lookFrom: [0, 8.5, -36],
        lookTo: [46, 11.5, -24],
        seconds: 5.5,
        fov: 46,
        caption: 'Form 7742-X — Quiet Title',
      },
      {
        // Shot 3: Sweep down to the moonlit Coastal Culvert insertion point
        from: [-32, 18, 86],
        to: [-55, 4.5, 70],
        lookFrom: [-50, 2, 52],
        lookTo: [-55, 1.5, 56],
        seconds: 4.5,
        fov: 56,
        fadeOut: 1.0,
        caption: 'Coastal Culvert — Insertion',
      },
    ],
  },
};
