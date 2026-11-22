/**
 * Brine Central Reserve & Coastal Elevated Expressway ("Bank Run", Mission 4).
 *
 * `plan.ts` holds every shared coordinate, elevation, skylight aperture, vault door,
 * gold pallet, Humvee park, highway origin, spawn, pickup, and road;
 * `exterior.ts` builds the plaza, portico, neoclassical exterior shell, rooftop helipad,
 * open skylight aperture + Tier-1 `bank.skylight` cluster, rooftop stairwell, skyline, and
 * offset 4-lane Coastal Elevated Expressway deck;
 * `interior.ts` builds the Grand Marble Banking Hall, teller bays with breakable panes,
 * twin grand staircases, wrap-around mezzanine galleries, Security Office, Vault Descent Ramp,
 * Vault Antechamber, and Planetary Bullion Vault.
 */
import * as THREE from 'three';
import type { SpawnPoint } from '../../../core/contracts';
import type { Kit } from '../../kit/kit';
import type { MapSpec } from '../spec';
import { authorBankExterior } from './exterior';
import { authorBankInterior } from './interior';
import {
  AIR_SPAWNS,
  BANK_BOUNDS,
  BANK_KILL_Y,
  BANK_ROADS,
  GROUND_SPAWNS,
  HIGHWAY_ORIGIN,
  LV,
  PICKUP_SPOTS,
  PLAYER_SPAWNS,
  SKYLIGHT_CENTER,
} from './plan';

export const BANK_STAGES = [
  {
    label: 'Raising Brine Central Reserve',
    run: (k: Kit, spec: MapSpec) => {
      start(spec);
      authorBankExterior(k, spec);
    },
  },
  {
    label: 'Furnishing the Banking Hall & Vault',
    run: authorBankInterior,
  },
] as const;

function start(spec: MapSpec): void {
  spec.reactor = null;
  spec.killY = BANK_KILL_Y;
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
      fill(-12, -43, 12, -32, [0.42, 0.34, 0.16], 'BULLION VAULT'),
      fill(-18, -32, 18, -20, [0.24, 0.27, 0.31], 'ANTECHAMBER'),
      fill(-27, -16, 27, 24, [0.36, 0.35, 0.32], 'BANKING HALL'),
      fill(-16, 24, 16, 31, [0.32, 0.31, 0.29], 'PORTICO'),
      fill(-62, 34, 62, 56, [0.18, 0.19, 0.21], 'COASTAL AVE'),
      fill(114, -60, 142, 60, [0.2, 0.21, 0.24], 'EXPRESSWAY'),
    ],
    walls: [],
    blocks: [],
    decks: [],
    gates: [],
    doors: [],
  };
  spec.roads = BANK_ROADS.map(r => ({ id: r.id, points: r.points, width: r.width }));
}

/** Smallest / most specific zones first so `zoneAt` resolves the tightest match. */
function zones(spec: MapSpec): void {
  const sky = BANK_BOUNDS.y1;

  // Sub-grade Vault Wing (-1.5)
  spec.zone('bank-vault', 'PLANETARY BULLION VAULT', -12.6, -3.5, -43.5, 12.6, 4.2, -32);
  spec.zone('bank-antechamber', 'VAULT ANTECHAMBER', -27, -3.5, -32, 27, 4.2, -16);

  // Mezzanine Level (5.5)
  spec.zone('bank-security-office', 'MEZZANINE SECURITY OFFICE', -22.5, 5.0, -11.6, -15.5, 9.6, -5.0);
  spec.zone('bank-mezzanine', 'MEZZANINE GALLERY', -27, 5.0, -16, 27, 13.4, 24);

  // Rooftop (14)
  spec.zone('bank-roof', 'RESERVE ROOFTOP', -28, 13.5, -22, 28, sky, 26);

  // Ground Interior (0)
  spec.zone('bank-hall', 'GRAND BANKING HALL', -27, -1.0, -16, 27, 13.5, 24);

  // Offset Coastal Elevated Expressway (12)
  spec.zone('bank-highway', 'COASTAL ELEVATED EXPRESSWAY', 112, 9.5, -62, 144, sky, 62);

  // Outer Plaza & Precinct
  spec.zone('bank-plaza', 'RESERVE PLAZA', -64, -2.0, 24, 64, sky, 64);
  spec.zone(
    'bank-precinct',
    'BRINE FINANCIAL DISTRICT',
    BANK_BOUNDS.x0,
    BANK_BOUNDS.y0,
    BANK_BOUNDS.z0,
    BANK_BOUNDS.x1,
    sky,
    BANK_BOUNDS.z1,
  );
}

function spawns(spec: MapSpec): void {
  const groundSpawns: SpawnPoint[] = GROUND_SPAWNS.map(([x, y, z, zone]) => ({
    position: new THREE.Vector3(x, y + 0.1, z),
    zone,
    kind: 'ground',
  }));
  const airSpawns: SpawnPoint[] = AIR_SPAWNS.map(([x, y, z]) => ({
    position: new THREE.Vector3(x, y, z),
    zone: 'bank-precinct',
    kind: 'air',
  }));
  spec.spawns = [...groundSpawns, ...airSpawns];

  for (const [x, y, z, zone] of GROUND_SPAWNS) spec.gate(zone, x, y + 0.1, z);
  for (const [x, y, z] of PICKUP_SPOTS) spec.pickup(x, y, z);
  for (const s of PLAYER_SPAWNS) {
    spec.playerSpawns.push({ position: new THREE.Vector3(s.x, s.y + 0.1, s.z), yaw: s.yaw });
  }
}

function views(spec: MapSpec): void {
  const eye = 1.62;
  const look = (name: string, x: number, y: number, z: number, lx: number, ly: number, lz: number) =>
    spec.view(name, x, y + eye, z, lx, ly, lz);

  spec.view('overview', 56, 52, 68, 0, 6, 4);
  look('roof', 0, LV.roof, 21, 0, LV.roof + 1.2, 0);
  spec.view('skylight', 10, LV.roof + 5.5, 11, SKYLIGHT_CENTER[0], LV.hall + 2, SKYLIGHT_CENTER[2]);
  look('atrium', 0, LV.hall, 18, 0, 6, -12);
  look('mezzanine', -17, LV.mezz, 12, 8, LV.hall + 4, -8);
  look('vaultDoor', 0, LV.vault, -24, 0, LV.vault + 1.8, -32);
  look('vault', 0, LV.vault, -33.5, 0, LV.vault + 1.2, -41);
  look('plaza', 0, LV.hall, 48, 0, 8, 22);
  spec.view('highway', HIGHWAY_ORIGIN[0] - 8, HIGHWAY_ORIGIN[1] + 5.5, 22, HIGHWAY_ORIGIN[0], HIGHWAY_ORIGIN[1] + 1.5, -24);
}

export function authorBank(_k: Kit, spec: MapSpec): void {
  zones(spec);
  spawns(spec);
  views(spec);
}

export * from './plan';
